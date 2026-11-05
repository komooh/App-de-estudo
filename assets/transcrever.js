// Transcrição de áudio e vídeo de aula (português e espanhol), toda no navegador.
// O áudio NUNCA sai do aparelho: o arquivo é aberto aqui, o som é convertido para 16 kHz mono e o
// Whisper (Transformers.js) roda num Web Worker (assets/transcrever-worker.js), com WebGPU se houver,
// senão WebAssembly. A rede só baixa a biblioteca e o modelo (uma vez; depois fica no cache do navegador).
//
//   Transcrever.suportado(file) -> boolean     (formato aceito e navegador capaz)
//   Transcrever.arquivo(file, onProgress(frac, msg), {idioma: "pt"|"es"}?) -> Promise<{texto, idioma, duracao}>
//   Transcrever.cancelar()                     (para o que estiver rodando; a promessa rejeita com .codigo "cancelado")
//
// Erros têm .codigo ("suporte" | "formato" | "grande" | "longo" | "abrir" | "modelo" | "cancelado" | "falha")
// e uma mensagem em português para mostrar ao aluno.
//
// Configuração opcional em window.APP_CONFIG:
//   WHISPER_MODELO  (padrão "onnx-community/whisper-base", multilíngue)
//   WHISPER_TRANSFORMERS (URL ESM do Transformers.js)   WHISPER_GPU (false = nunca usar WebGPU)
//
// Arquivos longos não são decodificados de uma vez (a decodificação do navegador ocupa ~1 GB por hora de
// áudio): WAV é lido em pedaços; M4A/MP4/MOV com AAC é desmontado aqui e cada pedaço de 5 min vira AAC "ADTS"
// para o navegador decodificar; MP3 é cortado nos quadros. Os demais (OGG, WebM, FLAC…) são abertos inteiros:
// até ~45 min funciona em computador comum; acima disso, se o navegador não der conta, o aluno recebe o aviso.
(function (g) {
  "use strict";
  const SCRIPT = (g.document && g.document.currentScript && g.document.currentScript.src) || "";
  const SR = 16000;
  const LIM = {
    bytes: 500 * 1024 * 1024,
    segundos: 2 * 3600,
    inteiroSeg: 45 * 60,          // acima disto, formato que só abre inteiro pode falhar por memória
    segmento: 300,                // segundos decodificados por vez (WAV, MP4/AAC, MP3)
    janela: 30, corteMin: 22,     // janelas do Whisper: até 30 s, cortadas no ponto mais silencioso depois de 22 s
    silencio: 0.004,              // RMS abaixo disto = janela sem fala (não manda ao Whisper: evita "alucinação")
    caixaMoov: 64 * 1024 * 1024,
  };
  const PADRAO = {
    modelo: "onnx-community/whisper-base",
    url: "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js",
    dtypeWasm: "q8",
    dtypeGpu: { encoder_model: "fp32", decoder_model_merged: "q4" },
  };
  const EXT = /\.(mp3|mpga|m4a|m4b|aac|wav|wave|ogg|oga|opus|weba|webm|flac|mp4|m4v|mov|3gp|amr)$/i;
  const MSG = {
    suporte: "Este navegador não consegue transcrever áudio aqui. Use o Chrome, Edge ou Firefox atualizados num computador.",
    formato: "Este arquivo não parece ser de áudio ou vídeo. Envie MP3, M4A, WAV, OGG, OPUS, WebM, FLAC, MP4 ou MOV.",
    grande: "Este arquivo passa de 500 MB. Envie só o áudio (MP3 ou M4A) ou divida a gravação em partes.",
    longo: "Esta gravação passa de 2 horas. Divida em partes de até 2 horas e envie cada uma.",
    abrir: "Não consegui abrir o som deste arquivo. Pode ser um formato que o navegador não lê (ou o arquivo está corrompido). Converta para MP3 ou M4A e tente de novo.",
    longoInteiro: "Este áudio é longo demais para abrir de uma vez neste aparelho. Converta para MP3 ou M4A (o site lê esses em partes) ou divida a gravação em partes de até 40 minutos.",
    modelo: "Não consegui baixar o modelo de voz. Confira a internet e tente de novo (ele só é baixado na primeira vez).",
    cancelado: "Transcrição cancelada.",
    falha: "A transcrição parou com um erro. Tente de novo; se continuar, use outro navegador (Chrome ou Edge).",
    vazio: "Não encontrei fala neste arquivo.",
  };
  const erro = (codigo, msg) => Object.assign(new Error(msg || MSG[codigo] || MSG.falha), { codigo });

  function cfg() {
    const c = (g.APP_CONFIG) || {};
    return {
      modelo: c.WHISPER_MODELO || PADRAO.modelo,
      url: c.WHISPER_TRANSFORMERS || PADRAO.url,
      gpu: c.WHISPER_GPU !== false,
      dtypeWasm: c.WHISPER_DTYPE_WASM || PADRAO.dtypeWasm,
      dtypeGpu: c.WHISPER_DTYPE_GPU || PADRAO.dtypeGpu,
    };
  }

  function ambienteOk() {
    return typeof g.WebAssembly === "object" && typeof g.Worker === "function" &&
      typeof (g.OfflineAudioContext || g.webkitOfflineAudioContext) === "function";
  }

  function suportado(file) {
    if (!ambienteOk() || !file) return false;
    const tipo = String(file.type || "").toLowerCase();
    if (/^(audio|video)\//.test(tipo)) return true;
    return EXT.test(String(file.name || ""));
  }

  /* ================= áudio: decodificar e reamostrar ================= */

  const OAC = () => g.OfflineAudioContext || g.webkitOfflineAudioContext;
  let taxaCtx = SR; // se o navegador não aceitar contexto a 16 kHz, decodifica a 48 kHz e reamostra aqui

  function decodeCom(ctx, buf) {
    return new Promise((ok, no) => {
      try {
        const p = ctx.decodeAudioData(buf, ok, no);
        if (p && typeof p.then === "function") p.then(ok, no);
      } catch (e) { no(e); }
    });
  }

  // ArrayBuffer de um arquivo (ou pedaço) -> Float32Array 16 kHz mono
  async function decodificar(buf) {
    let ctx;
    try { ctx = new (OAC())(1, 1, taxaCtx); } catch (_) { taxaCtx = 48000; ctx = new (OAC())(1, 1, taxaCtx); }
    const ab = await decodeCom(ctx, buf);
    return paraMono16k(ab);
  }

  function paraMono16k(ab) {
    const n = ab.length, nc = ab.numberOfChannels;
    let m;
    if (nc === 1) m = ab.getChannelData(0);
    else {
      m = new Float32Array(n);
      for (let c = 0; c < nc; c++) { const d = ab.getChannelData(c); for (let i = 0; i < n; i++) m[i] += d[i]; }
      const k = 1 / nc; for (let i = 0; i < n; i++) m[i] *= k;
    }
    return ab.sampleRate === SR ? m : reamostrar(m, ab.sampleRate);
  }

  // Reamostragem simples (média na caixa + interpolação linear): usada só quando o navegador não o faz.
  function reamostrar(x, de) {
    if (de === SR) return x;
    const r = de / SR, n = Math.floor(x.length / r), y = new Float32Array(n);
    const caixa = Math.max(1, Math.floor(r));
    for (let i = 0; i < n; i++) {
      const p = i * r, j = Math.floor(p);
      let s = 0, q = 0;
      for (let k = j; k < j + caixa && k < x.length; k++) { s += x[k]; q++; }
      y[i] = q ? s / q : 0;
    }
    return y;
  }

  // PCM mono (taxa qualquer) -> 16 kHz; usa o reamostrador do navegador quando possível
  async function monoPara16k(mono, taxa) {
    const n = mono.length;
    if (taxa === SR) return mono;
    try {
      const len = Math.max(1, Math.round(n * SR / taxa));
      const ctx = new (OAC())(1, len, SR);
      const b = ctx.createBuffer(1, n, taxa);
      b.copyToChannel(mono, 0);
      const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start();
      const out = await ctx.startRendering();
      return out.getChannelData(0);
    } catch (_) { return reamostrar(mono, taxa); }
  }

  const ler = (file, ini, fim) => file.slice(ini, fim).arrayBuffer();

  /* ================= duração pelo elemento <audio>/<video> ================= */

  function sondarDuracao(file) {
    return new Promise((ok) => {
      if (!g.document) return ok(null);
      const video = /^video\//.test(file.type || "") || /\.(mp4|m4v|mov|webm|3gp)$/i.test(file.name || "");
      const el = g.document.createElement(video ? "video" : "audio");
      const url = URL.createObjectURL(file);
      let feito = false;
      const fim = (d) => {
        if (feito) return; feito = true; clearTimeout(t);
        el.removeAttribute("src"); try { el.load(); } catch (_) {}
        URL.revokeObjectURL(url);
        ok(Number.isFinite(d) && d > 0 ? d : null);
      };
      const t = setTimeout(() => fim(null), 15000);
      el.preload = "metadata"; el.muted = true;
      el.onloadedmetadata = () => {
        if (Number.isFinite(el.duration)) return fim(el.duration);
        // WebM gravado pelo navegador vem sem duração: pular para o fim força o cálculo
        el.ondurationchange = () => { if (Number.isFinite(el.duration)) fim(el.duration); };
        try { el.currentTime = 1e9; } catch (_) { fim(null); }
      };
      el.onerror = () => fim(null);
      el.src = url;
    });
  }

  /* ================= fontes: entregam o som em pedaços de ~5 min ================= */

  // WAV PCM (8/16/24/32 bits inteiro ou float 32/64): lido direto, em pedaços
  async function fonteWav(file) {
    const cab = new DataView(await ler(file, 0, 12));
    if (cab.byteLength < 12 || cab.getUint32(0) !== 0x52494646 || cab.getUint32(8) !== 0x57415645) return null; // RIFF....WAVE
    let pos = 12, fmt = null, dados = null;
    while (pos + 8 <= file.size && !dados) {
      const h = new DataView(await ler(file, pos, pos + 8));
      const id = h.getUint32(0), tam = h.getUint32(4, true);
      if (id === 0x666d7420) { // "fmt "
        const f = new DataView(await ler(file, pos + 8, pos + 8 + Math.min(tam, 40)));
        let formato = f.getUint16(0, true);
        if (formato === 0xFFFE && tam >= 26) formato = f.getUint16(24, true);
        fmt = { formato, canais: f.getUint16(2, true), taxa: f.getUint32(4, true), bloco: f.getUint16(12, true), bits: f.getUint16(14, true) };
      } else if (id === 0x64617461) { // "data"
        dados = { ini: pos + 8, tam: Math.min(tam || file.size, file.size - pos - 8) };
      }
      pos += 8 + tam + (tam & 1);
    }
    if (!fmt || !dados || !fmt.canais || !fmt.taxa || !fmt.bloco) return null;
    const okFmt = (fmt.formato === 1 && [8, 16, 24, 32].includes(fmt.bits)) || (fmt.formato === 3 && [32, 64].includes(fmt.bits));
    if (!okFmt) return null;
    const bps = fmt.bits / 8, quadros = Math.floor(dados.tam / fmt.bloco);
    const porSeg = fmt.taxa * 60; // 1 min por vez: a leitura do WAV é barata
    let q = 0;
    return {
      duracao: quadros / fmt.taxa,
      async proximo() {
        if (q >= quadros) return null;
        const n = Math.min(porSeg, quadros - q);
        const dv = new DataView(await ler(file, dados.ini + q * fmt.bloco, dados.ini + (q + n) * fmt.bloco));
        q += n;
        const mono = new Float32Array(n), k = 1 / fmt.canais;
        for (let i = 0; i < n; i++) {
          let soma = 0;
          for (let c = 0; c < fmt.canais; c++) {
            const o = i * fmt.bloco + c * bps;
            let v;
            if (fmt.formato === 3) v = bps === 4 ? dv.getFloat32(o, true) : dv.getFloat64(o, true);
            else if (bps === 2) v = dv.getInt16(o, true) / 32768;
            else if (bps === 1) v = (dv.getUint8(o) - 128) / 128;
            else if (bps === 3) { let x = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16); v = x / 8388608; }
            else v = dv.getInt32(o, true) / 2147483648;
            soma += v;
          }
          mono[i] = soma * k;
        }
        return monoPara16k(mono, fmt.taxa);
      },
    };
  }

  // ---- MP4 / M4A / MOV: acha a faixa de áudio AAC e monta pedaços ADTS ----
  async function caixasTopo(file) {
    const out = [];
    let pos = 0;
    while (pos + 8 <= file.size && out.length < 10000) {
      const h = new DataView(await ler(file, pos, pos + 16));
      let tam = h.getUint32(0), cab = 8;
      const tipo = String.fromCharCode(h.getUint8(4), h.getUint8(5), h.getUint8(6), h.getUint8(7));
      if (tam === 1) { if (h.byteLength < 16) break; tam = h.getUint32(8) * 4294967296 + h.getUint32(12); cab = 16; }
      else if (tam === 0) tam = file.size - pos;
      if (tam < cab) break;
      out.push({ tipo, ini: pos, tam, cab });
      pos += tam;
    }
    return out;
  }

  function filhos(dv, ini, fim) {
    const out = [];
    let p = ini;
    while (p + 8 <= fim) {
      let tam = dv.getUint32(p), cab = 8;
      const tipo = String.fromCharCode(dv.getUint8(p + 4), dv.getUint8(p + 5), dv.getUint8(p + 6), dv.getUint8(p + 7));
      if (tam === 1) { tam = dv.getUint32(p + 8) * 4294967296 + dv.getUint32(p + 12); cab = 16; }
      else if (tam === 0) tam = fim - p;
      if (tam < cab || p + tam > fim) break;
      out.push({ tipo, ini: p, fim: p + tam, dados: p + cab });
      p += tam;
    }
    return out;
  }
  const filho = (dv, cx, tipo, pulo) => filhos(dv, cx.dados + (pulo || 0), cx.fim).find((c) => c.tipo === tipo);

  // Descritor MPEG-4 (dentro do esds): tamanho em até 4 bytes de 7 bits
  function descritor(dv, p) {
    const tag = dv.getUint8(p++); let tam = 0;
    for (let i = 0; i < 4; i++) { const b = dv.getUint8(p++); tam = (tam << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
    return { tag, tam, dados: p };
  }

  function lerAsc(dv, p, n) { // AudioSpecificConfig -> {perfil, freq, canais}
    let bits = 0, nb = 0, pos = p;
    const pega = (k) => { while (nb < k) { bits = (bits << 8) | (pos < p + n ? dv.getUint8(pos) : 0); pos++; nb += 8; } nb -= k; return (bits >> nb) & ((1 << k) - 1); };
    let aot = pega(5); if (aot === 31) aot = 32 + pega(6);
    const freq = pega(4); if (freq === 15) return null;
    const canais = pega(4);
    if (aot === 5 || aot === 29) { // HE-AAC: o ADTS leva o núcleo AAC-LC; o decodificador acha o SBR sozinho
      const ext = pega(4); if (ext === 15) return null;
      aot = pega(5);
    }
    if (aot < 1 || aot > 4 || canais < 1 || canais > 7) return null;
    return { perfil: aot - 1, freq, canais };
  }

  async function fonteMp4(file) {
    const topo = await caixasTopo(file);
    if (!topo.length || !["ftyp", "moov", "wide", "free", "mdat", "skip"].includes(topo[0].tipo)) return null;
    const moov = topo.find((c) => c.tipo === "moov");
    if (!moov || moov.tam > LIM.caixaMoov) return null; // MP4 fragmentado ou estranho: abre inteiro
    const dv = new DataView(await ler(file, moov.ini, moov.ini + moov.tam));
    const raiz = { dados: moov.cab, fim: moov.tam };
    for (const trak of filhos(dv, raiz.dados, raiz.fim).filter((c) => c.tipo === "trak")) {
      const mdia = filho(dv, trak, "mdia"); if (!mdia) continue;
      const hdlr = filho(dv, mdia, "hdlr");
      if (!hdlr || String.fromCharCode(dv.getUint8(hdlr.dados + 8), dv.getUint8(hdlr.dados + 9), dv.getUint8(hdlr.dados + 10), dv.getUint8(hdlr.dados + 11)) !== "soun") continue;
      const mdhd = filho(dv, mdia, "mdhd");
      const minf = filho(dv, mdia, "minf"), stbl = minf && filho(dv, minf, "stbl");
      if (!mdhd || !stbl) continue;
      const v1 = dv.getUint8(mdhd.dados) === 1;
      const escala = dv.getUint32(mdhd.dados + (v1 ? 20 : 12));
      const stsd = filho(dv, stbl, "stsd"); if (!stsd) continue;
      const ent = filhos(dv, stsd.dados + 8, stsd.fim)[0];
      if (!ent || ent.tipo !== "mp4a") return null;
      // mp4a: 28 bytes de SampleEntry de áudio (versão 0); QuickTime v1/v2 têm mais campos
      const ver = dv.getUint16(ent.dados + 8);
      const extra = ver === 1 ? 16 : ver === 2 ? 36 : 0;
      let esds = filhos(dv, ent.dados + 28 + extra, ent.fim).find((c) => c.tipo === "esds");
      if (!esds) { const wave = filhos(dv, ent.dados + 28 + extra, ent.fim).find((c) => c.tipo === "wave"); esds = wave && filho(dv, wave, "esds"); }
      if (!esds) return null;
      // ES_Descriptor(3) -> DecoderConfig(4) -> DecSpecificInfo(5)
      let d = descritor(dv, esds.dados + 4); if (d.tag !== 3) return null;
      let p = d.dados + 2; const fl = dv.getUint8(p++);
      if (fl & 0x80) p += 2; if (fl & 0x40) p += 1 + dv.getUint8(p); if (fl & 0x20) p += 2;
      d = descritor(dv, p); if (d.tag !== 4) return null;
      const oti = dv.getUint8(d.dados); if (oti !== 0x40 && oti !== 0x66 && oti !== 0x67 && oti !== 0x68) return null;
      d = descritor(dv, d.dados + 13); if (d.tag !== 5) return null;
      const asc = lerAsc(dv, d.dados, d.tam); if (!asc) return null;

      // tabela de amostras: tamanhos (stsz), pedaços (stco/co64), amostras por pedaço (stsc), tempos (stts)
      const stsz = filho(dv, stbl, "stsz"), stsc = filho(dv, stbl, "stsc");
      const stco = filho(dv, stbl, "stco"), co64 = filho(dv, stbl, "co64"), stts = filho(dv, stbl, "stts");
      if (!stsz || !stsc || !(stco || co64) || !stts) return null;
      const fixo = dv.getUint32(stsz.dados + 4), nAm = dv.getUint32(stsz.dados + 8);
      if (!nAm) return null;
      const tam = new Uint32Array(nAm);
      for (let i = 0; i < nAm; i++) tam[i] = fixo || dv.getUint32(stsz.dados + 12 + 4 * i);
      const co = co64 || stco, nPed = dv.getUint32(co.dados + 4);
      const offPed = new Float64Array(nPed);
      for (let i = 0; i < nPed; i++) offPed[i] = co64 ? dv.getUint32(co.dados + 8 + 8 * i) * 4294967296 + dv.getUint32(co.dados + 12 + 8 * i) : dv.getUint32(co.dados + 8 + 4 * i);
      const nSc = dv.getUint32(stsc.dados + 4), sc = [];
      for (let i = 0; i < nSc; i++) sc.push([dv.getUint32(stsc.dados + 8 + 12 * i), dv.getUint32(stsc.dados + 12 + 12 * i)]);
      const off = new Float64Array(nAm);
      let a = 0;
      for (let k = 0; k < nSc && a < nAm; k++) {
        const ini = sc[k][0] - 1, fim = k + 1 < nSc ? sc[k + 1][0] - 1 : nPed;
        for (let c = ini; c < fim && c < nPed && a < nAm; c++) {
          let o = offPed[c];
          for (let s = 0; s < sc[k][1] && a < nAm; s++) { off[a] = o; o += tam[a]; a++; }
        }
      }
      if (a < nAm) return null;
      let tot = 0;
      const nTs = dv.getUint32(stts.dados + 4);
      for (let i = 0; i < nTs; i++) tot += dv.getUint32(stts.dados + 8 + 8 * i) * dv.getUint32(stts.dados + 12 + 8 * i);
      const duracao = escala ? tot / escala : 0;
      if (!duracao) return null;
      const porSeg = Math.max(1, Math.round(nAm * LIM.segmento / duracao));
      let i0 = 0;
      return {
        duracao,
        async proximo() {
          if (i0 >= nAm) return null;
          const i1 = Math.min(nAm, i0 + porSeg);
          let total = 0;
          for (let i = i0; i < i1; i++) total += tam[i] + 7;
          const saida = new Uint8Array(total);
          // lê trechos contíguos (num vídeo, o áudio vem intercalado com a imagem)
          let w = 0, i = i0;
          while (i < i1) {
            let j = i + 1, fimB = off[i] + tam[i];
            while (j < i1 && off[j] >= fimB && off[j] - fimB < 65536 && off[j] + tam[j] - off[i] < 8 * 1024 * 1024) { fimB = off[j] + tam[j]; j++; }
            const bloco = new Uint8Array(await ler(file, off[i], fimB));
            for (let s = i; s < j; s++) {
              const L = tam[s] + 7;
              saida[w] = 0xFF; saida[w + 1] = 0xF1;
              saida[w + 2] = ((asc.perfil & 3) << 6) | ((asc.freq & 15) << 2) | ((asc.canais >> 2) & 1);
              saida[w + 3] = ((asc.canais & 3) << 6) | ((L >> 11) & 3);
              saida[w + 4] = (L >> 3) & 0xFF; saida[w + 5] = ((L & 7) << 5) | 0x1F; saida[w + 6] = 0xFC;
              const o = off[s] - off[i];
              if (o + tam[s] > bloco.length) throw erro("abrir");
              saida.set(bloco.subarray(o, o + tam[s]), w + 7);
              w += L;
            }
            i = j;
          }
          i0 = i1;
          return decodificar(saida.buffer);
        },
      };
    }
    return null;
  }

  // ---- MP3: corta o arquivo em pedaços que começam num quadro válido ----
  const MP3_TAXA = [[11025, 12000, 8000], null, [22050, 24000, 16000], [44100, 48000, 32000]];
  const MP3_KBPS = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  };
  function quadroMp3(b, i) { // tamanho do quadro MPEG layer III que começa em i, ou 0
    if (i + 4 > b.length || b[i] !== 0xFF || (b[i + 1] & 0xE0) !== 0xE0) return 0;
    const ver = (b[i + 1] >> 3) & 3, lay = (b[i + 1] >> 1) & 3;
    const br = (b[i + 2] >> 4) & 15, sr = (b[i + 2] >> 2) & 3, pad = (b[i + 2] >> 1) & 1;
    if (ver === 1 || lay !== 1 || br === 0 || br === 15 || sr === 3) return 0;
    const taxa = MP3_TAXA[ver][sr], kbps = MP3_KBPS[ver === 3 ? 1 : 2][br];
    return Math.floor((ver === 3 ? 144000 : 72000) * kbps / taxa) + pad;
  }
  function sincMp3(b, de) { // primeiro i >= de com 3 quadros seguidos válidos
    for (let i = de; i + 4 < b.length; i++) {
      const a = quadroMp3(b, i); if (!a) continue;
      const c = quadroMp3(b, i + a); if (!c) continue;
      if (i + a + c + 4 > b.length || quadroMp3(b, i + a + c)) return i;
    }
    return -1;
  }

  async function fonteMp3(file, duracao) {
    const ini = new Uint8Array(await ler(file, 0, 10));
    let base = 0;
    if (ini[0] === 0x49 && ini[1] === 0x44 && ini[2] === 0x33) base = 10 + ((ini[6] & 127) << 21 | (ini[7] & 127) << 14 | (ini[8] & 127) << 7 | (ini[9] & 127));
    const amostra = new Uint8Array(await ler(file, base, Math.min(file.size, base + 65536)));
    const s0 = sincMp3(amostra, 0);
    if (s0 < 0 || !duracao) return null;
    base += s0;
    const passo = Math.max(256 * 1024, Math.floor((file.size - base) * LIM.segmento / duracao));
    let pos = base;
    return {
      duracao,
      async proximo() {
        if (pos >= file.size) return null;
        let fim = Math.min(file.size, pos + passo);
        if (fim < file.size) { // termina no começo de um quadro
          const b = new Uint8Array(await ler(file, fim, Math.min(file.size, fim + 16384)));
          const s = sincMp3(b, 0);
          fim = s < 0 ? file.size : fim + s;
        }
        const buf = await ler(file, pos, fim);
        pos = fim;
        return decodificar(buf);
      },
    };
  }

  // Qualquer formato: abre o arquivo inteiro (o navegador decide se lê)
  function fonteInteira(file, duracao) {
    let feito = false;
    return {
      duracao,
      async proximo() {
        if (feito) return null; feito = true;
        let buf = await file.arrayBuffer();
        try { return await decodificar(buf); }
        catch (e) {
          if (duracao && duracao > LIM.inteiroSeg) throw erro("abrir", MSG.longoInteiro);
          throw erro("abrir");
        } finally { buf = null; }
      },
    };
  }

  async function abrirFonte(file) {
    const nome = String(file.name || "").toLowerCase(), tipo = String(file.type || "").toLowerCase();
    const dur = await sondarDuracao(file);
    if (dur && dur > LIM.segundos + 1) throw erro("longo");
    let f = null;
    try {
      if (/\.wave?$/.test(nome) || /wav/.test(tipo)) f = await fonteWav(file);
      else if (/\.(m4a|m4b|mp4|m4v|mov|3gp|aac)$/.test(nome) || /mp4|quicktime|m4a|3gpp/.test(tipo)) f = await fonteMp4(file);
      else if (/\.(mp3|mpga)$/.test(nome) || /mpeg|mp3/.test(tipo)) f = await fonteMp3(file, dur);
    } catch (e) { if (e && e.codigo) throw e; f = null; }
    if (!f) {
      // conteúdo manda mais que o nome: tenta WAV e MP4 pelo cabeçalho
      try { f = (await fonteWav(file)) || null; } catch (_) {}
    }
    if (!f) f = fonteInteira(file, dur);
    if (f.duracao && f.duracao > LIM.segundos + 1) throw erro("longo");
    return f;
  }

  /* ================= janelas de até 30 s, cortadas no silêncio ================= */

  function rms(x, a, b) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }

  // Índice de corte da próxima janela que começa em ini (buf tem pelo menos 30 s a partir de ini)
  function pontoDeCorte(buf, ini) {
    const q = SR / 10; // quadros de 100 ms
    let melhor = ini + LIM.janela * SR, menor = Infinity;
    for (let a = ini + LIM.corteMin * SR; a + q <= ini + LIM.janela * SR; a += q / 2) {
      const e = rms(buf, a, a + q);
      if (e < menor) { menor = e; melhor = a + q / 2; }
    }
    return Math.min(buf.length, Math.round(melhor));
  }

  /* ================= limpeza do texto ================= */

  const LIXO = [
    /legendas? (pela|por) comunidade amara\.org/i, /subt[ií]tulos? (realizados? )?por la comunidad de amara\.org/i,
    /^(obrigad[oa]|gracias)( por (assistir|ver|ver el video))?[.!]*$/i, /^\[?(m[uú]sica|music|aplausos)\]?\.?$/i,
    /^\(?(risas|risos)\)?\.?$/i, /amara\.org/i,
  ];
  function limpar(t) {
    t = String(t || "").replace(/\s+/g, " ").trim();
    if (!t) return "";
    if (LIXO.some((r) => r.test(t))) return "";
    // laço de repetição do Whisper: mesma frase/palavras repetidas muitas vezes seguidas
    t = t.replace(/(\b[^.!?]{2,80}?[.!?,]?\s+)\1{3,}/gi, "$1");
    t = t.replace(/\b(\w+)(\s+\1\b){4,}/gi, "$1");
    t = t.replace(/\b(\w{1,8})(-\1){3,}-?/gi, "$1");
    return t.trim();
  }

  /* ================= trabalhador e fila ================= */

  let worker = null, pronto = null, falharPronto = null, dispositivo = null, emCache = null;
  let atual = null;    // {rejeitar, cancelado}
  let fila = Promise.resolve();
  let seq = 0;
  const espera = new Map();
  let ouvinteDownload = null;

  function urlWorker() {
    try { return new URL("transcrever-worker.js", SCRIPT || (g.location && g.location.href) || "").href; }
    catch (_) { return "/assets/transcrever-worker.js"; }
  }

  function matarWorker(motivo) {
    if (worker) { try { worker.terminate(); } catch (_) {} }
    worker = null; pronto = null;
    if (falharPronto) { const f = falharPronto; falharPronto = null; f(motivo); }
    for (const [, p] of espera) p.no(motivo);
    espera.clear();
  }

  function garantirWorker() {
    if (pronto) return pronto;
    const c = cfg();
    try { worker = new Worker(urlWorker(), { type: "module" }); }
    catch (e) { return Promise.reject(erro("suporte")); }
    pronto = new Promise((ok, no) => {
      falharPronto = no;
      worker.onmessage = (e) => {
        const m = e.data || {};
        if (m.tipo === "cache") emCache = m.emCache;
        else if (m.tipo === "baixando") { if (ouvinteDownload) ouvinteDownload(m.carregado, m.total); }
        else if (m.tipo === "pronto") { dispositivo = m.dispositivo; falharPronto = null; ok(dispositivo); }
        else if (m.tipo === "texto" || m.tipo === "idioma") { const p = espera.get(m.id); if (p) { espera.delete(m.id); p.ok(m); } }
        else if (m.tipo === "erro") {
          if (m.fase === "carregar") {
            const rede = /fetch|network|load|import|404|403|Failed/i.test(m.msg || "");
            const e2 = erro("modelo", rede ? MSG.modelo : MSG.modelo + " (" + m.msg + ")");
            matarWorker(e2); no(e2);
          } else { const p = espera.get(m.id); if (p) { espera.delete(m.id); p.no(Object.assign(erro("falha"), { detalhe: m.msg })); } }
        }
      };
      worker.onerror = (e) => {
        const e2 = erro("suporte", MSG.suporte + (e && e.message ? " (" + e.message + ")" : ""));
        if (e && e.preventDefault) e.preventDefault();
        matarWorker(e2); no(e2);
      };
      worker.postMessage({ tipo: "carregar", url: c.url, modelo: c.modelo, dtypeWasm: c.dtypeWasm, dtypeGpu: c.dtypeGpu, gpu: c.gpu });
    });
    pronto.catch(() => {});
    return pronto;
  }

  function pedir(tipo, audio, idioma) {
    return new Promise((ok, no) => {
      if (!worker) return no(erro("falha"));
      const id = ++seq;
      espera.set(id, { ok, no });
      const a = tipo === "idioma" ? audio.slice() : audio; // o idioma é medido numa cópia (a janela ainda vai ser ouvida)
      worker.postMessage({ tipo, id, audio: a, idioma: idioma || null }, [a.buffer]);
    });
  }
  const ouvir = (audio, idioma) => pedir("ouvir", audio, idioma);
  const medirIdioma = (audio) => pedir("idioma", audio);

  /* ================= a transcrição ================= */

  function fmtTempo(feito, total) {
    if (total < 120) return Math.min(Math.round(feito), Math.round(total)) + " de " + Math.round(total) + " s";
    return Math.min(Math.floor(feito / 60), Math.ceil(total / 60)) + " de " + Math.ceil(total / 60) + " min";
  }

  async function executar(file, onProgress, opcoes, estado) {
    const avisa = (() => {
      let ult = 0, ultMsg = "";
      return (f, msg) => {
        f = Math.max(ult, Math.min(1, f));
        if (msg === ultMsg && f - ult < 0.01 && f < 1) return;
        ult = f; ultMsg = msg;
        if (typeof onProgress === "function") { try { onProgress(ult, msg); } catch (_) {} }
      };
    })();
    const vivo = () => { if (estado.cancelado) throw erro("cancelado"); };

    if (!ambienteOk()) throw erro("suporte");
    if (!file || typeof file.arrayBuffer !== "function") throw erro("formato");
    if (file.size > LIM.bytes) throw erro("grande");
    if (!suportado(file)) throw erro("formato");
    let idioma = opcoes && /^(pt|es)$/.test(opcoes.idioma) ? opcoes.idioma : null;

    avisa(0, "Abrindo o arquivo…");
    const fonte = await abrirFonte(file);
    vivo();

    // modelo (em paralelo com o primeiro pedaço de áudio)
    const F_MOD = 0.2;
    ouvinteDownload = (c, t) => {
      if (estado.cancelado || !t) return;
      const pct = Math.min(99, Math.floor(c / t * 100));
      avisa(0.01 + F_MOD * (c / t), emCache ? "Preparando o modelo de voz… " + pct + "%" : "Baixando o modelo de voz (só na primeira vez)… " + pct + "%");
    };
    if (!pronto) avisa(0.01, "Preparando o modelo de voz…");
    const carregando = garantirWorker();
    let pedaco = fonte.proximo();
    pedaco.catch(() => {});
    await carregando;
    ouvinteDownload = null;
    vivo();

    let duracao = fonte.duracao || 0;
    const partes = [];
    const votos = { pt: 0, es: 0 };
    const fixado = idioma, guardadas = [];
    let janelasDetec = 0, feitoSeg = 0, carry = new Float32Array(0), fimFonte = false, amostras = 0;
    const msgOuvindo = () => "Ouvindo o áudio… " + fmtTempo(feitoSeg, Math.max(duracao, feitoSeg));
    avisa(F_MOD + 0.01, msgOuvindo());

    while (!fimFonte || carry.length) {
      // completa o buffer até ter 30 s (ou acabar a fonte)
      while (!fimFonte && carry.length < LIM.janela * SR) {
        let seg;
        try { seg = await pedaco; }
        catch (e) { if (e && e.codigo) throw e; throw erro("abrir"); }
        vivo();
        if (!seg) { fimFonte = true; break; }
        amostras += seg.length;
        if (!fonte.duracao) duracao = amostras / SR;
        const junto = new Float32Array(carry.length + seg.length);
        junto.set(carry); junto.set(seg, carry.length);
        carry = junto;
        pedaco = fonte.proximo(); pedaco.catch(() => {});
      }
      if (!carry.length) break;
      const corte = carry.length > LIM.janela * SR ? pontoDeCorte(carry, 0) : carry.length;
      const janela = carry.slice(0, corte);
      carry = carry.slice(corte);
      const seg = janela.length / SR;

      if (rms(janela, 0, janela.length) >= LIM.silencio && seg >= 0.3) {
        if (!idioma) {
          // o idioma é decidido nas 3 primeiras janelas com fala (ou antes, se a 1ª for clara)
          // e só depois elas são transcritas, todas no mesmo idioma
          const r = await medirIdioma(janela);
          vivo();
          if (r.pontos) { votos.pt += Math.log(r.pontos.pt + 1e-9); votos.es += Math.log(r.pontos.es + 1e-9); }
          janelasDetec++;
          guardadas.push(janela);
          if (janelasDetec >= 3 || Math.abs(votos.pt - votos.es) > 3) idioma = votos.pt >= votos.es ? "pt" : "es";
        } else guardadas.push(janela);
        if (idioma) {
          for (const j of guardadas.splice(0)) {
            const r = await ouvir(j, idioma);
            vivo();
            const t = limpar(r.texto);
            if (t) partes.push(t);
          }
        }
      }
      feitoSeg += seg;
      avisa(F_MOD + (1 - F_MOD) * Math.min(0.99, feitoSeg / Math.max(duracao, feitoSeg, 1)), msgOuvindo());
    }
    if (guardadas.length) { // arquivo curto: menos de 3 janelas com fala
      idioma = votos.pt >= votos.es ? "pt" : "es";
      for (const j of guardadas.splice(0)) { const r = await ouvir(j, idioma); vivo(); const t = limpar(r.texto); if (t) partes.push(t); }
    }
    duracao = amostras / SR || duracao;
    if (duracao > LIM.segundos + 1) throw erro("longo");
    const idiomaFinal = fixado || idioma || "pt";
    avisa(1, "Pronto.");
    return { texto: partes.join("\n\n"), idioma: idiomaFinal, duracao: Math.round(duracao * 10) / 10 };
  }

  function arquivo(file, onProgress, opcoes) {
    const estado = { cancelado: false, rejeitar: null };
    const p = new Promise((ok, no) => {
      estado.rejeitar = no;
      fila = fila.then(async () => {
        if (estado.cancelado) return;
        atual = estado;
        try { ok(await executar(file, onProgress, opcoes, estado)); }
        catch (e) { no(estado.cancelado ? erro("cancelado") : (e && e.codigo ? e : Object.assign(erro("falha"), { detalhe: String(e && e.message || e) }))); }
        finally { if (atual === estado) atual = null; ouvinteDownload = null; }
      });
    });
    estado.promessa = p;
    pendentes.add(estado);
    p.then(() => pendentes.delete(estado), () => pendentes.delete(estado));
    return p;
  }
  const pendentes = new Set();

  function cancelar() {
    const algum = pendentes.size > 0;
    for (const e of pendentes) { e.cancelado = true; if (e.rejeitar) e.rejeitar(erro("cancelado")); }
    // para o Whisper no meio da janela: o trabalhador é encerrado (o modelo fica no cache e volta rápido)
    if (algum) matarWorker(erro("cancelado"));
    return algum;
  }

  g.Transcrever = {
    suportado, arquivo, cancelar,
    LIMITES: { bytes: LIM.bytes, segundos: LIM.segundos },
    // para testes: o que roda sem modelo
    _interno: { abrirFonte, pontoDeCorte, limpar, decodificar, reamostrar, SR, LIM, dispositivo: () => dispositivo },
  };
})(typeof window !== "undefined" ? window : globalThis);
