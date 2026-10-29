// Edge Function: drive-oauth
// "Entrar com o Google": o aluno autoriza o site a LER o Drive dele (só leitura).
//
// IMPORTANTE: publique esta função com "Verify JWT" DESLIGADO.
// O Google volta para cá com um GET sem login do Supabase; por isso a própria função
// confere o login do aluno nos pedidos POST (vindos do site).
//
//   POST {acao:"url"}          -> {url}  endereço da tela de permissão do Google
//   POST {acao:"desconectar"}  -> {ok}   apaga a conexão e a pasta ligada por ela
//   GET  ?code=...&state=...   -> volta do Google: guarda a conexão e manda o aluno de volta ao site
//
// Segredos usados (Edge Functions → Secrets): GOOGLE_OAUTH_SECRET e GOOGLE_OAUTH_CLIENT_ID.
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY o Supabase já fornece.
import { createClient } from "npm:@supabase/supabase-js@2.79.0";

const SITE = (Deno.env.get("SITE_URL") || "https://painel-estudos-evg.pages.dev").replace(/\/+$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const REDIRECT_URI = `${SUPABASE_URL.replace(/\/+$/, "")}/functions/v1/drive-oauth`;
const ESCOPO = "https://www.googleapis.com/auth/drive.readonly";
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? Deno.env.get("OOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_SECRET") ?? "";

function cors(req: Request) {
  const o = req.headers.get("Origin") || "";
  const ok = o === SITE || /^https:\/\/[a-z0-9-]+\.painel-estudos-evg\.pages\.dev$/.test(o) || /^http:\/\/localhost(:\d+)?$/.test(o);
  return {
    "Access-Control-Allow-Origin": ok ? o : SITE,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
const voltar = (resultado: string) =>
  new Response(null, { status: 302, headers: { Location: `${SITE}/app.html#drive=${resultado}`, "Cache-Control": "no-store" } });

// ---------- utilidades de criptografia ----------
const te = new TextEncoder();
const td = new TextDecoder();
function b64url(bytes: Uint8Array): string {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function deB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
async function chaveHmac() {
  return await crypto.subtle.importKey("raw", te.encode("state:" + CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function chaveAes() {
  const raw = await crypto.subtle.digest("SHA-256", te.encode(CLIENT_SECRET));
  return await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function cifrar(texto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chaveAes(), te.encode(texto)));
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}
async function decifrar(guardado: string): Promise<string> {
  const [v, iv, ct] = guardado.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("formato");
  return td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64url(iv).buffer as ArrayBuffer }, await chaveAes(), deB64url(ct).buffer as ArrayBuffer));
}
async function assinarState(uid: string): Promise<string> {
  const payload = b64url(te.encode(JSON.stringify({ uid, exp: Date.now() + 10 * 60 * 1000, n: b64url(crypto.getRandomValues(new Uint8Array(12))) })));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await chaveHmac(), te.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}
// crypto.subtle.verify compara a assinatura em tempo constante
async function lerState(state: string): Promise<string | null> {
  const [payload, sig] = String(state || "").split(".");
  if (!payload || !sig || payload.length > 600 || sig.length > 100) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await chaveHmac(), deB64url(sig).buffer as ArrayBuffer, te.encode(payload));
    if (!ok) return null;
    const d = JSON.parse(td.decode(deB64url(payload)));
    if (typeof d.uid !== "string" || !/^[0-9a-f-]{36}$/i.test(d.uid) || typeof d.exp !== "number" || d.exp < Date.now()) return null;
    return d.uid;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const admin = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // ================= volta do Google (GET) =================
  if (req.method === "GET") {
    const u = new URL(req.url);
    if (u.searchParams.get("error")) return voltar(u.searchParams.get("error") === "access_denied" ? "negado" : "erro");
    const code = u.searchParams.get("code") || "";
    const uid = await lerState(u.searchParams.get("state") || "");
    if (!uid || !code || code.length > 2000) return voltar("expirou");
    if (!CLIENT_ID || !CLIENT_SECRET) return voltar("erro");

    let tok: Record<string, unknown> = {};
    try {
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
        signal: AbortSignal.timeout(15000),
      });
      tok = await r.json().catch(() => ({}));
      if (!r.ok) { console.error("troca do code falhou:", r.status, tok.error); return voltar("erro"); }
    } catch (e) { console.error("troca do code falhou:", (e as Error).name); return voltar("erro"); }

    const escopos = String(tok.scope || "").split(/\s+/);
    if (!escopos.includes(ESCOPO) && !escopos.includes("https://www.googleapis.com/auth/drive")) return voltar("sem_permissao");
    const refresh = typeof tok.refresh_token === "string" ? tok.refresh_token : "";
    if (!refresh) return voltar("erro");

    const { data: perfil } = await admin.from("perfis").select("id").eq("id", uid).maybeSingle();
    if (!perfil) return voltar("erro");
    const r1 = await admin.from("drive_tokens").upsert({ aluno_id: uid, refresh_token: await cifrar(refresh), atualizado_em: new Date().toISOString() });
    if (r1.error) { console.error("drive_tokens:", r1.error.message); return voltar("erro"); }
    // mantém a pasta que já estava ligada (se houver); só volta o status para "pendente"
    const r2 = await admin.from("drive_fontes").upsert({ aluno_id: uid, tipo: "google", status: "pendente", erro: null }, { onConflict: "aluno_id,tipo" });
    if (r2.error) { console.error("drive_fontes:", r2.error.message); return voltar("erro"); }
    return voltar("conectado");
  }

  if (req.method !== "POST") return json(req, { erro: "Método não permitido" }, 405);

  // ================= pedidos do site (POST, aluno logado) =================
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json(req, { erro: "Faça login de novo." }, 401);
  const { data: quem, error: eQuem } = await admin.auth.getUser(token);
  if (eQuem || !quem?.user) return json(req, { erro: "Sessão inválida. Faça login de novo." }, 401);
  const uid = quem.user.id;
  const { data: perfil } = await admin.from("perfis").select("ativo, vence_em").eq("id", uid).maybeSingle();
  const hoje = new Date().toISOString().slice(0, 10);
  if (!perfil?.ativo || (perfil.vence_em && perfil.vence_em < hoje)) return json(req, { erro: "Seu acesso não está liberado ou venceu." }, 403);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { erro: "Pedido inválido." }, 400); }

  if (b.acao === "url") {
    if (!CLIENT_ID || !CLIENT_SECRET) return json(req, { erro: "A conexão com o Google ainda não foi configurada no servidor." }, 500);
    const p = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: ESCOPO,
      access_type: "offline",
      prompt: "select_account consent", // deixa o aluno escolher a conta do Google
      include_granted_scopes: "true",
      state: await assinarState(uid),
    });
    return json(req, { url: "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString() });
  }

  if (b.acao === "desconectar") {
    const { data: t } = await admin.from("drive_tokens").select("refresh_token").eq("aluno_id", uid).maybeSingle();
    if (t?.refresh_token) {
      try {
        const rt = await decifrar(t.refresh_token);
        await fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: rt }), signal: AbortSignal.timeout(10000),
        });
      } catch { /* se não der para revogar, apaga mesmo assim */ }
    }
    const r1 = await admin.from("drive_tokens").delete().eq("aluno_id", uid);
    const r2 = await admin.from("drive_fontes").delete().eq("aluno_id", uid).eq("tipo", "google"); // apaga os materiais junto
    if (r1.error || r2.error) return json(req, { erro: "Não consegui desconectar. Tente de novo." }, 500);
    return json(req, { ok: true });
  }

  return json(req, { erro: "Ação desconhecida." }, 400);
});
