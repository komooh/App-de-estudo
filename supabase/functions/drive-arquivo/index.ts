// Edge Function: drive-arquivo
// Entrega ao navegador do aluno o arquivo (PDF, Word, PowerPoint) de um material DELE no Drive,
// para o próprio navegador tirar o texto (a função não lê o arquivo: o limite de CPU é curto).
// Depois o navegador grava o texto com salvar_texto_material() (06_estudo.sql).
//
// IMPORTANTE: publique com "Verify JWT" DESLIGADO. A própria função confere o login do aluno.
//
//   POST {material_id}  -> os bytes do arquivo (até 25 MB), ou {erro} em JSON
//
// Segredos usados: GOOGLE_SA_KEY (pasta compartilhada), GOOGLE_OAUTH_SECRET e GOOGLE_OAUTH_CLIENT_ID
// (conexão "Entrar com o Google"). SUPABASE_* o Supabase já fornece.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.79.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? Deno.env.get("OOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_SECRET") ?? "";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const ESCOPO = "https://www.googleapis.com/auth/drive.readonly";
const MAX_BYTES = 25 * 1024 * 1024;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "x-tipo",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const TIPOS: Record<string, string> = {
  "application/vnd.google-apps.document": "gdoc",
  "application/vnd.google-apps.presentation": "gslides",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "txt",
  "text/x-markdown": "txt",
  "application/vnd.google-apps.spreadsheet": "gsheets",
  // lidos no navegador do aluno (assets/extrair.js): a função só entrega os bytes
  "application/msword": "doc",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow": "pptx",
  "application/vnd.oasis.opendocument.presentation": "odp",
  "application/vnd.oasis.opendocument.text": "odt",
  "application/vnd.oasis.opendocument.spreadsheet": "ods",
  "application/rtf": "rtf",
  "text/rtf": "rtf",
  "text/csv": "csv",
  "text/html": "html",
};
const EXT_NAVEGADOR = /\.(pptx?|pps[xm]?|pot[xm]?|pptm|docx?|dot[xm]?|docm|xlsx?|xlsm|odp|odt|ods|rtf|csv|html?)$/i;
export function tipoDoArquivo(mime: string, nome: string): string | null {
  if (TIPOS[mime]) return TIPOS[mime];
  if (/\.(md|txt)$/i.test(nome) && /^(text\/|application\/octet-stream$)/.test(mime)) return "txt";
  if (/\.pdf$/i.test(nome) && mime === "application/octet-stream") return "pdf";
  if (/^(application\/octet-stream|application\/zip|application\/x-zip-compressed|)$/.test(mime) && EXT_NAVEGADOR.test(nome)) return String(nome.match(EXT_NAVEGADOR)![1]).toLowerCase();
  return null;
}
const exporta = (tipo: string) => tipo === "gdoc" || tipo === "gslides" || tipo === "gsheets";

// ---------- base64url / criptografia (igual ao drive-oauth e drive-varrer) ----------
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
async function decifrar(guardado: string): Promise<string> {
  const [v, iv, ct] = guardado.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("formato");
  const raw = await crypto.subtle.digest("SHA-256", te.encode(CLIENT_SECRET));
  const k = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["decrypt"]);
  return td.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: deB64url(iv).buffer as ArrayBuffer }, k, deB64url(ct).buffer as ArrayBuffer));
}

class Aviso extends Error { constructor(msg: string, public status = 400, public extra: Record<string, unknown> = {}) { super(msg); } }

// ---------- tokens de acesso ao Google (igual ao drive-varrer) ----------
type SA = { client_email: string; private_key: string; token_uri?: string };
let saCache: { token: string; ate: number } | null = null;
function chaveSA(): SA {
  try {
    const k = JSON.parse(Deno.env.get("GOOGLE_SA_KEY") || "");
    if (!k.client_email || !k.private_key) throw 0;
    return k;
  } catch { throw new Aviso("O e-mail de leitura do site não está configurado no servidor.", 500); }
}
async function tokenSA(): Promise<string> {
  if (saCache && saCache.ate > Date.now() + 60_000) return saCache.token;
  const k = chaveSA();
  const agora = Math.floor(Date.now() / 1000);
  const aud = k.token_uri || "https://oauth2.googleapis.com/token";
  const cab = b64url(te.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const corpo = b64url(te.encode(JSON.stringify({ iss: k.client_email, scope: ESCOPO, aud, iat: agora, exp: agora + 3600 })));
  const pem = k.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const chave = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, te.encode(`${cab}.${corpo}`)));
  const r = await fetch(aud, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${cab}.${corpo}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) { console.error("token SA falhou:", r.status, d.error); throw new Aviso("Não consegui entrar no Google Drive agora. Tente de novo mais tarde.", 502); }
  saCache = { token: d.access_token, ate: Date.now() + (d.expires_in || 3600) * 1000 };
  return d.access_token;
}
async function tokenAluno(admin: SupabaseClient, uid: string): Promise<string> {
  const { data } = await admin.from("drive_tokens").select("refresh_token").eq("aluno_id", uid).maybeSingle();
  if (!data?.refresh_token) throw new Aviso("Conecte com o Google de novo (janela Meu Google Drive).", 409, { status: "reconectar" });
  let rt: string;
  try { rt = await decifrar(data.refresh_token); } catch { throw new Aviso("A conexão com o Google expirou. Conecte de novo.", 409, { status: "reconectar" }); }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (d.error === "invalid_grant" || d.error === "unauthorized_client") throw new Aviso("A conexão com o Google expirou. Conecte de novo.", 409, { status: "reconectar" });
  if (!r.ok || !d.access_token) { console.error("refresh falhou:", r.status, d.error); throw new Aviso("Não consegui falar com o Google agora. Tente de novo mais tarde.", 502); }
  return d.access_token;
}

/** Corta o envio se passar do limite (mesmo que o Drive não diga o tamanho). */
function limitar(corpo: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let total = 0;
  return corpo.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(pedaco, ctl) { total += pedaco.byteLength; if (total > max) ctl.error(new Error("grande demais")); else ctl.enqueue(pedaco); },
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ erro: "Faça login de novo." }, 401);
  const { data: quem, error: eQuem } = await admin.auth.getUser(token);
  if (eQuem || !quem?.user) return json({ erro: "Sessão inválida. Faça login de novo." }, 401);
  const uid = quem.user.id;
  const { data: perfil } = await admin.from("perfis").select("ativo, vence_em").eq("id", uid).maybeSingle();
  const hoje = new Date().toISOString().slice(0, 10);
  if (!perfil?.ativo || (perfil.vence_em && perfil.vence_em < hoje)) return json({ erro: "Seu acesso não está liberado ou venceu." }, 403);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ erro: "Pedido inválido." }, 400); }
  const id = Number(b?.material_id);
  if (!Number.isSafeInteger(id) || id <= 0) return json({ erro: "Material inválido." }, 400);

  try {
    // só o material do próprio aluno
    const { data: m, error } = await admin.from("materiais")
      .select("id,drive_file_id,mime,nome,tamanho, drive_fontes(tipo)").eq("id", id).eq("aluno_id", uid).maybeSingle();
    if (error) { console.error("material:", error.message); throw new Aviso("Não consegui ler o material. Tente de novo.", 500); }
    if (!m) throw new Aviso("Material não encontrado.", 404);
    const tipo = tipoDoArquivo(String(m.mime || ""), String(m.nome || ""));
    if (!tipo) throw new Aviso("Este tipo de arquivo não tem texto para ler.", 415, { status: "sem_texto" });
    if (m.tamanho && Number(m.tamanho) > MAX_BYTES) throw new Aviso("Arquivo grande demais (mais de 25 MB).", 413, { status: "grande_demais" });
    // deno-lint-ignore no-explicit-any
    const fonteTipo = (m as any).drive_fontes?.tipo === "google" ? "google" : "compartilhada";
    const tk = fonteTipo === "google" ? await tokenAluno(admin, uid) : await tokenSA();

    const u = new URL(`${DRIVE}/${encodeURIComponent(String(m.drive_file_id))}${exporta(tipo) ? "/export" : ""}`);
    u.searchParams.set("supportsAllDrives", "true");
    if (exporta(tipo)) u.searchParams.set("mimeType", tipo === "gsheets" ? "text/csv" : "text/plain"); else u.searchParams.set("alt", "media");
    const r = await fetch(u, { headers: { Authorization: `Bearer ${tk}` }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) {
      await r.body?.cancel();
      if (r.status === 401 && fonteTipo === "google") throw new Aviso("A conexão com o Google expirou. Conecte de novo.", 409, { status: "reconectar" });
      if (r.status === 404 || r.status === 403) throw new Aviso("Perdi o acesso a este arquivo no Drive. Confira se ele ainda está na pasta.", 404);
      throw new Aviso(`O Drive não entregou o arquivo (${r.status}). Tente de novo.`, 502);
    }
    const tam = +(r.headers.get("content-length") || 0);
    if (tam > MAX_BYTES) { await r.body?.cancel(); throw new Aviso("Arquivo grande demais (mais de 25 MB).", 413, { status: "grande_demais" }); }
    if (!r.body) throw new Aviso("O Drive mandou um arquivo vazio.", 502);
    return new Response(limitar(r.body, MAX_BYTES), {
      headers: { ...CORS, "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "x-tipo": tipo },
    });
  } catch (e) {
    if (e instanceof Aviso) return json({ erro: e.message, ...e.extra }, e.status);
    console.error("drive-arquivo:", (e as Error)?.message?.slice(0, 200));
    return json({ erro: "Não consegui buscar o arquivo. Tente de novo." }, 500);
  }
});
