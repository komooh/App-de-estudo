# Painel de Estudos

Site de estudos por assinatura para alunos de medicina. Cada aluno tem o próprio painel: matérias, calendário de provas, agenda, resumos e questões.

- **Hospedagem:** Cloudflare Pages (site estático, sem etapa de build)
- **Login e banco de dados:** Supabase (link mágico por e-mail, regras de acesso por aluno)
- **IA:** API do Claude, chamada só pelo servidor (Edge Functions do Supabase), na Etapa 3

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

Arquivos lidos: PDF com texto, Word (.docx), PowerPoint (.pptx), Google Docs, Google Slides, .txt e .md. PDF escaneado (só imagem) aparece como "sem texto"; arquivos acima de 25 MB, como "grande demais".

## Configuração pública
`assets/config.js` tem só a URL do projeto e a chave **publishable** do Supabase, que podem ficar no navegador. A chave secreta (service_role) e a chave da API do Claude **nunca** entram neste repositório.
