-- =====================================================================
-- Painel de Estudos · atualização 03: importar materiais do Google Drive
-- Rode DEPOIS do schema.sql e do 02_perfil_foto_senha.sql.
-- Pode rodar de novo sem problema.
--
-- Quem grava aqui é o servidor (Edge Functions drive-oauth e drive-varrer).
-- O aluno só vê (e pode apagar) o que é dele.
-- =====================================================================

-- ---------- Pastas do Drive ligadas por cada aluno ----------
-- tipo 'compartilhada': o aluno compartilhou a pasta com o e-mail de leitura do site
-- tipo 'google': o aluno entrou com a conta Google dele (só leitura)
create table if not exists public.drive_fontes (
  id               uuid primary key default gen_random_uuid(),
  aluno_id         uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  tipo             text not null check (tipo in ('compartilhada','google')),
  pasta_id         text check (pasta_id is null or pasta_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  pasta_nome       text,
  status           text not null default 'pendente'
                   check (status in ('pendente','varrendo','ok','erro','reconectar')),
  erro             text,
  ultima_varredura timestamptz,
  criado_em        timestamptz not null default now(),
  unique (aluno_id, tipo)
);

-- Uma pasta compartilhada só pode estar ligada a UM aluno
-- (assim ninguém lê a pasta de outro colando o mesmo link).
create unique index if not exists drive_fontes_pasta_unica
  on public.drive_fontes(pasta_id) where tipo = 'compartilhada' and pasta_id is not null;

-- ---------- Conexão "Entrar com o Google" (só o servidor usa) ----------
-- refresh_token fica CRIPTOGRAFADO (AES-GCM) pela Edge Function.
create table if not exists public.drive_tokens (
  aluno_id      uuid primary key references public.perfis(id) on delete cascade,
  refresh_token text not null,
  atualizado_em timestamptz not null default now()
);

-- ---------- Arquivos encontrados nas pastas ----------
create table if not exists public.materiais (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  fonte_id      uuid not null references public.drive_fontes(id) on delete cascade,
  drive_file_id text not null,
  nome          text not null,
  mime          text,
  caminho       text,                                   -- pastas até o arquivo, ex.: 'Farmacologia 2 / Aulas'
  disciplina_id bigint references public.disciplinas(id) on delete set null,
  tema_id       bigint references public.temas(id) on delete set null,
  modificado_em timestamptz,                            -- modifiedTime do Drive
  tamanho       bigint,
  texto         text,
  status        text not null default 'pendente'
                check (status in ('ok','sem_texto','grande_demais','erro','pendente')),
  erro          text,
  tentativas    smallint not null default 0,            -- leituras que não terminaram (arquivo pesado)
  criado_em     timestamptz not null default now(),
  unique (aluno_id, drive_file_id)
);

-- Temas criados a partir de um arquivo do Drive ficam marcados (não duplica ao varrer de novo)
alter table public.temas add column if not exists origem text;

-- ---------- Regras de acesso (RLS) ----------
alter table public.drive_fontes enable row level security;
alter table public.drive_tokens enable row level security;
alter table public.materiais    enable row level security;

-- drive_tokens: nenhuma regra = ninguém do navegador lê ou grava (só a chave de serviço)
revoke all on public.drive_tokens from anon, authenticated;

-- drive_fontes e materiais: o aluno vê e apaga o que é dele (com acesso em dia);
-- criar e alterar fica com o servidor, que confere a pasta antes de gravar.
do $$
declare t text;
begin
  foreach t in array array['drive_fontes','materiais'] loop
    execute format('drop policy if exists dono_ler on public.%I', t);
    execute format($p$create policy dono_ler on public.%I for select to authenticated
      using (aluno_id = auth.uid() and public.acesso_ok())$p$, t);
    execute format('drop policy if exists dono_apagar on public.%I', t);
    execute format($p$create policy dono_apagar on public.%I for delete to authenticated
      using (aluno_id = auth.uid() and public.acesso_ok())$p$, t);
    execute format('drop policy if exists admin_ler on public.%I', t);
    execute format($p$create policy admin_ler on public.%I for select to authenticated
      using (public.is_admin())$p$, t);
    execute format('revoke insert, update, truncate on public.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- ---------- Índices ----------
create index if not exists drive_fontes_aluno on public.drive_fontes(aluno_id);
create index if not exists materiais_aluno on public.materiais(aluno_id, disciplina_id);
create index if not exists materiais_fonte on public.materiais(fonte_id, status);

-- ---------- (Opcional) Varrer as pastas sozinho todo dia ----------
-- Deixe comentado até querer usar. Precisa das extensões pg_cron e pg_net
-- (Database → Extensions) e da chave secreta guardada no Vault:
--   select vault.create_secret('COLE_A_CHAVE_SERVICE_ROLE_AQUI', 'drive_cron_key');
-- Depois rode:
--
-- select cron.schedule('drive-varrer-diario', '17 6 * * *', $$
--   select net.http_post(
--     url := 'https://ksnmyjqzlhmqyshsebhj.supabase.co/functions/v1/drive-varrer',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'drive_cron_key')
--     ),
--     body := '{}'::jsonb,
--     timeout_milliseconds := 150000
--   );
-- $$);
--
-- Para desligar: select cron.unschedule('drive-varrer-diario');
