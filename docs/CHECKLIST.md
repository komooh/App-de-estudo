# Checklist de qualidade do site

Duas listas que guiam o projeto: o que um site profissional precisa ter por baixo (as "peças" de um SaaS) e o que evitar para não parecer feito às pressas com IA.

## As 13 peças de um SaaS

| # | Peça | Como fica no nosso site | Situação |
| --- | --- | --- | --- |
| 1 | Servidor (site no ar 24h) | Cloudflare Pages | Pronto para publicar |
| 2 | Domínio próprio | A comprar quando o nome for decidido | Pendente |
| 3 | Banco de dados | Supabase (Postgres) | Pronto (`supabase/schema.sql`) |
| 4 | Login | Link mágico por e-mail, só para quem foi convidado | Pronto |
| 5 | Permissões | Regras do banco (RLS): cada aluno só vê o que é dele; aluno não muda plano nem vencimento | Pronto e testado |
| 6 | API entre a tela e o banco | Supabase + Edge Functions (criar aluno; Google Drive; IA na Etapa 3) | Parcial |
| 7 | Gateway de pagamento | Por enquanto pagamento por fora (Pix/transferência); Mercado Pago ou Pagopar depois | Fora da versão 1 |
| 8 | Webhook do pagamento | Só quando houver gateway | Fora da versão 1 |
| 9 | Cobrança recorrente | Hoje: vencimento controlado no painel do administrador | Manual |
| 10 | E-mail transacional | Hoje: e-mail gratuito do Supabase (cerca de 2 por hora). Antes do teste fechado: Resend com domínio próprio | Pendente |
| 11 | Chaves fora do código | Só a chave pública no navegador; chave de serviço, chave do Claude e chaves do Google ficam no servidor (a conexão do Google de cada aluno fica criptografada no banco) | Pronto |
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
| 14 | Sem selo "feito com IA" | Ok. O aviso de que os resumos são gerados por IA continua, porque é sobre o conteúdo, não sobre o site |
| 15 | Política de privacidade | Rascunho feito (`privacidade.html`); falta o e-mail de contato |
| 16 | Termos e condições | Rascunho feito (`termos.html`); falta o e-mail de contato |
