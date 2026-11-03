-- 16_resumo_completo.sql — resumos prontos (comprados ou de apoio) e o resumo "Tudo junto".
-- Rode depois do 14 (e do 15, se existir). Pode rodar mais de uma vez.
--
-- 1) Cada arquivo de estudo tem um tipo: 'aula' (material do professor, o padrão; os arquivos do Drive também)
--    ou 'resumo_pronto' (resumo comprado ou de apoio). O aluno troca na lista de materiais.
-- 2) O resumo pode ser feito "Tudo junto" (professor + resumos prontos + livros): modo 'completo'.

alter table public.materiais add column if not exists tipo text not null default 'aula';
alter table public.materiais drop constraint if exists materiais_tipo_check;
alter table public.materiais add constraint materiais_tipo_check check (tipo in ('aula', 'resumo_pronto'));

alter table public.resumos drop constraint if exists resumos_modo_check;
alter table public.resumos add constraint resumos_modo_check check (modo is null or modo in ('professor', 'livros', 'completo'));

-- 3) Documentos lidos: o manual da prova (Enviar calendários e manuais) também fica registrado com o tipo dele.
alter table public.documentos drop constraint if exists documentos_tipo_check;
alter table public.documentos add constraint documentos_tipo_check check (tipo in
  ('calendario_geral', 'cronograma_provas', 'horario_aulas', 'manual_prova', 'programa_materia', 'regulamento', 'aviso', 'outro'));

-- O aluno muda o tipo de um arquivo dele (só o tipo: o resto do arquivo continua protegido).
create or replace function public.mudar_tipo_material(p_id bigint, p_tipo text)
returns text
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.acesso_ok() then raise exception 'Acesso não liberado.'; end if;
  if p_tipo is null or p_tipo not in ('aula', 'resumo_pronto') then raise exception 'Tipo inválido.'; end if;
  update public.materiais set tipo = p_tipo where id = p_id and aluno_id = auth.uid();
  if not found then raise exception 'Arquivo não encontrado.'; end if;
  return p_tipo;
end $$;
revoke all on function public.mudar_tipo_material(bigint, text) from public, anon;
grant execute on function public.mudar_tipo_material(bigint, text) to authenticated;
