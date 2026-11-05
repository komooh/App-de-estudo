// Trabalhador (Web Worker, tipo "module") da transcrição de áudio. Quem usa é assets/transcrever.js;
// nada aqui roda na página. Carrega o Whisper pelo Transformers.js (WebGPU se houver, senão WASM)
// e transcreve janelas de até 30 s de áudio a 16 kHz mono. O áudio nunca sai do aparelho:
// a rede só é usada para baixar a biblioteca (jsDelivr) e o modelo (Hugging Face), que ficam em cache.
//
// Mensagens recebidas:
//   {tipo:"carregar", url, modelo, dtypeWasm, dtypeGpu, gpu}
//   {tipo:"ouvir", id, audio: Float32Array, idioma: "pt"|"es"|null}   {tipo:"idioma", id, audio}
// Mensagens enviadas:
//   {tipo:"cache", emCache}  {tipo:"baixando", carregado, total}  {tipo:"pronto", dispositivo}
//   {tipo:"texto", id, texto, idioma, pontos:{pt, es}|null}   {tipo:"idioma", id, pontos:{pt, es}|null}   {tipo:"erro", id?, msg, fase}
"use strict";

let T = null, pipe = null, dispositivo = null;

self.onmessage = async (e) => {
  const m = e.data || {};
  try {
    if (m.tipo === "carregar") await carregar(m);
    else if (m.tipo === "ouvir") await ouvir(m);
    else if (m.tipo === "idioma") self.postMessage({ tipo: "idioma", id: m.id, pontos: pipe ? await pontuarIdiomas(m.audio) : null });
  } catch (err) {
    self.postMessage({ tipo: "erro", id: m.id, fase: m.tipo, msg: String((err && err.message) || err) });
  }
};

async function carregar(m) {
  if (pipe) { self.postMessage({ tipo: "pronto", dispositivo }); return; }
  T = await import(m.url);
  T.env.allowLocalModels = false;
  try { if (T.env.logLevel !== undefined && T.LogLevel) T.env.logLevel = T.LogLevel.ERROR; } catch (_) {}

  // Já está no cache do navegador? (só para a mensagem: "baixando" x "preparando")
  let emCache = false;
  try {
    const c = await caches.open("transformers-cache");
    emCache = !!(await c.match(`https://huggingface.co/${m.modelo}/resolve/main/config.json`));
  } catch (_) {}
  self.postMessage({ tipo: "cache", emCache });

  const arquivos = {};
  const progresso = (p) => {
    if (!p || p.status !== "progress" || !p.file) return;
    arquivos[p.file] = { c: p.loaded || 0, t: p.total || 0 };
    let c = 0, t = 0;
    for (const k in arquivos) { c += arquivos[k].c; t += arquivos[k].t; }
    self.postMessage({ tipo: "baixando", carregado: c, total: t });
  };

  let gpu = false;
  if (m.gpu && self.navigator && navigator.gpu) {
    try {
      const ad = await navigator.gpu.requestAdapter();
      // adaptador "de reserva" = WebGPU emulado no processador: mais lento que o WASM
      gpu = !!ad && !(ad.isFallbackAdapter || (ad.info && ad.info.isFallbackAdapter));
    } catch (_) { gpu = false; }
  }
  if (gpu) {
    try {
      pipe = await T.pipeline("automatic-speech-recognition", m.modelo, { device: "webgpu", dtype: m.dtypeGpu, progress_callback: progresso });
      dispositivo = "webgpu";
    } catch (err) {
      pipe = null; // placa de vídeo recusou: segue no processador
    }
  }
  if (!pipe) {
    pipe = await T.pipeline("automatic-speech-recognition", m.modelo, { device: "wasm", dtype: m.dtypeWasm, progress_callback: progresso });
    dispositivo = "wasm";
  }
  self.postMessage({ tipo: "pronto", dispositivo });
}

// Probabilidade de cada idioma (pt x es) pelo primeiro passo do decodificador:
// <|startoftranscript|> -> o próximo token é o idioma.
async function pontuarIdiomas(audio) {
  const gc = pipe.model.generation_config || {};
  const l2i = gc.lang_to_id || {};
  const sot = gc.decoder_start_token_id;
  const idPt = l2i["<|pt|>"], idEs = l2i["<|es|>"];
  if (sot == null || idPt == null || idEs == null) return null;
  const { input_features } = await pipe.processor(audio);
  const dec = new T.Tensor("int64", BigInt64Array.from([BigInt(sot)]), [1, 1]);
  const out = await pipe.model({ input_features, decoder_input_ids: dec });
  const lg = out.logits, v = lg.dims[lg.dims.length - 1];
  const base = (lg.dims[1] - 1) * v, d = lg.data;
  const a = Number(d[base + idPt]), b = Number(d[base + idEs]);
  const mx = Math.max(a, b), za = Math.exp(a - mx), zb = Math.exp(b - mx);
  return { pt: za / (za + zb), es: zb / (za + zb) };
}

async function ouvir(m) {
  if (!pipe) throw new Error("modelo não carregado");
  const audio = m.audio;
  let idioma = m.idioma, pontos = null;
  if (!idioma) {
    pontos = await pontuarIdiomas(audio);
    idioma = pontos ? (pontos.pt >= pontos.es ? "pt" : "es") : "pt";
  }
  // 30 s de fala dão ~120 tokens; o teto e a proibição de repetir 6 tokens cortam os "laços" do Whisper
  const r = await pipe(audio, { language: idioma, task: "transcribe", return_timestamps: false, max_new_tokens: 220, no_repeat_ngram_size: 6 });
  const texto = String((Array.isArray(r) ? r.map((x) => x.text).join(" ") : r && r.text) || "").trim();
  self.postMessage({ tipo: "texto", id: m.id, texto, idioma, pontos });
}
