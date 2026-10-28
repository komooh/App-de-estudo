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

## Etapa 4: o que foi testado
- Banco: 01 a 06 rodados duas vezes seguidas num Postgres de teste; cada aluno só vê e muda o que é dele; aluno não grava resumos/questões/mapas, não muda limites, não grava texto em material de outro, não liga horário/tema/prova a matéria de outro e não envia lâmina na pasta de outro.
- Funções `ia` e `drive-arquivo`: testes com a IA e o Google falsos (sem gastar), incluindo limite do mês, falha da IA (o uso é devolvido), questões repetidas descartadas e IA sem chave.
- Telas: todas as abas no computador e no celular (390 px), sem rolagem lateral, sem erros, com textos do aluno e da IA escapados (teste com código malicioso nos nomes e no resumo).


## Etapa 7: o que foi testado
- Banco: 01 a 09 rodados duas vezes seguidas num Postgres de teste. Cada aluno só vê os próprios aceites (admin vê todos); `aceitar_termos` só grava para o próprio aluno e só a versão atual; ninguém (nem o admin) muda `termos_versao`/`termos_aceitos_em` direto; o registro de aceites não aceita insert/update/delete pelo site e nem update pelo SQL Editor; apagar a conta apaga os aceites; contas vencidas e bloqueadas podem aceitar, mas continuam sem acesso aos dados.
- Telas: tela de aceite para aluno novo (antes da configuração), botão só liga com os 5 itens, teclado e rótulos, versão nova pede de novo, versão mudando no meio pede para recarregar, "Recusar" sai, "Esqueci a senha" vem antes da tela, admin também aceita, coluna Termos, sem o 09 o site segue como antes, créditos do rodapé com e sem inspiração (handle inválido não vira link), 390 px sem rolagem lateral, sem erros no console.
- Memória do resumo: coluna com limite de 1500 letras e as mesmas regras de acesso das preferências (aluno só lê e muda a dele; vencido não grava). Função `ia`: sem memória e sem pedido, o pedido à IA é idêntico ao de antes (conferido por hash); memória, pedido extra, os dois juntos, tentativa de "ignore as regras" (fica como dado, não fecha as marcas) e limites de tamanho testados. Telas: salvar, exemplos, contador, limpar, modelo completo no mesmo cartão, pedido só para este resumo na ficha, 390 px, sem erros no console.
