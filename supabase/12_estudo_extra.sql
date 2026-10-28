-- =====================================================================
-- Painel de Estudos · atualização 12: flash cards, painel do tema e memória de estudo
-- Rode DEPOIS do 11_importar_painel.sql. Pode rodar de novo sem problema.
--
-- O que este arquivo faz:
--   - flashcards: cartões frente/verso de cada tema, feitos pela IA (quem grava é o servidor).
--     O aluno lê, apaga e só muda a caixa da revisão (caixa e proxima: revisão espaçada simples).
--   - limite mensal de gerações de flash cards (perfis.limite_flashcards_mes, 10 por padrão;
--     contador uso_ia.flashcards). Só o administrador muda o limite.
--   - paineis: o "painel do tema" (resumo visual em cartões), um por tema, feito pela IA (quem grava é
--     o servidor; o aluno lê e apaga). Conta no limite de mapas mentais (não tem limite próprio).
--   - memória de estudo: além da memória do resumo (10_memoria_resumo.sql), o jeito que o aluno quer
--     as questões, o mapa mental, os flash cards e o painel (texto livre, até 1500 letras cada).
--     São preferências de ESTILO: a função "ia" nunca deixa que mudem as regras (só o material, sem inventar, mesmo JSON).
-- =====================================================================

-- ---------- Flash cards ----------
create table if not exists public.flashcards (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  disciplina_id bigint not null references public.disciplinas(id) on delete cascade,
  tema_id       bigint not null references public.temas(id) on delete cascade,
  frente        text not null check (char_length(frente) between 1 and 400),
  verso         text not null check (char_length(verso) between 1 and 1000),
  dica          text check (dica is null or char_length(dica) <= 300),
  caixa         integer not null default 0 check (caixa between 0 and 5),
  proxima       date,
  criado_em     timestamptz not null default now()
);
create index if not exists flashcards_tema on public.flashcards(aluno_id, tema_id);
create index if not exists flashcards_disc on public.flashcards(aluno_id, disciplina_id);

alter table public.flashcards enable row level security;
drop policy if exists dono_ler on public.flashcards;
create policy dono_ler on public.flashcards for select to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists dono_apagar on public.flashcards;
create policy dono_apagar on public.flashcards for delete to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists dono_revisar on public.flashcards;
create policy dono_revisar on public.flashcards for update to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok())
  with check (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists admin_ler on public.flashcards;
create policy admin_ler on public.flashcards for select to authenticated using (public.is_admin());
revoke all on public.flashcards from anon, authenticated;
grant select, delete on public.flashcards to authenticated;
grant update (caixa, proxima) on public.flashcards to authenticated;

-- ---------- Limite de flash cards por mês (só o administrador muda) ----------
alter table public.perfis add column if not exists limite_flashcards_mes integer not null default 10;
alter table public.perfis drop constraint if exists perfis_limite_flashcards;
alter table public.perfis add constraint perfis_limite_flashcards check (limite_flashcards_mes between 0 and 100000);
alter table public.uso_ia add column if not exists flashcards integer not null default 0;

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
       new.limite_calendarios_mes is distinct from old.limite_calendarios_mes or
       new.limite_flashcards_mes is distinct from old.limite_flashcards_mes) then
    raise exception 'Somente o administrador pode alterar esses campos';
  end if;
  return new;
end $$;

-- ia_uso com o tipo 'flashcards' (mesma assinatura do 06/07)
create or replace function public.ia_uso(p_aluno uuid, p_tipo text, p_delta integer,
  p_tokens_entrada bigint default 0, p_tokens_saida bigint default 0, p_checar boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_mes date := date_trunc('month', current_date)::date; v_lim integer; v_atual integer;
begin
  if p_tipo not in ('resumos','questoes','mapas','calendarios','flashcards') then raise exception 'tipo inválido'; end if;
  select case p_tipo when 'resumos' then limite_resumos_mes when 'questoes' then limite_questoes_mes
                     when 'mapas' then limite_mapas_mes when 'flashcards' then limite_flashcards_mes else limite_calendarios_mes end
    into v_lim from public.perfis where id = p_aluno;
  if not found then return false; end if;
  insert into public.uso_ia (aluno_id, mes) values (p_aluno, v_mes) on conflict do nothing;
  select case p_tipo when 'resumos' then u.resumos when 'questoes' then u.questoes when 'mapas' then u.mapas
                     when 'flashcards' then u.flashcards else u.calendarios end
    into v_atual from public.uso_ia u where u.aluno_id = p_aluno and u.mes = v_mes for update;
  if p_checar and p_delta > 0 and v_atual + p_delta > coalesce(v_lim, 0) then return false; end if;
  update public.uso_ia u set
    resumos     = greatest(0, u.resumos     + case when p_tipo = 'resumos'     then p_delta else 0 end),
    questoes    = greatest(0, u.questoes    + case when p_tipo = 'questoes'    then p_delta else 0 end),
    mapas       = greatest(0, u.mapas       + case when p_tipo = 'mapas'       then p_delta else 0 end),
    calendarios = greatest(0, u.calendarios + case when p_tipo = 'calendarios' then p_delta else 0 end),
    flashcards  = greatest(0, u.flashcards  + case when p_tipo = 'flashcards'  then p_delta else 0 end),
    tokens_entrada = u.tokens_entrada + greatest(0, coalesce(p_tokens_entrada, 0)),
    tokens_saida   = u.tokens_saida   + greatest(0, coalesce(p_tokens_saida, 0))
   where u.aluno_id = p_aluno and u.mes = v_mes;
  return true;
end $$;
revoke all on function public.ia_uso(uuid, text, integer, bigint, bigint, boolean) from public, anon, authenticated;
grant execute on function public.ia_uso(uuid, text, integer, bigint, bigint, boolean) to service_role;

-- ---------- Painel do tema ----------
create table if not exists public.paineis (
  tema_id    bigint primary key references public.temas(id) on delete cascade,   -- um por tema (e o tema é de um aluno só)
  aluno_id   uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  dados      jsonb not null check (pg_column_size(dados) < 60000),
  criado_em  timestamptz not null default now(),
  unique (aluno_id, tema_id)
);
alter table public.paineis enable row level security;
drop policy if exists dono_ler on public.paineis;
create policy dono_ler on public.paineis for select to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists dono_apagar on public.paineis;
create policy dono_apagar on public.paineis for delete to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists admin_ler on public.paineis;
create policy admin_ler on public.paineis for select to authenticated using (public.is_admin());
revoke all on public.paineis from anon, authenticated;
grant select, delete on public.paineis to authenticated;

-- ---------- Memória de estudo (mesmas regras de acesso das preferências: cada aluno só lê e muda a dele) ----------
alter table public.preferencias add column if not exists memoria_questoes text;
alter table public.preferencias add column if not exists memoria_mapa text;
alter table public.preferencias add column if not exists memoria_flashcards text;
alter table public.preferencias add column if not exists memoria_painel text;
alter table public.preferencias drop constraint if exists preferencias_memorias_tamanho;
alter table public.preferencias add constraint preferencias_memorias_tamanho check (
  (memoria_questoes is null or char_length(memoria_questoes) <= 1500) and (memoria_mapa is null or char_length(memoria_mapa) <= 1500) and
  (memoria_flashcards is null or char_length(memoria_flashcards) <= 1500) and (memoria_painel is null or char_length(memoria_painel) <= 1500));

-- ---------- Tarefas: os tipos novos ----------
alter table public.tarefas drop constraint if exists tarefas_tipo_check;
alter table public.tarefas add constraint tarefas_tipo_check check (tipo in ('resumo','mapa','questoes','documento','calendario','flashcards','painel'));
