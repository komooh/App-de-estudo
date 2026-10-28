// Funções compartilhadas entre as páginas.
(function () {
  const C = window.APP_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function toast(m) {
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
  async function sair() { await sb.auth.signOut(); location.href = "/"; }
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
  window.App = { sb, esc, toast, hoje, isoHoje, acessoOk, sessao, meuPerfil, sair, win, C, limparTurma, campoTurma };
})();
