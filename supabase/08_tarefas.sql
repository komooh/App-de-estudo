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
  tipo          text not null,
  status        text not null default 'na_fila' check (status in ('na_fila','rodando','pronta','erro','vista')),
  titulo        text not null default '' check (char_length(titulo) <= 200),
  entrada       jsonb not null default '{}'::jsonb check (pg_column_size(entrada) < 200000),  -- só os parâmetros já conferidos
  resultado     jsonb check (resultado is null or pg_column_size(resultado) < 200000),
  erro          text check (erro is null or char_length(erro) <= 500),
  reserva       jsonb,            -- {tipo, n}: o que foi reservado do limite do mês e ainda não foi acertado
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.tarefas drop constraint if exists tarefas_tipo_check;
alter table public.tarefas add constraint tarefas_tipo_check check (tipo in ('resumo','mapa','questoes','documento','calendario'));
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

-- ---------- Apagar fica apagado: arquivos do Drive "ocultos" ----------
-- Antes: o aluno apagava um tema (ou um arquivo) do Drive e a próxima leitura da pasta criava de novo,
-- porque o arquivo continua lá. Agora o arquivo fica marcado como ignorado: a leitura (drive-varrer)
-- não cria tema para ele e não lê o texto. O aluno restaura em Configurações → Meu Google Drive → Ocultos.
alter table public.materiais add column if not exists ignorado boolean not null default false;
create index if not exists materiais_ignorados on public.materiais(aluno_id) where ignorado;

-- é o próprio aluno apagando (pelo site)? (o servidor, com a chave de serviço, apaga de verdade)
create or replace function public.pedido_do_aluno() returns boolean
language sql stable set search_path = public as $$
  select session_user = 'authenticator'
     and coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') <> 'service_role'
$$;

-- apagar um arquivo do Drive pelo site = ocultar (a linha fica, marcada; senão a leitura traz de volta)
create or replace function public.materiais_apagar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- (desligar a pasta apaga os arquivos dela em cascata: aí a pasta já não existe e apaga de verdade)
  if old.origem = 'drive' and public.pedido_do_aluno() and exists (select 1 from public.drive_fontes where id = old.fonte_id) then
    update public.materiais set ignorado = true, tema_id = null where id = old.id;
    return null;  -- não apaga
  end if;
  return old;
end $$;
drop trigger if exists materiais_apagar on public.materiais;
create trigger materiais_apagar before delete on public.materiais
  for each row execute function public.materiais_apagar();

-- apagar um tema pelo site: os arquivos do Drive dele ficam ocultos (não recriam o tema).
-- Quando a matéria inteira é apagada, não marca nada (a matéria já não existe).
create or replace function public.temas_apagar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.pedido_do_aluno() and exists (select 1 from public.disciplinas where id = old.disciplina_id) then
    update public.materiais set ignorado = true where tema_id = old.id and origem = 'drive';
  end if;
  return old;
end $$;
drop trigger if exists temas_apagar on public.temas;
create trigger temas_apagar before delete on public.temas
  for each row execute function public.temas_apagar();

-- restaurar um arquivo oculto (volta na próxima leitura da pasta)
create or replace function public.restaurar_material(p_id bigint) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.acesso_ok() then raise exception 'Acesso não liberado'; end if;
  update public.materiais set ignorado = false where id = p_id and aluno_id = auth.uid() and ignorado;
  return found;
end $$;
revoke all on function public.restaurar_material(bigint) from public, anon;
grant execute on function public.restaurar_material(bigint) to authenticated;

-- ---------- Importar documento: o que a IA leu e o aluno guardou ----------
-- Qualquer documento da faculdade (calendário acadêmico, cronograma de provas, horário, regulamento, aviso).
-- O site só grava depois que o aluno confere. Fica o registro (resumo e notas) em "Documentos importados".
create table if not exists public.documentos (
  id         bigint generated always as identity primary key,
  aluno_id   uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  nome       text not null default '' check (char_length(nome) <= 200),
  tipo       text not null default 'outro' check (tipo in ('calendario_geral','cronograma_provas','horario_aulas','programa_materia','regulamento','aviso','outro')),
  titulo     text check (titulo is null or char_length(titulo) <= 200),
  resumo     text check (resumo is null or char_length(resumo) <= 800),
  notas      jsonb not null default '[]'::jsonb check (jsonb_typeof(notas) = 'array' and pg_column_size(notas) < 60000),
  criado_em  timestamptz not null default now()
);
create index if not exists documentos_aluno on public.documentos(aluno_id, criado_em desc);
alter table public.documentos enable row level security;
drop policy if exists dono_tudo on public.documentos;
create policy dono_tudo on public.documentos for all to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok()) with check (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists admin_ler on public.documentos;
create policy admin_ler on public.documentos for select to authenticated using (public.is_admin());
grant select, insert, update, delete on public.documentos to authenticated;
revoke all on public.documentos from anon;
-- no máximo 200 documentos por aluno
create or replace function public.documentos_limite() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.documentos where aluno_id = new.aluno_id) >= 200 then raise exception 'Limite de 200 documentos. Apague alguns antigos.'; end if;
  return new;
end $$;
drop trigger if exists documentos_limite on public.documentos;
create trigger documentos_limite before insert on public.documentos for each row execute function public.documentos_limite();

-- eventos do calendário acadêmico: vários dias (fim, já existe), descrição e de qual documento vieram
alter table public.calendario add column if not exists descricao text;
alter table public.calendario drop constraint if exists calendario_descricao_tamanho;
alter table public.calendario add constraint calendario_descricao_tamanho check (descricao is null or char_length(descricao) <= 300);
alter table public.calendario add column if not exists documento_id bigint references public.documentos(id) on delete set null;
alter table public.calendario drop constraint if exists calendario_nome_check;
alter table public.calendario add constraint calendario_nome_check check (char_length(nome) between 1 and 160);
-- a mesma data com o mesmo nome não entra duas vezes (importar de novo o mesmo calendário)
-- (antes, tira as repetidas que já existam: fica a mais antiga)
delete from public.calendario c using public.calendario d
 where c.aluno_id = d.aluno_id and lower(c.nome) = lower(d.nome) and c.inicio = d.inicio and c.id > d.id;
create unique index if not exists calendario_sem_repetir on public.calendario(aluno_id, lower(nome), inicio);
-- horário de aulas: sala
alter table public.horarios add column if not exists sala text;
alter table public.horarios drop constraint if exists horarios_sala_tamanho;
alter table public.horarios add constraint horarios_sala_tamanho check (sala is null or char_length(sala) <= 60);
