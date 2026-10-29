# Checklist de qualidade do site

Duas listas que guiam o projeto: o que um site profissional precisa ter por baixo (as "peças" de um SaaS) e o que evitar para não parecer feito às pressas com IA.

## As 13 peças de um SaaS

| # | Peça | Como fica no nosso site | Situação |
| --- | --- | --- | --- |
| 1 | Servidor (site no ar 24h) | Cloudflare Pages | Pronto para publicar |
| 2 | Domínio próprio | A comprar quando o nome for decidido | Pendente |
| 3 | Banco de dados | Supabase (Postgres). Histórico por semestre (`04_semestres.sql`); livros só como texto, com limite por aluno (`05_livros.sql`) para caber nos 500 MB do plano grátis; painel de estudo (`06_estudo.sql`); imagens do laminário numa pasta privada, até 300 por aluno (cerca de 90 MB do 1 GB grátis de arquivos) | Pronto |
| 4 | Login | Link mágico por e-mail, só para quem foi convidado | Pronto |
| 5 | Permissões | Regras do banco (RLS): cada aluno só vê o que é dele (semestres, livros, questões, resumos, mapas, lâminas, agenda, aulas, calendário e vida acadêmica também); aluno não muda plano, vencimento nem limites de IA; resumos, mapas e questões só o servidor grava; o texto dos PDFs só entra pelo material do próprio aluno | Pronto e testado |
| 6 | API entre a tela e o banco | Supabase + Edge Functions (criar aluno; Google Drive; arquivos do Drive; IA com limite mensal por aluno) | Pronto |
| 7 | Gateway de pagamento | Por enquanto pagamento por fora (Pix/transferência); Mercado Pago ou Pagopar depois | Fora da versão 1 |
| 8 | Webhook do pagamento | Só quando houver gateway | Fora da versão 1 |
| 9 | Cobrança recorrente | Hoje: vencimento controlado no painel do administrador | Manual |
| 10 | E-mail transacional | Hoje: e-mail gratuito do Supabase (cerca de 2 por hora). Antes do teste fechado: Resend com domínio próprio | Pendente |
| 11 | Chaves fora do código | Só a chave pública no navegador; chave de serviço, chave do Claude (`ANTHROPIC_API_KEY`) e chaves do Google ficam nos segredos do Supabase (a conexão do Google de cada aluno fica criptografada no banco). O pedido para a IA é montado no servidor, nunca no navegador | Pronto |
| 12 | Aviso se o site cair | Monitor gratuito (UptimeRobot ou Cloudflare) mandando alerta no celular | Pendente |
| 13 | Backup do banco | Supabase Pro faz backup diário; até lá, exportação semanal | Pendente |

## 16 regras para não parecer feito com "vibe code"

| # | Regra | Situação |
| --- | --- | --- |
| 1 | Sem gradiente roxo | Ok: paleta própria (papel, terracota, verde) |
| 2 | Sem botões em formato de pílula | Ok: botões com canto levemente arredondado |
| 3 | Sem avaliações falsas | Ok: nenhuma; só depoimentos reais dos colegas do teste, com permissão |
| 4 | Sem métricas falsas ("+10 mil alunos") | Ok: nenhuma |
| 5 | Sem texto vago no topo | Ok: a entrada diz o que fazer ("digite o e-mail") |
| 6 | Sem ícones de emoji | Ok: nenhum |
| 7 | Sem travessões no texto | Ok: revisado |
| 8 | Sem animação exagerada | Ok: só transições discretas |
| 9 | Sem fotos falsas geradas por IA | Ok: nenhuma |
| 10 | Sem animação de cursor | Ok |
| 11 | Sem contadores falsos | Ok |
| 12 | Domínio próprio | Pendente (ver peça 2) |
| 13 | Favicon | Feito (`favicon.svg`) |
| 14 | Sem selo "feito com IA" | Ok: sem selo. O aviso de que os resumos são gerados por IA continua (é sobre o conteúdo). No rodapé há só uma linha de crédito em texto, a pedido do dono: "Desenvolvido com Claude, da Anthropic" (sem logo; some se `DESENVOLVIDO_COM` ficar vazio) |
| 15 | Política de privacidade | Modelo completo (`privacidade.html`, com resumo em espanhol), igual ao que o site coleta de verdade. Falta: preencher lei/foro e revisão de advogado |
| 16 | Termos e condições | Modelo completo (`termos.html`, com resumo em espanhol) e aceite obrigatório com versão (`09_termos.sql`). Falta: preencher lei/foro e revisão de advogado |

## Regra das telas: abas informativas, cadastros em Configurações
- As abas do painel (Agenda, Disciplinas, Questões, Média, Aulas, Calendário, Vida acadêmica, Laminário) **só mostram** os dados e servem para estudar (marcar tema estudado, resumo, mapa, questões, treinar lâminas, notas da Média, status do evento, certificado, "Provas sem data" na Agenda).
- Gerar material de estudo (resumo, mapa mental, questões, flash cards, painel do tema) é estudar: fica nas abas, e a IA só roda quando o aluno clica.
- **Todo formulário ou botão de adicionar/cadastrar fica em Configurações**, em cartões que abrem e fecham (matérias e semestres, conteúdos e materiais, calendário e avaliações, aulas e horários, vida acadêmica, laminário, enviar arquivos, importar documento, ajustes da agenda). Remover e editar itens fica junto da lista no mesmo cartão.
- Onde a aba perdeu o formulário, fica uma dica discreta com link para o cartão certo; os vazios também apontam para Configurações.
- Teste automático (`cadastros.js`): nenhuma aba tem `form[data-form^=add]`, botão de adicionar, campo de arquivo ou botão de remover; cada cadastro existe em Configurações e cria o item.

## Etapa 4: o que foi testado
- Banco: 01 a 06 rodados duas vezes seguidas num Postgres de teste; cada aluno só vê e muda o que é dele; aluno não grava resumos/questões/mapas, não muda limites, não grava texto em material de outro, não liga horário/tema/prova a matéria de outro e não envia lâmina na pasta de outro.
- Funções `ia` e `drive-arquivo`: testes com a IA e o Google falsos (sem gastar), incluindo limite do mês, falha da IA (o uso é devolvido), questões repetidas descartadas e IA sem chave.
- Telas: todas as abas no computador e no celular (390 px), sem rolagem lateral, sem erros, com textos do aluno e da IA escapados (teste com código malicioso nos nomes e no resumo).


## Etapa 7: o que foi testado
- Banco: 01 a 09 rodados duas vezes seguidas num Postgres de teste. Cada aluno só vê os próprios aceites (admin vê todos); `aceitar_termos` só grava para o próprio aluno e só a versão atual; ninguém (nem o admin) muda `termos_versao`/`termos_aceitos_em` direto; o registro de aceites não aceita insert/update/delete pelo site e nem update pelo SQL Editor; apagar a conta apaga os aceites; contas vencidas e bloqueadas podem aceitar, mas continuam sem acesso aos dados.
- Telas: tela de aceite para aluno novo (antes da configuração), botão só liga com os 5 itens, teclado e rótulos, versão nova pede de novo, versão mudando no meio pede para recarregar, "Recusar" sai, "Esqueci a senha" vem antes da tela, admin também aceita, coluna Termos, sem o 09 o site segue como antes, créditos do rodapé com e sem inspiração (handle inválido não vira link), 390 px sem rolagem lateral, sem erros no console.
- Memória do resumo: coluna com limite de 1500 letras e as mesmas regras de acesso das preferências (aluno só lê e muda a dele; vencido não grava). Função `ia`: sem memória e sem pedido, o pedido à IA é idêntico ao de antes (conferido por hash); memória, pedido extra, os dois juntos, tentativa de "ignore as regras" (fica como dado, não fecha as marcas) e limites de tamanho testados. Telas: salvar, exemplos, contador, limpar, modelo completo no mesmo cartão, pedido só para este resumo na ficha, 390 px, sem erros no console.

## Etapa 8: importar do painel antigo, o que foi testado
- Painel antigo (com dados falsos num navegador sem tela): Configurações com nome, semestre e turma (só letras, até 2), nome no cabeçalho e na saudação (escapado), "Trocar de semestre" guarda o atual e começa outro sem perder nada (e "Apagar todos os dados" mantém os semestres guardados), "Baixar meus dados (para o site)" gera o .json versão 1 sem NotebookLM, material do professor, lâminas nem ids do painel; 390 px sem rolagem lateral.
- Banco: `11_importar_painel.sql` rodado duas vezes num Postgres de teste com 01 a 10. Aluno comum, anon e admin com acesso vencido são recusados; o admin só grava em temas e matérias dele; resumo e mapa que já existem não são trocados; questão repetida (chave do histórico ou mesmo enunciado) é pulada; limites de tamanho e de 200 itens por chamada.
- Tela (Supabase falso): cartão só para o admin (escondido e recusado no "servidor" para aluno), arquivos ruins recusados sem gravar nada (não JSON, versão errada, lista em formato errado, itens demais, extensão errada), revisão com as contagens e as caixinhas, nada gravado antes de confirmar, importação com ~30 itens de cada tipo (textos maliciosos, grandes demais, repetidos e inválidos), resultado por tipo, lista de erros (.csv, sem fórmulas), lotes de até 200, segunda importação sem duplicar nada, sem o 11 (resumos, mapas e questões com o aviso), tipos desmarcados, modelo do resumo que só troca se marcar, nada de XSS em nenhuma aba, 390 px e 1280 px sem rolagem lateral, sem erros no console.


## Etapa 10: o que foi testado
- Banco: 01 a 12 num Postgres de teste, com o `12_estudo_extra.sql` rodado duas vezes seguidas. Flash cards: só o servidor grava; o aluno lê os dele, apaga e só muda a caixa e a data da revisão (frente/verso não); outro aluno e conta vencida não veem; apagar o tema apaga os cards. Painel: um por tema, só o servidor grava, o aluno lê e apaga. Limite de flash cards: contador no mês, recusa ao passar do limite, aluno não muda o próprio limite (só o admin). Memória de estudo: 4 colunas novas com até 1500 letras, cada aluno só grava a dele; tarefas aceitam os tipos novos.
- Função `ia` (IA falsa): limpeza dos flash cards (tamanhos, repetidos entre si e com os que o aluno já tem, no máximo 30) e do painel (tabela com linhas do tamanho das colunas, listas sem repetidos, painel vazio não é salvo); tema sem material nem resumo é recusado antes de gastar; sem memória, os pedidos de questões e mapa são idênticos aos de antes (conferido por hash); memória como dado, sem fechar as marcas.
- Telas (Supabase falso, 1280 px e 390 px, sem rolagem lateral, sem erros no console, nomes maliciosos escapados): temas no Praticar e no Revisar erros (contagem, Todas/Nenhuma, total, escolha lembrada, sem sessionStorage); flash cards (gerar, virar com clique e teclado, Errei/Difícil/Acertei gravando a caixa, fim da rodada, embaralhar, gerar mais, apagar, revisão por matéria, sem animação); painel (todas as seções, seções vazias, checklist lembrado, impressão só do painel); memória de estudo (5 partes, salvar e limpar cada uma, rascunho entre abas, aviso sem o 12); envio de .ppt, .doc, .odp, .odt, .rtf, .xlsx, .xls e .html feitos no LibreOffice, vídeo e áudio recusados com aviso, .ppt quebrado com mensagem amigável, .ppt do Drive lido no navegador. Os testes antigos foram atualizados para o cartão único "Enviar arquivos e documentos" e continuam passando.

## Etapa 11: o que foi testado
- Banco: 01 a 12 e o `13_minha_conta.sql` rodado duas vezes num Postgres 16 de teste, chamando como o site chama (usuário `authenticator`, papel `authenticated`). Anônimo e aluno sem login são recusados; a função interna que lista as tabelas não pode ser chamada pelo site. "Apagar meus dados" apaga só as linhas de quem chamou (o outro aluno fica intacto, 29 de 29 linhas), mantém perfil, aceite dos termos e uso de IA do mês (contador continua em 77), volta o perfil para "não configurado" (nome, usuário, plano, vencimento, admin e limites ficam) e roda de novo sem erro (0 linhas). Funciona com arquivo do Drive oculto e com as proteções de sempre: apagar um arquivo do Drive pelo site continua só ocultando. "Excluir minha conta" recusa o administrador; para aluno, apaga dados, perfil e login.
- Telas (Supabase falso, 1280 px e 390 px, sem rolagem lateral, sem erros no console): aviso "Sua sessão terminou" com o evento SIGNED_OUT (modal, foco, Esc não fecha, "Entrar de novo" vai para o login), ao voltar para a aba com o token vencido e a renovação falhando, com 401 da função `ia` (renova e repete sem o aluno perceber; se a renovação falha, aviso e a frase simples no lugar de "Sessão inválida"), com "permission denied for table drive_fontes" (renova e carrega; se não der, aviso e a frase simples no cartão), também em admin.html; "Sair" não mostra o aviso; a fila do IndexedDB continua guardada. Conteúdo em lista (troca com a disciplina, "Outro conteúdo" abre a caixa com foco, envia o nome e o id certos do tema, não envia sem escolher; Laminário igual). Minha conta (último cartão, APAGAR em qualquer caixa libera o botão, Esc cancela, apaga só as pastas do aluno no Storage, limpa o painel do navegador e a fila, mostra a configuração inicial depois; excluir apaga os arquivos antes da conta e sai sem o aviso de sessão; admin sem "Excluir"; sem o 13 o botão fica desligado); rodapé logado e sem login. Os testes antigos da Etapa 10 foram atualizados (Conteúdo agora é lista; cartão Minha conta no fim) e continuam passando.

## Etapa 13: escolher a matéria de cada arquivo do Drive
- Passos do dono: rodar `supabase/14_materia_manual.sql` (depois do 13) e republicar a função `drive-varrer` (Verify JWT desligado). Sem o SQL, a leitura da pasta continua funcionando como antes.
- Em Configurações → Meu Google Drive, cada arquivo (inclusive os de "Sem matéria") tem uma lista para escolher a matéria. A escolha fica marcada (`materia_manual`) e a próxima leitura da pasta não muda. O tema vazio que sobrou na matéria antiga sai junto.
- Testes: `mat13.js` (computador e celular, 14 OK); SQL rodado duas vezes num Postgres 16 de teste: outro aluno não mexe no arquivo, matéria de outro aluno é recusada, anônimo é recusado.
