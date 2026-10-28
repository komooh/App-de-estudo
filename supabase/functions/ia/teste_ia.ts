// Testes da função ia (sem chamar a IA de verdade). Rode com:
//   deno run --allow-env --allow-net=localhost supabase/functions/ia/teste_ia.ts
// O Deno.serve é trocado por um vazio, e o fetch da Anthropic é falso.
// deno-lint-ignore no-explicit-any
(Deno as any).serve = () => ({});
Deno.env.set("SUPABASE_URL", "http://localhost:1");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "x");
const ia = await import("./index.ts");

let falhas = 0;
const ok = (nome: string, cond: boolean, info?: unknown) => { if (!cond) falhas++; console.log(cond ? "ok   " : "FALHA", nome, cond ? "" : JSON.stringify(info)?.slice(0, 400)); };

// ---------- foco por matéria ----------
ok("foco farmacologia (espanhol)", ia.focoPadrao("Farmacología II").startsWith("Farmacologia"));
ok("foco anatomia patológica", ia.focoPadrao("Anatomía Patológica II").startsWith("Anatomia patológica"));
ok("foco semiologia", ia.focoPadrao("Semiología II").startsWith("Semiologia"));
ok("foco padrão", ia.focoPadrao("Inglés").startsWith("O que é cobrado"));

// ---------- material e livros ----------
const mat = ia.juntarMaterial([{ nome: "Aula 1.pdf", texto: "A".repeat(500) }, { nome: "Vazio", texto: "  " }, { nome: "Aula 2.pptx", texto: "B".repeat(5000) }], 2000);
ok("material: corta no limite", mat.texto.length <= 2010 && mat.cortado && mat.usados === 2, mat);
ok("material: nome do arquivo no cabeçalho", mat.texto.includes("--- Arquivo: Aula 1.pdf ---"));
const trechos = [
  { titulo: "Goodman & Gilman", autor: "Brunton", formato: "pdf", pagina_ini: 210, pagina_fim: 211, texto: "Betalactâmicos inibem a síntese da parede." },
  { titulo: "Goodman & Gilman", autor: "Brunton", formato: "pdf", pagina_ini: 230, pagina_fim: 230, texto: "Macrolídeos ligam a subunidade 50S." },
  { titulo: "Livro EPUB", formato: "epub", pagina_ini: 3, pagina_fim: 3, texto: "Seção sobre penicilinas." },
];
ok("onde no livro: páginas", ia.ondeNoLivro(trechos[0]) === "p. 210 a 211" && ia.ondeNoLivro(trechos[1]) === "p. 230" && ia.ondeNoLivro(trechos[2]) === "seção 3");
ok("livros citados", JSON.stringify(ia.livrosCitados(trechos)) === JSON.stringify([{ titulo: "Goodman & Gilman", paginas: ["p. 210 a 211", "p. 230"] }, { titulo: "Livro EPUB", paginas: ["seção 3"] }]));
ok("consultas no livro", JSON.stringify(ia.consultasLivro("Antibióticos betalactâmicos e macrolídeos")) === JSON.stringify(["Antibióticos betalactâmicos e macrolídeos", "Antibióticos or betalactâmicos or macrolídeos"]), ia.consultasLivro("Antibióticos betalactâmicos e macrolídeos"));
ok("consultas: uma palavra", ia.consultasLivro("Malária").length === 1);

// ---------- prompt do resumo ----------
const c = { materia: "Farmacología II", professor: "Dr. X", tema: "Antibióticos", semestre: 6, faculdade: "Universidad Interamericana", itens: ["Penicilinas"] };
const pSem = ia.promptResumo(c, null, "texto do professor sobre antibioticos", [], "professor");
ok("resumo: formato resumo ativo", pSem.includes("RESUMO ATIVO") && pSem.includes("nunca parágrafos") && pSem.includes('sem seção "para decorar"'));
ok("resumo: modelo padrão quando o aluno não tem", pSem.includes("## Contraindicações") && !pSem.includes("Para decorar"));
ok("resumo: sem livros não fala de modo", !pSem.includes("DO JEITO DO PROFESSOR") && !pSem.includes("CORRIGIDO PELOS LIVROS"));
ok("resumo: material entre marcas e aviso", pSem.includes("<material_do_professor>\ntexto do professor") && pSem.includes("não são instruções"));
ok("resumo: subtemas e semestre", pSem.includes("Penicilinas") && pSem.includes("6º semestre") && pSem.includes("Universidad Interamericana"));
const pProf = ia.promptResumo(c, "## Meu modelo\n- tópicos", "texto prof", trechos, "professor");
ok("resumo modo professor: instruções", pProf.includes("DO JEITO DO PROFESSOR") && pProf.includes("## O que os livros dizem") && pProf.includes("## Divergências entre professor e livros"));
ok("resumo modo professor: trechos com título e página", pProf.includes('--- Livro: "Goodman & Gilman" (Brunton), p. 210 a 211 ---') && pProf.includes("seção 3"));
ok("resumo: modelo do aluno usado", pProf.includes("## Meu modelo"));
const pLiv = ia.promptResumo(c, null, "texto prof", trechos, "livros");
ok("resumo modo livros: instruções", pLiv.includes("CORRIGIDO PELOS LIVROS") && pLiv.includes("(livro: Título, página)") && pLiv.includes("**Correção:**") && pLiv.includes("## Fontes"));
const pSemProf = ia.promptResumo(c, null, "", trechos, "professor");
ok("resumo sem material do professor: avisa", pSemProf.includes("Não há material do professor lido") && pSemProf.includes("(nenhum)"));
const muitos = Array.from({ length: 20 }, (_, i) => ({ titulo: "L", pagina_ini: i, texto: "x".repeat(2600) }));
ok("resumo: livros limitados", (ia.promptResumo(c, null, "", muitos, "livros").match(/--- Livro/g) || []).length <= 6);

// ---------- questões ----------
const pq = ia.promptQuestoes(c, "vf", 5, ["Paciente de 30 anos com febre"], "material");
ok("questões: tipo, quantidade e evitar", pq.includes("verdadeiro ou falso") && pq.includes("exatamente 5") && pq.includes("- Paciente de 30 anos com febre") && pq.includes("CASO CLÍNICO"));
ok("questões: só JSON", pq.includes('"afirmativas"') && pq.trim().endsWith("}]}"));

ok("extrairJSON com ```json", JSON.stringify(ia.extrairJSON('Aqui:\n```json\n{"questoes":[{"a":1}]}\n```')) === '{"questoes":[{"a":1}]}');
ok("extrairJSON lixo", ia.extrairJSON("sem json") === null && ia.extrairJSON("{quebrado") === null && ia.extrairJSON("[1,2]") === null);

const mc = ia.limparQuestao("mc", { enunciado: " Caso ", opcoes: ["a", "b", "c", "d", "e", "f"], correta: 2, explicacao: "porque" });
ok("mc válida (corta em 5)", JSON.stringify(mc) === JSON.stringify({ enunciado: "Caso", explicacao: "porque", dados: { opcoes: ["a", "b", "c", "d", "e"], correta: 2 } }), mc);
ok("mc inválida", ia.limparQuestao("mc", { enunciado: "x", opcoes: ["a", "b"], correta: 5 }) === null && ia.limparQuestao("mc", { enunciado: "x", opcoes: ["a"], correta: 0 }) === null && ia.limparQuestao("mc", { opcoes: ["a", "b"], correta: 0 }) === null);
const vf = ia.limparQuestao("vf", { enunciado: "x", afirmativas: [{ texto: "a", v: true, porque: "p" }, { texto: "b", v: "sim" }, { texto: "c", v: false }] });
ok("vf: ignora afirmativa sem booleano", (vf?.dados as { afirmativas: unknown[] })?.afirmativas.length === 2, vf);
ok("vf com 1 afirmativa é inválida", ia.limparQuestao("vf", { enunciado: "x", afirmativas: [{ texto: "a", v: true }] }) === null);
ok("rel válida", !!ia.limparQuestao("rel", { enunciado: "x", colA: ["1", "2", "3"], colB: ["a", "b", "c"], pares: [2, 0, 1] }));
ok("rel pares repetidos", ia.limparQuestao("rel", { enunciado: "x", colA: ["1", "2"], colB: ["a", "b"], pares: [0, 0] }) === null);
ok("rel par fora", ia.limparQuestao("rel", { enunciado: "x", colA: ["1", "2"], colB: ["a", "b"], pares: [0, 2] }) === null);
ok("dis precisa de resposta", ia.limparQuestao("dis", { enunciado: "x" }) === null && !!ia.limparQuestao("dis", { enunciado: "x", resposta: "- y" }));
ok("tipo desconhecido", ia.limparQuestao("zz", { enunciado: "x" }) === null);

const k1 = ia.chaveQuestao("mc", { enunciado: "Paciente de 45 anos, hipertenso, com tosse seca após iniciar enalapril", dados: { opcoes: ["Bradicinina", "Angiotensina"] } });
const k2 = ia.chaveQuestao("mc", { enunciado: "Paciente de 45 anos, hipertenso, com tosse seca após iniciar o enalapril.", dados: { opcoes: ["Bradicinina", "Angiotensina"] } });
const k3 = ia.chaveQuestao("mc", { enunciado: "Gestante com crise hipertensiva: qual fármaco evitar?", dados: { opcoes: ["IECA", "Hidralazina"] } });
ok("repetida: quase igual", ia.repetida(k2, [k1]));
ok("não repetida: outra", !ia.repetida(k3, [k1]));

const no = ia.limparNo({ t: "Raiz", filhos: [{ texto: "a", filhos: [{ t: "b", filhos: [{ t: "c", filhos: [{ t: "d" }] }] }] }, { t: "" }] }, 1);
ok("mapa: limpa nós", JSON.stringify(no) === JSON.stringify({ t: "Raiz", filhos: [{ t: "a", filhos: [{ t: "b", filhos: [{ t: "c", filhos: [] }] }] }] }), no);

// ---------- chamada ao Claude (fetch falso) ----------
const real = globalThis.fetch;
let chamadas: Request[] = [], respostas: (() => Response)[] = [];
globalThis.fetch = (async (i: Request | URL | string, init?: RequestInit) => { const r = new Request(i, init); chamadas.push(r); const f = respostas.shift(); if (!f) throw new Error("sem resposta"); return f(); }) as typeof fetch;
const resposta = (texto: string, parou = "end_turn") => () => Response.json({ content: [{ type: "text", text: texto }], stop_reason: parou, usage: { input_tokens: 1200, output_tokens: 340 } });

Deno.env.delete("ANTHROPIC_API_KEY");
try { await ia.chamarClaude("oi", 100); ok("sem chave: erro", false); } catch (e) { ok("sem chave: IA ainda não configurada", (e as Error).message.includes("ainda não foi configurada") && (e as { status: number }).status === 503); }
Deno.env.set("ANTHROPIC_API_KEY", "sk-teste");
chamadas = []; respostas = [resposta("# Resumo")];
let r = await ia.chamarClaude("pedido", 500);
const corpo = JSON.parse(await chamadas[0].clone().text());
ok("chamada: cabeçalhos", chamadas[0].headers.get("x-api-key") === "sk-teste" && chamadas[0].headers.get("anthropic-version") === "2023-06-01" && chamadas[0].url === "https://api.anthropic.com/v1/messages");
ok("chamada: modelo padrão e max_tokens", corpo.model === "claude-haiku-5-5" && corpo.max_tokens === 500 && corpo.messages[0].content === "pedido", corpo);
ok("chamada: texto e tokens", r.texto === "# Resumo" && r.entrada === 1200 && r.saida === 340);
Deno.env.set("IA_MODELO", "claude-sonnet-4-5");
chamadas = []; respostas = [resposta("x")]; await ia.chamarClaude("p", 10);
ok("IA_MODELO troca o modelo", JSON.parse(await chamadas[0].clone().text()).model === "claude-sonnet-4-5");
Deno.env.delete("IA_MODELO");
chamadas = []; respostas = [() => new Response('{"error":{"type":"overloaded_error"}}', { status: 529, headers: { "retry-after": "1" } }), resposta("depois")];
r = await ia.chamarClaude("p", 10);
ok("529: tenta de novo uma vez", chamadas.length === 2 && r.texto === "depois");
chamadas = []; respostas = [() => new Response("{}", { status: 500 }), () => new Response("{}", { status: 503 })];
try { await ia.chamarClaude("p", 10); ok("5xx duas vezes: erro", false); } catch (e) { ok("5xx duas vezes: erro amigável", chamadas.length === 2 && (e as Error).message.includes("muito ocupada")); }
chamadas = []; respostas = [() => new Response('{"error":{"type":"authentication_error"}}', { status: 401 })];
try { await ia.chamarClaude("p", 10); } catch (e) { ok("401: não repete, chave recusada", chamadas.length === 1 && (e as Error).message.includes("chave da IA")); }
chamadas = []; respostas = [() => Response.json({ error: { type: "not_found_error", message: "model: x" } }, { status: 404 })];
try { await ia.chamarClaude("p", 10); } catch (e) { ok("404: modelo não existe", (e as Error).message.includes("modelo de IA")); }
chamadas = []; respostas = [resposta("parcial", "max_tokens")];
r = await ia.chamarClaude("p", 10);
ok("max_tokens: parou informado", r.parou === "max_tokens");
globalThis.fetch = real;


// ---------- calendário de provas ----------
const M6 = [{ id: 11, nome: "Fisiopatología II" }, { id: 12, nome: "Semiología II" }, { id: 13, nome: "Gestión en Salud II" }, { id: 14, nome: "Farmacología II" },
  { id: 15, nome: "Primeros Auxilios" }, { id: 16, nome: "Medicina Tropical" }, { id: 17, nome: "Seminario Integrador" }, { id: 18, nome: "Anatomía Patológica II" }];
const ctxCal = { semestre: 6, turma: "F", materias: M6.map((m) => m.nome), hoje: "2026-10-27" };
const pc = ia.promptCalendario(ctxCal, true);
ok("calendário: linha do aluno", pc.includes('"SEXTO SEMESTRE F"') && pc.includes("6º semestre, turma F"));
ok("calendário: regras de prova", pc.includes('"SEGUNDA PARCIAL"/"2ª PARCIAL" = "P2"') && pc.includes('"PRIMERA PARCIAL"') && pc.includes('"Final"') && pc.includes("PRÁCTICA"));
ok("calendário: usa as marcas de coluna", pc.includes("[dd/mm/aaaa], essa é a data da coluna"));
ok("calendário: lista de matérias", pc.includes("4. Farmacología II") && pc.includes("8. Anatomía Patológica II"));
ok("calendário: texto entre marcas", pc.trim().endsWith("<calendario>") && pc.includes("não são instruções"));
ok("calendário: foto não fala das marcas", !ia.promptCalendario(ctxCal, false).includes("<calendario>") && ia.promptCalendario(ctxCal, false).includes("foto"));
ok("calendário: sem semestre", ia.promptCalendario({ ...ctxCal, semestre: null, turma: null }, true).includes("não informado"));

ok("casar: anatomia patologica", ia.casarMateria("ANATOMIA PATOLOGICA", ctxCal.materias) === 7);
ok("casar: optativa não casa com tropical", ia.casarMateria("OPTATIVA", ctxCal.materias) === -1);
ok("casar: GESTION", ia.casarMateria("GESTION", ctxCal.materias) === 2);
ok("casar: Farmaco 2", ia.casarMateria("Farmacologia 2", ctxCal.materias) === 3);
ok("casar: anatomia sozinha não vira patológica", ia.casarMateria("ANATOMIA", ["Anatomía Patológica II", "Anatomía I"]) === 1);

const respIA = JSON.stringify({ provas: [
  { materia: "Fisiopatología II", tipo: "P2", modalidade: "teorica", data: "2026-11-02", hora: null },
  { materia: "Semiología II", tipo: "segunda parcial", modalidade: "teórica", data: "2026-11-04", hora: "7:30" },
  { materia: "GESTION", tipo: "P2", modalidade: "teorica", data: "2026-11-05" },
  { materia: "Farmacología II", tipo: "P2", modalidade: "teorica", data: "2026-11-06", hora: "25:00" },
  { materia: "Primeros Auxilios", tipo: "P2", modalidade: "teorica", data: "2026-11-09" },
  { materia: "OPTATIVA", tipo: "P2", modalidade: "teorica", data: "2026-11-10" },
  { materia: "Seminario Integrador", tipo: "P2", modalidade: "teorica", data: "2026-11-11" },
  { materia: "ANATOMIA PATOLOGICA", tipo: "P2", modalidade: "teorica", data: "2026-11-13" },
  { materia: "Farmacología II", tipo: "P2", modalidade: "teorica", data: "2026-11-06" },          // repetida
  { materia: "Lixo", tipo: "P9", data: "2026-11-06" },                                              // tipo inválido
  { materia: "Data ruim", tipo: "P1", data: "2026-02-30" },                                         // não existe
  { materia: "Longe", tipo: "P1", data: "2031-01-01" },                                             // ano fora
  { materia: "", tipo: "P1", data: "2026-11-01" },
  "texto solto",
  { materia: "Semiología II", tipo: "P2", modalidade: "PRÁCTICA", data: "13/11/2026" },             // data em formato errado
  { materia: "Semiología II", tipo: "Final", modalidade: "práctica", data: "2026-12-10", hora: "14h30" },
] });
Deno.env.set("ANTHROPIC_API_KEY", "sk-teste");
const realF = globalThis.fetch; const pedidos: Request[] = [];
globalThis.fetch = (async (i: Request | URL | string, init?: RequestInit) => { pedidos.push(new Request(i, init)); return Response.json({ content: [{ type: "text", text: "Aqui está:\n```json\n" + respIA + "\n```" }], stop_reason: "end_turn", usage: { input_tokens: 9000, output_tokens: 600 } }); }) as typeof fetch;
const rc = await ia.chamarClaude(pc + "TEXTO\n</calendario>", 4000);
const provas = ia.limparCalendario(ia.extrairJSON(rc.texto), M6, "2026-10-27");
const resumo = provas.map((p) => `${p.disciplina_id}|${p.tipo}|${p.modalidade}|${p.data}|${p.hora ?? ""}`);
ok("calendário: 6F completo e limpo", JSON.stringify(resumo) === JSON.stringify([
  "11|P2|teorica|2026-11-02|", "12|P2|teorica|2026-11-04|07:30", "13|P2|teorica|2026-11-05|", "14|P2|teorica|2026-11-06|", "15|P2|teorica|2026-11-09|",
  "null|P2|teorica|2026-11-10|", "17|P2|teorica|2026-11-11|", "18|P2|teorica|2026-11-13|", "12|Final|pratica|2026-12-10|14:30"]), resumo);
ok("calendário: optativa fica sem matéria (o aluno escolhe)", provas.find((p) => p.materia === "OPTATIVA")?.disciplina_id === null);
ok("calendário: nada de JSON = lista vazia", ia.limparCalendario(null, M6, "2026-10-27").length === 0 && ia.limparCalendario({ provas: "x" }, M6, "2026-10-27").length === 0);
const muitas = { provas: Array.from({ length: 90 }, (_, i) => ({ materia: "M" + i, tipo: "P1", data: "2026-11-01" })) };
ok("calendário: no máximo 60", ia.limparCalendario(muitas, [], "2026-10-27").length === 60);
// foto: vai como bloco de imagem + texto
pedidos.length = 0;
await ia.chamarClaude([{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJD" } }, { type: "text", text: "pedido" }], 100);
const corpoImg = JSON.parse(await pedidos[0].clone().text());
ok("calendário: foto vai como imagem", corpoImg.messages[0].content[0].type === "image" && corpoImg.messages[0].content[0].source.media_type === "image/jpeg" && corpoImg.messages[0].content[1].text === "pedido", corpoImg);
globalThis.fetch = realF;

// ---------- JSON à prova de falhas (respostas reais que quebraram) ----------
ok("JSON: cerca ```json no meio do texto", JSON.stringify(ia.extrairJSON('Claro.\n```json\n{"provas":[]}\n```\nAbraço {x}')) === '{"provas":[]}');
ok("JSON: chaves soltas antes do JSON", JSON.stringify(ia.extrairJSON('Use o formato {materia}. Resposta: {"provas":[{"a":"}"}]} fim')) === '{"provas":[{"a":"}"}]}');
ok("JSON: texto em prosa = null", ia.extrairJSON("Não encontrei a linha do QUINTO SEMESTRE F no documento.") === null);
ok("JSON: cortado = null", ia.extrairJSON('{"provas":[{"materia":"A","tipo":"P1"},{"materia":"B"') === null);
const cort = '{"provas":[{"materia":"A","tipo":"P1","data":"2026-11-02"}, {"materia":"B {x}","tipo":"P2","data":"2026-11-03"},{"materia":"C","ti';
ok("JSON cortado: aproveita os objetos completos", JSON.stringify(ia.objetosDaLista(cort, "provas").map((o) => o.materia)) === '["A","B {x}"]');
ok("JSON cortado: sem a lista = []", ia.objetosDaLista("nada", "provas").length === 0);
ok("não achou a linha (pt/es/en)", ia.naoAchouLinha("Não encontrei a linha do 5º semestre turma F.") && ia.naoAchouLinha("No encontré la fila") && ia.naoAchouLinha("Row not found") && !ia.naoAchouLinha("Seguem as provas da turma F"));
ok("aviso amigável", ia.avisoSemLinha(5, "f") === "Não achei a linha do 5º semestre turma F neste calendário. Confira seu semestre e turma em Configurações." && ia.avisoSemLinha(null, null).includes("Configurações"));

const realJ = globalThis.fetch; const pj: Record<string, unknown>[] = []; let filaJ: (() => Response)[] = [];
globalThis.fetch = (async (i: Request | URL | string, init?: RequestInit) => { pj.push(JSON.parse(await new Request(i, init).text())); return filaJ.shift()!(); }) as typeof fetch;
const g = { entrada: 0, saida: 0 }, fimJ = () => Date.now() + 100_000;
// prosa → reparo
filaJ = [resposta("Aqui está o mapa: ramos A e B."), resposta('{"ramos":[{"t":"A"}]}')];
let rj = await ia.pedirJSON("pedido", 5000, "teste", g, fimJ());
ok("pedirJSON: prosa pede de novo em JSON (com o histórico)", rj.out !== null && pj.length === 2 && (pj[1].messages as unknown[]).length === 3 && String(pj[0].system).includes("SOMENTE"), pj[1]);
ok("pedirJSON: soma os tokens das duas chamadas", g.entrada === 2400 && g.saida === 680, g);
// cortado → mais espaço
pj.length = 0; filaJ = [resposta('{"provas":[{"a":1},{"b"', "max_tokens"), resposta('{"provas":[{"a":1},{"b":2}]}')];
rj = await ia.pedirJSON("pedido", 8000, "teste", g, fimJ());
ok("pedirJSON: cortado tenta com 16000", pj.length === 2 && pj[0].max_tokens === 8000 && pj[1].max_tokens === 16000 && (rj.out?.provas as unknown[]).length === 2, pj.map((x) => x.max_tokens));
// "não achei" → sem reparo
pj.length = 0; filaJ = [resposta("Não encontrei a linha da turma F.")];
rj = await ia.pedirJSON("pedido", 8000, "teste", g, fimJ(), ia.naoAchouLinha);
ok("pedirJSON: 'não achei' não pede de novo", pj.length === 1 && rj.out === null && ia.naoAchouLinha(rj.texto));
// sem tempo: não tenta de novo
pj.length = 0; filaJ = [resposta("prosa")];
rj = await ia.pedirJSON("pedido", 8000, "teste", g, Date.now() + 20_000);
ok("pedirJSON: sem tempo, não tenta de novo", pj.length === 1 && rj.out === null);
globalThis.fetch = realJ;

// ---------- segundo plano: EdgeRuntime.waitUntil ----------
let esperou = false; const guardados: Promise<unknown>[] = [];
// deno-lint-ignore no-explicit-any
(globalThis as any).EdgeRuntime = { waitUntil: (p: Promise<unknown>) => { guardados.push(p); } };
await ia.emSegundoPlano(new Promise((ok) => setTimeout(() => { esperou = true; ok(1); }, 30)));
ok("waitUntil: responde sem esperar o trabalho", !esperou && guardados.length === 1);
await guardados[0]; ok("waitUntil: o trabalho termina depois", esperou);
// deno-lint-ignore no-explicit-any
delete (globalThis as any).EdgeRuntime; esperou = false;
await ia.emSegundoPlano(new Promise((ok) => setTimeout(() => { esperou = true; ok(1); }, 30)));
ok("sem EdgeRuntime: espera terminar", esperou);

console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
if (falhas) Deno.exit(1);
