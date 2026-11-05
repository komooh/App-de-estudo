-- 15_questoes_professor.sql — questões do professor e caso clínico.
-- Rode depois do 14. Pode rodar mais de uma vez.
--
-- O que este arquivo faz:
--   - questoes.origem: 'ia' (geradas pela IA, o padrão de todas as que já existem), 'professor' (importadas de um
--     arquivo que o professor mandou) ou 'painel' (reservado para o painel antigo).
--   - questoes.tipo ganha 'caso' (caso clínico com várias perguntas, em dados.subs).
--   - limites maiores para caber um caso clínico de prova: enunciado até 12 mil letras e dados até ~100 KB.
--   - tarefas.tipo ganha 'questoes_importar' (a leitura das questões roda no servidor). Os tipos que já
--     estavam liberados (inclusive os de outros arquivos) continuam.
-- As regras de acesso não mudam: o aluno só lê, responde e apaga as questões dele; quem grava é a função "ia".

alter table public.questoes add column if not exists origem text not null default 'ia';
alter table public.questoes drop constraint if exists questoes_origem_check;
alter table public.questoes add constraint questoes_origem_check check (origem in ('ia', 'professor', 'painel'));

alter table public.questoes drop constraint if exists questoes_tipo_check;
alter table public.questoes add constraint questoes_tipo_check check (tipo in ('mc', 'vf', 'rel', 'dis', 'caso'));

alter table public.questoes drop constraint if exists questoes_enunciado_check;
alter table public.questoes add constraint questoes_enunciado_check check (char_length(enunciado) <= 12000);

alter table public.questoes drop constraint if exists questoes_dados_check;
alter table public.questoes add constraint questoes_dados_check check (pg_column_size(dados) < 100000);

create index if not exists questoes_origem on public.questoes(aluno_id, disciplina_id, origem);

-- tarefas: junta 'questoes_importar' aos tipos que já estão liberados (sem tirar nenhum)
do $$
declare
  v_def text;
  v_tipos text[] := array['resumo', 'mapa', 'questoes', 'documento', 'calendario', 'flashcards', 'painel'];
  v_m text[];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.tarefas'::regclass and conname = 'tarefas_tipo_check';
  if v_def is not null then
    for v_m in select regexp_matches(v_def, '''([a-z_]+)''', 'g') loop
      if not v_m[1] = any(v_tipos) then v_tipos := array_append(v_tipos, v_m[1]); end if;
    end loop;
  end if;
  if not 'questoes_importar' = any(v_tipos) then v_tipos := array_append(v_tipos, 'questoes_importar'::text); end if;
  alter table public.tarefas drop constraint if exists tarefas_tipo_check;
  execute 'alter table public.tarefas add constraint tarefas_tipo_check check (tipo in ('
    || (select string_agg(quote_literal(t), ', ') from unnest(v_tipos) t) || '))';
end $$;
