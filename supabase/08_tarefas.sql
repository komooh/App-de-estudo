-- =====================================================================
-- Painel de Estudos · atualização 08: tarefas em segundo plano, turma e e-mail
-- Rode DEPOIS do 07_uploads.sql. Pode rodar de novo sem problema.
--
-- O que este arquivo faz:
--   - tarefas: os pedidos à IA (resumo, mapa mental, questões, calendário) rodam no servidor
--     depois que o site recebe a resposta; o aluno pode sair do site e voltar depois.
--     Quem cria e mexe nas tarefas é a função "ia" (chave de serviço). O aluno só lê as dele
--     e marca como vistas (função tarefa_vista).
--   - pasta privada "tarefas" no Storage: a foto do calendário fica lá até a IA ler
--     (cada aluno só envia e vê na pasta dele; a função apaga depois).
--   - turma: só letras maiúsculas, 1 ou 2 (ex.: "F"), no semestre e no perfil.
--   - e-mail: quando o aluno troca o e-mail (confirmado nos dois endereços), o perfil acompanha.
-- =====================================================================

-- ---------- Tarefas da IA ----------
create table if not exists public.tarefas (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null references public.perfis(id) on delete cascade,
  tipo          text not null check (tipo in ('resumo','mapa','questoes','calendario')),
  status        text not null default 'na_fila' check (status in ('na_fila','rodando','pronta','erro','vista')),
  titulo        text not null default '' check (char_length(titulo) <= 200),
  entrada       jsonb not null default '{}'::jsonb check (pg_column_size(entrada) < 200000),  -- só os parâmetros já conferidos
  resultado     jsonb check (resultado is null or pg_column_size(resultado) < 200000),
  erro          text check (erro is null or char_length(erro) <= 500),
  reserva       jsonb,            -- {tipo, n}: o que foi reservado do limite do mês e ainda não foi acertado
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists tarefas_aluno on public.tarefas(aluno_id, criado_em desc);
create index if not exists tarefas_ativas on public.tarefas(aluno_id, atualizado_em) where status in ('na_fila','rodando') or reserva is not null;

create or replace function public.tarefa_atualizada() returns trigger
language plpgsql set search_path = public as $$
begin new.atualizado_em := now(); return new; end $$;
drop trigger if exists tarefa_atualizada on public.tarefas;
create trigger tarefa_atualizada before update on public.tarefas
  for each row execute function public.tarefa_atualizada();

alter table public.tarefas enable row level security;
drop policy if exists dono_ler on public.tarefas;
create policy dono_ler on public.tarefas for select to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists admin_ler on public.tarefas;
create policy admin_ler on public.tarefas for select to authenticated using (public.is_admin());
revoke all on public.tarefas from anon, authenticated;
grant select on public.tarefas to authenticated;

-- A lista do aluno: as tarefas dos últimos 7 dias. Uma tarefa parada há mais de 3 minutos
-- (o servidor caiu no meio) aparece como erro, com "Tentar de novo".
drop function if exists public.minhas_tarefas(integer);
create function public.minhas_tarefas(p_limite integer default 30)
returns table (id bigint, tipo text, status text, titulo text, tema_id bigint, resultado jsonb, erro text, criado_em timestamptz, atualizado_em timestamptz, agora timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, t.tipo,
         case when t.status in ('na_fila','rodando') and t.atualizado_em < now() - interval '3 minutes' then 'erro' else t.status end,
         t.titulo, case when jsonb_typeof(t.entrada->'tema_id') = 'number' then (t.entrada->>'tema_id')::bigint end, t.resultado,
         case when t.status in ('na_fila','rodando') and t.atualizado_em < now() - interval '3 minutes'
              then 'A tarefa parou no meio. Tente de novo.' else t.erro end,
         t.criado_em, t.atualizado_em, now()
    from public.tarefas t
   where t.aluno_id = auth.uid() and public.acesso_ok() and t.criado_em > now() - interval '7 days'
   order by t.criado_em desc
   limit least(greatest(coalesce(p_limite, 30), 1), 100)
$$;
revoke all on function public.minhas_tarefas(integer) from public, anon;
grant execute on function public.minhas_tarefas(integer) to authenticated;

-- O aluno só muda uma coisa: marcar como vista (some do contador). Só as dele, e só as que terminaram.
create or replace function public.tarefa_vista(p_ids bigint[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is null or not public.acesso_ok() then raise exception 'Acesso não liberado'; end if;
  update public.tarefas set status = 'vista'
   where id = any(coalesce(p_ids, '{}')) and aluno_id = auth.uid()
     and (status in ('pronta','erro')
          or (status in ('na_fila','rodando') and atualizado_em < now() - interval '3 minutes'));
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.tarefa_vista(bigint[]) from public, anon;
grant execute on function public.tarefa_vista(bigint[]) to authenticated;

-- ---------- Pasta PRIVADA "tarefas" no Storage (foto do calendário até a IA ler) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tarefas', 'tarefas', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.tarefas_no_storage(p_aluno text) returns integer
language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects where bucket_id = 'tarefas' and (storage.foldername(name))[1] = p_aluno
$$;
revoke all on function public.tarefas_no_storage(text) from public, anon;
grant execute on function public.tarefas_no_storage(text) to authenticated;

drop policy if exists tarefa_enviar on storage.objects;
create policy tarefa_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'tarefas' and (storage.foldername(name))[1] = auth.uid()::text
    and public.acesso_ok() and public.tarefas_no_storage(auth.uid()::text) < 20);
drop policy if exists tarefa_ler on storage.objects;
create policy tarefa_ler on storage.objects for select to authenticated
  using (bucket_id = 'tarefas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists tarefa_apagar on storage.objects;
create policy tarefa_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'tarefas' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Turma: só letras (A a Z), maiúsculas, 1 ou 2 ----------
-- Primeiro arruma o que já existe: "f" -> "F", "Turma F" -> "F", "6F" -> "F", vazio -> null.
create or replace function public.turma_limpa(p text) returns text
language sql immutable set search_path = public as $$
  select case when l = '' then null when char_length(l) <= 2 then l else right(l, 1) end
    from (select regexp_replace(upper(coalesce(p, '')), '[^A-Z]', '', 'g') as l) x
$$;
update public.semestres set turma = public.turma_limpa(turma) where turma is distinct from public.turma_limpa(turma);
update public.perfis    set turma = public.turma_limpa(turma) where turma is distinct from public.turma_limpa(turma);
alter table public.semestres drop constraint if exists semestres_turma_check;
alter table public.semestres drop constraint if exists semestres_turma_letras;
alter table public.semestres add constraint semestres_turma_letras check (turma is null or turma ~ '^[A-Z]{1,2}$');
alter table public.perfis drop constraint if exists perfis_turma_letras;
alter table public.perfis add constraint perfis_turma_letras check (turma is null or turma ~ '^[A-Z]{1,2}$');

-- ---------- E-mail: o perfil acompanha a troca feita no login (Supabase Auth) ----------
-- O aluno não muda perfis.email direto (protege_perfil); a troca vem do Auth, depois de confirmada.
create or replace function public.email_no_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null and new.email is distinct from old.email then
    update public.perfis set email = new.email where id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists email_no_perfil on auth.users;
create trigger email_no_perfil after update of email on auth.users
  for each row execute function public.email_no_perfil();
