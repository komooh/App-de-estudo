-- 14_materia_manual.sql — o aluno escolhe a matéria de um arquivo (Drive ou enviado).
-- Rode depois do 13. Pode rodar mais de uma vez.
--
-- Arquivos do Drive ganham matéria pelo nome da subpasta. Quando não dá (ex.: "PA IV.pptx" solto na pasta),
-- o arquivo fica em "Sem matéria". Agora o aluno escolhe a matéria ao lado do arquivo; a escolha fica
-- marcada (materia_manual) e a próxima leitura da pasta não muda.

alter table public.materiais add column if not exists materia_manual boolean not null default false;

create or replace function public.mudar_materia_material(p_id bigint, p_disciplina_id bigint, p_tema_nome text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m public.materiais%rowtype;
  v_tema bigint;
  v_nome text := left(btrim(coalesce(p_tema_nome, '')), 120);
  v_velho bigint;
  v_tem boolean := false;
  t text;
begin
  if auth.uid() is null or not public.acesso_ok() then raise exception 'Acesso não liberado.'; end if;
  select * into m from public.materiais where id = p_id and aluno_id = auth.uid();
  if not found then raise exception 'Arquivo não encontrado.'; end if;
  if p_disciplina_id is not null then
    if not exists (select 1 from public.disciplinas where id = p_disciplina_id and aluno_id = auth.uid()) then
      raise exception 'Matéria não encontrada.';
    end if;
    if v_nome = '' then v_nome := left(m.nome, 120); end if;
    select id into v_tema from public.temas
      where aluno_id = auth.uid() and disciplina_id = p_disciplina_id and lower(btrim(nome)) = lower(v_nome)
      order by id limit 1;
    if v_tema is null then
      insert into public.temas (aluno_id, disciplina_id, nome, origem)
      values (auth.uid(), p_disciplina_id, v_nome, coalesce(m.origem, 'drive'))
      returning id into v_tema;
    end if;
  end if;

  v_velho := m.tema_id;
  update public.materiais
     set disciplina_id = p_disciplina_id, tema_id = v_tema, materia_manual = true, ignorado = false
   where id = p_id;

  -- o tema antigo que nasceu só deste arquivo (sem estudo feito) sai junto
  if v_velho is not null and v_velho is distinct from v_tema then
    if exists (select 1 from public.temas where id = v_velho and origem in ('drive', 'upload')
                 and not aula and not resumo_ok and not questoes_ok)
       and not exists (select 1 from public.materiais where tema_id = v_velho) then
      foreach t in array array['resumos', 'mapas', 'questoes', 'flashcards', 'paineis'] loop
        if to_regclass('public.' || t) is not null then
          execute format('select exists (select 1 from public.%I where tema_id = $1)', t) into v_tem using v_velho;
          exit when v_tem;
        end if;
      end loop;
      if not v_tem then delete from public.temas where id = v_velho; end if;
    end if;
  end if;
  return jsonb_build_object('tema_id', v_tema, 'disciplina_id', p_disciplina_id);
end $$;

revoke all on function public.mudar_materia_material(bigint, bigint, text) from public, anon;
grant execute on function public.mudar_materia_material(bigint, bigint, text) to authenticated;
