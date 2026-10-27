-- =====================================================================
-- Painel de Estudos · atualização 06: o painel de estudo completo
-- Rode DEPOIS do 05_livros.sql. Pode rodar de novo sem problema.
--
-- O que este arquivo cria:
--   - provas: seminário, entrega e outras avaliações (além de P1, P2 e Final)
--   - preferências de cada aluno (agenda, modelo dos resumos, horas complementares)
--   - resumos, mapas mentais e questões feitos pela IA (quem grava é o servidor)
--   - histórico das questões (para a IA nunca repetir)
--   - limites mensais de IA por aluno (resumos, questões e mapas)
--   - horário de aulas, calendário acadêmico, eventos, ligas e horas complementares
--   - laminário: as imagens de lâminas/slides que o PRÓPRIO aluno envia
--     (pasta privada "laminas" no Storage; cada aluno só vê as dele)
--   - salvar_texto_material(): o navegador do aluno lê PDF/Word/PowerPoint do
--     Drive e grava o texto só no material dele
-- =====================================================================

-- ---------- Avaliações: além de P1/P2/Final, seminário, entrega e outras ----------
alter table public.provas add column if not exists titulo text;
alter table public.provas add column if not exists pontos numeric(5,1);
alter table public.provas drop constraint if exists provas_tipo_check;
alter table public.provas add constraint provas_tipo_check
  check (tipo in ('P1','P2','Final','Seminário','Entrega','Outra'));
alter table public.provas drop constraint if exists provas_titulo_tamanho;
alter table public.provas add constraint provas_titulo_tamanho check (titulo is null or char_length(titulo) <= 80);
alter table public.provas drop constraint if exists provas_pontos_faixa;
alter table public.provas add constraint provas_pontos_faixa check (pontos is null or (pontos >= 0 and pontos <= 1000));
-- só P1, P2 e Final são únicas por matéria (seminários e entregas podem ser vários)
alter table public.provas drop constraint if exists provas_aluno_id_disciplina_id_tipo_modalidade_key;
create unique index if not exists provas_oficial_unica on public.provas(aluno_id, disciplina_id, tipo, modalidade)
  where tipo in ('P1','P2','Final');

-- ---------- Foco dos resumos de cada matéria ----------
alter table public.disciplinas add column if not exists foco_resumo text;
alter table public.disciplinas drop constraint if exists disciplinas_foco_tamanho;
alter table public.disciplinas add constraint disciplinas_foco_tamanho check (foco_resumo is null or char_length(foco_resumo) <= 2000);

-- ---------- Confere que a matéria e o semestre citados são do próprio aluno ----------
create or replace function public.confere_dono() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new);
begin
  if j ? 'disciplina_id' and j->>'disciplina_id' is not null
     and not exists (select 1 from public.disciplinas where id = (j->>'disciplina_id')::bigint and aluno_id = new.aluno_id) then
    raise exception 'Matéria inválida';
  end if;
  if j ? 'semestre_id' and j->>'semestre_id' is not null
     and not exists (select 1 from public.semestres where id = (j->>'semestre_id')::bigint and aluno_id = new.aluno_id) then
    raise exception 'Semestre inválido';
  end if;
  return new;
end $$;

-- temas e provas também não podem apontar para a matéria de outro aluno
drop trigger if exists confere_dono on public.temas;
create trigger confere_dono before insert or update of disciplina_id, aluno_id on public.temas
  for each row execute function public.confere_dono();
drop trigger if exists confere_dono on public.provas;
create trigger confere_dono before insert or update of disciplina_id, aluno_id on public.provas
  for each row execute function public.confere_dono();
drop trigger if exists confere_dono on public.notas;
create trigger confere_dono before insert or update of disciplina_id, aluno_id on public.notas
  for each row execute function public.confere_dono();

-- ---------- Preferências de cada aluno ----------
create table if not exists public.preferencias (
  aluno_id       uuid primary key default auth.uid() references public.perfis(id) on delete cascade,
  horas_dia      numeric(4,1) not null default 4  check (horas_dia between 0 and 16),
  horas_fds      numeric(4,1) not null default 6  check (horas_fds between 0 and 16),
  dormir         numeric(4,1) not null default 23 check (dormir between 18 and 27),
  horas_meta     numeric(6,1) not null default 200 check (horas_meta between 0 and 5000),
  modelo_resumo  text check (modelo_resumo is null or char_length(modelo_resumo) <= 4000),
  agenda_feitos  jsonb not null default '{}'::jsonb check (pg_column_size(agenda_feitos) < 60000),
  atualizado_em  timestamptz not null default now()
);

-- ---------- Resumos (o servidor grava; o aluno lê e pode apagar) ----------
alter table public.resumos add column if not exists modo text;
alter table public.resumos add column if not exists com_fonte boolean not null default false;
alter table public.resumos add column if not exists livros jsonb not null default '[]'::jsonb;
alter table public.resumos add column if not exists truncado boolean not null default false;
alter table public.resumos drop constraint if exists resumos_modo_check;
alter table public.resumos add constraint resumos_modo_check check (modo is null or modo in ('professor','livros'));

-- ---------- Mapas mentais ----------
create table if not exists public.mapas (
  tema_id    bigint primary key references public.temas(id) on delete cascade,
  aluno_id   uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  dados      jsonb not null,
  base       text,
  criado_em  timestamptz not null default now()
);

-- ---------- Questões ----------
create table if not exists public.questoes (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  disciplina_id bigint not null references public.disciplinas(id) on delete cascade,
  tema_id       bigint references public.temas(id) on delete set null,
  tema          text not null check (char_length(tema) between 1 and 200),
  tipo          text not null check (tipo in ('mc','vf','rel','dis')),
  enunciado     text not null check (char_length(enunciado) <= 6000),
  dados         jsonb not null default '{}'::jsonb check (pg_column_size(dados) < 30000),
  explicacao    text check (explicacao is null or char_length(explicacao) <= 6000),
  acertos       integer not null default 0 check (acertos >= 0),
  erros         integer not null default 0 check (erros >= 0),
  ultima        boolean,
  respondida_em timestamptz,
  criado_em     timestamptz not null default now()
);
create index if not exists questoes_aluno on public.questoes(aluno_id, disciplina_id, criado_em);

-- tudo o que a IA já fez para o aluno (fica mesmo se ele apagar a questão): a IA nunca repete
create table if not exists public.questoes_historico (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null references public.perfis(id) on delete cascade,
  disciplina_id bigint references public.disciplinas(id) on delete cascade,
  tema_chave    text not null,
  enunciado     text not null,
  chave         text not null,
  criado_em     timestamptz not null default now()
);
create index if not exists questoes_hist_aluno on public.questoes_historico(aluno_id, disciplina_id, criado_em desc);

-- ---------- Limites mensais de IA (só o administrador muda) ----------
alter table public.perfis add column if not exists limite_questoes_mes integer not null default 400;
alter table public.perfis add column if not exists limite_mapas_mes integer not null default 60;
alter table public.perfis drop constraint if exists perfis_limites_ia;
alter table public.perfis add constraint perfis_limites_ia check (
  limite_resumos_mes between 0 and 100000 and limite_questoes_mes between 0 and 100000 and limite_mapas_mes between 0 and 100000);

-- gatilho separado do protege_perfil (assim rodar o schema.sql de novo não tira esta proteção)
create or replace function public.protege_perfil_ia() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if session_user <> 'authenticator'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') = 'service_role' then
    return new;
  end if;
  if not public.is_admin() and (
       new.limite_questoes_mes is distinct from old.limite_questoes_mes or
       new.limite_mapas_mes is distinct from old.limite_mapas_mes or
       new.limite_resumos_mes is distinct from old.limite_resumos_mes) then
    raise exception 'Somente o administrador pode alterar esses campos';
  end if;
  return new;
end $$;
drop trigger if exists protege_perfil_ia on public.perfis;
create trigger protege_perfil_ia before update on public.perfis
  for each row execute function public.protege_perfil_ia();

alter table public.uso_ia add column if not exists mapas integer not null default 0;

-- Conta o uso de IA do mês. Com p_checar = true, só conta se couber no limite (devolve false se não couber).
-- p_delta negativo devolve o que foi reservado e não usado. Só o servidor chama.
create or replace function public.ia_uso(p_aluno uuid, p_tipo text, p_delta integer,
  p_tokens_entrada bigint default 0, p_tokens_saida bigint default 0, p_checar boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', current_date)::date; v_lim integer; v_atual integer;
begin
  if p_tipo not in ('resumos','questoes','mapas') then raise exception 'tipo inválido'; end if;
  select case p_tipo when 'resumos' then limite_resumos_mes when 'questoes' then limite_questoes_mes else limite_mapas_mes end
    into v_lim from public.perfis where id = p_aluno;
  if not found then return false; end if;
  insert into public.uso_ia (aluno_id, mes) values (p_aluno, v_mes) on conflict do nothing;
  select case p_tipo when 'resumos' then u.resumos when 'questoes' then u.questoes else u.mapas end
    into v_atual from public.uso_ia u where u.aluno_id = p_aluno and u.mes = v_mes for update;
  if p_checar and p_delta > 0 and v_atual + p_delta > coalesce(v_lim, 0) then return false; end if;
  update public.uso_ia u set
    resumos  = greatest(0, u.resumos  + case when p_tipo = 'resumos'  then p_delta else 0 end),
    questoes = greatest(0, u.questoes + case when p_tipo = 'questoes' then p_delta else 0 end),
    mapas    = greatest(0, u.mapas    + case when p_tipo = 'mapas'    then p_delta else 0 end),
    tokens_entrada = u.tokens_entrada + greatest(0, coalesce(p_tokens_entrada, 0)),
    tokens_saida   = u.tokens_saida   + greatest(0, coalesce(p_tokens_saida, 0))
   where u.aluno_id = p_aluno and u.mes = v_mes;
  return true;
end $$;
revoke all on function public.ia_uso(uuid, text, integer, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.ia_uso(uuid, text, integer, bigint, bigint, boolean) to service_role;

-- ---------- Horário de aulas (por semestre) ----------
create table if not exists public.horarios (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  semestre_id   bigint references public.semestres(id) on delete cascade,
  disciplina_id bigint references public.disciplinas(id) on delete cascade,
  nome          text check (nome is null or char_length(nome) <= 120),
  professor     text check (professor is null or char_length(professor) <= 120),
  dia           smallint not null check (dia between 1 and 6),
  inicio        time not null,
  fim           time not null,
  criado_em     timestamptz not null default now(),
  check (fim > inicio),
  check (disciplina_id is not null or nome is not null)
);
create index if not exists horarios_aluno on public.horarios(aluno_id, semestre_id);

-- ---------- Calendário acadêmico (feriados, parciais, semana prática...) ----------
create table if not exists public.calendario (
  id         bigint generated always as identity primary key,
  aluno_id   uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  nome       text not null check (char_length(nome) between 1 and 120),
  tipo       text not null default 'outro' check (tipo in ('feriado','parcial','pratica','final','aulas','outro')),
  inicio     date not null,
  fim        date,
  criado_em  timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index if not exists calendario_aluno on public.calendario(aluno_id, inicio);

-- ---------- Vida acadêmica ----------
create table if not exists public.vida_eventos (
  id         bigint generated always as identity primary key,
  aluno_id   uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  nome       text not null check (char_length(nome) between 1 and 160),
  detalhe    text check (detalhe is null or char_length(detalhe) <= 200),
  data       date not null,
  status     text not null default 'pend' check (status in ('pend','ins','conf','done')),
  criado_em  timestamptz not null default now()
);
create table if not exists public.ligas (
  id         bigint generated always as identity primary key,
  aluno_id   uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  nome       text not null check (char_length(nome) between 1 and 120),
  papel      text check (papel is null or char_length(papel) <= 160),
  criado_em  timestamptz not null default now()
);
create table if not exists public.horas_compl (
  id          bigint generated always as identity primary key,
  aluno_id    uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  categoria   text not null check (char_length(categoria) between 1 and 60),
  descricao   text not null check (char_length(descricao) between 1 and 200),
  horas       numeric(6,1) not null default 0 check (horas >= 0 and horas <= 2000),
  certificado boolean not null default false,
  criado_em   timestamptz not null default now()
);
create index if not exists vida_eventos_aluno on public.vida_eventos(aluno_id, data);
create index if not exists ligas_aluno on public.ligas(aluno_id);
create index if not exists horas_compl_aluno on public.horas_compl(aluno_id);

-- ---------- Laminário: imagens que o próprio aluno envia ----------
-- Limite por aluno (mude o número aqui se precisar e rode de novo)
create or replace function public.limite_laminas() returns integer language sql immutable as $$ select 300 $$;

create table if not exists public.laminas (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  disciplina_id bigint references public.disciplinas(id) on delete set null,
  tema          text check (tema is null or char_length(tema) <= 120),
  resposta      text not null check (char_length(resposta) between 1 and 300),
  orgao         text check (orgao is null or char_length(orgao) <= 120),
  vista         text check (vista is null or char_length(vista) <= 120),
  dica          text check (dica is null or char_length(dica) <= 1000),
  caminho       text not null unique check (char_length(caminho) <= 300),
  acertos       integer not null default 0 check (acertos >= 0),
  erros         integer not null default 0 check (erros >= 0),
  ultima        boolean,
  criado_em     timestamptz not null default now()
);
create index if not exists laminas_aluno on public.laminas(aluno_id, disciplina_id);

create or replace function public.laminas_limite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.laminas where aluno_id = new.aluno_id) >= public.limite_laminas() then
    raise exception 'Limite de % lâminas por aluno. Apague algumas para enviar outras.', public.limite_laminas();
  end if;
  return new;
end $$;
drop trigger if exists laminas_limite on public.laminas;
create trigger laminas_limite before insert on public.laminas
  for each row execute function public.laminas_limite();
drop trigger if exists confere_dono on public.laminas;
create trigger confere_dono before insert or update of disciplina_id, aluno_id on public.laminas
  for each row execute function public.confere_dono();
drop trigger if exists confere_dono on public.horarios;
create trigger confere_dono before insert or update of disciplina_id, semestre_id, aluno_id on public.horarios
  for each row execute function public.confere_dono();

-- Pasta PRIVADA "laminas" no Storage: cada aluno só envia, vê e apaga na pasta dele (<id do aluno>/...).
-- As imagens chegam já reduzidas pelo navegador (até ~300 KB); o limite aqui é 600 KB por imagem.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('laminas', 'laminas', false, 614400, array['image/jpeg','image/webp','image/png'])
on conflict (id) do update set public = false, file_size_limit = 614400,
  allowed_mime_types = array['image/jpeg','image/webp','image/png'];

create or replace function public.laminas_no_storage(p_aluno text) returns integer
language sql stable security definer set search_path = public, storage as $$
  select count(*)::int from storage.objects where bucket_id = 'laminas' and (storage.foldername(name))[1] = p_aluno
$$;
revoke all on function public.laminas_no_storage(text) from public, anon;
grant execute on function public.laminas_no_storage(text) to authenticated;

drop policy if exists lamina_enviar on storage.objects;
create policy lamina_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'laminas' and (storage.foldername(name))[1] = auth.uid()::text
    and public.acesso_ok() and public.laminas_no_storage(auth.uid()::text) < public.limite_laminas());
drop policy if exists lamina_ler on storage.objects;
create policy lamina_ler on storage.objects for select to authenticated
  using (bucket_id = 'laminas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists lamina_trocar on storage.objects;
create policy lamina_trocar on storage.objects for update to authenticated
  using (bucket_id = 'laminas' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'laminas' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists lamina_apagar on storage.objects;
create policy lamina_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'laminas' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------- Regras de acesso (RLS) ----------
alter table public.preferencias       enable row level security;
alter table public.mapas              enable row level security;
alter table public.questoes           enable row level security;
alter table public.questoes_historico enable row level security;
alter table public.horarios           enable row level security;
alter table public.calendario         enable row level security;
alter table public.vida_eventos       enable row level security;
alter table public.ligas              enable row level security;
alter table public.horas_compl        enable row level security;
alter table public.laminas            enable row level security;

-- o aluno cuida do que é dele (com acesso em dia); o admin só lê (suporte)
do $$
declare t text;
begin
  foreach t in array array['preferencias','horarios','calendario','vida_eventos','ligas','horas_compl','laminas'] loop
    execute format('drop policy if exists dono_tudo on public.%I', t);
    execute format($p$create policy dono_tudo on public.%I for all to authenticated
      using (aluno_id = auth.uid() and public.acesso_ok())
      with check (aluno_id = auth.uid() and public.acesso_ok())$p$, t);
    execute format('drop policy if exists admin_ler on public.%I', t);
    execute format($p$create policy admin_ler on public.%I for select to authenticated using (public.is_admin())$p$, t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- a lâmina só aponta para uma imagem da pasta do próprio aluno
drop policy if exists dono_tudo on public.laminas;
create policy dono_tudo on public.laminas for all to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok())
  with check (aluno_id = auth.uid() and public.acesso_ok() and caminho like auth.uid()::text || '/%');

-- feitos pela IA (resumos, mapas, questões): quem grava é o servidor; o aluno lê e apaga os dele
do $$
declare t text;
begin
  foreach t in array array['resumos','mapas','questoes'] loop
    execute format('drop policy if exists dono_tudo on public.%I', t);
    execute format('drop policy if exists dono_ler on public.%I', t);
    execute format($p$create policy dono_ler on public.%I for select to authenticated
      using (aluno_id = auth.uid() and public.acesso_ok())$p$, t);
    execute format('drop policy if exists dono_apagar on public.%I', t);
    execute format($p$create policy dono_apagar on public.%I for delete to authenticated
      using (aluno_id = auth.uid() and public.acesso_ok())$p$, t);
    execute format('drop policy if exists admin_ler on public.%I', t);
    execute format($p$create policy admin_ler on public.%I for select to authenticated using (public.is_admin())$p$, t);
    execute format('revoke insert, update, truncate on public.%I from anon, authenticated', t);
    execute format('grant select, delete on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- nas questões, o aluno só marca acerto/erro (não muda a questão)
drop policy if exists dono_responder on public.questoes;
create policy dono_responder on public.questoes for update to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok())
  with check (aluno_id = auth.uid() and public.acesso_ok());
grant update (acertos, erros, ultima, respondida_em) on public.questoes to authenticated;

-- histórico das questões: só o servidor
revoke all on public.questoes_historico from anon, authenticated;

-- ---------- O navegador lê PDF/Word/PowerPoint e grava o texto no material do próprio aluno ----------
-- O aluno não grava direto na tabela materiais; só por esta função, e só no que é dele.
create or replace function public.salvar_texto_material(p_id bigint, p_texto text, p_status text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_texto text; v_status text;
begin
  if auth.uid() is null or not public.acesso_ok() then raise exception 'Acesso não liberado'; end if;
  if not exists (select 1 from public.materiais where id = p_id and aluno_id = auth.uid()) then
    raise exception 'Material não encontrado';
  end if;
  if p_status is not null and p_status not in ('grande_demais','erro','sem_texto') then raise exception 'status inválido'; end if;
  v_texto := left(btrim(coalesce(p_texto, '')), 300000);  -- o navegador já tira os caracteres de controle
  if p_status is not null then v_status := p_status; v_texto := null;
  elsif char_length(v_texto) >= 20 then v_status := 'ok';
  else v_status := 'sem_texto'; v_texto := null; end if;
  update public.materiais
     set texto = v_texto, status = v_status, tentativas = 0,
         erro = case when v_status = 'erro' then 'Não consegui ler este arquivo.' else null end
   where id = p_id and aluno_id = auth.uid();
  return v_status;
end $$;
revoke all on function public.salvar_texto_material(bigint, text, text) from public, anon;
grant execute on function public.salvar_texto_material(bigint, text, text) to authenticated;

-- ---------- Índices ----------
create index if not exists temas_disc on public.temas(disciplina_id);
create index if not exists materiais_tema on public.materiais(tema_id);
create index if not exists notas_disc on public.notas(disciplina_id);
