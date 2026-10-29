// Funções compartilhadas entre as páginas.
(function () {
  const C = window.APP_CONFIG;
  // Vigia as respostas do banco: 401 em /rest/v1 ou /storage/v1 quer dizer que o pedido foi sem login válido
  // (o PostgREST responde 401 a "permission denied" quando o pedido vai como anônimo, e a "JWT expired").
  // Aí confere a sessão (e mostra o aviso "Sua sessão terminou" se ela acabou mesmo).
  const fetchVigiado = async (input, init) => {
    const res = await fetch(input, init);
    try {
      if (res.status === 401 && SESS.ligado && !SESS.fim && !SESS.saindo) {
        const url = typeof input === "string" ? input : (input && input.url) || "";
        if (/\/(rest|storage)\/v1\//.test(url)) setTimeout(() => conferirSessao(true, "http_401"), 0);
      }
    } catch (_) { }
    return res;
  };
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: fetchVigiado },
  });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function toast(m) {
    // erro de sessão cru ("permission denied for table ...", "JWT expired") vira a frase simples e confere a sessão
    if (erroDeSessao(m)) { m = MSG_FIM; conferirSessao(true, "erro_na_tela"); }
    const t = document.createElement("div"); t.className = "toast"; t.textContent = m;
    document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
  }
  const hoje = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const isoHoje = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  function acessoOk(p) { return !!p && p.ativo && (!p.vence_em || p.vence_em >= isoHoje()); }
  async function sessao() { const { data } = await sb.auth.getSession(); return data.session; }
  async function meuPerfil() {
    const s = await sessao(); if (!s) return null;
    const { data, error } = await sb.from("perfis").select("*").eq("id", s.user.id).single();
    if (error) throw error; return data;
  }
  // "local": sai só deste navegador. O padrão do Supabase ("global") derrubava o login em todas as outras abas e aparelhos.
  async function sair() { SESS.saindo = true; try { await sb.auth.signOut({ scope: "local" }); } catch (_) { } location.href = "/"; }
  function win(title, body) {
    return `<section class="win"><div class="win-bar"><span class="dots"><i></i><i></i><i></i></span>${esc(title)}</div><div class="win-body">${body}</div></section>`;
  }
  // Turma (sala): só letras de A a Z, maiúsculas, até 2 (ex.: "F"). O banco confere igual (08_tarefas.sql).
  const limparTurma = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);
  const campoTurma = (name, valor, id) => `<input name="${esc(name)}"${id ? ` id="${esc(id)}"` : ""} value="${esc(limparTurma(valor))}" maxlength="2" inputmode="text" autocapitalize="characters" autocomplete="off" autocorrect="off" spellcheck="false" pattern="[A-Za-z]{0,2}" placeholder="Ex.: F" data-turma aria-label="Turma (só a letra)">`;
  document.addEventListener("input", (e) => {
    const el = e.target; if (!el || !el.matches || !el.matches("input[data-turma]")) return;
    const v = limparTurma(el.value); if (v !== el.value) el.value = v;
  });

  /* ================= SESSÃO: quando o login acaba, o site avisa (em vez de seguir como anônimo) ================= */
  // Antes: se o login vencia (computador dormindo, aba parada, saída em outra aba, falha ao renovar), a página
  // continuava mostrando os dados e cada ação dava um erro estranho ("permission denied for table ...",
  // "Sessão inválida"). Agora: ouvimos o Supabase (onAuthStateChange), conferimos a sessão quando a página volta
  // a aparecer e a cada 4 minutos, e mostramos um aviso fixo com o botão "Entrar de novo".
  const MSG_FIM = "Sua sessão terminou. Entre de novo para continuar.";
  const SESS = { ligado: false, fim: false, saindo: false, conferindo: null, ultima: 0, ouvintes: new Set() };
  const RE_SESSAO = /permission denied for (table|schema|relation|sequence|function)|jwt expired|invalid jwt|jwt (is )?malformed|PGRST30[0-3]|sess[aã]o inv[aá]lida|fa[cç]a login de novo|sua sess[aã]o terminou/i;
  /** O erro (ou texto) é de sessão vencida / pedido sem login? */
  function erroDeSessao(e) {
    if (!e) return false;
    if (typeof e === "string") return RE_SESSAO.test(e);
    return e.sessao === true || e.status === 401 || RE_SESSAO.test(`${e.message || ""} ${e.code || ""} ${e.erro || ""}`);
  }
  /** Mensagem para o aluno: erro de sessão vira a frase simples; o resto, a mensagem do erro */
  const msgErro = (e) => erroDeSessao(e) ? MSG_FIM : (e && (e.message || e.erro)) || String(e || "");
  const redeFora = (e) => (typeof navigator !== "undefined" && navigator.onLine === false) || !!e && (e.name === "AuthRetryableFetchError" || /failed to fetch|network|load failed|fetch failed/i.test(e.message || ""));
  const sessaoAcabou = () => SESS.fim;
  // Nunca sai da conta sozinho. Só volta para a tela de entrada se o navegador realmente não tem mais login
  // (getSession vazio). Qualquer outro problema (servidor recusou, permissão) vira mensagem, sem tirar o aluno.
  function sessaoTerminou(motivo) {
    if (SESS.fim || SESS.saindo) return;
    console.warn("[sessão] suspeita:", motivo);
    try { localStorage.setItem("painel:sessaoMotivo", JSON.stringify({ motivo: String(motivo || ""), em: new Date().toISOString() })); } catch (_) { }
    (async () => {
      let s = null;
      try { const r = await sb.auth.getSession(); s = r && r.data && r.data.session; } catch (_) { return; }
      if (s) { console.warn("[sessão] continua valendo; nada a fazer"); return; }
      SESS.fim = true;
      try { window.Fila && Fila.pausar && Fila.pausar(); } catch (_) { }
      SESS.ouvintes.forEach((fn) => { try { fn(motivo); } catch (_) { } });
      location.href = "/?sessao=1&m=" + encodeURIComponent(String(motivo || "").slice(0, 40));
    })();
  }
  /** Confere se a sessão ainda vale (forcar: renova o token agora). Devolve true se está tudo bem. */
  function conferirSessao(forcar, motivo) {
    if (!SESS.ligado || SESS.fim || SESS.saindo) return Promise.resolve(!SESS.fim);
    if (SESS.conferindo) return SESS.conferindo;
    if (!forcar && Date.now() - SESS.ultima < 20000) return Promise.resolve(true);
    SESS.conferindo = (async () => {
      try {
        const { data, error } = await sb.auth.getSession();
        if (error && redeFora(error)) return true; // sem internet: não dá para saber; tenta de novo depois
        const s = data && data.session;
        if (!s) { sessaoTerminou(motivo || "sem_sessao"); return false; }
        const falta = (s.expires_at || 0) * 1000 - Date.now();
        if (forcar || falta < 0) {
          const r = await sb.auth.refreshSession();
          if (r.error || !r.data || !r.data.session) {
            if (redeFora(r.error)) return true;
            sessaoTerminou(motivo || "renovar_falhou"); return true;
          }
        }
        SESS.ultima = Date.now(); return true;
      } catch (e) { if (!redeFora(e)) console.warn("[sessão] não consegui conferir:", e && e.name); return true; }
      finally { SESS.conferindo = null; }
    })();
    return SESS.conferindo;
  }
  /** Liga a vigia da sessão (app.html e admin.html, depois do login). Uma vez por página. */
  function guardarSessao() {
    if (SESS.ligado) return; SESS.ligado = true; SESS.ultima = Date.now();
    if (sb.auth && typeof sb.auth.onAuthStateChange === "function") {
      // não chamar o Supabase dentro deste callback (trava o cliente): só anota e agenda
      sb.auth.onAuthStateChange((evento, s) => {
        console.warn("[sessão] evento:", evento);
        if (evento === "SIGNED_OUT") { if (!SESS.saindo) setTimeout(() => sessaoTerminou("SIGNED_OUT"), 0); return; }
        if (s && (evento === "TOKEN_REFRESHED" || evento === "SIGNED_IN" || evento === "USER_UPDATED")) SESS.ultima = Date.now();
      });
    }
    const aoVoltar = () => { if (document.visibilityState !== "hidden") conferirSessao(false, "voltou"); };
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("focus", aoVoltar);
    window.addEventListener("online", () => conferirSessao(false, "voltou_internet"));
    setInterval(() => { if (document.visibilityState !== "hidden") conferirSessao(false, "intervalo"); }, 4 * 60 * 1000);
  }
  const aoTerminarSessao = (fn) => { SESS.ouvintes.add(fn); return () => SESS.ouvintes.delete(fn); };
  /** Vai sair de propósito (botão Sair, conta excluída): o aviso de sessão não aparece */
  const vaiSair = () => { SESS.saindo = true; };

  /* ================= FUNÇÕES DO SERVIDOR (Edge Functions) ================= */
  // Todas as chamadas passam por aqui. Se o servidor recusar o login (401, "Sessão inválida", "Faça login de novo"),
  // renova a sessão uma vez e tenta de novo; se ainda falhar, mostra o aviso "Sua sessão terminou".
  // Devolve { data, error, corpo, status }: corpo = o JSON da resposta de erro (ex.: { erro: "..." }).
  async function invocar(nome, body, opcoes) {
    let renovou = false;
    for (;;) {
      const r = await sb.functions.invoke(nome, { body, ...(opcoes || {}) });
      const ctx = r.error && r.error.context;
      const status = ctx && typeof ctx.status === "number" ? ctx.status : r.error ? 0 : 200;
      let corpo = null;
      if (ctx && typeof ctx.json === "function") { try { corpo = await (typeof ctx.clone === "function" ? ctx.clone() : ctx).json(); } catch (_) { } }
      const msg = String((corpo && (corpo.erro || corpo.message || corpo.msg)) || (r.data && r.data.erro) || "");
      const semSessao = status === 401 || (msg && RE_SESSAO.test(msg));
      if (!semSessao || SESS.saindo) return { data: r.data, error: r.error, corpo, status };
      console.warn("[sessão] a função", nome, "recusou o login", status || "");
      if (!renovou) {
        renovou = true;
        let rf; try { rf = await sb.auth.refreshSession(); } catch (e) { rf = { error: e }; }
        if (!rf.error && rf.data && rf.data.session) { SESS.ultima = Date.now(); continue; }
        if (redeFora(rf.error)) return { data: null, error: new Error("Sem conexão com o servidor. Confira a internet e tente de novo."), corpo: { erro: "Sem conexão com o servidor. Confira a internet e tente de novo." }, status: 0 };
      }
      sessaoTerminou("funcao_" + nome); // só volta para a entrada se o navegador não tiver mais login
      const m2 = "O servidor não aceitou seu login agora. Tente de novo em instantes; se continuar, saia e entre de novo.";
      return { data: null, error: new Error(m2), corpo: { erro: m2 }, status: 401 };
    }
  }
  /** Chama a função e devolve o data; erro vira Error com a mensagem do servidor (e.generico se ele não respondeu) */
  async function chamar(nome, body) {
    const { data, error, corpo, sessao: semLogin } = await invocar(nome, body);
    let erro = data && data.erro, generico = false;
    if (!erro && error) { erro = corpo && corpo.erro; if (!erro) { erro = "O servidor não respondeu. Tente de novo."; generico = true; } }
    if (erro) { const e = new Error(erro); e.generico = generico; if (semLogin) e.sessao = true; throw e; }
    return data;
  }

  window.App = { sb, esc, toast, hoje, isoHoje, acessoOk, sessao, meuPerfil, sair, win, C, limparTurma, campoTurma,
    guardarSessao, conferirSessao, sessaoAcabou, aoTerminarSessao, vaiSair, erroDeSessao, msgErro, invocar, chamar, MSG_FIM };
})();
