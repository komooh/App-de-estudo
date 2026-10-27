// Testes da ligação "pasta do Drive -> matéria" (nomes em espanhol x português/abreviados).
// Não é publicado: o Supabase usa só o index.ts. Para rodar: deno run --allow-read teste_materias.ts
const fonte = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const ini = fonte.indexOf("// >>> nomes das matérias"), fim = fonte.indexOf("// <<< nomes das matérias");
if (ini < 0 || fim < 0) throw new Error("marcadores não encontrados no index.ts");
const codigo = fonte.slice(ini, fim) + "\nexport { materiaDoCaminho, palavras };";
const H = await import("data:application/typescript;base64," + btoa(String.fromCharCode(...new TextEncoder().encode(codigo))));

let falhas = 0;
const eq = (nome: string, a: unknown, b: unknown) => {
  const ok = JSON.stringify(a) === JSON.stringify(b); if (!ok) falhas++;
  console.log(ok ? "ok   " : "FALHA", nome, ok ? "" : `=> ${JSON.stringify(a)} (esperado ${JSON.stringify(b)})`);
};
// matérias do 6º semestre como vêm do catálogo (espanhol)
const M = ["Anatomía Patológica II", "Fisiopatología II", "Farmacología II", "Semiología II", "Gestión en Salud II", "Primeros Auxilios",
  "Seminario Integrador", "Medicina Tropical", "Anatomía II"].map((nome, i) => ({ id: i + 1, nome }));
const pasta = (p: string) => H.materiaDoCaminho(["Raiz", p], M);
eq("Farmacologia 2", pasta("Farmacologia 2"), 3);
eq("FARMACOLOGÍA II", pasta("FARMACOLOGÍA II"), 3);
eq("Farmaco", pasta("Farmaco"), 3);
eq("Anatomopatologia", pasta("Anatomopatologia"), 1);
eq("Anatopato", pasta("Anatopato"), 1);
eq("Anatomia Patologica 2", pasta("Anatomia Patologica 2"), 1);
eq("Anatomia 2 não vira Anatopato", pasta("Anatomia 2"), 9);
eq("Semio", pasta("Semio"), 4);
eq("Semio 2", pasta("Semio 2"), 4);
eq("Semiologia", pasta("Semiologia"), 4);
eq("Fisiopato", pasta("Fisiopato"), 2);
eq("Fisiopatologia 2", pasta("Fisiopatologia 2"), 2);
eq("Gestão em Saúde", pasta("Gestão em Saúde"), 5);
eq("Gestao 2", pasta("Gestao 2"), 5);
eq("Primeiros Socorros", pasta("Primeiros Socorros"), 6);
eq("Seminário", pasta("Seminário"), 7);
eq("Med Tropical", pasta("Med Tropical"), 8);
eq("Fotos (nada)", pasta("Fotos"), null);
eq("Farmacologia 1 (número diferente)", pasta("Farmacologia 1"), null);
// outros semestres
const S8 = ["Cirugía", "Neumología", "Psiquiatría", "Redacción"].map((nome, i) => ({ id: i + 1, nome }));
eq("Cirurgia", H.materiaDoCaminho(["R", "Cirurgia"], S8), 1);
eq("Pneumologia", H.materiaDoCaminho(["R", "Pneumologia"], S8), 2);
eq("Psiquiatria", H.materiaDoCaminho(["R", "Psiquiatria"], S8), 3);
eq("Redação", H.materiaDoCaminho(["R", "Redação"], S8), 4);
const S3 = ["Inmunología", "Bioestadística", "Lengua Castellana"].map((nome, i) => ({ id: i + 1, nome }));
eq("Imunologia", H.materiaDoCaminho(["R", "Imunologia"], S3), 1);
eq("Bioestatística", H.materiaDoCaminho(["R", "Bioestatística"], S3), 2);
eq("Espanhol", H.materiaDoCaminho(["R", "Espanhol"], S3), 3);
eq("palavras", H.palavras("Gestión en Salud II"), ["gestion", "salud"]);

console.log(falhas ? `\n${falhas} falha(s)` : "\ntudo certo");
if (falhas) Deno.exit(1);
