// Leitura do texto dos arquivos de estudo, toda no navegador (a função do Supabase tem ~2 s de CPU).
// Usado pelo painel (Enviar arquivos e material do Drive lido quando falta). Roda também no Node (testes).
//
//   Extrair.tipoDoArquivo(nome, mime) -> {tipo, mime} | {tipo:"imagem"|"video"|"audio", semTexto:true, mime} | null
//   Extrair.extrair(bytes, {tipo, nome, carregarJSZip, carregarPdfjs, prog}) -> {texto, paginas, formato, aviso}
//   Extrair.naoAceito(nome) -> mensagem amigável para um arquivo que o site não lê
//   Extrair.ACCEPT (lista para <input type=file accept>)   Extrair.FORMATOS_TEXTO (para os textos de ajuda)
//
// Formatos: PDF; PowerPoint .pptx/.ppsx/.potx/.pptm e o antigo .ppt/.pps; Word .docx/.dotx/.docm e o antigo .doc;
// Excel .xlsx/.xlsm e o antigo .xls; OpenDocument .odp/.odt/.ods; .rtf; .csv; .html/.htm; .txt/.md.
// Os antigos (.ppt/.doc/.xls) são arquivos "OLE2/CFB": um sistema de arquivos dentro do arquivo. O leitor
// abaixo confere cada índice de setor, corta laços e limita a memória (o conteúdo é de fora: não confiamos nele).
// Erros lançados têm .codigo ("senha" | "corrompido" | "grande" | "formato" | "vazio") e mensagem para o aluno.
(function (g) {
  "use strict";
  const LIM = {
    bytes: 100 * 1024 * 1024,     // o painel já recusa acima de 80 MB
    zipEntradas: 5000,            // partes dentro de um .pptx/.docx/.odt
    zipEntrada: 40 * 1024 * 1024, // cada parte descompactada
    zipTotal: 160 * 1024 * 1024,  // soma do que foi descompactado (contra "zip bomb")
    cfbDir: 50000,                // entradas no diretório do arquivo antigo
    registros: 3000000,           // registros lidos num .ppt/.xls
    profundidade: 48,
    letras: 2000000,              // o banco guarda até 300 mil; aqui só evita juntar texto sem fim
    slides: 3000, celulas: 300000, sst: 1000000,
  };
  const MSG = {
    senha: "Este arquivo tem senha. Abra no programa, tire a senha (ou salve uma cópia sem senha) e envie de novo.",
    corrompido: "Não consegui abrir este arquivo: parece corrompido ou incompleto. Abra no programa, salve de novo (ou exporte como PDF) e envie outra vez.",
    grande: "Este arquivo é grande demais para ler aqui (o conteúdo descompactado passa do limite). Divida em partes ou exporte como PDF.",
    vazio: "O arquivo está vazio.",
    texto: "Este arquivo não parece ser de texto. Confira se a extensão está certa.",
  };
  const erro = (codigo, msg) => Object.assign(new Error(msg || MSG[codigo] || MSG.corrompido), { codigo });

  /* ================= tipos de arquivo ================= */
  const M = {
    pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", html: "text/html", rtf: "application/rtf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint", doc: "application/msword", xls: "application/vnd.ms-excel",
    odp: "application/vnd.oasis.opendocument.presentation", odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet",
  };
  // extensão -> [tipo de leitura, mime gravado no banco]
  const EXT = {
    pdf: ["pdf", M.pdf],
    pptx: ["pptx", M.pptx], pptm: ["pptx", M.pptx], ppsx: ["pptx", M.pptx], ppsm: ["pptx", M.pptx], potx: ["pptx", M.pptx], potm: ["pptx", M.pptx],
    ppt: ["ppt", M.ppt], pps: ["ppt", M.ppt], pot: ["ppt", M.ppt],
    docx: ["docx", M.docx], docm: ["docx", M.docx], dotx: ["docx", M.docx], dotm: ["docx", M.docx],
    doc: ["doc", M.doc], dot: ["doc", M.doc],
    xlsx: ["xlsx", M.xlsx], xlsm: ["xlsx", M.xlsx], xltx: ["xlsx", M.xlsx], xltm: ["xlsx", M.xlsx],
    xls: ["xls", M.xls], xlt: ["xls", M.xls],
    odp: ["odp", M.odp], otp: ["odp", M.odp], odt: ["odt", M.odt], ott: ["odt", M.odt], ods: ["ods", M.ods], ots: ["ods", M.ods],
    rtf: ["rtf", M.rtf], csv: ["csv", M.csv], tsv: ["csv", M.csv],
    html: ["html", M.html], htm: ["html", M.html], xhtml: ["html", M.html],
    txt: ["txt", M.txt], text: ["txt", M.txt], md: ["txt", M.md], markdown: ["txt", M.md],
  };
  // mime (do navegador ou do Google Drive) -> tipo de leitura
  const MIME = {
    [M.pdf]: "pdf", [M.pptx]: "pptx", [M.docx]: "docx", [M.xlsx]: "xlsx", [M.ppt]: "ppt", [M.doc]: "doc", [M.xls]: "xls",
    [M.odp]: "odp", [M.odt]: "odt", [M.ods]: "ods", [M.rtf]: "rtf", "text/rtf": "rtf", [M.csv]: "csv", "text/tab-separated-values": "csv",
    [M.html]: "html", "application/xhtml+xml": "html", [M.txt]: "txt", [M.md]: "txt", "text/x-markdown": "txt",
    "application/vnd.openxmlformats-officedocument.presentationml.slideshow": "pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.template": "pptx",
    "application/vnd.ms-powerpoint.presentation.macroenabled.12": "pptx", "application/vnd.ms-powerpoint.slideshow.macroenabled.12": "pptx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.template": "docx", "application/vnd.ms-word.document.macroenabled.12": "docx",
    "application/vnd.ms-excel.sheet.macroenabled.12": "xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.template": "xlsx",
    "application/vnd.oasis.opendocument.presentation-template": "odp", "application/vnd.oasis.opendocument.text-template": "odt",
    // Google Docs/Slides/Sheets: o Drive entrega exportado como texto (Planilhas como .csv)
    "application/vnd.google-apps.document": "txt", "application/vnd.google-apps.presentation": "txt", "application/vnd.google-apps.spreadsheet": "csv",
  };
  const IMAGEM = /^(jpe?g|jfif|png|gif|webp|heic|heif|bmp|tiff?|svg|avif)$/, VIDEO = /^(mp4|m4v|mov|avi|mkv|webm|wmv|3gp|mpe?g|flv)$/, AUDIO = /^(mp3|m4a|wav|ogg|oga|aac|flac|opus|wma)$/;
  const extDe = (nome) => ((String(nome || "").match(/\.([a-z0-9]{1,10})$/i) || [])[1] || "").toLowerCase();
  function tipoDoArquivo(nome, mime) {
    const ext = extDe(nome), mm = String(mime || "").toLowerCase().split(";")[0].trim();
    if (EXT[ext]) return { tipo: EXT[ext][0], mime: EXT[ext][1] };
    if (MIME[mm]) { const t = MIME[mm]; return { tipo: t, mime: /google-apps/.test(mm) ? mm : (EXT[t] ? EXT[t][1] : mm) }; }
    if (IMAGEM.test(ext) || /^image\//.test(mm)) return { tipo: "imagem", semTexto: true, mime: mm || "image/" + ext };
    if (VIDEO.test(ext) || /^video\//.test(mm)) return { tipo: "video", semTexto: true, mime: mm || "video/" + ext };
    if (AUDIO.test(ext) || /^audio\//.test(mm)) return { tipo: "audio", semTexto: true, mime: mm || "audio/" + ext };
    return null;
  }
  const FORMATOS_TEXTO = "PDF, PowerPoint (.ppt, .pps, .pptx, .ppsx), Word (.doc, .docx), Excel (.xls, .xlsx), OpenDocument (.odp, .odt, .ods), .rtf, .csv, .html, .txt e .md";
  const ACCEPT = Object.keys(EXT).map((e) => "." + e).join(",") + "," + [M.pdf, M.pptx, M.docx, M.xlsx, M.ppt, M.doc, M.xls, M.odp, M.odt, M.ods, M.rtf, "text/rtf", M.csv, M.html, M.txt, M.md].join(",");
  /** Mensagem para quem mandou um arquivo que o site não lê (ou que não tem texto). */
  function naoAceito(nome, mime) {
    const t = tipoDoArquivo(nome, mime), ext = extDe(nome);
    if (t && t.tipo === "imagem") return "Imagem não tem texto para ler: o site não lê fotos nem prints. Se for um slide, envie o PowerPoint ou o PDF; fotos de lâminas vão no Laminário.";
    if (t && t.tipo === "video") return "Vídeo não tem texto para ler. Se a aula tem slides, envie o PowerPoint ou o PDF.";
    if (t && t.tipo === "audio") return "Áudio não tem texto para ler. Se a aula tem slides, envie o PowerPoint ou o PDF.";
    if (/^(key|pages|numbers)$/.test(ext)) return "Arquivo do Keynote/Pages/Numbers (Mac): exporte como PowerPoint, Word ou PDF e envie de novo.";
    if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return "Arquivo compactado: descompacte e envie os arquivos de dentro.";
    if (ext === "epub") return "EPUB é livro: use Meus livros.";
    return `Tipo de arquivo não aceito. Use ${FORMATOS_TEXTO}.`;
  }

  /* ================= texto: decodificação ================= */
  // Windows-1252 (0x80–0x9F); o resto é igual ao Latin-1
  const CP1252 = [0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
    0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178];
  const ch1252 = (b) => b >= 0x80 && b <= 0x9F ? CP1252[b - 0x80] : b;
  function cp1252(u8, ini = 0, fim = u8.length) {
    let s = ""; const pedaco = [];
    for (let i = ini; i < fim; i++) { pedaco.push(ch1252(u8[i])); if (pedaco.length >= 8192) { s += String.fromCharCode.apply(null, pedaco); pedaco.length = 0; } }
    return s + String.fromCharCode.apply(null, pedaco);
  }
  function utf16le(u8, ini = 0, fim = u8.length) {
    let s = ""; const pedaco = [];
    for (let i = ini; i + 1 < fim; i += 2) { pedaco.push(u8[i] | (u8[i + 1] << 8)); if (pedaco.length >= 8192) { s += String.fromCharCode.apply(null, pedaco); pedaco.length = 0; } }
    return s + String.fromCharCode.apply(null, pedaco);
  }
  const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
  const utf8 = (u8) => new TextDecoder("utf-8").decode(u8);
  /** Bytes de um arquivo de texto -> string (BOM, UTF-8, UTF-16 ou Windows-1252). */
  function decodificar(u8, dica) {
    if (u8.length >= 3 && u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return utf8(u8.subarray(3));
    if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return utf16le(u8, 2);
    if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) { const t = new Uint8Array(u8.length - 2); for (let i = 2; i + 1 < u8.length; i += 2) { t[i - 2] = u8[i + 1]; t[i - 1] = u8[i]; } return utf16le(t); }
    // UTF-16 sem BOM: muitos zeros nas posições ímpares
    const n = Math.min(u8.length, 4000); let z = 0; for (let i = 1; i < n; i += 2) if (u8[i] === 0) z++;
    if (n >= 8 && z > n / 2 * 0.6) return utf16le(u8);
    if (dica && /^(windows-1252|iso-8859-1|latin1|us-ascii|cp1252|iso-8859-15)$/i.test(dica)) return cp1252(u8);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(u8); } catch (_) { return cp1252(u8); }
  }
  /** Texto que veio de um arquivo "de texto" mas é binário (renomeado): muitos caracteres de controle. */
  function pareceTexto(s) {
    const a = s.slice(0, 20000); if (!a) return true;
    let ruins = 0; for (let i = 0; i < a.length; i++) { const c = a.charCodeAt(i); if ((c < 32 && c !== 9 && c !== 10 && c !== 13 && c !== 12) || c === 0xFFFD) ruins++; }
    return ruins / a.length < 0.05;
  }
  const corta = (s) => s.length > LIM.letras ? s.slice(0, LIM.letras) : s;

  /* ================= XML (Office/OpenDocument) ================= */
  const NOMEADAS = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”",
    lsquo: "‘", rsquo: "’", bull: "•", middot: "·", deg: "°", ordm: "º", ordf: "ª", iexcl: "¡", iquest: "¿", euro: "€", copy: "©", reg: "®", trade: "™", times: "×",
    divide: "÷", micro: "µ", plusmn: "±", sup2: "²", sup3: "³", frac12: "½", frac14: "¼", frac34: "¾", szlig: "ß", aelig: "æ", AElig: "Æ", oslash: "ø", Oslash: "Ø", shy: "", larr: "←", rarr: "→", uarr: "↑", darr: "↓", alpha: "α", beta: "β", gamma: "γ", delta: "δ", mu: "μ", pi: "π" };
  const DIAC = { acute: "́", grave: "̀", circ: "̂", tilde: "̃", uml: "̈", cedil: "̧", ring: "̊" };
  const ponto = (n) => (n > 0 && n <= 0x10FFFF && !(n >= 0xD800 && n <= 0xDFFF)) ? String.fromCodePoint(n) : "";
  function entidade(nome) {
    if (nome[0] === "#") return nome[1] === "x" || nome[1] === "X" ? ponto(parseInt(nome.slice(2), 16)) : ponto(parseInt(nome.slice(1), 10));
    if (Object.prototype.hasOwnProperty.call(NOMEADAS, nome)) return NOMEADAS[nome];
    const m = nome.match(/^([A-Za-z])(acute|grave|circ|tilde|uml|cedil|ring)$/);
    if (m) { const c = (m[1] + DIAC[m[2]]).normalize("NFC"); if (c.length === 1) return c; }
    return null;
  }
  const desfazEntidades = (s) => s.indexOf("&") < 0 ? s : s.replace(/&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,10});/g, (t, n) => { const r = entidade(n); return r === null ? t : r; });
  /** Texto de um XML do Office: tag = "a:t" (PowerPoint) ou "w:t" (Word); parágrafo = "a:p" ou "w:p". */
  function textoDoXml(xml, tag, par) {
    const linhas = [], pre = tag.split(":")[0];
    const reT = new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>|<${pre}:tab\\s*/>|<${pre}:br\\s*/>`, "g");
    for (const p of xml.split(`</${par}>`)) {
      let l = ""; for (const m of p.matchAll(reT)) l += m[1] !== undefined ? desfazEntidades(m[1]) : m[0].includes("tab") ? "\t" : "\n";
      if (l.trim()) linhas.push(l.trimEnd());
    }
    return linhas.join("\n");
  }
  const atributo = (tag, nome) => { const m = tag.match(new RegExp(`\\s${nome.replace(":", "\\:")}\\s*=\\s*"([^"]*)"`)); return m ? desfazEntidades(m[1]) : null; };
  /** Relationships (.rels) -> Map(Id -> {alvo, tipo}) */
  function relacoes(xml) {
    const m = new Map(); if (!xml) return m;
    for (const t of xml.match(/<Relationship\b[^>]*>/g) || []) { const id = atributo(t, "Id"), alvo = atributo(t, "Target"); if (id && alvo) m.set(id, { alvo, tipo: atributo(t, "Type") || "", externo: atributo(t, "TargetMode") === "External" }); }
    return m;
  }
  function resolver(base, alvo) {
    if (alvo.startsWith("/")) return alvo.slice(1);
    const partes = base.split("/"); partes.pop();
    for (const p of alvo.split("/")) { if (p === "..") partes.pop(); else if (p && p !== ".") partes.push(p); }
    return partes.join("/");
  }

  /* ================= ZIP (OOXML e OpenDocument) com guarda contra "zip bomb" ================= */
  async function abrirZip(JSZip, u8) {
    let zip;
    try { zip = await JSZip.loadAsync(u8, { checkCRC32: false }); } catch (_) { throw erro("corrompido"); }
    const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
    if (nomes.length > LIM.zipEntradas) throw erro("grande");
    let total = 0;
    async function bytes(nome) {
      const f = zip.file(nome); if (!f) return null;
      const declarado = f._data && f._data.uncompressedSize;
      if (declarado > LIM.zipEntrada || total + (declarado || 0) > LIM.zipTotal) throw erro("grande");
      const partes = []; let n = 0;
      await new Promise((ok, falha) => {
        let acabou = false; const fim = (fn, x) => { if (!acabou) { acabou = true; fn(x); } };
        let h;
        try { h = f.internalStream("uint8array"); } catch (_) { return fim(falha, erro("corrompido")); }
        h.on("data", (c) => {
          if (acabou) return;
          n += c.length; total += c.length;
          if (n > LIM.zipEntrada || total > LIM.zipTotal) { try { h.pause(); } catch (_) { } return fim(falha, erro("grande")); }
          partes.push(c);
        }).on("error", () => fim(falha, erro("corrompido"))).on("end", () => fim(ok)).resume();
      });
      const out = new Uint8Array(n); let o = 0; for (const p of partes) { out.set(p, o); o += p.length; }
      return out;
    }
    return { nomes, tem: (n) => !!zip.file(n), bytes, texto: async (n) => { const b = await bytes(n); return b ? utf8(b) : null; } };
  }
  async function textoPptx(z, prog) {
    const pres = await z.texto("ppt/presentation.xml");
    const rels = relacoes(await z.texto("ppt/_rels/presentation.xml.rels"));
    let slides = [];
    if (pres) for (const t of pres.match(/<p:sldId\b[^>]*>/g) || []) { const r = rels.get(atributo(t, "r:id")); if (r && !r.externo) slides.push(resolver("ppt/presentation.xml", r.alvo)); }
    slides = slides.filter((s) => z.tem(s));
    if (!slides.length) slides = z.nomes.map((n) => ({ n, m: n.match(/^ppt\/slides\/slide(\d+)\.xml$/) })).filter((x) => x.m).sort((a, b) => +a.m[1] - +b.m[1]).map((x) => x.n);
    slides = slides.slice(0, LIM.slides);
    const out = []; let letras = 0;
    for (let i = 0; i < slides.length && letras < LIM.letras; i++) {
      const s = slides[i];
      let t = textoDoXml(await z.texto(s), "a:t", "a:p");
      const rs = relacoes(await z.texto(s.replace(/([^/]+)$/, "_rels/$1.rels")));
      for (const r of rs.values()) {
        if (!/\/notesSlide$/.test(r.tipo) || r.externo) continue;
        const nx = await z.texto(resolver(s, r.alvo)); if (!nx) continue;
        const notas = textoDoXml(nx, "a:t", "a:p").split("\n").filter((l) => l.trim() && !/^\s*\d{1,4}\s*$/.test(l)).join("\n");
        if (notas) t += (t ? "\n" : "") + "Notas: " + notas;
      }
      if (t.trim()) { out.push(`Slide ${i + 1}\n${t}`); letras += t.length; }
      prog((i + 1) / slides.length, `Lendo o slide ${i + 1} de ${slides.length}…`);
    }
    return { texto: out.join("\n\n"), paginas: slides.length };
  }
  async function textoDocx(z, prog) {
    const doc = await z.texto("word/document.xml"); prog(1, "Texto lido.");
    if (!doc) throw erro("corrompido");
    let t = textoDoXml(doc, "w:t", "w:p");
    const rodape = await z.texto("word/footnotes.xml");
    if (rodape) { const r = textoDoXml(rodape, "w:t", "w:p"); if (r.trim()) t += "\n\nNotas de rodapé:\n" + r; }
    return { texto: t, paginas: null };
  }
  async function textoXlsx(z, prog) {
    const sst = [];
    const ss = await z.texto("xl/sharedStrings.xml");
    if (ss) for (const si of ss.split("</si>")) {
      if (sst.length >= LIM.sst) break;
      const a = si.indexOf("<si"); if (a < 0) continue;
      const corpo = si.slice(a).replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
      let s = ""; for (const m of corpo.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) s += desfazEntidades(m[1]);
      sst.push(s);
    }
    const wb = await z.texto("xl/workbook.xml"), rels = relacoes(await z.texto("xl/_rels/workbook.xml.rels"));
    let folhas = [];
    if (wb) for (const t of wb.match(/<sheet\b[^>]*>/g) || []) { const r = rels.get(atributo(t, "r:id")); if (r && !r.externo) folhas.push({ nome: atributo(t, "name") || "", arq: resolver("xl/workbook.xml", r.alvo) }); }
    folhas = folhas.filter((f) => z.tem(f.arq));
    if (!folhas.length) folhas = z.nomes.map((n) => ({ n, m: n.match(/^xl\/worksheets\/sheet(\d+)\.xml$/) })).filter((x) => x.m).sort((a, b) => +a.m[1] - +b.m[1]).map((x) => ({ nome: "", arq: x.n }));
    const out = []; let celulas = 0;
    for (let i = 0; i < folhas.length && celulas < LIM.celulas; i++) {
      const xml = await z.texto(folhas[i].arq) || ""; const linhas = [];
      for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
        const vals = [];
        for (const c of (r[1] || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          if (++celulas > LIM.celulas) break;
          const tp = atributo(c[1], "t"), corpo = c[2] || ""; let v = "";
          if (tp === "inlineStr") { for (const m of corpo.matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g)) v += desfazEntidades(m[1]); }
          else { const m = corpo.match(/<v>([^<]*)<\/v>/); v = m ? desfazEntidades(m[1]) : ""; if (tp === "s") v = sst[+v] ?? ""; else if (tp === "b") v = v === "1" ? "VERDADEIRO" : "FALSO"; else if (tp === "e") v = ""; }
          if (v.trim()) vals.push(v.replace(/[\t\r\n]+/g, " ").trim());
        }
        if (vals.length) linhas.push(vals.join("\t"));
      }
      if (linhas.length) out.push(`Planilha: ${folhas[i].nome || i + 1}\n${linhas.join("\n")}`);
      prog((i + 1) / folhas.length, `Lendo a planilha ${i + 1} de ${folhas.length}…`);
    }
    return { texto: out.join("\n\n"), paginas: folhas.length || null };
  }
  /** OpenDocument (.odt/.odp/.ods): content.xml, parágrafos, células e páginas (slides). */
  async function textoOdf(z, prog) {
    const man = await z.texto("META-INF/manifest.xml");
    if (man && /encryption-data/.test(man)) throw erro("senha");
    const xml = await z.texto("content.xml"); if (!xml) throw erro("corrompido");
    prog(0.5, "Lendo o texto…");
    const out = []; let pagina = 0, pular = 0, celula = 0;
    // tags com prefixo (text:p, table:table-cell...); o resto (<?xml?>, comentários) é ignorado
    const re = /<(\/?)([A-Za-z][\w.-]*:[\w.-]+)([^>]*?)(\/?)>|<[^>]*>|([^<]+)/g;
    let m, letras = 0;
    while ((m = re.exec(xml)) && letras < LIM.letras) {
      if (m[2] === undefined && m[5] === undefined) continue;
      if (m[5] !== undefined) { if (!pular) { const s = desfazEntidades(m[5]); out.push(s); letras += s.length; } continue; }
      const fecha = m[1] === "/", nome = m[2], vazio = m[4] === "/";
      if (nome === "text:tracked-changes" || nome === "office:annotation" || nome === "text:page-number" || nome === "text:page-count") { if (!vazio) pular += fecha ? -1 : 1; if (pular < 0) pular = 0; continue; }
      if (pular) continue;
      if (fecha) {
        if (nome === "text:p" || nome === "text:h") out.push(celula ? " " : "\n");
        else if (nome === "table:table-row") out.push("\n");
        else if (nome === "table:table-cell" || nome === "table:covered-table-cell") { celula = Math.max(0, celula - 1); out.push("\t"); }
        continue;
      }
      if ((nome === "table:table-cell" || nome === "table:covered-table-cell")) { if (vazio) out.push("\t"); else celula++; continue; }
      if (nome === "text:s") out.push(" ".repeat(Math.min(50, +(atributo(m[3], "text:c") || 1) || 1)));
      else if (nome === "text:tab") out.push("\t");
      else if (nome === "text:line-break") out.push("\n");
      else if (nome === "draw:page") out.push(`\n\nSlide ${++pagina}\n`);
      else if (nome === "presentation:notes") out.push("\nNotas: ");
      else if (nome === "table:table" && !/presentation/.test(m[3])) { const nm = atributo(m[3], "table:name"); if (nm && !pagina) out.push(`\nPlanilha: ${nm}\n`); }
    }
    const t = out.join("").replace(/\nNotas: \s*(?=\n\nSlide|\s*$)/g, "").replace(/ +\t/g, "\t").replace(/\t+\n/g, "\n").replace(/[ \t]+$/gm, "");
    return { texto: t.replace(/^\s+/, ""), paginas: pagina || null };
  }
  async function doZip(u8, op, prog) {
    const JSZip = await op.carregarJSZip();
    const z = await abrirZip(JSZip, u8);
    if (z.tem("ppt/presentation.xml") || z.nomes.some((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) return { formato: "pptx", ...(await textoPptx(z, prog)) };
    if (z.tem("word/document.xml")) return { formato: "docx", ...(await textoDocx(z, prog)) };
    if (z.tem("xl/workbook.xml")) return { formato: "xlsx", ...(await textoXlsx(z, prog)) };
    if (z.tem("content.xml") || z.tem("mimetype")) {
      const mt = (await z.texto("mimetype") || "").trim();
      return { formato: /presentation/.test(mt) ? "odp" : /spreadsheet/.test(mt) ? "ods" : "odt", ...(await textoOdf(z, prog)) };
    }
    if (z.tem("META-INF/container.xml")) throw erro("formato", "EPUB é livro: use Meus livros.");
    throw erro("formato", "Este arquivo é um .zip que não é do Office nem do OpenDocument. Descompacte e envie os arquivos de dentro.");
  }

  /* ================= CFB / OLE2 (os .ppt, .doc e .xls antigos) ================= */
  const FIM = 0xFFFFFFFE, LIVRE = 0xFFFFFFFF;
  const ASSINATURA = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  const ehCFB = (u8) => u8.length >= 8 && ASSINATURA.every((b, i) => u8[i] === b);
  /** Lê o "sistema de arquivos" de dentro de um arquivo antigo do Office. Valida tudo; lança erro("corrompido"). */
  function lerCFB(u8) {
    if (u8.length < 512 || !ehCFB(u8)) throw erro("corrompido");
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
    const sh = u16(0x1E); if (sh !== 9 && sh !== 12) throw erro("corrompido");
    const ss = 1 << sh;
    if (u16(0x20) !== 6) throw erro("corrompido");
    const nSet = Math.ceil((u8.length - ss) / ss); if (nSet <= 0) throw erro("corrompido");
    const offSet = (s) => (s + 1) * ss;
    const nFat = u32(0x2C), dir0 = u32(0x30), corte = u32(0x38), mf0 = u32(0x3C), nMf = u32(0x40), dif0 = u32(0x44), nDif = u32(0x48);
    if (nFat > nSet || nMf > nSet || nDif > nSet) throw erro("corrompido");
    // DIFAT: onde estão os setores da FAT
    const fatSet = [];
    for (let i = 0; i < 109 && fatSet.length < nFat; i++) { const s = u32(0x4C + 4 * i); if (s !== LIVRE) fatSet.push(s); }
    let d = dif0, voltas = 0;
    while (fatSet.length < nFat && d !== FIM && d !== LIVRE) {
      if (d >= nSet || ++voltas > nDif + 1 || offSet(d) + ss > u8.length) throw erro("corrompido");
      const o = offSet(d);
      for (let j = 0; j < ss / 4 - 1 && fatSet.length < nFat; j++) { const s = u32(o + 4 * j); if (s !== LIVRE) fatSet.push(s); }
      d = u32(o + ss - 4);
    }
    const porSet = ss / 4;
    const fat = new Uint32Array(fatSet.length * porSet).fill(LIVRE);
    fatSet.forEach((s, k) => {
      if (s >= nSet) throw erro("corrompido");
      const o = offSet(s), n = Math.min(porSet, Math.floor((u8.length - o) / 4));
      for (let j = 0; j < n; j++) fat[k * porSet + j] = u32(o + 4 * j);
    });
    function cadeia(ini, tab, maxSet, limite) {
      const out = []; const visto = new Uint8Array(tab.length); let s = ini;
      while (s !== FIM) {
        if (s >= tab.length || s >= limite || visto[s] || out.length >= maxSet) throw erro("corrompido");
        visto[s] = 1; out.push(s); s = tab[s];
      }
      return out;
    }
    function lerGrande(ini, tam) {
      if (tam > u8.length) throw erro("corrompido");
      const set = cadeia(ini, fat, Math.ceil(tam / ss) + 1, nSet);
      if (set.length * ss < tam) throw erro("corrompido");
      const out = new Uint8Array(tam);
      for (let k = 0, o = 0; k < set.length && o < tam; k++, o += ss) {
        const src = offSet(set[k]), n = Math.min(ss, tam - o);
        if (src + n > u8.length) throw erro("corrompido");
        out.set(u8.subarray(src, src + n), o);
      }
      return out;
    }
    // diretório
    const dirSet = cadeia(dir0, fat, nSet, nSet);
    const ents = [];
    for (const s of dirSet) {
      for (let k = 0; k < ss / 128; k++) {
        const o = offSet(s) + k * 128; if (o + 128 > u8.length) break;
        if (ents.length >= LIM.cfbDir) throw erro("corrompido");
        const nl = Math.min(64, u16(o + 0x40)), tipo = u8[o + 0x42];
        ents.push({ nome: nl >= 2 ? utf16le(u8, o, o + nl - 2) : "", tipo, esq: u32(o + 0x44), dir: u32(o + 0x48), filho: u32(o + 0x4C), ini: u32(o + 0x74), tam: u32(o + 0x78), alto: u32(o + 0x7C) });
      }
    }
    const raiz = ents[0]; if (!raiz || raiz.tipo !== 5) throw erro("corrompido");
    // mini stream (arquivos pequenos ficam em setores de 64 bytes)
    let miniFat = null, miniStream = null;
    function lerPequeno(ini, tam) {
      if (!miniFat) {
        const mfSet = nMf ? cadeia(mf0, fat, nMf + 1, nSet) : [];
        miniFat = new Uint32Array(mfSet.length * porSet).fill(LIVRE);
        mfSet.forEach((s, k) => { const o = offSet(s), n = Math.min(porSet, Math.floor((u8.length - o) / 4)); for (let j = 0; j < n; j++) miniFat[k * porSet + j] = u32(o + 4 * j); });
        miniStream = raiz.ini === FIM || !raiz.tam ? new Uint8Array(0) : lerGrande(raiz.ini, Math.min(raiz.tam, u8.length));
      }
      const set = cadeia(ini, miniFat, Math.ceil(tam / 64) + 1, Math.floor(miniStream.length / 64) + 1);
      if (set.length * 64 < tam) throw erro("corrompido");
      const out = new Uint8Array(tam);
      for (let k = 0, o = 0; k < set.length && o < tam; k++, o += 64) {
        const src = set[k] * 64, n = Math.min(64, tam - o);
        if (src + n > miniStream.length) throw erro("corrompido");
        out.set(miniStream.subarray(src, src + n), o);
      }
      return out;
    }
    // filhos diretos da raiz (árvore vermelho-preta: esquerda/direita), com proteção contra laços
    const topo = new Map(), vistos = new Set(), pilha = [raiz.filho];
    while (pilha.length) {
      const i = pilha.pop();
      if (i === LIVRE || i >= ents.length || vistos.has(i)) continue;
      vistos.add(i); const e = ents[i]; if (!topo.has(e.nome)) topo.set(e.nome, e);
      pilha.push(e.esq, e.dir);
    }
    const achar = (nome) => topo.get(nome) || [...topo.values()].find((e) => e.nome.toLowerCase() === nome.toLowerCase());
    return {
      nomes: [...topo.keys()],
      tem: (nome) => !!achar(nome),
      stream(nome) {
        const e = achar(nome); if (!e || e.tipo !== 2) return null;
        if (e.alto) throw erro("grande");
        if (e.tam === 0) return new Uint8Array(0);
        return e.tam < corte ? lerPequeno(e.ini, e.tam) : lerGrande(e.ini, e.tam);
      },
    };
  }

  /* ---------- PowerPoint 97–2003 (.ppt/.pps) ---------- */
  const PPT = { documento: 0x03E8, slide: 0x03EE, notas: 0x03F0, notasAtom: 0x03F1, slidePersist: 0x03F3, mestre: 0x03F8, slwt: 0x0FF0,
    chars: 0x0FA0, bytes: 0x0FA8, persistDir: 0x1772, userEdit: 0x0FF5, cripto: 0x2F14 };
  const limparPpt = (s) => s.replace(/\r\n?|\u000B/g, "\n").replace(/[\u0000-\u0008\u000C\u000E-\u001F]/g, "").trim();
  const normal = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
  function textoPpt(cfb, prog) {
    if (cfb.tem("EncryptedSummary")) throw erro("senha");
    const s = cfb.stream("PowerPoint Document"); if (!s || s.length < 8) throw erro("corrompido");
    const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    let contados = 0;
    const cab = (o) => (o + 8 <= s.length ? { o, vi: dv.getUint16(o, true), tipo: dv.getUint16(o + 2, true), tam: dv.getUint32(o + 4, true) } : null);
    /** percorre a árvore de registros dentro de [ini, fim) em pré-ordem, sem recursão */
    function percorrer(ini, fim, fn) {
      const pilha = [{ o: ini, fim, prof: 0 }];
      while (pilha.length) {
        const f = pilha[pilha.length - 1];
        if (f.o + 8 > f.fim) { pilha.pop(); continue; }
        const h = cab(f.o);
        if (!h || f.o + 8 + h.tam > f.fim) { pilha.pop(); continue; } // registro cortado: para este nível
        if (++contados > LIM.registros) throw erro("corrompido");
        f.o += 8 + h.tam;
        if (fn(h) === false) continue;
        if ((h.vi & 0xF) === 0xF && f.prof < LIM.profundidade && h.tam >= 8) pilha.push({ o: h.o + 8, fim: h.o + 8 + h.tam, prof: f.prof + 1 });
      }
    }
    const textoAtom = (h) => h.tipo === PPT.chars ? limparPpt(utf16le(s, h.o + 8, h.o + 8 + h.tam)) : h.tipo === PPT.bytes ? limparPpt(cp1252(s, h.o + 8, h.o + 8 + h.tam)) : null;
    function textosDe(h) { const out = []; if (!h) return out; percorrer(h.o, h.o + 8 + h.tam, (r) => { if (r.tipo === PPT.mestre) return false; const t = textoAtom(r); if (t) out.push(t); }); return out; }
    // registros do topo
    const topo = []; let o = 0;
    while (o + 8 <= s.length) { const h = cab(o); if (!h || o + 8 + h.tam > s.length) break; topo.push(h); o += 8 + h.tam; if (topo.length > LIM.registros) throw erro("corrompido"); }
    if (!topo.length) throw erro("corrompido");
    if (topo.some((h) => h.tipo === PPT.cripto)) throw erro("senha");
    // diretório de persistência: id -> posição (o mais novo vale)
    const persist = new Map();
    for (const h of topo) {
      if (h.tipo !== PPT.persistDir) continue;
      let p = h.o + 8; const fim = h.o + 8 + h.tam;
      while (p + 4 <= fim) {
        const x = dv.getUint32(p, true), id = x & 0xFFFFF, n = x >>> 20; p += 4;
        for (let k = 0; k < n && p + 4 <= fim; k++, p += 4) persist.set(id + k, dv.getUint32(p, true));
      }
    }
    const reg = (id, tipo) => { const off = persist.get(id); const h = off != null ? cab(off) : null; return h && h.tipo === tipo && off + 8 + h.tam <= s.length ? h : null; };
    // documento: pelo último UserEditAtom; senão, o último DocumentContainer
    let docH = null;
    const ues = topo.filter((h) => h.tipo === PPT.userEdit && h.tam >= 20);
    if (ues.length) docH = reg(dv.getUint32(ues[ues.length - 1].o + 8 + 16, true), PPT.documento);
    if (!docH) docH = [...topo].reverse().find((h) => h.tipo === PPT.documento) || null;
    const listas = { 0: [], 2: [] };
    if (docH) {
      percorrer(docH.o + 8, docH.o + 8 + docH.tam, (h) => {
        if (h.tipo !== PPT.slwt) return h.tipo !== PPT.mestre;
        const inst = h.vi >> 4; if (inst !== 0 && inst !== 2) return false;
        let atual = null;
        percorrer(h.o + 8, h.o + 8 + h.tam, (r) => {
          if (r.tipo === PPT.slidePersist && r.tam >= 16) { atual = { ref: dv.getUint32(r.o + 8, true), id: dv.getUint32(r.o + 8 + 12, true), textos: [] }; listas[inst].push(atual); return false; }
          const t = textoAtom(r); if (t && atual) atual.textos.push(t);
        });
        return false;
      });
    }
    const juntar = (...grupos) => { const vistos = new Set(), out = []; for (const g2 of grupos) for (const t of g2) { const k = normal(t); if (!k || k === "*" || vistos.has(k)) continue; vistos.add(k); out.push(t); } return out; };
    const notasPorSlide = new Map();
    for (const n of listas[2]) {
      const h = reg(n.ref, PPT.notas); if (!h) continue;
      let alvo = null; percorrer(h.o + 8, h.o + 8 + h.tam, (r) => { if (r.tipo === PPT.notasAtom && r.tam >= 4 && alvo === null) alvo = dv.getUint32(r.o + 8, true); return false; });
      const t = juntar(n.textos, textosDe(h)).filter((x) => !/^\d{1,4}$/.test(x.trim()));
      if (alvo !== null && t.length) notasPorSlide.set(alvo, t.join("\n"));
    }
    const out = []; let letras = 0;
    const slides = listas[0].slice(0, LIM.slides);
    slides.forEach((sl, i) => {
      if (letras > LIM.letras) return;
      const t = juntar(sl.textos, textosDe(reg(sl.ref, PPT.slide)));
      const nt = notasPorSlide.get(sl.id);
      const corpo = t.join("\n") + (nt ? (t.length ? "\n" : "") + "Notas: " + nt : "");
      if (corpo.trim()) { out.push(`Slide ${i + 1}\n${corpo}`); letras += corpo.length; }
      if (i % 5 === 4) prog((i + 1) / slides.length, `Lendo o slide ${i + 1} de ${slides.length}…`);
    });
    if (out.length) return { texto: out.join("\n\n"), paginas: slides.length };
    // sem a lista de slides (arquivo estranho): textos na ordem do arquivo, por slide quando der
    let k = 0;
    for (const h of topo) {
      if (h.tipo === PPT.slide) { const t = juntar(textosDe(h)); if (t.length) out.push(`Slide ${++k}\n${t.join("\n")}`); }
    }
    if (!out.length) out.push(juntar(textosDe({ o: 0, tam: s.length - 8, tipo: 0, vi: 0xF })).join("\n"));
    return { texto: out.join("\n\n"), paginas: k || null, aviso: "Ordem dos slides aproximada." };
  }

  /* ---------- Word 97–2003 (.doc) ---------- */
  /** Caracteres especiais do Word: campos (só o resultado), células, quebras. */
  function limparWord(s) {
    let out = "", codigo = 0; const pilha = [];
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 0x13) { pilha.push(1); codigo++; continue; }
      if (c === 0x14) { if (pilha.length && pilha[pilha.length - 1] === 1) { pilha[pilha.length - 1] = 0; codigo--; } continue; }
      if (c === 0x15) { if (pilha.length && pilha.pop() === 1) codigo--; continue; }
      if (codigo > 0) continue;
      if (c === 0x0D || c === 0x0B || c === 0x0C) out += "\n";
      else if (c === 0x07) out += "\u0007"; // fim de célula; dois seguidos = fim da linha da tabela
      else if (c === 0x09) out += "\t";
      else if (c === 0x1E) out += "-";
      else if (c < 0x20) { /* objetos, notas, imagens: fora */ }
      else out += s[i];
    }
    return out.replace(/\u0007\u0007/g, "\n").replace(/\u0007/g, "\t").replace(/\t\n/g, "\n");
  }
  /** Último recurso: trechos legíveis do arquivo (quando a tabela de peças falha ou é Word 6/95). */
  function trechosLegiveis(u8) {
    const ok = (c) => (c >= 0x20 && c !== 0x7F && !(c >= 0x80 && c < 0xA0 && c !== 0x80)) || c === 0x0D || c === 0x09;
    const runs = (pegar, passo) => {
      const out = []; let atual = "";
      for (let i = 0; i + passo <= u8.length; i += passo) {
        const c = pegar(i);
        if (ok(c) && c < 0xFFFE) atual += c === 0x0D ? "\n" : String.fromCharCode(c);
        else { if (atual.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 6) out.push(atual); atual = ""; }
        if (out.length > 200000) break;
      }
      if (atual.replace(/[^A-Za-zÀ-ÿ]/g, "").length >= 6) out.push(atual);
      return out.join("\n");
    };
    const a = runs((i) => u8[i] | (u8[i + 1] << 8), 2), b = runs((i) => ch1252(u8[i]), 1);
    const letras = (x) => x.replace(/[^A-Za-zÀ-ÿ]/g, "").length;
    return letras(a) >= letras(b) ? a : b;
  }
  function textoDoc(cfb, prog) {
    const wd = cfb.stream("WordDocument"); if (!wd || wd.length < 0x200) throw erro("corrompido");
    const dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
    if (u16(0) !== 0xA5EC && u16(0) !== 0xA5DC) throw erro("corrompido");
    const nFib = u16(2), flags = u16(0x0A);
    if (flags & 0x0100 || flags & 0x8000) throw erro("senha");
    prog(0.3, "Lendo o texto…");
    const aproximado = (motivo) => {
      const fcMin = u32(0x18), fcMac = u32(0x1C);
      let t = "";
      if (nFib < 101 && fcMin >= 0x20 && fcMac > fcMin && fcMac <= wd.length) t = limparWord(cp1252(wd, fcMin, fcMac));
      if (t.replace(/\s+/g, "").length < 20) t = trechosLegiveis(wd.subarray(Math.min(wd.length, 0x200)));
      return { texto: t, paginas: null, aviso: motivo };
    };
    if (nFib < 101) return aproximado("Word muito antigo (6/95): texto lido de forma aproximada.");
    try {
      // FIB: FibBase(32) + csw + fibRgW + cslw + fibRgLw + cbRgFcLcb + fibRgFcLcb
      let p = 32; const csw = u16(p); p += 2 + csw * 2;
      const cslw = u16(p); p += 2; const lw = p; p += cslw * 4;
      const cb = u16(p); p += 2;
      if (cslw < 11 || cb < 34 || p + 34 * 8 > wd.length) throw erro("corrompido");
      const ccp = [3, 4, 5, 7, 8, 9, 10].map((k) => u32(lw + k * 4)); // texto, rodapé, cabeçalhos, comentários, notas de fim, caixas de texto, caixas do cabeçalho
      const fcClx = u32(p + 33 * 8), lcbClx = u32(p + 33 * 8 + 4);
      const nomeTab = flags & 0x0200 ? "1Table" : "0Table";
      const tb = cfb.stream(nomeTab) || cfb.stream(nomeTab === "1Table" ? "0Table" : "1Table");
      if (!tb || !lcbClx || fcClx + lcbClx > tb.length) throw erro("corrompido");
      const tv = new DataView(tb.buffer, tb.byteOffset, tb.byteLength);
      // CLX: Prc* (0x01) e depois Pcdt (0x02)
      let q = fcClx, fimClx = fcClx + lcbClx, plc = -1, lcb = 0, voltas = 0;
      while (q < fimClx && ++voltas < 100000) {
        const t = tb[q];
        if (t === 0x01) { q += 3 + tv.getInt16(q + 1, true); continue; }
        if (t === 0x02) { lcb = tv.getUint32(q + 1, true); plc = q + 5; break; }
        throw erro("corrompido");
      }
      if (plc < 0 || plc + lcb > tb.length || lcb < 16 || (lcb - 4) % 12) throw erro("corrompido");
      const n = (lcb - 4) / 12;
      const total = ccp.reduce((a, b) => a + b, 0);
      let texto = "";
      for (let i = 0; i < n && texto.length < LIM.letras; i++) {
        const cp0 = tv.getUint32(plc + i * 4, true), cp1 = tv.getUint32(plc + (i + 1) * 4, true);
        if (cp1 < cp0 || cp1 - cp0 > LIM.letras) throw erro("corrompido");
        const x = tv.getUint32(plc + (n + 1) * 4 + i * 8 + 2, true);
        const comp = (x & 0x40000000) !== 0, fc = x & 0x3FFFFFFF, nc = cp1 - cp0;
        if (comp) { const ini = fc / 2; if (ini + nc > wd.length) throw erro("corrompido"); texto += cp1252(wd, ini, ini + nc); }
        else { if (fc + nc * 2 > wd.length) throw erro("corrompido"); texto += utf16le(wd, fc, fc + nc * 2); }
      }
      if (!texto.length) throw erro("corrompido");
      const partes = [];
      if (total > 0 && total <= texto.length + 1) {
        let ini = 0; const fatias = ccp.map((c) => { const f = texto.slice(ini, ini + c); ini += c; return f; });
        partes.push(limparWord(fatias[0]));
        const rod = limparWord(fatias[1]).trim(); if (rod) partes.push("Notas de rodapé:\n" + rod);
        const fimN = limparWord(fatias[4]).trim(); if (fimN) partes.push("Notas de fim:\n" + fimN);
        const cx = limparWord(fatias[5]).trim(); if (cx) partes.push(cx);
      } else partes.push(limparWord(texto));
      prog(1, "Texto lido.");
      return { texto: partes.join("\n\n"), paginas: null };
    } catch (e) {
      if (e && e.codigo === "senha") throw e;
      const r = aproximado("A estrutura deste .doc é diferente do esperado: o texto foi lido de forma aproximada.");
      if (r.texto.replace(/\s+/g, "").length < 20) throw erro("corrompido");
      return r;
    }
  }

  /* ---------- Excel 97–2003 (.xls, BIFF8; BIFF5 básico) ---------- */
  function textoXls(cfb, prog) {
    const s = cfb.stream("Workbook") || cfb.stream("Book"); if (!s || s.length < 8) throw erro("corrompido");
    const dv = new DataView(s.buffer, s.byteOffset, s.byteLength);
    const u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
    let biff8 = true;
    const folhas = []; const nomesPorPos = new Map(); const sst = [];
    let atual = null, nivel = 0, pendente = null, sstSeg = null, contados = 0;
    const strBiff8 = (o, fim) => { // XLUnicodeString: cch(2) + flags(1) + chars
      if (o + 3 > fim) return ["", fim];
      const n = u16(o), alto = s[o + 2] & 1; let p = o + 3;
      const nb = alto ? n * 2 : n; const ate = Math.min(fim, p + nb);
      return [alto ? utf16le(s, p, ate) : cp1252(s, p, ate), ate];
    };
    const strCurta = (o, fim) => { const n = s[o], alto = s[o + 1] & 1, p = o + 2; const ate = Math.min(fim, p + (alto ? n * 2 : n)); return alto ? utf16le(s, p, ate) : cp1252(s, p, ate); };
    const num = (o) => { const v = dv.getFloat64(o, true); return Number.isFinite(v) ? String(Number.isInteger(v) ? v : +v.toPrecision(12)) : ""; };
    const rk = (v) => { let n; if (v & 2) n = (v | 0) >> 2; else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, v & 0xFFFFFFFC, true); b.setUint32(0, 0, true); n = b.getFloat64(0, true); } if (v & 1) n /= 100; return String(Number.isInteger(n) ? n : +n.toPrecision(12)); };
    const cel = (lin, col, v) => { if (!atual || v === "" || v == null) return; if (atual.cel.length >= LIM.celulas) return; atual.cel.push([lin, col, String(v).replace(/[\t\r\n]+/g, " ").trim()]); };
    function lerSst() { // SST com os CONTINUE: a string pode quebrar no meio, e o pedaço novo começa com um byte de flags
      const segs = sstSeg; if (!segs || !segs.length) return;
      let si = 0, off = 8; const totalU = u32(segs[0][0] + 4);
      const fimSeg = () => segs[si][1];
      const ajusta = () => { while (si < segs.length && segs[si][0] + off >= fimSeg()) { si++; off = 0; } return si < segs.length; };
      const byte = () => { if (!ajusta()) throw erro("corrompido"); return s[segs[si][0] + off++]; };
      const pula = (n) => { while (n > 0) { if (!ajusta()) return; const disp = fimSeg() - (segs[si][0] + off); const k = Math.min(n, disp); off += k; n -= k; } };
      for (let k = 0; k < totalU && k < LIM.sst; k++) {
        if (!ajusta()) break;
        const cch = byte() | (byte() << 8); let fl = byte();
        const rich = fl & 8 ? (byte() | (byte() << 8)) : 0;
        const ext = fl & 4 ? (byte() | (byte() << 8) | (byte() << 16) | (byte() << 24)) >>> 0 : 0;
        const cs = []; let falta = cch;
        while (falta > 0) {
          if (segs[si][0] + off >= fimSeg()) { si++; off = 0; if (si >= segs.length) break; fl = s[segs[si][0] + off++]; }
          const disp = fimSeg() - (segs[si][0] + off), alto = fl & 1;
          const n = Math.min(falta, alto ? disp >> 1 : disp); if (n <= 0) { si++; off = 0; if (si >= segs.length) break; fl = s[segs[si][0] + off++]; continue; }
          const p = segs[si][0] + off;
          cs.push(alto ? utf16le(s, p, p + n * 2) : cp1252(s, p, p + n)); off += alto ? n * 2 : n; falta -= n;
        }
        sst.push(cs.join(""));
        pula(rich * 4 + ext);
      }
    }
    let o = 0, ultimoTipo = 0;
    while (o + 4 <= s.length) {
      if (++contados > LIM.registros) throw erro("corrompido");
      const tipo = u16(o), tam = u16(o + 2), d = o + 4, fim = d + tam;
      if (fim > s.length) break;
      if (tipo === 0x0809 || tipo === 0x0209 || tipo === 0x0409) { // BOF
        nivel++;
        if (tipo === 0x0809 && tam >= 4) { const vers = u16(d); if (nivel === 1 && folhas.length === 0 && !atual) biff8 = vers === 0x0600; }
        const dt = tam >= 4 ? u16(d + 2) : 0;
        if (dt === 0x0010 && (nivel === 1 || !atual)) { atual = { nome: nomesPorPos.get(o) || "", cel: [] }; folhas.push(atual); }
      } else if (tipo === 0x000A) { // EOF
        nivel = Math.max(0, nivel - 1); if (nivel === 0) atual = null;
      } else if (tipo === 0x002F) throw erro("senha");
      else if (tipo === 0x0085 && tam >= 8) { // BOUNDSHEET
        const pos = u32(d); nomesPorPos.set(pos, biff8 ? strCurta(d + 6, fim) : cp1252(s, d + 7, Math.min(fim, d + 7 + s[d + 6])));
      } else if (tipo === 0x00FC) sstSeg = [[d, fim]];
      else if (tipo === 0x003C && ultimoTipo === 0x00FC && sstSeg) { sstSeg.push([d, fim]); tipoContinua(); }
      else if (atual) {
        if (tipo === 0x00FD && tam >= 10) cel(u16(d), u16(d + 2), sst[u32(d + 6)]);
        else if ((tipo === 0x0204 || tipo === 0x00D6) && tam >= 8) cel(u16(d), u16(d + 2), biff8 ? strBiff8(d + 6, fim)[0] : cp1252(s, d + 8, Math.min(fim, d + 8 + u16(d + 6))));
        else if (tipo === 0x0203 && tam >= 14) cel(u16(d), u16(d + 2), num(d + 6));
        else if (tipo === 0x027E && tam >= 10) cel(u16(d), u16(d + 2), rk(u32(d + 6)));
        else if (tipo === 0x00BD && tam >= 6) { const lin = u16(d), c0 = u16(d + 2); for (let p = d + 4, c = c0; p + 6 <= fim - 2; p += 6, c++) cel(lin, c, rk(u32(p + 2))); }
        else if (tipo === 0x0205 && tam >= 8) { if (!s[d + 7]) cel(u16(d), u16(d + 2), s[d + 6] ? "VERDADEIRO" : "FALSO"); }
        else if (tipo === 0x0006 && tam >= 20) {
          const lin = u16(d), col = u16(d + 2);
          if (u16(d + 12) === 0xFFFF) { const k = s[d + 6]; if (k === 0) pendente = [lin, col]; else if (k === 1) cel(lin, col, s[d + 8] ? "VERDADEIRO" : "FALSO"); }
          else cel(lin, col, num(d + 6));
        } else if (tipo === 0x0207 && pendente) { cel(pendente[0], pendente[1], biff8 ? strBiff8(d, fim)[0] : cp1252(s, d + 2, Math.min(fim, d + 2 + u16(d)))); pendente = null; }
      }
      if (tipo !== 0x003C) ultimoTipo = tipo;
      if (tipo === 0x00FC) { /* o SST é lido quando acabarem os CONTINUE */ }
      else if (sstSeg && !sst.length && tipo !== 0x003C) lerSst();
      o = fim;
    }
    function tipoContinua() { }
    if (sstSeg && !sst.length) lerSst();
    // LABELSST lidos antes do SST? (não acontece em arquivo válido: o SST vem no começo)
    prog(1, "Planilha lida.");
    const out = [];
    for (const f of folhas) {
      if (!f.cel.length) continue;
      f.cel.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const linhas = []; let l = -1, atualL = [];
      for (const [lin, , v] of f.cel) { if (lin !== l) { if (atualL.length) linhas.push(atualL.join("\t")); atualL = []; l = lin; } if (v) atualL.push(v); }
      if (atualL.length) linhas.push(atualL.join("\t"));
      out.push(`Planilha: ${f.nome || folhas.indexOf(f) + 1}\n${linhas.join("\n")}`);
    }
    return { texto: out.join("\n\n"), paginas: folhas.length || null, aviso: biff8 ? "" : "Excel 95: lido de forma básica." };
  }
  function doCfb(u8, op, prog) {
    const c = lerCFB(u8);
    if (c.tem("EncryptedPackage") || c.tem("EncryptionInfo")) throw erro("senha"); // .docx/.pptx/.xlsx com senha
    if (c.tem("PowerPoint Document")) return { formato: "ppt", ...textoPpt(c, prog) };
    if (c.tem("WordDocument")) return { formato: "doc", ...textoDoc(c, prog) };
    if (c.tem("Workbook") || c.tem("Book")) return { formato: "xls", ...textoXls(c, prog) };
    throw erro("formato", "Este arquivo antigo do Office não é PowerPoint, Word nem Excel (pode ser do Publisher, Visio ou outro programa). Exporte como PDF e envie de novo.");
  }

  /* ================= RTF ================= */
  const RTF_PULAR = new Set(["fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "footer", "headerl", "headerr", "headerf", "footerl", "footerr", "footerf",
    "xmlnstbl", "themedata", "colorschememapping", "datastore", "latentstyles", "listtable", "listoverridetable", "rsidtbl", "generator", "mmathPr", "fldinst",
    "filetbl", "revtbl", "pgdsctbl", "nonshppict", "shppict", "shpinst", "sp", "sn", "sv", "bkmkstart", "bkmkend", "falt", "panose", "template", "userprops", "docvar",
    "wgrffmtfilter", "xe", "tc", "atnid", "atnauthor", "annotation", "objdata", "blipuid", "fontemb", "fontfile", "listtext", "pntext", "pntxta", "pntxtb", "ftnsep", "ftnsepc", "aftnsep", "aftnsepc"]);
  const RTF_TROCA = { par: "\n", line: "\n", sect: "\n", page: "\n", row: "\n", tab: "\t", cell: "\t", emdash: "—", endash: "–", bullet: "•", lquote: "‘", rquote: "’", ldblquote: "“", rdblquote: "”", emspace: " ", enspace: " ", qmspace: " " };
  function textoRtf(u8) {
    const s = latin1(u8);
    if (!/^\s*\{\\rtf/.test(s.slice(0, 64))) throw erro("corrompido");
    const out = []; const pilha = []; let st = { pula: false, uc: 1 }, pular = 0, i = 0, letras = 0;
    const re = /\\([a-zA-Z]{1,32})(-?\d{1,10})? ?/y;
    const pega = (t) => { if (pular > 0) { pular--; return; } if (!st.pula) { out.push(t); letras += t.length; } };
    while (i < s.length && letras < LIM.letras) {
      const c = s[i];
      if (c === "{") { if (pilha.length > 3000) throw erro("corrompido"); pilha.push(st); st = { pula: st.pula, uc: st.uc }; i++; continue; }
      if (c === "}") { if (pilha.length) st = pilha.pop(); pular = 0; i++; continue; }
      if (c === "\r" || c === "\n") { i++; continue; }
      if (c === "\\") {
        const nx = s[i + 1];
        if (nx === "'") { const b = parseInt(s.substr(i + 2, 2), 16); i += 4; if (!Number.isNaN(b)) pega(String.fromCharCode(ch1252(b))); continue; }
        re.lastIndex = i; const m = re.exec(s);
        if (m) {
          i = re.lastIndex; const w = m[1], prm = m[2] !== undefined ? parseInt(m[2], 10) : null;
          if (w === "bin") { i += Math.max(0, prm || 0); continue; }
          if (pular > 0 && w !== "u") { pular--; continue; }
          if (RTF_PULAR.has(w)) st.pula = true;
          else if (w === "uc") st.uc = Math.max(0, Math.min(10, prm || 0));
          else if (w === "u" && prm !== null) { pular = 0; if (!st.pula) { out.push(String.fromCharCode((prm + 65536) % 65536)); letras++; } pular = st.uc; }
          else if (RTF_TROCA[w]) pega(RTF_TROCA[w]);
          continue;
        }
        if (nx === "*") { st.pula = true; i += 2; continue; }
        if (nx === "\\" || nx === "{" || nx === "}") { pega(nx); i += 2; continue; }
        if (nx === "~") { pega(" "); i += 2; continue; }
        if (nx === "_") { pega("-"); i += 2; continue; }
        if (nx === "\n" || nx === "\r") { pega("\n"); i += 2; continue; }
        i += 2; continue;
      }
      // texto comum: junta até o próximo caractere especial
      let j = i; while (j < s.length && s[j] !== "\\" && s[j] !== "{" && s[j] !== "}" && s[j] !== "\r" && s[j] !== "\n") j++;
      let run = s.slice(i, j); i = j;
      if (pular > 0) { const k = Math.min(pular, run.length); run = run.slice(k); pular -= k; }
      if (run && !st.pula) { out.push(run.replace(/[\x80-\x9F]/g, (x) => String.fromCharCode(ch1252(x.charCodeAt(0))))); letras += run.length; }
    }
    return { texto: out.join(""), paginas: null };
  }

  /* ================= HTML ================= */
  function textoHtml(str) {
    let s = String(str).replace(/<!--[\s\S]*?(-->|$)/g, " ");
    // tira scripts, estilos e afins (com o conteúdo); sem regex com volta para trás
    const abre = /<(script|style|noscript|template|head|svg|math|iframe|object|textarea|select)\b/gi;
    let saida = "", ult = 0, m;
    while ((m = abre.exec(s))) {
      saida += s.slice(ult, m.index);
      const fecha = new RegExp(`</${m[1]}\\s*>`, "gi"); fecha.lastIndex = abre.lastIndex;
      const f = fecha.exec(s);
      ult = f ? fecha.lastIndex : s.length; abre.lastIndex = ult;
      if (m[1].toLowerCase() === "head") { const t = s.slice(m.index, ult).match(/<title\b[^>]*>([^<]*)<\/title>/i); if (t && t[1].trim()) saida += "\n" + t[1] + "\n"; }
    }
    s = saida + s.slice(ult);
    s = s.replace(/<br\b[^>]*>/gi, "\n").replace(/<li\b[^>]*>/gi, "\n- ").replace(/<(td|th)\b[^>]*>/gi, "\t")
      .replace(/<\/(p|div|tr|h[1-6]|table|section|article|blockquote|pre|ul|ol|dd|dt|header|footer|li|title|caption|figcaption)\s*>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    return { texto: desfazEntidades(s).replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n[ \t]+/g, "\n"), paginas: null };
  }

  /* ================= PDF (pdf.js) ================= */
  async function textoPdf(u8, op, prog) {
    const lib = await op.carregarPdfjs();
    let doc;
    try { doc = await lib.getDocument({ data: u8, isEvalSupported: false, disableFontFace: true }).promise; }
    catch (e) { throw /password/i.test((e && e.name) + (e && e.message)) ? erro("senha", "Esse PDF tem senha. Tire a senha e tente de novo.") : erro("corrompido", "Não consegui abrir esse PDF (parece corrompido). Abra e salve de novo, ou exporte outra vez como PDF."); }
    const partes = [], n = doc.numPages;
    try {
      for (let i = 1; i <= n; i++) {
        const pg = await doc.getPage(i); const tc = await pg.getTextContent();
        partes.push(tc.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : " ")).join("")); pg.cleanup();
        if (i % 3 === 0 || i === n) prog(i / n, `Lendo a página ${i} de ${n}…`);
      }
    } finally { try { doc.destroy(); } catch (_) { } }
    return { texto: partes.join("\n\n"), paginas: n };
  }

  /* ================= entrada única ================= */
  function farejar(u8) {
    if (ehCFB(u8)) return "cfb";
    if (u8.length >= 4 && u8[0] === 0x50 && u8[1] === 0x4B && (u8[2] === 3 || u8[2] === 5 || u8[2] === 7)) return "zip";
    const ini = latin1(u8.subarray(0, 1024));
    if (ini.indexOf("%PDF-") >= 0) return "pdf";
    if (/^\s*\{\\rtf/.test(ini)) return "rtf";
    if (/^(﻿|\xEF\xBB\xBF)?\s*<(!doctype html|html\b|\?xml[^>]*>\s*<html)/i.test(ini) || /^(\xEF\xBB\xBF)?\s*<(!doctype html|html\b)/i.test(ini)) return "html";
    return null;
  }
  const BINARIOS = new Set(["pdf", "pptx", "docx", "xlsx", "odp", "odt", "ods", "ppt", "doc", "xls"]);
  /**
   * bytes (Uint8Array/ArrayBuffer) -> {texto, paginas, formato, aviso}. O formato é decidido pelo conteúdo
   * (um .ppt que na verdade é .pptx, ou um .doc que é RTF, funciona); a extensão só ajuda nos de texto.
   */
  async function extrair(bytes, op = {}) {
    const prog = typeof op.prog === "function" ? op.prog : () => { };
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!u8.length) throw erro("vazio");
    if (u8.length > LIM.bytes) throw erro("grande", "Arquivo grande demais (mais de 100 MB).");
    const tipo = op.tipo || (tipoDoArquivo(op.nome, op.mime) || {}).tipo || "txt";
    const magia = farejar(u8);
    let r;
    if (magia === "pdf") r = { formato: "pdf", ...(await textoPdf(u8, op, prog)) };
    else if (magia === "zip") r = await doZip(u8, op, prog);
    else if (magia === "cfb") r = doCfb(u8, op, prog);
    else if (magia === "rtf") r = { formato: "rtf", ...textoRtf(u8) };
    else if (magia === "html" && tipo !== "txt" && tipo !== "csv") r = { formato: "html", ...textoHtml(decodificar(u8, (latin1(u8.subarray(0, 2048)).match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1])) };
    else if (BINARIOS.has(tipo)) throw erro("corrompido");
    else if (tipo === "html") r = { formato: "html", ...textoHtml(decodificar(u8, (latin1(u8.subarray(0, 2048)).match(/charset\s*=\s*["']?([\w-]+)/i) || [])[1])) };
    else {
      const t = decodificar(u8);
      if (!pareceTexto(t)) throw erro("formato", MSG.texto);
      r = { formato: tipo === "csv" ? "csv" : "txt", texto: t, paginas: null };
    }
    prog(1, "Texto lido.");
    const texto = corta(String(r.texto || "").replace(/\r\n?/g, "\n").split("\u0000").join(""));
    return { texto, paginas: r.paginas ?? null, formato: r.formato, aviso: r.aviso || "" };
  }

  const API = { tipoDoArquivo, extrair, naoAceito, ACCEPT, FORMATOS_TEXTO, MIMES: M, LIM,
    // partes, para os testes
    lerCFB, textoRtf, textoHtml, decodificar, limparWord, farejar, cp1252, utf16le, desfazEntidades };
  g.Extrair = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
