-- =====================================================================
-- Painel de Estudos · atualização 13: Minha conta (apagar meus dados / excluir minha conta)
-- Rode DEPOIS do 12_estudo_extra.sql. Pode rodar de novo sem problema.
--
-- O que este arquivo faz (Configurações → Minha conta, assets/conta.js):
--   - minha_conta_resumo(): quantos registros o aluno tem (o site mostra antes de apagar).
--   - apagar_meus_dados(): apaga TUDO o que o aluno logado criou, em todas as tabelas do site que têm a
--     coluna aluno_id (a lista é montada na hora, então tabelas novas entram sozinhas), menos:
--       perfis (a conta), termos_aceites (registro dos aceites) e uso_ia (uso de IA do mês: assim
--       ninguém zera o limite do mês apagando os dados).
--     Depois volta o perfil para "não configurado" (onboarding_ok, faculdade, semestre, turma e foto),
--     e o site mostra a configuração inicial. Login, nome, e-mail, admin, plano, vencimento e limites ficam.
--   - excluir_minha_conta(): o mesmo e ainda apaga o login (auth.users) e o perfil. Recusa administrador.
--   Os arquivos do Storage (foto, lâminas, páginas enviadas) são apagados pelo navegador antes
--   (o Supabase não deixa apagar storage.objects pelo SQL).
--
-- Segurança: as funções não recebem id nenhum; só mexem em auth.uid(). Só quem está logado chama.
-- Os gatilhos de proteção continuam iguais para os pedidos normais do site:
--   - materiais_apagar (08): apagar um arquivo do Drive pelo site só oculta. Aqui as pastas do Drive
--     (drive_fontes) são apagadas primeiro; os arquivos delas saem em cascata e aí apagam de verdade.
--   - protege_perfil / protege_perfil_ia / protege_perfil_termos: os campos que voltam ao início
--     (onboarding_ok, faculdade, semestre, turma, foto) não são protegidos; nada protegido é alterado.
-- =====================================================================

-- Tabelas apagadas pelo "apagar meus dados": todas as do schema public com a coluna aluno_id, menos as que ficam.
-- drive_fontes vem primeiro (veja acima); depois, em ordem alfabética. Se uma tabela ainda é usada por outra
-- (ex.: semestres, enquanto há matérias), tenta de novo na volta seguinte.
create or replace function public.minha_conta_tabelas() returns text[]
language sql stable security definer set search_path = public, pg_catalog as $$
  select coalesce(array_agg(c.relname::text order by (c.relname <> 'drive_fontes'), c.relname), '{}')
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attname = 'aluno_id' and not a.attisdropped and a.attnum > 0
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
     and c.relname not in ('perfis', 'termos_aceites', 'uso_ia')
$$;
revoke all on function public.minha_conta_tabelas() from public, anon, authenticated;

-- ---------- Quanto o aluno tem (só contagem) ----------
create or replace function public.minha_conta_resumo() returns jsonb
language plpgsql stable security definer set search_path = public, pg_catalog as $$
declare v_uid uuid := auth.uid(); v_t text; v_n bigint; v_tab jsonb := '{}'::jsonb; v_total bigint := 0;
begin
  if v_uid is null then raise exception 'Entre na sua conta para continuar'; end if;
  foreach v_t in array public.minha_conta_tabelas() loop
    execute format('select count(*) from public.%I where aluno_id = $1', v_t) into v_n using v_uid;
    if v_n > 0 then v_tab := v_tab || jsonb_build_object(v_t, v_n); v_total := v_total + v_n; end if;
  end loop;
  return jsonb_build_object('total', v_total, 'tabelas', v_tab, 'admin', public.is_admin());
end $$;
revoke all on function public.minha_conta_resumo() from public, anon;
grant execute on function public.minha_conta_resumo() to authenticated;

-- ---------- Apagar meus dados e começar do zero ----------
create or replace function public.apagar_meus_dados() returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_uid uuid := auth.uid();
  v_falta text[]; v_resto text[]; v_t text; v_n bigint; v_total bigint := 0; v_tab jsonb := '{}'::jsonb; v_volta int := 0; v_erro text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para apagar seus dados'; end if;
  v_falta := public.minha_conta_tabelas();
  while coalesce(array_length(v_falta, 1), 0) > 0 loop
    v_volta := v_volta + 1;
    if v_volta > 12 then
      raise exception 'Não consegui apagar tudo (%). Nada foi apagado. Avise o administrador.', v_erro;
    end if;
    v_resto := '{}';
    foreach v_t in array v_falta loop
      begin
        execute format('delete from public.%I where aluno_id = $1', v_t) using v_uid;
        get diagnostics v_n = row_count;
        if v_n > 0 then v_tab := v_tab || jsonb_build_object(v_t, coalesce((v_tab->>v_t)::bigint, 0) + v_n); v_total := v_total + v_n; end if;
      exception when foreign_key_violation then
        v_resto := v_resto || v_t; v_erro := v_t || ': ' || sqlerrm;
      end;
    end loop;
    v_falta := v_resto;
  end loop;
  -- algo ficou para trás (um gatilho que só oculta, por exemplo)? então não apaga nada
  foreach v_t in array public.minha_conta_tabelas() loop
    execute format('select count(*) from public.%I where aluno_id = $1', v_t) into v_n using v_uid;
    if v_n > 0 then raise exception 'Não consegui apagar tudo (sobrou em %). Nada foi apagado. Avise o administrador.', v_t; end if;
  end loop;
  -- o perfil volta para "não configurado": a próxima entrada mostra a configuração inicial
  update public.perfis
     set onboarding_ok = false, faculdade_id = null, semestre = null, turma = null, avatar_url = null
   where id = v_uid;
  return jsonb_build_object('total', v_total, 'tabelas', v_tab);
end $$;
revoke all on function public.apagar_meus_dados() from public, anon;
grant execute on function public.apagar_meus_dados() to authenticated;

-- ---------- Excluir minha conta (o login também) ----------
-- Precisa ser criada pelo dono do banco (no SQL Editor do Supabase é o "postgres"), que pode apagar auth.users.
create or replace function public.excluir_minha_conta() returns jsonb
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_uid uuid := auth.uid(); v_res jsonb;
begin
  if v_uid is null then raise exception 'Entre na sua conta para excluir a conta'; end if;
  if public.is_admin() then raise exception 'A conta de administrador não pode ser excluída por aqui'; end if;
  v_res := public.apagar_meus_dados();
  -- perfis -> auth.users é "on delete cascade" (schema.sql), mas apaga o perfil antes, explícito:
  -- leva junto termos_aceites e uso_ia (cascata pelo aluno_id)
  delete from public.perfis where id = v_uid;
  delete from auth.users where id = v_uid;   -- sessões e identidades do login saem em cascata
  return v_res || jsonb_build_object('conta_excluida', true);
end $$;
revoke all on function public.excluir_minha_conta() from public, anon;
grant execute on function public.excluir_minha_conta() to authenticated;
