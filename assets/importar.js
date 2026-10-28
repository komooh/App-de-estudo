// Configurações → "Importar dados do painel antigo" (só o administrador vê o cartão).
// Lê o arquivo painel-dados-AAAA-MM-DD.json (versão 1) baixado no painel pessoal antigo, confere tudo
// no navegador, mostra a revisão (quantos de cada tipo) e grava no SEMESTRE ATUAL da conta de quem está
// logado, pelas mesmas tabelas e regras de acesso de sempre (RLS). Resumos, mapas e questões só o servidor
// grava; para eles há a função importar_painel (11_importar_painel.sql), que recusa quem não é admin.
// Rodar duas vezes não duplica nada: cada tipo é comparado pela "chave natural" (nome, data etc.).
// Todo texto do arquivo passa por esc() antes de ir para a tela.
(function () {
  const { sb, esc, toast } = App;
  const VERSAO = 1, MAX_MB = 15, LOTE = 200;
  const LIM = { disciplinas: 100, temas: 3000, provas: 1000, notas: 2000, horarios: 500, calendario: 1000, vida_eventos: 1000, ligas: 200, horas_compl: 1000, mapas: 3000, questoes: 10000 };
  const TIPOS = [["disciplinas", "Matérias"], ["temas", "Temas"], ["resumos", "Resumos"], ["mapas", "Mapas mentais"], ["provas", "Provas e avaliações"], ["notas", "Notas"],
    ["horarios", "Aulas (horários)"], ["calendario", "Calendário acadêmico"], ["vida_eventos", "Eventos"], ["ligas", "Ligas"], ["horas_compl", "Horas complementares"],
    ["questoes", "Questões"], ["preferencias", "Modelo dos resumos"]];
  const NOME = Object.fromEntries(TIPOS);

  /* ---------- utilidades ---------- */
  const semAcento = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const qNorm = (s) => semAcento(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); // igual ao do servidor (função ia)
  const baixa = (s) => String(s ?? "").trim().toLowerCase();
  const hhmm = (t) => String(t ?? "").slice(0, 5);
  const ehData = (s) => { if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(s + "T12:00:00Z"); return !isNaN(d) && d.toISOString().slice(0, 10) === s; };
  const ehHora = (s) => typeof s === "string" && /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s);
  const REF = /^[A-Za-z0-9_.:-]{1,40}$/;
  class Ruim extends Error { }
  const ruim = (m) => { throw new Ruim(m); };
  /** texto: obrigatório (min 1) ou opcional; maior que o limite = linha ignorada (o banco também recusaria) */
  function txt(v, max, nomeCampo, obrig) {
    if (v == null || v === "") { if (obrig) ruim(`${nomeCampo} vazio`); return null; }
    if (typeof v !== "string" && typeof v !== "number") ruim(`${nomeCampo} inválido`);
    const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
    if (!s) { if (obrig) ruim(`${nomeCampo} vazio`); return null; }
    if (s.length > max) ruim(`${nomeCampo} com mais de ${max} letras`);
    return s;
  }
  function numero(v, min, max, nomeCampo) {
    if (typeof v !== "number" || !isFinite(v)) ruim(`${nomeCampo} inválido`);
    if (v < min || v > max) ruim(`${nomeCampo} fora da faixa (${min} a ${max})`);
    return v;
  }
  const bool = (v) => v === true;
  const ref = (v, nomeCampo) => { if (typeof v !== "string" || !REF.test(v)) ruim(`${nomeCampo} inválida`); return v; };
  const rotulo = (r, i) => { const x = r && typeof r === "object" ? (r.nome ?? r.descricao ?? r.enunciado ?? r.titulo ?? r.campo ?? r.ref ?? r.tema_ref) : null; return `#${i + 1}` + (x != null ? " " + String(x).replace(/\s+/g, " ").slice(0, 60) : ""); };

  /* ---------- cada tipo: confere e devolve a linha no formato do site ---------- */
  const PROVA_TIPOS = ["P1", "P2", "Final", "Seminário", "Entrega", "Outra"];
  const CAMPOS_NOTA = ["p1", "p2", "final", "p1_pratica", "p2_pratica", "final_pratica", "presenca", "trabalhos"];
  const CAL_TIPOS = ["feriado", "parcial", "pratica", "final", "aulas", "outro"];
  const EV_ST = ["pend", "ins", "conf", "done"];
  function limparNo(n, nivel) { // como o servidor limpa os mapas: até 8 filhos, 4 níveis, 140 letras por nó
    if (!n || typeof n !== "object") return null;
    const t = String(n.t ?? n.texto ?? n.nome ?? "").replace(/\s+/g, " ").trim().slice(0, 140); if (!t) return null;
    const filhos = nivel < 4 && Array.isArray(n.filhos) ? n.filhos.map((x) => limparNo(x, nivel + 1)).filter(Boolean).slice(0, 8) : [];
    return { t, filhos };
  }
  function dadosQuestao(tipo, d) {
    if (!d || typeof d !== "object" || Array.isArray(d)) ruim("dados da questão ausentes");
    const s = (v, max, c) => txt(v, max, c, true);
    if (tipo === "mc") {
      if (!Array.isArray(d.opcoes) || d.opcoes.length < 2 || d.opcoes.length > 5) ruim("alternativas inválidas (2 a 5)");
      const op = d.opcoes.map((x) => s(x, 800, "alternativa"));
      if (!Number.isInteger(d.correta) || d.correta < 0 || d.correta >= op.length) ruim("alternativa correta fora das opções");
      return { opcoes: op, correta: d.correta };
    }
    if (tipo === "vf") {
      if (!Array.isArray(d.afirmativas) || d.afirmativas.length < 2 || d.afirmativas.length > 6) ruim("afirmativas inválidas (2 a 6)");
      return { afirmativas: d.afirmativas.map((a) => { if (!a || typeof a.v !== "boolean") ruim("afirmativa sem V/F"); return { texto: s(a.texto, 800, "afirmativa"), v: a.v, porque: txt(a.porque, 800, "explicação da afirmativa") || "" }; }) };
    }
    if (tipo === "rel") {
      const A = Array.isArray(d.colA) ? d.colA : [], B = Array.isArray(d.colB) ? d.colB : [], P = Array.isArray(d.pares) ? d.pares : [];
      if (A.length < 2 || A.length > 8 || B.length < A.length || B.length > 10 || P.length !== A.length || P.some((x) => !Number.isInteger(x) || x < 0 || x >= B.length) || new Set(P).size !== P.length) ruim("colunas ou pares inválidos");
      return { colA: A.map((x) => s(x, 400, "coluna 1")), colB: B.map((x) => s(x, 400, "coluna 2")), pares: P };
    }
    return { resposta: s(d.resposta, 5000, "resposta esperada") };
  }
  const NORMAL = {
    disciplinas: (r) => ({ ref: ref(r.ref, "ref"), nome: txt(r.nome, 120, "nome", true), professor: txt(r.professor, 120, "professor"), tem_pratica: bool(r.tem_pratica), foco_resumo: txt(r.foco_resumo, 2000, "foco do resumo") }),
    temas: (r) => {
      const itens = r.itens == null ? [] : Array.isArray(r.itens) ? r.itens : ruim("itens inválidos");
      if (itens.length > 60) ruim("mais de 60 itens");
      return { ref: ref(r.ref, "ref"), disciplina_ref: ref(r.disciplina_ref, "matéria (ref)"), nome: txt(r.nome, 120, "nome", true), prova: txt(r.prova, 40, "prova"),
        itens: itens.map((x) => txt(x, 200, "item", true)), aula: bool(r.aula), resumo_ok: bool(r.resumo_ok), questoes_ok: bool(r.questoes_ok) };
    },
    resumos: (r) => {
      const t = typeof r.resumo_texto === "string" ? r.resumo_texto.trim() : ruim("resumo inválido");
      if (t.length < 15) ruim("resumo vazio"); if (t.length > 200000) ruim("resumo com mais de 200 mil letras");
      return { tema_ref: ref(r.ref, "tema (ref)"), texto: t, truncado: bool(r.resumo_truncado), criado_em: typeof r.resumo_criado_em === "string" && /^\d{4}-\d{2}-\d{2}T/.test(r.resumo_criado_em) ? r.resumo_criado_em.slice(0, 40) : null };
    },
    mapas: (r) => {
      const ramos = (Array.isArray(r.ramos) ? r.ramos : []).map((x) => limparNo(x, 1)).filter(Boolean).slice(0, 8);
      if (!ramos.length) ruim("mapa sem ramos");
      const dados = { titulo: txt(r.titulo, 200, "título") || "", ramos };
      if (JSON.stringify(dados).length > 50000) ruim("mapa grande demais");
      return { tema_ref: ref(r.tema_ref, "tema (ref)"), dados, criado_em: typeof r.criado_em === "string" && /^\d{4}-\d{2}-\d{2}T/.test(r.criado_em) ? r.criado_em.slice(0, 40) : null };
    },
    provas: (r) => {
      if (!PROVA_TIPOS.includes(r.tipo)) ruim("tipo de prova inválido");
      const modalidade = r.modalidade == null ? "teorica" : ["teorica", "pratica"].includes(r.modalidade) ? r.modalidade : ruim("teórica/prática inválido");
      if (r.data != null && !ehData(r.data)) ruim("data inválida");
      if (r.hora != null && r.hora !== "" && !ehHora(r.hora)) ruim("hora inválida");
      return { disciplina_ref: ref(r.disciplina_ref, "matéria (ref)"), tipo: r.tipo, modalidade, titulo: txt(r.titulo, 80, "nome da avaliação"), data: r.data || null, hora: r.hora ? hhmm(r.hora) : null,
        pontos: r.pontos == null ? null : numero(r.pontos, 0, 1000, "pontos") };
    },
    notas: (r) => {
      if (!CAMPOS_NOTA.includes(r.campo)) ruim("campo da nota inválido");
      return { disciplina_ref: ref(r.disciplina_ref, "matéria (ref)"), campo: r.campo, valor: Math.round(numero(r.valor, -999.99, 999.99, "nota") * 100) / 100 };
    },
    horarios: (r) => {
      if (!Number.isInteger(r.dia) || r.dia < 1 || r.dia > 6) ruim("dia inválido (1 a 6)");
      if (!ehHora(r.inicio) || !ehHora(r.fim) || hhmm(r.fim) <= hhmm(r.inicio)) ruim("horário inválido");
      const disciplina_ref = r.disciplina_ref == null ? null : ref(r.disciplina_ref, "matéria (ref)"), nome = txt(r.nome, 120, "nome da aula");
      if (!disciplina_ref && !nome) ruim("aula sem matéria e sem nome");
      return { disciplina_ref, nome, professor: txt(r.professor, 120, "professor"), dia: r.dia, inicio: hhmm(r.inicio), fim: hhmm(r.fim) };
    },
    calendario: (r) => {
      if (!ehData(r.inicio)) ruim("data de início inválida");
      if (r.fim != null && (!ehData(r.fim) || r.fim < r.inicio)) ruim("data de fim inválida");
      return { nome: txt(r.nome, 160, "nome", true), tipo: CAL_TIPOS.includes(r.tipo) ? r.tipo : "outro", inicio: r.inicio, fim: r.fim && r.fim !== r.inicio ? r.fim : null };
    },
    vida_eventos: (r) => { if (!ehData(r.data)) ruim("data inválida"); return { nome: txt(r.nome, 160, "nome", true), detalhe: txt(r.detalhe, 200, "detalhe"), data: r.data, status: EV_ST.includes(r.status) ? r.status : "pend" }; },
    ligas: (r) => ({ nome: txt(r.nome, 120, "nome", true), papel: txt(r.papel, 160, "papel") }),
    horas_compl: (r) => ({ categoria: txt(r.categoria, 60, "categoria", true), descricao: txt(r.descricao, 200, "descrição", true), horas: Math.round(numero(r.horas, 0, 2000, "horas") * 10) / 10, certificado: bool(r.certificado) }),
    questoes: (r) => {
      const tipo = ["mc", "vf", "rel", "dis"].includes(r.tipo) ? r.tipo : ruim("tipo de questão inválido");
      const dados = dadosQuestao(tipo, r.dados);
      if (JSON.stringify(dados).length > 25000) ruim("questão grande demais");
      const cont = (v, c) => v == null ? 0 : Number.isInteger(v) && v >= 0 && v <= 100000 ? v : ruim(`${c} inválido`);
      return { disciplina_ref: ref(r.disciplina_ref, "matéria (ref)"), tema_ref: r.tema_ref == null ? null : ref(r.tema_ref, "tema (ref)"), tema: txt(r.tema, 200, "tema") || "Importada",
        tipo, enunciado: txt(r.enunciado, 6000, "enunciado", true), dados, explicacao: txt(r.explicacao, 6000, "explicação"),
        acertos: cont(r.acertos, "acertos"), erros: cont(r.erros, "erros"), ultima: typeof r.ultima === "boolean" ? r.ultima : null };
    },
  };
  /** chave da questão: igual a chaveQuestao() da função ia (o histórico usa a mesma, e a IA nunca repete) */
  function chaveQuestao(tipo, enunciado, d) {
    d = d || {}; let x = String(enunciado || "");
    if (tipo === "vf") x += " " + (d.afirmativas || []).map((a) => a.texto).join(" ");
    if (tipo === "rel") x += " " + (d.colA || []).join(" ");
    if (tipo === "mc") x += " " + (d.opcoes || []).join(" ");
    return qNorm(x).slice(0, 4000);
  }

  /* ---------- 1. conferir o arquivo (forma, versão e limites) ---------- */
  function conferir(texto) {
    let J;
    try { J = JSON.parse(texto); } catch (_) { throw new Error("O arquivo não é um JSON válido."); }
    if (!J || typeof J !== "object" || Array.isArray(J)) throw new Error("Arquivo em formato errado.");
    if (J.versao !== VERSAO) throw new Error(`Versão do arquivo não suportada (${String(J.versao ?? "sem versão").slice(0, 20)}). Baixe de novo no painel antigo.`);
    for (const k of Object.keys(LIM)) {
      if (J[k] == null) continue;
      if (!Array.isArray(J[k])) throw new Error(`Arquivo em formato errado: "${k}" não é uma lista.`);
      if (J[k].length > LIM[k]) throw new Error(`O arquivo tem ${J[k].length} itens em "${k}" (o máximo é ${LIM[k]}).`);
    }
    if (J.preferencias != null && (typeof J.preferencias !== "object" || Array.isArray(J.preferencias))) throw new Error('Arquivo em formato errado: "preferencias".');
    if (J.perfil != null && (typeof J.perfil !== "object" || Array.isArray(J.perfil))) throw new Error('Arquivo em formato errado: "perfil".');
    const v = {};
    const rodar = (tipo, lista, fn) => { v[tipo] = (lista || []).map((r, i) => { const item = rotulo(r, i);
      try { if (!r || typeof r !== "object" || Array.isArray(r)) ruim("item inválido"); return { ok: true, r: fn(r), item }; }
      catch (e) { if (!(e instanceof Ruim)) throw e; return { ok: false, item, motivo: e.message }; } }); };
    for (const k of Object.keys(LIM)) rodar(k, J[k], NORMAL[k]);
    const comResumo = (J.temas || []).filter((t) => t && typeof t === "object" && !Array.isArray(t) && t.resumo_texto != null);
    rodar("resumos", comResumo, NORMAL.resumos);
    const pr = J.preferencias || {};
    v.preferencias = pr.modelo_resumo == null || pr.modelo_resumo === "" ? [] : [(() => { try { return { ok: true, r: { modelo_resumo: txt(pr.modelo_resumo, 4000, "modelo do resumo", true) }, item: "modelo do resumo" }; } catch (e) { return { ok: false, item: "modelo do resumo", motivo: e.message }; } })()];
    const pf = J.perfil || {};
    const perfil = { nome: typeof pf.nome === "string" ? pf.nome.slice(0, 80) : "", semestre: Number.isInteger(pf.semestre) && pf.semestre >= 1 && pf.semestre <= 14 ? pf.semestre : null, turma: typeof pf.turma === "string" && /^[A-Z]{1,2}$/.test(pf.turma) ? pf.turma : "" };
    return { v, perfil, exportado: typeof J.exportado_em === "string" ? J.exportado_em.slice(0, 10) : "" };
  }

  /* ---------- estado do cartão ---------- */
  let st = { fase: "inicio" }, C = null;
  const pintar = () => { const el = document.getElementById("impBox"); if (el) el.innerHTML = html(C); };
  function novoResultado() { return Object.fromEntries(TIPOS.map(([k]) => [k, { imp: 0, ja: 0, err: 0 }])); }

  /* ---------- tela ---------- */
  function html(ctx) {
    C = ctx;
    const intro = `<p style="margin:0">Traga os dados do seu painel pessoal antigo para a sua conta do site. No painel antigo, abra <b>Configurações</b> e clique em <b>Baixar meus dados (para o site)</b>; depois escolha o arquivo aqui. Nada é salvo antes de você conferir.</p>
      <p class="muted" style="margin:6px 0 0;font-size:13px">Só você (administrador) vê este cartão. Tudo vai para o semestre atual da sua conta. Rodar de novo não duplica: o que já existe fica como está.</p>`;
    const escolher = (rotulo) => `<label class="btn ${st.fase === "inicio" ? "solid" : ""}" style="cursor:pointer">${rotulo}<input type="file" data-a="impArq" accept=".json,application/json" hidden></label>`;
    if (st.fase === "inicio") return `<div class="stack">${intro}<div class="row" style="align-items:center">${escolher("Escolher o arquivo (.json)")}</div>${st.msg ? `<div class="msg bad" style="margin:0" aria-live="polite">${esc(st.msg)}</div>` : ""}</div>`;
    const sem = ctx.H.SEM().atual;
    const destino = sem ? `${sem.numero ? sem.numero + "º semestre" : "semestre atual"}${sem.turma ? ", turma " + sem.turma : ""}` : "";
    const pf = st.perfil || {};
    const deQuem = `${pf.nome ? esc(pf.nome) + ", " : ""}${pf.semestre ? pf.semestre + "º semestre" : "semestre sem número"}${pf.turma ? ", turma " + esc(pf.turma) : ""}`;
    const linhas = TIPOS.filter(([k]) => (st.v[k] || []).length);
    if (st.fase === "revisao") {
      const conflitoPref = st.v.preferencias.some((x) => x.ok) && !!(ctx.S.pref || {}).modelo_resumo;
      return `<div class="stack">${intro}
        <div class="msg" style="margin:0">Arquivo <b>${esc(st.arquivo)}</b>${st.exportado ? ` (baixado em ${esc(st.exportado.split("-").reverse().join("/"))})` : ""}, de ${deQuem}. Vai para: <b>${esc(destino || "sem semestre atual")}</b>. Seu perfil no site não muda.</div>
        ${!sem ? `<div class="msg bad" style="margin:0">Você ainda não tem um semestre atual. Monte o semestre em Matérias e semestres e depois importe.</div>` : ""}
        <div class="tablewrap"><table class="imp"><thead><tr><th>Usar</th><th>Tipo</th><th class="n">No arquivo</th><th class="n">Com erro</th></tr></thead><tbody>
        ${linhas.map(([k, nome]) => { const L = st.v[k], bad = L.filter((x) => !x.ok).length;
          return `<tr><td><input type="checkbox" data-imp-tipo="${k}" ${st.marcar[k] ? "checked" : ""} aria-label="Importar ${esc(nome)}"></td><td>${esc(nome)}</td><td class="tnum">${L.length}</td><td class="tnum">${bad ? `<span style="color:var(--bad)">${bad}</span>` : "0"}</td></tr>`; }).join("")}
        </tbody></table></div>
        ${linhas.length ? "" : `<p class="muted" style="margin:0">O arquivo não tem nada para importar.</p>`}
        ${conflitoPref ? `<label class="check"><input type="checkbox" data-imp-pref ${st.trocarPref ? "checked" : ""}><span style="text-decoration:none;color:inherit">O site já tem um modelo dos resumos. Trocar pelo do arquivo</span></label>` : ""}
        <p class="muted" style="margin:0;font-size:13px">Os itens com erro (texto grande demais, data inválida, campo faltando) são pulados e entram na lista de erros. Matérias com o mesmo nome das que você já tem no semestre são reaproveitadas.</p>
        <div class="row"><button class="btn solid" data-a="impConfirmar" ${!sem || !linhas.length ? "disabled" : ""}>Importar</button><button class="btn ghost" data-a="impCancelar">Cancelar</button></div></div>`;
    }
    // rodando ou fim
    const R = st.res, P = st.prog || {};
    const fim = st.fase === "fim";
    const usados = linhas.filter(([k]) => st.marcar[k]);
    const totErr = st.erros.length;
    return `<div class="stack">${intro}
      <p style="margin:0" aria-live="polite">${fim ? `<b>Importação concluída.</b> ${esc(st.arquivo)} para ${esc(destino)}.` : `Importando… não feche esta página. <span class="muted">${esc(P.agora ? NOME[P.agora] : "")}</span>`}</p>
      <div class="tablewrap"><table class="imp"><thead><tr><th>Tipo</th><th class="n">Importados</th><th class="n">Já existiam</th><th class="n">Ignorados por erro</th></tr></thead><tbody>
      ${usados.map(([k, nome]) => { const r = R[k], p = P[k];
        return `<tr><td>${esc(nome)}${!fim && p && p.total ? `<progress max="${p.total}" value="${p.feitos}" aria-label="${esc(nome)}: ${p.feitos} de ${p.total}"></progress>` : ""}</td><td class="tnum">${r.imp}</td><td class="tnum">${r.ja}</td><td class="tnum">${r.err ? `<span style="color:var(--bad)">${r.err}</span>` : 0}</td></tr>`; }).join("")}
      </tbody></table></div>
      ${fim ? `${totErr ? `<details class="cfg"><summary>${totErr} ${totErr === 1 ? "item ignorado" : "itens ignorados"} por erro</summary><ul class="imp-erros">${st.erros.slice(0, 8).map((e) => `<li><b>${esc(NOME[e.tipo] || e.tipo)}</b> ${esc(e.item)}: ${esc(e.motivo)}</li>`).join("")}${totErr > 8 ? `<li class="muted">e mais ${totErr - 8} na lista completa</li>` : ""}</ul></details>` : ""}
        <div class="row">${totErr ? `<button class="btn" data-a="impErros">Baixar a lista de erros (.csv)</button>` : ""}<button class="btn ghost" data-a="impNovo">Importar outro arquivo</button></div>` : ""}</div>`;
  }

  /* ---------- 2. ler o arquivo escolhido ---------- */
  async function escolherArquivo(f) {
    if (!f) return;
    if (st.fase === "rodando") return;
    if (!/\.json$/i.test(f.name) && f.type !== "application/json") { st = { fase: "inicio", msg: "Escolha o arquivo .json baixado no painel antigo." }; return pintar(); }
    if (f.size > MAX_MB * 1024 * 1024) { st = { fase: "inicio", msg: `Arquivo grande demais (mais de ${MAX_MB} MB).` }; return pintar(); }
    let r;
    try { r = conferir(await f.text()); }
    catch (e) { st = { fase: "inicio", msg: e.message || "Não consegui ler o arquivo." }; return pintar(); }
    st = { fase: "revisao", arquivo: f.name.slice(0, 120), ...r, marcar: Object.fromEntries(TIPOS.map(([k]) => [k, true])), trocarPref: false };
    pintar();
  }

  /* ---------- 3. gravar ---------- */
  const erroDup = (e) => /duplicate|23505|já existe/i.test(String((e && (e.message + " " + e.code)) || ""));
  function falhou(tipo, item, motivo) { st.res[tipo].err++; st.erros.push({ tipo, item, motivo: String(motivo || "erro").slice(0, 300) }); }
  function passo(tipo, n = 1) { const p = st.prog[tipo]; if (p) p.feitos = Math.min(p.total, p.feitos + n); pintarLogo(); }
  let pintT = 0; function pintarLogo() { if (pintT) return; pintT = setTimeout(() => { pintT = 0; pintar(); }, 60); }
  /** insere em lotes de até 200; se o lote falhar, tenta um por um para achar o item com problema. Devolve [{x, linha}] dos gravados. */
  async function inserir(tabela, tipo, itens, chave) {
    const ok = [];
    for (let i = 0; i < itens.length; i += LOTE) {
      const lote = itens.slice(i, i + LOTE);
      const { data, error } = await sb.from(tabela).insert(lote.map((x) => x.linha)).select("*");
      if (!error && Array.isArray(data) && data.length === lote.length) {
        // casa cada linha gravada com o item pela chave natural (ou pela ordem, quando não precisa do id)
        const porChave = chave ? new Map(data.map((l) => [chave(l), l])) : null;
        lote.forEach((x, j) => ok.push({ x, linha: porChave ? porChave.get(chave(x.linha)) || data[j] : data[j] }));
        st.res[tipo].imp += lote.length; passo(tipo, lote.length); continue;
      }
      for (const x of lote) {
        const r = await sb.from(tabela).insert(x.linha).select("*").single();
        if (r.error) { if (erroDup(r.error)) st.res[tipo].ja++; else falhou(tipo, x.item, r.error.message); }
        else { ok.push({ x, linha: r.data }); st.res[tipo].imp++; }
        passo(tipo);
      }
    }
    return ok;
  }
  /** RPC importar_painel (resumos, mapas, questões), de 200 em 200 */
  async function viaFuncao(tipo, itens) {
    for (let i = 0; i < itens.length; i += LOTE) {
      const lote = itens.slice(i, i + LOTE);
      const { data, error } = await sb.rpc("importar_painel", { p_tipo: tipo, p_itens: lote.map((x) => x.linha) });
      if (error) {
        const m = /importar_painel|Could not find the function/i.test(error.message) ? "falta rodar o 11_importar_painel.sql no Supabase" : error.message;
        lote.forEach((x) => falhou(tipo, x.item, m)); passo(tipo, lote.length);
        if (/11_importar|administrador|Acesso/i.test(m)) { itens.slice(i + LOTE).forEach((x) => falhou(tipo, x.item, m)); return; }
        continue;
      }
      st.res[tipo].imp += +data?.importados || 0; st.res[tipo].ja += +data?.ja_existiam || 0;
      (Array.isArray(data?.erros) ? data.erros : []).forEach((e) => { const x = lote[+e.i]; falhou(tipo, x ? x.item : `#${e.i}`, e.motivo); });
      passo(tipo, lote.length);
    }
  }
  async function importar() {
    if (st.fase !== "revisao") return;
    const ctx = C, H = ctx.H, sem = H.SEM().atual;
    if (!H.P.is_admin) return toast("Só o administrador pode importar do painel antigo.");
    if (!sem) return toast("Monte o semestre atual primeiro.");
    const usar = (k) => !!st.marcar[k] && (st.v[k] || []).length > 0;
    st.fase = "rodando"; st.res = novoResultado(); st.erros = []; st.prog = {};
    TIPOS.forEach(([k]) => { if (usar(k)) st.prog[k] = { feitos: 0, total: st.v[k].length }; });
    pintar();
    try {
      // os erros de conferência contam como "ignorados por erro" (só nos tipos marcados)
      TIPOS.forEach(([k]) => { if (usar(k)) st.v[k].filter((x) => !x.ok).forEach((x) => { falhou(k, x.item, x.motivo); passo(k); }); });
      const val = (k) => usar(k) ? st.v[k].filter((x) => x.ok) : [];
      const S = () => ctx.S;
      // ---- matérias: reaproveita as do semestre atual com o mesmo nome ----
      const discRef = {}, porNome = new Map(S().disc.map((d) => [qNorm(d.nome), d.id]));
      const novas = [];
      st.prog.agora = "disciplinas"; pintar();
      for (const it of (st.v.disciplinas || []).filter((x) => x.ok)) {
        const k = qNorm(it.r.nome), id = porNome.get(k);
        if (id != null) { discRef[it.r.ref] = id; if (usar("disciplinas")) { st.res.disciplinas.ja++; passo("disciplinas"); } continue; }
        if (!usar("disciplinas")) continue;
        if (novas.some((x) => x.k === k)) { novas.find((x) => x.k === k).refs.push(it.r.ref); st.res.disciplinas.ja++; passo("disciplinas"); continue; }
        novas.push({ k, refs: [it.r.ref], item: it.item, linha: { nome: it.r.nome, professor: it.r.professor, tem_pratica: it.r.tem_pratica, foco_resumo: it.r.foco_resumo, ordem: Math.min(32767, S().disc.length + novas.length), semestre_id: sem.id } });
      }
      for (const { x, linha } of await inserir("disciplinas", "disciplinas", novas, (l) => qNorm(l.nome))) { x.refs.forEach((r) => { discRef[r] = linha.id; }); S().disc.push(linha); }
      const semMateria = (r) => `a matéria (${r}) não está no site`;

      // ---- temas ----
      st.prog.agora = "temas"; pintar();
      const temaRef = {}, temaChave = new Map(S().temas.map((t) => [t.disciplina_id + "|" + qNorm(t.nome), t.id]));
      const ordemDe = {}; S().temas.forEach((t) => { ordemDe[t.disciplina_id] = Math.max(ordemDe[t.disciplina_id] ?? -1, t.ordem ?? 0); });
      const novosT = [];
      for (const it of (st.v.temas || []).filter((x) => x.ok)) {
        const d = discRef[it.r.disciplina_ref];
        if (d == null) { if (usar("temas")) { falhou("temas", it.item, semMateria(it.r.disciplina_ref)); passo("temas"); } continue; }
        const k = d + "|" + qNorm(it.r.nome), id = temaChave.get(k);
        if (id != null) { temaRef[it.r.ref] = id; if (usar("temas")) { st.res.temas.ja++; passo("temas"); } continue; }
        if (!usar("temas")) continue;
        const ja = novosT.find((x) => x.k === k);
        if (ja) { ja.refs.push(it.r.ref); st.res.temas.ja++; passo("temas"); continue; }
        ordemDe[d] = (ordemDe[d] ?? -1) + 1;
        novosT.push({ k, refs: [it.r.ref], item: it.item, linha: { disciplina_id: d, nome: it.r.nome, prova: it.r.prova, itens: it.r.itens, aula: it.r.aula, resumo_ok: it.r.resumo_ok, questoes_ok: it.r.questoes_ok, ordem: Math.min(32767, ordemDe[d]) } });
      }
      for (const { x, linha } of await inserir("temas", "temas", novosT, (l) => l.disciplina_id + "|" + qNorm(l.nome))) { x.refs.forEach((r) => { temaRef[r] = linha.id; }); S().temas.push(linha); }
      const semTema = (r) => `o tema (${r}) não está no site`;

      // ---- resumos e mapas (função importar_painel; só onde o tema ainda não tem) ----
      for (const [tipo, jaTem] of [["resumos", S().resIds], ["mapas", S().mapaIds]]) {
        if (!usar(tipo)) continue; st.prog.agora = tipo; pintar();
        const L = [], vistos = new Set();
        for (const it of val(tipo)) {
          const t = temaRef[it.r.tema_ref];
          if (t == null) { falhou(tipo, it.item, semTema(it.r.tema_ref)); passo(tipo); continue; }
          if (jaTem.has(t) || vistos.has(t)) { st.res[tipo].ja++; passo(tipo); continue; }
          vistos.add(t);
          L.push({ item: it.item, linha: tipo === "resumos" ? { tema_id: t, texto: it.r.texto, truncado: it.r.truncado, criado_em: it.r.criado_em } : { tema_id: t, dados: it.r.dados, criado_em: it.r.criado_em } });
        }
        await viaFuncao(tipo, L);
      }

      // ---- tabelas simples: cada uma com a sua chave natural ----
      const simples = [
        ["provas", "provas", () => S().provas.map((p) => chProva(p.disciplina_id, p)), (r) => { const d = discRef[r.disciplina_ref]; if (d == null) return semMateria(r.disciplina_ref); return { k: chProva(d, r), linha: { disciplina_id: d, tipo: r.tipo, modalidade: r.modalidade, titulo: r.titulo, data: r.data, hora: r.hora, pontos: r.pontos } }; }, (l) => S().provas.push(l)],
        ["notas", "notas", () => Object.entries(S().notas).flatMap(([d, o]) => Object.keys(o).map((c) => d + "|" + c)), (r) => { const d = discRef[r.disciplina_ref]; if (d == null) return semMateria(r.disciplina_ref); return { k: d + "|" + r.campo, linha: { disciplina_id: d, campo: r.campo, valor: r.valor } }; }, (l) => { (S().notas[l.disciplina_id] = S().notas[l.disciplina_id] || {})[l.campo] = l.valor == null ? null : +l.valor; }],
        ["horarios", "horarios", () => S().horarios.map((h) => chHora(h.dia, h.inicio, h.fim, h.disciplina_id, h.nome)), (r) => { let d = null; if (r.disciplina_ref) { d = discRef[r.disciplina_ref]; if (d == null && !r.nome) return semMateria(r.disciplina_ref); }
          const nome = d == null ? r.nome : null; return { k: chHora(r.dia, r.inicio, r.fim, d, nome), linha: { semestre_id: sem.id, disciplina_id: d, nome, professor: r.professor, dia: r.dia, inicio: r.inicio, fim: r.fim } }; }, (l) => S().horarios.push(l)],
        ["calendario", "calendario", () => S().cal.map((c) => baixa(c.nome) + "|" + c.inicio), (r) => ({ k: baixa(r.nome) + "|" + r.inicio, linha: { nome: r.nome, tipo: r.tipo, inicio: r.inicio, fim: r.fim } }), (l) => S().cal.push(l)],
        ["vida_eventos", "vida_eventos", () => S().eventos.map((e) => baixa(e.nome) + "|" + e.data), (r) => ({ k: baixa(r.nome) + "|" + r.data, linha: { nome: r.nome, detalhe: r.detalhe, data: r.data, status: r.status } }), (l) => S().eventos.push(l)],
        ["ligas", "ligas", () => S().ligas.map((l) => baixa(l.nome)), (r) => ({ k: baixa(r.nome), linha: { nome: r.nome, papel: r.papel } }), (l) => S().ligas.push(l)],
        ["horas_compl", "horas_compl", () => S().horas.map((h) => chHoras(h)), (r) => ({ k: chHoras(r), linha: { categoria: r.categoria, descricao: r.descricao, horas: r.horas, certificado: r.certificado } }), (l) => S().horas.push(l)],
      ];
      for (const [tipo, tabela, existentes, montar, guardar] of simples) {
        if (!usar(tipo)) continue; st.prog.agora = tipo; pintar();
        const tem = new Set(existentes()), L = [];
        for (const it of val(tipo)) {
          const m = montar(it.r);
          if (typeof m === "string") { falhou(tipo, it.item, m); passo(tipo); continue; }
          if (tem.has(m.k)) { st.res[tipo].ja++; passo(tipo); continue; }
          tem.add(m.k); L.push({ item: it.item, linha: m.linha });
        }
        for (const { linha } of await inserir(tabela, tipo, L)) guardar(linha);
      }

      // ---- questões (+ histórico) pela função; a chave é a mesma da IA ----
      if (usar("questoes")) {
        st.prog.agora = "questoes"; pintar();
        if (!S().questoes && ctx.carregarQuestoes) await ctx.carregarQuestoes().catch(() => { });
        const tem = new Set((S().questoes || []).map((q) => q.disciplina_id + "|" + chaveQuestao(q.tipo, q.enunciado, q.dados || q)));
        const L = [];
        for (const it of val("questoes")) {
          const r = it.r, d = discRef[r.disciplina_ref];
          if (d == null) { falhou("questoes", it.item, semMateria(r.disciplina_ref)); passo("questoes"); continue; }
          const t = r.tema_ref != null ? temaRef[r.tema_ref] ?? null : null;
          const chave = chaveQuestao(r.tipo, r.enunciado, r.dados), k = d + "|" + chave;
          if (tem.has(k)) { st.res.questoes.ja++; passo("questoes"); continue; }
          tem.add(k);
          L.push({ item: it.item, linha: { disciplina_id: d, tema_id: t, tema: r.tema, tipo: r.tipo, enunciado: r.enunciado, dados: r.dados, explicacao: r.explicacao, acertos: r.acertos, erros: r.erros, ultima: r.ultima, chave, tema_chave: qNorm(r.tema).slice(0, 200) } });
        }
        await viaFuncao("questoes", L);
      }

      // ---- modelo dos resumos: não troca o do site sem o "trocar" marcado ----
      if (usar("preferencias")) {
        st.prog.agora = "preferencias"; pintar();
        for (const it of val("preferencias")) {
          const atual = (S().pref || {}).modelo_resumo;
          if (atual && atual === it.r.modelo_resumo) { st.res.preferencias.ja++; passo("preferencias"); continue; }
          if (atual && !st.trocarPref) { st.res.preferencias.ja++; passo("preferencias"); continue; }
          const { error } = await sb.from("preferencias").upsert({ aluno_id: H.P.id, modelo_resumo: it.r.modelo_resumo, atualizado_em: new Date().toISOString() });
          if (error) falhou("preferencias", it.item, error.message); else { (S().pref = S().pref || {}).modelo_resumo = it.r.modelo_resumo; st.res.preferencias.imp++; }
          passo("preferencias");
        }
      }
    } catch (e) {
      st.erros.push({ tipo: st.prog.agora || "geral", item: "", motivo: "A importação parou: " + (e && e.message || e) });
      toast("A importação parou no meio. Rodar de novo continua de onde parou (não duplica).");
    }
    st.fase = "fim"; st.prog.agora = null;
    const tot = TIPOS.reduce((s, [k]) => s + st.res[k].imp, 0);
    toast(`Importação concluída: ${tot} ${tot === 1 ? "item novo" : "itens novos"}`);
    await ctx.recarregar(); // atualiza o painel (Disciplinas mostra os resumos) e redesenha este cartão
    pintar();
  }
  const chProva = (d, p) => (p.tipo === "P1" || p.tipo === "P2" || p.tipo === "Final") ? `${d}|${p.tipo}|${p.modalidade || "teorica"}` : `${d}|${p.tipo}|${baixa(p.titulo)}|${p.data || ""}`;
  const chHora = (dia, ini, fim, d, nome) => `${dia}|${hhmm(ini)}|${hhmm(fim)}|${d != null ? d : "n:" + baixa(nome)}`;
  const chHoras = (h) => `${baixa(h.descricao)}|${baixa(h.categoria)}|${+h.horas}`;

  /* ---------- lista de erros (.csv) ---------- */
  function baixarErros() {
    const cel = (v) => { let s = String(v ?? "").replace(/\r?\n/g, " "); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const csv = "﻿" + ["tipo;item;motivo", ...st.erros.map((e) => [NOME[e.tipo] || e.tipo, e.item, e.motivo].map(cel).join(";"))].join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const d = new Date(); a.download = `erros-importacao-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.csv`;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- eventos (o painel.js repassa os cliques e mudanças do cartão) ---------- */
  async function clique(a, ctx) {
    C = ctx;
    if (a === "impConfirmar") return importar();
    if (a === "impCancelar" || a === "impNovo") { if (st.fase === "rodando") return; st = { fase: "inicio" }; return pintar(); }
    if (a === "impErros") return baixarErros();
  }
  function mudou(el, ctx) {
    C = ctx;
    if (el.dataset.a === "impArq") { const f = el.files && el.files[0]; el.value = ""; return escolherArquivo(f); }
    if (st.fase !== "revisao") return;
    if (el.dataset.impTipo) { st.marcar[el.dataset.impTipo] = el.checked; return; }
    if ("impPref" in el.dataset) st.trocarPref = el.checked;
  }
  window.Importar = { html, clique, mudou, _conferir: conferir };
})();
