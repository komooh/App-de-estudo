// Edge Function: drive-varrer
// Lê a pasta do Google Drive que o aluno ligou (e todas as subpastas), liga cada arquivo
// à matéria certa pelo nome da pasta, cria os temas e guarda o texto dos arquivos.
// NÃO gera resumos: resumo só quando o aluno pede, em outro lugar.
//
// Quem pode chamar:
//   - o aluno logado (site): varre as pastas dele. Corpo opcional {pasta:"<link>", tipo:"compartilhada"|"google"}
//     para ligar/trocar a pasta antes de varrer.
//   - o servidor (agendamento diário), com a chave service_role: varre as pastas de todos.
// Se o tempo acabar, devolve {feito:false, restantes:n} e o site chama de novo.
//
// Segredos usados: GOOGLE_SA_KEY (chave JSON do e-mail de leitura), GOOGLE_OAUTH_SECRET e
// GOOGLE_OAUTH_CLIENT_ID (conexão "Entrar com o Google"). SUPABASE_* o Supabase já fornece.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.79.0";
import { extractText, getDocumentProxy } from "npm:unpdf@1.8.1";
import JSZip from "npm:jszip@3.10.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? Deno.env.get("OOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_SECRET") ?? "";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const ESCOPO = "https://www.googleapis.com/auth/drive.readonly";

const ORCAMENTO_MS = 110_000;      // tempo total por chamada
const NAO_COMECAR_APOS_MS = 95_000; // não começa a ler um arquivo novo depois disso
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_TEXTO = 300_000;
const MAX_PROFUNDIDADE = 6;
const MAX_ARQUIVOS = 3000;
const MAX_TENTATIVAS = 3;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// ======================= helpers (testados) =======================
const PASTA_MIME = "application/vnd.google-apps.folder";
const TIPOS: Record<string, string> = {
  "application/vnd.google-apps.document": "gdoc",
  "application/vnd.google-apps.presentation": "gslides",
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "txt",
  "text/markdown": "txt",
  "text/x-markdown": "txt",
  // aparecem na lista, mas sem leitura do texto
  "application/msword": "outro",
  "application/vnd.ms-powerpoint": "outro",
};
function tipoDoArquivo(mime: string, nome: string): string | null {
  if (TIPOS[mime]) return TIPOS[mime];
  if (/\.(md|txt)$/i.test(nome) && /^(text\/|application\/octet-stream$)/.test(mime)) return "txt";
  return null;
}

/** Tira o id da pasta de um link do Drive (ou aceita o id puro). */
function idDaPasta(entrada: string): string | null {
  const s = String(entrada || "").trim();
  if (!s || s.length > 500) return null;
  const ID = /^[A-Za-z0-9_-]{10,200}$/;
  if (ID.test(s)) return s;
  let m = s.match(/\/folders\/([A-Za-z0-9_-]{10,200})/) || s.match(/[?&]id=([A-Za-z0-9_-]{10,200})/) || s.match(/\/d\/([A-Za-z0-9_-]{10,200})/);
  if (m) return m[1];
  m = s.match(/^([A-Za-z0-9_-]{10,200})[?#]/);
  return m ? m[1] : null;
}

const PALAVRAS_VAZIAS = new Set(["de", "da", "do", "das", "dos", "e", "a", "o", "as", "os", "em", "na", "no", "nas", "nos", "para", "y", "la", "el", "del", "los", "las", "en",
  "materia", "disciplina", "aula", "aulas", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"]);
const ROMANOS: Record<string, string> = { i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" };
function semAcento(s: string) { return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase(); }
/** Palavras que importam no nome (sem acento, sem número, sem "de/da/e"). */
function palavras(s: string): string[] {
  return semAcento(s).replace(/[^a-z]+/g, " ").split(" ").filter((w) => w.length > 1 && !PALAVRAS_VAZIAS.has(w));
}
/** Número do nome (Farmacologia 2 / Farmacologia II) ou null. */
function numeroDoNome(s: string): string | null {
  const t = semAcento(s);
  const d = t.match(/\b(\d{1,2})\b/); if (d) return String(+d[1]);
  const r = t.match(/\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b\s*$/); return r ? ROMANOS[r[1]] : null;
}
// iguais, ou uma é abreviação da outra ("med" / "medicina", "farmaco" / "farmacologia")
const parecida = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 3 && Math.max(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
/** Nota de 0 a ~3 para "esta pasta é desta matéria". 0 = não é. */
function notaMateria(pasta: string, materia: string): number {
  const A = palavras(pasta), B = palavras(materia);
  if (!A.length || !B.length) return 0;
  const a = A.join(" "), b = B.join(" ");
  let n = 0;
  if (a === b) n = 3;
  else if ((a.length >= 4 && b.includes(a)) || (b.length >= 4 && a.includes(b))) n = 2;
  else {
    const comuns = B.filter((w) => A.some((x) => parecida(x, w))).length;
    const prop = comuns / Math.min(A.length, B.length);
    if (comuns && prop >= 0.6 && comuns / Math.max(A.length, B.length) >= 0.5) n = 1 + prop * 0.5;
  }
  if (!n) return 0;
  const na = numeroDoNome(pasta), nb = numeroDoNome(materia);
  if (na && nb) n += na === nb ? 0.5 : -1;
  return n > 0 ? n : 0;
}
/** Escolhe a matéria pelo caminho: 1ª subpasta, depois as mais fundas, por último a pasta raiz. */
function materiaDoCaminho(caminho: string[], materias: { id: number; nome: string }[]): number | null {
  const ordem = [...caminho.slice(1), caminho[0]].filter(Boolean);
  for (const pasta of ordem) {
    let melhor: { id: number; n: number } | null = null;
    for (const m of materias) {
      const n = notaMateria(pasta, m.nome);
      if (n > 0 && (!melhor || n > melhor.n)) melhor = { id: m.id, n };
    }
    if (melhor) return melhor.id;
  }
  return null;
}
/** Nome do tema a partir do nome do arquivo. */
function nomeDoTema(arquivo: string): string {
  let s = String(arquivo || "").replace(/\.(pdf|pptx?|docx?|txt|md|key|odt|odp)$/i, "");
  s = s.replace(/_/g, " ").replace(/\s+[-–—]\s+/g, " - ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(\d{1,3}|[a-z]\d{1,2})\s*[.)\-–:]?\s+(?=\S)/i, "");   // "01 - ", "1. ", "03) "
  s = s.replace(/^[-–—.\s]+|[-–—.\s]+$/g, "");
  if (s.length > 120) s = s.slice(0, 120).trim();
  return s || String(arquivo || "Sem nome").slice(0, 120);
}
const chaveTema = (s: string) => semAcento(s).replace(/[^a-z0-9]+/g, " ").trim();

function desfazXml(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}
/** Texto de um XML do Office: tag = "a:t" (PowerPoint) ou "w:t" (Word); parágrafo = "a:p" ou "w:p". */
function textoDoXml(xml: string, tag: string, par: string): string {
  const linhas: string[] = [];
  const reT = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>|<${tag.split(":")[0]}:tab\\s*/>|<${tag.split(":")[0]}:br\\s*/>`, "g");
  for (const p of xml.split(new RegExp(`</${par}>`))) {
    let l = "";
    for (const m of p.matchAll(reT)) l += m[1] !== undefined ? desfazXml(m[1]) : m[0].includes("tab") ? "\t" : "\n";
    if (l.trim()) linhas.push(l.trimEnd());
  }
  return linhas.join("\n");
}
async function textoPptx(buf: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .map((n) => ({ n, m: n.match(/^ppt\/slides\/slide(\d+)\.xml$/) }))
    .filter((x) => x.m).sort((a, b) => +a.m![1] - +b.m![1]);
  const partes: string[] = [];
  for (const s of slides) {
    const t = textoDoXml(await zip.file(s.n)!.async("string"), "a:t", "a:p");
    if (t.trim()) partes.push(`Slide ${s.m![1]}\n${t}`);
  }
  return partes.join("\n\n");
}
async function textoDocx(buf: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  return doc ? textoDoXml(await doc.async("string"), "w:t", "w:p") : "";
}
function limparTexto(t: string): string {
  // \u0000 quebra o Postgres; também tira espaços repetidos
  const s = t.split(String.fromCharCode(0)).join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.length > MAX_TEXTO ? s.slice(0, MAX_TEXTO) : s;
}
// ======================= fim helpers =======================

// ---------- base64url / criptografia ----------
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
function iguais(a: string, b: string): boolean {
  const x = te.encode(a), y = te.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

// ---------- erros que viram mensagem para o aluno ----------
class Aviso extends Error { constructor(msg: string, public status = "erro") { super(msg); } }

// ---------- tokens de acesso ao Google ----------
type SA = { client_email: string; private_key: string; token_uri?: string };
let saCache: { token: string; ate: number } | null = null;
function chaveSA(): SA {
  try {
    const k = JSON.parse(Deno.env.get("GOOGLE_SA_KEY") || "");
    if (!k.client_email || !k.private_key) throw 0;
    return k;
  } catch { throw new Aviso("O e-mail de leitura do site não está configurado no servidor."); }
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
  if (!r.ok || !d.access_token) { console.error("token SA falhou:", r.status, d.error); throw new Aviso("Não consegui entrar no Google Drive agora. Tente de novo mais tarde."); }
  saCache = { token: d.access_token, ate: Date.now() + (d.expires_in || 3600) * 1000 };
  return d.access_token;
}
async function tokenAluno(admin: SupabaseClient, uid: string): Promise<string> {
  const { data } = await admin.from("drive_tokens").select("refresh_token").eq("aluno_id", uid).maybeSingle();
  if (!data?.refresh_token) throw new Aviso("Conecte com o Google primeiro.", "reconectar");
  let rt: string;
  try { rt = await decifrar(data.refresh_token); } catch { throw new Aviso("A conexão com o Google expirou. Conecte de novo.", "reconectar"); }
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
    signal: AbortSignal.timeout(15000),
  });
  const d = await r.json().catch(() => ({}));
  if (d.error === "invalid_grant" || d.error === "unauthorized_client") throw new Aviso("A conexão com o Google expirou. Conecte de novo.", "reconectar");
  if (!r.ok || !d.access_token) { console.error("refresh falhou:", r.status, d.error); throw new Aviso("Não consegui falar com o Google agora. Tente de novo mais tarde."); }
  return d.access_token;
}
async function tokenDaFonte(admin: SupabaseClient, f: { tipo: string; aluno_id: string }) {
  return f.tipo === "google" ? await tokenAluno(admin, f.aluno_id) : await tokenSA();
}

// ---------- Drive ----------
async function drive(token: string, caminho: string, params: Record<string, string> = {}, ms = 30000): Promise<Response> {
  const u = new URL(DRIVE + caminho);
  for (const [k, v] of Object.entries({ supportsAllDrives: "true", ...params })) u.searchParams.set(k, v);
  return await fetch(u, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(ms) });
}
function msgPastaNaoAbre(tipo: string) {
  return tipo === "google"
    ? "Não encontrei essa pasta na sua conta do Google. Confira o link e se você entrou com a conta certa."
    : `Não consegui abrir essa pasta. Confira se ela foi compartilhada com ${chaveSA().client_email} como Leitor.`;
}
async function abrirPasta(token: string, id: string, tipo: string): Promise<{ id: string; name: string }> {
  const r = await drive(token, `/${id}`, { fields: "id,name,mimeType,trashed" }, 15000);
  if (r.status === 404 || r.status === 403) throw new Aviso(msgPastaNaoAbre(tipo));
  if (r.status === 401 && tipo === "google") throw new Aviso("A conexão com o Google expirou. Conecte de novo.", "reconectar");
  if (!r.ok) throw new Aviso("O Google Drive não respondeu. Tente de novo em instantes.");
  const d = await r.json();
  if (d.mimeType !== PASTA_MIME) throw new Aviso("Esse link não é de uma pasta. Abra a pasta no Drive e copie o link dela.");
  if (d.trashed) throw new Aviso("Essa pasta está na lixeira do Drive.");
  return { id: d.id, name: d.name };
}
type Arq = { id: string; name: string; mimeType: string; modifiedTime?: string; size?: string; caminho: string[] };
async function listarTudo(token: string, raiz: { id: string; name: string }, fimMs: number): Promise<Arq[]> {
  const arquivos: Arq[] = [];
  const vistas = new Set<string>([raiz.id]);
  const fila: { id: string; caminho: string[]; nivel: number }[] = [{ id: raiz.id, caminho: [raiz.name], nivel: 0 }];
  while (fila.length) {
    const p = fila.shift()!;
    let pageToken = "";
    do {
      if (Date.now() > fimMs) throw new Aviso("A pasta é grande demais para ler de uma vez. Tente de novo.");
      const params: Record<string, string> = {
        q: `'${p.id}' in parents and trashed=false`,
        fields: "nextPageToken,files(id,name,mimeType,modifiedTime,size,shortcutDetails)",
        pageSize: "1000", includeItemsFromAllDrives: "true",
      };
      if (pageToken) params.pageToken = pageToken;
      const r = await drive(token, "", params);
      if (!r.ok) {
        if (p.nivel === 0 && (r.status === 404 || r.status === 403)) throw new Aviso("Perdi o acesso à pasta.");
        throw new Aviso("O Google Drive não respondeu. Tente de novo em instantes.");
      }
      const d = await r.json();
      for (const f of d.files || []) {
        if (f.mimeType === PASTA_MIME) {
          if (p.nivel + 1 <= MAX_PROFUNDIDADE && !vistas.has(f.id)) { vistas.add(f.id); fila.push({ id: f.id, caminho: [...p.caminho, f.name], nivel: p.nivel + 1 }); }
        } else if (f.mimeType === "application/vnd.google-apps.shortcut") {
          continue; // atalhos ficam de fora (evita ler pastas de outras pessoas)
        } else if (tipoDoArquivo(f.mimeType, f.name)) {
          arquivos.push({ ...f, caminho: p.caminho });
          if (arquivos.length >= MAX_ARQUIVOS) return arquivos;
        }
      }
      pageToken = d.nextPageToken || "";
    } while (pageToken);
  }
  return arquivos;
}
async function lerArquivo(token: string, m: { drive_file_id: string; mime: string; nome: string; tamanho: number | null }): Promise<{ status: string; texto: string | null; erro: string | null }> {
  const tipo = tipoDoArquivo(m.mime, m.nome);
  if (!tipo || tipo === "outro") return { status: "sem_texto", texto: null, erro: null };
  if (m.tamanho && m.tamanho > MAX_BYTES) return { status: "grande_demais", texto: null, erro: null };
  let texto = "";
  if (tipo === "gdoc" || tipo === "gslides") {
    const r = await drive(token, `/${m.drive_file_id}/export`, { mimeType: "text/plain" }, 45000);
    if (r.status === 403) {
      const e = await r.json().catch(() => ({}));
      if (JSON.stringify(e).includes("exportSizeLimitExceeded")) return { status: "grande_demais", texto: null, erro: null };
    }
    if (!r.ok) return { status: "erro", texto: null, erro: `O Drive não entregou o arquivo (${r.status}).` };
    texto = await r.text();
  } else {
    const r = await drive(token, `/${m.drive_file_id}`, { alt: "media" }, 60000);
    if (!r.ok) return { status: "erro", texto: null, erro: `O Drive não entregou o arquivo (${r.status}).` };
    const tam = +(r.headers.get("content-length") || 0);
    if (tam > MAX_BYTES) { await r.body?.cancel(); return { status: "grande_demais", texto: null, erro: null }; }
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return { status: "grande_demais", texto: null, erro: null };
    if (tipo === "txt") texto = td.decode(buf);
    else if (tipo === "pptx") texto = await textoPptx(buf);
    else if (tipo === "docx") texto = await textoDocx(buf);
    else if (tipo === "pdf") {
      const pdf = await getDocumentProxy(buf);
      try { texto = String((await extractText(pdf, { mergePages: true })).text || ""); } finally { try { await (pdf as unknown as { destroy?: () => Promise<void> }).destroy?.(); } catch { /* ok */ } }
    }
  }
  texto = limparTexto(texto);
  return texto.length >= 20 ? { status: "ok", texto, erro: null } : { status: "sem_texto", texto: null, erro: null };
}

// ---------- varredura de uma pasta ----------
type Fonte = { id: string; aluno_id: string; tipo: string; pasta_id: string | null; pasta_nome: string | null; status: string };
type Resumo = { arquivos: number; novos: number; atualizados: number; removidos: number; sem_materia: number; restantes: number };

async function emLotes<T>(itens: T[], n: number, fn: (lote: T[]) => Promise<void>) {
  for (let i = 0; i < itens.length; i += n) await fn(itens.slice(i, i + n));
}

async function varrerFonte(admin: SupabaseClient, f: Fonte, inicio: number, r: Resumo) {
  if (!f.pasta_id) return;
  await admin.from("drive_fontes").update({ status: "varrendo", erro: null }).eq("id", f.id);
  try {
    const token = await tokenDaFonte(admin, f);
    const raiz = await abrirPasta(token, f.pasta_id, f.tipo).catch((e) => {
      if (e instanceof Aviso && e.message === msgPastaNaoAbre(f.tipo)) throw new Aviso("Perdi o acesso à pasta. " + e.message);
      throw e;
    });
    const arquivos = await listarTudo(token, raiz, inicio + ORCAMENTO_MS - 20_000);

    // matérias e temas do aluno
    const [{ data: materias, error: e1 }, { data: temas, error: e2 }, { data: existentes, error: e3 }] = await Promise.all([
      admin.from("disciplinas").select("id,nome").eq("aluno_id", f.aluno_id),
      admin.from("temas").select("id,disciplina_id,nome").eq("aluno_id", f.aluno_id),
      admin.from("materiais").select("id,fonte_id,drive_file_id,modificado_em,status,tema_id,disciplina_id").eq("aluno_id", f.aluno_id),
    ]);
    if (e1 || e2 || e3) throw new Error("banco: " + (e1 || e2 || e3)!.message);
    const porArquivo = new Map((existentes || []).map((m) => [m.drive_file_id, m]));
    const temaPorChave = new Map<string, number>();
    const temaIds = new Set<number>();
    for (const t of temas || []) { temaPorChave.set(`${t.disciplina_id}|${chaveTema(t.nome)}`, t.id); temaIds.add(t.id); }

    // 1) matéria de cada arquivo e temas que faltam
    const linhas = arquivos.map((a) => {
      const disciplina_id = materiaDoCaminho(a.caminho, materias || []);
      return { a, disciplina_id, temaNome: nomeDoTema(a.name), velho: porArquivo.get(a.id) };
    });
    const novosTemas = new Map<string, { aluno_id: string; disciplina_id: number; nome: string; origem: string }>();
    for (const l of linhas) {
      if (!l.disciplina_id) continue;
      if (l.velho?.tema_id && temaIds.has(l.velho.tema_id) && l.velho.disciplina_id === l.disciplina_id) continue;
      const k = `${l.disciplina_id}|${chaveTema(l.temaNome)}`;
      if (!temaPorChave.has(k) && !novosTemas.has(k)) novosTemas.set(k, { aluno_id: f.aluno_id, disciplina_id: l.disciplina_id, nome: l.temaNome, origem: "drive" });
    }
    await emLotes([...novosTemas.entries()], 300, async (lote) => {
      const { data, error } = await admin.from("temas").insert(lote.map(([, t]) => t)).select("id,disciplina_id,nome");
      if (error) throw new Error("temas: " + error.message);
      for (const t of data || []) temaPorChave.set(`${t.disciplina_id}|${chaveTema(t.nome)}`, t.id);
    });

    // 2) grava a lista de arquivos (o texto vem depois)
    const mudou: Record<string, unknown>[] = [], igual: Record<string, unknown>[] = [];
    for (const l of linhas) {
      const tema_id = !l.disciplina_id ? null
        : (l.velho?.tema_id && temaIds.has(l.velho.tema_id) && l.velho.disciplina_id === l.disciplina_id) ? l.velho.tema_id
        : temaPorChave.get(`${l.disciplina_id}|${chaveTema(l.temaNome)}`) ?? null;
      const base = {
        aluno_id: f.aluno_id, fonte_id: f.id, drive_file_id: l.a.id, nome: l.a.name.slice(0, 300), mime: l.a.mimeType,
        caminho: l.a.caminho.join(" / ").slice(0, 1000), disciplina_id: l.disciplina_id, tema_id,
        modificado_em: l.a.modifiedTime || null, tamanho: l.a.size ? +l.a.size : null,
      };
      if (!l.disciplina_id) r.sem_materia++;
      const novo = !l.velho;
      const alterado = !!l.velho && (l.velho.modificado_em ? new Date(l.velho.modificado_em).getTime() : 0) !== (l.a.modifiedTime ? new Date(l.a.modifiedTime).getTime() : 0);
      if (novo || alterado) {
        mudou.push({ ...base, status: "pendente", texto: null, erro: null, tentativas: 0 });
        if (novo) r.novos++; else r.atualizados++;
      } else igual.push(base);
    }
    r.arquivos += linhas.length;
    for (const grupo of [mudou, igual]) {
      await emLotes(grupo, 500, async (lote) => {
        const { error } = await admin.from("materiais").upsert(lote, { onConflict: "aluno_id,drive_file_id" });
        if (error) throw new Error("materiais: " + error.message);
      });
    }

    // 3) apaga o que saiu da pasta (só desta pasta)
    const presentes = new Set(arquivos.map((a) => a.id));
    const sairam = (existentes || []).filter((m) => m.fonte_id === f.id && !presentes.has(m.drive_file_id)).map((m) => m.id);
    await emLotes(sairam, 300, async (lote) => {
      const { error } = await admin.from("materiais").delete().in("id", lote);
      if (error) throw new Error("apagar: " + error.message);
    });
    r.removidos += sairam.length;

    // 4) lê o texto dos arquivos novos ou alterados, até acabar o tempo
    const { data: fila, error: e4 } = await admin.from("materiais")
      .select("id,drive_file_id,mime,nome,tamanho,tentativas").eq("fonte_id", f.id).eq("status", "pendente").order("id");
    if (e4) throw new Error("fila: " + e4.message);
    let i = 0;
    for (; i < (fila || []).length; i++) {
      if (Date.now() - inicio > NAO_COMECAR_APOS_MS) break;
      const m = fila![i];
      if (m.tentativas >= MAX_TENTATIVAS) {
        await admin.from("materiais").update({ status: "erro", erro: "Não consegui ler este arquivo (pesado demais)." }).eq("id", m.id);
        continue;
      }
      // marca a tentativa antes: se a função cair no meio de um arquivo pesado, não trava a fila para sempre
      await admin.from("materiais").update({ tentativas: m.tentativas + 1 }).eq("id", m.id);
      let res: { status: string; texto: string | null; erro: string | null };
      try { res = await lerArquivo(token, m); }
      catch (e) { res = { status: "erro", texto: null, erro: "Não consegui ler este arquivo." }; console.error("ler arquivo:", (e as Error).message?.slice(0, 200)); }
      const { error } = await admin.from("materiais").update({ ...res, tentativas: 0 }).eq("id", m.id);
      if (error) console.error("salvar texto:", error.message);
    }
    const faltam = (fila || []).length - i;
    r.restantes += faltam;
    await admin.from("drive_fontes").update({
      status: faltam ? "varrendo" : "ok", erro: null, pasta_nome: raiz.name, ultima_varredura: new Date().toISOString(),
    }).eq("id", f.id);
  } catch (e) {
    const aviso = e instanceof Aviso;
    if (!aviso) console.error("varredura:", (e as Error).message?.slice(0, 300));
    await admin.from("drive_fontes").update({
      status: aviso ? (e as Aviso).status : "erro",
      erro: aviso ? (e as Error).message : "Algo deu errado ao ler a pasta. Tente de novo.",
    }).eq("id", f.id);
  }
}

// ---------- entrada ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);
  const inicio = Date.now();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ erro: "Faça login de novo." }, 401);
  let b: Record<string, unknown> = {};
  try { const t = await req.text(); b = t ? JSON.parse(t) : {}; } catch { return json({ erro: "Pedido inválido." }, 400); }
  if (!b || typeof b !== "object" || Array.isArray(b)) b = {};

  const r: Resumo = { arquivos: 0, novos: 0, atualizados: 0, removidos: 0, sem_materia: 0, restantes: 0 };
  const hoje = new Date().toISOString().slice(0, 10);

  // ===== agendamento (chave de serviço): todas as pastas =====
  if (iguais(token, SERVICE_KEY)) {
    const { data: fontes, error } = await admin.from("drive_fontes")
      .select("id,aluno_id,tipo,pasta_id,pasta_nome,status, perfis!inner(ativo,vence_em)")
      .not("pasta_id", "is", null).neq("status", "reconectar").order("ultima_varredura", { ascending: true, nullsFirst: true });
    if (error) return json({ erro: error.message }, 500);
    let pulou = 0;
    for (const f of fontes || []) {
      // deno-lint-ignore no-explicit-any
      const p = (f as any).perfis;
      if (!p?.ativo || (p.vence_em && p.vence_em < hoje)) continue;
      if (Date.now() - inicio > NAO_COMECAR_APOS_MS) { pulou++; continue; }
      await varrerFonte(admin, f as unknown as Fonte, inicio, r);
    }
    return json({ ok: true, feito: !r.restantes && !pulou, ...r, pastas_puladas: pulou });
  }

  // ===== aluno logado =====
  const { data: quem, error: eQuem } = await admin.auth.getUser(token);
  if (eQuem || !quem?.user) return json({ erro: "Sessão inválida. Faça login de novo." }, 401);
  const uid = quem.user.id;
  const { data: perfil } = await admin.from("perfis").select("ativo, vence_em").eq("id", uid).maybeSingle();
  if (!perfil?.ativo || (perfil.vence_em && perfil.vence_em < hoje)) return json({ erro: "Seu acesso não está liberado ou venceu." }, 403);

  // ligar (ou trocar) a pasta
  if (b.pasta !== undefined) {
    const tipo = b.tipo === "google" ? "google" : "compartilhada";
    const pastaId = idDaPasta(String(b.pasta));
    if (!pastaId) return json({ erro: "Não reconheci esse link. Abra a pasta no Google Drive e copie o link da barra de endereço." }, 400);
    try {
      const tk = await tokenDaFonte(admin, { tipo, aluno_id: uid });
      const pasta = await abrirPasta(tk, pastaId, tipo);
      if (tipo === "compartilhada") {
        const { data: dono } = await admin.from("drive_fontes").select("aluno_id").eq("tipo", "compartilhada").eq("pasta_id", pasta.id).maybeSingle();
        if (dono && dono.aluno_id !== uid) return json({ erro: "Essa pasta já está ligada à conta de outro aluno. Use uma pasta só sua." }, 409);
      }
      const { error } = await admin.from("drive_fontes").upsert(
        { aluno_id: uid, tipo, pasta_id: pasta.id, pasta_nome: pasta.name, status: "pendente", erro: null },
        { onConflict: "aluno_id,tipo" });
      if (error) {
        if (/drive_fontes_pasta_unica/.test(error.message)) return json({ erro: "Essa pasta já está ligada à conta de outro aluno. Use uma pasta só sua." }, 409);
        throw new Error(error.message);
      }
    } catch (e) {
      if (e instanceof Aviso) {
        if (e.status === "reconectar") await admin.from("drive_fontes").update({ status: "reconectar", erro: e.message }).eq("aluno_id", uid).eq("tipo", "google");
        return json({ erro: e.message, status: e.status }, 400);
      }
      console.error("ligar pasta:", (e as Error).message?.slice(0, 200));
      return json({ erro: "Não consegui ligar a pasta. Tente de novo." }, 500);
    }
  }

  const { data: fontes, error } = await admin.from("drive_fontes")
    .select("id,aluno_id,tipo,pasta_id,pasta_nome,status").eq("aluno_id", uid).not("pasta_id", "is", null);
  if (error) return json({ erro: "Não consegui ler suas pastas. Tente de novo." }, 500);
  if (!fontes?.length) return json({ erro: "Ligue uma pasta primeiro." }, 400);
  for (const f of fontes) {
    if (f.status === "reconectar") continue;
    if (Date.now() - inicio > NAO_COMECAR_APOS_MS) { r.restantes++; continue; }
    await varrerFonte(admin, f as Fonte, inicio, r);
  }
  const { data: depois } = await admin.from("drive_fontes").select("tipo,status,erro,pasta_nome,ultima_varredura").eq("aluno_id", uid);
  return json({ ok: true, feito: !r.restantes, ...r, fontes: depois || [] });
});
