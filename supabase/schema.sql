-- =====================================================================
-- Painel de Estudos · esquema do banco (Etapa 2)
-- Cole tudo no Supabase: SQL Editor → New query → Run.
-- Pode rodar de novo sem problema: só cria o que ainda não existe.
-- =====================================================================

-- ---------- Faculdades e regra de notas ----------
create table if not exists public.faculdades (
  id          bigint generated always as identity primary key,
  nome        text not null unique,
  regra_notas jsonb not null default '{}'::jsonb,
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now()
);

insert into public.faculdades (nome, regra_notas)
values (
  'Universidad Interamericana',
  '{"total":100,"aprova":60,"p1":20,"p2":20,"final_sem_pratica":40,"final_teorica_com_pratica":30,
    "final_pratica":10,"processo_max":20,"p1_pratica":5,"p2_pratica":5,"presenca":2}'::jsonb
)
on conflict (nome) do nothing;

-- ---------- Perfil de cada aluno (1 por conta de login) ----------
create table if not exists public.perfis (
  id            uuid primary key references auth.users(id) on delete cascade,
  email         text not null,
  nome          text,
  faculdade_id  bigint references public.faculdades(id),
  semestre      smallint check (semestre between 1 and 14),
  turma         text,
  plano         text not null default 'mensal',       -- mensal | semestral | teste
  vence_em      date,                                 -- null = sem vencimento
  ativo         boolean not null default false,       -- o admin libera
  is_admin      boolean not null default false,
  onboarding_ok boolean not null default false,
  limite_resumos_mes integer not null default 60,
  criado_em     timestamptz not null default now()
);

-- ---------- Funções auxiliares (usadas pelas regras de acesso) ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.perfis where id = auth.uid()), false)
$$;

create or replace function public.acesso_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select ativo and (vence_em is null or vence_em >= current_date)
    from public.perfis where id = auth.uid()
  ), false)
$$;

-- Cria o perfil automaticamente quando uma conta de login é criada
create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, email, nome)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nome', null))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

-- O aluno pode editar o próprio nome/faculdade/semestre, mas NUNCA
-- plano, vencimento, liberação, admin ou limite. Só o admin muda esses.
create or replace function public.protege_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- servidor (Edge Function com chave de serviço) e SQL Editor podem tudo
  if session_user <> 'authenticator'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role' then
    return new;
  end if;
  if not public.is_admin() and (
       new.plano is distinct from old.plano or
       new.vence_em is distinct from old.vence_em or
       new.ativo is distinct from old.ativo or
       new.is_admin is distinct from old.is_admin or
       new.limite_resumos_mes is distinct from old.limite_resumos_mes or
       new.email is distinct from old.email or
       new.id is distinct from old.id
     ) then
    raise exception 'Somente o administrador pode alterar esses campos';
  end if;
  return new;
end $$;

drop trigger if exists protege_perfil on public.perfis;
create trigger protege_perfil before update on public.perfis
  for each row execute function public.protege_perfil();

-- ---------- Dados do painel de cada aluno ----------
create table if not exists public.disciplinas (
  id          bigint generated always as identity primary key,
  aluno_id    uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  nome        text not null,
  professor   text,
  tem_pratica boolean not null default false,
  ordem       smallint not null default 0,
  criado_em   timestamptz not null default now()
);

create table if not exists public.temas (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  disciplina_id bigint not null references public.disciplinas(id) on delete cascade,
  nome          text not null,
  prova         text,                       -- ex.: 'P2 teórica'
  itens         jsonb not null default '[]'::jsonb,
  aula          boolean not null default false,
  resumo_ok     boolean not null default false,
  questoes_ok   boolean not null default false,
  ordem         smallint not null default 0,
  criado_em     timestamptz not null default now()
);

create table if not exists public.provas (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  disciplina_id bigint not null references public.disciplinas(id) on delete cascade,
  tipo          text not null check (tipo in ('P1','P2','Final')),
  modalidade    text not null default 'teorica' check (modalidade in ('teorica','pratica')),
  data          date,
  hora          time,
  criado_em     timestamptz not null default now(),
  unique (aluno_id, disciplina_id, tipo, modalidade)
);

create table if not exists public.notas (
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  disciplina_id bigint not null references public.disciplinas(id) on delete cascade,
  campo         text not null,              -- p1, p2, final, p1_pratica, presenca, trabalhos...
  valor         numeric(5,2),
  primary key (aluno_id, disciplina_id, campo)
);

create table if not exists public.resumos (
  tema_id    bigint primary key references public.temas(id) on delete cascade,
  aluno_id   uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  texto      text not null,
  modelo     text,
  criado_em  timestamptz not null default now()
);

create table if not exists public.uso_ia (
  aluno_id  uuid not null references public.perfis(id) on delete cascade,
  mes       date not null,                  -- primeiro dia do mês
  resumos   integer not null default 0,
  questoes  integer not null default 0,
  tokens_entrada bigint not null default 0,
  tokens_saida   bigint not null default 0,
  primary key (aluno_id, mes)
);

-- ---------- Regras de acesso (RLS) ----------
alter table public.faculdades  enable row level security;
alter table public.perfis      enable row level security;
alter table public.disciplinas enable row level security;
alter table public.temas       enable row level security;
alter table public.provas      enable row level security;
alter table public.notas       enable row level security;
alter table public.resumos     enable row level security;
alter table public.uso_ia      enable row level security;

-- faculdades: qualquer pessoa logada lê; só o admin mexe
drop policy if exists fac_ler on public.faculdades;
create policy fac_ler on public.faculdades for select to authenticated using (true);
drop policy if exists fac_admin on public.faculdades;
create policy fac_admin on public.faculdades for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- perfis: cada um vê e edita o seu (os campos protegidos ficam com o trigger); admin vê e edita todos
drop policy if exists perfil_ler on public.perfis;
create policy perfil_ler on public.perfis for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists perfil_editar on public.perfis;
create policy perfil_editar on public.perfis for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- dados do painel: só o dono, e só com acesso liberado e em dia; admin só lê (suporte)
do $$
declare t text;
begin
  foreach t in array array['disciplinas','temas','provas','notas','resumos'] loop
    execute format('drop policy if exists dono_tudo on public.%I', t);
    execute format($p$create policy dono_tudo on public.%I for all to authenticated
      using (aluno_id = auth.uid() and public.acesso_ok())
      with check (aluno_id = auth.uid() and public.acesso_ok())$p$, t);
    execute format('drop policy if exists admin_ler on public.%I', t);
    execute format($p$create policy admin_ler on public.%I for select to authenticated
      using (public.is_admin())$p$, t);
  end loop;
end $$;

-- uso de IA: o aluno só lê o próprio; quem grava é o servidor (Edge Function)
drop policy if exists uso_ler on public.uso_ia;
create policy uso_ler on public.uso_ia for select to authenticated
  using (aluno_id = auth.uid() or public.is_admin());

-- ---------- Índices ----------
create index if not exists disciplinas_aluno on public.disciplinas(aluno_id);
create index if not exists temas_aluno on public.temas(aluno_id, disciplina_id);
create index if not exists provas_aluno on public.provas(aluno_id, data);
