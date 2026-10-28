-- =====================================================================
-- Painel de Estudos · atualização 10: memória do resumo
-- Rode DEPOIS do 09_termos.sql. Pode rodar de novo sem problema.
--
-- memoria_resumo: o jeito que o aluno quer os resumos, em texto livre (até 1500 letras).
-- Vazio (null) = formato padrão (resumo ativo). A função "ia" usa como preferência de ESTILO:
-- muda formato, ênfase, ordem e idioma, mas não as regras (só o material, fontes marcadas, sem inventar).
-- Mesmas regras de acesso do resto de "preferencias" (06_estudo.sql): cada aluno só lê e muda a dele.
-- =====================================================================
alter table public.preferencias add column if not exists memoria_resumo text;
alter table public.preferencias drop constraint if exists preferencias_memoria_resumo_tamanho;
alter table public.preferencias add constraint preferencias_memoria_resumo_tamanho
  check (memoria_resumo is null or char_length(memoria_resumo) <= 1500);
