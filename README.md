# Painel de Estudos

Site de estudos por assinatura para alunos de medicina. Cada aluno tem o próprio painel: matérias, calendário de provas, agenda, resumos e questões.

- **Hospedagem:** Cloudflare Pages (site estático, sem etapa de build)
- **Login e banco de dados:** Supabase (link mágico por e-mail, regras de acesso por aluno)
- **IA:** API do Claude (modelo Claude Haiku 5.5), chamada só pelo servidor (função `ia` do Supabase), e só quando o aluno pede

## Páginas

| Arquivo | O que é |
| --- | --- |
| `index.html` | Entrada: o aluno pede o link de acesso por e-mail |
| `app.html` | Painel do aluno; na primeira entrada, a configuração guiada em 4 passos |
| `admin.html` | Painel do administrador: criar aluno, plano, vencimento, liberar ou bloquear |
| `supabase/schema.sql` | Tabelas e regras de acesso do banco |
| `supabase/functions/admin-criar-aluno` | Função no servidor que cria a conta e manda o convite |
| `supabase/03_drive.sql` | Tabelas do Google Drive (pastas ligadas, conexão e materiais) |
| `supabase/functions/drive-oauth` | Função do botão "Entrar com o Google" |
| `supabase/functions/drive-varrer` | Função que lê a pasta do Drive, liga os arquivos às matérias e cria os temas |
| `supabase/04_semestres.sql` | Semestres de cada aluno (o histórico fica guardado) e a lista de matérias de cada semestre |
| `supabase/05_livros.sql` | Livros dos alunos (só o texto) e a busca dentro deles |
| `supabase/06_estudo.sql` | O painel de estudo: questões, resumos, mapas, agenda, aulas, calendário, vida acadêmica, laminário e limites de IA |
| `supabase/functions/ia` | Função que faz resumos, mapas mentais e questões com o Claude |
| `supabase/functions/drive-arquivo` | Função que entrega ao navegador os PDF/Word/PowerPoint do Drive para ele ler o texto |
| `assets/painel.js` | As abas do painel (Agenda, Disciplinas, Questões, Média, Aulas, Calendário, Vida acadêmica, Laminário) e a tela Configurações |
| `assets/leitor.js` | Leitura de arquivos no navegador (texto do PDF com as colunas, nome do tema, calendário) |
| `supabase/07_uploads.sql` | Enviar arquivos sem o Drive e o limite de importações do calendário |
| `supabase/08_tarefas.sql` | Tarefas da IA em segundo plano, turma só com letras, e-mail do perfil, arquivos do Drive ocultos, documentos importados |
| `assets/fila.js` | Fila do navegador (ler e enviar arquivos e livros; continua neste aparelho) |
| `assets/tarefas.js` | Botão e painel Tarefas (o que está rodando e o que ficou pronto) |
| `supabase/09_termos.sql` | Aceite dos termos de uso: versão atual, aceite de cada aluno e registro dos aceites |
| `supabase/10_memoria_resumo.sql` | Memória do resumo (como o aluno quer os resumos, em texto livre) |
| `assets/importar.js` | Configurações → Importar dados do painel antigo (só o administrador) |
| `supabase/11_importar_painel.sql` | Função que grava os resumos, mapas e questões trazidos do painel antigo (só para o administrador) |
| `supabase/12_estudo_extra.sql` | Flash cards, painel do tema, limite de flash cards e memória de estudo (questões, mapa, flash cards e painel) |
| `assets/extrair.js` | Leitura do texto de todos os formatos no navegador: PDF, PowerPoint (.ppt e .pptx), Word (.doc e .docx), Excel, OpenDocument (.odp, .odt, .ods), .rtf, .csv, .html, .txt e .md |
| `assets/conta.js` | Configurações → Minha conta (e Meu perfil → Minha conta): apagar os dados e começar do zero, ou excluir a conta |
| `supabase/13_minha_conta.sql` | Funções que apagam os dados do aluno logado (e a conta, se ele pedir) |
| `termos.html`, `privacidade.html` | Termos de uso e política de privacidade (modelo; revisar com advogado) |

## Como colocar no ar (uma vez)

### 1. Banco de dados (Supabase)
1. Supabase → **SQL Editor** → **New query**. Cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**. Depois faça o mesmo com `supabase/02_perfil_foto_senha.sql` (nome de usuário e foto de perfil).
2. **Authentication → Sign In / Providers → Email**: deixe o Email ligado e **desligue "Allow new users to sign up"**. Assim só entra quem o administrador convidar.
3. **Authentication → URL Configuration**: em **Site URL** coloque o endereço do site (ex.: `https://app-de-estudo.pages.dev`) e em **Redirect URLs** adicione `https://app-de-estudo.pages.dev/**`.

### 2. Sua conta de administrador
1. **Authentication → Users → Add user → Create new user**, com o seu e-mail, uma senha e **Auto Confirm User** marcado.
2. No **SQL Editor**, rode (trocando o e-mail):
   ```sql
   update public.perfis set is_admin = true, ativo = true where email = 'seu@email.com';
   ```

### 3. Função que cria alunos (Edge Function)
1. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nome: `admin-criar-aluno`. Cole o conteúdo de `supabase/functions/admin-criar-aluno/index.ts` e clique em **Deploy**.
3. Não precisa configurar chave: o Supabase já entrega a chave de serviço para a função, e ela nunca vai para o navegador.

### 4. Site (Cloudflare Pages)
1. Cloudflare → **Workers & Pages → Create → Pages → Connect to Git** → escolha o repositório `app-de-estudo`.
2. Framework preset: **None**. Build command: vazio. Build output directory: `/`.
3. Depois de publicado, cada `git push` atualiza o site sozinho.

### 5. Google Drive (importar os materiais dos alunos)
Cada aluno liga a pasta dele de um destes dois jeitos: **compartilhando a pasta** com o e-mail de leitura do site, ou **entrando com o Google**. O site lê a pasta e as subpastas, liga cada arquivo à matéria (pelo nome da subpasta) e cria um tema para cada arquivo. **Nenhum resumo é feito sozinho**: resumo só quando o aluno pede.

1. **Banco:** Supabase → **SQL Editor** → **New query**. Cole todo o `supabase/03_drive.sql` e clique em **Run**.
2. **Segredos** (já feitos): em **Edge Functions → Secrets** precisam existir `GOOGLE_SA_KEY` (o arquivo JSON inteiro da chave do e-mail de leitura), `GOOGLE_OAUTH_SECRET` e `GOOGLE_OAUTH_CLIENT_ID`. Se o nome do ID ficou como `OOGLE_OAUTH_CLIENT_ID` (sem o G), funciona também, mas o certo é corrigir para `GOOGLE_OAUTH_CLIENT_ID`.
3. **Função `drive-oauth`:** **Edge Functions → Deploy a new function → Via Editor**. Nome: `drive-oauth`. Apague o exemplo, cole todo o `supabase/functions/drive-oauth/index.ts` e clique em **Deploy**.
   - **Importante:** depois de publicar, abra a função → aba **Details** (ou **Settings**) → desligue **"Verify JWT with legacy secret"** (ou "Enforce JWT verification") e salve. O Google volta para essa função sem login do Supabase; se essa opção ficar ligada, o botão "Entrar com o Google" dá erro 401. A própria função confere o login do aluno nos outros pedidos.
4. **Função `drive-varrer`:** do mesmo jeito, nome `drive-varrer`, colando `supabase/functions/drive-varrer/index.ts`. Esta pode ficar com **Verify JWT ligado**.
5. O editor do Supabase publica **um arquivo só** por função. Por isso cada `index.ts` é completo, sem importar outros arquivos do projeto. Não separe em vários arquivos.
6. **Google Cloud** (já feito): a tela de permissão está em modo **Testing**, com o endereço de retorno `https://ksnmyjqzlhmqyshsebhj.supabase.co/functions/v1/drive-oauth`. Enquanto estiver em Testing:
   - só entram com o Google as contas cadastradas em **Google Auth Platform → Audience → Test users** (até 100). Cadastre o e-mail Google de cada aluno que for usar "Entrar com o Google". Quem só compartilha a pasta não precisa;
   - a conexão expira a cada 7 dias; o painel mostra "reconectar" e o aluno clica em **Conectar de novo**.
7. **Teste:** entre como aluno → janela **Meu Google Drive** → compartilhe uma pasta com o e-mail mostrado, cole o link e clique em **Ligar pasta**. Pastas grandes são lidas em várias rodadas: o próprio site continua sozinho até terminar.
8. **(Opcional) Ler as pastas sozinho todo dia:** no fim do `03_drive.sql` há um bloco comentado com o agendamento (pg_cron + pg_net + Vault). Só use se quiser.

Arquivos lidos: PDF com texto, PowerPoint (.ppt e .pptx), Word (.doc e .docx), Excel (.xls e .xlsx), OpenDocument (.odp, .odt, .ods), .rtf, .csv, .html, Google Docs, Google Slides, Google Planilhas, .txt e .md (desde a Etapa 10). PDF escaneado (só imagem) aparece como "sem texto"; arquivos acima de 25 MB, como "grande demais".

### 6. Semestres
Quando o aluno passa de semestre, ele **não precisa de conta nova**. No perfil (clique no nome dele, no alto) aparece **Meu semestre**, com o semestre atual e o botão **Adicionar semestre**. Esse botão abre a mesma configuração do começo (semestre, turma, matérias com professores, datas das provas; nada é obrigatório). Ao concluir, o semestre anterior é encerrado e fica guardado com tudo: matérias, provas, notas, temas e materiais. Ele aparece no perfil em **Semestres anteriores**, só para consulta. O painel mostra só o semestre atual.

Ao escolher o semestre, as matérias já vêm preenchidas pela lista da faculdade (1º ao 8º semestre da Universidad Interamericana; 9º e 10º ainda sem lista). O aluno pode mudar o nome, tirar ou adicionar matérias. As "Optativa" vêm com um aviso para trocar pelo nome da optativa dele. Você mantém essa lista na página de administração, na janela **Matérias por semestre**.

O que fazer (uma vez):
1. Supabase → **SQL Editor** → **New query**. Cole todo o `supabase/04_semestres.sql` e clique em **Run**. Ele cria o semestre atual de quem já usa o site, com as matérias que a pessoa já tem.
2. **Republique a drive-varrer colando o novo index.ts** (Edge Functions → drive-varrer → Code → apague tudo, cole `supabase/functions/drive-varrer/index.ts` e clique em **Deploy**). A função nova liga os arquivos só às matérias do semestre atual (os arquivos já ligados a semestres antigos continuam lá) e entende nomes em espanhol e em português (ex.: pasta "Farmacologia 2" = "Farmacología II", "Anatopato" = "Anatomía Patológica", "Gestão" = "Gestión").

Depois de configurado, o aluno muda as matérias do semestre atual em **Configurações → Matérias e semestres** (nome, professor, "tem prática", adicionar e remover).

### 7. Livros
Cada aluno tem a janela **Meus livros**, com o botão **Adicionar livro**. Ele escolhe o arquivo (PDF, EPUB, Word .docx ou .txt). O **próprio navegador** do aluno lê o texto página por página (com barra de progresso) e grava **só o texto**, em trechos de cerca de 2.000 letras com o número da página. O arquivo do livro **não** é enviado nem guardado, então não gasta o espaço de arquivos do Supabase. O livro fica só na conta do aluno: ninguém mais vê (nem o administrador, que vê só a lista de títulos).

Embaixo tem **Procurar nos meus livros**, para testar: mostra o livro, a página e o trecho com as palavras achadas. A busca ignora acentos e plural ("pneumonia" acha "pneumonias"; "coracao" acha "coração"). É essa busca que os resumos vão usar depois, para mostrar o que o livro diz e deixar o aluno escolher "do jeito do professor" ou "corrigido pelos livros".

O que fazer (uma vez):
1. Supabase → **SQL Editor** → **New query**. Cole todo o `supabase/05_livros.sql` e clique em **Run** (depois do 04).
2. Mais nada: não há função nova para publicar.

Limites e espaço:
- Cada aluno pode ter **5 livros** e no máximo **8.000 trechos** somando todos (cerca de 3.500 páginas). Para mudar, edite os números na função `limites_livros()` no começo do `05_livros.sql` e rode de novo.
- Um livro de 1.000 páginas ocupa uns 5 a 8 MB no banco. O plano grátis tem 500 MB no total: acompanhe em **Project Settings → Usage** (Database size). Com muitos alunos usando livros, vai precisar do plano Pro.
- PDF escaneado (páginas que são fotos) não tem texto: o site avisa e não grava nada.
- Livros muito grandes (mais de 1.000 páginas) podem demorar alguns minutos e pesar no celular; no computador é melhor. Se a página for fechada no meio, o livro aparece como "incompleto": é só apagar e enviar de novo.

### 8. O painel de estudo completo (Etapa 4)
O painel agora tem as mesmas abas do painel original: **Agenda**, **Disciplinas**, **Questões**, **Média**, **Aulas**, **Calendário** e **Vida acadêmica**. Cada aluno começa com tudo vazio e só vê o que é dele.

- **Agenda:** monta o plano de estudo até cada prova com os temas que faltam; o aluno marca o que estudou (as horas por dia ficam em Configurações → Ajustes da agenda).
- **Disciplinas:** os temas de cada matéria (os do Drive e os dos arquivos enviados entram sozinhos), com **Resumo** e **Mapa mental**. As janelas "Meu Google Drive" e "Meus livros" ficam em **Configurações** (veja a parte 9).
- **Resumo:** só é feito quando o aluno clica em "Gerar resumo", no formato **resumo ativo** (tópicos diretos, sem texto corrido). Se o tema aparece nos livros do aluno, o site pergunta: **Do jeito do professor** ou **Corrigido pelos livros**. Nos dois, o resumo separa o que diz o material do professor e o que diz cada livro (com título e página) e avisa quando discordam. Dá para baixar em **PDF** e **Word**. O jeito do resumo fica em Configurações → Memória de estudo → Resumos (com o modelo completo em "Avançado").
- **PDF, Word e PowerPoint do Drive:** são lidos no navegador do aluno na hora do primeiro resumo daquele tema (a função do Supabase não aguenta ler arquivos pesados).
- **Questões:** 4 tipos (marcar X, verdadeiro ou falso, relacionar, dissertativa), até 20 de cada e 40 por vez, estilo prova com caso clínico. A IA nunca repete as que o aluno já recebeu (mesmo as que ele apagou).
- **Laminário:** o aluno envia as fotos das lâminas/slides dele, com a resposta, e treina (mostrar resposta, acertei/errei, só as que errei). As imagens ficam numa pasta privada; cada aluno pode ter até 300 (cada uma é reduzida para cerca de 300 KB no aparelho).
- **Média:** calculadora "quanto falta" com a regra de notas da faculdade (a mesma do passo 4 da configuração).
- **Aulas**, **Calendário** (provas, seminários, entregas, feriados e semanas de prova) e **Vida acadêmica** (eventos, ligas, horas e certificados): o aluno cadastra em Configurações e a aba mostra.

O que fazer (uma vez, nesta ordem):

1. **Banco:** Supabase → **SQL Editor** → **New query**. Cole todo o `supabase/06_estudo.sql` e clique em **Run** (depois do 05). Ele também cria a pasta privada `laminas` no Storage. Pode rodar de novo sem problema.
2. **Chave da IA:**
   1. Entre em **console.anthropic.com** com a sua conta → **Settings → Billing** e coloque crédito (ex.: 10 dólares) → **API Keys → Create Key**. Copie a chave (começa com `sk-ant-`).
   2. Supabase → **Edge Functions → Secrets** → **Add new secret**. Nome: `ANTHROPIC_API_KEY`. Valor: cole a chave. Salve.
   3. **Nunca cole essa chave no chat, no site, no GitHub ou em mensagens.** Ela só fica nesse lugar do Supabase. Se vazar, apague a chave no console da Anthropic e crie outra.
   4. (Opcional) Para trocar o modelo, crie o segredo `IA_MODELO` (ex.: `claude-sonnet-5-5`). Sem ele, usa `claude-haiku-5-5`, o mais barato.
3. **Função `ia`:** **Edge Functions → Deploy a new function → Via Editor**. Nome: `ia`. Apague o exemplo, cole todo o `supabase/functions/ia/index.ts` e clique em **Deploy**. Depois abra a função → **Details/Settings** → desligue **"Verify JWT"** e salve (a função confere o login sozinha).
4. **Função `drive-arquivo`:** do mesmo jeito, nome `drive-arquivo`, colando `supabase/functions/drive-arquivo/index.ts`, e também com **"Verify JWT" desligado**. Ela usa os segredos do Google que já existem (`GOOGLE_SA_KEY`, `GOOGLE_OAUTH_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`).
5. **Teste:** entre como aluno → **Disciplinas** → um tema → **Resumo** → **Gerar resumo**. Se aparecer "A IA ainda não foi configurada", falta o passo 2 (ou a função foi publicada antes do segredo: publique de novo).

Limites de IA por mês (cada aluno): **60 resumos**, **400 questões** e **60 mapas mentais**. Quando passa, aparece "Você chegou ao limite do mês" e renova no dia 1º. Você vê o uso e muda o limite de cada aluno na página de **Administração** (coluna "IA no mês"; mude o número e clique em Salvar).

Custo estimado com o Claude Haiku 5.5 (0,10 dólar por milhão de tokens de entrada e 0,50 por milhão de saída, enquanto o pedido tiver menos de 100 mil tokens; o site corta o material para ficar bem abaixo disso): um resumo custa menos de **1 centavo de dólar**; 10 questões, cerca de **meio centavo**; um mapa mental, menos de **meio centavo**. Um aluno que usa o limite inteiro do mês gasta menos de 1 dólar. Acompanhe em console.anthropic.com → **Usage**.

## Configuração pública
`assets/config.js` tem só a URL do projeto e a chave **publishable** do Supabase, que podem ficar no navegador. A chave secreta (service_role) e a chave da API do Claude **nunca** entram neste repositório.

### 9. Enviar arquivos, importar o calendário e a tela Configurações (Etapa 5)
- **Configurações:** botão com a engrenagem no alto (ao lado do seu nome) e também no seu perfil. **Regra: as abas do painel só mostram; tudo o que é adicionar ou cadastrar fica em Configurações.** Cartões (abrem e fecham; no alto há um índice): **Matérias e semestres**, **Conteúdos e materiais** (temas de cada matéria e os arquivos), **Calendário e avaliações** (avaliações, feriados e períodos), **Aulas e horários**, **Vida acadêmica** (eventos, ligas, horas e a meta de horas), **Laminário** (guardar e apagar lâminas), **Enviar arquivos e documentos** (desde a Etapa 9, um cartão só), **Documentos importados**, **Meu Google Drive**, **Meus livros**, **Ajustes da agenda** e **Memória de estudo** (era "Memória do resumo"). Cada aba que perdeu o formulário tem um link para o cartão certo. Ficam nas abas só as ações de estudo: marcar tema estudado, resumo, mapa e questões, responder questões, treinar lâminas, notas na Média, status do evento e certificado na Vida acadêmica e "Provas sem data" na Agenda.
- **Enviar arquivos:** para quem não usa o Drive. Em Configurações (o link "Enviar arquivos" da matéria, em Disciplinas, já abre o cartão com a matéria escolhida), o aluno escolhe um ou vários arquivos do computador ou do celular (PDF, PowerPoint .pptx, Word .docx, .txt ou .md), a matéria e o tema (por padrão, um tema novo com o nome de cada arquivo). O **próprio navegador** lê o texto e só o texto vai para o banco: o arquivo não é guardado. Os arquivos enviados aparecem na lista "Materiais" da matéria, com o botão de apagar. PDF escaneado (só imagem) aparece como "sem texto" e não é guardado. Arquivos .ppt e .doc antigos: o site pede para salvar como .pptx/.docx.
- **Importar calendário:** em Configurações (cartão **Importar documento**) e no passo 3 da configuração do semestre (Provas), o botão **Importar calendário (PDF ou foto)**. O aluno manda o PDF oficial das provas (ou uma foto/print da tabela); a IA acha a linha do semestre e da turma dele e mostra as provas numa tabela para conferir (matéria, P1/P2/Final, teórica/prática, data e hora). **Nada é salvo antes de ele clicar em "Salvar no calendário"**. Se a mesma prova já existir, a data é trocada pela nova.

Limites: cada aluno pode ter **400 arquivos enviados** (cada um com até 300 mil letras; somando todos, até 40 milhões de letras, uns 40 MB no banco) e **10 importações de calendário por mês**. Para mudar os números dos arquivos, edite as funções `limite_uploads()`, `limite_letras_upload()` e `limite_letras_uploads()` no começo do `07_uploads.sql` e rode de novo. O limite do calendário fica na coluna `limite_calendarios_mes` de cada aluno (tabela perfis; ainda não aparece na página de Administração). Cada importação custa menos de 1 centavo de dólar.

O que fazer (uma vez, nesta ordem):
1. **Banco:** Supabase → **SQL Editor** → **New query**. Cole todo o `supabase/07_uploads.sql` e clique em **Run** (depois do 06). Pode rodar de novo sem problema.
2. **Função `ia`:** Edge Functions → **ia** → **Code** → apague tudo, cole o novo `supabase/functions/ia/index.ts` e clique em **Deploy**. Confira que **"Verify JWT" continua DESLIGADO** (Details/Settings). Não precisa de segredo novo.
3. Mais nada: o site atualiza sozinho quando o `git push` chegar ao Cloudflare.
4. **Teste:** entre como aluno → Disciplinas → uma matéria → **Enviar arquivos** → escolha um PDF → **Ler e enviar**. Depois, aba Calendário → **Importar calendário (PDF ou foto)** → escolha o PDF das provas → **Ler com IA** → confira a tabela → **Salvar no calendário**. Se aparecer "falta rodar o 07_uploads.sql", falta o passo 1; se aparecer "Ação desconhecida", falta o passo 2.

### 10. Tarefas em segundo plano, turma e segurança da conta (Etapa 6)
- **Tarefas:** resumo, mapa mental, questões e importação rodam **no servidor**. O aluno pede e pode usar o resto do site ou até fechar: quando fica pronto, aparece um aviso ("Seu resumo de X ficou pronto"). O botão **Tarefas** no alto mostra o que está rodando e o que ficou pronto (Abrir / Conferir / Tentar de novo). Se uma tarefa parar no meio (servidor reiniciou), depois de 3 minutos ela aparece com **Tentar de novo** e o limite do mês é devolvido.
- **Arquivos e livros:** são lidos **no navegador** (a função do Supabase não aguenta ler PDF grande), numa fila que não trava o site. A fila fica guardada neste navegador: se o aluno fechar, **continua quando ele abrir o site de novo neste aparelho** (em outro aparelho, não).
- **Turma:** só letras (ex.: F). O aluno muda o semestre, a turma e a faculdade em **Configurações → Semestres**, e a turma dos semestres anteriores. A importação usa a turma atual.
- **Senha:** para trocar, o site manda um **código de 6 números** para o e-mail do aluno. **E-mail:** a troca só vale depois de confirmar nos **dois** e-mails (o atual e o novo). O "Esqueci a senha" continua igual.

O que fazer (uma vez, nesta ordem):
1. **Banco:** SQL Editor → cole todo o `supabase/08_tarefas.sql` → **Run** (depois do 07). Pode rodar de novo.
2. **Função `ia`:** Edge Functions → **ia** → Code → cole o novo `supabase/functions/ia/index.ts` → **Deploy**. **"Verify JWT" continua DESLIGADO.**
3. **Auth:** Authentication → **Sign In / Providers → Email**: ligue **"Secure email change"** e **"Secure password change"** e salve.
4. **E-mail (SMTP próprio, obrigatório antes dos alunos usarem senha/e-mail):** o remetente padrão do Supabase só entrega para quem é do time do projeto e tem limite baixo por hora. Use o Resend:
   1. Crie conta em resend.com → **Domains → Add domain** (ex.: seu domínio) e faça a verificação no DNS.
   2. **API Keys → Create** e copie a chave (começa com `re_`). Não cole em lugar nenhum além do Supabase.
   3. Supabase → **Authentication → Emails → SMTP Settings** → ligue **Enable custom SMTP**: Host `smtp.resend.com`, Port `465`, User `resend`, Password = a chave do Resend, Sender email = um endereço do domínio verificado (ex.: `nao-responda@seudominio.com`), Sender name `Painel de Estudos`. Salve.
   4. Em **Authentication → Emails → Templates**, troque os textos de **Reauthentication** e **Change Email Address** pelos de `docs/emails-ptbr.md`.
5. Mais nada: o site atualiza sozinho com o `git push`.

### 11. Apagar fica apagado (Etapa 6)
Antes, um tema que veio do Drive voltava na próxima leitura da pasta (o arquivo continua lá). Agora, apagar um tema ou um arquivo do Drive deixa o arquivo **oculto**: a leitura da pasta não cria o tema de novo nem lê o texto dele. O aluno vê e restaura em **Configurações → Meu Google Drive → Ocultos**. Todas as exclusões do site conferem no banco que apagou mesmo; se o banco não deixar, aparece um aviso (nada some só da tela).

O que fazer: o `08_tarefas.sql` (parte 10) já traz isso. **Republique a `drive-varrer`** (Edge Functions → drive-varrer → Code → cole `supabase/functions/drive-varrer/index.ts` → Deploy).

### 12. Importar documento (Etapa 6)
O antigo "Importar calendário" virou **Importar documento** (aba Calendário, Configurações e passo 3 da configuração). O aluno manda **qualquer documento da faculdade** (PDF de várias páginas ou foto/print): calendário acadêmico do ano, cronograma de provas por turma, horário de aulas, regulamento, avisos. A IA diz que tipo de documento é, faz um resumo e separa o que serve para o painel:
- **Provas** → Calendário de provas e Agenda (numa grade por turma, só a linha do semestre e da turma do aluno; se a linha não existir, avisa).
- **Eventos** → Calendário acadêmico (feriados, matrícula, recesso, semanas de provas, exames finais, prazos; períodos de vários dias). Num **calendário geral**, todas as datas entram, sem procurar turma.
- **Horários** → Aulas. **Matérias** que faltam → oferece adicionar com o professor. **Notas** (regras, instruções, prazos) → guardadas em **Configurações → Documentos importados**, com o resumo.
- **Nada é salvo antes de o aluno conferir** (cada item tem caixinha e campos para corrigir). A mesma data com o mesmo nome não entra duas vezes no calendário.
- **Material de estudo** (slides, aula, apostila) não é importado aqui: o site manda para **Enviar arquivos** e não conta no limite.
- PDF com páginas escaneadas (foto): essas páginas vão como imagem (até 10); o texto das outras vai como texto, mantendo as colunas. Documentos muito grandes: até cerca de 120 mil letras, lidos em 3 partes.
- Cada importação que traz algo para o painel conta 1 no limite do mês (`limite_calendarios_mes`, 10 por padrão).

O que fazer: já vem no `08_tarefas.sql` e na função `ia` (partes 10 e 11). Nada a mais.

### Resumo da Etapa 6 (na ordem)
1. SQL Editor → rode `supabase/08_tarefas.sql` (depois do 07).
2. Edge Functions → republique **`ia`** (Verify JWT **desligado**) e **`drive-varrer`**.
3. Authentication → Sign In / Providers → Email: ligue **Secure email change** e **Secure password change**.
4. Authentication → Emails → SMTP Settings: SMTP próprio (Resend, parte 10) e os textos de `docs/emails-ptbr.md` nos modelos Reauthentication e Change Email Address.

## Termos de uso (Etapa 7)
Na primeira entrada (e sempre que a versão dos termos mudar), todo mundo, inclusive o administrador, vê uma tela de aceite **antes** da configuração e do painel, com 5 itens para marcar (termos e privacidade, conteúdo de IA, dados guardados, direito sobre os arquivos, 18 anos ou mais). "Recusar e sair" só sai da conta. Quem veio do "Esqueci a senha" cria a senha primeiro e depois vê a tela. Na Administração, a coluna **Termos** mostra ✓ e a data, ou "pendente".

O que fazer (uma vez):
1. **Banco:** SQL Editor → cole todo o `supabase/09_termos.sql` → **Run** (depois do 08). Pode rodar de novo.
2. Mais nada: o site atualiza sozinho com o `git push`. (Antes do passo 1, o site funciona como antes, sem a tela.)

**Mudou os termos?** Edite `termos.html` e/ou `privacidade.html` (troque a "Versão" e a data no topo) e rode no SQL Editor:
```sql
update public.termos_vigente set versao = versao + 1;
```
Na próxima entrada, todos aceitam de novo. Cada aceite fica registrado em `termos_aceites` (quem, versão e quando; sem IP). Ninguém muda esse registro nem os campos de aceite do perfil pelo site.

**Preencher antes de vender:**
- Lei e foro: em `termos.html` (item 13) e `privacidade.html` (item 12), troque `[PAÍS]` e `[CIDADE/PAÍS]`.
- Crédito de inspiração no rodapé: em `assets/config.js`, `CREDITO_INSPIRACAO: { nome: "Nome", instagram: "usuario" }` (só letras, números, ponto e _; sem o @). Vazio, a linha não aparece. As linhas `CRIADOR` e `DESENVOLVIDO_COM` também somem se ficarem `""`.
- **Peça para um advogado (Brasil e Paraguai) revisar `termos.html` e `privacidade.html` antes de vender o acesso.** Os textos são um modelo escrito para bater com o que o site faz de verdade, não uma revisão jurídica.

## Memória do resumo (Etapa 7)
Cada aluno escreve, em **Configurações → Memória de estudo → Resumos** (era "Memória do resumo"; veja a Etapa 10), como quer os resumos (ex.: tabelas comparativas, frases curtas, mnemônicos, doses em negrito, ordem das seções, idioma). Vazio = formato padrão (resumo ativo). Há 4 exemplos para inserir com um toque, contador (até 1500 letras), **Salvar** e **Limpar e voltar ao padrão**. O antigo "Modelo dos resumos" (que ficava em Agenda → Ajustes) agora está no mesmo cartão, em **Avançado: modelo completo**.

Na ficha do resumo aparece "Usando sua memória do resumo (editar)" ou "Formato padrão (editar)" e o campo fechado **Pedido só para este resumo** (até 500 letras), que vale só para o próximo resumo daquele tema.

No servidor, a memória e o pedido entram no pedido à IA como **preferências de estilo** (dados, não comandos): mudam formato, ênfase, ordem e idioma, mas não as regras (só o material, marcas de professor e livros, sem inventar dados nem citações). Em conflito: pedido só para este resumo, depois a memória, depois o modelo completo, depois o padrão. Sem memória e sem pedido, o texto enviado à IA é exatamente o mesmo de antes. Vale só para resumos (não para questões nem mapas).

O que fazer (uma vez, nesta ordem):
1. **Banco:** SQL Editor → cole todo o `supabase/10_memoria_resumo.sql` → **Run** (depois do 09). Pode rodar de novo.
2. **Função `ia`:** Edge Functions → **ia** → Code → cole o novo `supabase/functions/ia/index.ts` → **Deploy**. **"Verify JWT" continua DESLIGADO.**
3. Mais nada: o site atualiza sozinho com o `git push`. (Sem o passo 1, salvar a memória mostra "Falta rodar o 10_memoria_resumo.sql"; a função `ia` funciona com ou sem ele.)

## Importar do painel antigo (Etapa 8)
Para o administrador trazer os dados do painel pessoal antigo (o painel de um arquivo só) para a conta dele no site.

1. No painel antigo: **Configurações → Baixar meus dados (para o site)**. Sai o arquivo `painel-dados-AAAA-MM-DD.json` com o semestre atual (versão 1). Não vão: dados do NotebookLM, chaves, fotos do laminário e semestres guardados.
2. No site: **Configurações → Importar dados do painel antigo** (o cartão só aparece para quem é administrador). Escolha o arquivo. O site confere a versão, o tamanho (até 15 MB) e o limite de cada lista, e mostra a revisão com quantos itens de cada tipo há e quantos têm erro. Cada tipo tem uma caixinha (todas marcadas). **Nada é salvo antes de clicar em Importar.**
3. Tudo vai para o **semestre atual** da conta: matérias (as que têm o mesmo nome são reaproveitadas), temas, resumos (aparecem em Disciplinas, com "Trazido do painel antigo" na ficha), mapas mentais, provas, notas, aulas, calendário acadêmico, eventos, ligas, horas complementares, questões (com acertos, erros e o histórico, para a IA não repetir) e o modelo dos resumos (se o site já tiver um, só troca se você marcar).
4. Rodar de novo **não duplica**: cada coisa é comparada pelo nome, data, matéria ou enunciado, e o que já existe aparece como "já existiam". Itens com erro (texto grande demais, data inválida, campo faltando) são pulados; no fim há a lista de erros para baixar (.csv). Grava de 200 em 200.

O que fazer (uma vez): SQL Editor → cole todo o `supabase/11_importar_painel.sql` → **Run** (depois do 10). Pode rodar de novo. Ele é necessário porque resumos, mapas e questões só o servidor grava; a função `importar_painel` recusa quem não é administrador e só grava na conta de quem chama. Sem ele, o resto é importado e esses três aparecem como "ignorados por erro" com o aviso.

### Formato do arquivo (versão 1)
Campos com os nomes das tabelas do site; `ref` é um apelido local (`d1`, `t1`…) para ligar temas, provas e questões à matéria e ao tema, sem os ids do painel antigo.

```
{ versao: 1, app, exportado_em,
  perfil: { nome, semestre, turma },
  disciplinas: [{ ref, nome, professor, tem_pratica, foco_resumo }],
  temas: [{ ref, disciplina_ref, nome, prova, itens[], aula, resumo_ok, questoes_ok, ordem, resumo_texto, resumo_criado_em, resumo_truncado }],
  provas: [{ disciplina_ref, tipo: P1|P2|Final|Seminário|Entrega|Outra, modalidade: teorica|pratica, titulo, data, hora, peso }],
  notas: [{ disciplina_ref, campo: p1|p2|final|p1_pratica|p2_pratica|final_pratica|presenca|trabalhos, valor }],
  horarios: [{ disciplina_ref | nome, professor, dia: 1-6, inicio, fim }],
  calendario: [{ nome, tipo: feriado|parcial|pratica|final|aulas|outro, inicio, fim }],
  vida_eventos: [{ nome, detalhe, data, status: pend|ins|conf|done }],
  ligas: [{ nome, papel }],
  horas_compl: [{ categoria, descricao, horas, certificado }],
  mapas: [{ tema_ref, titulo, ramos, criado_em }],
  questoes: [{ disciplina_ref, tema_ref, tema, tipo: mc|vf|rel|dis, enunciado, dados, explicacao, acertos, erros, ultima }],
  preferencias: { modelo_resumo, horas_dia, horas_fds, dormir, horas_meta } }
```
Do arquivo, o site usa de `preferencias` só o `modelo_resumo`, e não muda o seu perfil (nome, semestre, turma).


## Etapa 10: temas no Praticar, flash cards, painel do tema, memória de estudo e todos os formatos

- **Questões → Praticar: escolher os temas.** Depois de escolher a matéria aparece a lista dos temas que têm questões, cada um com caixinha e a quantidade (ex.: "Distúrbios ácido-base (10)"), os atalhos **Todas** / **Nenhuma** e o total ("20 questões selecionadas"). Só caem as questões dos temas marcados. Começa tudo marcado; a escolha fica lembrada por matéria nesta aba do navegador. Questões sem tema ficam em "Sem tema". Vale também em **Revisar erros**.
- **Flash cards.** Em Disciplinas, cada tema tem o botão **Flash cards**: gera de 15 a 30 cartões (frente, verso e às vezes uma dica) a partir do material do professor, do resumo e dos livros do aluno, só quando ele clica. O visor mostra um card por vez: toque (ou Espaço) vira, **Errei / Difícil / Acertei** mudam a caixa da revisão (Errei: revisar hoje; Difícil: amanhã; Acertei: cada vez mais longe), setas passam, **Embaralhar**, progresso "7 de 20" e, no fim da rodada, "Só os difíceis e os que errei". Na ficha: **Gerar mais** e **Apagar flash cards**. Na aba **Questões → Flash cards** o aluno revisa por matéria, com as mesmas caixinhas de temas. Limite: **10 gerações de flash cards por mês** por aluno (o administrador muda na página de Administração).
- **Painel do tema.** Botão **Painel** em cada tema: um resumo visual em cartões (a ideia em uma frase, conceitos-chave, números que caem em destaque, tabela de comparação, conduta passo a passo, pegadinhas e o checklist "o que você tem que saber para a prova", com caixinhas lembradas neste navegador). A IA usa só o material: parte sem informação fica vazia e não aparece. Botão **Imprimir** (sai só o painel; dá para salvar em PDF). Conta no limite de **mapas mentais** (não tem limite próprio).
- **Memória de estudo** (era "Memória do resumo"). Em Configurações, uma aba para cada parte: **Resumos** (com o modelo completo em "Avançado"), **Questões**, **Mapa mental**, **Flash cards** e **Painel do tema**, cada uma com exemplos, contador (até 1500 letras), Salvar e Limpar. A função `ia` usa cada memória como preferência de estilo: muda formato e ênfase, mas nunca as regras (só o material, sem inventar, mesmo formato de resposta; nas questões, o tipo e a quantidade pedidos). Sem memória, o pedido à IA é igual ao de antes.
- **Arquivos de todos os formatos.** O cartão **Enviar arquivos e documentos** aceita PowerPoint antigo (.ppt), Word antigo (.doc), Excel, OpenDocument, .rtf, .csv e .html, além de PDF, .pptx, .docx, .txt e .md. Tudo é lido no navegador (`assets/extrair.js`); só o texto vai para o banco. Vídeo, áudio e foto de slide avisam que não têm texto. Do Google Drive, esses formatos também entram na lista e são lidos no navegador quando o aluno pede o resumo (Google Planilhas são lidas pelo servidor, como texto).

O que fazer (uma vez, nesta ordem):
1. **Banco:** Supabase → **SQL Editor** → **New query** → cole todo o `supabase/12_estudo_extra.sql` → **Run** (depois do 11). Pode rodar de novo sem problema. (Se um dia rodar o `07_uploads.sql` de novo, rode o `12` depois dele: os dois mexem na função de limites.)
2. **Função `ia`:** Edge Functions → **ia** → **Code** → apague tudo, cole o novo `supabase/functions/ia/index.ts` → **Deploy**. Confira que **"Verify JWT" continua DESLIGADO**.
3. **Função `drive-varrer`:** Edge Functions → **drive-varrer** → Code → cole o novo `supabase/functions/drive-varrer/index.ts` → **Deploy**. "Verify JWT" fica **como está (desligado)**.
4. **Função `drive-arquivo`:** Edge Functions → **drive-arquivo** → Code → cole o novo `supabase/functions/drive-arquivo/index.ts` → **Deploy**. "Verify JWT" continua **desligado**.
5. Mais nada: o site atualiza sozinho com o `git push` (quando a etapa for para a `etapa-2`). Antes do passo 1, o resto do site funciona: Flash cards, Painel e as partes novas da memória mostram "Falta rodar o 12_estudo_extra.sql no Supabase."

## Etapa 11: sessão que termina, Conteúdo em lista e Minha conta

- **Sessão que terminou.** Antes, quando o login vencia (computador dormindo, aba parada muito tempo, saída em outra aba, falha ao renovar), a página continuava mostrando os dados e cada ação dava um erro estranho: "permission denied for table drive_fontes" no Drive e "Sessão inválida. Faça login de novo." no Gerar questões. Agora o `assets/comum.js` vigia o login (`onAuthStateChange`, a volta para a aba, a volta da internet e a cada 4 minutos) e, se ele acabou, mostra um aviso fixo: **"Sua sessão terminou. Entre de novo para continuar."** com o botão **Entrar de novo**. Toda chamada às funções do servidor passa por `App.invocar` / `App.chamar`: se o servidor recusa o login, o site renova a sessão uma vez e tenta de novo (o aluno nem percebe); só se não der é que aparece o aviso. Erros crus de login ("permission denied for table…", "JWT expired") viram a mesma frase. A fila de envios deste aparelho fica guardada e continua quando o aluno entrar de novo. No console do navegador ficam só os nomes dos eventos (`[sessão] evento: TOKEN_REFRESHED`…), sem dados pessoais.
- **Várias abas abertas** (painel e Administração juntos): as duas páginas usam o mesmo cliente do Supabase (`assets/comum.js`, mesma chave de sessão no navegador e a trava padrão entre abas do supabase-js), então só uma aba renova o login por vez e as outras pegam a sessão nova. Se o aluno sai em uma aba, as outras mostram o aviso.
- **Conteúdo em lista.** Em Questões → Gerar com IA, o campo **Conteúdo** agora é uma lista igual à de Disciplina: a seta sempre mostra todos os temas da disciplina escolhida, e a última opção, **Outro conteúdo (escrever)**, abre a caixa para escrever. Trocar a disciplina troca a lista (as quantidades ficam). O mesmo no Laminário (Configurações → Laminário → Conteúdo).
- **Minha conta.** Novo cartão no fim de Configurações (e também em Meu perfil, para quem ainda não configurou ou está com o acesso vencido):
  - **Apagar todos os meus dados e começar do zero:** apaga tudo o que o aluno criou (todas as tabelas com `aluno_id`, menos o perfil, o registro dos aceites dos termos e o uso de IA do mês, que fica para o limite não voltar ao zero), as imagens dele no Storage (foto, lâminas, páginas enviadas) e o que o navegador guarda do painel. O perfil volta para "não configurado" e a próxima entrada mostra a configuração inicial. Login, nome, e-mail, admin, plano, vencimento e limites ficam.
  - **Excluir minha conta:** tudo isso e também o login. A conta de administrador não pode ser excluída por aqui (só apagar os dados).
  - As duas mostram o que vai ser apagado e só liberam o botão depois de escrever **APAGAR**.
- **Rodapé.** "Excluir minha conta" não abre mais o programa de e-mail: logado, abre Configurações → Minha conta (`app.html?cfg=conta`); sem login, leva à explicação na política de privacidade (entrar e usar Minha conta, ou pedir pelo e-mail). Termos e privacidade explicam a exclusão pelo próprio site, na hora.

O que fazer (uma vez, nesta ordem):
1. **Banco:** Supabase → **SQL Editor** → **New query** → cole todo o `supabase/13_minha_conta.sql` → **Run** (depois do 12). Pode rodar de novo sem problema. Rode no SQL Editor (usuário `postgres`): a função de excluir a conta precisa ser dele para apagar o login.
2. **Funções do servidor:** nenhuma muda nesta etapa (não precisa publicar de novo).
3. Mais nada: o site atualiza sozinho quando a etapa for para a `etapa-2`. Antes do passo 1, o resto funciona; Minha conta avisa "falta rodar o 13_minha_conta.sql" e não deixa apagar.
4. Para testar do zero: entre com a sua conta → Configurações → Minha conta → **Apagar meus dados e começar do zero** → escreva APAGAR. (A sua conta é de administrador, então "Excluir minha conta" não aparece para ela.)
