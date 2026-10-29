// Importar documentos da faculdade: VÁRIOS arquivos de QUALQUER formato de uma vez.
// Usado pela configuração (app.html, passo 3) e pelo cartão "Enviar arquivos e documentos" (assets/painel.js).
// - lerArquivos(): para cada arquivo tira o texto no navegador (PDF com as colunas, Word, Excel, PowerPoint, OpenDocument,
//   .rtf, .csv, .html, .txt) ou, se for foto ou página escaneada, manda a imagem para a pasta privada "tarefas"
//   do Storage; cria uma tarefa da IA por arquivo (até 3 ao mesmo tempo) e espera cada uma, com prazo.
// - novaRevisao() / adicionar(): junta os resultados de todos os arquivos (e de importações seguidas) numa revisão só,
//   sem repetir e sem apagar o que já estava lá. Data diferente para a mesma prova: as duas ficam à vista e vem marcada
//   a do documento mais específico (cronograma de provas > outros > calendário acadêmico); empate: fica a que já estava.
// Nada é salvo aqui: quem salva é a tela, depois de o aluno conferir.
// O arquivo também roda no Node/Deno (sem window) para os testes da junção.
(function (g) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  /* ---------- o que a IA entendeu ---------- */
  const TIPO = { calendario_geral: "Calendário acadêmico", cronograma_provas: "Cronograma de provas", horario_aulas: "Horário de aulas", programa_materia: "Programa de matéria",
    regulamento: "Regulamento", aviso: "Aviso", material_de_estudo: "Material de estudo: não usado aqui", outro: "Documento" };
  /** Quanto o documento é "específico" para as datas das provas. */
  const PRIO = { cronograma_provas: 3, calendario_geral: 1 };
  const prioDe = (tipo) => PRIO[tipo] ?? 2;
  const PRIO_EXISTENTE = 2; // o que o aluno já tinha (digitado ou salvo antes)

  /* ---------- junção (pura, testada) ---------- */
  function novaRevisao() { return { arquivos: [], provas: [], eventos: [], horarios: [], materias: [], notas: [], tarefas: [] }; }
  const chaveProva = (p) => `${p.disciplina_id != null && p.disciplina_id !== "" ? "d" + p.disciplina_id : "n" + norm(p.materia)}|${p.tipo}|${p.modalidade || "teorica"}`;
  const mesmaData = (a, b) => a.data === b.data && (!a.hora || !b.hora || a.hora === b.hora);
  function resolverConflito(grupo) {
    if (grupo.length < 2) return;
    let venc = grupo[0];
    for (const r of grupo) if (r.prio > venc.prio) venc = r; // empate: fica o primeiro (o que já estava)
    for (const r of grupo) { r.conflito = true; r.ok = r === venc && r.disciplina_id != null && r.disciplina_id !== ""; }
  }
  /**
   * Junta o resultado de um arquivo (resposta da ação "documento") na revisão R. Não apaga nada do que já estava.
   * op: { casar(nome, id) -> disciplina_id|null, existente(prova) -> {data, hora, fonte, prio}|null, noCalendario(evento) -> bool, tarefa_id }
   * Devolve quantos itens novos entraram.
   */
  function adicionar(R, res, nome, op = {}) {
    res = res || {};
    if (op.tarefa_id != null) { if (R.tarefas.includes(op.tarefa_id)) return 0; R.tarefas.push(op.tarefa_id); }
    const tipo = TIPO[res.tipo] ? res.tipo : "outro";
    const arq = R.arquivos.length;
    R.arquivos.push({ nome: String(nome || res.nome || "Documento"), tipo, titulo: res.titulo || "", resumo: res.resumo || "", aviso: res.aviso || "", itens: 0 });
    if (tipo === "material_de_estudo") return 0;
    const casar = op.casar || ((n, id) => id ?? null), prio = prioDe(tipo), fonte = R.arquivos[arq].nome;
    let n = 0;
    for (const p0 of res.provas || []) {
      if (!p0 || !p0.data) continue;
      const p = { materia: String(p0.materia || ""), tipo: p0.tipo, modalidade: p0.modalidade === "pratica" ? "pratica" : "teorica", data: p0.data, hora: p0.hora || null };
      p.disciplina_id = casar(p.materia, p0.disciplina_id);
      const k = chaveProva(p);
      const grupo = R.provas.filter((x) => chaveProva(x) === k);
      const igual = grupo.find((x) => mesmaData(x, p));
      if (igual) { if (!igual.fontes.includes(fonte)) igual.fontes.push(fonte); if (!igual.hora && p.hora) igual.hora = p.hora; if (prio > igual.prio) igual.prio = prio; continue; }
      if (!grupo.length && op.existente) {
        const ex = op.existente(p);
        if (ex && ex.data) {
          if (mesmaData(ex, p)) continue; // já está preenchida assim
          const linha = { ...p, data: ex.data, hora: ex.hora || null, fontes: [ex.fonte || "Já preenchido"], prio: ex.prio ?? PRIO_EXISTENTE, existente: true, arq: -1, ok: true };
          R.provas.push(linha); grupo.push(linha);
        }
      }
      const nova = { ...p, fontes: [fonte], prio, arq, ok: p.disciplina_id != null && p.disciplina_id !== "" };
      R.provas.push(nova); grupo.push(nova); n++;
      resolverConflito(grupo);
    }
    for (const e of res.eventos || []) {
      if (!e || !e.titulo || !e.data_ini) continue;
      const k = norm(e.titulo) + "|" + e.data_ini;
      const ja = R.eventos.find((x) => norm(x.titulo) + "|" + x.data_ini === k);
      if (ja) { if (!ja.fontes.includes(fonte)) ja.fontes.push(fonte); if (!ja.data_fim && e.data_fim) ja.data_fim = e.data_fim; continue; }
      const rep = !!(op.noCalendario && op.noCalendario(e));
      R.eventos.push({ titulo: e.titulo, data_ini: e.data_ini, data_fim: e.data_fim || null, categoria: e.categoria || "outro", descricao: e.descricao || "", fontes: [fonte], arq, ok: !rep, repetido: rep }); n++;
    }
    R.eventos.sort((a, b) => a.data_ini.localeCompare(b.data_ini));
    for (const h of res.horarios || []) {
      if (!h || !h.hora_ini || !h.hora_fim || !h.dia_semana) continue;
      const d = casar(h.materia, h.disciplina_id);
      const k = `${d ?? norm(h.materia)}|${h.dia_semana}|${h.hora_ini}`;
      const ja = R.horarios.find((x) => `${x.disciplina_id ?? norm(x.materia)}|${x.dia_semana}|${x.hora_ini}` === k);
      if (ja) { if (!ja.fontes.includes(fonte)) ja.fontes.push(fonte); if (!ja.sala && h.sala) ja.sala = h.sala; continue; }
      R.horarios.push({ materia: String(h.materia || ""), disciplina_id: d, dia_semana: +h.dia_semana, hora_ini: h.hora_ini, hora_fim: h.hora_fim, sala: h.sala || "", fontes: [fonte], arq, ok: true }); n++;
    }
    R.horarios.sort((a, b) => a.dia_semana - b.dia_semana || a.hora_ini.localeCompare(b.hora_ini));
    for (const m of res.materias || []) {
      if (!m || !m.nome || R.materias.some((x) => norm(x.nome) === norm(m.nome))) continue;
      const d = casar(m.nome, m.disciplina_id);
      R.materias.push({ nome: m.nome, professor: m.professor || "", disciplina_id: d, arq, ok: true }); if (d == null) n++;
    }
    for (const x of res.notas || []) {
      if (!x || !x.titulo || !x.texto || R.notas.some((y) => norm(y.titulo) === norm(x.titulo) && norm(y.texto).slice(0, 80) === norm(x.texto).slice(0, 80))) continue;
      R.notas.push({ titulo: x.titulo, texto: x.texto, arq, ok: true }); n++;
    }
    R.arquivos[arq].itens = n;
    return n;
  }
  /** Quantos itens a revisão tem para o painel (matérias que já existem não contam). */
  const totalItens = (R) => R ? R.provas.length + R.eventos.length + R.horarios.length + R.materias.filter((m) => m.disciplina_id == null).length + R.notas.length : 0;

  /* ---------- telas (pedaços de HTML; os nomes são sempre escapados) ---------- */
  const ST = { fila: ["", "na fila"], preparando: ["s-warn", "abrindo"], enviando: ["s-warn", "enviando"], lendo: ["s-warn", "lendo com IA"], pronto: ["s-ok", "lido"], erro: ["s-bad", "erro"] };
  /** "2 de 3 lidos · 1 com erro" */
  function progressoTexto(itens) {
    const n = itens.length, ok = itens.filter((x) => x.st === "pronto").length, er = itens.filter((x) => x.st === "erro").length;
    const rod = n - ok - er;
    return `${ok} de ${n} ${n === 1 ? "lido" : "lidos"}${er ? ` · ${er} com erro` : ""}${rod ? "…" : ""}`;
  }
  /** Lista dos arquivos que estão sendo lidos, com o estado de cada um. */
  function progressoHTML(itens) {
    if (!itens || !itens.length) return "";
    return `<p class="imp-prog-tit" aria-live="polite"><b>${esc(progressoTexto(itens))}</b></p><ul class="up-lista imp-lista">${itens.map((x) => { const [cls, txt] = x.st === "pronto" && x.tipo ? [x.tipo === "material_de_estudo" ? "" : "s-ok", TIPO[x.tipo]] : ST[x.st] || ["", x.st];
      return `<li><span class="drv-nome"><span>${esc(x.nome)}</span>${x.msg ? `<span class="tref imp-msg ${x.st === "erro" ? "bad" : ""}" style="display:block">${esc(x.msg)}</span>` : ""}</span><span class="chip ${cls}">${esc(txt)}</span></li>`; }).join("")}</ul>`;
  }
  /** Chips do que a IA entendeu de cada arquivo da revisão, com o aviso. */
  function arquivosHTML(R) {
    if (!R || !R.arquivos.length) return "";
    return `<ul class="imp-arqs">${R.arquivos.map((a) => `<li><span class="chip ${a.tipo === "material_de_estudo" ? "" : "s-ok"}">${esc(TIPO[a.tipo] || "Documento")}</span> <span class="imp-arq-nome">${esc(a.nome)}</span>${a.titulo && a.titulo !== a.nome ? ` <span class="muted">· ${esc(a.titulo)}</span>` : ""}${a.tipo !== "material_de_estudo" ? ` <span class="muted">· ${a.itens} ${a.itens === 1 ? "item" : "itens"}</span>` : ""}${a.aviso ? `<span class="imp-aviso">${esc(a.aviso)}</span>` : ""}</li>`).join("")}</ul>`;
  }
  const CATEG = [["feriado", "Feriado"], ["prova", "Provas"], ["matricula", "Matrícula"], ["aula", "Aulas"], ["recesso", "Recesso"], ["prazo", "Prazo"], ["outro", "Outro"]];
  const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const chk = (sec, i, on, rot) => `<input type="checkbox" data-sec="${sec}" data-i="${i}" data-k="ok" ${on ? "checked" : ""} aria-label="Usar ${esc(rot)}">`;
  const inp = (sec, i, k, v, extra = "") => `<input data-sec="${sec}" data-i="${i}" data-k="${k}" value="${esc(v ?? "")}" ${extra}>`;
  const fontes = (x) => x.fontes && x.fontes.length ? `<span class="rev-fonte">De: ${esc(x.fontes.join(", "))}</span>` : "";
  function eventosHTML(lista) {
    return `<div class="tablewrap rev-wrap"><table class="rev"><thead><tr><th>Usar</th><th>Evento</th><th>Início</th><th>Fim</th><th>Tipo</th></tr></thead><tbody>${lista.map((e, i) => `<tr><td>${chk("eventos", i, e.ok, e.titulo)}</td>
      <td>${inp("eventos", i, "titulo", e.titulo, `maxlength="120" aria-label="Evento"`)}${e.repetido ? `<span class="muted" style="display:block;font-size:12px">já está no calendário</span>` : ""}${fontes(e)}</td>
      <td>${inp("eventos", i, "data_ini", e.data_ini, 'type="date" aria-label="Início"')}</td><td>${inp("eventos", i, "data_fim", e.data_fim, 'type="date" aria-label="Fim"')}</td>
      <td><select data-sec="eventos" data-i="${i}" data-k="categoria" aria-label="Tipo">${CATEG.map(([k, l]) => `<option value="${k}" ${e.categoria === k ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`;
  }
  /** disc: [{id, nome}] (no painel, os ids do banco; na configuração, a posição na lista) */
  function horariosHTML(lista, disc) {
    return `<div class="tablewrap rev-wrap"><table class="rev"><thead><tr><th>Usar</th><th>Matéria</th><th>Dia</th><th>Início</th><th>Fim</th><th>Sala</th></tr></thead><tbody>${lista.map((h, i) => `<tr><td>${chk("horarios", i, h.ok, h.materia)}</td>
      <td><span class="rev-doc">${esc(h.materia)}</span><select data-sec="horarios" data-i="${i}" data-k="disciplina_id" aria-label="Matéria de ${esc(h.materia)}"><option value="">Outra (o nome do documento)</option>${(disc || []).map((x) => `<option value="${esc(x.id)}" ${h.disciplina_id != null && String(x.id) === String(h.disciplina_id) ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select>${fontes(h)}</td>
      <td><select data-sec="horarios" data-i="${i}" data-k="dia_semana" aria-label="Dia">${DIAS.map((n, j) => `<option value="${j + 1}" ${+h.dia_semana === j + 1 ? "selected" : ""}>${n}</option>`).join("")}</select></td>
      <td>${inp("horarios", i, "hora_ini", h.hora_ini, 'type="time" aria-label="Início"')}</td><td>${inp("horarios", i, "hora_fim", h.hora_fim, 'type="time" aria-label="Fim"')}</td><td>${inp("horarios", i, "sala", h.sala, 'maxlength="60" aria-label="Sala"')}</td></tr>`).join("")}</tbody></table></div>`;
  }
  /** Guarda na revisão o que o aluno mudou num campo (data-sec/data-i/data-k). Devolve true se era da revisão. */
  function guardarCampo(R, el) {
    if (!R || !el || !el.dataset || !el.dataset.sec) return false;
    const it = (R[el.dataset.sec] || [])[+el.dataset.i]; if (!it) return false;
    const k = el.dataset.k;
    it[k] = el.type === "checkbox" ? el.checked : k === "disciplina_id" ? (el.value === "" ? null : +el.value) : k === "dia_semana" ? +el.value : el.value;
    return true;
  }

  /* ---------- leitura dos arquivos ---------- */
  const ehImagem = (f) => /^image\//.test(f.type || "") || /\.(jpe?g|jfif|png|webp|heic|heif|gif|bmp)$/i.test(f.name || "");
  const ehPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
  const LIMITE_PASTA = 19;          // a pasta "tarefas" aceita menos de 20 imagens por aluno (08_tarefas.sql)
  const MAX_IMG_ARQ = 10;           // por documento (a função ia aceita até 10)
  const MAX_MB = 40;
  const PRAZO_MS = 3 * 60 * 1000;   // depois disso a leitura de um arquivo é dada como "demorou"
  /** Formatos aceitos aqui: todos os de texto + fotos. */
  function aceitar() { return (g.Extrair ? g.Extrair.ACCEPT + "," : ".pdf,") + "image/*,.jpg,.jpeg,.png,.webp,.heic,.heif"; }
  const FORMATOS = "PDF, Word, Excel, PowerPoint, OpenDocument, .rtf, .csv, .html, .txt ou foto (JPG, PNG, WebP)";
  /** O arquivo serve aqui? Devolve a mensagem de recusa, ou "". */
  function recusa(f) {
    if (ehImagem(f) || ehPdf(f)) return f.size > MAX_MB * 1048576 ? `Arquivo grande demais (mais de ${MAX_MB} MB).` : "";
    const tp = g.Extrair && g.Extrair.tipoDoArquivo(f.name, f.type);
    if (!tp || tp.semTexto) return g.Extrair ? g.Extrair.naoAceito(f.name, f.type) : "Tipo de arquivo não aceito.";
    return f.size > MAX_MB * 1048576 ? `Arquivo grande demais (mais de ${MAX_MB} MB).` : "";
  }

  // orçamento de imagens da pasta "tarefas", dividido entre todas as leituras desta página
  const IMG = { livres: 0, cap: 0, ativos: 0, fila: [] };
  function reservar(n, prazo) {
    if (n <= IMG.livres) { IMG.livres -= n; return Promise.resolve(); }
    return new Promise((ok, falha) => {
      const it = { n, ok }; IMG.fila.push(it);
      setTimeout(() => { const i = IMG.fila.indexOf(it); if (i >= 0) { IMG.fila.splice(i, 1); falha(new Error("Há muitas páginas em foto esperando a IA. Tente este arquivo de novo daqui a alguns minutos.")); } }, prazo);
    });
  }
  function liberar(n) {
    IMG.livres += n;
    while (IMG.fila.length && IMG.fila[0].n <= IMG.livres) { const it = IMG.fila.shift(); IMG.livres -= it.n; it.ok(); }
  }
  async function imagensNaPasta(sb, uid) {
    try {
      const { data } = await sb.storage.from("tarefas").list(uid, { limit: 100 });
      const lim = Date.now() - 15 * 60 * 1000;
      const L = (data || []).filter((o) => o.name && o.name !== ".emptyFolderPlaceholder");
      const velhas = L.filter((o) => new Date(o.created_at || o.updated_at || 0).getTime() < lim).map((o) => `${uid}/${o.name}`);
      if (velhas.length) await sb.storage.from("tarefas").remove(velhas); // sobras de leituras antigas
      return L.length - velhas.length;
    } catch (_) { return 0; }
  }
  /** Apaga as páginas-imagem que sobraram de leituras antigas (mais de 15 minutos). */
  async function limparImagensVelhas(sb, uid) { await imagensNaPasta(sb, uid); }

  /** Um arquivo -> {texto, imagens:[Blob], formato, cortado} (lança Error com a mensagem para o aluno). */
  async function preparar(f, d, prog, maxImg) {
    const r = recusa(f); if (r) throw new Error(r);
    if (ehImagem(f) || ehPdf(f)) {
      try {
        const p = await g.Leitor.prepararDocumento(f, d.carregarPdfjs, prog, { imagens: maxImg });
        return { texto: p.texto, imagens: p.imagens, formato: ehPdf(f) ? "pdf" : "imagem", cortado: p.cortado, paginasImagem: p.paginasImagem };
      } catch (e) {
        if (/\.(heic|heif)$/i.test(f.name) || /hei[cf]/i.test(f.type || "")) throw new Error("Foto HEIC (do iPhone) não abre neste navegador. Tire um print da foto ou mande em JPG.");
        throw e;
      }
    }
    const tp = g.Extrair.tipoDoArquivo(f.name, f.type);
    let r2;
    try { r2 = await g.Extrair.extrair(new Uint8Array(await f.arrayBuffer()), { tipo: tp.tipo, nome: f.name, mime: f.type, carregarJSZip: d.carregarJSZip, carregarPdfjs: d.carregarPdfjs, prog: (_, m) => m && prog(m) }); }
    catch (e) { throw new Error(e.message || "Não consegui ler este arquivo."); }
    const texto = String(r2.texto || "").replace(/\u0000/g, " ").trim();
    if (texto.replace(/\s+/g, "").length < 30) throw new Error("Não achei texto neste arquivo.");
    return { texto: texto.slice(0, 140000), imagens: [], formato: r2.formato || tp.tipo, cortado: texto.length > 140000 };
  }
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const MUITAS = /tarefas da IA rodando|Espere uma terminar/i;

  /**
   * Lê vários arquivos de uma vez. d = {
   *   sb, uid, chamar(nome, corpo) | criar(corpo), buscar() -> [tarefas], vista(ids), carregarPdfjs, carregarJSZip,
   *   extra: {semestre, turma, materias} (configuração), aoMudar(itens), aoPronto(item, resultado), paralelo=3, prazoMs, intervalo
   * }. Devolve {itens, fim: Promise} (fim resolve quando todos terminaram, com erro ou não).
   */
  function lerArquivos(files, d) {
    const itens = [...files].map((f, i) => ({ id: `${Date.now()}-${i}`, nome: f.name, f, st: "fila", msg: "", tipo: null, tarefa: null }));
    const prazo = d.prazoMs || g.__prazoImportarMs || PRAZO_MS, intervalo = d.intervalo || 4000, paralelo = d.paralelo || 3;
    const mudou = () => { try { d.aoMudar && d.aoMudar(itens); } catch (e) { console.error(e); } };
    const criar = d.criar || ((corpo) => d.chamar("ia", { ...corpo, fundo: true }));
    const buscar = d.buscar || (async () => { const { data, error } = await d.sb.rpc("minhas_tarefas", { p_limite: 30 }); if (error) throw error; return data || []; });
    const vista = d.vista || ((ids) => d.sb.rpc("tarefa_vista", { p_ids: ids }));
    // quem espera a IA: um laço só pergunta ao servidor por todos
    const esperando = new Map();
    let laco = null;
    function esperar(id) {
      return new Promise((ok, falha) => {
        esperando.set(id, { ok, falha, ate: Date.now() + prazo });
        if (!laco) laco = (async () => {
          while (esperando.size) {
            await espera(intervalo);
            let lista = null;
            try { lista = await buscar(); } catch (_) { /* internet: tenta de novo na próxima volta */ }
            for (const [tid, w] of [...esperando]) {
              const t = lista && lista.find((x) => x.id === tid);
              if (t && (t.status === "pronta" || t.status === "vista")) { esperando.delete(tid); w.ok(t.resultado || {}); }
              else if (t && t.status === "erro") { esperando.delete(tid); w.falha(new Error(t.erro || "A IA não conseguiu ler este arquivo.")); }
              else if (Date.now() > w.ate) { esperando.delete(tid); w.falha(Object.assign(new Error("A leitura demorou mais de 3 minutos. Continue preenchendo à mão; se ela terminar depois, aparece em Tarefas."), { demorou: true })); }
            }
          }
          laco = null;
        })();
      });
    }
    async function um(it) {
      const prog = (m) => { it.msg = m; mudou(); };
      let reservadas = 0, caminhos = [];
      try {
        it.st = "preparando"; prog("Abrindo…");
        // imagens por arquivo: o que cabe na pasta dividido entre os que vão ao mesmo tempo
        const fotos = itens.filter((x) => (ehImagem(x.f) || ehPdf(x.f)) && x.st !== "pronto" && x.st !== "erro").length || 1;
        const porArquivo = Math.max(1, Math.min(MAX_IMG_ARQ, Math.floor(Math.max(1, IMG.cap) / Math.min(paralelo, fotos))));
        const prep = await preparar(it.f, d, prog, porArquivo);
        if (prep.imagens.length) {
          if (!IMG.cap) throw new Error("A pasta das fotos está cheia agora (outras leituras terminando). Tente este arquivo de novo daqui a alguns minutos.");
          if (prep.imagens.length > IMG.cap) { prep.imagens = prep.imagens.slice(0, IMG.cap); prep.cortado = true; }
          it.st = "enviando"; prog(prep.imagens.length > 1 ? "Esperando a vez para enviar as páginas em foto…" : "Esperando a vez para enviar a foto…");
          await reservar(prep.imagens.length, prazo); reservadas = prep.imagens.length;
          for (let i = 0; i < prep.imagens.length; i++) {
            prog(prep.imagens.length > 1 ? `Enviando as páginas em foto (${i + 1} de ${prep.imagens.length})…` : "Enviando a foto…");
            const caminho = `${d.uid}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.jpg`;
            const up = await d.sb.storage.from("tarefas").upload(caminho, prep.imagens[i], { contentType: "image/jpeg", upsert: false });
            if (up.error) throw new Error(/bucket|not found/i.test(up.error.message) ? "Falta rodar o 08_tarefas.sql no Supabase." : /row-level|security|policy/i.test(up.error.message) ? "A pasta das fotos está cheia agora (outras leituras terminando). Tente este arquivo de novo daqui a alguns minutos." : "Não consegui enviar a imagem: " + up.error.message);
            caminhos.push(caminho);
          }
        }
        const corpo = { acao: "documento", nome: it.nome.slice(0, 150), formato: prep.formato, ...(prep.texto ? { texto: prep.texto } : {}), ...(caminhos.length ? { imagem_caminhos: caminhos } : {}), ...(d.extra || {}) };
        prog("Mandando para a IA…");
        let r = null; const ate = Date.now() + prazo;
        for (;;) {
          try { r = await criar(corpo); break; }
          catch (e) { if (MUITAS.test(e.message || "") && Date.now() < ate) { prog("Esperando outras tarefas da IA terminarem…"); await espera(5000); continue; } throw e; }
        }
        it.tarefa = r.tarefa_id; caminhos = []; // agora as imagens são da tarefa (o servidor apaga quando termina)
        it.st = "lendo"; prog(`A IA está lendo${prep.cortado ? " (o arquivo é grande: vai só o começo)" : ""}…`);
        const res = await esperar(r.tarefa_id);
        it.st = "pronto"; it.tipo = res.tipo || "outro"; it.msg = prep.cortado ? "Arquivo grande: a IA leu só o começo (até " + (prep.imagens.length ? prep.imagens.length + " páginas em foto" : "120 mil letras") + ")." : "";
        try { await vista([r.tarefa_id]); } catch (_) { }
        try { d.aoPronto && d.aoPronto(it, res); } catch (e) { console.error(e); }
      } catch (e) {
        it.st = "erro"; it.msg = e.message || "Não consegui ler este arquivo.";
        if (caminhos.length) { try { await d.sb.storage.from("tarefas").remove(caminhos); } catch (_) { } }
      } finally {
        if (reservadas) liberar(reservadas);
        it.f = null; // o arquivo não fica guardado
        mudou();
      }
    }
    const fim = (async () => {
      if (!IMG.ativos) { IMG.livres = IMG.cap = Math.max(0, LIMITE_PASTA - (d.sb ? await imagensNaPasta(d.sb, d.uid) : 0)); IMG.fila = []; }
      IMG.ativos++;
      try {
        const fila = itens.slice();
        const trab = Array.from({ length: Math.min(paralelo, fila.length) }, async () => { while (fila.length) await um(fila.shift()); });
        await Promise.all(trab);
      } finally { IMG.ativos--; }
      return itens;
    })();
    mudou();
    return { itens, fim };
  }

  const API = { TIPO, PRIO, prioDe, PRIO_EXISTENTE, novaRevisao, adicionar, chaveProva, totalItens, progressoTexto, progressoHTML, arquivosHTML, eventosHTML, horariosHTML,
    guardarCampo, lerArquivos, limparImagensVelhas, recusa, aceitar, FORMATOS, ehImagem, LIMITE_PASTA, PRAZO_MS, _IMG: IMG };
  g.ImportarDoc = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : globalThis);
