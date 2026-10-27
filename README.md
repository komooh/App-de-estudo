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

## Como colocar no ar (uma vez)

### 1. Banco de dados (Supabase)
1. Supabase → **SQL Editor** → **New query**. Cole todo o conteúdo de `supabase/schema.sql` e clique em **Run**.
2. **Authentication → Sign In / Providers → Email**: deixe o Email ligado e **desligue "Allow new users to sign up"**. Assim só entra quem o administrador convidar.
3. **Authentication → URL Configuration**: em **Site URL** coloque o endereço do site (ex.: `https://app-de-estudo.pages.dev`) e em **Redirect URLs** adicione `https://app-de-estudo.pages.dev/**`.

### 2. Sua conta de administrador
1. **Authentication → Users → Add user → Send invitation**, com o seu e-mail.
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

## Configuração pública
`assets/config.js` tem só a URL do projeto e a chave **publishable** do Supabase, que podem ficar no navegador. A chave secreta (service_role) e a chave da API do Claude **nunca** entram neste repositório.
