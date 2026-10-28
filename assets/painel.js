// Painel de estudo: as abas Agenda, Disciplinas, Questões, Média, Aulas, Calendário, Vida acadêmica e Laminário,
// e a tela Configurações (Google Drive, livros, enviar arquivos, importar documento e ajustes do semestre).
// O app.html chama Painel.iniciar(...) depois do login e da configuração.
// Tudo o que é de cada aluno fica no Supabase (06_estudo.sql); a IA só roda no servidor (função "ia"),
// e só quando o aluno pede. Todo texto do aluno ou da IA passa por esc() ou pelo DOMPurify.
(function () {
  const { sb, esc, toast } = App;

  /* ---------- utilidades (iguais às do painel original) ---------- */
  const DAY = 864e5;
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const MES3 = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const SEMD = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const parse = (s) => { const [y, m, d] = String(s).split("-").map(Number); return new Date(y, m - 1, d); };
  const daysTo = (s) => Math.round((parse(s) - today()) / DAY);
  const fmt = (n) => n == null || isNaN(n) ? "—" : (Math.round(n * 100) / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  const num = (v) => { if (v === "" || v == null) return null; const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? null : n; };
  const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const semAcentoMaiusc = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7E]/g, "");
  const qNorm = (s) => semAcento(s).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const ss = { get(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { sessionStorage.setItem(k, v); } catch (_) { } } };
  function janela(title, body, extra = "") { return `<section class="win"${extra}><div class="win-bar"><span class="dots"><i></i><i></i><i></i></span>${esc(title)}</div>${body}</section>`; }
  function hero(a, b, color) { return `<div class="hero"><h1>${a}<span class="script" style="color:${color}">${b}</span></h1></div>`; }
  // Markdown da IA: sem imagens, mídia nem formulários (o resumo é só texto)
  const PURIFY = { FORBID_TAGS: ["img", "svg", "math", "style", "form", "input", "button", "textarea", "select", "iframe", "video", "audio", "picture", "source", "object", "embed"], FORBID_ATTR: ["style"] };
  function md(text) { try { if (window.marked && window.DOMPurify) return DOMPurify.sanitize(marked.parse(String(text || "")), PURIFY); } catch (_) { } return esc(text || "").replace(/\n/g, "<br>"); }
  const mesAtual = () => iso(today()).slice(0, 8) + "01";

  // Modelo dos resumos (o mesmo do servidor, função ia): resumo ativo, em tópicos.
  const MODELO_PADRAO = `Resumo ativo: só tópicos diretos, sem texto corrido, sem introdução e sem contexto.
# Tema
## O que é
- definição em 1 linha
## Função / mecanismo
- como funciona, em tópicos curtos
## Itens do tema (fármacos, classes, estruturas, agentes, doenças)
- **Item**: função de cada um em 1 linha
## Indicações / quando usar
## Contraindicações
## Efeitos adversos / complicações
## Diagnóstico e conduta (se couber no tema)
## Pegadinhas de prova`;
  const FOCOS = [
    [/farmac/, "Farmacologia: classes e fármacos representativos, mecanismo de ação, farmacocinética relevante, indicações, contraindicações, efeitos adversos ligados ao mecanismo, interações e combinações proibidas."],
    [/anatom\w*\s*patol|anatomopat|anatopat|patologia/, "Anatomia patológica: etiopatogenia, morfologia macro e micro (achados-chave para reconhecer na peça e na lâmina), correlação clínica e prognóstico."],
    [/fisiopat/, "Fisiopatologia: a cadeia causa, mecanismo, alteração funcional e manifestação; o porquê de cada sinal, sintoma e exame alterado."],
    [/semiolog/, "Semiologia: sinais e sintomas, anamnese dirigida, exame físico (inspeção, palpação, percussão, ausculta) com achados e sinais epônimos, exames complementares e diagnóstico sindrômico."],
    [/tropical|infecto|parasit/, "Agente, transmissão, epidemiologia, quadro clínico, diagnóstico, tratamento e prevenção."],
    [/primeiros socorros|primeros auxilios|primeiros auxilios|urgencia|emergencia/, "Conduta passo a passo, prioridades (xABCDE), o que fazer e o que não fazer, com os números exatos (frequências, profundidades, porcentagens)."],
    [/gest(ao|ion)|saude publica|salud publica|epidemiolog/, "Conceitos, definições, indicadores e aplicação prática na gestão, com exemplos."],
    [/seminario|integrador/, "Integração clínica: definição, fisiopatologia, quadro clínico, diagnóstico e tratamento, com raciocínio de caso."],
  ];
  const focoPadrao = (m) => { const s = semAcento(m); for (const [re, t] of FOCOS) if (re.test(s)) return t; return "O que é cobrado em prova, direto ao ponto."; };

  /* ---------- estado ---------- */
  let H = null, S = null, V = null;
  const TABS = [["agenda", "Agenda"], ["disc", "Disciplinas"], ["quest", "Questões"], ["media", "Média"], ["aulas", "Aulas"], ["cal", "Calendário"], ["vida", "Vida acadêmica"], ["lam", "Laminário"]];
  const TELAS = [...TABS.map(([k]) => k), "config"]; // "config" = Configurações (botão no alto, não é aba)
  const ui = { tab: "agenda", up: { disc: null, modo: "arquivo", temaId: null, temaNome: "", files: [] }, cal: { file: null, busy: false, msg: null, provas: null }, cfgOpen: true, disc: null, qMode: "prat", qDisc: "", qIdx: 0, qAns: null, calY: today().getFullYear(), calM: today().getMonth(), calView: "mes", calDate: iso(today()), vMode: "ev", calcDisc: null, genBusy: false, genMsg: "" };
  const RES = {}, RESLOAD = {}, MAPA = {}, MAPLOAD = {}, LAMURL = {};
  const ativo = () => !!document.getElementById("painel");

  const discById = (id) => S.disc.find((d) => d.id == id);
  const dname = (id) => discById(id)?.nome || "Matéria removida";
  const temasDe = (id) => S.temas.filter((t) => t.disciplina_id == id);
  const temaById = (id) => S.temas.find((t) => t.id == id);
  const matsDe = (temaId) => S.mats.filter((m) => m.tema_id == temaId);
  const OFICIAL = (t) => t === "P1" || t === "P2" || t === "Final";
  function provaNome(p) {
    if (!OFICIAL(p.tipo)) return p.titulo || p.tipo;
    const d = discById(p.disciplina_id);
    return p.tipo + (p.modalidade === "pratica" ? " prática" : d?.tem_pratica ? " teórica" : "");
  }
  const provaTipoLbl = (p) => OFICIAL(p.tipo) ? (p.modalidade === "pratica" ? "Prática" : "Prova") : p.tipo;
  function progress(d) { const ts = temasDe(d.id); if (!ts.length) return 0; let n = 0; ts.forEach((t) => { n += (t.aula ? 1 : 0) + (t.resumo_ok ? 1 : 0) + (t.questoes_ok ? 1 : 0); }); return Math.round(n / (ts.length * 3) * 100); }
  const nextProva = (discId) => S.provas.filter((p) => p.disciplina_id == discId && p.data && daysTo(p.data) >= 0).sort((a, b) => a.data.localeCompare(b.data))[0];
  const CORES = ["--terra", "--navy", "--green", "--wine", "--plum", "--teal", "--olive", "--gold"];
  function slotColor(discId) { let i = S.disc.findIndex((d) => d.id == discId); if (i < 0) i = S.disc.length; return `var(${CORES[i % CORES.length]})`; }
  function erroBanco(e) { return e && /relation|schema cache|does not exist|column|function .* not exist|Could not find/i.test(e.message || "") ; }

  /* ================= CARGA ================= */
  async function carregar() {
    const sem = H.SEM().atual;
    let qd = sb.from("disciplinas").select("*").order("ordem").order("id");
    if (sem) qd = qd.eq("semestre_id", sem.id);
    const { data: disc, error: e0 } = await qd;
    if (e0) throw e0;
    const ids = (disc || []).map((d) => d.id);
    const vazio = Promise.resolve({ data: [] });
    const porDisc = (t, cols) => ids.length ? sb.from(t).select(cols).in("disciplina_id", ids) : vazio;
    const [temas, provas, notas, mats, res, mapas, pref, fac, hor, cal, ev, ligas, horas, uso, facs, docs] = await Promise.all([
      porDisc("temas", "*"), porDisc("provas", "*"), porDisc("notas", "disciplina_id,campo,valor"),
      sb.from("materiais").select("id,nome,status,tema_id,disciplina_id,mime,fonte_id").eq("ignorado", false),
      sb.from("resumos").select("tema_id"), sb.from("mapas").select("tema_id"),
      sb.from("preferencias").select("*").eq("aluno_id", H.P.id).maybeSingle(),
      sb.from("faculdades").select("nome,regra_notas").eq("id", sem?.faculdade_id || H.P.faculdade_id || 0).maybeSingle(),
      sem ? sb.from("horarios").select("*").eq("semestre_id", sem.id) : sb.from("horarios").select("*"),
      sb.from("calendario").select("*").order("inicio"), sb.from("vida_eventos").select("*").order("data"),
      sb.from("ligas").select("*").order("id"), sb.from("horas_compl").select("*").order("id"),
      sb.from("uso_ia").select("*").eq("mes", mesAtual()).maybeSingle(),
      sb.from("faculdades").select("id,nome").eq("ativa", true).order("nome"),
      sb.from("documentos").select("*").order("criado_em", { ascending: false }).limit(100),
    ]);
    const falta06 = [pref, hor, cal, ev, mapas].some((r) => r.error && erroBanco(r.error));
    const notasMap = {};
    (notas.data || []).forEach((n) => { (notasMap[n.disciplina_id] = notasMap[n.disciplina_id] || {})[n.campo] = n.valor == null ? null : +n.valor; });
    S = {
      falta06, disc: disc || [], temas: (temas.data || []).sort((a, b) => (a.ordem - b.ordem) || (a.id - b.id)),
      provas: provas.data || [], notas: notasMap, mats: mats.data || [],
      resIds: new Set((res.data || []).map((r) => r.tema_id)), mapaIds: new Set((mapas.data || []).map((r) => r.tema_id)),
      pref: pref.data || {}, regra: fac.data?.regra_notas || {}, faculdade: fac.data?.nome || "",
      horarios: hor.data || [], cal: cal.data || [], eventos: ev.data || [], ligas: ligas.data || [], horas: horas.data || [],
      uso: uso.data || {}, questoes: null, laminas: null, faculdades: facs.data || [], docs: docs.data || [],
    };
  }
  async function carregarQuestoes() {
    const ids = S.disc.map((d) => d.id);
    const [q, l] = await Promise.all([
      ids.length ? sb.from("questoes").select("*").in("disciplina_id", ids).order("criado_em").order("id") : Promise.resolve({ data: [] }),
      sb.from("laminas").select("*").order("id"),
    ]);
    S.questoes = (q.data || []).map(qObj);
    S.laminas = l.data || [];
  }
  const qObj = (r) => ({ ...r, ...(r.dados || {}) });
  async function salvarPref(campos) {
    const { error } = await sb.from("preferencias").upsert({ aluno_id: H.P.id, ...campos, atualizado_em: new Date().toISOString() });
    if (error) { toast("Não consegui salvar: " + error.message); return false; }
    Object.assign(S.pref, campos); return true;
  }
  async function atualizarUso() { const { data } = await sb.from("uso_ia").select("*").eq("mes", mesAtual()).maybeSingle(); S.uso = data || {}; }
  const usoTxt = (k, lim, nome) => `${S.uso[k] || 0} de ${H.P[lim] ?? "?"} ${nome} usados este mês`;

  /* ================= DISCIPLINAS ================= */
  const CAI = (d) => ["", "P1", "P2", "Final", ...(d.tem_pratica ? ["P1 teórica", "P1 prática", "P2 teórica", "P2 prática", "Final teórica", "Final prática"] : [])];
  const MAT_LER = /pdf|presentationml|wordprocessingml|google-apps\.(document|presentation)|text\//;
  function matInfo(t) {
    const ms = matsDe(t.id); if (!ms.length) return "";
    const falta = ms.filter((m) => m.status === "pendente" && MAT_LER.test(m.mime || "")).length;
    return `<span class="tref">Material: ${ms.slice(0, 4).map((m) => esc(m.nome)).join(" · ")}${ms.length > 4 ? ` e mais ${ms.length - 4}` : ""}${falta ? ` <span class="muted">(${falta} será${falta > 1 ? "ão" : ""} lido${falta > 1 ? "s" : ""} ao pedir o resumo)</span>` : ""}</span>`;
  }
  function vDisc() {
    if (!ui.disc || !discById(ui.disc)) ui.disc = S.disc[0]?.id;
    const cards = S.disc.map((d) => {
      const p = progress(d), np = nextProva(d.id), n = temasDe(d.id).length;
      const st = p === 100 ? ["Concluído", "st-done"] : p > 0 ? ["Em progresso", "st-prog"] : ["A começar", "st-new"];
      let meta = `${p}% · ${n} tema${n === 1 ? "" : "s"}`;
      if (np) { const k = daysTo(np.data); meta = `${p}% · ${esc(provaNome(np))} ${k === 0 ? "hoje" : k === 1 ? "amanhã" : "em " + k + " dias"}`; }
      return `<button class="dcard" data-a="pickDisc" data-id="${d.id}" aria-pressed="${d.id == ui.disc}">
        <span><span class="chip ${st[1]}">${st[0]}</span></span><h3>${esc(d.nome)}</h3>${d.professor ? `<span class="dprof">${esc(d.professor)}</span>` : ""}
        <div class="bar"><i style="width:${p}%;background:${p === 100 ? "var(--green)" : "var(--terra)"}"></i></div>
        <span class="mono tnum">${meta}</span></button>`;
    }).join("");
    const d = discById(ui.disc);
    let plan = "";
    if (d) {
      const p = progress(d), ts = temasDe(d.id);
      plan = janela(`${d.nome} · plano de estudo`, `<div class="win-body">
        <div class="row" style="justify-content:space-between;align-items:center"><h2 style="color:var(--terra);font-size:18px">Plano de estudo: conteúdos das provas</h2><span class="mono tnum">${p}%</span></div>
        <div class="bar" style="margin-top:10px;height:7px"><i style="width:${p}%;background:var(--terra)"></i></div>
        <div class="tgrid">${ts.length ? ts.map((t) => `<div class="topic">${t.prova ? `<span class="chip ${/prát|prat/i.test(t.prova) ? "pv-pr" : "pv-te"}" style="align-self:flex-start">${esc(t.prova)}</span>` : ""}
          <div class="topic-h"><h3>${esc(t.nome)}</h3>${ui.confDel == t.id ? `<span class="row" style="gap:4px;align-items:center;flex-wrap:nowrap"><button class="btn" data-a="delTopic" data-id="${t.id}" style="padding:2px 8px;font-size:12px;color:var(--bad);border-color:var(--bad)">Apagar</button><button class="btn ghost" data-a="cancelDel" style="padding:2px 6px;font-size:12px">Não</button></span>` : `<button class="x" title="Remover tema" aria-label="Remover ${esc(t.nome)}" data-a="askDel" data-id="${t.id}">×</button>`}</div>
          ${ui.confDel == t.id && matsDe(t.id).some((m) => !enviado(m)) ? `<span class="tref">Os arquivos do Drive deste tema ficam ocultos e não voltam na próxima leitura (dá para restaurar em Configurações → Meu Google Drive).</span>` : ""}
          <div class="tbtns"><button class="btn" data-a="openRes" data-id="${t.id}">Resumo${S.resIds.has(t.id) ? " ✓" : ""}</button><button class="btn" data-a="openMapa" data-id="${t.id}">Mapa mental</button></div>
          ${Array.isArray(t.itens) && t.itens.length ? `<div class="lams">${t.itens.map((i) => `<span>${esc(i)}</span>`).join("")}</div>` : ""}${matInfo(t)}
          ${[["aula", "Aula assistida"], ["resumo_ok", "Resumo / revisão"], ["questoes_ok", "Questões feitas"]].map(([k, l]) => `<label class="check ${t[k] ? "on" : ""}"><input type="checkbox" data-a="tick" data-id="${t.id}" data-k="${k}" ${t[k] ? "checked" : ""}><span>${l}</span></label>`).join("")}
        </div>`).join("") : `<div class="empty" style="grid-column:1/-1">Nenhum conteúdo ainda. Adicione os temas que caem nas provas, envie os arquivos do professor (botão "Enviar arquivos") ou ligue sua pasta do Google Drive em Configurações: cada arquivo vira um tema.</div>`}</div>
        <form class="row" data-form="addTopic" style="margin-top:14px"><label class="field" style="flex:1 1 220px"><span class="mono">Novo conteúdo</span><input name="nome" id="topicName" maxlength="120" placeholder="Ex.: Valvopatias" required></label>
          <label class="field" style="flex:0 1 150px"><span class="mono">Cai na</span><select name="prova">${CAI(d).map((x) => `<option value="${esc(x)}">${x ? esc(x) : "Qualquer prova"}</option>`).join("")}</select></label><button class="btn solid">Adicionar</button></form>
        ${vMatsDisc(d)}
      </div>`);
    }
    return hero("Painel de", "disciplinas", "var(--terra)") + janela(`Medicina · ${semNome()}`, `<div class="win-body"><h2 style="text-align:center;color:var(--terra)">Minhas disciplinas</h2><div style="width:36px;height:2px;background:var(--terra);margin:8px auto 18px"></div>${cards ? `<div class="dgrid">${cards}</div>` : `<div class="empty">Nenhuma matéria neste semestre. ${SEM_MATERIA}</div>`}
      ${S.disc.length ? `<div class="row" style="justify-content:center;margin-top:16px"><button class="btn" data-a="upAbrir" data-id="${d ? d.id : ""}">Enviar arquivos</button></div>` : ""}</div>`) + plan
      + (d && ui.upOpen ? janela(`Enviar arquivos · ${d.nome}`, `<div class="win-body" id="upJanela">${vUpload()}<div class="row" style="margin-top:12px"><button class="btn ghost" data-a="upFechar">Fechar</button></div></div>`) : "");
  }
  const semNome = () => { const s = H.SEM().atual; return s?.numero ? `${s.numero}º semestre` : "semestre atual"; };
  const SEM_MATERIA = `Adicione em <button class="lnk" data-a="goCfg">Configurações → Ajustes do semestre</button>.`;

  /* ================= MATERIAIS DA MATÉRIA E ENVIO DE ARQUIVOS ================= */
  // O arquivo não sai do aparelho: o navegador lê o texto (mesma leitura dos arquivos do Drive, lerArquivo)
  // e grava só o texto pela função enviar_material (07_uploads.sql), que cria ou reaproveita o tema.
  const enviado = (m) => !m.fonte_id;
  function vMatsDisc(d) {
    const ms = S.mats.filter((m) => m.disciplina_id == d.id).sort((a, b) => a.nome.localeCompare(b.nome));
    if (!ms.length) return "";
    const nomeTema = (m) => temaById(m.tema_id)?.nome || "";
    return `<details class="mats" ${ms.length <= 12 ? "open" : ""}><summary><b>Materiais (${ms.length})</b> <span class="muted">· do Drive e enviados por você</span></summary>
      <ul class="drv-lista">${ms.map((m) => { const [cls, txt] = MAT_ST[m.status] || ["s-warn", m.status];
        return `<li><span class="drv-nome"><span>${esc(m.nome)}</span>${nomeTema(m) ? `<span class="tref" style="display:block">Tema: ${esc(nomeTema(m))}</span>` : ""}</span>
        <span class="row" style="gap:6px;align-items:center;flex-wrap:nowrap"><span class="chip ${enviado(m) ? "s-ok" : "s-warn"}" title="${enviado(m) ? "Enviado por você" : "Da pasta do Google Drive"}">${enviado(m) ? "enviado" : "drive"}</span><span class="chip ${cls}">${esc(txt)}</span>
        ${ui.confMat === m.id ? `<button class="btn" data-a="delMat" data-id="${m.id}" style="padding:2px 8px;font-size:12px;color:var(--bad);border-color:var(--bad)">${enviado(m) ? "Apagar" : "Ocultar"}</button><button class="btn ghost" data-a="cancelDel" style="padding:2px 6px;font-size:12px">Não</button>`
            : `<button class="x" data-a="askMat" data-id="${m.id}" aria-label="${enviado(m) ? "Apagar" : "Ocultar"} ${esc(m.nome)}">×</button>`}</span></li>`; }).join("")}</ul></details>`;
  }
  const MAT_ST = { ok: ["s-ok", "lido"], pendente: ["s-ok", "pronto"], sem_texto: ["s-warn", "sem texto"], grande_demais: ["s-warn", "grande demais"], erro: ["s-bad", "erro"] };
  const UP_ST = { fila: ["", "na fila"], rodando: ["s-warn", "lendo"], ok: ["s-ok", "enviado"], sem_texto: ["s-warn", "sem texto"], erro: ["s-bad", "erro"] };
  // os envios ficam na fila do navegador (assets/fila.js): o aluno pode usar o resto do site enquanto lê
  const envios = () => Fila.lista().filter((j) => j.tipo === "upload");
  function vUpProg() {
    const it = envios(); if (!it.length) return "";
    const pend = it.some((x) => x.st === "fila" || x.st === "rodando");
    return `<ul class="up-lista" aria-live="polite">${it.map((x) => { const [cls, txt] = UP_ST[x.st] || ["", x.st];
      return `<li><div style="min-width:0"><b class="drv-nome">${esc(x.dados.nome || x.titulo)}</b>${x.msg ? `<div class="muted" style="font-size:13px">${esc(x.msg)}</div>` : ""}${x.st === "rodando" && x.frac != null ? `<progress max="100" value="${Math.round(x.frac * 100)}"></progress>` : ""}</div><span class="chip ${cls}">${esc(txt)}</span></li>`; }).join("")}</ul>
      ${pend ? `<p class="muted" style="margin:6px 0 0;font-size:13px">Pode usar o resto do site enquanto os arquivos são lidos. ${it.every((x) => x.persistente || !(x.st === "fila" || x.st === "rodando")) ? "Se fechar o site, continua quando você abrir de novo neste aparelho." : "Deixe o site aberto até terminar."}</p>` : ""}`;
  }
  function pintarUpProg() { const el = document.getElementById("upProg"); if (el) el.innerHTML = vUpProg(); }
  /** Painel "Enviar arquivos" (na matéria, em Disciplinas, e em Configurações) */
  function vUpload() {
    const u = ui.up;
    if (!S.disc.length) return `<div class="empty">Adicione uma matéria primeiro. ${SEM_MATERIA}</div>`;
    if (!discById(u.disc)) u.disc = discById(ui.disc) ? ui.disc : S.disc[0].id;
    const ts = temasDe(u.disc);
    if (u.modo === "existente" && !ts.some((t) => t.id == u.temaId)) { u.modo = "arquivo"; u.temaId = null; }
    return `<div class="stack up">
      <p style="margin:0">Mande os slides, PDFs e documentos do professor. Cada arquivo vira material do tema e é usado nos resumos, mapas e questões.</p>
      <div class="row">
        <label class="field" style="flex:1 1 200px"><span class="mono">Matéria</span><select data-a="upDisc">${S.disc.map((d) => `<option value="${d.id}" ${d.id == u.disc ? "selected" : ""}>${esc(d.nome)}</option>`).join("")}</select></label>
        <label class="field" style="flex:1 1 220px"><span class="mono">Tema</span><select data-a="upTema">
          <option value="arquivo" ${u.modo === "arquivo" ? "selected" : ""}>Um tema novo para cada arquivo (nome do arquivo)</option>
          <option value="novo" ${u.modo === "novo" ? "selected" : ""}>Um tema novo com o nome que eu escrever</option>
          ${ts.length ? `<optgroup label="Temas que já existem">${ts.map((t) => `<option value="${t.id}" ${u.modo === "existente" && u.temaId == t.id ? "selected" : ""}>${esc(t.nome)}</option>`).join("")}</optgroup>` : ""}</select></label>
        ${u.modo === "novo" ? `<label class="field" style="flex:1 1 200px"><span class="mono">Nome do tema</span><input id="upTemaNome" data-a="upTemaNome" maxlength="120" value="${esc(u.temaNome)}" placeholder="Ex.: Insuficiência cardíaca"></label>` : ""}
      </div>
      <div class="row" style="align-items:center"><label class="btn solid" style="cursor:pointer">Escolher arquivos<input type="file" id="upArq" data-a="upArq" multiple accept=".pdf,.pptx,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden></label>
        ${u.files.length ? `<button class="btn solid" data-a="upEnviar">Ler e enviar (${u.files.length})</button><button class="btn ghost" data-a="upLimpar">Limpar</button>` : ""}</div>
      ${u.files.length ? `<ul class="up-lista">${u.files.map((f, i) => `<li><span class="drv-nome">${esc(f.name)}</span><span class="row" style="gap:6px;align-items:center;flex-wrap:nowrap"><span class="muted tnum" style="font-size:12.5px">${(f.size / 1048576).toFixed(1).replace(".", ",")} MB</span><button class="x" data-a="upTirar" data-i="${i}" aria-label="Tirar ${esc(f.name)}">×</button></span></li>`).join("")}</ul>` : ""}
      <div id="upProg">${vUpProg()}</div>
      <p class="muted" style="margin:0;font-size:13px">PDF, PowerPoint (.pptx), Word (.docx) e texto (.txt, .md). O arquivo não é guardado no site: ele é lido aqui no seu aparelho e só o texto é guardado. PDF escaneado (páginas que são fotos) não tem texto. ${S.mats.filter(enviado).length} de 400 arquivos enviados.</p>
    </div>`;
  }
  /** Põe os arquivos escolhidos na fila do navegador (um trabalho por arquivo). */
  async function enviarArquivos() {
    const u = ui.up; if (!u.files.length) return;
    const d = discById(u.disc); if (!d) return toast("Escolha a matéria.");
    if (u.modo === "novo" && !u.temaNome.trim()) return toast("Escreva o nome do tema.");
    const temaFixo = u.modo === "existente" ? temaById(u.temaId)?.nome : u.modo === "novo" ? u.temaNome.trim() : null;
    const fs = u.files; u.files = [];
    Fila.limparFeitos();
    for (const f of fs) await Fila.adicionar("upload", `Enviar ${f.name}`, { disc: d.id, discNome: d.nome, tema: temaFixo || null, nome: f.name }, f);
    render();
    toast(fs.length === 1 ? "Arquivo na fila: pode continuar usando o site" : `${fs.length} arquivos na fila: pode continuar usando o site`);
  }
  /** Trabalho da fila: lê um arquivo enviado e grava só o texto (enviar_material). */
  async function trabalhoUpload(job, prog) {
    const f = job.arquivo, { disc, nome } = job.dados;
    if (!f) throw Object.assign(new Error("O arquivo não ficou guardado neste aparelho. Escolha de novo."), { st: "erro" });
    const tp = Leitor.tipoDoArquivo(nome, f.type);
    if (!tp) throw Object.assign(new Error(/\.(ppt|doc)$/i.test(nome) ? "Formato antigo (.ppt/.doc): abra no PowerPoint/Word, salve como .pptx/.docx e envie de novo." : "Tipo de arquivo não aceito. Use PDF, PowerPoint (.pptx), Word (.docx) ou texto (.txt)."), { st: "erro" });
    if (f.size > 80 * 1024 * 1024) throw Object.assign(new Error("Arquivo grande demais (mais de 80 MB)."), { st: "erro" });
    prog(0, "Abrindo…");
    const r = await lerArquivo(tp.tipo, new Uint8Array(await f.arrayBuffer()), (frac, msg) => prog(frac, msg));
    const texto = limparTexto(r.texto), letras = texto.replace(/\s+/g, "").length;
    if (letras < 20) throw Object.assign(new Error(tp.tipo === "pdf" ? "Sem texto: este PDF parece escaneado (as páginas são imagens). Use um PDF em que dá para selecionar as palavras." : "Não achei texto neste arquivo."), { st: "sem_texto" });
    prog(null, "Guardando…");
    const tema = job.dados.tema || Leitor.nomeDoTema(nome);
    const { data, error } = await sb.rpc("enviar_material", { p_disciplina_id: disc, p_tema_nome: tema, p_nome: nome.slice(0, 300), p_mime: tp.mime, p_texto: texto, p_paginas: r.paginas ?? null });
    if (error) throw Object.assign(new Error(/function .*enviar_material|Could not find/i.test(error.message) ? "O envio de arquivos ainda não foi ativado no banco (falta rodar o 07_uploads.sql)." : /Matéria não encontrada/i.test(error.message) ? "A matéria deste arquivo foi apagada." : error.message), { st: "erro", pararTipo: /limite|07_uploads|Acesso/i.test(error.message) });
    recarregarLogo();
    return `${data?.tema_novo ? "Tema novo" : "No tema"}: ${tema}${data?.truncado ? " (arquivo muito longo: guardei as primeiras 300 mil letras)" : ""}${tp.tipo === "pdf" && r.paginas && letras < r.paginas * 15 ? ". Pouco texto: algumas páginas parecem imagem." : ""}`;
  }
  // depois de cada envio, o painel se atualiza (junta vários envios seguidos numa recarga só)
  let recargaT = 0;
  function recarregarLogo(ms = 1500) { clearTimeout(recargaT); recargaT = setTimeout(() => { if (ativo()) recarregar(); }, ms); }
  async function apagarMaterial(id) {
    const m = S.mats.find((x) => x.id == id); if (!m) return;
    if (!(await del("materiais", m.id, !enviado(m)))) return;
    S.mats = S.mats.filter((x) => x.id !== m.id);
    // o tema que nasceu só deste arquivo (sem resumo e sem outros materiais) sai junto
    const t = temaById(m.tema_id);
    if (t && t.origem === "upload" && !matsDe(t.id).length && !S.resIds.has(t.id) && !S.mapaIds.has(t.id) && !t.aula && !t.resumo_ok && !t.questoes_ok) {
      if (await del("temas", t.id)) S.temas = S.temas.filter((x) => x.id !== t.id);
    }
    render(); toast(enviado(m) ? "Arquivo apagado" : "Arquivo oculto: não volta na próxima leitura do Drive");
  }

  /* ================= IMPORTAR DOCUMENTO (calendário, cronograma de provas, horário, regulamento, avisos…) ================= */
  // O navegador tira o texto do PDF mantendo as colunas; páginas escaneadas e fotos viram JPEG na pasta privada
  // "tarefas" do Storage. A IA (tarefa no servidor) classifica o documento e extrai o que serve ao painel.
  // NADA é salvo antes de o aluno conferir: cada item tem caixinha e campos editáveis, separados pelo destino.
  const TIPO_DOC = { calendario_geral: "Calendário acadêmico", cronograma_provas: "Cronograma de provas", horario_aulas: "Horário de aulas", programa_materia: "Programa de matéria", regulamento: "Regulamento", aviso: "Aviso", material_de_estudo: "Material de estudo", outro: "Documento" };
  const CATEG = [["feriado", "Feriado"], ["prova", "Provas"], ["matricula", "Matrícula"], ["aula", "Aulas"], ["recesso", "Recesso"], ["prazo", "Prazo"], ["outro", "Outro"]];
  const catParaTipo = (e) => e.categoria === "feriado" || e.categoria === "recesso" ? "feriado" : e.categoria === "prova" ? (/final/i.test(e.titulo) ? "final" : /pr[aá]ctic|pr[aá]tic/i.test(e.titulo) ? "pratica" : "parcial") : e.categoria === "aula" ? "aulas" : "outro";
  const DIAS_C = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const COPY_DOC = "Mande qualquer documento da faculdade: calendário acadêmico, cronograma de provas, horário de aulas, regulamento, avisos… A IA entende e coloca no painel; você confere antes de salvar. Para slides e material de estudo, use Enviar arquivos.";
  function vImportCal() {
    const c = ui.cal, dis = c.busy ? "disabled" : "";
    const usados = `${S.uso.calendarios || 0} de ${H.P.limite_calendarios_mes ?? 10} importações usadas este mês`;
    const rodando = c.tarefa && Tarefas.lista().some((t) => t.id === c.tarefa && (t.status === "na_fila" || t.status === "rodando"));
    let corpo = `<p style="margin:0">${esc(COPY_DOC)}</p>
      <div class="row" style="align-items:center"><label class="btn ${c.file ? "" : "solid"}" style="cursor:pointer">Importar documento (PDF ou foto)<input type="file" data-a="calArq" accept=".pdf,application/pdf,image/jpeg,image/png,image/webp" hidden ${dis}></label>
      ${c.file ? `<span class="drv-nome" style="font-size:14px">${esc(c.file.name)}</span><button class="btn solid" data-a="calLer" ${dis}>${c.busy ? "Preparando…" : "Ler com IA"}</button>` : ""}</div>`;
    if (rodando) corpo += `<p class="muted" style="margin:0;font-size:13px">Lendo… acompanhe em <button class="lnk" data-a="verTarefas" data-abre-tarefas>Tarefas</button>.</p>`;
    if (c.msg) corpo += `<div class="msg ${c.msg.bad ? "bad" : ""}" style="margin:0" aria-live="polite">${esc(c.msg.t)}${c.msg.enviar ? ` <button class="lnk" data-a="goEnviar">Ir para Enviar arquivos</button>` : ""}</div>`;
    if (c.doc) corpo += vRevisaoDoc(c);
    return `<div class="stack">${corpo}<p class="muted" style="margin:0;font-size:12.5px">${esc(usados)} (material de estudo e documentos sem nada para o painel não contam). A leitura é feita por IA e pode errar: confira as datas.</p></div>`;
  }
  const chk = (sec, i, on) => `<input type="checkbox" data-sec="${sec}" data-i="${i}" data-k="ok" ${on ? "checked" : ""} aria-label="Usar">`;
  const inp = (sec, i, k, v, extra = "") => `<input data-sec="${sec}" data-i="${i}" data-k="${k}" value="${esc(v ?? "")}" ${extra}>`;
  function vRevisaoDoc(c) {
    const d = c.doc, sec = (titulo, n, corpo) => n ? `<section class="docsec"><h3>${titulo} <span class="muted">(${n})</span></h3>${corpo}</section>` : "";
    const cab = `<div class="doc-cab"><span class="chip">${esc(TIPO_DOC[d.tipo] || "Documento")}</span>${d.titulo ? ` <b>${esc(d.titulo)}</b>` : ""}${d.resumo ? `<p style="margin:6px 0 0">${esc(d.resumo)}</p>` : ""}</div>`;
    const provas = sec("Provas → Calendário de provas e Agenda", c.provas.length, `<div id="calRev">${Leitor.revisaoHTML(c.provas, S.disc)}</div><p class="muted" style="margin:0;font-size:13px">Se já existir a mesma prova (matéria, P1/P2/Final e teórica/prática), a data é trocada pela nova.</p>`);
    const eventos = sec("Eventos → Calendário acadêmico", d.eventos.length, `<div class="tablewrap rev-wrap"><table class="rev"><thead><tr><th>Usar</th><th>Evento</th><th>Início</th><th>Fim</th><th>Tipo</th></tr></thead><tbody>${d.eventos.map((e, i) => `<tr><td>${chk("eventos", i, e.ok)}</td>
        <td>${inp("eventos", i, "titulo", e.titulo, 'maxlength="160" aria-label="Evento"')}${e.repetido ? `<span class="muted" style="display:block;font-size:12px">já está no calendário</span>` : ""}</td>
        <td>${inp("eventos", i, "data_ini", e.data_ini, 'type="date" aria-label="Início"')}</td><td>${inp("eventos", i, "data_fim", e.data_fim, 'type="date" aria-label="Fim"')}</td>
        <td><select data-sec="eventos" data-i="${i}" data-k="categoria" aria-label="Tipo">${CATEG.map(([k, l]) => `<option value="${k}" ${e.categoria === k ? "selected" : ""}>${l}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div>`);
    const horarios = sec("Horários → Aulas", d.horarios.length, `<div class="tablewrap rev-wrap"><table class="rev"><thead><tr><th>Usar</th><th>Matéria</th><th>Dia</th><th>Início</th><th>Fim</th><th>Sala</th></tr></thead><tbody>${d.horarios.map((h, i) => `<tr><td>${chk("horarios", i, h.ok)}</td>
        <td><span class="rev-doc">${esc(h.materia)}</span><select data-sec="horarios" data-i="${i}" data-k="disciplina_id" aria-label="Matéria"><option value="">Outra (o nome do documento)</option>${S.disc.map((x) => `<option value="${x.id}" ${x.id == h.disciplina_id ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></td>
        <td><select data-sec="horarios" data-i="${i}" data-k="dia_semana" aria-label="Dia">${DIAS_C.slice(1).map((n, j) => `<option value="${j + 1}" ${h.dia_semana == j + 1 ? "selected" : ""}>${n}</option>`).join("")}</select></td>
        <td>${inp("horarios", i, "hora_ini", h.hora_ini, 'type="time" aria-label="Início"')}</td><td>${inp("horarios", i, "hora_fim", h.hora_fim, 'type="time" aria-label="Fim"')}</td><td>${inp("horarios", i, "sala", h.sala, 'maxlength="60" aria-label="Sala"')}</td></tr>`).join("")}</tbody></table></div>`);
    const novas = d.materias.filter((m) => m.disciplina_id == null);
    const materias = sec("Matérias que faltam no painel", novas.length, `<ul class="doc-lista">${d.materias.map((m, i) => m.disciplina_id != null ? "" : `<li>${chk("materias", i, m.ok)}${inp("materias", i, "nome", m.nome, 'maxlength="120" aria-label="Matéria"')}${inp("materias", i, "professor", m.professor, 'maxlength="120" placeholder="Professor (opcional)" aria-label="Professor"')}</li>`).join("")}</ul>`);
    const notas = sec("Notas → Documentos importados (Configurações)", d.notas.length, `<ul class="doc-lista">${d.notas.map((n, i) => `<li class="doc-nota">${chk("notas", i, n.ok)}<div style="flex:1;min-width:0">${inp("notas", i, "titulo", n.titulo, 'maxlength="120" aria-label="Título da nota"')}<textarea class="inp" rows="3" data-sec="notas" data-i="${i}" data-k="texto" maxlength="2000" aria-label="Texto da nota">${esc(n.texto)}</textarea></div></li>`).join("")}</ul>`);
    const algo = c.provas.length + d.eventos.length + d.horarios.length + novas.length + d.notas.length;
    return `<div id="docRev" class="stack">${cab}${provas}${eventos}${horarios}${materias}${notas}
      <div class="row">${algo ? `<button class="btn solid" data-a="calSalvar" ${c.busy ? "disabled" : ""}>Salvar no painel</button>` : ""}<button class="btn ghost" data-a="calCancelar" ${c.busy ? "disabled" : ""}>${algo ? "Cancelar" : "Fechar"}</button></div></div>`;
  }
  async function lerCalendario() {
    const c = ui.cal; if (c.busy || !c.file) return;
    c.busy = true; c.doc = null; c.provas = null; c.msg = { t: "Abrindo o arquivo…" }; render();
    const passo = (t) => { c.msg = { t }; render(); };
    try {
      const prep = await Leitor.prepararDocumento(c.file, H.carregarPdfjs, passo);
      const caminhos = [];
      for (let i = 0; i < prep.imagens.length; i++) {
        passo(prep.imagens.length > 1 ? `Enviando as páginas que são imagem (${i + 1} de ${prep.imagens.length})…` : "Enviando a imagem…");
        const caminho = `${H.P.id}/${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}.jpg`;
        const up = await sb.storage.from("tarefas").upload(caminho, prep.imagens[i], { contentType: "image/jpeg", upsert: false });
        if (up.error) { if (caminhos.length) sb.storage.from("tarefas").remove(caminhos); throw new Error(/bucket|not found/i.test(up.error.message) ? "Falta rodar o 08_tarefas.sql no Supabase." : "Não consegui enviar a imagem: " + up.error.message); }
        caminhos.push(caminho);
      }
      const corpo = { acao: "documento", nome: c.file.name.slice(0, 150), ...(prep.texto ? { texto: prep.texto } : {}), ...(caminhos.length ? { imagem_caminhos: caminhos } : {}) };
      const r = await Tarefas.criar(corpo);
      ui.cal = { file: null, busy: false, tarefa: r.tarefa_id, provas: null, doc: null,
        msg: { t: `A IA está lendo o documento no servidor (uns 20 a 60 segundos${prep.cortado ? "; ele é grande: vão só as primeiras páginas" : ""}). Pode usar o resto do site: quando terminar, aparece um aviso e você confere aqui.` } };
    } catch (e) { c.busy = false; c.msg = { bad: true, t: e.message || "Não consegui ler o documento." }; }
    render();
  }
  /** Tarefa pronta: monta a revisão (nada é salvo antes). Repetidos já marcados como não usar. */
  function aplicarCalendario(t) {
    const r = t.resultado || {};
    const ids = S.disc.map((d) => d.id), nomes = S.disc.map((d) => d.nome);
    const casa = (id, nome) => id != null && ids.includes(id) ? id : ids[Leitor.casarMateria(nome, nomes)] ?? null;
    const provas = (r.provas || []).map((p) => { const id = casa(p.disciplina_id, p.materia); return { ...p, disciplina_id: id, ok: id != null }; });
    const jaTem = new Set(S.cal.map((x) => `${String(x.nome).toLowerCase()}|${x.inicio}`));
    const doc = {
      tipo: r.tipo || "outro", titulo: r.titulo || "", resumo: r.resumo || "", nome: r.nome || "",
      eventos: (r.eventos || []).map((e) => { const rep = jaTem.has(`${e.titulo.toLowerCase()}|${e.data_ini}`); return { ...e, ok: !rep, repetido: rep }; }),
      horarios: (r.horarios || []).map((h) => ({ ...h, disciplina_id: casa(h.disciplina_id, h.materia), ok: true })),
      materias: (r.materias || []).map((m) => ({ ...m, disciplina_id: casa(m.disciplina_id, m.nome), ok: true })),
      notas: (r.notas || []).map((n) => ({ ...n, ok: true })),
    };
    const n = provas.length + doc.eventos.length + doc.horarios.length + doc.materias.filter((m) => m.disciplina_id == null).length + doc.notas.length;
    const estudo = doc.tipo === "material_de_estudo";
    ui.cal = { file: null, busy: false, tarefa: null, provas, doc: estudo ? null : doc,
      msg: estudo ? { bad: true, enviar: true, t: r.aviso || "Isso parece material de estudo. Para usar nos resumos e questões, mande em Enviar arquivos." }
        : n ? { t: `${TIPO_DOC[doc.tipo] || "Documento"}: achei ${n} ${n === 1 ? "item" : "itens"} para o painel. Nada foi salvo ainda: confira e clique em "Salvar no painel".${r.aviso ? " " + r.aviso : ""}` }
        : { bad: true, t: r.aviso || "Não achei nada para colocar no painel nesse documento." } };
    atualizarUso().then(() => { if (ui.tab === "cal" || ui.tab === "config") render(); });
  }
  /** Grava o que o aluno marcou: provas, eventos, horários, matérias novas e o registro do documento (com as notas). */
  async function salvarCalendario() {
    const c = ui.cal, d = c.doc; if (!d || c.busy) return;
    const box = document.getElementById("calRev");
    const provas = box ? Leitor.lerRevisao(box) : [];
    const usar = (k) => d[k].filter((x) => x.ok);
    const eventos = usar("eventos").filter((e) => e.titulo.trim() && /^\d{4}-\d{2}-\d{2}$/.test(e.data_ini));
    const horarios = usar("horarios").filter((h) => h.hora_ini && h.hora_fim && h.hora_fim > h.hora_ini);
    const materias = d.materias.filter((m) => m.ok && m.disciplina_id == null && m.nome.trim());
    const notas = usar("notas").filter((n) => n.titulo.trim() && n.texto.trim()).map((n) => ({ titulo: n.titulo.trim().slice(0, 120), texto: n.texto.trim().slice(0, 2000) }));
    if (!provas.length && !eventos.length && !horarios.length && !materias.length && !notas.length) return toast("Marque pelo menos um item.");
    c.busy = true; render();
    const erros = [], feito = { provas: 0, eventos: 0, horarios: 0, materias: 0 };
    // o registro do documento (memória): resumo e notas
    let docId = null;
    { const { data, error } = await sb.from("documentos").insert({ nome: (d.nome || d.titulo || "Documento").slice(0, 200), tipo: d.tipo === "material_de_estudo" ? "outro" : d.tipo, titulo: d.titulo || null, resumo: d.resumo || null, notas }).select("*").single();
      if (error) erros.push(/documentos|schema cache/i.test(error.message) ? "falta rodar o 08_tarefas.sql" : error.message); else { docId = data.id; (S.docs = S.docs || []).unshift(data); } }
    for (const p of provas) {
      const campos = { data: p.data, hora: p.hora };
      const ex = S.provas.find((x) => x.disciplina_id === p.disciplina_id && x.tipo === p.tipo && (x.modalidade || "teorica") === p.modalidade);
      if (ex) { const { error } = await sb.from("provas").update(campos).eq("id", ex.id); if (error) { erros.push(error.message); continue; } Object.assign(ex, campos); feito.provas++; }
      else { const { data, error } = await sb.from("provas").insert({ disciplina_id: p.disciplina_id, tipo: p.tipo, modalidade: p.modalidade, ...campos }).select("*").single(); if (error) { erros.push(error.message); continue; } S.provas.push(data); feito.provas++; }
    }
    for (const e of eventos) {
      const linha = { nome: e.titulo.trim().slice(0, 160), tipo: catParaTipo(e), inicio: e.data_ini, fim: e.data_fim && e.data_fim > e.data_ini ? e.data_fim : null, descricao: e.descricao || null, documento_id: docId };
      const { data, error } = await sb.from("calendario").insert(linha).select("*").single();
      if (error) { if (!/duplicate|calendario_sem_repetir|23505/i.test(error.message + error.code)) erros.push(error.message); continue; } // repetido: já existe
      S.cal.push(data); feito.eventos++;
    }
    for (const h of horarios) {
      const { data, error } = await sb.from("horarios").insert({ semestre_id: H.SEM().atual?.id ?? null, disciplina_id: h.disciplina_id ? +h.disciplina_id : null, nome: h.disciplina_id ? null : h.materia.slice(0, 120), sala: h.sala || null, dia: +h.dia_semana, inicio: h.hora_ini, fim: h.hora_fim }).select("*").single();
      if (error) { erros.push(error.message); continue; } S.horarios.push(data); feito.horarios++;
    }
    for (const m of materias) {
      const { data, error } = await sb.from("disciplinas").insert({ nome: m.nome.trim().slice(0, 120), professor: (m.professor || "").trim() || null, ordem: S.disc.length, ...(H.SEM().atual ? { semestre_id: H.SEM().atual.id } : {}) }).select("*").single();
      if (error) { erros.push(error.message); continue; } S.disc.push(data); feito.materias++;
    }
    const partes = [[feito.provas, "prova", "provas"], [feito.eventos, "evento", "eventos"], [feito.horarios, "aula", "aulas"], [feito.materias, "matéria", "matérias"], [notas.length && docId ? notas.length : 0, "nota", "notas"]].filter(([n]) => n).map(([n, a, b]) => `${n} ${n === 1 ? a : b}`);
    ui.cal = { file: null, busy: false, provas: null, doc: null, msg: erros.length ? { bad: true, t: `${partes.length ? "Salvo: " + partes.join(", ") + ". " : ""}Não salvou tudo: ${erros[0]}` } : { t: `Salvo no painel: ${partes.join(", ") || "nada novo"}.` } };
    const prim = [...provas.map((p) => p.data), ...eventos.map((e) => e.data_ini)].sort()[0]; if (prim) { ui.calY = +prim.slice(0, 4); ui.calM = +prim.slice(5, 7) - 1; }
    render(); toast(partes.length ? `Salvo: ${partes.join(", ")}` : "Nada novo para salvar");
  }
  /** Configurações: documentos importados (o resumo da IA e as notas guardadas) */
  function vDocumentos() {
    const L = S.docs || [];
    if (!L.length) return `<p class="muted" style="margin:0">Nenhum documento importado ainda. Use "Importar documento" acima ou na aba Calendário.</p>`;
    return `<ul class="doc-lista">${L.map((d) => `<li class="doc-item"><details ${ui.confDoc === d.id ? "open" : ""}><summary><b>${esc(d.titulo || d.nome || "Documento")}</b> <span class="muted">· ${esc(TIPO_DOC[d.tipo] || "Documento")} · ${esc(new Date(d.criado_em).toLocaleDateString("pt-BR"))}${(d.notas || []).length ? ` · ${(d.notas || []).length} nota${d.notas.length === 1 ? "" : "s"}` : ""}</span></summary>
      ${d.nome && d.titulo ? `<p class="muted" style="margin:6px 0 0;font-size:13px">Arquivo: ${esc(d.nome)}</p>` : ""}${d.resumo ? `<p style="margin:6px 0">${esc(d.resumo)}</p>` : ""}
      ${(d.notas || []).map((n) => `<div class="doc-nota-v"><b>${esc(n.titulo)}</b><div class="resumo" style="font-size:14px">${md(n.texto)}</div></div>`).join("")}
      <div class="row" style="margin-top:8px">${ui.confDoc === d.id ? `<button class="btn" data-a="delDoc" data-id="${d.id}" style="color:var(--bad);border-color:var(--bad)">Apagar</button><button class="btn ghost" data-a="cancelDel">Não</button><span class="muted" style="font-size:13px">As datas que já foram para o calendário continuam lá.</span>` : `<button class="btn ghost" data-a="askDoc" data-id="${d.id}">Apagar este registro</button>`}</div></details></li>`).join("")}</ul>`;
  }

  /* ================= CONFIGURAÇÕES ================= */
  function vConfig() {
    return hero("Suas", "configurações", "var(--ink)")
      + janela("Enviar arquivos", `<div class="win-body">${vUpload()}</div>`)
      + janela("Importar documento", `<div class="win-body">${vImportCal()}</div>`)
      + janela("Documentos importados", `<div class="win-body">${vDocumentos()}</div>`)
      + janela("Semestres", `<div class="win-body">${vSemestres()}</div>`);
  }
  /** Semestre atual (número, turma e faculdade) e a turma dos semestres anteriores */
  function vSemestres() {
    const SM = H.SEM(), a = SM.atual;
    if (!SM.ok) return `<p class="muted" style="margin:0">A parte de semestres ainda não foi ativada no banco (falta rodar o 04_semestres.sql).</p>`;
    const dataBR = (d) => d ? new Date(d + "T12:00").toLocaleDateString("pt-BR") : "";
    const antigos = (SM.lista || []).filter((x) => !x.atual).reverse();
    const facs = S.faculdades || [];
    return `${a ? `<form data-form="editSem" class="stack" style="gap:10px">
        <div class="row" style="align-items:flex-end">
          <label class="field" style="flex:0 1 150px"><span class="mono">Semestre atual</span><select name="numero">${a.numero ? "" : `<option value="">Escolha</option>`}${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${a.numero == i + 1 ? "selected" : ""}>${i + 1}º semestre</option>`).join("")}</select></label>
          <label class="field" style="flex:0 1 120px"><span class="mono">Turma (sala)</span>${App.campoTurma("turma", a.turma, "semTurma")}</label>
          ${facs.length ? `<label class="field" style="flex:1 1 220px"><span class="mono">Faculdade</span><select name="fac">${facs.map((f) => `<option value="${f.id}" ${f.id == (a.faculdade_id || H.P.faculdade_id) ? "selected" : ""}>${esc(f.nome)}</option>`).join("")}</select></label>` : ""}
          <button class="btn solid">Salvar</button></div>
        <p class="muted" style="margin:0;font-size:13px">Turma é a letra da sua sala (ex.: F), como aparece no calendário de provas. Ao importar um documento com grade por turma (ex.: cronograma de provas), a IA procura a linha deste semestre e desta turma.</p></form>`
      : `<p style="margin:0">Nenhum semestre atual.</p>`}
      ${antigos.length ? `<h3 style="margin:16px 0 6px">Semestres anteriores</h3><ul class="sem-lista">${antigos.map((x) => `<li><form data-form="editSemAnt" data-id="${x.id}" class="row" style="align-items:flex-end;width:100%">
          <span style="flex:1 1 160px;min-width:0"><b>${x.numero ? `${x.numero}º semestre` : "Semestre sem número"}</b><span class="muted" style="display:block;font-size:13px">${esc(dataBR(x.inicio))}${x.fim ? " a " + esc(dataBR(x.fim)) : ""}</span></span>
          <label class="field" style="flex:0 1 90px"><span class="mono">Turma</span>${App.campoTurma("turma", x.turma)}</label><button class="btn">Salvar</button></form></li>`).join("")}</ul>` : ""}
      <div class="row" style="margin-top:12px;align-items:center;justify-content:space-between"><p class="muted" style="margin:0;font-size:13.5px">Passou de semestre? Monte o novo em "Adicionar semestre" (o atual fica guardado).</p><button class="btn" data-a="goPerfil">Adicionar semestre</button></div>`;
  }
  async function salvarSemestre(f, atual) {
    const fd = Object.fromEntries(new FormData(f));
    const turma = App.limparTurma(fd.turma) || null;
    const sem = atual ? H.SEM().atual : (H.SEM().lista || []).find((x) => x.id == f.dataset.id);
    if (!sem) return;
    const campos = { turma };
    if (atual) {
      const numero = fd.numero ? +fd.numero : null;
      if (numero !== (sem.numero ?? null) && sem.numero && !confirm(`Mudar o semestre atual de ${sem.numero}º para ${numero ? numero + "º" : "sem número"}? Suas matérias continuam as mesmas: só o número muda. Para começar um semestre novo com outras matérias, use "Adicionar semestre".`)) return render();
      campos.numero = numero;
      if (fd.fac) campos.faculdade_id = +fd.fac;
    }
    const { error } = await sb.from("semestres").update(campos).eq("id", sem.id);
    if (error) return toast(/turma/i.test(error.message) ? "Turma: use só letras (ex.: F)." : "Não consegui salvar: " + error.message);
    await H.recarregarSemestres();
    await recarregar();
    toast(atual ? `Salvo: ${campos.numero ? campos.numero + "º semestre" : "semestre"}${turma ? `, turma ${turma}` : ""}` : "Turma salva");
  }

  /* ================= QUESTÕES ================= */
  const QTIPOS = { mc: "Marcar X", vf: "Verdadeiro ou falso", rel: "Relacionar", dis: "Dissertativa" };
  const MAX_LOTE = { mc: 8, vf: 6, rel: 6, dis: 5 };
  const qTipo = (q) => QTIPOS[q.tipo] ? q.tipo : "mc";
  function qPool() { let q = S.questoes || []; if (ui.qDisc) q = q.filter((x) => x.disciplina_id == ui.qDisc); if (ui.qMode === "rev") q = q.filter((x) => x.ultima === false || x.id === ui._keep); return q; }
  function temaStats() {
    const m = {}; (S.questoes || []).forEach((q) => { if (!q.acertos && !q.erros) return; const k = q.tema; m[k] = m[k] || { tema: k, disc: dname(q.disciplina_id), a: 0, e: 0 }; m[k].a += q.acertos; m[k].e += q.erros; });
    return Object.values(m).map((x) => ({ ...x, pct: Math.round(x.a / (x.a + x.e) * 100) })).sort((a, b) => b.pct - a.pct);
  }
  function qSt(q) { if (!ui.qst || ui.qst.id !== q.id) ui.qst = { id: q.id, vf: {}, rel: {}, txt: "", done: false }; return ui.qst; }
  async function qRecord(q, ok) {
    if (ok) { q.acertos++; q.ultima = true; } else { q.erros++; q.ultima = false; }
    if (ui.qMode === "rev" && ok) ui._keep = q.id;
    render();
    const { error } = await sb.from("questoes").update({ acertos: q.acertos, erros: q.erros, ultima: q.ultima, respondida_em: new Date().toISOString() }).eq("id", q.id);
    if (error) toast("Não consegui salvar a resposta: " + error.message);
  }
  const LET = "abcdefghij";
  function qBody(q) {
    const tp = qTipo(q), st = qSt(q);
    if (tp === "mc") {
      const ans = ui.qAnsId === q.id ? ui.qAns : null;
      const opts = (q.opcoes || []).map((o, i) => { let c = ""; if (ans != null) { if (i === q.correta) c = "right"; else if (i === ans) c = "wrong"; }
        return `<button class="opt ${c}" data-a="answer" data-i="${i}" ${ans != null ? "disabled" : ""}><span class="l">${"ABCDE"[i]}</span><span>${esc(o)}</span></button>`; }).join("");
      return opts + (ans == null ? "" : `<div class="fb ${ans === q.correta ? "" : "bad"}"><b>${ans === q.correta ? "Correto!" : "Não foi dessa vez."}</b> ${esc(q.explicacao)}</div>`);
    }
    if (tp === "vf") {
      const af = q.afirmativas || []; const all = af.every((_, i) => st.vf[i] != null);
      const rows = af.map((a, i) => { const pick = st.vf[i]; const cls = st.done ? (pick === !!a.v ? "right" : "wrong") : "";
        return `<div class="vfrow ${cls}"><span class="l mono" style="flex:none;padding-top:2px">${i + 1}</span><span class="txt">${esc(a.texto)}${st.done ? `<span class="why"><b>${a.v ? "Verdadeira" : "Falsa"}.</b> ${esc(a.porque || "")}</span>` : ""}</span>
        <span class="vfb"><button data-a="vfPick" data-i="${i}" data-v="1" aria-pressed="${pick === true}" ${st.done ? "disabled" : ""} aria-label="Verdadeiro">V</button><button data-a="vfPick" data-i="${i}" data-v="0" aria-pressed="${pick === false}" ${st.done ? "disabled" : ""} aria-label="Falso">F</button></span></div>`; }).join("");
      const nOk = af.filter((a, i) => st.vf[i] === !!a.v).length;
      return rows + (st.done ? `<div class="fb ${nOk === af.length ? "" : "bad"}"><b>${nOk} de ${af.length} certas.</b> ${esc(q.explicacao || "")}</div>` : `<div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn solid" data-a="vfCheck" ${all ? "" : "disabled"}>Corrigir</button></div>`);
    }
    if (tp === "rel") {
      const A = q.colA || [], B = q.colB || []; const all = A.every((_, i) => st.rel[i] != null && st.rel[i] !== "");
      const left = A.map((a, i) => { const pick = st.rel[i]; const ok = st.done && +pick === q.pares[i];
        return `<div class="relitem ${st.done ? (ok ? "right" : "wrong") : ""}"><select data-a="relPick" data-i="${i}" aria-label="Par de ${esc(a)}" ${st.done ? "disabled" : ""}><option value="">—</option>${B.map((_, j) => `<option value="${j}" ${pick !== undefined && pick !== "" && +pick === j ? "selected" : ""}>${LET[j]}</option>`).join("")}</select><span style="flex:1;min-width:0">${esc(a)}${st.done && !ok ? `<span class="why" style="display:block;font-size:12.5px;color:var(--muted)">Certo: ${LET[q.pares[i]]}</span>` : ""}</span></div>`; }).join("");
      const right = B.map((b, j) => `<div class="relitem"><span class="lt">${LET[j]}</span><span style="flex:1;min-width:0">${esc(b)}</span></div>`).join("");
      const nOk = A.filter((_, i) => +st.rel[i] === q.pares[i]).length;
      return `<div class="relgrid"><div class="relcol"><span class="mono">Coluna 1 · escolha a letra</span>${left}</div><div class="relcol"><span class="mono">Coluna 2</span>${right}</div></div>`
        + (st.done ? `<div class="fb ${nOk === A.length ? "" : "bad"}"><b>${nOk} de ${A.length} pares certos.</b> ${esc(q.explicacao || "")}</div>` : `<div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn solid" data-a="relCheck" ${all ? "" : "disabled"}>Corrigir</button></div>`);
    }
    return `<textarea class="distxt" id="disTxt" data-qid="${q.id}" placeholder="Escreva sua resposta como na prova…" ${st.done ? "readonly" : ""}>${esc(st.txt)}</textarea>`
      + (st.done ? `<div class="fb"><b>Resposta esperada:</b><div class="resumo" style="font-size:14px">${md(q.resposta || "")}</div>${q.explicacao ? `<p style="margin:6px 0 0">${esc(q.explicacao)}</p>` : ""}</div>
        ${st.marked ? "" : `<div class="row" style="margin-top:10px;justify-content:flex-end"><span class="muted" style="font-size:13.5px">Compare com a sua resposta:</span><button class="btn" data-a="disMark" data-v="0" style="color:var(--bad);border-color:var(--bad)">Errei</button><button class="btn solid" data-a="disMark" data-v="1">Acertei</button></div>`}`
        : `<div class="row" style="margin-top:10px;justify-content:flex-end"><button class="btn solid" data-a="disShow">Ver gabarito</button></div>`);
  }
  function vQuest() {
    if (!S.questoes) { carregarQuestoes().then(() => { if (ui.tab === "quest") render(); }).catch((e) => toast("Não consegui carregar as questões: " + e.message)); return hero("Banco de", "questões", "var(--green)") + `<div class="empty">Carregando…</div>`; }
    const sel = `<select class="inp" data-a="qDisc" style="max-width:260px" aria-label="Filtrar disciplina"><option value="">Todas as disciplinas</option>${S.disc.map((d) => `<option value="${d.id}" ${ui.qDisc == d.id ? "selected" : ""}>${esc(d.nome)}</option>`).join("")}</select>`;
    let main = "";
    if (ui.qMode === "prat" || ui.qMode === "rev") {
      const pool = qPool();
      if (!pool.length) main = `${sel}<div class="empty" style="margin-top:14px">${ui.qMode === "rev" ? "Nenhum erro para revisar aqui. Bom sinal." : "Sem questões para esta disciplina. Gere algumas na aba “Gerar com IA”."}</div>`;
      else {
        if (ui.qIdx >= pool.length) ui.qIdx = 0;
        const q = pool[ui.qIdx];
        main = `<div class="row" style="justify-content:space-between;align-items:center">${sel}<span class="mono tnum">Questão ${ui.qIdx + 1} de ${pool.length}</span></div>
          <p class="mono" style="margin:16px 0 4px">${esc(dname(q.disciplina_id))} · ${esc(q.tema)}<span class="qtipo">${QTIPOS[qTipo(q)]}</span></p>
          <h3 style="font-size:17px;line-height:1.4;white-space:pre-line;overflow-wrap:anywhere">${esc(q.enunciado)}</h3>${qBody(q)}
          <div class="row" style="margin-top:14px;justify-content:space-between"><button class="btn ghost" data-a="delQ" data-id="${q.id}">Excluir questão</button><button class="btn solid" data-a="nextQ">Próxima</button></div>`;
      }
    } else if (ui.qMode === "perf") {
      const st = temaStats(), tot = (S.questoes || []).reduce((s, q) => s + q.acertos + q.erros, 0);
      const worst = st.slice().sort((a, b) => b.e - a.e)[0];
      main = `<div class="perf"><div>${st.length ? st.map((x) => `<div class="prow"><span>${esc(x.tema)} <span class="muted" style="font-size:12.5px">· ${esc(x.disc)}</span></span><b class="tnum" style="color:${x.pct < 60 ? "var(--terra)" : "inherit"}">${x.pct}%</b><div class="bar"><i style="width:${x.pct}%;background:${x.pct < 60 ? "var(--terra)" : x.pct < 75 ? "color-mix(in srgb,var(--green) 65%,var(--card))" : "var(--green)"}"></i></div></div>`).join("") : `<div class="empty">Responda algumas questões para ver seu desempenho por tema.</div>`}</div>
        <div style="display:flex;flex-direction:column;gap:10px"><div class="stat"><span class="mono">Respostas dadas</span><div class="big tnum">${tot}</div></div>
        ${worst && worst.e ? `<div class="stat" style="background:var(--terra-s);border-color:transparent"><span class="mono">Revisar hoje</span><div style="font-weight:700;margin-top:6px">${esc(worst.tema)} · ${worst.e} erro${worst.e > 1 ? "s" : ""}</div></div>` : ""}</div></div>`;
    } else {
      const d = ui.genDisc && discById(ui.genDisc) ? ui.genDisc : S.disc[0]?.id;
      const topics = temasDe(d).map((t) => `<option value="${esc(t.nome)}">`).join("");
      main = `<h2 style="font-size:19px">Gerar questões com IA</h2><p class="muted" style="margin:6px 0 14px">Escolha a disciplina, o conteúdo e quantas questões de cada tipo (até 20 de cada, 40 no total). São no estilo de prova de medicina, a maioria com caso clínico, e nunca repetem as que você já recebeu.</p>
        ${S.disc.length ? `<form data-form="gen" class="row">
          <label class="field" style="flex:1 1 200px"><span class="mono">Disciplina</span><select name="disc" data-a="genDisc">${S.disc.map((x) => `<option value="${x.id}" ${x.id == d ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></label>
          <label class="field" style="flex:1 1 200px"><span class="mono">Conteúdo</span><input name="tema" list="temasDl" maxlength="200" placeholder="Ex.: Anticoagulantes" value="${esc(ui.genTema || "")}" required><datalist id="temasDl">${topics}</datalist></label>
          <div class="qmix">${[["nmc", "Marcar X", 4], ["nvf", "Verdadeiro ou falso", 3], ["nrel", "Relacionar", 2], ["ndis", "Dissertativa", 1]].map(([k, l, dv]) => `<label class="field"><span class="mono">${l}</span><input name="${k}" type="number" min="0" max="20" step="1" inputmode="numeric" value="${(ui.genMix && ui.genMix[k]) ?? dv}"></label>`).join("")}</div>
          <button class="btn solid" ${ui.genBusy ? "disabled" : ""}>${ui.genBusy ? "Gerando…" : "Gerar questões"}</button></form>` : `<div class="empty">Adicione uma matéria primeiro. ${SEM_MATERIA}</div>`}
        <p class="muted" style="font-size:13px;margin-top:8px">As questões são feitas pelo Claude a partir do material do professor do tema (quando houver). ${esc(usoTxt("questoes", "limite_questoes_mes", "questões"))}.</p>
        ${ui.genMsg ? `<p style="margin-top:12px" aria-live="polite">${esc(ui.genMsg)}</p>` : ""}`;
    }
    const nav = [["prat", "Praticar"], ["perf", "Desempenho"], ["rev", "Revisar erros"], ["gen", "Gerar com IA"]].map(([k, l]) => `<button data-a="qMode" data-m="${k}" aria-current="${ui.qMode === k}">${l}</button>`).join("");
    return hero("Banco de", "questões", "var(--green)") + `<section class="win"><div class="qwin"><aside class="qside"><b>Questões</b>${nav}</aside><div class="qmain">${main}</div></div></section>`;
  }
  function msgQuestoes(r) {
    const n = r.salvas || 0, disc = discById(r.disciplina_id)?.nome || "a matéria";
    if (!n) return r.repetidas ? "Todas as questões geradas eram repetidas das que você já recebeu. Tente de novo ou escolha outro subtema." : "A IA não devolveu questões válidas. Tente de novo.";
    return `${n} questões de ${r.tema} adicionadas${r.aviso ? ` (${r.aviso})` : ""}. Vá em “Praticar” e filtre por ${disc}.`;
  }
  // Todas as questões pedidas viram UMA tarefa no servidor (os lotes são feitos lá).
  async function gerarQuestoes(fd) {
    const disc = discById(fd.disc); if (!disc) return;
    const tema = String(fd.tema || "").trim(); if (!tema) return;
    const cl = (v) => Math.max(0, Math.min(20, parseInt(v, 10) || 0));
    const mix = { mc: cl(fd.nmc), vf: cl(fd.nvf), rel: cl(fd.nrel), dis: cl(fd.ndis) };
    ui.genMix = { nmc: mix.mc, nvf: mix.vf, nrel: mix.rel, ndis: mix.dis }; ui.genTema = tema; ui.genDisc = disc.id;
    const total = mix.mc + mix.vf + mix.rel + mix.dis;
    if (!total) { ui.genMsg = "Escolha pelo menos uma questão em algum dos tipos."; return render(); }
    if (total > 40) { ui.genMsg = "O máximo é 40 questões por vez. Diminua alguma quantidade."; return render(); }
    ui.genBusy = true; ui.genMsg = "Mandando para a IA…"; render();
    const t = temasDe(disc.id).find((x) => qNorm(x.nome) === qNorm(tema));
    try {
      const corpo = { acao: "questoes", disciplina_id: disc.id, tema, tema_id: t ? t.id : null, mix };
      if (t && faltaLer(t.id)) { await Fila.adicionar("material", `Ler o material e fazer questões: ${tema}`, { tema_id: t.id, depois: corpo }); ui.genTarefa = null; }
      else { const r = await Tarefas.criar(corpo); ui.genTarefa = r.tarefa_id; }
      ui.genMsg = `Gerando ${total} questões no servidor. Pode usar o resto do site (ou sair): quando ficarem prontas, aparece um aviso.`;
    } catch (e) { ui.genMsg = e.message || "Não consegui gerar agora. Tente de novo em instantes."; }
    finally { ui.genBusy = false; render(); }
  }

  /* ================= LAMINÁRIO (imagens do próprio aluno) ================= */
  const LAM_MAX_BYTES = 300 * 1024;
  function lamPool() { let p = S.laminas || []; if (ui.lamTema) p = p.filter((c) => (c.tema || "") === ui.lamTema); if (ui.lamOnlyWrong) p = p.filter((c) => c.ultima === false); return p; }
  function lamNext() {
    const p = lamPool(); if (!p.length) { ui.lamCur = null; return; }
    const unseen = p.filter((c) => !c.acertos && !c.erros), wrong = p.filter((c) => c.ultima === false && c.id !== ui.lamCur);
    const bag = unseen.length ? unseen : wrong.length && Math.random() < .6 ? wrong : p.filter((c) => c.id !== ui.lamCur);
    const lista = bag.length ? bag : p;
    ui.lamCur = lista[Math.floor(Math.random() * lista.length)].id; ui.lamShow = false;
  }
  async function urlLamina(caminhos) {
    const falta = caminhos.filter((c) => !LAMURL[c] || LAMURL[c].ate < Date.now());
    if (falta.length) {
      const { data, error } = await sb.storage.from("laminas").createSignedUrls(falta, 3600);
      if (error) throw error;
      (data || []).forEach((x) => { if (x.signedUrl) LAMURL[x.path] = { url: x.signedUrl, ate: Date.now() + 50 * 60 * 1000 }; });
    }
  }
  function vLam() {
    const L = S.laminas || [];
    const temas = [...new Set(L.map((c) => c.tema || ""))].filter(Boolean).sort();
    const vistos = L.filter((x) => x.acertos || x.erros).length, ac = L.filter((x) => x.ultima).length;
    const gerenciar = vLamGerenciar(temas);
    if (!L.length) return `<h2 style="font-size:19px">Laminário</h2><p class="muted" style="margin:6px 0 12px">Envie as fotos das lâminas ou dos slides que caem na prova prática, com a resposta. Depois treine aqui: a imagem aparece, você diz o órgão e a doença em voz alta e confere.</p><div class="empty">Nenhuma lâmina ainda.</div>${gerenciar}`;
    const pool = lamPool(); if (!ui.lamCur || !pool.some((c) => c.id === ui.lamCur)) lamNext();
    const c = L.find((x) => x.id === ui.lamCur);
    const head = `<div class="row" style="justify-content:space-between;align-items:center">
      <select class="inp" data-a="lamTema" style="max-width:280px" aria-label="Filtrar conteúdo"><option value="">Todo o laminário (${L.length})</option>${temas.map((t) => `<option value="${esc(t)}" ${ui.lamTema === t ? "selected" : ""}>${esc(t)} (${L.filter((x) => x.tema === t).length})</option>`).join("")}</select>
      <label class="check"><input type="checkbox" data-a="lamWrong" ${ui.lamOnlyWrong ? "checked" : ""}><span style="text-decoration:none;color:inherit">Só as que errei</span></label>
      <span class="mono tnum">${vistos}/${L.length} vistas · ${ac} certas</span></div>`;
    if (!c) return head + `<div class="empty" style="margin-top:14px">${ui.lamOnlyWrong ? "Nenhuma lâmina errada neste filtro." : "Nada aqui."}</div>` + gerenciar;
    const u = LAMURL[c.caminho];
    if (!u || u.ate < Date.now()) urlLamina([c.caminho]).then(() => { if (ui.tab === "lam") render(); }).catch(() => toast("Não consegui abrir a imagem."));
    return head + `<div class="lamimg">${u ? `<img src="${esc(u.url)}" alt="Lâmina para identificar">` : `<span class="muted">Carregando a imagem…</span>`}</div>
      ${ui.lamShow ? `<div class="fb" style="margin-top:12px">${c.vista || c.orgao ? `<span class="mono">${esc([c.vista, c.orgao].filter(Boolean).join(" · "))}</span>` : ""}<div style="font-family:var(--f-display);font-weight:800;font-size:20px;margin:4px 0;overflow-wrap:anywhere">${esc(c.resposta)}</div>${esc(c.dica || "")}${c.acertos || c.erros ? `<div class="mono" style="margin-top:6px">Histórico: ${c.acertos} certa${c.acertos === 1 ? "" : "s"}, ${c.erros} errada${c.erros === 1 ? "" : "s"}</div>` : ""}</div>
        <div class="row" style="margin-top:12px;justify-content:flex-end"><button class="btn" data-a="lamMark" data-v="0" style="color:var(--bad);border-color:var(--bad)">Errei</button><button class="btn solid" data-a="lamMark" data-v="1">Acertei</button></div>`
      : `<p style="margin:12px 0 0;font-weight:500">Qual é o órgão e a doença? Diga em voz alta, como na prova.</p><div class="row" style="margin-top:10px;justify-content:space-between"><button class="btn ghost" data-a="lamSkip">Pular</button><button class="btn solid" data-a="lamReveal">Mostrar resposta</button></div>`}` + gerenciar;
  }
  function vLamTab() {
    const topo = hero("Meu", "laminário", "var(--plum)");
    if (!S.laminas) { carregarQuestoes().then(() => { if (ui.tab === "lam") render(); }).catch((e) => toast("Não consegui carregar o laminário: " + e.message)); return topo + `<div class="empty">Carregando…</div>`; }
    return topo + `<section class="win"><div class="win-body">${vLam()}</div></section>`;
  }
  function vLamGerenciar(temas) {
    const L = S.laminas || [], f = ui.lamForm || {};
    return `<details class="cfg" id="lamGer" ${ui.lamGer ? "open" : ""}><summary>Adicionar e gerenciar lâminas (${L.length} de 300)</summary>
      <form data-form="addLam" class="stack" style="margin-top:10px">
        <label class="field"><span class="mono">Imagem (foto da lâmina ou do slide)</span><input type="file" name="arq" id="lamArq" accept="image/*" required></label>
        <div class="row"><label class="field" style="flex:1 1 180px"><span class="mono">Resposta (diagnóstico)</span><input name="resposta" maxlength="300" required placeholder="Ex.: Cirrose hepática" value="${esc(f.resposta || "")}"></label>
          <label class="field" style="flex:1 1 160px"><span class="mono">Conteúdo (para filtrar)</span><input name="tema" maxlength="120" list="lamTemasDl" placeholder="Ex.: Fígado" value="${esc(f.tema || "")}"><datalist id="lamTemasDl">${temas.map((t) => `<option value="${esc(t)}">`).join("")}</datalist></label></div>
        <div class="row"><label class="field" style="flex:1 1 140px"><span class="mono">Órgão (opcional)</span><input name="orgao" maxlength="120" value="${esc(f.orgao || "")}"></label>
          <label class="field" style="flex:1 1 140px"><span class="mono">Vista / coloração (opcional)</span><input name="vista" maxlength="120" placeholder="Ex.: HE 40x" value="${esc(f.vista || "")}"></label>
          <label class="field" style="flex:1 1 160px"><span class="mono">Matéria (opcional)</span><select name="disc"><option value="">Nenhuma</option>${S.disc.map((d) => `<option value="${d.id}" ${f.disc == d.id ? "selected" : ""}>${esc(d.nome)}</option>`).join("")}</select></label></div>
        <label class="field"><span class="mono">Dica para reconhecer (opcional)</span><input name="dica" maxlength="1000" placeholder="Ex.: nódulos de regeneração cercados por fibrose"></label>
        <div class="row"><button class="btn solid" ${ui.lamBusy ? "disabled" : ""}>${ui.lamBusy ? "Enviando…" : "Guardar lâmina"}</button><span class="muted" style="font-size:13px">A imagem é reduzida no seu aparelho antes de enviar e fica só na sua conta.</span></div>
      </form>
      ${L.length ? `<ul class="lam-lista">${L.map((c) => `<li>${LAMURL[c.caminho] ? `<img src="${esc(LAMURL[c.caminho].url)}" alt="" width="56" height="42" loading="lazy">` : `<span class="lam-ph"></span>`}<div style="flex:1;min-width:0"><b class="lam-res">${esc(c.resposta)}</b><div class="muted" style="font-size:12.5px">${esc([c.tema, c.orgao, c.disciplina_id ? dname(c.disciplina_id) : ""].filter(Boolean).join(" · "))}</div></div>${ui.confLam === c.id ? `<button class="btn" data-a="delLam" data-id="${c.id}" style="color:var(--bad);border-color:var(--bad)">Apagar</button><button class="btn ghost" data-a="cancelDel">Não</button>` : `<button class="x" data-a="askLam" data-id="${c.id}" aria-label="Apagar lâmina ${esc(c.resposta)}">×</button>`}</li>`).join("")}</ul>` : ""}
    </details>`;
  }
  async function reduzirImagem(file) {
    const img = await createImageBitmap(file);
    let lado = Math.min(1600, Math.max(img.width, img.height)), q = 0.85, blob = null;
    for (let i = 0; i < 8; i++) {
      const esc2 = lado / Math.max(img.width, img.height);
      const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(img.width * esc2)); c.height = Math.max(1, Math.round(img.height * esc2));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", q));
      if (blob && blob.size <= LAM_MAX_BYTES) return blob;
      if (q > 0.6) q -= 0.1; else lado = Math.round(lado * 0.8);
    }
    if (!blob || blob.size > LAM_MAX_BYTES * 2) throw new Error("Não consegui reduzir essa imagem.");
    return blob;
  }
  async function addLamina(form) {
    const fd = Object.fromEntries(new FormData(form));
    const file = form.querySelector("#lamArq")?.files?.[0];
    if (!file) return toast("Escolha a imagem.");
    if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|gif|bmp)$/i.test(file.name)) return toast("Use uma imagem (foto ou print).");
    if (file.size > 40 * 1024 * 1024) return toast("Imagem grande demais.");
    if ((S.laminas || []).length >= 300) return toast("Limite de 300 lâminas. Apague algumas para enviar outras.");
    ui.lamBusy = true; ui.lamForm = { resposta: fd.resposta, tema: fd.tema, orgao: fd.orgao, vista: fd.vista, disc: fd.disc }; render();
    let caminho = null;
    try {
      const blob = await reduzirImagem(file);
      caminho = `${H.P.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const up = await sb.storage.from("laminas").upload(caminho, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw up.error;
      const { data, error } = await sb.from("laminas").insert({ caminho, resposta: String(fd.resposta).trim().slice(0, 300), tema: String(fd.tema || "").trim() || null,
        orgao: String(fd.orgao || "").trim() || null, vista: String(fd.vista || "").trim() || null, dica: String(fd.dica || "").trim() || null, disciplina_id: fd.disc ? +fd.disc : null }).select("*").single();
      if (error) throw error;
      S.laminas.push(data); LAMURL[caminho] = { url: URL.createObjectURL(blob), ate: Date.now() + 50 * 60 * 1000 };
      ui.lamForm = { tema: fd.tema, orgao: fd.orgao, vista: fd.vista, disc: fd.disc }; ui.lamGer = true;
      toast("Lâmina guardada");
    } catch (e) {
      if (caminho) await sb.storage.from("laminas").remove([caminho]).catch(() => { });
      toast(/limite/i.test(e.message || "") ? e.message : "Não consegui guardar: " + (e.message || e));
    }
    ui.lamBusy = false; render();
  }

  /* ================= MÉDIA (pontos: P1 + P2 + Final + processo) ================= */
  const NK = { n1: "p1", n2: "p2", n3: "final", p1p: "p1_pratica", p2p: "p2_pratica", finp: "final_pratica", pres: "presenca", tr: "trabalhos" };
  const nv = (d, k) => { const v = (S.notas[d.id] || {})[NK[k]]; return v == null ? null : +v; };
  const v0 = (x) => x ?? 0;
  function cfgPts() { const r = S.regra || {}; return { p1: r.p1 ?? 20, p2: r.p2 ?? 20, fin: r.final_sem_pratica ?? 40, finPr: r.final_teorica_com_pratica ?? 30, prP: r.p1_pratica ?? 5, prF: r.final_pratica ?? 10, pres: r.presenca ?? 2, proc: r.processo_max ?? 20, min: r.aprova ?? 60 }; }
  function proc(d) { const pr = !!d.tem_pratica; return Math.min(cfgPts().proc, v0(nv(d, "tr")) + (pr ? v0(nv(d, "p1p")) + v0(nv(d, "p2p")) + v0(nv(d, "pres")) : 0)); }
  function calcFor(d) {
    const m = cfgPts(), pr = !!d.tem_pratica, MF = pr ? m.finPr : m.fin;
    const n1 = nv(d, "n1"), n2 = nv(d, "n2"), n3 = nv(d, "n3"), finp = nv(d, "finp");
    const teo = v0(n1) + v0(n2) + v0(n3), prat = pr ? v0(finp) : 0, pc = proc(d), acum = teo + prat + pc;
    const restTeo = (n2 == null ? m.p2 : 0) + (n3 == null ? MF : 0) + (n1 == null ? m.p1 : 0);
    const restPr = pr && finp == null ? m.prF : 0;
    const restTr = Math.max(0, m.proc - pc);
    const cap = restTeo + restPr + restTr, need = m.min - acum;
    const any = n1 != null || prat > 0 || pc > 0;
    if (!any) return { need: null, acum, st: ["Sem notas", "s-none"] };
    if (n3 != null && (!pr || finp != null)) return { final: acum, need: null, acum, st: acum >= m.min ? ["Aprovado", "s-ok"] : ["Reprovado", "s-bad"] };
    const st = need <= 0 ? ["Garantido", "s-ok"] : need <= cap * .55 ? ["Tranquilo", "s-ok"] : need <= cap * .75 ? ["Atenção", "s-warn"] : need <= cap ? ["Apertado", "s-bad"] : ["Impossível", "s-bad"];
    return { need: Math.max(0, need), acum, cap, st, restTeo, restPr, restTr, MF };
  }
  function vMedia() {
    if (!ui.calcDisc || !discById(ui.calcDisc)) ui.calcDisc = S.disc[0]?.id;
    const d = discById(ui.calcDisc); if (!d) return hero("Calculadora", "de pontos", "var(--ink)") + `<div class="empty">${SEM_MATERIA}</div>`;
    const m = cfgPts(), c = calcFor(d), MF = d.tem_pratica ? m.finPr : m.fin;
    let big = "—", cap = "Preencha uma nota para calcular.", line = "", pct = 0;
    if (c.final != null) { big = fmt(c.final); cap = "Seus pontos no semestre"; line = c.final >= m.min ? `Aprovado: passou dos ${fmt(m.min)} pontos.` : `Ficou abaixo dos ${fmt(m.min)} pontos.`; pct = Math.min(100, c.final / m.min * 100); }
    else if (c.need != null) {
      big = fmt(Math.round(c.need * 10) / 10); cap = "Pontos que ainda faltam";
      const fontes = []; if (nv(d, "n2") == null) fontes.push(`P2 (até ${fmt(m.p2)})`); if (nv(d, "n3") == null) fontes.push(`Final (até ${fmt(MF)})`); if (c.restPr) fontes.push(`Final prática (até ${fmt(c.restPr)})`); if (c.restTr) fontes.push(`nota de processo (até mais ${fmt(c.restTr)})`);
      line = c.need <= 0 ? `Você já tem ${fmt(c.acum)} pontos: passou dos ${fmt(m.min)}.` : `Você tem ${fmt(c.acum)} de ${fmt(m.min)} pontos. Ainda dá para somar: ${fontes.join(", ")}.`;
      pct = Math.min(100, c.acum / m.min * 100);
    }
    const val = (x, k) => { const v = nv(x, k); return v == null ? "" : String(v); };
    const fld = (k, l, max) => `<label class="field" style="flex:1 1 90px"><span class="mono">${l}${max != null ? ` (de ${fmt(max)})` : ""}</span><input id="c-${k}" class="tnum" inputmode="decimal" data-a="grade" data-id="${d.id}" data-k="${k}" value="${esc(val(d, k))}"></label>`;
    const T = d.tem_pratica ? " teórica" : "";
    const PK = { n1: "p1p", n2: "p2p", n3: "finp" };
    const rows = S.disc.map((x) => { const r = calcFor(x), inp = (k, lab) => `<input class="tnum" inputmode="decimal" aria-label="${esc(x.nome)} ${lab}" data-a="grade" data-id="${x.id}" data-k="${k}" value="${esc(val(x, k))}">`;
      return `<tr><td><b>${esc(x.nome)}</b>${x.tem_pratica ? `<div class="muted" style="font-size:12px">teórica / prática</div>` : ""}</td>
      ${["n1", "n2", "n3"].map((k) => `<td>${inp(k, NK[k] + " teórica")}${x.tem_pratica ? `<div style="margin-top:4px">${inp(PK[k], NK[k] + " prática")}</div>` : ""}</td>`).join("")}
      <td>${inp("tr", "trabalhos")}${x.tem_pratica ? `<div style="margin-top:4px">${inp("pres", "presença")} <span class="muted" style="font-size:12px">pres.</span></div>` : ""}<div class="mono" style="margin-top:4px">${fmt(proc(x))}/${fmt(m.proc)}</div></td>
      <td class="tnum"><b>${fmt(r.acum)}</b></td>
      <td class="tnum"><b>${r.final != null ? "—" : r.need != null ? fmt(Math.round(r.need * 10) / 10) : "—"}</b></td><td><span class="chip ${r.st[1]}">${r.st[0]}</span></td></tr>`; }).join("");
    return hero("Calculadora", "de pontos", "var(--ink)") + janela("Calculadora de pontos", `<div class="win-body calc">
      <div><span class="chip tag-dark">Calculadora automática</span><h2 class="q">Quanto falta para os ${fmt(m.min)} pontos?</h2>
        <label class="field" style="margin-bottom:10px"><span class="mono">Disciplina</span><select data-a="calcDisc">${S.disc.map((x) => `<option value="${x.id}" ${x.id == d.id ? "selected" : ""}>${esc(x.nome)}</option>`).join("")}</select></label>
        <div class="row">${fld("n1", "P1" + T, m.p1)}${fld("n2", "P2" + T, m.p2)}${fld("n3", "Final" + T, MF)}</div>
        ${d.tem_pratica ? `<div class="row" style="margin-top:8px">${fld("p1p", "P1 prática", m.prP)}${fld("p2p", "P2 prática", m.prP)}${fld("finp", "Final prática", m.prF)}</div>` : ""}
        <div class="row" style="margin-top:8px">${d.tem_pratica ? fld("pres", "Presença", m.pres) : ""}${fld("tr", "Trabalhos e exames em linha (soma)")}</div>
        <p class="mono" style="margin-top:8px">Nota de processo: ${fmt(proc(d))} de ${fmt(m.proc)}</p>
        <p class="muted" style="font-size:13px;margin-top:12px">${d.tem_pratica ? `Com prática: P1 e P2 teóricas valem ${fmt(m.p1)} cada, Final teórica ${fmt(m.finPr)} e Final prática ${fmt(m.prF)}. A nota de processo (até ${fmt(m.proc)}) soma P1 e P2 práticas (até ${fmt(m.prP)} cada), presença (até ${fmt(m.pres)}) e trabalhos.` : `Sem prática: P1 e P2 valem ${fmt(m.p1)} cada, a Final ${fmt(m.fin)} e a nota de processo (trabalhos e exames em linha) até ${fmt(m.proc)}.`} Passa com ${fmt(m.min)} de 100.${S.faculdade ? ` Regra da ${esc(S.faculdade)}.` : ""}</p>
      </div>
      <div class="result"><span class="mono">Resultado · ${esc(d.nome)}</span><span style="opacity:.8">${cap}</span><div class="num tnum">${big}</div><div class="bar"><i style="width:${pct}%"></i></div><span style="font-size:13.5px;opacity:.85">${line}</span></div>
    </div>`) + janela("Visão do período", `<div class="win-body tablewrap"><table class="mtab"><thead><tr><th>Disciplina</th><th>P1</th><th>P2</th><th>Final</th><th>Processo</th><th>Total</th><th>Faltam</th><th>Situação</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }
  async function salvarNota(discId, k, valor) {
    const campo = NK[k]; if (!campo) return;
    (S.notas[discId] = S.notas[discId] || {})[campo] = valor;
    render();
    const r = valor == null ? await sb.from("notas").delete().eq("disciplina_id", discId).eq("campo", campo)
      : await sb.from("notas").upsert({ aluno_id: H.P.id, disciplina_id: +discId, campo, valor }, { onConflict: "aluno_id,disciplina_id,campo" });
    if (r.error) toast("Não consegui salvar a nota: " + r.error.message);
  }

  /* ================= AULAS ================= */
  const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const hm = (t) => { const [h, m] = String(t || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
  const hhmm = (t) => String(t || "").slice(0, 5);
  const slotName = (s) => s.disciplina_id ? dname(s.disciplina_id) : s.nome || "Aula";
  const slotProf = (s) => s.professor || (s.disciplina_id && discById(s.disciplina_id)?.professor) || "";
  const doDia = (d) => S.horarios.filter((s) => s.dia === d).sort((a, b) => hm(a.inicio) - hm(b.inicio));
  function vAulas() {
    const hz = S.horarios;
    const head = hero("Horário", "de aulas", "var(--plum)");
    const form = janela("Editar horário", `<div class="win-body"><form class="row" data-form="addAula">
        <label class="field" style="flex:0 1 130px"><span class="mono">Dia</span><select name="dia">${DIAS.map((n, i) => `<option value="${i + 1}">${n}</option>`).join("")}</select></label>
        <label class="field" style="flex:0 1 110px"><span class="mono">Início</span><input name="inicio" type="time" value="07:00" required></label>
        <label class="field" style="flex:0 1 110px"><span class="mono">Fim</span><input name="fim" type="time" value="08:00" required></label>
        <label class="field" style="flex:1 1 180px"><span class="mono">Matéria</span><select name="disc">${S.disc.map((d) => `<option value="${d.id}">${esc(d.nome)}</option>`).join("")}<option value="">Outra (escreva ao lado)</option></select></label>
        <label class="field" style="flex:1 1 140px"><span class="mono">Outra / sala (opcional)</span><input name="nome" maxlength="120" placeholder="Ex.: Inglés"></label>
        <label class="field" style="flex:1 1 140px"><span class="mono">Professor (opcional)</span><input name="prof" maxlength="120"></label>
        <button class="btn solid">Adicionar aula</button></form>
        ${hz.length ? `<div class="evlist">${[1, 2, 3, 4, 5, 6].flatMap((d) => doDia(d)).map((s) => `<div class="evitem"><span class="when tnum" style="width:120px">${DIAS[s.dia - 1].slice(0, 3)} ${hhmm(s.inicio)}–${hhmm(s.fim)}</span><span style="flex:1;min-width:0"><b>${esc(slotName(s))}</b>${slotProf(s) ? ` <span class="muted">· ${esc(slotProf(s))}</span>` : ""}</span><button class="x" data-a="delAula" data-id="${s.id}" aria-label="Remover aula">×</button></div>`).join("")}</div>` : ""}</div>`);
    if (!hz.length) return head + `<div class="empty">Nenhum horário cadastrado ainda. Adicione suas aulas abaixo.</div>` + form;
    const now = new Date(), wd = now.getDay(), mins = now.getHours() * 60 + now.getMinutes();
    const isNow = (s) => s.dia === wd && mins >= hm(s.inicio) && mins < hm(s.fim);
    const h0 = Math.floor(Math.min(...hz.map((s) => hm(s.inicio))) / 60), h1 = Math.ceil(Math.max(...hz.map((s) => hm(s.fim))) / 60);
    const ndias = hz.some((s) => s.dia === 6) ? 6 : 5, nh = Math.max(1, h1 - h0);
    let g = `<div class="th"></div>` + DIAS.slice(0, ndias).map((n, i) => `<div class="th ${i + 1 === wd ? "today" : ""}">${n}</div>`).join("");
    for (let h = 0; h < nh; h++) g += `<div class="hr tnum" style="grid-column:1;grid-row:${h + 2}">${String(h0 + h).padStart(2, "0")}:00</div>`;
    for (let d = 1; d <= ndias; d++) {
      const used = new Set();
      doDia(d).forEach((s) => { const r0 = Math.floor(hm(s.inicio) / 60) - h0, span = Math.max(1, Math.ceil(hm(s.fim) / 60) - Math.floor(hm(s.inicio) / 60));
        for (let k = 0; k < span; k++) used.add(r0 + k);
        g += `<div class="blk ${isNow(s) ? "now" : ""}" style="--c:${slotColor(s.disciplina_id)};grid-column:${d + 1};grid-row:${r0 + 2} / span ${span}"><b>${esc(slotName(s))}</b><span>${esc(slotProf(s))}</span><span class="tnum">${hhmm(s.inicio)}–${hhmm(s.fim)}</span></div>`; });
      for (let h = 0; h < nh; h++) if (!used.has(h)) g += `<div class="blk free" style="--c:var(--muted);grid-column:${d + 1};grid-row:${h + 2}"></div>`;
    }
    // hoje (se ainda tem aula) ou o próximo dia com aula
    let dshow = null, label = "";
    if (doDia(wd).some((s) => hm(s.fim) > mins)) { dshow = wd; label = `Hoje, ${DIAS[wd - 1].toLowerCase()}`; }
    else for (let k = 1; k <= 7; k++) { const d = (wd + k) % 7; if (d && doDia(d).length) { dshow = d; label = k === 1 ? `Amanhã, ${DIAS[d - 1].toLowerCase()}` : `Próxima aula: ${DIAS[d - 1].toLowerCase()}`; break; } }
    const tl = dshow ? doDia(dshow).map((s) => `<div class="tcard" style="--c:${slotColor(s.disciplina_id)}"><span class="mono tnum">${hhmm(s.inicio)}–${hhmm(s.fim)}${isNow(s) ? " · agora" : ""}</span><b>${esc(slotName(s))}</b><span class="muted" style="font-size:13px">${esc(slotProf(s))}</span></div>`).join("") : "";
    return head + janela(label || "Aulas", `<div class="win-body"><h2>${esc(label || "Aulas")}</h2><div class="todaylist">${tl || `<div class="empty">Sem aulas.</div>`}</div></div>`)
      + janela(`Grade semanal · ${semNome()}`, `<div class="win-body ttwrap"><div class="tt" style="grid-template-columns:58px repeat(${ndias},minmax(112px,1fr));grid-template-rows:auto repeat(${nh},minmax(52px,auto))">${g}</div></div>`) + form;
  }

  /* ================= CALENDÁRIO ================= */
  const PTIPO = { feriado: ["Feriado", "var(--muted)"], parcial: ["Prova parcial", "var(--wine)"], pratica: ["Semana prática", "var(--gold)"], final: ["Exames finais", "var(--navy)"], aulas: ["Aulas", "var(--green)"], outro: ["Atividade", "var(--teal)"] };
  const perOn = (ds) => S.cal.filter((p) => p.inicio <= ds && ds <= (p.fim || p.inicio));
  const perBars = (ds) => { const ps = perOn(ds).filter((p) => p.tipo !== "feriado"); return ps.length ? `<span class="pbars">${ps.slice(0, 2).map((p) => `<i style="background:${PTIPO[p.tipo]?.[1] || "var(--teal)"}"></i>`).join("")}</span>` : ""; };
  const isFer = (ds) => perOn(ds).some((p) => p.tipo === "feriado");
  function fmtRange(p) { const a = parse(p.inicio), b = parse(p.fim || p.inicio), d = (x) => `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}`; return p.fim && p.fim !== p.inicio ? `${d(a)} a ${d(b)}` : d(a); }
  const provasOn = (ds) => S.provas.filter((p) => p.data === ds);
  function vAcad() {
    const ps = S.cal.slice().sort((a, b) => a.inicio.localeCompare(b.inicio));
    const td = iso(today()), fut = ps.filter((p) => (p.fim || p.inicio) >= td), past = ps.length - fut.length;
    const shown = ui.acadAll ? ps : fut;
    const rows = shown.map((p) => { const pass = (p.fim || p.inicio) < td, now = p.inicio <= td && td <= (p.fim || p.inicio), n = daysTo(p.inicio);
      return `<div class="evitem" style="${pass ? "opacity:.5" : ""}"><span class="when tnum" style="width:96px">${fmtRange(p)}</span><i class="sw" style="flex:none;background:${p.tipo === "feriado" ? "var(--line)" : PTIPO[p.tipo]?.[1]}"></i><span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(p.nome)}</span><span class="mono">${now ? "agora" : pass ? "" : n === 1 ? "amanhã" : "em " + n + " d"}</span><button class="x" data-a="delPer" data-id="${p.id}" aria-label="Remover ${esc(p.nome)}">×</button></div>`; }).join("");
    return janela("Calendário acadêmico", `<div class="win-body"><div class="row" style="justify-content:space-between;align-items:center"><h2 style="font-size:19px">Calendário acadêmico</h2>${past ? `<button class="btn ghost" data-a="acadAll">${ui.acadAll ? "Só os próximos" : `Mostrar também os ${past} que já passaram`}</button>` : ""}</div>
      <div class="evlist">${rows || `<div class="empty">Nada pela frente. Coloque feriados, semanas de parciais, semana prática e exames finais da sua faculdade.</div>`}</div>
      <form class="row" data-form="addPer" style="margin-top:14px"><label class="field" style="flex:1 1 180px"><span class="mono">Nome</span><input name="nome" maxlength="120" required placeholder="Ex.: Semana de parciais"></label>
        <label class="field" style="flex:0 1 160px"><span class="mono">Tipo</span><select name="tipo">${Object.entries(PTIPO).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join("")}</select></label>
        <label class="field" style="flex:0 1 150px"><span class="mono">Início</span><input name="inicio" type="date" required value="${ui.calDate}"></label>
        <label class="field" style="flex:0 1 150px"><span class="mono">Fim (opcional)</span><input name="fim" type="date"></label><button class="btn solid">Adicionar</button></form></div>`);
  }
  function vCal() {
    const up = S.provas.filter((p) => p.data && daysTo(p.data) >= 0).sort((a, b) => a.data.localeCompare(b.data) || String(a.hora || "").localeCompare(String(b.hora || "")));
    const in14 = up.filter((p) => daysTo(p.data) <= 14).length;
    const m = cfgPts();
    const pts = (p) => p.pontos != null ? +p.pontos : !OFICIAL(p.tipo) ? null : p.modalidade === "pratica" ? (p.tipo === "Final" ? m.prF : m.prP) : p.tipo === "P1" ? m.p1 : p.tipo === "P2" ? m.p2 : discById(p.disciplina_id)?.tem_pratica ? m.finPr : m.fin;
    const cards = up.slice(0, 3).map((p, i) => { const n = daysTo(p.data), dt = parse(p.data), v = pts(p);
      return `<div class="ncard ${i === 0 && OFICIAL(p.tipo) ? "hot" : ""}"><span class="mono">${esc(provaTipoLbl(p))}${v != null ? ` · vale ${fmt(v)}` : ""}</span><div style="font-weight:700;margin-top:4px;overflow-wrap:anywhere">${esc(dname(p.disciplina_id))} ${esc(provaNome(p))}</div><div class="d tnum">${n === 0 ? "Hoje" : n === 1 ? "Amanhã" : n + " dias"}</div><span class="mono">${SEMD[dt.getDay()]}, ${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}${p.hora ? " · " + hhmm(p.hora) : ""}</span></div>`; }).join("");
    const greet = in14 >= 3 ? "Semana pesada vindo aí" : in14 ? "Próximas avaliações" : "Agenda tranquila por enquanto";
    let tip = "Sem avaliações marcadas. Cadastre suas datas abaixo.";
    if (up[0]) { const n = daysTo(up[0].data), h = n <= 3 ? "2h" : n <= 7 ? "1h" : "30 min"; tip = `Comece a revisão de <b>${esc(dname(up[0].disciplina_id))}</b> hoje, ${h} por dia.`; }
    const cls = (ds) => { const ps = provasOn(ds); if (!ps.length) return ""; return ps.some((p) => OFICIAL(p.tipo) && p.modalidade !== "pratica") ? "prova" : "outro"; };
    const td = iso(today());
    let calBody = "";
    if (ui.calView === "mes") {
      const first = new Date(ui.calY, ui.calM, 1), start = first.getDay(), dim = new Date(ui.calY, ui.calM + 1, 0).getDate();
      let cells = SEMD.map((s) => `<div class="wd">${s}</div>`).join("") + "<div></div>".repeat(start);
      for (let i = 1; i <= dim; i++) { const ds = iso(new Date(ui.calY, ui.calM, i)), ps = provasOn(ds);
        cells += `<button class="day ${cls(ds)} ${isFer(ds) ? "fer" : ""} ${ds === td ? "today" : ""}" data-a="pickDay" data-d="${ds}" title="${[...ps.map((p) => dname(p.disciplina_id) + " · " + provaNome(p)), ...perOn(ds).map((p) => p.nome)].map(esc).join("\n")}"><span class="tnum">${i}</span>${ps.length ? `<span class="n">${esc(ps.map((p) => dname(p.disciplina_id).split(" ")[0].slice(0, 5)).join(" "))}</span>` : isFer(ds) ? `<span class="n">feriado</span>` : ""}${perBars(ds)}</button>`; }
      calBody = `<div class="calhead"><div class="row" style="align-items:center"><button class="btn" data-a="mNav" data-v="-1" aria-label="Mês anterior">‹</button><h2 style="font-size:19px;text-transform:capitalize;min-width:150px;text-align:center">${MESES[ui.calM]} ${ui.calY}</h2><button class="btn" data-a="mNav" data-v="1" aria-label="Próximo mês">›</button></div>
        <div class="seg" style="margin:0"><button data-a="calView" data-v="mes" aria-pressed="true">Mês</button><button data-a="calView" data-v="ano" aria-pressed="false">Ano</button></div></div><div class="cal">${cells}</div>`;
    } else {
      const months = MESES.map((mn, mi) => { const first = new Date(ui.calY, mi, 1), dim = new Date(ui.calY, mi + 1, 0).getDate(); let c = SEMD.map((s) => `<span class="muted">${s[0]}</span>`).join("") + "<span></span>".repeat(first.getDay());
        for (let i = 1; i <= dim; i++) { const ds = iso(new Date(ui.calY, mi, i)); const pp = perOn(ds).find((p) => p.tipo !== "feriado"); c += `<span class="tnum ${cls(ds)} ${isFer(ds) ? "fer" : ""} ${ds === td ? "today" : ""}" style="${!cls(ds) && pp ? `box-shadow:inset 0 -2px 0 ${PTIPO[pp.tipo]?.[1]}` : ""}">${i}</span>`; }
        return `<button class="mini" data-a="openMonth" data-m="${mi}" style="border:0;background:none;text-align:left;padding:0;min-width:0"><h3>${mn}</h3><div class="cal">${c}</div></button>`; }).join("");
      calBody = `<div class="calhead"><div class="row" style="align-items:center"><button class="btn" data-a="yNav" data-v="-1" aria-label="Ano anterior">‹</button><h2 style="font-size:19px;min-width:80px;text-align:center" class="tnum">${ui.calY}</h2><button class="btn" data-a="yNav" data-v="1" aria-label="Próximo ano">›</button></div>
        <div class="seg" style="margin:0"><button data-a="calView" data-v="mes" aria-pressed="false">Mês</button><button data-a="calView" data-v="ano" aria-pressed="true">Ano</button></div></div><div class="year">${months}</div>`;
    }
    const list = S.provas.filter((p) => p.data).sort((a, b) => a.data.localeCompare(b.data)).map((p) => { const dt = parse(p.data), past = daysTo(p.data) < 0, v = pts(p);
      return `<div class="evitem" style="${past ? "opacity:.55" : ""}"><span class="when tnum">${String(dt.getDate()).padStart(2, "0")} ${MES3[dt.getMonth()]} ${String(dt.getFullYear()).slice(2)}</span><span style="flex:1;min-width:0;overflow-wrap:anywhere"><b>${esc(dname(p.disciplina_id))}</b> · ${esc(provaNome(p))} <span class="muted">(${esc(provaTipoLbl(p))}${p.hora ? ", " + hhmm(p.hora) : ""}${v != null ? `, vale ${fmt(v)}` : ""})</span></span><button class="x" data-a="delProva" data-id="${p.id}" aria-label="Remover avaliação">×</button></div>`; }).join("");
    return hero("Calendário", "de provas", "var(--wine)") + janela("Próximas avaliações", `<div class="win-body"><div class="row" style="justify-content:space-between;align-items:center"><h2>Olá! ${greet}</h2><span class="chip" style="background:var(--wine-s);color:var(--wine)">${in14} avaliaç${in14 === 1 ? "ão" : "ões"} em 14 dias</span></div>${cards ? `<div class="next">${cards}</div>` : `<div class="empty" style="margin-top:14px">Nenhuma avaliação futura.</div>`}</div>`)
      + janela(ui.calView === "mes" ? `${MESES[ui.calM]} ${ui.calY}` : `Calendário ${ui.calY}`, `<div class="win-body calwrap"><div style="min-width:0">${calBody}</div>
        <div class="legend"><span class="mono">Legenda</span><span><i class="sw" style="background:var(--wine)"></i>Prova</span><span><i class="sw" style="background:var(--wine-s)"></i>Prática, seminário, entrega</span><span><i class="sw" style="border:1.5px solid var(--ink)"></i>Hoje</span><span><i class="sw" style="height:4px;background:var(--wine)"></i>Período de parciais</span><span><i class="sw" style="height:4px;background:var(--gold)"></i>Semana prática</span><span><i class="sw" style="height:4px;background:var(--navy)"></i>Exames finais</span><span><i class="sw fersw"></i>Feriado</span><div class="tip">${tip}</div></div></div>`)
      + janela("Importar documento", `<div class="win-body">${vImportCal()}</div>`)
      + vAcad()
      + janela("Cadastrar avaliação", `<div class="win-body">${S.disc.length ? `<form class="row" data-form="addProva">
        <label class="field" style="flex:1 1 180px"><span class="mono">Disciplina</span><select name="disc">${S.disc.map((d) => `<option value="${d.id}">${esc(d.nome)}</option>`).join("")}</select></label>
        <label class="field" style="flex:0 1 130px"><span class="mono">Tipo</span><select name="tipo">${["P1", "P2", "Final", "Seminário", "Entrega", "Outra"].map((t) => `<option>${t}</option>`).join("")}</select></label>
        <label class="field" style="flex:0 1 130px"><span class="mono">Teórica/prática</span><select name="mod"><option value="teorica">Teórica</option><option value="pratica">Prática</option></select></label>
        <label class="field" style="flex:1 1 120px"><span class="mono">Nome (opcional)</span><input name="titulo" maxlength="80" placeholder="Ex.: Seminário de sepse"></label>
        <label class="field" style="flex:0 1 150px"><span class="mono">Data</span><input name="data" type="date" id="provaData" value="${ui.calDate}" required></label>
        <label class="field" style="flex:0 1 100px"><span class="mono">Hora</span><input name="hora" type="time" value="07:00"></label>
        <label class="field" style="flex:0 1 90px"><span class="mono">Vale (pts)</span><input name="pontos" inputmode="decimal" placeholder="auto"></label>
        <button class="btn solid">Adicionar</button></form>` : `<div class="empty">Adicione uma matéria primeiro. ${SEM_MATERIA}</div>`}<div class="evlist">${list}</div></div>`);
  }

  /* ================= VIDA ACADÊMICA ================= */
  const EVST = { pend: ["Pendente", "ev-pend"], ins: ["Inscrito", "ev-ins"], conf: ["Confirmado", "ev-conf"], done: ["Concluído", "ev-done"] };
  const CATS = ["Eventos e congressos", "Ligas acadêmicas", "Pesquisa e extensão", "Monitoria", "Outros"];
  const editBtn = (tipo, id) => `<button class="btn ghost" style="padding:3px 8px;font-size:12.5px" data-a="vEdit" data-t="${tipo}" data-id="${id}">Editar</button>`;
  const formBtns = (ed) => ed ? `<button class="btn solid">Salvar</button><button type="button" class="btn ghost" data-a="vCancel">Cancelar</button>` : "";
  function vVida() {
    let main = ""; const ed = ui.vEdit || {};
    if (ui.vMode === "ev") {
      const e0 = ed.t === "ev" ? S.eventos.find((x) => x.id == ed.id) : null;
      const ev = S.eventos.slice().sort((a, b) => a.data.localeCompare(b.data));
      main = `<h2>Próximos eventos</h2>${ev.length ? ev.map((e) => { const dt = parse(e.data), past = daysTo(e.data) < 0; return `<div class="event" style="${past ? "opacity:.6" : ""}"><div class="dateblk"><b class="tnum">${String(dt.getDate()).padStart(2, "0")}</b><span>${MES3[dt.getMonth()]}</span></div><div class="t"><b>${esc(e.nome)}</b><span class="muted" style="font-size:13px">${esc(e.detalhe || "")}</span></div><button class="chip stbtn ${EVST[e.status][1]}" data-a="evSt" data-id="${e.id}" title="Clique para mudar o status">${EVST[e.status][0]}</button>${editBtn("ev", e.id)}<button class="x" data-a="delEv" data-id="${e.id}" aria-label="Remover evento">×</button></div>`; }).join("") : `<div class="empty" style="margin-top:12px">Nenhum evento cadastrado.</div>`}
        <form class="row" data-form="addEv" style="margin-top:16px"><label class="field" style="flex:1 1 200px"><span class="mono">Evento</span><input name="nome" maxlength="160" required placeholder="Ex.: Jornada de Clínica Médica" value="${esc(e0?.nome || "")}"></label><label class="field" style="flex:1 1 160px"><span class="mono">Detalhe</span><input name="sub" maxlength="200" placeholder="Local, horário…" value="${esc(e0?.detalhe || "")}"></label><label class="field" style="flex:0 1 160px"><span class="mono">Data</span><input name="data" type="date" required value="${esc(e0?.data || iso(today()))}"></label>${e0 ? formBtns(true) : `<button class="btn solid">Adicionar</button>`}</form>
        <p class="muted" style="font-size:13px;margin-top:10px">Toque no status para alternar entre pendente, inscrito, confirmado e concluído.</p>`;
    } else if (ui.vMode === "ligas") {
      const l0 = ed.t === "liga" ? S.ligas.find((x) => x.id == ed.id) : null;
      main = `<h2>Ligas acadêmicas</h2>${S.ligas.length ? S.ligas.map((l) => `<div class="event"><div class="dateblk"><b style="font-size:13px">${esc(l.nome.slice(0, 5))}</b></div><div class="t"><b>${esc(l.nome)}</b><span class="muted" style="font-size:13px">${esc(l.papel || "")}</span></div>${editBtn("liga", l.id)}<button class="x" data-a="delLiga" data-id="${l.id}" aria-label="Remover liga">×</button></div>`).join("") : `<div class="empty" style="margin-top:12px">Nenhuma liga cadastrada.</div>`}
        <form class="row" data-form="addLiga" style="margin-top:16px"><label class="field" style="flex:1 1 160px"><span class="mono">Sigla ou nome</span><input name="nome" maxlength="120" required value="${esc(l0?.nome || "")}"></label><label class="field" style="flex:1 1 200px"><span class="mono">Seu papel</span><input name="papel" maxlength="160" placeholder="Membro, diretoria…" value="${esc(l0?.papel || "")}"></label>${l0 ? formBtns(true) : `<button class="btn solid">Adicionar</button>`}</form>`;
    } else {
      const h0 = ed.t === "hora" ? S.horas.find((x) => x.id == ed.id) : null;
      const tot = S.horas.reduce((s, h) => s + (+h.horas || 0), 0), meta = +(S.pref.horas_meta ?? 200) || 1;
      const byCat = CATS.map((c) => [c, S.horas.filter((h) => h.categoria === c).reduce((s, h) => s + (+h.horas || 0), 0)]).filter((x) => x[1] > 0);
      const maxc = Math.max(1, ...byCat.map((x) => x[1])), cert = S.horas.filter((h) => h.certificado).length, falta = S.horas.length - cert;
      main = `<div class="hours"><div><span class="mono">Total acumulado</span><div class="big tnum">${fmt(tot)}h</div><span class="muted">de ${fmt(meta)}h exigidas</span><div class="bar" style="margin-top:10px;height:7px"><i style="width:${Math.min(100, tot / meta * 100)}%;background:var(--navy)"></i></div></div>
        <div>${byCat.length ? byCat.map(([c, h]) => `<div class="hrow"><span>${esc(c)}</span><b class="tnum">${fmt(h)}h</b><div class="bar"><i style="width:${h / maxc * 100}%;background:var(--navy)"></i></div></div>`).join("") : `<div class="empty">Nenhuma hora registrada.</div>`}<span class="mono">${cert} certificado${cert === 1 ? "" : "s"} salvo${cert === 1 ? "" : "s"} · ${falta} aguardando</span></div></div>
        <div class="evlist" style="margin-top:18px">${S.horas.map((h) => `<div class="evitem"><span class="when tnum">${fmt(+h.horas)}h</span><span style="flex:1;min-width:0;overflow-wrap:anywhere"><b>${esc(h.descricao)}</b> <span class="muted">· ${esc(h.categoria)}</span></span><label class="check" style="font-size:12.5px"><input type="checkbox" data-a="cert" data-id="${h.id}" ${h.certificado ? "checked" : ""}>certificado</label>${editBtn("hora", h.id)}<button class="x" data-a="delHora" data-id="${h.id}" aria-label="Remover registro">×</button></div>`).join("")}</div>
        <form class="row" data-form="addHora" style="margin-top:14px"><label class="field" style="flex:1 1 200px"><span class="mono">Atividade</span><input name="desc" maxlength="200" required placeholder="Ex.: Congresso de Trauma" value="${esc(h0?.descricao || "")}"></label><label class="field" style="flex:1 1 170px"><span class="mono">Categoria</span><select name="cat">${CATS.map((c) => `<option ${h0?.categoria === c ? "selected" : ""}>${c}</option>`).join("")}</select></label><label class="field" style="flex:0 1 90px"><span class="mono">Horas</span><input name="h" type="number" min="0" max="2000" step="0.5" required value="${h0 ? esc(+h0.horas) : ""}"></label>${h0 ? formBtns(true) : `<button class="btn solid">Registrar</button>`}</form>`;
    }
    const nav = [["ev", "Eventos"], ["ligas", "Ligas"], ["horas", "Horas e certificados"]].map(([k, l]) => `<button data-a="vMode" data-m="${k}" aria-current="${ui.vMode === k}">${l}</button>`).join("");
    return hero("Hub de eventos", "e horas complementares", "var(--navy)") + `<section class="win"><div class="vwin"><aside class="vside"><b>Vida acadêmica</b>${nav}</aside><div class="vmain">${main}</div></div></section>`;
  }

  /* ================= AGENDA DE ESTUDOS ================= */
  const HORA_PROVA = 7;
  const cfgAg = () => ({ dia: +(S.pref.horas_dia ?? 4), fds: +(S.pref.horas_fds ?? 6), dormir: +(S.pref.dormir ?? 23) });
  const feitos = () => S.pref.agenda_feitos || {};
  function temaCaiNa(t, p) {
    if (!t.prova) return true;
    const lab = semAcento(t.prova);
    const tp = /\bp1\b/.test(lab) ? "P1" : /\bp2\b/.test(lab) ? "P2" : /final/.test(lab) ? "Final" : null;
    const mo = /prat/.test(lab) ? "pratica" : /teor/.test(lab) ? "teorica" : null;
    return (!tp || tp === p.tipo) && (!mo || mo === (p.modalidade || "teorica"));
  }
  const provaTopics = (p) => temasDe(p.disciplina_id).filter((t) => temaCaiNa(t, p));
  const topicDone = (t) => !!(t.aula && t.resumo_ok);
  function estH(t) { const n = (Array.isArray(t.itens) ? t.itens.length : 0), m = matsDe(t.id).length; const h = Math.max(0.75, Math.min(2.5, 0.5 + 0.12 * n + (m > 1 ? 0.25 * (m - 1) : 0) + (m ? 0.25 : 0))); return Math.round(h * 4) / 4; }
  function remH(t) { let f = 1; if (t.aula) f -= 0.45; if (t.resumo_ok) f -= 0.4; if (t.questoes_ok) f -= 0.15; return Math.max(0, estH(t) * f); }
  function examDT(p) { const d = parse(p.data); const [hh, mm] = String(p.hora || "").split(":"); d.setHours(hh ? +hh : HORA_PROVA, mm ? +mm : 0, 0, 0); return d; }
  function capDay(date) { const c = cfgAg(), wd = date.getDay(), base = (wd === 0 || wd === 6) ? c.fds : c.dia;
    if (date.getTime() === today().getTime()) { const n = new Date(); return Math.max(0, Math.min(base, c.dormir - (n.getHours() + n.getMinutes() / 60))); } return base; }
  function upcomingExams() { const n = new Date(); return S.provas.filter((p) => p.data && OFICIAL(p.tipo) && examDT(p) > n && provaTopics(p).length).sort((a, b) => examDT(a) - examDT(b)); }
  function fmtH(h) { h = Math.round(h * 4) / 4; const Hh = Math.floor(h), M = Math.round((h - Hh) * 60); return Hh && M ? `${Hh}h${String(M).padStart(2, "0")}` : Hh ? `${Hh}h` : `${M}min`; }
  function fmtDM(d) { return `${SEMD[d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; }
  function fmtLeft(ms) { if (ms <= 0) return "agora"; const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24); return d > 0 ? `${d}d ${h % 24}h` : h > 0 ? `${h}h ${m % 60}min` : `${m}min`; }
  function buildPlan() {
    const exams = upcomingExams(); if (!exams.length) return { days: [], info: {}, exams: [] };
    const t0 = today(), last = parse(exams[exams.length - 1].data), nd = Math.min(400, Math.round((last - t0) / DAY) + 1);
    const days = []; for (let i = 0; i < nd; i++) { const dt = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate() + i); days.push({ date: dt, ds: iso(dt), cap: capDay(dt), used: 0, tasks: [] }); }
    const di = (ds) => Math.round((parse(ds) - t0) / DAY);
    const owner = {}; exams.forEach((p) => provaTopics(p).forEach((t) => { if (!owner[t.id]) owner[t.id] = p.id; }));
    const mine = (p) => provaTopics(p).filter((t) => owner[t.id] === p.id);
    const info = {}, done = feitos(), revQ = [];
    const finH = (p) => Math.min(2, Math.max(0.5, 0.25 * provaTopics(p).length));
    exams.forEach((p) => { info[p.id] = { need: mine(p).reduce((s, t) => s + remH(t), 0), late: 0, startBy: null };
      const i = di(p.data) - 1;
      if (i >= 0 && i < days.length) { const dd = days[i], h = finH(p), k = "final:" + p.id; if (!done[k]) dd.used += h; dd.tasks.push({ k, type: "final", prova: p, h, discId: p.disciplina_id, done: !!done[k] }); } });
    exams.forEach((p) => { const lim = Math.min(di(p.data), days.length);
      mine(p).forEach((t) => { let h = remH(t); if (h <= 0.01) return; let part = 1;
        for (let i = 0; i < lim && h > 0.01; i++) { const dd = days[i], free = dd.cap - dd.used; if (free < 0.25) continue; const use = Math.min(free, h); dd.used += use; h -= use;
          dd.tasks.push({ k: "st:" + t.id, type: "study", t, h: use, part: part++, prova: p, discId: p.disciplina_id });
          if (h <= 0.01) revQ.push({ j: i + 2, lim, t, p }); }
        if (h > 0.01) info[p.id].late += h; }); });
    revQ.forEach(({ j, lim, t, p }) => { if (j < lim && j < days.length && days[j].cap - days[j].used >= 0.25) { const k = "rv:" + t.id; days[j].tasks.push({ k, type: "review", t, h: 0.25, prova: p, discId: p.disciplina_id, done: !!done[k] }); if (!done[k]) days[j].used += 0.25; } });
    const resid = days.map((d) => d.cap);
    exams.forEach((p) => { const i = di(p.data) - 1; if (i >= 0 && i < days.length && !done["final:" + p.id]) resid[i] -= finH(p); });
    [...exams].reverse().forEach((p) => { let need = info[p.id].need; let i = Math.min(di(p.data), days.length) - 1, start = null;
      while (need > 0.01 && i >= 0) { const use = Math.min(Math.max(0, resid[i]), need); if (use > 0) { resid[i] -= use; need -= use; start = i; } i--; }
      info[p.id].startBy = need > 0.01 ? -1 : start; });
    const ord = { study: 0, review: 1, final: 2 };
    days.forEach((d) => d.tasks.sort((a, b) => ord[a.type] - ord[b.type]));
    return { days, info, exams };
  }
  function missingExams() { const n = new Date(); return S.disc.filter((d) => temasDe(d.id).length && !S.provas.some((p) => p.disciplina_id === d.id && p.data && OFICIAL(p.tipo) && examDT(p) > n)); }
  function taskLabel(k) {
    if (k.type === "final") return `Revisão final: ${dname(k.discId)} · ${provaNome(k.prova)}`;
    if (k.type === "review") return `Revisão rápida: ${k.t.nome}`;
    return `${k.t.resumo_ok ? "Questões" : "Estudar"}: ${k.t.nome}${k.part > 1 ? " (continuação)" : ""}`;
  }
  function taskRow(k) {
    const col = slotColor(k.discId), checked = k.type === "study" ? topicDone(k.t) : k.done, tid = k.t ? k.t.id : "";
    return `<div class="agtask ${checked ? "done" : ""}" style="--c:${col}"><input type="checkbox" aria-label="Concluído" data-a="agTick" data-k="${esc(k.k)}" data-t="${tid}" ${checked ? "checked" : ""}>
      <div class="agt-main"><b>${esc(taskLabel(k))}</b><span class="muted">${esc(dname(k.discId))} · ${fmtH(k.h)}</span></div>
      ${k.type === "final" ? `<button class="btn" data-a="agProva" data-id="${k.prova.id}">Temas</button>` : `<button class="btn solid" data-a="openRes" data-id="${tid}">Resumo</button>`}</div>`;
  }
  function vAgenda() {
    const plan = buildPlan(), now = new Date(), c = cfgAg();
    const cards = plan.exams.map((p) => { const tops = provaTopics(p), dn = tops.filter(topicDone).length, inf = plan.info[p.id], need = tops.reduce((s, t) => s + remH(t), 0), dt = examDT(p);
      let st;
      if (need <= 0.05) st = ["Tudo estudado: só revisar", "s-ok"];
      else if (inf.startBy === -1 || inf.late > 0.05) st = ["Atrasado: comece agora", "s-bad"];
      else if (inf.startBy === 0) st = ["Comece hoje", "s-warn"];
      else { const sd = new Date(today().getFullYear(), today().getMonth(), today().getDate() + inf.startBy); st = [`Pode começar até ${fmtDM(sd)}`, "s-ok"]; }
      const open = ui.agOpen == p.id;
      return `<div class="agcard" style="--c:${slotColor(p.disciplina_id)}">
        <div class="row" style="justify-content:space-between;align-items:flex-start"><div style="min-width:0"><span class="mono">${esc(provaNome(p))} · ${fmtDM(dt)} · ${String(dt.getHours()).padStart(2, "0")}h</span><h3 style="font-size:17px;margin-top:2px;overflow-wrap:anywhere">${esc(dname(p.disciplina_id))}</h3></div><span class="chip ${st[1]}">${st[0]}</span></div>
        <div class="agleft tnum">${fmtLeft(dt - now)}</div>
        <div class="bar"><i style="width:${tops.length ? dn / tops.length * 100 : 0}%;background:var(--c)"></i></div>
        <div class="row" style="justify-content:space-between;align-items:center"><span class="mono tnum">${dn}/${tops.length} temas estudados · faltam ~${fmtH(need)}</span><button class="btn ghost" data-a="agProva" data-id="${p.id}">${open ? "Fechar" : "Ver temas"}</button></div>
        ${open ? `<div class="agtopics">${tops.map((t) => `<div class="agtopic ${topicDone(t) ? "done" : ""}"><span style="min-width:0"><b>${esc(t.nome)}</b><span class="muted" style="font-size:12px"> · ~${fmtH(estH(t))}</span></span><button class="btn solid" data-a="openRes" data-id="${t.id}">${S.resIds.has(t.id) ? "Ler resumo" : "Estudar"}</button></div>`).join("")}</div>` : ""}
      </div>`; }).join("");
    const miss = missingExams();
    const missHtml = miss.length ? janela("Provas sem data", `<div class="win-body"><p class="muted" style="margin:0 0 10px">Sem data, a agenda não consegue planejar estas matérias. Coloque a data da próxima prova quando sair.</p><div class="evlist">${miss.map((d, i) => `<form class="evitem agmiss" data-form="agDate"><input type="hidden" name="disc" value="${d.id}"><span style="flex:1 1 140px;min-width:0"><b>${esc(d.nome)}</b> <span class="muted">· ${temasDe(d.id).length} temas</span></span>
      <select name="tipo" class="inp" style="width:auto" aria-label="Prova"><option>P1</option><option selected>P2</option><option>Final</option></select>${d.tem_pratica ? `<select name="mod" class="inp" style="width:auto" aria-label="Teórica ou prática"><option value="teorica">teórica</option><option value="pratica">prática</option></select>` : ""}
      <input type="date" name="data" id="agd${i}" required class="inp" style="width:auto" aria-label="Data"><input type="time" name="hora" value="07:00" class="inp" style="width:auto" aria-label="Hora"><button class="btn solid">Salvar</button></form>`).join("")}</div></div>`) : "";
    const dayHtml = plan.days.filter((d, i) => i < 14 && (d.tasks.length || i === 0)).map((d) => { const tot = d.tasks.filter((k) => !(k.type === "study" ? topicDone(k.t) : k.done)).reduce((s, k) => s + k.h, 0); const isT = d.ds === iso(today()); const ex = S.provas.filter((p) => p.data === d.ds && OFICIAL(p.tipo) && provaTopics(p).length);
      return `<div class="agday ${isT ? "today" : ""}"><div class="agday-h"><b>${isT ? "Hoje" : fmtDM(d.date)}</b><span class="mono tnum">${tot > 0 ? `${fmtH(tot)} de ${fmtH(d.cap)} livres` : d.tasks.length ? "Tudo feito" : "Livre"}</span></div>
        ${ex.map((p) => `<div class="agexam" style="--c:${slotColor(p.disciplina_id)}">Prova: ${esc(dname(p.disciplina_id))} · ${esc(provaNome(p))} às ${String(examDT(p).getHours()).padStart(2, "0")}h</div>`).join("")}
        ${d.tasks.map(taskRow).join("") || `<p class="muted" style="margin:6px 0 0;font-size:13.5px">${isT ? "Nada planejado para hoje." : ""}</p>`}</div>`; }).join("");
    return hero("Agenda", "de estudos", "var(--teal)")
      + janela("Próximas provas", `<div class="win-body">${cards ? `<div class="aggrid">${cards}</div>` : `<div class="empty">Nenhuma prova com data e temas cadastrados. Coloque as datas no Calendário e os temas em Disciplinas.</div>`}</div>`)
      + missHtml
      + janela("Plano de estudo", `<div class="win-body"><p class="muted" style="margin:0 0 12px;font-size:13.5px">A agenda distribui os temas que faltam entre hoje e cada prova, começando pela mais próxima, com revisão rápida 2 dias depois de cada tema e revisão final na véspera. Ela se refaz sozinha quando você marca um tema como estudado.</p>${dayHtml || `<div class="empty">Sem tarefas planejadas.</div>`}</div>`)
      + janela("Ajustes da agenda", `<div class="win-body"><div class="row">
        <label class="field" style="flex:0 1 150px"><span class="mono">Horas por dia (seg–sex)</span><input id="agDia" type="number" min="0" max="16" step="0.5" value="${c.dia}"></label>
        <label class="field" style="flex:0 1 150px"><span class="mono">Horas (sáb e dom)</span><input id="agFds" type="number" min="0" max="16" step="0.5" value="${c.fds}"></label>
        <label class="field" style="flex:0 1 150px"><span class="mono">Hora de dormir</span><input id="agDormir" type="number" min="18" max="27" step="0.5" value="${c.dormir}"></label>
        <button class="btn solid" data-a="saveAg">Salvar</button></div>
        <details style="margin-top:16px"><summary class="muted" style="cursor:pointer">Modelo dos resumos</summary>
        <p class="muted" style="font-size:13px;margin:8px 0">Esta é a estrutura que a IA segue em todo resumo (formato resumo ativo: tópicos diretos, sem texto corrido). Cole aqui o seu modelo, se tiver um.</p>
        <textarea id="agModelo" class="inp" rows="12" maxlength="4000" style="width:100%;font-family:var(--f-mono);font-size:12.5px">${esc(S.pref.modelo_resumo || MODELO_PADRAO)}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn solid" data-a="saveModelo">Salvar modelo</button><button class="btn ghost" data-a="resetModelo">Voltar ao padrão</button></div></details></div>`);
  }

  /* ================= MATERIAL DO PROFESSOR: lido no navegador quando falta ================= */
  const limparTexto = (t) => String(t || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 300000);
  function desfazXml(s) { return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&"); }
  function textoDoXml(xml, tag, par) {
    const linhas = [], pre = tag.split(":")[0];
    const reT = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>|<${pre}:tab\\s*/>|<${pre}:br\\s*/>`, "g");
    for (const p of xml.split(new RegExp(`</${par}>`))) { let l = ""; for (const m of p.matchAll(reT)) l += m[1] !== undefined ? desfazXml(m[1]) : m[0].includes("tab") ? "\t" : "\n"; if (l.trim()) linhas.push(l.trimEnd()); }
    return linhas.join("\n");
  }
  const tipoMat = (m) => /pdf/.test(m.mime || "") || /\.pdf$/i.test(m.nome) ? "pdf" : /presentationml/.test(m.mime || "") ? "pptx" : /wordprocessingml/.test(m.mime || "") ? "docx" : /google-apps\.(document|presentation)|^text\//.test(m.mime || "") ? "txt" : null;
  async function baixarMaterial(id) {
    const { data, error } = await sb.functions.invoke("drive-arquivo", { body: { material_id: id } });
    if (error) { let j = null; try { j = await error.context.json(); } catch (_) { } const e = new Error(j?.erro || "O servidor não entregou o arquivo."); e.status = j?.status; throw e; }
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === "string") return new TextEncoder().encode(data);
    if (data?.erro) throw new Error(data.erro);
    throw new Error("Resposta inesperada do servidor.");
  }
  /** Texto de um PDF, PowerPoint (.pptx), Word (.docx) ou texto: usado no material do Drive e nos arquivos enviados. */
  async function lerArquivo(tipo, bytes, prog = () => { }) {
    if (tipo === "txt") return { texto: new TextDecoder().decode(bytes), paginas: null };
    if (tipo === "pdf") {
      const lib = await H.carregarPdfjs();
      let doc;
      try { doc = await lib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: true }).promise; }
      catch (e) { throw new Error(/password/i.test(e?.name + e?.message) ? "Esse PDF tem senha. Tire a senha e tente de novo." : "Não consegui abrir esse PDF."); }
      const partes = [], n = doc.numPages;
      try { for (let i = 1; i <= n; i++) { const pg = await doc.getPage(i); const tc = await pg.getTextContent(); partes.push(tc.items.map((it) => (it.str || "") + (it.hasEOL ? "\n" : " ")).join("")); pg.cleanup(); if (i % 3 === 0 || i === n) prog(i / n, `Lendo a página ${i} de ${n}…`); } }
      finally { try { doc.destroy(); } catch (_) { } }
      return { texto: partes.join("\n\n"), paginas: n };
    }
    const JSZip = await H.carregarJSZip(); let zip;
    try { zip = await JSZip.loadAsync(bytes); } catch (_) { throw new Error("Não consegui abrir esse arquivo (está corrompido ou não é .pptx/.docx)."); }
    if (tipo === "pptx") {
      const slides = Object.keys(zip.files).map((n) => ({ n, m: n.match(/^ppt\/slides\/slide(\d+)\.xml$/) })).filter((x) => x.m).sort((a, b) => +a.m[1] - +b.m[1]);
      const out = []; for (let i = 0; i < slides.length; i++) { const s = slides[i]; const t = textoDoXml(await zip.file(s.n).async("string"), "a:t", "a:p"); if (t.trim()) out.push(`Slide ${s.m[1]}\n${t}`); prog((i + 1) / slides.length, `Lendo o slide ${i + 1} de ${slides.length}…`); }
      return { texto: out.join("\n\n"), paginas: slides.length };
    }
    const doc = zip.file("word/document.xml"); prog(1, "Texto lido.");
    return { texto: doc ? textoDoXml(await doc.async("string"), "w:t", "w:p") : "", paginas: null };
  }
  const lerBytes = async (tipo, bytes) => (await lerArquivo(tipo, bytes)).texto;
  /** Lê no navegador os arquivos do tema que o servidor não leu (PDF, Word, PowerPoint). Devolve avisos. */
  async function prepararMaterial(temaId, prog) {
    const lista = matsDe(temaId).filter((m) => m.status === "pendente" && tipoMat(m));
    const avisos = [];
    for (let i = 0; i < lista.length; i++) {
      const m = lista[i];
      prog(`Lendo o material do professor (${i + 1} de ${lista.length}): ${m.nome}…`);
      try {
        const bytes = await baixarMaterial(m.id);
        const texto = limparTexto(await lerBytes(tipoMat(m), bytes));
        const { data, error } = await sb.rpc("salvar_texto_material", { p_id: m.id, p_texto: texto });
        if (error) throw error;
        m.status = data || "ok";
        if (m.status === "sem_texto") avisos.push(`"${m.nome}" não tem texto (parece escaneado).`);
      } catch (e) {
        if (e.status === "grande_demais") { await sb.rpc("salvar_texto_material", { p_id: m.id, p_texto: null, p_status: "grande_demais" }); m.status = "grande_demais"; }
        avisos.push(`Não consegui ler "${m.nome}": ${e.message || e}`);
      }
    }
    return avisos;
  }

  /* ================= FICHA DO TEMA: RESUMO E MAPA MENTAL ================= */
  function consultasLivro(tema) {
    const nome = String(tema || "").replace(/["']/g, " ").replace(/\s+/g, " ").trim().slice(0, 200); if (!nome) return [];
    const vazias = new Set(["para", "como", "sobre", "entre", "aula", "tema", "parte", "resumo", "slides", "doenca", "doencas", "sistema", "geral"]);
    const pal = nome.split(" ").filter((w) => w.length > 3 && !/^\d+$/.test(w) && !vazias.has(semAcento(w))).slice(0, 4);
    return pal.length > 1 ? [nome, pal.join(" or ")] : [nome];
  }
  async function buscarLivros(tema) {
    for (const consulta of consultasLivro(tema)) {
      const { data, error } = await sb.rpc("buscar_nos_livros", { consulta, limite: 6 });
      if (error) return [];
      if ((data || []).length) return data;
    }
    return [];
  }
  const ondeLivro = (x) => x.pagina_ini == null ? "" : (x.formato === "pdf" || !x.formato ? "p. " : "seção ") + (x.pagina_fim && x.pagina_fim !== x.pagina_ini ? `${x.pagina_ini} a ${x.pagina_fim}` : x.pagina_ini);
  function agruparLivros(achados) { const m = new Map(); achados.forEach((x) => { const l = m.get(x.titulo) || []; const o = ondeLivro(x); if (o && !l.includes(o)) l.push(o); m.set(x.titulo, l); }); return [...m.entries()].map(([titulo, paginas]) => ({ titulo, paginas })); }
  async function loadRes(id) {
    if (RES[id] || RESLOAD[id]) return; RESLOAD[id] = true;
    const { data } = await sb.from("resumos").select("*").eq("tema_id", id).maybeSingle();
    if (data) RES[id] = data;
    RESLOAD[id] = "ok"; renderSheet();
  }
  async function loadMapa(id) {
    if (MAPA[id] || MAPLOAD[id]) return; MAPLOAD[id] = true;
    const { data } = await sb.from("mapas").select("*").eq("tema_id", id).maybeSingle();
    if (data?.dados) MAPA[id] = { ...data.dados, base: data.base };
    MAPLOAD[id] = "ok"; renderSheet();
  }
  async function pedirResumo(id) {
    const t = temaById(id); if (!t || ui.resBusy || emAndamento("resumo", id)) return;
    ui.resErr = ""; ui.resAvisos = []; ui.escolha = null; ui.resBusy = id; ui.resEtapa = "Procurando o tema nos seus livros…"; renderSheet();
    let achados = [];
    try { achados = await buscarLivros(t.nome); } catch (_) { }
    if (achados.length) { ui.resBusy = false; ui.escolha = { id, livros: agruparLivros(achados) }; return renderSheet(); }
    gerarResumo(id, "professor");
  }
  // Resumo e mapa rodam no servidor (tarefas). Se o tema tem PDF/Word/PowerPoint do Drive ainda não lido,
  // a leitura entra antes na fila do navegador e a tarefa da IA é criada quando ela termina.
  const faltaLer = (temaId) => matsDe(temaId).some((m) => m.status === "pendente" && tipoMat(m));
  const naFila = (acao, temaId) => Fila.pendentes().find((j) => j.tipo === "material" && j.dados.depois?.acao === acao && j.dados.depois?.tema_id == temaId);
  const emAndamento = (acao, temaId) => !!(Tarefas.rodandoPara(acao, temaId) || naFila(acao, temaId));
  async function pedirIA(corpo, temaId, titulo) {
    if (temaId && faltaLer(temaId)) { await Fila.adicionar("material", titulo, { tema_id: temaId, depois: corpo }); return; }
    await Tarefas.criar(corpo);
  }
  async function gerarResumo(id, modo) {
    const t = temaById(id); if (!t) return;
    ui.escolha = null; ui.resErr = ""; ui.resAvisos = []; ui.resBusy = id; ui.resEtapa = "Mandando para a IA…"; renderSheet();
    try { await pedirIA({ acao: "resumo", tema_id: id, modo }, id, `Ler o material e resumir: ${t.nome}`); }
    catch (e) { ui.resErr = e.message || "Não consegui pedir o resumo agora. Tente de novo em instantes."; }
    finally { ui.resBusy = false; renderSheet(); }
  }
  async function genMapa(id) {
    const t = temaById(id); if (!t || ui.mapBusy || emAndamento("mapa", id)) return;
    ui.mapBusy = id; ui.mapErr = ""; renderSheet();
    try { await pedirIA({ acao: "mapa", tema_id: id }, S.resIds.has(id) ? null : id, `Ler o material e montar o mapa: ${t.nome}`); }
    catch (e) { ui.mapErr = e.message || "Não consegui pedir o mapa agora. Tente de novo em instantes."; }
    finally { ui.mapBusy = false; renderSheet(); }
  }
  /** Trabalho da fila: lê no navegador o material do Drive do tema e depois cria a tarefa da IA. */
  async function trabalhoMaterial(job, prog) {
    const { tema_id, depois } = job.dados;
    if (!S || !temaById(tema_id)) throw new Error("O tema foi apagado.");
    const avisos = await prepararMaterial(tema_id, (m) => prog(null, m));
    prog(null, "Mandando para a IA…");
    await Tarefas.criar(depois);
    return `Material lido; a IA está trabalhando (veja abaixo).${avisos.length ? " " + avisos.join(" ") : ""}`;
  }
  /** Uma tarefa terminou (Tarefas avisa): atualiza o que estiver na tela. */
  async function aoTerminar(lista) {
    if (!S) return;
    let questoes = false;
    for (const t of lista) {
      const r = t.resultado || {};
      if (t.status !== "pronta") { if (t.tipo === "questoes" && ui.genTarefa === t.id) { ui.genMsg = t.erro || "Não deu certo."; ui.genTarefa = null; } if ((t.tipo === "documento" || t.tipo === "calendario") && ui.cal.tarefa === t.id) ui.cal = { file: null, busy: false, provas: null, msg: { bad: true, t: t.erro || "Não consegui ler o documento." } }; continue; }
      if (t.tipo === "resumo" && r.tema_id) { delete RES[r.tema_id]; delete RESLOAD[r.tema_id]; S.resIds.add(r.tema_id); if (ui.resumo === r.tema_id && ui.sheetMode !== "mapa") { loadRes(r.tema_id); Tarefas.vista([t.id]); } }
      if (t.tipo === "mapa" && r.tema_id) { delete MAPA[r.tema_id]; delete MAPLOAD[r.tema_id]; S.mapaIds.add(r.tema_id); if (ui.resumo === r.tema_id && ui.sheetMode === "mapa") { ui.mmCol = {}; loadMapa(r.tema_id); Tarefas.vista([t.id]); } }
      if (t.tipo === "questoes") { questoes = true; if (ui.genTarefa === t.id) { ui.genTarefa = null; ui.qDisc = r.disciplina_id; ui.genMsg = msgQuestoes(r); } }
      if ((t.tipo === "documento" || t.tipo === "calendario") && ui.cal.tarefa === t.id && (ui.tab === "cal" || ui.tab === "config")) { aplicarCalendario(t); Tarefas.vista([t.id]); }
    }
    if (questoes && S.questoes) await carregarQuestoes().catch(() => { });
    atualizarUso().then(() => render());
  }
  /** "Abrir" no painel de Tarefas */
  async function abrirTarefa(t) {
    const r = t.resultado || {};
    if (t.tipo === "resumo" && r.tema_id) { delete RES[r.tema_id]; delete RESLOAD[r.tema_id]; openRes(r.tema_id); }
    else if (t.tipo === "mapa" && r.tema_id) { delete MAPA[r.tema_id]; delete MAPLOAD[r.tema_id]; openMapa(r.tema_id); }
    else if (t.tipo === "questoes") { fecharSheet(); if (S.questoes) await carregarQuestoes().catch(() => { }); ui.tab = "quest"; ui.qMode = "prat"; ui.qDisc = r.disciplina_id || ""; ui.qIdx = 0; ui.qAns = null; ui.qst = null; render(); window.scrollTo(0, 0); }
    else if (t.tipo === "documento" || t.tipo === "calendario") { fecharSheet(); ui.tab = "cal"; aplicarCalendario(t); render(); document.getElementById("docRev")?.scrollIntoView({ block: "start" }); }
  }
  let sheetRAF = 0;
  function renderSheetSoon() { if (!sheetRAF) sheetRAF = requestAnimationFrame(() => { sheetRAF = 0; renderSheet(); }); }
  function sheetEl() { let el = document.getElementById("sheet"); if (!el) { el = document.createElement("div"); el.id = "sheet"; el.hidden = true; document.body.appendChild(el); } return el; }
  function renderSheet() {
    const el = sheetEl();
    if (!ui.resumo || !S) { el.hidden = true; el.innerHTML = ""; document.body.style.overflow = ""; return; }
    const t = temaById(ui.resumo); if (!t) { ui.resumo = null; el.hidden = true; el.innerHTML = ""; document.body.style.overflow = ""; return; }
    const d = discById(t.disciplina_id) || { nome: "", id: t.disciplina_id };
    const r = RES[t.id], busy = ui.resBusy === t.id, sub = Array.isArray(t.itens) ? t.itens : [];
    const isMap = ui.sheetMode === "mapa", mp = MAPA[t.id], mBusy = ui.mapBusy === t.id || emAndamento("mapa", t.id);
    const bgRes = emAndamento("resumo", t.id);
    const AVISO_BG = `<div class="fb bg-aviso" aria-live="polite"><b>A IA está trabalhando no servidor.</b> Pode fechar esta janela e usar o resto do site (ou até sair): quando ficar pronto, aparece um aviso. Acompanhe em <button class="lnk" data-a="verTarefas" data-abre-tarefas>Tarefas</button>.</div>`;
    const ms = matsDe(t.id);
    const escolha = ui.escolha && ui.escolha.id === t.id ? ui.escolha : null;
    const body = busy ? `<p class="muted" aria-live="polite">${esc(ui.resEtapa || "Preparando…")}</p>`
      : escolha ? `<div class="escolha"><p style="margin:0">Achei este tema em ${escolha.livros.length === 1 ? "um livro seu" : `${escolha.livros.length} livros seus`}:</p>
          <ul class="escolha-livros">${escolha.livros.map((l) => `<li><b>${esc(l.titulo)}</b>${l.paginas.length ? ` <span class="muted">· ${esc(l.paginas.join(", "))}</span>` : ""}</li>`).join("")}</ul>
          <p style="margin:0;font-weight:700">Como você quer o resumo?</p>
          <div class="escolha-op"><button class="opcao" data-a="resModo" data-v="professor"><b>Do jeito do professor</b><span>Fiel ao material do professor. O que os livros dizem fica separado, com o título e a página.</span></button>
          <button class="opcao" data-a="resModo" data-v="livros"><b>Corrigido pelos livros</b><span>O material do professor conferido e completado pelos livros. Cada correção mostra o livro e a página.</span></button></div>
          <p class="muted" style="margin:0;font-size:13.5px">Nos dois jeitos o resumo mostra o que diz o material do professor e o que diz cada livro, e avisa quando eles discordam.</p>
          <div><button class="btn ghost" data-a="resCancelar">Cancelar</button></div></div>`
      : bgRes && !r ? AVISO_BG : r ? (bgRes ? AVISO_BG : "") + md(r.texto) : ui.resErr ? "" : RESLOAD[t.id] === "ok" ? `<p class="muted">Ainda não há resumo deste tema. O resumo só é feito quando você pede: use o botão “Gerar resumo” abaixo.</p>` : `<p class="muted">Carregando…</p>`;
    const mapBody = mBusy ? `<p class="muted">Montando o mapa mental a partir ${S.resIds.has(t.id) ? "do resumo" : "do material do professor"}. Leva uns 30 segundos.</p>${AVISO_BG}`
      : mp && mp.ramos ? `<div class="maptools"><span class="mono">Toque num ramo para abrir ou fechar</span><span class="row" style="gap:6px"><button class="btn" data-a="mmAll" data-v="1">Abrir tudo</button><button class="btn" data-a="mmAll" data-v="0">Só os ramos</button></span></div><div class="mapwrap" id="mapwrap">${mapSvg(t.id)}</div>`
      : ui.mapErr ? "" : MAPLOAD[t.id] === "ok" ? `<div class="empty">Ainda não há mapa mental deste tema.<br><button class="btn solid" data-a="genMapa" data-id="${t.id}" style="margin-top:10px">Gerar mapa mental</button></div>` : `<p class="muted">Carregando…</p>`;
    const keepScroll = el.querySelector(".sheet-body")?.scrollTop;
    const mw = el.querySelector("#mapwrap"), keepMap = mw ? [mw.scrollLeft, mw.scrollTop] : null;
    const focoAberto = el.querySelector("#focoBox")?.open;
    el.hidden = false; document.body.style.overflow = "hidden";
    const modoTxt = r?.modo === "livros" ? " · corrigido pelos livros" : r?.modo === "professor" ? " · do jeito do professor" : "";
    el.innerHTML = `<div class="sheet-bg" data-a="closeRes"></div><section class="sheet-card" role="dialog" aria-modal="true" aria-label="${isMap ? "Mapa mental" : "Resumo"}: ${esc(t.nome)}" style="--c:${slotColor(d.id)}">
      <header class="sheet-h"><div style="min-width:0"><span class="mono">${esc(d.nome)}${t.prova ? " · " + esc(t.prova) : ""}</span><h2 style="font-size:20px;margin-top:2px;overflow-wrap:anywhere">${esc(t.nome)}</h2></div><button class="x" data-a="closeRes" aria-label="Fechar" style="font-size:24px">×</button></header>
      <div class="sheet-body">
        <div class="sheet-seg" role="group" aria-label="Modo de estudo"><button data-a="sheetMode" data-v="res" aria-pressed="${!isMap}">Resumo</button><button data-a="sheetMode" data-v="mapa" aria-pressed="${isMap}">Mapa mental</button></div>
        ${sub.length ? `<div class="lams" style="margin-bottom:10px">${sub.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : ""}
        ${ms.length ? `<p class="tref" style="margin:0 0 12px">Material do professor: ${ms.map((m) => esc(m.nome) + (m.status === "sem_texto" ? " (sem texto)" : m.status === "grande_demais" ? " (grande demais)" : m.status === "erro" ? " (erro)" : "")).join(" · ")}</p>` : `<p class="tref" style="margin:0 0 12px">Este tema não tem material do professor (do Drive ou enviado por você): o resumo usa os livros-base.</p>`}
        ${isMap ? `${ui.mapErr ? `<div class="fb bad" style="margin-bottom:12px">${esc(ui.mapErr)}</div>` : ""}${mapBody}
          ${mp && mp.ramos && !mBusy ? `<div class="exp-row"><span class="mono" style="font-size:11px">Baixar este mapa</span><div class="row" style="gap:8px"><button class="btn" data-a="expMapa" data-id="${t.id}" ${ui.expBusy ? "disabled" : ""}>${ui.expBusy === "png" ? "Gerando imagem…" : "Imagem (PNG)"}</button></div></div>` : ""}`
        : `${ui.resErr ? `<div class="fb bad" style="margin-bottom:12px">${esc(ui.resErr)}</div>` : ""}
          ${(ui.resAvisos || []).length && !busy ? `<div class="fb bad" style="margin-bottom:12px">${ui.resAvisos.map(esc).join("<br>")}</div>` : ""}
          ${r && r.truncado && !busy ? `<div class="fb bad" style="margin-bottom:12px">O resumo ficou incompleto por limite de tamanho. Gere de novo.</div>` : ""}
          <article class="resumo">${body}</article>
          ${r && r.texto && !busy && !escolha ? `<p class="mono" style="margin-top:14px">Escrito pelo Claude${modoTxt}${r.livros?.length ? ` · livros: ${esc(r.livros.map((l) => l.titulo).join(", "))}` : ""}</p>
          <div class="exp-row"><span class="mono" style="font-size:11px">Baixar este resumo</span><div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn" data-a="expRes" data-fmt="pdf" data-id="${t.id}" ${ui.expBusy ? "disabled" : ""}>${ui.expBusy === "pdf" ? "Gerando PDF…" : "PDF"}</button><button class="btn" data-a="expRes" data-fmt="docx" data-id="${t.id}" ${ui.expBusy ? "disabled" : ""}>${ui.expBusy === "docx" ? "Gerando Word…" : "Word (.docx)"}</button></div></div>` : ""}
          <details class="cfg" id="focoBox" style="margin-top:20px" ${focoAberto ? "open" : ""}><summary>Ajustar o foco dos resumos de ${esc(d.nome)}</summary>
            <textarea id="focoInp" class="inp" rows="4" maxlength="2000" style="width:100%;margin-top:8px">${esc(d.foco_resumo || focoPadrao(d.nome))}</textarea>
            <button class="btn" data-a="saveFoco" data-id="${d.id}" style="margin-top:8px">Salvar foco</button></details>
          <p class="muted" style="font-size:12.5px;margin-top:12px">${esc(usoTxt("resumos", "limite_resumos_mes", "resumos"))}. Resumos são gerados por IA e podem conter erros: confira no material.</p>`}
      </div>
      <footer class="sheet-f">
        ${isMap ? (mBusy ? `<button class="btn" disabled>Gerando…</button>` : `<button class="btn" data-a="genMapa" data-id="${t.id}">${mp ? "Gerar mapa de novo" : "Gerar mapa mental"}</button>`)
          : busy || bgRes ? `<button class="btn" disabled>Gerando…</button>` : escolha ? "" : `<button class="btn" data-a="genRes" data-id="${t.id}">${r ? "Refazer resumo" : "Gerar resumo"}</button>`}
        <button class="btn" data-a="resQuest" data-id="${d.id}">Questões</button>
        <button class="btn solid" data-a="resDone" data-id="${t.id}">${topicDone(t) ? "Estudado ✓" : "Marcar como estudado"}</button>
      </footer></section>`;
    if (keepScroll != null) { const b = el.querySelector(".sheet-body"); if (b) b.scrollTop = keepScroll; }
    if (keepMap) { const m = el.querySelector("#mapwrap"); if (m) { m.scrollLeft = keepMap[0]; m.scrollTop = keepMap[1]; } }
  }
  function openRes(id) { if (!temaById(id)) return; ui.resumo = +id; ui.sheetMode = "res"; ui.resErr = ""; ui.resAvisos = []; renderSheet(); if (!RES[id]) loadRes(+id); }
  function openMapa(id) { if (!temaById(id)) return; if (ui.resumo !== +id) ui.mmCol = {}; ui.resumo = +id; ui.sheetMode = "mapa"; ui.mapErr = ""; renderSheet(); if (!MAPA[id]) loadMapa(+id); }
  function fecharSheet() { ui.resumo = null; ui.escolha = null; renderSheet(); }

  /* ----- mapa mental (SVG) ----- */
  function mmLines(s, max) { const w = String(s).split(/\s+/), out = []; let cur = ""; for (const x of w) { if (!cur) cur = x; else if ((cur + " " + x).length <= max) cur += " " + x; else { out.push(cur); cur = x; } } if (cur) out.push(cur); return out.slice(0, 5); }
  function mapSvg(id, forExport) {
    const m = MAPA[id]; if (!m) return "";
    const cs = getComputedStyle(document.documentElement), cv = (n) => cs.getPropertyValue(n).trim() || "#888";
    const PAL = CORES.map(cv);
    const ink = cv("--ink"), paper = cv("--paper"), card = cv("--card"), card2 = cv("--card2");
    const col = ui.mmCol || (ui.mmCol = {});
    const FS = [16, 14, 13, 12.5], CW = [8.6, 7.9, 7.3, 6.7], MX = [22, 24, 28, 30], LH = [20, 18, 17, 16];
    function mk(n, depth, path, color) { const lines = mmLines(n.t, MX[Math.min(depth, 3)]); const L = Math.min(depth, 3);
      const w = Math.max(54, Math.max(...lines.map((l) => l.length)) * CW[L] + 30), h = lines.length * LH[L] + (depth <= 1 ? 16 : 12);
      const kids = (n.filhos || []); const open = forExport ? true : !col[path];
      const o = { t: n.t, lines, depth, path, w, h, color, hasKids: kids.length > 0, open, kids: [] };
      if (open) o.kids = kids.map((k, i) => mk(k, depth + 1, path + "." + i, color)); return o; }
    const root = mk({ t: m.titulo || "Tema", filhos: [] }, 0, "r", ink); root.hasKids = false;
    root.kids = (m.ramos || []).map((r, i) => mk(r, 1, "r." + i, PAL[i % PAL.length]));
    const GX = 46, GY = 10, colW = [];
    (function cw(n) { colW[n.depth] = Math.max(colW[n.depth] || 0, n.w); n.kids.forEach(cw); })(root);
    const xs = [16]; for (let i = 1; i < colW.length; i++) xs[i] = xs[i - 1] + colW[i - 1] + GX;
    (function sh(n) { n.kids.forEach(sh); const kh = n.kids.reduce((s, k) => s + k.sh, 0) + Math.max(0, n.kids.length - 1) * GY; n.kh = kh; n.sh = Math.max(n.h, kh); })(root);
    (function pl(n, top) { n.x = xs[n.depth]; if (!n.kids.length) { n.y = top + n.sh / 2; return; } let ct = top + (n.sh - n.kh) / 2; n.kids.forEach((k) => { pl(k, ct); ct += k.sh + GY; }); n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2; })(root, 16);
    const W = xs[xs.length - 1] + colW[colW.length - 1] + 30, Hh = root.sh + 32;
    let edges = "", nodes = "";
    (function dr(n) {
      n.kids.forEach((k) => { const x1 = n.x + n.w, y1 = n.y, x2 = k.x, y2 = k.y, mx = (x1 + x2) / 2;
        edges += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" fill="none" stroke="${k.color}" stroke-width="${k.depth === 1 ? 3 : k.depth === 2 ? 2 : 1.4}" stroke-opacity="${k.depth === 1 ? .9 : .65}" stroke-linecap="round"/>`; dr(k); });
      const L = Math.min(n.depth, 3), fill = n.depth === 0 ? ink : n.depth === 1 ? n.color : n.depth === 2 ? card2 : card,
        tc = n.depth === 0 ? paper : n.depth === 1 ? "#FFFFFF" : ink, fw = n.depth <= 1 ? 700 : n.depth === 2 ? 600 : 400;
      const ty = n.y - (n.lines.length * LH[L]) / 2 + LH[L] * 0.72;
      const tx = n.lines.map((l, i) => `<tspan x="${n.x + 12}" y="${ty + i * LH[L]}">${esc(l)}</tspan>`).join("");
      const toggle = n.hasKids ? `<g><circle cx="${n.x + n.w}" cy="${n.y}" r="8" fill="${card}" stroke="${n.color}" stroke-width="1.5"/><text x="${n.x + n.w}" y="${n.y + 4}" text-anchor="middle" font-size="12" font-weight="700" fill="${n.color}">${n.open ? "−" : "+"}</text></g>` : "";
      const att = n.hasKids && !forExport ? ` class="mmn" data-a="mmToggle" data-p="${n.path}" tabindex="0" role="button" aria-expanded="${n.open}" aria-label="${esc(n.t)}"` : "";
      nodes += `<g${att}><rect x="${n.x}" y="${n.y - n.h / 2}" width="${n.w}" height="${n.h}" rx="${n.depth === 0 ? 12 : n.depth === 1 ? 10 : 8}" fill="${fill}" stroke="${n.color}" stroke-width="${n.depth >= 2 ? 1.3 : 0}"/><text font-family="DM Sans, Arial, sans-serif" font-size="${FS[L]}" font-weight="${fw}" fill="${tc}">${tx}</text>${toggle}</g>`;
    })(root);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(Hh)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(Hh)}" role="img" aria-label="Mapa mental: ${esc(m.titulo || "")}">${forExport ? `<rect width="100%" height="100%" fill="${card}"/>` : ""}${edges}${nodes}</svg>`;
  }
  function baixar(blob, nome) {
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = nome; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  // nome do arquivo sem acento (alguns navegadores trocam nomes com acento por "download")
  const nomeArq = (pref, t, ext) => (pref + " - " + semAcentoMaiusc(t.nome)).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) + "." + ext;
  async function expMapa(id) {
    const t = temaById(id); if (!t || !MAPA[id]) return; ui.expBusy = "png"; renderSheet();
    try {
      const svg = mapSvg(id, true); const mW = +svg.match(/width="(\d+)"/)[1], mH = +svg.match(/height="(\d+)"/)[1];
      const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      await new Promise((ok, bad) => { img.onload = ok; img.onerror = () => bad(new Error("Não consegui desenhar a imagem.")); img.src = url; });
      const sc = Math.min(2, 8000 / Math.max(mW, mH)), c = document.createElement("canvas"); c.width = Math.round(mW * sc); c.height = Math.round(mH * sc);
      const g = c.getContext("2d"); g.scale(sc, sc); g.drawImage(img, 0, 0); URL.revokeObjectURL(url);
      const blob = await new Promise((ok) => c.toBlob(ok, "image/png"));
      baixar(blob, nomeArq("Mapa mental", t, "png")); toast("Imagem salva");
    } catch (e) { toast((e && e.message) || "Não consegui gerar a imagem"); }
    finally { ui.expBusy = null; renderSheet(); }
  }
  /* ----- exportar resumo (PDF e Word), igual ao painel original ----- */
  const EXP_LIBS = {
    docx: [["https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js", "sha384-4xaIisuLEy2lo2HkB2C4rEf7v8jbTb2kuogX6TkuEt9feTWKBSFSOzsqNNbV+sKh"]],
    pdf: [["https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/pdfmake.min.js", "sha384-vseuUuO/VRMn00lXYd5m/Pk4l/7RjMqhXGf6G0RALy+On0txYb39dQsUQDAd7q5L"], ["https://cdn.jsdelivr.net/npm/pdfmake@0.2.10/build/vfs_fonts.js", "sha384-zmD5tDN2awbMigS/yVcxHObSsdXXKh/27Y/bSII38WfNl+D7O/aVCIteAXsLY3p3"]],
  };
  const expLoaded = {};
  function expScript([src, sri]) { if (expLoaded[src]) return expLoaded[src]; return expLoaded[src] = new Promise((ok, bad) => { const s = document.createElement("script"); s.src = src; s.integrity = sri; s.crossOrigin = "anonymous"; s.onload = ok; s.onerror = () => { delete expLoaded[src]; bad(new Error("Não consegui carregar a biblioteca de exportação. Verifique a internet e tente de novo.")); }; document.head.appendChild(s); }); }
  function expUnesc(s) { return String(s == null ? "" : s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"); }
  function expRuns(tokens, st) { st = st || {}; const out = []; for (const k of tokens || []) {
    if (k.type === "strong") out.push(...expRuns(k.tokens, { ...st, b: true }));
    else if (k.type === "em") out.push(...expRuns(k.tokens, { ...st, i: true }));
    else if (k.type === "del") out.push(...expRuns(k.tokens, { ...st, s: true }));
    else if (k.type === "link") out.push(...expRuns(k.tokens, st));
    else if (k.type === "codespan") out.push({ t: expUnesc(k.text), ...st, code: true });
    else if (k.type === "br") out.push({ t: "\n", ...st });
    else if (k.type === "html") continue;
    else if (k.tokens) out.push(...expRuns(k.tokens, st));
    else out.push({ t: expUnesc(k.text != null ? k.text : k.raw), ...st }); } return out; }
  function expBlocks(text) {
    const out = []; const lex = window.marked.lexer(text || "");
    function walk(toks, lvl) { for (const k of toks) {
      if (k.type === "heading") out.push({ k: "h", level: k.depth, runs: expRuns(k.tokens) });
      else if (k.type === "paragraph" || k.type === "text") out.push({ k: "p", runs: expRuns(k.tokens || [{ type: "text", text: k.text }]), lvl });
      else if (k.type === "list") { let n = Number(k.start) || 1; for (const it of k.items) { const runs = [], sub = []; for (const c of it.tokens) { if (c.type === "list") sub.push(c); else if (c.type === "text" || c.type === "paragraph") { if (runs.length) runs.push({ t: "\n" }); runs.push(...expRuns(c.tokens || [{ type: "text", text: c.text }])); } }
        out.push({ k: "li", level: lvl, ordered: k.ordered, num: n++, runs }); walk(sub, lvl + 1); } }
      else if (k.type === "table") out.push({ k: "table", header: k.header.map((c) => expRuns(c.tokens)), rows: k.rows.map((r) => r.map((c) => expRuns(c.tokens))) });
      else if (k.type === "blockquote") { const runs = []; for (const c of k.tokens) { if (c.tokens) { if (runs.length) runs.push({ t: "\n" }); runs.push(...expRuns(c.tokens)); } } out.push({ k: "quote", runs }); }
      else if (k.type === "hr") out.push({ k: "hr" });
      else if (k.type === "code") out.push({ k: "code", text: k.text }); } }
    walk(lex, 0); return out; }
  async function expDocx(d, t, text) {
    for (const s of EXP_LIBS.docx) await expScript(s); const D = window.docx; if (!D) throw new Error("Biblioteca do Word indisponível.");
    const tr = (r, extra) => new D.TextRun({ text: r.t, bold: !!r.b || !!(extra && extra.b), italics: !!r.i, strike: !!r.s, font: r.code ? "Consolas" : undefined });
    const runsOf = (rs, extra) => { const a = []; for (const r of rs) { String(r.t).split("\n").forEach((p, i) => { if (i) a.push(new D.TextRun({ break: 1 })); if (p) a.push(tr({ ...r, t: p }, extra)); }); } return a.length ? a : [new D.TextRun("")]; };
    const HL = [null, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6];
    const kids = [new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun(t.nome)] }), new D.Paragraph({ spacing: { after: 200 }, children: [new D.TextRun({ text: d.nome + (t.prova ? " · " + t.prova : ""), italics: true, color: "666666" })] })];
    const bd = { style: D.BorderStyle.SINGLE, size: 4, color: "999999" };
    for (const b of expBlocks(text)) {
      if (b.k === "h") { if (b.level === 1 && kids.length === 2 && b.runs.map((r) => r.t).join("").trim() === t.nome.trim()) continue; kids.push(new D.Paragraph({ heading: HL[Math.min(b.level, 6)], children: runsOf(b.runs) })); }
      else if (b.k === "p") kids.push(new D.Paragraph({ spacing: { after: 120 }, children: runsOf(b.runs) }));
      else if (b.k === "li") kids.push(b.ordered ? new D.Paragraph({ indent: { left: 360 * (b.level + 1), hanging: 300 }, spacing: { after: 60 }, children: [new D.TextRun(b.num + ". "), ...runsOf(b.runs)] }) : new D.Paragraph({ bullet: { level: Math.min(b.level, 8) }, spacing: { after: 60 }, children: runsOf(b.runs) }));
      else if (b.k === "table") { const cell = (rs, h) => new D.TableCell({ children: [new D.Paragraph({ children: runsOf(rs, h ? { b: true } : null) })], shading: h ? { fill: "E8E8E8" } : undefined, margins: { top: 60, bottom: 60, left: 80, right: 80 } });
        kids.push(new D.Table({ width: { size: 100, type: D.WidthType.PERCENTAGE }, borders: { top: bd, bottom: bd, left: bd, right: bd, insideHorizontal: bd, insideVertical: bd }, rows: [new D.TableRow({ tableHeader: true, children: b.header.map((c) => cell(c, true)) }), ...b.rows.map((r) => new D.TableRow({ children: r.map((c) => cell(c, false)) }))] })); kids.push(new D.Paragraph("")); }
      else if (b.k === "quote") kids.push(new D.Paragraph({ indent: { left: 400 }, border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: "999999", space: 8 } }, spacing: { after: 120 }, children: runsOf(b.runs.map((r) => ({ ...r, i: true }))) }));
      else if (b.k === "hr") kids.push(new D.Paragraph({ border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: "BBBBBB", space: 1 } }, children: [] }));
      else if (b.k === "code") kids.push(new D.Paragraph({ children: runsOf([{ t: b.text, code: true }]) }));
    }
    const doc = new D.Document({ creator: "Painel de Estudos", title: "Resumo - " + t.nome, styles: { default: { document: { run: { font: "Calibri", size: 22 } } } }, sections: [{ properties: { page: { margin: { top: 1000, bottom: 1000, left: 1100, right: 1100 } } }, children: kids }] });
    return D.Packer.toBlob(doc);
  }
  async function expPdf(d, t, text) {
    for (const s of EXP_LIBS.pdf) await expScript(s); const P = window.pdfMake; if (!P) throw new Error("Biblioteca de PDF indisponível.");
    const tx = (rs) => rs.map((r) => ({ text: r.t, bold: !!r.b, italics: !!r.i, decoration: r.s ? "lineThrough" : undefined, background: r.code ? "#eeeeee" : undefined }));
    const content = [{ text: t.nome, style: "title" }, { text: d.nome + (t.prova ? " · " + t.prova : ""), style: "meta" }];
    const HS = { 1: "h1", 2: "h2", 3: "h3" };
    for (const b of expBlocks(text)) {
      if (b.k === "h") { if (b.level === 1 && content.length === 2 && b.runs.map((r) => r.t).join("").trim() === t.nome.trim()) continue; content.push({ text: tx(b.runs), style: HS[b.level] || "h3" }); }
      else if (b.k === "p") content.push({ text: tx(b.runs), margin: [0, 0, 0, 6] });
      else if (b.k === "li") content.push({ columns: [{ width: 14, text: b.ordered ? b.num + "." : "•" }, { width: "*", text: tx(b.runs) }], columnGap: 4, margin: [14 * b.level + 4, 0, 0, 3] });
      else if (b.k === "table") { const n = b.header.length; content.push({ table: { headerRows: 1, widths: Array(n).fill("*"), body: [b.header.map((c) => ({ text: tx(c), bold: true, fillColor: "#e8e8e8" })), ...b.rows.map((r) => { const row = r.map((c) => ({ text: tx(c) })); while (row.length < n) row.push({ text: "" }); return row.slice(0, n); })] }, layout: { hLineColor: "#aaaaaa", vLineColor: "#aaaaaa", hLineWidth: () => 0.5, vLineWidth: () => 0.5, paddingTop: () => 3, paddingBottom: () => 3 }, fontSize: 9.5, margin: [0, 2, 0, 10] }); }
      else if (b.k === "quote") content.push({ table: { widths: ["*"], body: [[{ text: tx(b.runs), italics: true }]] }, layout: { hLineWidth: () => 0, vLineWidth: (i) => i === 0 ? 2 : 0, vLineColor: "#999999", paddingLeft: () => 8 }, margin: [0, 0, 0, 8] });
      else if (b.k === "hr") content.push({ canvas: [{ type: "line", x1: 0, y1: 4, x2: 515, y2: 4, lineWidth: 0.5, lineColor: "#bbbbbb" }], margin: [0, 4, 0, 8] });
      else if (b.k === "code") content.push({ text: b.text, background: "#eeeeee", fontSize: 9, margin: [0, 0, 0, 6] });
    }
    const dd = { pageSize: "A4", pageMargins: [40, 44, 40, 48], info: { title: "Resumo - " + t.nome }, content, defaultStyle: { fontSize: 10.5, lineHeight: 1.2 },
      styles: { title: { fontSize: 20, bold: true, margin: [0, 0, 0, 2] }, meta: { fontSize: 10, italics: true, color: "#666666", margin: [0, 0, 0, 12] }, h1: { fontSize: 16, bold: true, margin: [0, 10, 0, 6] }, h2: { fontSize: 13.5, bold: true, margin: [0, 10, 0, 5] }, h3: { fontSize: 11.5, bold: true, margin: [0, 8, 0, 4] } },
      footer: (cur, tot) => ({ text: t.nome + " · " + cur + "/" + tot, alignment: "center", fontSize: 8, color: "#888888", margin: [0, 16, 0, 0] }) };
    return new Promise((ok, bad) => { try { P.createPdf(dd).getBlob(ok); } catch (e) { bad(e); } });
  }
  async function expResumo(id, fmt2) {
    const t = temaById(id), r = RES[id]; if (!t || !r || !r.texto) return;
    if (!window.marked) return toast("Não consegui carregar o leitor de Markdown. Recarregue a página.");
    ui.expBusy = fmt2; renderSheet();
    try {
      const d = discById(t.disciplina_id) || { nome: "" };
      const blob = fmt2 === "pdf" ? await expPdf(d, t, r.texto) : await expDocx(d, t, r.texto);
      baixar(blob, nomeArq("Resumo", t, fmt2 === "pdf" ? "pdf" : "docx"));
      toast(fmt2 === "pdf" ? "PDF salvo" : "Arquivo do Word salvo");
    } catch (e) { toast((e && e.message) || "Não consegui gerar o arquivo"); }
    finally { ui.expBusy = null; renderSheet(); }
  }

  /* ================= AJUSTES DO SEMESTRE ================= */
  function vCfg() {
    const m = cfgPts();
    return `<details class="cfg" id="cfg" ${ui.cfgOpen ? "open" : ""}><summary>Ajustes do semestre</summary>
      ${janela("Minhas matérias", `<div class="win-body"><div class="stack">${S.disc.map((d) => `<form class="cfg-disc" data-form="editDisc" data-id="${d.id}">
          <label class="field"><span class="mono">Matéria</span><input name="nome" maxlength="120" required value="${esc(d.nome)}"></label>
          <label class="field"><span class="mono">Professor</span><input name="professor" maxlength="120" value="${esc(d.professor || "")}"></label>
          <label class="check"><input type="checkbox" name="pratica" ${d.tem_pratica ? "checked" : ""}>tem prática</label>
          <span class="row" style="gap:6px"><button class="btn">Salvar</button>${ui.confDisc == d.id ? `<button type="button" class="btn" data-a="delDisc" data-id="${d.id}" style="color:var(--bad);border-color:var(--bad)">Apagar</button><button type="button" class="btn ghost" data-a="cancelDel">Não</button>` : `<button type="button" class="btn ghost" data-a="askDisc" data-id="${d.id}">Remover</button>`}</span>
          ${ui.confDisc == d.id ? `<span class="disc-dica" style="color:var(--bad)">Apagar ${esc(d.nome)} com temas, provas, notas, questões e resumos?</span>` : ""}</form>`).join("") || `<div class="empty">Nenhuma matéria neste semestre.</div>`}</div>
        <form class="row" data-form="addDisc" style="margin-top:16px"><label class="field" style="flex:1 1 200px"><span class="mono">Nova matéria</span><input name="nome" maxlength="120" placeholder="Ex.: Medicina Tropical" required></label>
          <label class="field" style="flex:1 1 160px"><span class="mono">Professor (opcional)</span><input name="professor" maxlength="120"></label>
          <label class="check" style="align-self:center"><input type="checkbox" name="pratica">tem prática</label><button class="btn solid">Adicionar matéria</button></form></div>`)}
      ${janela("Período", `<div class="win-body"><div class="row">
          <label class="field" style="flex:0 1 200px"><span class="mono">Horas complementares exigidas</span><input id="cfgHoras" type="number" min="0" max="5000" value="${esc(+(S.pref.horas_meta ?? 200))}"></label>
          <button class="btn solid" data-a="saveCfg">Salvar ajustes</button></div>
        <p class="muted" style="font-size:13.5px;margin:12px 0 0">Regra de notas${S.faculdade ? ` da ${esc(S.faculdade)}` : ""}: P1 ${fmt(m.p1)}, P2 ${fmt(m.p2)}, Final ${fmt(m.fin)} (ou ${fmt(m.finPr)} teórica + ${fmt(m.prF)} prática), processo até ${fmt(m.proc)}; passa com ${fmt(m.min)}. Se estiver diferente, avise o administrador.</p>
        <div style="margin-top:16px">${ui.confirmReset ? `<div class="confirm"><span>Apagar notas, datas de provas, questões, eventos, horas e calendário deste semestre? Temas, resumos, mapas, lâminas e livros continuam. Isso não pode ser desfeito.</span><button class="btn" data-a="doReset" style="color:var(--bad);border-color:var(--bad)">Apagar tudo</button><button class="btn ghost" data-a="cancelReset">Cancelar</button></div>` : `<button class="btn ghost" data-a="askReset">Apagar os dados do semestre</button>`}</div></div>`)}
    </details>`;
  }

  /* ================= RENDER ================= */
  function render() {
    if (!ativo() || !S) return;
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === ui.tab));
    const v = document.getElementById("pview");
    const focusId = document.activeElement && document.activeElement.id;
    v.innerHTML = (S.falta06 ? `<div class="msg bad">Parte do painel ainda não foi ativada no banco: o administrador precisa rodar o arquivo 06_estudo.sql no Supabase.</div>` : "")
      + ({ agenda: vAgenda, disc: vDisc, quest: vQuest, media: vMedia, aulas: vAulas, cal: vCal, vida: vVida, lam: vLamTab, config: vConfig }[ui.tab] || vAgenda)();
    // Configurações: Google Drive e livros (ficam montados) e os ajustes do semestre
    document.getElementById("pfixos").hidden = ui.tab !== "config";
    if (ui.tab === "config") iniciarFixos();
    document.getElementById("pcfg").innerHTML = ui.tab === "config" ? vCfg() : "";
    if (focusId) { const el = document.getElementById(focusId); if (el && el !== document.activeElement) { el.focus(); try { const l = el.value.length; el.setSelectionRange(l, l); } catch (_) { } } }
    renderSheet();
  }
  // Janelas "Meu Google Drive" e "Meus livros" (em Configurações): ficam montadas, não somem a cada clique
  const FIXOS = [["drive", "Meu Google Drive", "drv"], ["livros", "Meus livros", "liv"]];
  const fixosIni = {};
  function fixosHTML() {
    return FIXOS.map(([k, titulo, id]) => `<section class="win" id="win-${k}"><div class="win-bar"><span class="dots"><i></i><i></i><i></i></span>${titulo}</div>
        <div class="win-body"><div id="${id}"><p class="muted" style="margin:0">Carregando…</p></div></div></section>`).join("");
  }
  function iniciarFixos() {
    FIXOS.forEach(([k]) => { if (fixosIni[k]) return; fixosIni[k] = true; if (k === "drive") H.driveTela(S.disc); else H.livrosTela(); });
  }

  /* ================= EVENTOS ================= */
  const noPainel = (el) => !!(el && el.closest && (el.closest("#painel") || el.closest("#sheet")));
  async function upd(tabela, id, campos, msgErro) {
    const { error } = await sb.from(tabela).update(campos).eq("id", id);
    if (error) { toast((msgErro || "Não consegui salvar: ") + error.message); return false; } return true;
  }
  // Apaga no banco e confere que apagou mesmo (a regra de acesso pode não deixar sem dar erro: aí avisa,
  // em vez de sumir só da tela e voltar ao entrar de novo). Arquivo do Drive não some: fica oculto.
  async function del(tabela, id, oculta = false) {
    const { data, error } = await sb.from(tabela).delete().eq("id", id).select("id");
    if (error) { toast("Não consegui apagar: " + error.message); return false; }
    if (!oculta && !(data || []).length) { toast("Não consegui apagar: o servidor não deixou (confira se seu acesso está em dia)."); return false; }
    return true;
  }
  function tickTema(t, campos) { Object.assign(t, campos); render(); upd("temas", t.id, campos); }

  async function onClick(e) {
    if (!ativo()) return;
    const tab = e.target.closest("#tabs button");
    if (tab) { ui.tab = tab.dataset.tab; ss.set("painel:tab", ui.tab); try { history.replaceState(null, "", "#" + ui.tab); } catch (_) { } render(); window.scrollTo(0, 0); return; }
    const b = e.target.closest("[data-a]"); if (!b || !noPainel(b) || b.tagName === "SELECT" || (b.tagName === "INPUT" && b.type !== "checkbox")) return;
    const a = b.dataset.a, id = b.dataset.id;
    switch (a) {
      case "goCfg": abrirTela("config"); break;
      case "goPerfil": H.perfilTela(); break;
      case "upAbrir": ui.upOpen = true; if (discById(id)) ui.up.disc = +id; render(); document.getElementById("upJanela")?.scrollIntoView({ behavior: "smooth", block: "start" }); break;
      case "upFechar": ui.upOpen = false; ui.up.files = []; render(); break;
      case "upEnviar": enviarArquivos(); break;
      case "upLimpar": ui.up.files = []; render(); break;
      case "upTirar": ui.up.files.splice(+b.dataset.i, 1); render(); break;
      case "askMat": ui.confMat = +id; render(); break;
      case "delMat": ui.confMat = null; apagarMaterial(+id); break;
      case "calLer": lerCalendario(); break;
      case "calCancelar": ui.cal = { file: null, busy: false, msg: null, provas: null, doc: null }; render(); break;
      case "verTarefas": Tarefas.abrir(); break;
      case "goEnviar": abrirTela("config"); setTimeout(() => document.getElementById("upArq")?.closest(".win")?.scrollIntoView({ block: "start" }), 50); break;
      case "askDoc": ui.confDoc = +id; render(); break;
      case "delDoc": { ui.confDoc = null; if (await del("documentos", id)) { S.docs = (S.docs || []).filter((x) => x.id != id); toast("Registro apagado"); } render(); break; }
      case "calSalvar": salvarCalendario(); break;
      case "askDel": ui.confDel = +id; render(); break;
      case "askDisc": ui.confDisc = +id; ui.cfgOpen = true; render(); break;
      case "askLam": ui.confLam = +id; ui.lamGer = true; render(); break;
      case "cancelDel": ui.confDel = null; ui.confDisc = null; ui.confLam = null; ui.confMat = null; ui.confDoc = null; render(); break;
      case "openRes": if (id) openRes(+id); break;
      case "closeRes": fecharSheet(); break;
      case "openMapa": if (id) openMapa(+id); break;
      case "sheetMode": if (b.dataset.v === "mapa") openMapa(ui.resumo); else { ui.sheetMode = "res"; renderSheet(); if (!RES[ui.resumo]) loadRes(ui.resumo); } break;
      case "genMapa": genMapa(+id); break;
      case "expMapa": if (!ui.expBusy) expMapa(+id); break;
      case "mmToggle": { ui.mmCol = ui.mmCol || {}; const p = b.dataset.p; ui.mmCol[p] = !ui.mmCol[p]; renderSheet(); break; }
      case "mmAll": { ui.mmCol = {}; if (b.dataset.v === "0") { const m = MAPA[ui.resumo]; (m?.ramos || []).forEach((r, i) => { if (r.filhos && r.filhos.length) ui.mmCol["r." + i] = true; }); } renderSheet(); break; }
      case "genRes": pedirResumo(+id); break;
      case "resModo": if (ui.escolha) gerarResumo(ui.escolha.id, b.dataset.v === "livros" ? "livros" : "professor"); break;
      case "resCancelar": ui.escolha = null; renderSheet(); break;
      case "expRes": if (!ui.expBusy) expResumo(+id, b.dataset.fmt); break;
      case "resQuest": fecharSheet(); ui.tab = "quest"; ui.qMode = "prat"; ui.qDisc = id; ui.qIdx = 0; ui.qAns = null; render(); break;
      case "resDone": { const t = temaById(id); if (t) { const v = !topicDone(t); tickTema(t, { aula: v, resumo_ok: v }); toast(v ? "Tema marcado como estudado" : "Tema desmarcado"); } break; }
      case "saveFoco": { const d = discById(id); const v = document.getElementById("focoInp")?.value.trim(); if (d) { const foco = v && v !== focoPadrao(d.nome) ? v : null; if (await upd("disciplinas", d.id, { foco_resumo: foco })) { d.foco_resumo = foco; toast("Foco salvo. Vale para os próximos resumos."); } } break; }
      case "agTick": { const k = b.dataset.k; if (k.startsWith("st:")) { const t = temaById(b.dataset.t); if (t) tickTema(t, { aula: b.checked, resumo_ok: b.checked }); }
        else { const f = { ...feitos(), [k]: b.checked }; Object.keys(f).forEach((x) => { if (!f[x]) delete f[x]; }); S.pref.agenda_feitos = f; render(); salvarPref({ agenda_feitos: f }); } break; }
      case "agProva": ui.agOpen = ui.agOpen == id ? null : +id; if (ui.tab !== "agenda") { fecharSheet(); ui.tab = "agenda"; } render(); break;
      case "saveAg": { const g = (k) => num(document.getElementById(k).value); const o = cfgAg(); const c = { horas_dia: Math.max(0, Math.min(16, g("agDia") ?? o.dia)), horas_fds: Math.max(0, Math.min(16, g("agFds") ?? o.fds)), dormir: Math.max(18, Math.min(27, g("agDormir") ?? o.dormir)) };
        if (await salvarPref(c)) { render(); toast("Agenda recalculada"); } break; }
      case "saveModelo": { const v = document.getElementById("agModelo").value.trim().slice(0, 4000); if (await salvarPref({ modelo_resumo: v && v !== MODELO_PADRAO ? v : null })) { render(); toast("Modelo salvo"); } break; }
      case "resetModelo": if (await salvarPref({ modelo_resumo: null })) { render(); toast("Modelo padrão restaurado"); } break;
      case "pickDisc": ui.disc = +id; ui.confDel = null; render(); break;
      case "tick": { const t = temaById(id); if (t) tickTema(t, { [b.dataset.k]: b.checked }); break; }
      case "delTopic": { ui.confDel = null; if (await del("temas", id)) { S.temas = S.temas.filter((t) => t.id != id); S.mats = S.mats.filter((m) => !(m.tema_id == id && !enviado(m))); S.mats.forEach((m) => { if (m.tema_id == id) m.tema_id = null; }); render(); toast("Tema apagado"); } break; }
      case "delDisc": { ui.confDisc = null; if (await del("disciplinas", id)) { await recarregar(); toast("Matéria removida"); } break; }
      case "qMode": ui.qMode = b.dataset.m; ui.qIdx = 0; ui.qAns = null; ui.qst = null; ui.genMsg = ""; render(); break;
      case "answer": { const q = qPool()[ui.qIdx]; if (!q) break; const i = +b.dataset.i; ui.qAns = i; ui.qAnsId = q.id; qRecord(q, i === q.correta); break; }
      case "vfPick": { const q = qPool()[ui.qIdx]; if (!q) break; const st = qSt(q); if (st.done) break; st.vf[+b.dataset.i] = b.dataset.v === "1"; render(); break; }
      case "vfCheck": { const q = qPool()[ui.qIdx]; if (!q) break; const st = qSt(q); st.done = true; qRecord(q, (q.afirmativas || []).every((x, i) => st.vf[i] === !!x.v)); break; }
      case "relCheck": { const q = qPool()[ui.qIdx]; if (!q) break; const st = qSt(q); st.done = true; qRecord(q, (q.colA || []).every((_, i) => +st.rel[i] === q.pares[i])); break; }
      case "disShow": { const q = qPool()[ui.qIdx]; if (!q) break; const st = qSt(q); st.txt = document.getElementById("disTxt")?.value || st.txt; st.done = true; render(); break; }
      case "disMark": { const q = qPool()[ui.qIdx]; if (!q) break; const st = qSt(q); st.marked = true; qRecord(q, b.dataset.v === "1"); break; }
      case "nextQ": { const n = qPool().length; if (ui.qMode === "rev" && ui._keep) { ui._keep = null; } else ui.qIdx = n ? (ui.qIdx + 1) % n : 0; ui.qAns = null; ui.qst = null; render(); break; }
      case "delQ": { if (await del("questoes", id)) { S.questoes = S.questoes.filter((q) => q.id != id); ui.qAns = null; ui.qst = null; render(); toast("Questão excluída"); } break; }
      case "lamReveal": ui.lamShow = true; render(); break;
      case "lamSkip": lamNext(); render(); break;
      case "lamMark": { const c = (S.laminas || []).find((x) => x.id === ui.lamCur); if (!c) break; if (b.dataset.v === "1") { c.acertos++; c.ultima = true; } else { c.erros++; c.ultima = false; }
        upd("laminas", c.id, { acertos: c.acertos, erros: c.erros, ultima: c.ultima }); lamNext(); render(); break; }
      case "delLam": { const c = (S.laminas || []).find((x) => x.id == id); ui.confLam = null; if (!c) break;
        await sb.storage.from("laminas").remove([c.caminho]); if (await del("laminas", c.id)) { S.laminas = S.laminas.filter((x) => x.id !== c.id); if (ui.lamCur === c.id) ui.lamCur = null; toast("Lâmina apagada"); } render(); break; }
      case "mNav": ui.calM += +b.dataset.v; if (ui.calM < 0) { ui.calM = 11; ui.calY--; } if (ui.calM > 11) { ui.calM = 0; ui.calY++; } render(); break;
      case "yNav": ui.calY += +b.dataset.v; render(); break;
      case "acadAll": ui.acadAll = !ui.acadAll; render(); break;
      case "calView": ui.calView = b.dataset.v; render(); break;
      case "openMonth": ui.calM = +b.dataset.m; ui.calView = "mes"; render(); break;
      case "pickDay": { ui.calDate = b.dataset.d; render(); const pd = document.getElementById("provaData"); if (pd) { pd.scrollIntoView({ behavior: "smooth", block: "center" }); pd.focus(); } break; }
      case "delProva": if (await del("provas", id)) { S.provas = S.provas.filter((p) => p.id != id); render(); } break;
      case "delPer": if (await del("calendario", id)) { S.cal = S.cal.filter((p) => p.id != id); render(); } break;
      case "delAula": if (await del("horarios", id)) { S.horarios = S.horarios.filter((p) => p.id != id); render(); } break;
      case "vMode": ui.vMode = b.dataset.m; ui.vEdit = null; render(); break;
      case "vEdit": ui.vEdit = { t: b.dataset.t, id: +id }; render(); document.querySelector(".vmain form input")?.focus(); break;
      case "vCancel": ui.vEdit = null; render(); break;
      case "evSt": { const ev = S.eventos.find((x) => x.id == id), o = ["pend", "ins", "conf", "done"]; ev.status = o[(o.indexOf(ev.status) + 1) % 4]; render(); upd("vida_eventos", ev.id, { status: ev.status }); break; }
      case "delEv": if (await del("vida_eventos", id)) { S.eventos = S.eventos.filter((x) => x.id != id); render(); } break;
      case "delLiga": if (await del("ligas", id)) { S.ligas = S.ligas.filter((x) => x.id != id); render(); } break;
      case "cert": { const h = S.horas.find((x) => x.id == id); h.certificado = b.checked; render(); upd("horas_compl", h.id, { certificado: h.certificado }); break; }
      case "delHora": if (await del("horas_compl", id)) { S.horas = S.horas.filter((x) => x.id != id); render(); } break;
      case "saveCfg": { const v = num(document.getElementById("cfgHoras").value); if (v != null && await salvarPref({ horas_meta: Math.max(0, Math.min(5000, v)) })) { render(); toast("Ajustes salvos"); } break; }
      case "askReset": ui.confirmReset = true; ui.cfgOpen = true; render(); break;
      case "cancelReset": ui.confirmReset = false; render(); break;
      case "doReset": { ui.confirmReset = false; const ids = S.disc.map((d) => d.id);
        const rs = await Promise.all([...(ids.length ? [sb.from("notas").delete().in("disciplina_id", ids), sb.from("provas").delete().in("disciplina_id", ids), sb.from("questoes").delete().in("disciplina_id", ids)] : []),
          sb.from("vida_eventos").delete().eq("aluno_id", H.P.id), sb.from("horas_compl").delete().eq("aluno_id", H.P.id), sb.from("calendario").delete().eq("aluno_id", H.P.id)]);
        await salvarPref({ agenda_feitos: {} });
        const err = rs.find((r) => r.error); await recarregar(); toast(err ? "Parte não foi apagada: " + err.error.message : "Dados apagados"); break; }
    }
  }
  function onChange(e) {
    if (!ativo()) return;
    const rev = e.target.closest("tr[data-rev]");
    if (rev && rev.closest("#calRev") && ui.cal.provas) { // revisão do calendário: guarda o que o aluno muda
      const p = ui.cal.provas[+rev.dataset.rev], k = e.target.dataset.k;
      if (p) { if (k === "ok") p.ok = e.target.checked; else if (k === "disc") { p.disciplina_id = e.target.value ? +e.target.value : null; if (p.disciplina_id == null) p.ok = false; else p.ok = true; rev.querySelector('[data-k="ok"]').checked = p.ok; }
        else if (k === "tipo") p.tipo = e.target.value; else if (k === "mod") p.modalidade = e.target.value; else if (k === "data") p.data = e.target.value; else if (k === "hora") p.hora = e.target.value || null; }
      return;
    }
    if (guardarDoc(e.target)) return;
    const b = e.target.closest("[data-a]"); if (!b || !noPainel(b)) return; const a = b.dataset.a;
    if (a === "upArq") { const fs = [...(b.files || [])]; if (fs.length) { ui.up.files = ui.up.files.concat(fs).slice(0, 30); } render(); return; }
    if (a === "upDisc") { ui.up.disc = +b.value; ui.up.modo = "arquivo"; ui.up.temaId = null; render(); return; }
    if (a === "upTema") { if (b.value === "arquivo" || b.value === "novo") { ui.up.modo = b.value; ui.up.temaId = null; } else { ui.up.modo = "existente"; ui.up.temaId = +b.value; } render(); if (ui.up.modo === "novo") document.getElementById("upTemaNome")?.focus(); return; }
    if (a === "calArq") { const f = b.files?.[0]; if (f) { ui.cal = { file: f, busy: false, msg: null, provas: null, doc: null }; render(); } return; }
    if (a === "relPick") { const q = qPool()[ui.qIdx]; if (q) { qSt(q).rel[+b.dataset.i] = b.value; render(); } return; }
    if (a === "lamTema") { ui.lamTema = b.value; ui.lamCur = null; render(); return; }
    if (a === "lamWrong") { ui.lamOnlyWrong = b.checked; ui.lamCur = null; render(); return; }
    if (a === "qDisc") { ui.qDisc = b.value; ui.qIdx = 0; ui.qAns = null; ui.qst = null; render(); }
    else if (a === "calcDisc") { ui.calcDisc = +b.value; render(); }
    else if (a === "genDisc") { ui.genDisc = +b.value; render(); }
    else if (a === "grade") { const v = num(b.value); if (b.value.trim() && v == null) { toast("Use só números (ex.: 15,5)."); return; } salvarNota(+b.dataset.id, b.dataset.k, v); }
  }
  // revisão do documento: guarda cada mudança (o painel redesenha e não pode perder o que o aluno mudou)
  function guardarDoc(el) {
    const d = ui.cal.doc; if (!d || !el?.dataset?.sec || !el.closest("#docRev")) return false;
    const it = d[el.dataset.sec]?.[+el.dataset.i]; if (!it) return false;
    const k = el.dataset.k;
    it[k] = el.type === "checkbox" ? el.checked : k === "disciplina_id" ? (el.value ? +el.value : null) : el.value;
    return true;
  }
  function onInput(e) {
    if (guardarDoc(e.target)) return;
    if (e.target && e.target.id === "disTxt" && ui.qst && ui.qst.id == e.target.dataset.qid) ui.qst.txt = e.target.value;
    if (e.target && e.target.id === "upTemaNome") ui.up.temaNome = e.target.value;
  }
  function onToggle(e) { if (e.target?.id === "cfg") ui.cfgOpen = e.target.open; if (e.target?.id === "lamGer") ui.lamGer = e.target.open; }
  async function onSubmit(e) {
    if (!ativo()) return;
    const f = e.target.closest("form[data-form]"); if (!f || !noPainel(f)) return; e.preventDefault();
    const fd = Object.fromEntries(new FormData(f)); const k = f.dataset.form;
    const btn = f.querySelector("button:not([type=button])"); if (btn) btn.disabled = true;
    const ins = async (tabela, linha) => { const { data, error } = await sb.from(tabela).insert(linha).select("*").single(); if (error) { toast("Não consegui salvar: " + error.message); return null; } return data; };
    try {
      if (k === "gen") return await gerarQuestoes(fd);
      if (k === "editSem" || k === "editSemAnt") return await salvarSemestre(f, k === "editSem");
      if (k === "addLam") return await addLamina(f);
      if (k === "addTopic") { const d = discById(ui.disc); const nome = String(fd.nome || "").trim(); if (!d || !nome) return;
        const t = await ins("temas", { disciplina_id: d.id, nome, prova: fd.prova || null, ordem: temasDe(d.id).length }); if (t) { S.temas.push(t); render(); document.getElementById("topicName")?.focus(); } }
      else if (k === "agDate" || k === "addProva") {
        const tipo = fd.tipo, modalidade = fd.mod === "pratica" ? "pratica" : "teorica", disc = +fd.disc;
        const campos = { data: fd.data, hora: fd.hora || null, ...(k === "addProva" ? { titulo: String(fd.titulo || "").trim() || null, pontos: num(fd.pontos) } : {}) };
        const ex = OFICIAL(tipo) && S.provas.find((p) => p.disciplina_id === disc && p.tipo === tipo && (p.modalidade || "teorica") === modalidade);
        if (ex) { if (await upd("provas", ex.id, campos)) { Object.assign(ex, campos); toast(`Data da ${provaNome(ex)} atualizada`); } }
        else { const p = await ins("provas", { disciplina_id: disc, tipo, modalidade, ...campos }); if (p) { S.provas.push(p); toast(k === "agDate" ? "Prova adicionada à agenda" : "Avaliação adicionada"); } }
        if (k === "addProva") ui.calDate = fd.data; render();
      }
      else if (k === "addPer") { const p = await ins("calendario", { nome: String(fd.nome).trim(), tipo: fd.tipo, inicio: fd.inicio, fim: fd.fim && fd.fim >= fd.inicio ? fd.fim : null }); if (p) { S.cal.push(p); render(); } }
      else if (k === "addAula") {
        if (hm(fd.fim) <= hm(fd.inicio)) return toast("O fim precisa ser depois do início.");
        if (!fd.disc && !String(fd.nome || "").trim()) return toast("Escolha a matéria ou escreva o nome da aula.");
        const s = await ins("horarios", { semestre_id: H.SEM().atual?.id ?? null, disciplina_id: fd.disc ? +fd.disc : null, nome: String(fd.nome || "").trim() || null, professor: String(fd.prof || "").trim() || null, dia: +fd.dia, inicio: fd.inicio, fim: fd.fim });
        if (s) { S.horarios.push(s); render(); toast("Aula adicionada"); } }
      else if (k === "addEv" || k === "addLiga" || k === "addHora") {
        const ed = ui.vEdit;
        const [tabela, lista, linha, et] = k === "addEv" ? ["vida_eventos", S.eventos, { nome: String(fd.nome).trim(), detalhe: String(fd.sub || "").trim() || null, data: fd.data }, "ev"]
          : k === "addLiga" ? ["ligas", S.ligas, { nome: String(fd.nome).trim(), papel: String(fd.papel || "").trim() || null }, "liga"]
          : ["horas_compl", S.horas, { categoria: fd.cat, descricao: String(fd.desc).trim(), horas: Math.max(0, num(fd.h) || 0) }, "hora"];
        if (ed && ed.t === et) { const it = lista.find((x) => x.id === ed.id); if (it && await upd(tabela, it.id, linha)) { Object.assign(it, linha); ui.vEdit = null; toast("Salvo"); } }
        else { const r = await ins(tabela, linha); if (r) lista.push(r); }
        render();
      }
      else if (k === "addDisc") {
        const nome = String(fd.nome || "").trim(); if (!nome) return;
        const r = await ins("disciplinas", { nome, professor: String(fd.professor || "").trim() || null, tem_pratica: !!fd.pratica, ordem: S.disc.length, ...(H.SEM().atual ? { semestre_id: H.SEM().atual.id } : {}) });
        if (r) { S.disc.push(r); ui.cfgOpen = true; render(); toast("Matéria adicionada"); }
      }
      else if (k === "editDisc") {
        const d = discById(f.dataset.id); const linha = { nome: String(fd.nome || "").trim(), professor: String(fd.professor || "").trim() || null, tem_pratica: !!fd.pratica };
        if (d && linha.nome && await upd("disciplinas", d.id, linha)) { Object.assign(d, linha); render(); toast("Matéria salva"); }
      }
    } finally { if (btn && document.contains(btn)) btn.disabled = false; }
  }
  function onKey(e) {
    if (!ativo()) return;
    if (e.key === "Escape" && ui.resumo) { fecharSheet(); return; }
    const n = e.target.closest && e.target.closest(".mmn");
    if (n && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); ui.mmCol = ui.mmCol || {}; ui.mmCol[n.dataset.p] = !ui.mmCol[n.dataset.p]; renderSheet(); document.querySelector(`.mmn[data-p="${n.dataset.p}"]`)?.focus(); }
  }
  let ouvindo = false;
  function ouvir() {
    if (ouvindo) return; ouvindo = true;
    document.addEventListener("click", onClick); document.addEventListener("change", onChange); document.addEventListener("input", onInput);
    document.addEventListener("submit", onSubmit); document.addEventListener("keydown", onKey); document.addEventListener("toggle", onToggle, true);
  }

  async function recarregar() {
    if (!ativo()) return;
    const tinha = !!S?.questoes;
    try { await carregar(); } catch (e) { toast("Não consegui atualizar: " + (e.message || e)); return; }
    if (tinha || ui.tab === "quest") await carregarQuestoes().catch(() => { });
    render();
  }

  function abrirTela(t) { if (!TELAS.includes(t)) return; fecharSheet(); ui.tab = t; if (t !== "config") ss.set("painel:tab", t); try { history.replaceState(null, "", "#" + t); } catch (_) { } render(); window.scrollTo(0, 0); }
  window.Painel = {
    ativo,
    abrir(t) { if (ativo() && S) abrirTela(t); },
    fechar() { if (S) { ui.resumo = null; ui.escolha = null; } const el = document.getElementById("sheet"); if (el) { el.hidden = true; el.innerHTML = ""; } document.body.style.overflow = ""; },
    async aoMudarDrive() { if (!ativo()) return; await recarregar(); },
    abrirTarefa(t) { if (ativo() && S) return abrirTarefa(t); },
    async iniciar(ganchos) {
      H = ganchos; V = ganchos.V; ouvir();
      if (!Painel._fila) { // uma vez: trabalhos da fila do navegador e avisos das tarefas
        Painel._fila = true;
        Tarefas.ouvir((lista) => aoTerminar(lista));
        let enviando = 0;
        Fila.ouvir(() => {
          const n = Fila.pendentes().filter((j) => j.tipo === "upload").length;
          if (enviando && !n) recarregarLogo(0); // a fila de envios acabou: atualiza já
          enviando = n;
          if (ativo() && S) { pintarUpProg(); if (ui.resumo) renderSheetSoon(); }
        });
      }
      const h = location.hash.slice(1); const salvo = ss.get("painel:tab");
      if (ganchos.tab && TELAS.includes(ganchos.tab)) ui.tab = ganchos.tab; else if (TELAS.includes(h)) ui.tab = h; else if (salvo && TELAS.includes(salvo)) ui.tab = salvo;
      V.onclick = null;
      V.innerHTML = `<div id="painel"><nav class="tabs" role="tablist" id="tabs" aria-label="Partes do painel">${TABS.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${k === ui.tab}">${l}</button>`).join("")}</nav>
        <div id="pview" class="view"><p class="muted" style="margin-top:20px">Carregando seu painel…</p></div><div id="pfixos" hidden>${fixosHTML()}</div><div id="pcfg"></div></div>`;
      Object.keys(fixosIni).forEach((k) => delete fixosIni[k]);
      try { await carregar(); } catch (e) { document.getElementById("pview").innerHTML = `<div class="msg bad">Não consegui carregar seu painel: ${esc(e.message || e)}</div>`; return; }
      render();
      // só depois de carregar: os trabalhos usam as matérias e os temas do painel
      Fila.registrar("upload", trabalhoUpload);
      Fila.registrar("material", trabalhoMaterial);
    },
  };
})();
