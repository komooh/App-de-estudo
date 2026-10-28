-- =====================================================================
-- Painel de Estudos · atualização 11: importar do painel antigo (só o administrador)
-- Rode DEPOIS do 10_memoria_resumo.sql. Pode rodar de novo sem problema.
--
-- Por que existe: resumos, mapas mentais e questões só são gravados pelo
-- servidor (o aluno não tem permissão de insert nessas tabelas, 06_estudo.sql).
-- Para levar os resumos, mapas e questões do painel antigo, o administrador
-- precisa gravar nessas tabelas pelo navegador. Esta função faz isso:
--   - só para quem é administrador (is_admin) e está com o acesso em dia;
--   - só na conta de quem chama (auth.uid()), e só em temas/matérias dele;
--   - com os mesmos limites de tamanho das tabelas, até 200 itens por chamada;
--   - sem repetir: resumo/mapa que já existe não é trocado; questão que já
--     existe (mesma chave no histórico ou mesmo enunciado) é pulada.
-- Nenhum aluno ganha permissão nova: para quem não é admin a função recusa.
-- Todo o resto da importação (matérias, temas, provas, notas, aulas,
-- calendário, vida acadêmica, preferências) usa as tabelas de sempre, com as
-- regras de acesso de sempre.
-- =====================================================================

create or replace function public.importar_painel(p_tipo text, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  it jsonb; i integer := -1; n integer;
  v_ok integer := 0; v_ja integer := 0; v_err jsonb := '[]'::jsonb;
  v_tema bigint; v_disc bigint; v_txt text; v_tipo text; v_dados jsonb; v_chave text; v_enun text; v_total integer;
begin
  if v_uid is null or not public.acesso_ok() then raise exception 'Acesso não liberado'; end if;
  if not public.is_admin() then raise exception 'Só o administrador pode importar do painel antigo'; end if;
  if p_tipo is null or p_tipo not in ('resumos','mapas','questoes') then raise exception 'Tipo inválido'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Itens inválidos'; end if;
  if jsonb_array_length(p_itens) > 200 then raise exception 'Mande até 200 itens por vez'; end if;
  if p_tipo = 'questoes' then
    select count(*) into v_total from public.questoes where aluno_id = v_uid;
  end if;

  for it in select value from jsonb_array_elements(p_itens) loop
    i := i + 1;
    begin
      if jsonb_typeof(it) <> 'object' then raise exception 'item inválido'; end if;

      if p_tipo in ('resumos','mapas') then
        v_tema := case when jsonb_typeof(it->'tema_id') = 'number' then (it->>'tema_id')::bigint end;
        if v_tema is null or not exists (select 1 from public.temas where id = v_tema and aluno_id = v_uid) then
          raise exception 'tema não encontrado';
        end if;
      end if;

      if p_tipo = 'resumos' then
        v_txt := btrim(coalesce(it->>'texto', ''));
        if char_length(v_txt) < 15 then raise exception 'resumo vazio'; end if;
        if char_length(v_txt) > 200000 then raise exception 'resumo com mais de 200 mil letras'; end if;
        insert into public.resumos (tema_id, aluno_id, texto, modelo, truncado, criado_em)
        values (v_tema, v_uid, v_txt, 'painel-antigo', coalesce((it->>'truncado')::boolean, false),
                coalesce(case when (it->>'criado_em') ~ '^\d{4}-\d{2}-\d{2}' then (it->>'criado_em')::timestamptz end, now()))
        on conflict (tema_id) do nothing;
        get diagnostics n = row_count;

      elsif p_tipo = 'mapas' then
        v_dados := it->'dados';
        if v_dados is null or jsonb_typeof(v_dados) <> 'object' or jsonb_typeof(v_dados->'ramos') <> 'array'
           or jsonb_array_length(v_dados->'ramos') = 0 or jsonb_array_length(v_dados->'ramos') > 8 then
          raise exception 'mapa sem ramos';
        end if;
        if pg_column_size(v_dados) > 60000 then raise exception 'mapa grande demais'; end if;
        insert into public.mapas (tema_id, aluno_id, dados, base, criado_em)
        values (v_tema, v_uid, v_dados, 'painel-antigo',
                coalesce(case when (it->>'criado_em') ~ '^\d{4}-\d{2}-\d{2}' then (it->>'criado_em')::timestamptz end, now()))
        on conflict (tema_id) do nothing;
        get diagnostics n = row_count;

      else -- questões (+ histórico, para a IA nunca repetir)
        v_disc := case when jsonb_typeof(it->'disciplina_id') = 'number' then (it->>'disciplina_id')::bigint end;
        if v_disc is null or not exists (select 1 from public.disciplinas where id = v_disc and aluno_id = v_uid) then
          raise exception 'matéria não encontrada';
        end if;
        v_tema := case when jsonb_typeof(it->'tema_id') = 'number' then (it->>'tema_id')::bigint end;
        if v_tema is not null and not exists (select 1 from public.temas where id = v_tema and aluno_id = v_uid and disciplina_id = v_disc) then
          raise exception 'tema não encontrado';
        end if;
        v_tipo := it->>'tipo';
        if v_tipo is null or v_tipo not in ('mc','vf','rel','dis') then raise exception 'tipo de questão inválido'; end if;
        v_enun := btrim(coalesce(it->>'enunciado', ''));
        if v_enun = '' or char_length(v_enun) > 6000 then raise exception 'enunciado vazio ou com mais de 6000 letras'; end if;
        v_dados := it->'dados';
        if v_dados is null or jsonb_typeof(v_dados) <> 'object' or pg_column_size(v_dados) >= 30000 then raise exception 'dados da questão inválidos'; end if;
        v_chave := left(coalesce(it->>'chave', ''), 4000);
        if v_chave = '' then raise exception 'questão sem chave'; end if;
        if exists (select 1 from public.questoes_historico where aluno_id = v_uid and disciplina_id = v_disc and chave = v_chave)
           or exists (select 1 from public.questoes where aluno_id = v_uid and disciplina_id = v_disc and tipo = v_tipo and enunciado = v_enun) then
          n := 0;
        else
          if v_total >= 20000 then raise exception 'Limite de 20 mil questões por aluno'; end if;
          insert into public.questoes (aluno_id, disciplina_id, tema_id, tema, tipo, enunciado, dados, explicacao, acertos, erros, ultima)
          values (v_uid, v_disc, v_tema, left(btrim(coalesce(nullif(it->>'tema', ''), 'Importada')), 200), v_tipo, v_enun, v_dados,
                  nullif(left(btrim(coalesce(it->>'explicacao', '')), 6000), ''),
                  least(greatest(coalesce((it->>'acertos')::integer, 0), 0), 100000),
                  least(greatest(coalesce((it->>'erros')::integer, 0), 0), 100000),
                  case when jsonb_typeof(it->'ultima') = 'boolean' then (it->>'ultima')::boolean end);
          insert into public.questoes_historico (aluno_id, disciplina_id, tema_chave, enunciado, chave)
          values (v_uid, v_disc, left(coalesce(it->>'tema_chave', ''), 200), left(regexp_replace(v_enun, '\s+', ' ', 'g'), 170), v_chave);
          v_total := v_total + 1;
          n := 1;
        end if;
      end if;

      if n > 0 then v_ok := v_ok + 1; else v_ja := v_ja + 1; end if;
    exception when others then
      v_err := v_err || jsonb_build_object('i', i, 'motivo', left(sqlerrm, 200));
    end;
  end loop;
  return jsonb_build_object('importados', v_ok, 'ja_existiam', v_ja, 'erros', v_err);
end $$;

revoke all on function public.importar_painel(text, jsonb) from public, anon;
grant execute on function public.importar_painel(text, jsonb) to authenticated;
