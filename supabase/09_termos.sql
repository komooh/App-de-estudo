-- =====================================================================
-- Painel de Estudos · atualização 09: aceite dos termos de uso
-- Rode DEPOIS do 08_tarefas.sql. Pode rodar de novo sem problema.
--
-- O que este arquivo faz:
--   - termos_vigente: uma linha só, com o número da versão atual dos termos (começa em 1).
--     Mudou o texto de termos.html ou privacidade.html de um jeito importante? Suba a versão:
--       update public.termos_vigente set versao = versao + 1;
--     Na próxima entrada, todo mundo (alunos e o administrador) vê a tela de aceite de novo.
--   - perfis.termos_versao e perfis.termos_aceitos_em: a última versão aceita e quando.
--     Só a função aceitar_termos grava esses dois campos (nem o aluno nem o admin mudam direto).
--   - termos_aceites: registro de cada aceite (quem, versão, quando). Só cresce: ninguém muda
--     nem apaga pelo site. Some junto com a conta quando a conta é apagada (pedido de exclusão).
--     Não guardamos IP.
-- =====================================================================

-- ---------- Versão atual dos termos (uma linha só) ----------
create table if not exists public.termos_vigente (
  id     boolean primary key default true check (id),
  versao integer not null default 1 check (versao >= 1)
);
insert into public.termos_vigente (id, versao) values (true, 1) on conflict (id) do nothing;
alter table public.termos_vigente enable row level security;
revoke all on public.termos_vigente from anon, authenticated;
-- (sem políticas: ninguém lê nem muda pelo site; o site pergunta a versão pela função abaixo)

create or replace function public.termos_versao_atual() returns integer
language sql stable security definer set search_path = public as $$
  select versao from public.termos_vigente where id
$$;
revoke all on function public.termos_versao_atual() from public, anon;
grant execute on function public.termos_versao_atual() to authenticated, service_role;

-- ---------- Campos no perfil ----------
alter table public.perfis add column if not exists termos_versao integer;
alter table public.perfis add column if not exists termos_aceitos_em timestamptz;

-- Ninguém muda esses dois campos direto pelo site (nem o admin): só a função aceitar_termos.
-- Gatilho separado do protege_perfil (assim rodar o schema.sql de novo não tira esta proteção).
-- É "security invoker" de propósito: current_user é quem fez o update. Pelo site é sempre
-- "authenticated"; dentro de aceitar_termos (security definer) é o dono da função.
create or replace function public.protege_perfil_termos() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and (
       new.termos_versao is distinct from old.termos_versao or
       new.termos_aceitos_em is distinct from old.termos_aceitos_em) then
    raise exception 'O aceite dos termos só muda pela tela de aceite';
  end if;
  return new;
end $$;
drop trigger if exists protege_perfil_termos on public.perfis;
create trigger protege_perfil_termos before update on public.perfis
  for each row execute function public.protege_perfil_termos();

-- ---------- Registro dos aceites (só cresce) ----------
create table if not exists public.termos_aceites (
  id        bigint generated always as identity primary key,
  aluno_id  uuid not null references public.perfis(id) on delete cascade,
  versao    integer not null check (versao >= 1),
  aceito_em timestamptz not null default now()
);
create index if not exists termos_aceites_aluno on public.termos_aceites(aluno_id, aceito_em desc);
alter table public.termos_aceites enable row level security;
revoke all on public.termos_aceites from anon, authenticated;
grant select on public.termos_aceites to authenticated;
drop policy if exists termos_ler on public.termos_aceites;
create policy termos_ler on public.termos_aceites for select to authenticated
  using (aluno_id = auth.uid() or public.is_admin());
-- nada de update (nem pelo SQL Editor). Apagar só acontece em cascata, quando a conta é apagada.
create or replace function public.termos_aceites_fixo() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'O registro de aceites não pode ser alterado';
end $$;
drop trigger if exists termos_aceites_fixo on public.termos_aceites;
create trigger termos_aceites_fixo before update on public.termos_aceites
  for each row execute function public.termos_aceites_fixo();

-- ---------- Aceitar (o próprio aluno, só a versão atual) ----------
create or replace function public.aceitar_termos(p_versao integer) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_atual integer := public.termos_versao_atual(); v_agora timestamptz := now();
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para aceitar os termos'; end if;
  if p_versao is null or p_versao is distinct from v_atual then
    raise exception 'Os termos mudaram. Recarregue a página para ler a versão nova.';
  end if;
  update public.perfis set termos_versao = v_atual, termos_aceitos_em = v_agora where id = auth.uid();
  if not found then raise exception 'Perfil não encontrado'; end if;
  insert into public.termos_aceites (aluno_id, versao, aceito_em) values (auth.uid(), v_atual, v_agora);
  return v_agora;
end $$;
revoke all on function public.aceitar_termos(integer) from public, anon;
grant execute on function public.aceitar_termos(integer) to authenticated;
