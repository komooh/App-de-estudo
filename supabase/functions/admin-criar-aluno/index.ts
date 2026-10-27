// Edge Function: admin-criar-aluno
// Cria a conta de um aluno e manda o convite por e-mail. Só o administrador pode chamar.
// A chave de serviço fica só aqui no servidor (variável SUPABASE_SERVICE_ROLE_KEY, que o Supabase já fornece).
import { createClient } from "npm:@supabase/supabase-js@2.79.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ erro: "Método não permitido" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // 1) Quem está chamando? Precisa estar logado e ser admin.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ erro: "Faça login de novo." }, 401);
  const { data: quem, error: eQuem } = await admin.auth.getUser(token);
  if (eQuem || !quem?.user) return json({ erro: "Sessão inválida. Faça login de novo." }, 401);
  const { data: perfilAdmin } = await admin.from("perfis").select("is_admin").eq("id", quem.user.id).single();
  if (!perfilAdmin?.is_admin) return json({ erro: "Só o administrador pode criar alunos." }, 403);

  // 2) Dados do novo aluno
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ erro: "Pedido inválido." }, 400); }
  const email = String(b.email || "").trim().toLowerCase();
  const nome = String(b.nome || "").trim();
  const plano = ["mensal", "semestral", "teste"].includes(String(b.plano)) ? String(b.plano) : "mensal";
  const vence = b.vence_em ? String(b.vence_em) : null;
  const redirectTo = typeof b.redirectTo === "string" ? b.redirectTo : undefined;
  const senha = typeof b.senha === "string" ? b.senha : "";
  if (senha && senha.length < 8) return json({ erro: "A senha precisa ter pelo menos 8 caracteres." }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: "E-mail inválido." }, 400);
  if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) return json({ erro: "Data de vencimento inválida." }, 400);

  // 3) Cria a conta (o perfil é criado sozinho pelo banco).
  //    Com senha: a conta já nasce confirmada e você passa a senha ao aluno.
  //    Sem senha: o aluno recebe um convite por e-mail.
  const { data: conv, error: eConv } = senha
    ? await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } })
    : await admin.auth.admin.inviteUserByEmail(email, { data: { nome }, redirectTo });
  if (eConv) {
    const ja = /already|registered|exists/i.test(eConv.message);
    return json({ erro: ja ? "Já existe uma conta com esse e-mail." : "Não consegui criar: " + eConv.message }, ja ? 409 : 400);
  }

  // 4) Libera o acesso com plano e vencimento
  const { error: ePerfil } = await admin.from("perfis")
    .update({ nome: nome || null, plano, vence_em: vence, ativo: true })
    .eq("id", conv.user.id);
  if (ePerfil) return json({ erro: "Conta criada, mas não consegui liberar: " + ePerfil.message }, 500);

  return json({ ok: true, id: conv.user.id, email, convite: !senha });
});
