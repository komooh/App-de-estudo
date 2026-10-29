// Tarefas: o que está rodando para o aluno, num painel aberto pelo botão "Tarefas" no alto.
// - tarefas da IA no servidor (tabela tarefas, 08_tarefas.sql): resumo, mapa, questões, calendário.
//   Continuam mesmo com o site fechado. O site pergunta a cada 5 s só enquanto algo está rodando.
// - a fila do navegador (assets/fila.js): ler e enviar arquivos e livros. Continua quando o aluno
//   abrir o site de novo neste aparelho.
// Quando algo fica pronto aparece um aviso ("Seu resumo de X ficou pronto").
(function () {
  const { sb, esc, toast } = App;
  let H = null, T = [], ativo = false, timer = 0, aberto = false, primeira = true, pausado = false;
  const anterior = new Map(); const ouvintes = new Set();
  const RODANDO = (s) => s === "na_fila" || s === "rodando";
  const ls = { get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } } };
  let avisadasMem = null;
  const avisadas = () => avisadasMem || (avisadasMem = new Set(ls.get("tarefas:avisadas") || []));
  function marcarAvisada(id) { const s = avisadas(); s.add(id); ls.set("tarefas:avisadas", [...s].slice(-100)); }

  const nomeDe = (t) => String(t.resultado?.tema || t.titulo.replace(/^(Resumo|Mapa mental|Flash cards|Painel do tema|\d+ quest(ão|ões)):\s*/i, "") || t.titulo);
  function frasePronta(t) {
    if (t.status === "erro") return `Não deu certo: ${t.titulo}. Abra Tarefas para tentar de novo.`;
    if (t.tipo === "resumo") return `Seu resumo de ${nomeDe(t)} ficou pronto`;
    if (t.tipo === "mapa") return `Seu mapa mental de ${nomeDe(t)} ficou pronto`;
    if (t.tipo === "questoes") return `Suas questões de ${nomeDe(t)} ficaram prontas`;
    if (t.tipo === "flashcards") return `Seus flash cards de ${nomeDe(t)} ficaram prontos`;
    if (t.tipo === "painel") return `Seu painel de ${nomeDe(t)} ficou pronto`;
    const doc = String(t.titulo || "").replace(/^Documento:\s*/, "");
    return `A leitura de ${doc || "documento"} ficou pronta: confira em Configurações`;
  }

  /* ---------- servidor ---------- */
  async function buscar() {
    const { data, error } = await sb.rpc("minhas_tarefas", { p_limite: 30 });
    if (error) { if (!/minhas_tarefas|Could not find|does not exist/i.test(error.message)) console.warn("tarefas:", error.message); return; }
    T = data || [];
    const novas = [];
    for (const t of T) {
      const antes = anterior.get(t.id);
      const terminou = (t.status === "pronta" || t.status === "erro") && (antes ? RODANDO(antes) : primeira && !avisadas().has(t.id));
      if (terminou) novas.push(t);
      anterior.set(t.id, t.status);
    }
    primeira = false;
    if (novas.length) {
      novas.forEach((t) => marcarAvisada(t.id));
      toast(novas.length > 2 ? `${novas.length} tarefas terminaram. Veja em Tarefas.` : novas.map(frasePronta).join(" · "));
      ouvintes.forEach((fn) => { try { fn(novas); } catch (e) { console.error(e); } });
    }
    pintar();
    agendar();
  }
  function agendar() {
    clearTimeout(timer); timer = 0;
    if (!ativo || pausado) return;
    if (T.some((t) => RODANDO(t.status))) timer = setTimeout(buscar, 5000);
  }
  /** Cria uma tarefa da IA no servidor ({acao, ...}); devolve {tarefa_id}. */
  async function criar(corpo) {
    const r = await H.chamar("ia", { ...corpo, fundo: true });
    if (r?.tarefa_id && !T.some((t) => t.id === r.tarefa_id)) {
      T.unshift({ id: r.tarefa_id, tipo: corpo.acao, status: "na_fila", titulo: r.titulo || "", tema_id: corpo.tema_id ?? null, resultado: null, erro: null, criado_em: new Date().toISOString() });
      anterior.set(r.tarefa_id, "na_fila");
    }
    pintar(); agendar();
    return r;
  }
  async function vista(ids) {
    ids = ids.filter(Boolean); if (!ids.length) return;
    T.forEach((t) => { if (ids.includes(t.id) && !RODANDO(t.status)) t.status = "vista"; }); pintar();
    await sb.rpc("tarefa_vista", { p_ids: ids });
  }
  async function repetir(id) {
    try { await H.chamar("ia", { acao: "repetir", tarefa_id: id }); toast("Tentando de novo"); }
    catch (e) { toast(e.message || "Não consegui tentar de novo."); }
    await buscar();
  }
  /** Tarefa da IA ainda rodando para este tema (resumo/mapa) */
  const rodandoPara = (tipo, temaId) => T.find((t) => t.tipo === tipo && RODANDO(t.status) && Number(t.tema_id) === Number(temaId));

  /* ---------- tela ---------- */
  const ST = { na_fila: ["", "na fila"], rodando: ["s-warn", "rodando"], pronta: ["s-ok", "pronta"], vista: ["", "vista"], erro: ["s-bad", "erro"] };
  const STF = { fila: ["", "na fila"], rodando: ["s-warn", "lendo"], ok: ["s-ok", "pronto"], sem_texto: ["s-warn", "sem texto"], erro: ["s-bad", "erro"] };
  const quando = (s) => { const d = new Date(s), min = Math.round((Date.now() - d) / 60000); return min < 1 ? "agora" : min < 60 ? `há ${min} min` : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); };
  function contagem() {
    const f = Fila.pendentes().length;
    return { rodando: T.filter((t) => RODANDO(t.status)).length + f, prontas: T.filter((t) => t.status === "pronta" || t.status === "erro").length };
  }
  function pintarBotao() {
    const b = document.getElementById("tarefasBtn"); if (!b) return;
    const c = contagem(), n = c.rodando + c.prontas;
    b.hidden = !ativo;
    b.classList.toggle("tem", n > 0); b.classList.toggle("rodando", c.rodando > 0);
    const badge = b.querySelector(".tarefas-n"); if (badge) { badge.textContent = n > 99 ? "99+" : String(n); badge.hidden = !n; }
    b.setAttribute("aria-label", `Tarefas${c.rodando ? `: ${c.rodando} rodando` : ""}${c.prontas ? `, ${c.prontas} para ver` : ""}`);
  }
  function itemServidor(t) {
    const [cls, txt] = ST[t.status] || ["", t.status];
    const acoes = t.status === "erro" ? `<button class="btn" data-tf="repetir" data-id="${t.id}">Tentar de novo</button><button class="btn ghost" data-tf="dispensar" data-id="${t.id}">Dispensar</button>`
      : t.status === "pronta" || t.status === "vista" ? `<button class="btn ${t.status === "pronta" ? "solid" : ""}" data-tf="abrir" data-id="${t.id}">${t.tipo === "calendario" ? "Conferir" : "Abrir"}</button>` : "";
    const sub = RODANDO(t.status) ? "A IA está trabalhando no servidor. Pode sair do site: continua sozinho."
      : t.status === "erro" ? (t.erro || "Não deu certo.")
      : t.tipo === "flashcards" && t.resultado ? `${t.resultado.salvos} flash cards novos`
      : t.tipo === "questoes" && t.resultado ? `${t.resultado.salvas} de ${t.resultado.pedidas} questões${t.resultado.aviso ? ` (${t.resultado.aviso})` : ""}`
      : t.tipo === "calendario" && t.resultado ? ((t.resultado.provas || []).length ? `${t.resultado.provas.length} prova(s) para conferir. Nada é salvo antes de você confirmar.` : (t.resultado.aviso || "Nenhuma prova encontrada."))
      : t.resultado?.truncado ? "Ficou incompleto por limite de tamanho." : "";
    return `<li class="tf-item"><div class="tf-txt"><b>${esc(t.titulo || t.tipo)}</b><span class="muted">${esc(quando(t.criado_em))}${sub ? " · " + esc(sub) : ""}</span></div>
      <div class="tf-acoes"><span class="chip ${cls}">${esc(txt)}</span>${acoes}</div></li>`;
  }
  function itemFila(j) {
    const [cls, txt] = STF[j.st] || ["", j.st];
    const pend = j.st === "fila" || j.st === "rodando";
    return `<li class="tf-item"><div class="tf-txt"><b>${esc(j.titulo)}</b><span class="muted">${esc(j.msg || (j.st === "fila" ? "Esperando a vez." : ""))}</span>
      ${j.st === "rodando" && j.frac != null ? `<progress max="100" value="${Math.round(j.frac * 100)}"></progress>` : ""}
      ${pend ? `<span class="tf-nota">${j.persistente ? "Continua quando você abrir o site de novo neste aparelho." : "Deixe o site aberto até terminar (este navegador não guarda a fila)."}</span>` : ""}</div>
      <div class="tf-acoes"><span class="chip ${cls}">${esc(txt)}</span>${j.st === "fila" ? `<button class="x" data-tf="tirar" data-id="${esc(j.id)}" aria-label="Tirar ${esc(j.titulo)} da fila">×</button>` : ""}</div></li>`;
  }
  function pintar() {
    pintarBotao();
    const el = document.getElementById("tarefasPainel"); if (!el) return;
    el.hidden = !aberto;
    if (!aberto) return;
    const F = Fila.lista().slice().reverse();
    const vis = T.filter((t) => t.status !== "vista").concat(T.filter((t) => t.status === "vista").slice(0, 8));
    el.innerHTML = `<div class="tf-cab"><b>Tarefas</b><button class="x" data-tf="fechar" aria-label="Fechar tarefas">×</button></div>
      <div class="tf-corpo">
      ${F.length ? `<h3>Arquivos (neste aparelho)</h3><ul class="tf-lista">${F.map(itemFila).join("")}</ul>${F.some((j) => !(j.st === "fila" || j.st === "rodando")) ? `<button class="lnk" data-tf="limparFila">Limpar os terminados</button>` : ""}` : ""}
      <h3>IA (no servidor)</h3>
      ${vis.length ? `<ul class="tf-lista">${vis.map(itemServidor).join("")}</ul>` : `<p class="muted" style="margin:0">Nada por aqui. Quando você pedir um resumo, mapa, questões ou importar o calendário, a tarefa aparece aqui e você pode usar o resto do site enquanto ela roda.</p>`}
      </div>`;
  }
  function abrirPainel(v) {
    aberto = v ?? !aberto; pintar();
    document.getElementById("tarefasBtn")?.setAttribute("aria-expanded", String(aberto));
    if (aberto) { buscar(); document.querySelector("#tarefasPainel [data-tf=fechar]")?.focus(); }
  }
  async function onClick(e) {
    if (e.target.closest("#tarefasBtn")) { abrirPainel(); return; }
    const b = e.target.closest("[data-tf]");
    if (!b) { if (aberto && !e.target.closest("#tarefasPainel, [data-abre-tarefas]")) abrirPainel(false); return; }
    const id = b.dataset.id, a = b.dataset.tf;
    if (a === "fechar") return abrirPainel(false);
    if (a === "tirar") { await Fila.tirar(id); return pintar(); }
    if (a === "limparFila") { Fila.limparFeitos(); return pintar(); }
    const t = T.find((x) => x.id == id); if (!t) return;
    if (a === "repetir") { b.disabled = true; return repetir(t.id); }
    if (a === "dispensar") return vista([t.id]);
    if (a === "abrir") { abrirPainel(false); vista([t.id]); H.aoAbrir && H.aoAbrir(t); }
  }

  window.Tarefas = {
    /** Depois do login (app.html): {chamar, aoAbrir(tarefa)} */
    iniciar(ganchos) {
      H = { ...(H || {}), ...ganchos };
      if (!ativo) {
        ativo = true;
        document.addEventListener("click", onClick);
        document.addEventListener("keydown", (e) => { if (e.key === "Escape" && aberto) abrirPainel(false); });
        document.addEventListener("visibilitychange", () => { pausado = document.hidden; if (!pausado) buscar(); else agendar(); });
        Fila.ouvir(() => pintar());
        if (!document.getElementById("tarefasPainel")) { const el = document.createElement("div"); el.id = "tarefasPainel"; el.className = "tf-painel"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Tarefas"); document.body.appendChild(el); }
      }
      pintar(); buscar();
    },
    criar, buscar, vista, repetir, rodandoPara,
    lista: () => T.slice(),
    ouvir(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); },
    abrir: () => abrirPainel(true),
  };
})();
