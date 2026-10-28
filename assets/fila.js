// Fila de trabalhos do navegador: ler arquivos (PDF, PowerPoint, Word, livros) e enviar o texto.
// Roda um trabalho por vez, sem travar a tela, enquanto o aluno usa o site. A fila fica guardada
// no IndexedDB deste navegador (com o arquivo): se o aluno fechar o site, ela continua quando ele
// abrir de novo NESTE aparelho. Sem IndexedDB (aba anônima, bloqueado), fica só na memória.
//
//   Fila.registrar(tipo, async (job, prog) => "mensagem final")   prog(frac 0..1 | null, "texto")
//   Fila.adicionar(tipo, titulo, dados, arquivo?) -> job          Fila.ouvir(fn)   Fila.lista()
//   Fila.iniciar(uid)   Fila.tirar(id)   Fila.salvar(job)  (guarda job.dados no meio do trabalho)
// Um handler pode lançar um Error com .st ("erro" | "sem_texto") e .pararTipo (falha os outros do mesmo tipo).
(function (g) {
  const BANCO = "painel-fila", LOJA = "jobs";
  const jobs = [];            // {id, uid, tipo, titulo, dados, arquivo, st, msg, frac, persistente, criado}
  const handlers = {}, ouvintes = new Set();
  let uid = null, idb = null, idbTentou = false, rodando = false, avisoRAF = 0;

  /* ---------- IndexedDB (tudo em try/catch: se falhar, a fila fica na memória) ---------- */
  function abrir() {
    if (idbTentou) return Promise.resolve(idb);
    idbTentou = true;
    return new Promise((ok) => {
      try {
        if (!g.indexedDB) return ok(null);
        const r = g.indexedDB.open(BANCO, 1);
        r.onupgradeneeded = () => { try { r.result.createObjectStore(LOJA, { keyPath: "id" }); } catch (_) { } };
        r.onsuccess = () => { idb = r.result; ok(idb); };
        r.onerror = () => ok(null);
        r.onblocked = () => ok(null);
      } catch (_) { ok(null); }
    });
  }
  function op(modo, fn) {
    return abrir().then((db) => new Promise((ok) => {
      if (!db) return ok(null);
      try {
        const tx = db.transaction(LOJA, modo), loja = tx.objectStore(LOJA);
        let res = null; const req = fn(loja);
        if (req) req.onsuccess = () => { res = req.result; };
        tx.oncomplete = () => ok(res ?? true);
        tx.onerror = tx.onabort = () => ok(null);
      } catch (_) { ok(null); }
    }));
  }
  const gravar = (j) => op("readwrite", (l) => l.put({ id: j.id, uid: j.uid, tipo: j.tipo, titulo: j.titulo, dados: j.dados, arquivo: j.arquivo || null, criado: j.criado }));
  const apagar = (id) => op("readwrite", (l) => l.delete(id));
  const todos = () => op("readonly", (l) => l.getAll());

  /* ---------- avisos para a tela ---------- */
  function avisar() {
    if (avisoRAF) return;
    const f = () => { avisoRAF = 0; ouvintes.forEach((fn) => { try { fn(lista()); } catch (e) { console.error(e); } }); };
    avisoRAF = g.requestAnimationFrame ? g.requestAnimationFrame(f) : setTimeout(f, 16);
  }
  const lista = () => jobs.slice();
  const pendentes = () => jobs.filter((j) => j.st === "fila" || j.st === "rodando");

  /* ---------- a fila ---------- */
  async function adicionar(tipo, titulo, dados, arquivo) {
    const j = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8), uid, tipo, titulo: String(titulo || "").slice(0, 200), dados: dados || {}, arquivo: arquivo || null,
      st: "fila", msg: "", frac: null, persistente: false, criado: Date.now() };
    jobs.push(j); avisar();
    j.persistente = !!(await gravar(j));
    avisar(); rodar();
    return j;
  }
  async function salvar(j) { if (j.persistente) j.persistente = !!(await gravar(j)); }
  async function tirar(id) {
    const j = jobs.find((x) => x.id === id); if (!j || j.st === "rodando") return false;
    jobs.splice(jobs.indexOf(j), 1); await apagar(id); avisar(); return true;
  }
  function limparFeitos() { for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].st !== "fila" && jobs[i].st !== "rodando") jobs.splice(i, 1); avisar(); }

  async function rodar() {
    if (rodando || !uid) return;
    rodando = true;
    try {
      for (;;) {
        const j = jobs.find((x) => x.st === "fila" && handlers[x.tipo]);
        if (!j) break;
        j.st = "rodando"; j.msg = "Começando…"; j.frac = 0; avisar();
        const prog = (frac, msg) => { j.frac = frac; if (msg) j.msg = msg; avisar(); };
        try {
          const fim = await handlers[j.tipo](j, prog);
          j.st = "ok"; j.msg = typeof fim === "string" ? fim : "Pronto."; j.frac = null;
        } catch (e) {
          j.st = e && e.st === "sem_texto" ? "sem_texto" : "erro"; j.msg = (e && e.message) || String(e); j.frac = null;
          if (e && e.pararTipo) jobs.filter((x) => x.st === "fila" && x.tipo === j.tipo).forEach((x) => { x.st = "erro"; x.msg = "Não enviado."; apagar(x.id); });
        }
        j.arquivo = null; // o arquivo sai da memória e do aparelho
        await apagar(j.id); avisar();
        await new Promise((ok) => setTimeout(ok, 0)); // devolve a vez para a tela
      }
    } finally { rodando = false; }
  }
  /** Depois do login: recupera o que ficou na fila deste aparelho (só deste aluno) e começa. */
  async function iniciar(id) {
    if (uid === id) { rodar(); return; }
    uid = id;
    const salvos = (await todos()) || [];
    for (const s of salvos.sort((a, b) => a.criado - b.criado)) {
      if (s.uid !== uid || jobs.some((x) => x.id === s.id)) continue;
      jobs.push({ ...s, st: "fila", msg: "Continuando de onde parou…", frac: null, persistente: true, retomado: true });
    }
    avisar(); rodar();
  }
  function registrar(tipo, fn) { handlers[tipo] = fn; rodar(); }
  function ouvir(fn) { ouvintes.add(fn); return () => ouvintes.delete(fn); }
  // trabalho só na memória (sem IndexedDB) e ainda não feito: avisa antes de fechar a página
  g.addEventListener && g.addEventListener("beforeunload", (e) => { if (pendentes().some((j) => !j.persistente)) { e.preventDefault(); e.returnValue = ""; } });

  g.Fila = { registrar, adicionar, salvar, tirar, limparFeitos, iniciar, ouvir, lista, pendentes };
})(window);
