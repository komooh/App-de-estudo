// Importar laminário: VÁRIOS arquivos de uma vez, de qualquer formato comum, viram lâminas para conferir antes de salvar.
// Usado por Configurações → Laminário (assets/painel.js). Nada é salvo aqui: quem salva é a tela, depois da revisão.
//
//   Laminario.lerArquivos(files, {carregarPdfjs, carregarJSZip, prog(msg)}) -> {itens, avisos, sugestoes}
//     item = {k, origem, onde, blob (JPEG final), thumb (JPEG pequeno), resposta, orgao, tema, usar, motivo,
//             grupo, extra (outra foto do mesmo slide), nFotos}
//   Laminario.ACCEPT (para <input accept>)   Laminario.LIM
//
// Formatos:
// - PDF: uma lâmina por página. A página é desenhada em JPEG; se ela tem foto(s) e texto, só a área das fotos
//   entra (assim o nome escrito na página não aparece na imagem do treino). Resposta: a linha mais destacada
//   da página (maior letra), sem o cabeçalho/rodapé que se repete em todas. Página só com texto vem desmarcada.
// - PowerPoint .pptx e OpenDocument .odp: uma lâmina por slide, com a maior foto; slide com várias fotos pode
//   virar uma lâmina por foto. Resposta: o título do slide (ou a linha com a maior letra).
// - Word .docx e OpenDocument .odt: cada foto, na ordem; resposta: o parágrafo logo abaixo (ou acima).
// - Fotos (jpg, png, webp, gif, bmp; heic se o navegador abrir): uma por arquivo; resposta: o nome do arquivo.
// - .zip com fotos. PowerPoint antigo .ppt: as fotos saem, mas sem saber de qual slide (resposta em branco).
// As partes "puras" (sem navegador) rodam no Node para os testes.
(function (g) {
  "use strict";
  const LIM = {
    arquivos: 20,                 // por importação
    arquivoBytes: 80 * 1024 * 1024,
    itens: 300,                   // lâminas lidas por importação (o limite do aluno é 300)
    paginas: 300,                 // páginas de um PDF
    lado: 1600,                   // lado maior da imagem final
    alvo: 450 * 1024,             // tamanho buscado do JPEG (a pasta aceita até 600 KB)
    max: 590 * 1024,
    thumb: 260,
    fotoMin: 120,                 // foto menor que isso (px) é ícone/logo
  };
  const IMG_EXT = /\.(jpe?g|jfif|png|gif|webp|bmp|heic|heif|avif|tiff?)$/i;
  const ACCEPT = ".pdf,.pptx,.pptm,.ppsx,.potx,.ppt,.pps,.odp,.docx,.docm,.odt,.zip,image/*,.jpg,.jpeg,.png,.webp,.gif,.bmp,.heic,.heif,"
    + "application/pdf,application/zip,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-powerpoint,"
    + "application/vnd.oasis.opendocument.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text";

  /* ================= partes puras (testadas no Node) ================= */
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
  const normal = (s) => semAcento(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const letras = (s) => (String(s || "").match(/\p{L}/gu) || []).length;
  /** Texto de uma página/slide -> resposta: sem espaços sobrando, sem "Lámina 3:" / "1." no começo, até 300 letras. */
  function limparResposta(s) {
    let t = String(s ?? "").replace(/[\u0000-\u001F\u007F­]/g, " ").replace(/\s+/g, " ").trim();
    for (let i = 0; i < 2; i++) t = t
      .replace(/^(l[aá]mina|lamina|slide|diapositiva|p[aá]gina|pag\.?|fig(?:ura)?\.?|foto|imagen|imagem|preparado|preparaci[oó]n)\s*(n[º°o]\.?\s*)?\d{0,3}\s*[:.\-–—)]\s*/i, "")
      .replace(/^(n[º°]\s*)?\d{1,3}\s*[.)\-–—:]\s+/, "").trim();
    t = t.replace(/^[\-–—•·*:;,.]+\s*/, "").replace(/\s*[\-–—•·:;,*]+$/, "").trim();
    return t.length > 300 ? t.slice(0, 300).trim() : t;
  }
  /** Tira o código do começo do nome ("56a45059-LAMINARIO.pdf", "3f2c…-uuid_foto.jpg") que o envio/download põe. */
  const semPrefixo = (n) => String(n || "").replace(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{6,16})[-_ ]+(?=\S)/i, "");
  /** Nome do arquivo -> resposta ("01_cirrose-hepatica.jpg" -> "cirrose hepatica"); nome de câmera vira vazio. */
  function respostaDoNome(nome) {
    let t = semPrefixo(String(nome || "").replace(/^.*[\\/]/, "")).replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").replace(/(\S)-(\S)/g, "$1 $2");
    t = t.replace(/\s*\(\d+\)\s*$/, "");
    // "IMG 20231012 WA0003", "WhatsApp Image 2026-10-01 at 10.22.31", "Captura de tela 2026..." não dizem nada
    const fica = t.split(/[\s.:]+/).filter((w) => w && !/^(img|dsc\w*|dcim|pxl|wa\d*|whatsapp|image|imagem|imagen|photo|foto|screenshot|captura|screen|shot|de|da|tela|pantalla|at|as|às|\d+[a-z]?\d*)$/i.test(w));
    if (!fica.length || letras(fica.join("")) < 3) return "";
    return limparResposta(t.replace(/^\s*\d{1,4}\s+(?=\p{L})/u, ""));
  }
  /** Linhas que se repetem em muitas páginas (cabeçalho, rodapé, nome da faculdade). listas: [[texto]] por página. */
  function repetidas(listas) {
    const n = listas.length, cont = new Map(), out = new Set();
    if (n < 3) return out;
    for (const l of listas) for (const k of new Set(l.map(normal).filter(Boolean))) cont.set(k, (cont.get(k) || 0) + 1);
    for (const [k, c] of cont) if (c >= Math.max(3, Math.ceil(n * 0.5))) out.add(k);
    return out;
  }
  const BALA = /^\s*[•●▪■◦‣►▶➢✓◆]\s*/;
  const ROTULO = /^[\s\-–—•]*(vista\s+)?(macro|micro)(scop\w*|sc[oó]pic\w*)?(\s+y\s+micro)?[\s\-–—•]*:?[\s\-–—•]*((vista\s+)?(macro|micro)\s*:?)?\s*$/i;
  const DESCRITIVA = /vista\s+(macro|micro)\s*:|^(macro|micro)\s*:|^comentarios?\b|^(se\s+observa|se\s+aprecia|presencia\s+de|figura\s+\d)/i;
  /** "Tumor de Wilms – vista micro" / "Adenocarcinoma (micro)" -> {t: "Tumor de Wilms", vista: "Micro"} */
  function separarVista(t) {
    const p = String(t || "").match(/^(?:vista\s+)?(macro|micro)(?:scop[ií]a|sc[oó]pic[oa])?\s*[-–—:]\s*(.+)$/i);
    if (p && letras(p[2]) >= 3) return { t: p[2].trim(), vista: p[1][0].toUpperCase() + p[1].slice(1).toLowerCase() };
    const m = String(t || "").match(/^(.*?)[\s\-–—(]+(?:vista\s+)?(macro|micro)(?:sc[oó]pic[oa])?\)?\s*:?\s*$/i);
    if (m && letras(m[1]) >= 3) return { t: m[1].trim(), vista: m[2][0].toUpperCase() + m[2].slice(1).toLowerCase() };
    return { t: String(t || ""), vista: "" };
  }
  /**
   * Escolhe a resposta entre as linhas de uma página: [{t, h (tamanho da letra), y?, x?, titulo?, dentro? (sobre a foto)}].
   * - "Diagnóstico: X" ganha; "Órgano: Y" vai para o órgão.
   * - Linha com marcador ("• NEOPLASIAS RENALES") é a seção: vai para o conteúdo, não para a resposta.
   * - Pula repetidas (cabeçalho), números soltos, rótulos ("MACRO:") e linhas sem letras.
   * - Pontua o resto: tamanho da letra, mais no alto da página vale mais; texto corrido, descrição ("vista micro:"),
   *   começo em minúscula ou com "-" valem menos. A melhor linha pode juntar a de baixo (mesmo tamanho, logo abaixo,
   *   curtas): "ADENOMA" + "PLEOMORFO" -> "ADENOMA PLEOMORFO".
   * op.altura: altura da página (para saber o que está no alto).
   */
  function escolherResposta(linhas, rep, op = {}) {
    rep = rep || new Set();
    let orgao = "", diag = "", secao = "";
    const boas = [];
    const palavras = (t) => t.split(/\s+/).filter(Boolean).length;
    const maiusc = (t) => { const L = t.match(/\p{L}/gu) || []; return L.length ? L.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length / L.length : 0; };
    const lista = [];
    for (const l of linhas || []) { // "Tumor de Wilms • NEOPLASIAS RENALES" na mesma linha: duas partes
      const partes = String(l.t || "").split(/\s+(?=[•●▪■◦‣►▶➢◆]\s)/);
      partes.forEach((t) => lista.push({ ...l, t }));
    }
    for (const l of lista) {
      let t = String(l.t || "").replace(/\s+/g, " ").trim(); if (!t) continue;
      const m = t.match(/^(?:[oó]rg[aã]o|organo|órgano|organ)\s*[:\-–]\s*(.+)$/i);
      if (m) { orgao = orgao || limparResposta(m[1]).slice(0, 120); continue; }
      const d = t.match(/^(?:diagn[oó]stic[oa]|dx|resposta|respuesta|diag\.)\s*[:\-–]\s*(.+)$/i);
      if (d) { diag = diag || limparResposta(d[1]); continue; }
      if (rep.has(normal(t)) || letras(t) < 3 || /^(https?:|www\.)/i.test(t) || ROTULO.test(t)) continue;
      if (BALA.test(t)) { // seção (só se for curta e não for rótulo como "• MICRO:")
        const sx = t.replace(BALA, "").replace(/[\s:]+$/, "").trim();
        if (!secao && letras(sx) >= 3 && palavras(sx) <= 8 && !ROTULO.test(sx) && (maiusc(sx) >= 0.6 || palavras(sx) <= 3) && !DESCRITIVA.test(sx)) secao = sx.slice(0, 120);
        continue;
      }
      if (!secao && op.largura && op.altura && l.x != null && l.y != null && l.x > op.largura * 0.4 && l.y < op.altura * 0.15
        && maiusc(t) >= 0.8 && palavras(t) <= 6 && lista.length > 1 && !DESCRITIVA.test(t) && !/\b(vista|macro|micro)/i.test(t)) { secao = t.replace(/[\s:]+$/, "").slice(0, 120); continue; } // "PATOLOGIAS DEL ESTÓMAGO" no canto de cima
      let nota = +l.h || 1;
      const fraco = /^(tinci[oó]n|colora[cç][aã]o|aumento|hematoxilina|he\b|h\s*&\s*e|\d+\s*x\b)/i.test(t) && (linhas || []).length > 1;
      if (fraco) nota *= 0.3;
      if (DESCRITIVA.test(t)) nota *= 0.4;
      if (palavras(t) > 6) nota *= 0.5;
      if (/^[\p{Ll}\-–(*]/u.test(t)) nota *= 0.5;
      if (/:\s*$/.test(t)) nota *= 0.6;
      if (op.altura && l.y != null && l.y < op.altura * 0.22) nota *= 1.3;
      if (l.dentro) nota *= palavras(t) <= 2 ? 0.15 : 0.5; // rótulo curto sobre a foto (seta, letra) quase não conta
      if (l.titulo) nota *= 10;
      boas.push({ ...l, t, nota });
    }
    const fim = (r) => { const v = separarVista(r); return { resposta: limparResposta(v.t), orgao, secao, vista: v.vista }; };
    if (diag) return fim(diag);
    if (!boas.length) return { resposta: "", orgao, secao, vista: "" };
    const tit = boas.filter((l) => l.titulo);
    if (tit.length) return fim(tit.map((l) => l.t).join(" "));
    const best = boas.reduce((a, b) => (b.nota > a.nota * 1.05 ? b : a)); // empate: fica a de cima
    // continua na linha de baixo? (mesma letra, logo abaixo, perto na horizontal, curtas)
    let texto = best.t, ult = best;
    const junta = (l, ref) => Math.abs((+l.h || 0) - (+ref.h || 0)) <= (+ref.h || 0) * 0.1 && (l.x == null || ref.x == null || Math.abs(l.x - ref.x) <= ref.h * 4)
      && palavras(l.t) <= 6 && !DESCRITIVA.test(l.t) && !/^[\p{Ll}\-–(*]/u.test(l.t);
    // começo na linha de cima? ("ADENOMA" em cima de "PLEOMORFO")
    if (best.y != null && palavras(texto) <= 6) {
      const ant = boas.filter((l) => l !== best && l.y < best.y && best.y - l.y <= best.h * 1.7 && junta(l, best)).sort((a, b) => b.y - a.y)[0];
      if (ant) texto = ant.t + " " + texto;
    }
    for (let n = 0; n < 2 && best.y != null; n++) {
      const prox = boas.filter((l) => l !== ult && l.y > ult.y && l.y - ult.y <= ult.h * 1.7 && Math.abs((+l.h || 0) - (+ult.h || 0)) <= (+ult.h || 0) * 0.1
        && (l.x == null || ult.x == null || Math.abs(l.x - ult.x) <= ult.h * 4) && palavras(l.t) <= 6 && palavras(texto) <= 6 && !DESCRITIVA.test(l.t) && !/^[\p{Ll}\-–(*]/u.test(l.t))
        .sort((a, b) => a.y - b.y)[0];
      if (!prox) break; texto += " " + prox.t; ult = prox;
    }
    return fim(texto);
  }

  /* ----- PDF: onde estão as fotos na página (lista de operações do pdf.js) ----- */
  const mult = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  /** Retângulos [x1,y1,x2,y2] (espaço do PDF) de cada foto desenhada. ops = {fnArray, argsArray}; OPS = pdfjsLib.OPS. */
  function fotosDaPagina(ops, OPS) {
    const out = []; let ctm = [1, 0, 0, 1, 0, 0]; const pilha = [];
    const fn = ops.fnArray || [], args = ops.argsArray || [];
    const pinta = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject, OPS.paintImageXObjectRepeat].filter((x) => x != null));
    for (let i = 0; i < fn.length && i < 200000; i++) {
      const f = fn[i], a = args[i];
      if (f === OPS.save) { if (pilha.length < 500) pilha.push(ctm); }
      else if (f === OPS.restore) ctm = pilha.pop() || ctm;
      else if (f === OPS.transform && a && a.length >= 6) ctm = mult(ctm, a);
      else if (f === OPS.paintFormXObjectBegin) { pilha.push(ctm); const m = a && a[0]; if (m && m.length >= 6) ctm = mult(ctm, m); }
      else if (f === OPS.paintFormXObjectEnd) ctm = pilha.pop() || ctm;
      else if (pinta.has(f)) {
        const p = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
        const xs = p.map((q) => q[0]), ys = p.map((q) => q[1]);
        out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
    }
    return out;
  }
  /**
   * Área a recortar (coordenadas da página desenhada, origem no alto à esquerda) a partir dos retângulos das fotos
   * (já na mesma coordenada). Só fotos com 3% da página ou mais contam. null = sem foto; {cheia:true} = página toda.
   */
  function recorte(rets, w, h) {
    const A = w * h; if (!(A > 0)) return null;
    const grandes = (rets || []).map((r) => [Math.max(0, Math.min(r[0], r[2])), Math.max(0, Math.min(r[1], r[3])), Math.min(w, Math.max(r[0], r[2])), Math.min(h, Math.max(r[1], r[3]))])
      .filter((r) => r[2] > r[0] && r[3] > r[1] && (r[2] - r[0]) * (r[3] - r[1]) >= A * 0.03);
    if (!grandes.length) return null;
    // fundo do slide (imagem da página toda) não conta quando há fotos de verdade
    const fundo = (r) => (r[2] - r[0]) * (r[3] - r[1]) >= A * 0.85;
    if (grandes.some((r) => !fundo(r))) for (let i = grandes.length - 1; i >= 0; i--) if (fundo(grandes[i])) grandes.splice(i, 1);
    let [x1, y1, x2, y2] = grandes[0];
    for (const r of grandes) { x1 = Math.min(x1, r[0]); y1 = Math.min(y1, r[1]); x2 = Math.max(x2, r[2]); y2 = Math.max(y2, r[3]); }
    const m = Math.max(w, h) * 0.008; x1 = Math.max(0, x1 - m); y1 = Math.max(0, y1 - m); x2 = Math.min(w, x2 + m); y2 = Math.min(h, y2 + m);
    if ((x2 - x1) * (y2 - y1) >= A * 0.85) return { cheia: true, x: 0, y: 0, w, h, fotos: grandes };
    return { cheia: false, x: x1, y: y1, w: x2 - x1, h: y2 - y1, fotos: grandes };
  }
  /** Itens de texto do pdf.js -> linhas [{t, h, x, y}] (y de cima para baixo, coordenada da página desenhada). */
  function linhasPdf(itens, conv) {
    const its = [];
    for (const it of itens || []) {
      const s = String(it.str || ""); if (!s.trim()) continue;
      const tr = it.transform || [1, 0, 0, 1, 0, 0];
      const hh = Math.abs(it.height || Math.hypot(tr[2], tr[3])) || 1;
      const [x, y] = conv ? conv(tr[4], tr[5]) : [tr[4], -tr[5]];
      its.push({ s, x, y, h: hh, w: Math.abs(it.width || 0) });
    }
    its.sort((a, b) => a.y - b.y || a.x - b.x);
    const linhas = [];
    for (const it of its) {
      const l = linhas.find((q) => Math.abs(q.y - it.y) <= Math.max(q.h, it.h) * 0.5);
      const hl = letras(it.s) ? it.h : 0; // "*" ou seta grande não conta como letra grande
      if (l) { l.partes.push(it); l.h = Math.max(l.h, hl); }
      else linhas.push({ y: it.y, h: hl, partes: [it] });
    }
    // mesma altura mas longe na horizontal (título à esquerda, seção à direita): linhas separadas
    const sep = [];
    for (const l of linhas) {
      l.partes.sort((a, b) => a.x - b.x);
      let cur = { ...l, partes: [] }, fim = null;
      for (const p of l.partes) {
        if (fim != null && p.x - fim > Math.max(p.h, l.h || p.h) * 1.5) { sep.push(cur); cur = { ...l, partes: [] }; }
        cur.partes.push(p); fim = p.x + p.w;
      }
      sep.push(cur);
    }
    sep.forEach((l) => { const hs = l.partes.filter((p) => letras(p.s)).map((p) => p.h); l.h = hs.length ? Math.max(...hs) : 0; });
    sep.sort((a, b) => a.y - b.y || a.partes[0].x - b.partes[0].x);
    return sep.map((l) => {
      let t = "", fim = null;
      for (const p of l.partes) { if (fim != null && p.x - fim > p.h * 0.15 && !/\s$/.test(t) && !/^\s/.test(p.s)) t += " "; t += p.s; fim = p.x + p.w; }
      return { t: t.replace(/\s+/g, " ").trim(), h: l.h || Math.max(...l.partes.map((p) => p.h)), y: l.y, x: l.partes[0].x, x2: fim };
    }).filter((l) => l.t);
  }

  /* ----- PowerPoint (.pptx) ----- */
  const X = () => g.Extrair;
  /** Linhas de um pedaço de XML do Office (a:p), com o tamanho da letra (sz) quando houver. */
  function linhasA(xml) {
    const out = [];
    for (const p of String(xml || "").split("</a:p>")) {
      let t = ""; for (const m of p.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\b[^>]*\/>|<a:tab\s*\/>/g)) t += m[1] !== undefined ? X().desfazEntidades(m[1]) : " ";
      if (!t.trim()) continue;
      const sz = (p.match(/<a:rPr\b[^>]*\ssz="(\d+)"/) || p.match(/<a:endParaRPr\b[^>]*\ssz="(\d+)"/) || [])[1];
      out.push({ t: t.replace(/\s+/g, " ").trim(), h: sz ? +sz / 100 : 0 });
    }
    return out;
  }
  /** Um slide (XML) -> {linhas:[{t,h,titulo}], fotos:[{rid, area}]} */
  function lerSlidePptx(xml) {
    xml = String(xml || "");
    const linhas = [], fotos = [];
    for (const m of xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)) {
      const sp = m[0];
      const ph = sp.match(/<p:ph\b[^>]*>/); const tipo = ph ? (X().atributo(ph[0], "type") || "") : "";
      const titulo = /^(title|ctrTitle)$/.test(tipo);
      if (/^(sldNum|dt|ftr|hdr)$/.test(tipo)) continue;
      const blip = sp.match(/<a:blip\b[^>]*r:embed="([^"]+)"/);
      if (blip) fotos.push({ rid: blip[1], area: areaExt(sp) });
      linhasA(sp).forEach((l) => linhas.push({ ...l, titulo }));
    }
    for (const m of xml.matchAll(/<p:pic\b[\s\S]*?<\/p:pic>/g)) {
      const blip = m[0].match(/<a:blip\b[^>]*r:embed="([^"]+)"/); if (blip) fotos.push({ rid: blip[1], area: areaExt(m[0]) });
    }
    // tabelas e outros quadros com texto
    for (const m of xml.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) linhasA(m[0]).forEach((l) => linhas.push({ ...l, titulo: false }));
    return { linhas, fotos };
  }
  function areaExt(x) { const m = String(x).match(/<a:ext\s+cx="(\d+)"\s+cy="(\d+)"/); return m ? (+m[1]) * (+m[2]) : 0; }

  /* ----- OpenDocument (.odp / .odt) ----- */
  const CM = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72, pc: 2.54 / 6, px: 2.54 / 96 };
  const medida = (v) => { const m = String(v || "").match(/^([\d.]+)\s*(cm|mm|in|pt|pc|px)?$/); return m ? +m[1] * (CM[m[2] || "cm"] || 1) : 0; };
  const textoOdf = (frag) => String(frag || "").split(/<\/text:(?:p|h)>/).map((p) => X().desfazEntidades(p.replace(/<text:(?:s|tab|line-break)\b[^>]*\/>/g, " ").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim()).filter(Boolean);
  /** content.xml de um .odp -> [{linhas, fotos:[{href, area}]}] por slide */
  function slidesOdp(xml) {
    const out = [];
    for (const pg of String(xml || "").matchAll(/<draw:page\b[\s\S]*?<\/draw:page>/g)) {
      const linhas = [], fotos = [];
      const corpo = pg[0].replace(/<presentation:notes\b[\s\S]*?<\/presentation:notes>/g, "");
      for (const fr of corpo.matchAll(/<draw:frame\b[^>]*>[\s\S]*?<\/draw:frame>/g)) {
        const abre = fr[0].match(/^<draw:frame\b[^>]*>/)[0];
        const classe = X().atributo(abre, "presentation:class") || "";
        if (/^(page-number|footer|header|date-time)$/.test(classe)) continue;
        const im = fr[0].match(/<draw:image\b[^>]*xlink:href="([^"]+)"/);
        if (im && !/^(https?:|\.\.\/)/i.test(im[1])) fotos.push({ href: X().desfazEntidades(im[1]).replace(/^\.\//, ""), area: medida(X().atributo(abre, "svg:width")) * medida(X().atributo(abre, "svg:height")) });
        textoOdf(fr[0]).forEach((t) => linhas.push({ t, h: 0, titulo: classe === "title" }));
      }
      out.push({ linhas, fotos });
    }
    return out;
  }

  /* ----- Word (.docx) e .odt: fotos na ordem, com o parágrafo de perto ----- */
  /** XML do corpo -> eventos em ordem: {p: texto} ao fechar cada parágrafo, {img: id} para cada foto. */
  function eventosTexto(xml, odt) {
    const ev = [], pilha = [];
    const re = odt
      ? /<text:(p|h)\b[^>]*?(\/?)>|<\/text:(?:p|h)>|<text:(?:s|tab|line-break)\b[^>]*\/>|<draw:image\b[^>]*?xlink:href="([^"]+)"[^>]*>|<(svg:title|svg:desc|office:annotation)\b[^>]*>[\s\S]*?<\/\4>|<[^>]*>|([^<]+)/g
      : /<w:p\b[^>]*?(\/?)>|<\/w:p>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:(?:tab|br|cr)\b[^>]*\/>|<a:blip\b[^>]*?r:embed="([^"]+)"|<v:imagedata\b[^>]*?r:id="([^"]+)"/g;
    for (const m of String(xml || "").matchAll(re)) {
      const s = m[0];
      if (odt) {
        if (/^<text:(p|h)\b/.test(s)) { if (m[2] === "/") ev.push({ p: "" }); else pilha.push({ t: "" }); }
        else if (/^<\/text:/.test(s)) { const p = pilha.pop(); if (p) ev.push({ p: X().desfazEntidades(p.t).replace(/\s+/g, " ").trim() }); }
        else if (m[3]) ev.push({ img: X().desfazEntidades(m[3]).replace(/^\.\//, "") });
        else if (/^<text:(s|tab|line-break)\b/.test(s)) { if (pilha.length) pilha[pilha.length - 1].t += " "; }
        else if (m[5] && pilha.length) pilha[pilha.length - 1].t += m[5];
      } else {
        if (/^<w:p\b/.test(s)) { if (m[1] === "/") ev.push({ p: "" }); else pilha.push({ t: "" }); }
        else if (s === "</w:p>") { const p = pilha.pop(); if (p) ev.push({ p: p.t.replace(/\s+/g, " ").trim() }); }
        else if (m[2] !== undefined) { if (pilha.length) pilha[pilha.length - 1].t += X().desfazEntidades(m[2]); }
        else if (m[3] || m[4]) ev.push({ img: m[3] || m[4] });
        else if (pilha.length) pilha[pilha.length - 1].t += " ";
      }
    }
    return ev;
  }
  /** Para cada foto: o primeiro parágrafo com texto logo depois (até 3, sem passar de outra foto); se não, o de antes. */
  function legendas(ev) {
    const out = [];
    ev.forEach((e, i) => {
      if (!e.img) return;
      let txt = "";
      for (let j = i + 1, n = 0; j < ev.length && n < 3; j++) { if (ev[j].img) break; if (ev[j].p != null) { n++; if (letras(ev[j].p) >= 3) { txt = ev[j].p; break; } } }
      if (!txt) for (let j = i - 1, n = 0; j >= 0 && n < 3; j--) { if (ev[j].img) break; if (ev[j].p != null) { n++; if (letras(ev[j].p) >= 3) { txt = ev[j].p; break; } } }
      out.push({ id: e.img, texto: txt });
    });
    return out;
  }

  /* ----- PowerPoint antigo (.ppt): fotos do fluxo "Pictures" ----- */
  function fotosPpt(u8) {
    const out = []; let o = 0, n = 0;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    while (o + 8 <= u8.length && n++ < 5000) {
      const tipo = dv.getUint16(o + 2, true), tam = dv.getUint32(o + 4, true), ini = o + 8, fim = ini + tam;
      if (fim > u8.length || tam < 0) break;
      if (tipo === 0xF01D || tipo === 0xF02A || tipo === 0xF01E) {
        const png = tipo === 0xF01E;
        for (let k = ini; k < Math.min(ini + 80, fim - 4); k++) {
          if (png ? (u8[k] === 0x89 && u8[k + 1] === 0x50 && u8[k + 2] === 0x4E && u8[k + 3] === 0x47) : (u8[k] === 0xFF && u8[k + 1] === 0xD8 && u8[k + 2] === 0xFF)) {
            out.push({ mime: png ? "image/png" : "image/jpeg", bytes: u8.subarray(k, fim) }); break;
          }
        }
      }
      o = fim;
    }
    return out;
  }

  /* ================= navegador ================= */
  const pausa = () => new Promise((ok) => setTimeout(ok, 0));
  const MIME_IMG = { jpg: "image/jpeg", jpeg: "image/jpeg", jfif: "image/jpeg", jpe: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", heic: "image/heic", heif: "image/heif", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff", emf: "image/emf", wmf: "image/wmf", svg: "image/svg+xml" };
  const extDe = (n) => ((String(n || "").match(/\.([a-z0-9]{1,5})$/i) || [])[1] || "").toLowerCase();
  const toBlob = (c, q) => new Promise((ok) => c.toBlob(ok, "image/jpeg", q));
  /** Desenha (ImageBitmap ou canvas) em JPEG até ~450 KB (nunca mais de 590 KB) e uma miniatura. */
  async function jpeg(src, w, h) {
    let lado = Math.min(LIM.lado, Math.max(w, h)), q = 0.86, blob = null;
    const c = document.createElement("canvas"), g2 = c.getContext("2d");
    for (let i = 0; i < 10; i++) {
      const k = lado / Math.max(w, h); c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
      g2.fillStyle = "#fff"; g2.fillRect(0, 0, c.width, c.height); g2.drawImage(src, 0, 0, c.width, c.height);
      blob = await toBlob(c, q);
      if (blob && blob.size <= LIM.alvo) break;
      if (q > 0.66) q -= 0.08; else lado = Math.round(lado * 0.85);
    }
    if (!blob || blob.size > LIM.max) { c.width = c.height = 0; throw new Error("Não consegui reduzir essa imagem."); }
    const kt = Math.min(1, LIM.thumb / Math.max(w, h)); c.width = Math.max(1, Math.round(w * kt)); c.height = Math.max(1, Math.round(h * kt));
    g2.fillStyle = "#fff"; g2.fillRect(0, 0, c.width, c.height); g2.drawImage(src, 0, 0, c.width, c.height);
    const thumb = await toBlob(c, 0.72);
    const uniforme = desvio(g2, c.width, c.height) < 4; // toda preta, toda branca ou de uma cor só
    c.width = c.height = 0;
    return { blob, thumb, uniforme };
  }
  /** Desvio do cinza da imagem (0 = de uma cor só). */
  function desvio(g2, w, h) {
    try {
      const d = g2.getImageData(0, 0, w, h).data; let s1 = 0, s2 = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; s1 += v; s2 += v * v; n++; }
      const m = s1 / n; return Math.sqrt(Math.max(0, s2 / n - m * m));
    } catch (_) { return 99; }
  }
  const SEM_IMAGEM = "A imagem saiu em branco ou de uma cor só: veio desmarcada. Confira antes de usar.";
  async function deBytes(bytes, mime) {
    const bm = await createImageBitmap(new Blob([bytes], { type: mime || "" }));
    try {
      if (Math.max(bm.width, bm.height) < LIM.fotoMin) return { pequena: true };
      return await jpeg(bm, bm.width, bm.height);
    } finally { try { bm.close(); } catch (_) { } }
  }
  function farejar(u8, nome, mime) {
    const ini = String.fromCharCode.apply(null, u8.subarray(0, 1024));
    if (ini.indexOf("%PDF-") >= 0) return "pdf";
    if (u8[0] === 0x50 && u8[1] === 0x4B && (u8[2] === 3 || u8[2] === 5)) return "zip";
    if (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) return "cfb";
    if ((u8[0] === 0xFF && u8[1] === 0xD8) || (u8[0] === 0x89 && u8[1] === 0x50) || /^GIF8/.test(ini) || /^RIFF....WEBP/.test(ini) || /^BM/.test(ini) || /^....ftyp(heic|heix|mif1|avif|hevc)/.test(ini)) return "imagem";
    if (/^image\//.test(mime || "") || IMG_EXT.test(nome || "")) return "imagem";
    return null;
  }
  const NAO = {
    doc: "Word antigo (.doc): abra no Word e salve como .docx ou PDF para importar as fotos.",
    ppt: "Não achei fotos neste PowerPoint antigo (.ppt). Abra no PowerPoint e salve como .pptx ou PDF.",
    outro: "formato que o laminário não lê. Use PDF, PowerPoint (.pptx), Word (.docx), OpenDocument, fotos ou .zip de fotos.",
    heic: "não consegui abrir essa foto (HEIC do iPhone) neste navegador. Mande como JPG (no iPhone: Ajustes → Câmera → Formatos → Mais compatível) ou tire um print.",
  };

  /**
   * Lê os arquivos, um de cada vez (página por página), e devolve as lâminas para conferir.
   * op: {carregarPdfjs, carregarJSZip, prog(msg)}
   */
  async function lerArquivos(files, op = {}) {
    const prog = typeof op.prog === "function" ? op.prog : () => { };
    const itens = [], avisos = [], sugestoes = new Set();
    let k = 0, grupo = 0;
    const cheio = () => itens.filter((x) => !x.extra).length >= LIM.itens;
    const novo = (f, onde, r, extra) => {
      const it = { k: ++k, origem: f.name, onde, blob: r.blob, thumb: r.thumb, resposta: "", orgao: "", vista: "", tema: "", usar: true, motivo: "", grupo: 0, extra: !!extra, nFotos: 1, ...extra };
      if (r.uniforme) { it.usar = false; it.motivo = SEM_IMAGEM; } // nunca salvar imagem preta/branca sem o aluno ver
      itens.push(it); return it;
    };
    const lista = [...(files || [])].slice(0, LIM.arquivos);
    if ((files || []).length > LIM.arquivos) avisos.push(`Até ${LIM.arquivos} arquivos por vez: os outros ficaram de fora (importe depois).`);
    for (let fi = 0; fi < lista.length; fi++) {
      const f = lista[fi], cab = lista.length > 1 ? `Arquivo ${fi + 1} de ${lista.length} (${f.name}): ` : "";
      if (cheio()) { avisos.push(`${f.name}: não lido, já são ${LIM.itens} lâminas nesta importação.`); continue; }
      if (f.size > LIM.arquivoBytes) { avisos.push(`${f.name}: arquivo grande demais (mais de 80 MB). Divida em partes.`); continue; }
      if (!f.size) { avisos.push(`${f.name}: o arquivo está vazio.`); continue; }
      const antes = itens.length;
      try {
        prog(cab + "abrindo…");
        const u8 = new Uint8Array(await f.arrayBuffer());
        const tipo = farejar(u8, f.name, f.type);
        if (tipo === "pdf") await lerPdf(f, u8);
        else if (tipo === "zip") await lerZip(f, u8);
        else if (tipo === "cfb") await lerCfb(f, u8);
        else if (tipo === "imagem") {
          let r; try { r = await deBytes(u8, f.type || MIME_IMG[extDe(f.name)]); } catch (_) { throw new Error(/heic|heif/i.test(extDe(f.name) + f.type) ? NAO.heic : "não consegui abrir essa imagem. Use JPG ou PNG."); }
          if (r.pequena) throw new Error("imagem pequena demais (parece um ícone).");
          const it = novo(f, "", r); it.resposta = respostaDoNome(f.name); it.tema = temaDoArquivo(f.name, true);
        } else throw new Error(NAO.outro);
        if (itens.length === antes) avisos.push(`${f.name}: não achei nenhuma foto.`);
      } catch (e) {
        avisos.push(`${f.name}: ${String((e && e.message) || e).replace(/^\w/, (c) => c.toLowerCase())}`);
      }
      await pausa();
    }
    return { itens, avisos, sugestoes: [...sugestoes].slice(0, 400) };

    /* ---------- PDF ---------- */
    async function lerPdf(f, u8) {
      const lib = await op.carregarPdfjs();
      let doc;
      try { doc = await lib.getDocument({ data: u8, isEvalSupported: false }).promise; }
      catch (e) { throw new Error(/password/i.test((e && e.name) + (e && e.message)) ? "esse PDF tem senha. Tire a senha e tente de novo." : "não consegui abrir esse PDF (parece corrompido)."); }
      const tema = temaDoArquivo(f.name);
      try {
        const n = Math.min(doc.numPages, LIM.paginas), pags = [];
        if (doc.numPages > LIM.paginas) avisos.push(`${f.name}: só as primeiras ${LIM.paginas} páginas foram lidas.`);
        let brancas = 0;
        for (let i = 1; i <= n && !cheio(); i++) {
          prog(`${f.name}: lendo a página ${i} de ${n}…`);
          const pg = await doc.getPage(i);
          try {
            const vp1 = pg.getViewport({ scale: 1 });
            const conv = (x, y) => vp1.convertToViewportPoint(x, y);
            const rets = fotosDaPagina(await pg.getOperatorList(), lib.OPS).map((r) => { const v = vp1.convertToViewportRectangle(r); return [Math.min(v[0], v[2]), Math.min(v[1], v[3]), Math.max(v[0], v[2]), Math.max(v[1], v[3])]; });
            const linhas = linhasPdf((await pg.getTextContent()).items, conv);
            const rc = recorte(rets, vp1.width, vp1.height);
            if (!rc && !linhas.length) { brancas++; continue; }
            linhas.forEach((l) => { l.dentro = !!(rc && !rc.cheia && rc.fotos.some((r) => l.x >= r[0] - 2 && l.x <= r[2] && l.y >= r[1] && l.y <= r[3] + l.h)); });
            const inteira = { x: 0, y: 0, w: vp1.width, h: vp1.height };
            const desenhar = async (area) => {
              const s = Math.min(4, LIM.lado / Math.max(area.w, area.h), Math.sqrt(4.2e6 / (area.w * area.h)));
              const vp = pg.getViewport({ scale: s, offsetX: -area.x * s, offsetY: -area.y * s });
              const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(area.w * s)); c.height = Math.max(1, Math.round(area.h * s));
              const g2 = c.getContext("2d"); g2.fillStyle = "#fff"; g2.fillRect(0, 0, c.width, c.height); // fundo branco (transparente vira preto no JPEG)
              await pg.render({ canvasContext: g2, viewport: vp, background: "#ffffff" }).promise;
              // esconde o texto escrito por cima da área (nome da lâmina, descrição): no treino a resposta não pode aparecer.
              // Rótulos curtos (seta, letra, "*") ficam.
              g2.fillStyle = "#e9e6e0";
              if (rc) for (const l of linhas) {
                if (letras(l.t) < 4 && l.t.split(/\s+/).length < 2) continue;
                const x1 = (l.x - area.x) * s - 2, x2 = ((l.x2 ?? l.x) - area.x) * s + 2, y1 = (l.y - l.h * 0.95 - area.y) * s - 1, y2 = (l.y + l.h * 0.3 - area.y) * s + 1;
                if (x2 <= 0 || y2 <= 0 || x1 >= c.width || y1 >= c.height) continue;
                g2.fillRect(x1, y1, x2 - x1, y2 - y1);
              }
              try { return await jpeg(c, c.width, c.height); } finally { c.width = c.height = 0; }
            };
            let r = await desenhar(rc && !rc.cheia ? rc : inteira);
            if (r.uniforme && rc && !rc.cheia) r = await desenhar(inteira); // recorte vazio: usa a página inteira
            const it = novo(f, `pág. ${i}`, r); it.tema = tema;
            if (!rc) { it.usar = false; it.motivo = "Página de separação ou só com texto (sem foto): veio desmarcada."; }
            else if (r.uniforme) { it.usar = false; it.motivo = SEM_IMAGEM; }
            pags.push({ it, linhas, altura: vp1.height, largura: vp1.width, foto: !!rc });
          } finally { pg.cleanup(); }
          await pausa();
        }
        if (brancas) avisos.push(`${f.name}: ${brancas} página${brancas > 1 ? "s" : ""} em branco pulada${brancas > 1 ? "s" : ""}.`);
        const rep = repetidas(pags.map((p) => p.linhas.map((l) => l.t)));
        // seção ("• NEOPLASIAS RENALES") vira o conteúdo e vale para as páginas seguintes, até a próxima seção
        // ou uma página de separação (sem foto)
        let secao = "";
        for (const p of pags) {
          const e = escolherResposta(p.linhas, rep, { altura: p.altura, largura: p.largura });
          if (!p.foto) secao = ""; else if (e.secao) secao = e.secao;
          p.it.resposta = e.resposta; p.it.orgao = e.orgao; p.it.vista = e.vista; if (p.foto && secao) p.it.tema = secao;
          p.linhas.forEach((l) => { if (!rep.has(normal(l.t)) && letras(l.t) >= 3 && !BALA.test(l.t) && !ROTULO.test(l.t)) sugestoes.add(limparResposta(separarVista(l.t).t)); });
        }
      } finally { try { doc.destroy(); } catch (_) { } }
    }

    /* ---------- ZIP: PowerPoint, Word, OpenDocument ou pasta de fotos ---------- */
    async function lerZip(f, u8) {
      const JSZip = await op.carregarJSZip();
      const z = await X().abrirZip(JSZip, u8);
      if (z.tem("ppt/presentation.xml")) return lerPptx(f, z);
      if (z.tem("word/document.xml")) return lerDocx(f, z);
      if (z.tem("content.xml")) {
        const mt = (await z.texto("mimetype")) || "";
        if (/presentation/.test(mt) || (!/text/.test(mt) && /<office:presentation\b/.test((await z.texto("content.xml")) || ""))) return lerOdp(f, z);
        if (/text/.test(mt)) return lerOdt(f, z);
        throw new Error("planilha não tem lâminas. Use PDF, PowerPoint, Word ou fotos.");
      }
      if (z.tem("xl/workbook.xml")) throw new Error("planilha não tem lâminas. Use PDF, PowerPoint, Word ou fotos.");
      // .zip com fotos
      const nomes = z.nomes.filter((n) => IMG_EXT.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n)).sort((a, b) => a.localeCompare(b, "pt", { numeric: true }));
      if (!nomes.length) throw new Error("não achei fotos dentro do .zip.");
      let ruins = 0;
      for (let i = 0; i < nomes.length && !cheio(); i++) {
        prog(`${f.name}: foto ${i + 1} de ${nomes.length}…`);
        try { const r = await deBytes(await z.bytes(nomes[i]), MIME_IMG[extDe(nomes[i])]); if (r.pequena) continue;
          const it = novo(f, nomes[i].replace(/^.*\//, ""), r); it.resposta = respostaDoNome(nomes[i]); it.tema = temaDoArquivo(nomes[i].includes("/") ? nomes[i].replace(/\/[^/]*$/, "").replace(/^.*\//, "") : f.name); }
        catch (_) { ruins++; }
        await pausa();
      }
      if (ruins) avisos.push(`${f.name}: ${ruins} foto${ruins > 1 ? "s" : ""} em formato que o navegador não abre (ficou de fora).`);
    }
    async function fotosDe(f, z, base, fotos, rels, chave) {
      const out = [];
      for (const ft of fotos) {
        let alvo;
        if (rels) { const r = rels.get(ft.rid); if (!r || r.externo) continue; alvo = X().resolver(base, r.alvo); }
        else alvo = ft.href;
        out.push({ ...ft, alvo });
      }
      return out;
    }
    async function guardarSlide(f, z, onde, linhas, fotos, ruinsRef, tema, rep) {
      if (!fotos.length) return 0;
      fotos.sort((a, b) => b.area - a.area);
      const gid = ++grupo; let primeiro = null, n = 0;
      for (const ft of fotos) {
        let r;
        try { r = await deBytes(await z.bytes(ft.alvo), MIME_IMG[extDe(ft.alvo)]); } catch (_) { ruinsRef.n++; continue; }
        if (r.pequena) continue;
        const it = novo(f, onde, r, primeiro ? { extra: true } : undefined);
        it.grupo = gid; it.tema = tema; it.linhas = linhas; n++;
        if (!primeiro) primeiro = it; else it.usar = false;
        if (n >= 8) break;
      }
      if (primeiro) primeiro.nFotos = n;
      return n;
    }
    async function lerPptx(f, z) {
      const pres = (await z.texto("ppt/presentation.xml")) || "";
      const rels = X().relacoes(await z.texto("ppt/_rels/presentation.xml.rels"));
      let slides = [];
      for (const t of pres.match(/<p:sldId\b[^>]*>/g) || []) { const r = rels.get(X().atributo(t, "r:id")); if (r && !r.externo) slides.push(X().resolver("ppt/presentation.xml", r.alvo)); }
      slides = slides.filter((s) => z.tem(s));
      if (!slides.length) slides = z.nomes.map((n) => ({ n, m: n.match(/^ppt\/slides\/slide(\d+)\.xml$/) })).filter((x) => x.m).sort((a, b) => +a.m[1] - +b.m[1]).map((x) => x.n);
      const lidos = [];
      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const sl = lerSlidePptx(await z.texto(s));
        const rs = X().relacoes(await z.texto(s.replace(/([^/]+)$/, "_rels/$1.rels")));
        lidos.push({ i, linhas: sl.linhas, fotos: await fotosDe(f, z, s, sl.fotos, rs) });
      }
      await slidesComFotos(f, z, lidos, "slide");
    }
    async function lerOdp(f, z) {
      const sl = slidesOdp(await z.texto("content.xml"));
      await slidesComFotos(f, z, sl.map((s, i) => ({ i, linhas: s.linhas, fotos: s.fotos.map((ft) => ({ ...ft, alvo: ft.href })).filter((ft) => z.tem(ft.alvo)) })), "slide");
    }
    async function slidesComFotos(f, z, lidos, pal) {
      const tema = temaDoArquivo(f.name);
      // foto que aparece em muitos slides (logo da faculdade) não é lâmina
      const cont = new Map(); lidos.forEach((s) => new Set(s.fotos.map((x) => x.alvo)).forEach((a) => cont.set(a, (cont.get(a) || 0) + 1)));
      const enfeite = (a) => lidos.length >= 3 && cont.get(a) >= Math.max(3, Math.ceil(lidos.length * 0.5));
      const rep = repetidas(lidos.map((s) => s.linhas.map((l) => l.t)));
      const ruins = { n: 0 }; let sem = 0;
      for (const s of lidos) {
        if (cheio()) break;
        prog(`${f.name}: lendo o ${pal} ${s.i + 1} de ${lidos.length}…`);
        const fotos = s.fotos.filter((x) => !enfeite(x.alvo));
        const n = await guardarSlide(f, z, `${pal} ${s.i + 1}`, s.linhas, fotos, ruins, tema, rep);
        if (!n) sem++;
        await pausa();
      }
      for (const it of itens) if (it.linhas) { const e = escolherResposta(it.linhas, rep); it.resposta = e.resposta; it.orgao = e.orgao; it.vista = e.vista; if (e.secao) it.tema = e.secao.slice(0, 120); it.linhas.forEach((l) => { if (!rep.has(normal(l.t)) && letras(l.t) >= 3) sugestoes.add(limparResposta(l.t)); }); delete it.linhas; }
      if (sem) avisos.push(`${f.name}: ${sem} ${pal}${sem > 1 ? "s" : ""} sem foto (capa, texto) ${sem > 1 ? "ficaram" : "ficou"} de fora.`);
      if (ruins.n) avisos.push(`${f.name}: ${ruins.n} foto${ruins.n > 1 ? "s" : ""} em formato que o navegador não abre (por exemplo .emf ou .tiff). Se faltar alguma, salve como PDF e importe o PDF.`);
    }
    async function fotosDoTexto(f, z, ev, achar) {
      const tema = temaDoArquivo(f.name), lg = legendas(ev), vistos = new Set(); let ruins = 0;
      for (let i = 0; i < lg.length && !cheio(); i++) {
        const alvo = achar(lg[i].id); if (!alvo || vistos.has(alvo) || !z.tem(alvo)) continue; vistos.add(alvo);
        prog(`${f.name}: foto ${i + 1} de ${lg.length}…`);
        let r; try { r = await deBytes(await z.bytes(alvo), MIME_IMG[extDe(alvo)]); } catch (_) { ruins++; continue; }
        if (r.pequena) continue;
        const it = novo(f, `foto ${vistos.size}`, r); it.tema = tema;
        const e = escolherResposta([{ t: lg[i].texto, h: 1 }]); it.resposta = e.resposta; it.orgao = e.orgao; it.vista = e.vista;
        if (lg[i].texto) sugestoes.add(limparResposta(lg[i].texto));
        await pausa();
      }
      if (ruins) avisos.push(`${f.name}: ${ruins} foto${ruins > 1 ? "s" : ""} em formato que o navegador não abre ficaram de fora.`);
    }
    async function lerDocx(f, z) {
      const rels = X().relacoes(await z.texto("word/_rels/document.xml.rels"));
      const ev = eventosTexto(await z.texto("word/document.xml"));
      await fotosDoTexto(f, z, ev, (rid) => { const r = rels.get(rid); return r && !r.externo ? X().resolver("word/document.xml", r.alvo) : null; });
    }
    async function lerOdt(f, z) {
      const ev = eventosTexto(await z.texto("content.xml"), true);
      await fotosDoTexto(f, z, ev, (href) => /^(https?:|\.\.\/)/i.test(href) ? null : href);
    }
    /* ---------- arquivos antigos do Office ---------- */
    async function lerCfb(f, u8) {
      const cfb = X().lerCFB(u8);
      if (cfb.tem("WordDocument")) throw new Error(NAO.doc);
      if (!cfb.tem("PowerPoint Document")) throw new Error(NAO.outro);
      if (cfb.tem("EncryptedSummary")) throw new Error("este PowerPoint tem senha. Tire a senha e tente de novo.");
      const pics = cfb.tem("Pictures") ? fotosPpt(cfb.stream("Pictures")) : [];
      if (!pics.length) throw new Error(NAO.ppt);
      try { // títulos dos slides, para escolher a resposta numa lista
        const t = await X().extrair(u8, { nome: f.name, carregarJSZip: op.carregarJSZip, carregarPdfjs: op.carregarPdfjs });
        String(t.texto || "").split(/\n\s*\n/).forEach((b) => { const l = b.split("\n").filter((x) => !/^Slide \d+$/.test(x) && letras(x) >= 3)[0]; if (l) sugestoes.add(limparResposta(l)); });
      } catch (_) { }
      const tema = temaDoArquivo(f.name); let ruins = 0, n = 0;
      for (let i = 0; i < pics.length && !cheio(); i++) {
        prog(`${f.name}: foto ${i + 1} de ${pics.length}…`);
        let r; try { r = await deBytes(pics[i].bytes, pics[i].mime); } catch (_) { ruins++; continue; }
        if (r.pequena) continue;
        const it = novo(f, `foto ${++n}`, r); it.tema = tema;
        await pausa();
      }
      if (n) avisos.push(`${f.name}: no PowerPoint antigo (.ppt) não dá para saber o nome de cada slide. Escreva as respostas (a lista sugere os títulos) ou salve como .pptx/PDF e importe de novo.`);
      if (ruins) avisos.push(`${f.name}: ${ruins} foto${ruins > 1 ? "s" : ""} não abriram.`);
    }
  }
  /** Nome do arquivo -> conteúdo para filtrar (até 120 letras). */
  function temaDoArquivo(nome, foto) {
    if (foto) return "";
    const t = semPrefixo(String(nome || "").replace(/^.*[\\/]/, "")).replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
    return t.slice(0, 120);
  }

  const API = { lerArquivos, ACCEPT, LIM, semPrefixo, separarVista, limparResposta, respostaDoNome, repetidas, escolherResposta, fotosDaPagina, recorte, linhasPdf,
    lerSlidePptx, slidesOdp, eventosTexto, legendas, fotosPpt, temaDoArquivo };
  g.Laminario = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
