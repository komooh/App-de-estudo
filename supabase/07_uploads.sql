-- =====================================================================
-- Painel de Estudos · atualização 07: enviar arquivos e importar o calendário de provas
-- Rode DEPOIS do 06_estudo.sql. Pode rodar de novo sem problema.
--
-- O que este arquivo faz:
--   - materiais: além dos arquivos do Drive, os arquivos que o aluno envia do computador
--     ou do celular (origem 'upload'). O ARQUIVO NÃO É GUARDADO: o navegador lê o texto
--     e só o texto vai para o banco.
--   - enviar_material(): a única forma de o aluno criar um material (confere a matéria,
--     cria ou reaproveita o tema e respeita os limites).
--   - limite mensal de importações do calendário com IA (uso_ia.calendarios).
-- =====================================================================

-- ---------- Materiais enviados pelo aluno (sem pasta do Drive) ----------
alter table public.materiais add column if not exists origem text not null default 'drive';
alter table public.materiais add column if not exists paginas integer;
alter table public.materiais alter column fonte_id drop not null;
alter table public.materiais alter column drive_file_id drop not null;
alter table public.materiais drop constraint if exists materiais_origem_check;
alter table public.materiais add constraint materiais_origem_check check (
  (origem = 'drive'  and fonte_id is not null and drive_file_id is not null) or
  (origem = 'upload' and fonte_id is null     and drive_file_id is null));
alter table public.materiais drop constraint if exists materiais_paginas_faixa;
alter table public.materiais add constraint materiais_paginas_faixa check (paginas is null or paginas between 0 and 100000);
create index if not exists materiais_upload on public.materiais(aluno_id) where origem = 'upload';

-- Limites por aluno (mude os números aqui e rode de novo)
create or replace function public.limite_uploads() returns integer language sql immutable as $$ select 400 $$;          -- arquivos enviados
create or replace function public.limite_letras_upload() returns integer language sql immutable as $$ select 300000 $$; -- letras por arquivo
create or replace function public.limite_letras_uploads() returns bigint language sql immutable as $$ select 40000000::bigint $$; -- letras somando todos (~40 MB)

-- O navegador manda o texto já lido; o banco confere tudo e grava só no que é do aluno.
create or replace function public.enviar_material(p_disciplina_id bigint, p_tema_nome text, p_nome text,
  p_mime text, p_texto text, p_paginas integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid(); v_tema bigint; v_novo boolean := false; v_id bigint;
  v_nome text; v_tema_nome text; v_texto text; v_trunc boolean; v_total bigint;
begin
  if v_uid is null or not public.acesso_ok() then raise exception 'Acesso não liberado'; end if;
  -- a matéria precisa ser do aluno (de qualquer semestre dele)
  if p_disciplina_id is null or not exists (select 1 from public.disciplinas where id = p_disciplina_id and aluno_id = v_uid) then
    raise exception 'Matéria não encontrada';
  end if;
  if p_mime is null or p_mime not in ('application/pdf','text/plain','text/markdown',
       'application/vnd.openxmlformats-officedocument.presentationml.presentation',
       'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    raise exception 'Tipo de arquivo não aceito';
  end if;
  v_nome := left(btrim(regexp_replace(coalesce(p_nome, ''), '[[:cntrl:]]+', ' ', 'g')), 300);
  if v_nome = '' then raise exception 'Arquivo sem nome'; end if;
  v_texto := btrim(regexp_replace(coalesce(p_texto, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', ' ', 'g'));
  v_trunc := char_length(v_texto) > public.limite_letras_upload();
  v_texto := left(v_texto, public.limite_letras_upload());
  if char_length(v_texto) < 20 then raise exception 'Arquivo sem texto'; end if;

  -- um envio por vez de cada aluno (assim o limite não é furado com envios ao mesmo tempo)
  perform pg_advisory_xact_lock(hashtextextended('enviar_material:' || v_uid::text, 0));
  select count(*), coalesce(sum(char_length(texto)), 0) into v_id, v_total
    from public.materiais where aluno_id = v_uid and origem = 'upload';
  if v_id >= public.limite_uploads() then
    raise exception 'Limite de % arquivos enviados. Apague alguns para enviar outros.', public.limite_uploads();
  end if;
  if v_total + char_length(v_texto) > public.limite_letras_uploads() then
    raise exception 'Limite de espaço dos arquivos enviados. Apague alguns para enviar outros.';
  end if;

  -- tema: o escolhido (mesmo nome, sem diferença de maiúsculas) ou um novo
  v_tema_nome := left(btrim(regexp_replace(coalesce(p_tema_nome, ''), '\s+', ' ', 'g')), 120);
  if v_tema_nome = '' then v_tema_nome := left(regexp_replace(v_nome, '\.[A-Za-z0-9]{1,5}$', ''), 120); end if;
  select id into v_tema from public.temas
   where aluno_id = v_uid and disciplina_id = p_disciplina_id and lower(nome) = lower(v_tema_nome) order by id limit 1;
  if v_tema is null then
    insert into public.temas (aluno_id, disciplina_id, nome, origem, ordem)
    values (v_uid, p_disciplina_id, v_tema_nome, 'upload',
            least(32767, coalesce((select max(ordem) + 1 from public.temas where disciplina_id = p_disciplina_id), 0)))
    returning id into v_tema;
    v_novo := true;
  end if;

  insert into public.materiais (aluno_id, origem, nome, mime, caminho, disciplina_id, tema_id, texto, status, paginas)
  values (v_uid, 'upload', v_nome, p_mime, 'Enviado por você', p_disciplina_id, v_tema, v_texto, 'ok',
          case when p_paginas between 0 and 100000 then p_paginas end)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'tema_id', v_tema, 'tema_novo', v_novo, 'status', 'ok', 'truncado', v_trunc);
end $$;
revoke all on function public.enviar_material(bigint, text, text, text, text, integer) from public, anon;
grant execute on function public.enviar_material(bigint, text, text, text, text, integer) to authenticated;

-- ---------- Importar o calendário com IA: limite por mês ----------
alter table public.perfis add column if not exists limite_calendarios_mes integer not null default 10;
alter table public.perfis drop constraint if exists perfis_limite_calendarios;
alter table public.perfis add constraint perfis_limite_calendarios check (limite_calendarios_mes between 0 and 100000);
alter table public.uso_ia add column if not exists calendarios integer not null default 0;

-- o aluno não muda os próprios limites (agora também o do calendário)
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
       new.limite_resumos_mes is distinct from old.limite_resumos_mes or
       new.limite_calendarios_mes is distinct from old.limite_calendarios_mes) then
    raise exception 'Somente o administrador pode alterar esses campos';
  end if;
  return new;
end $$;

-- ia_uso com o tipo 'calendarios' (mesma assinatura do 06)
create or replace function public.ia_uso(p_aluno uuid, p_tipo text, p_delta integer,
  p_tokens_entrada bigint default 0, p_tokens_saida bigint default 0, p_checar boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', current_date)::date; v_lim integer; v_atual integer;
begin
  if p_tipo not in ('resumos','questoes','mapas','calendarios') then raise exception 'tipo inválido'; end if;
  select case p_tipo when 'resumos' then limite_resumos_mes when 'questoes' then limite_questoes_mes
                     when 'mapas' then limite_mapas_mes else limite_calendarios_mes end
    into v_lim from public.perfis where id = p_aluno;
  if not found then return false; end if;
  insert into public.uso_ia (aluno_id, mes) values (p_aluno, v_mes) on conflict do nothing;
  select case p_tipo when 'resumos' then u.resumos when 'questoes' then u.questoes when 'mapas' then u.mapas else u.calendarios end
    into v_atual from public.uso_ia u where u.aluno_id = p_aluno and u.mes = v_mes for update;
  if p_checar and p_delta > 0 and v_atual + p_delta > coalesce(v_lim, 0) then return false; end if;
  update public.uso_ia u set
    resumos     = greatest(0, u.resumos     + case when p_tipo = 'resumos'     then p_delta else 0 end),
    questoes    = greatest(0, u.questoes    + case when p_tipo = 'questoes'    then p_delta else 0 end),
    mapas       = greatest(0, u.mapas       + case when p_tipo = 'mapas'       then p_delta else 0 end),
    calendarios = greatest(0, u.calendarios + case when p_tipo = 'calendarios' then p_delta else 0 end),
    tokens_entrada = u.tokens_entrada + greatest(0, coalesce(p_tokens_entrada, 0)),
    tokens_saida   = u.tokens_saida   + greatest(0, coalesce(p_tokens_saida, 0))
   where u.aluno_id = p_aluno and u.mes = v_mes;
  return true;
end $$;
revoke all on function public.ia_uso(uuid, text, integer, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.ia_uso(uuid, text, integer, bigint, bigint, boolean) to service_role;
