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
  window.App = { sb, esc, toast, hoje, isoHoje, acessoOk, sessao, meuPerfil, sair, win, C };
})();
