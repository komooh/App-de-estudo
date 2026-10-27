-- =====================================================================
-- Painel de Estudos · atualização 05: livros do aluno
-- Rode DEPOIS do 04_semestres.sql. Pode rodar de novo sem problema.
--
-- O arquivo do livro (PDF, EPUB, Word) NÃO é guardado: o próprio navegador
-- do aluno tira o texto, corta em trechos de ~2.000 letras e grava só o
-- texto aqui, com o número da página. Cada livro é só do aluno que enviou.
--
-- Espaço: um livro de 1.000 páginas ocupa uns 5 a 8 MB no banco (texto +
-- índice de busca). O plano grátis do Supabase tem 500 MB no total, por
-- isso há um limite por aluno (veja limites_livros() logo abaixo).
-- =====================================================================

-- ---------- Limites por aluno (mude os números aqui se precisar) ----------
-- livros: quantos livros cada aluno pode ter
-- trechos: soma dos trechos de todos os livros do aluno (8.000 trechos ≈ 3.500 páginas)
create or replace function public.limites_livros(out livros int, out trechos int)
language sql immutable as $$ select 5, 8000 $$;

-- ---------- Busca sem acento ("coracao" acha "coração") ----------
create extension if not exists unaccent with schema extensions;

do $$
declare esquema text;
begin
  if not exists (select 1 from pg_ts_config where cfgname = 'pt_sem_acento' and cfgnamespace = 'public'::regnamespace) then
    select n.nspname into esquema from pg_ts_dict d join pg_namespace n on n.oid = d.dictnamespace where d.dictname = 'unaccent' limit 1;
    execute 'create text search configuration public.pt_sem_acento (copy = pg_catalog.portuguese)';
    execute format('alter text search configuration public.pt_sem_acento
      alter mapping for hword, hword_part, word with %I.unaccent, portuguese_stem', esquema);
  end if;
end $$;

-- ---------- Livros ----------
create table if not exists public.livros (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  titulo        text not null check (char_length(titulo) between 1 and 300),
  autor         text check (autor is null or char_length(autor) <= 300),
  edicao        text check (edicao is null or char_length(edicao) <= 60),
  formato       text not null default 'pdf' check (formato in ('pdf','epub','docx','txt')),
  paginas       integer check (paginas is null or paginas between 0 and 20000),
  arquivo_nome  text check (arquivo_nome is null or char_length(arquivo_nome) <= 300),
  status        text not null default 'processando' check (status in ('processando','ok','erro')),
  erro          text,
  total_trechos integer not null default 0,
  criado_em     timestamptz not null default now()
);

-- ---------- Trechos do texto (o que a busca e os resumos vão usar) ----------
create table if not exists public.livro_trechos (
  id          bigint generated always as identity primary key,
  livro_id    bigint not null references public.livros(id) on delete cascade,
  aluno_id    uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  pagina_ini  integer,
  pagina_fim  integer,
  capitulo    text check (capitulo is null or char_length(capitulo) <= 300),
  texto       text not null check (char_length(texto) between 1 and 6000),
  busca       tsvector generated always as (to_tsvector('public.pt_sem_acento'::regconfig, texto)) stored
);

create index if not exists livros_aluno on public.livros(aluno_id);
create index if not exists livro_trechos_livro on public.livro_trechos(livro_id, pagina_ini);
create index if not exists livro_trechos_aluno on public.livro_trechos(aluno_id);
create index if not exists livro_trechos_busca on public.livro_trechos using gin (busca);

-- ---------- Limites ----------
create or replace function public.livros_limite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.livros where aluno_id = new.aluno_id) >= (select livros from public.limites_livros()) then
    raise exception 'Limite de % livros por aluno. Apague um livro para enviar outro.', (select livros from public.limites_livros());
  end if;
  return new;
end $$;

drop trigger if exists livros_limite on public.livros;
create trigger livros_limite before insert on public.livros
  for each row execute function public.livros_limite();

create or replace function public.trechos_limite() returns trigger
language plpgsql security definer set search_path = public as $$
declare lim int := (select trechos from public.limites_livros());
begin
  if exists (
    select 1 from (select distinct aluno_id from novos) n
     where (select count(*) from public.livro_trechos t where t.aluno_id = n.aluno_id) > lim
  ) then
    raise exception 'Seus livros passaram do limite de espaço (% trechos). Apague um livro para enviar outro.', lim;
  end if;
  return null;
end $$;

drop trigger if exists trechos_limite on public.livro_trechos;
create trigger trechos_limite after insert on public.livro_trechos
  referencing new table as novos for each statement execute function public.trechos_limite();

-- ---------- Regras de acesso (RLS): só o dono, com acesso em dia ----------
alter table public.livros        enable row level security;
alter table public.livro_trechos enable row level security;

drop policy if exists dono_tudo on public.livros;
create policy dono_tudo on public.livros for all to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok())
  with check (aluno_id = auth.uid() and public.acesso_ok());

-- trechos: ler, gravar e apagar os próprios; gravar só em livro próprio; não se altera trecho
drop policy if exists dono_ler on public.livro_trechos;
create policy dono_ler on public.livro_trechos for select to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists dono_gravar on public.livro_trechos;
create policy dono_gravar on public.livro_trechos for insert to authenticated
  with check (aluno_id = auth.uid() and public.acesso_ok()
    and exists (select 1 from public.livros l where l.id = livro_id and l.aluno_id = auth.uid()));
drop policy if exists dono_apagar on public.livro_trechos;
create policy dono_apagar on public.livro_trechos for delete to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok());

-- o admin NÃO lê os livros dos alunos (são particulares); vê só a lista, para suporte
drop policy if exists admin_ler on public.livros;
create policy admin_ler on public.livros for select to authenticated using (public.is_admin());

grant select, insert, update, delete on public.livros to authenticated;
grant select, insert, delete on public.livro_trechos to authenticated;
revoke update on public.livro_trechos from authenticated;
revoke all on public.livros, public.livro_trechos from anon;

-- ---------- Busca nos livros do aluno ----------
-- Usada pela janela "Procurar nos meus livros" e, depois, pelos resumos
-- (o que o livro diz x o que está nos slides do professor).
-- Roda com as permissões de quem chama: só acha os livros do próprio aluno.
-- O trecho vem com as palavras achadas entre ⟦ e ⟧.
drop function if exists public.buscar_nos_livros(text, integer);
create or replace function public.buscar_nos_livros(consulta text, limite integer default 8)
returns table (livro_id bigint, titulo text, autor text, formato text, trecho_id bigint,
               pagina_ini integer, pagina_fim integer, capitulo text, snippet text, rank real)
language sql stable security invoker set search_path = public as $$
  with q as (
    select websearch_to_tsquery('public.pt_sem_acento'::regconfig, left(coalesce(consulta, ''), 300)) as tq
  ), achados as (
    select t.id, t.livro_id, t.pagina_ini, t.pagina_fim, t.capitulo, t.texto,
           ts_rank_cd(t.busca, q.tq) as rank
      from public.livro_trechos t, q
     where t.aluno_id = auth.uid() and t.busca @@ q.tq
     order by rank desc, t.id
     limit least(greatest(coalesce(limite, 8), 1), 30)
  )
  select a.livro_id, l.titulo, l.autor, l.formato, a.id, a.pagina_ini, a.pagina_fim, a.capitulo,
         ts_headline('public.pt_sem_acento'::regconfig, a.texto, q.tq,
           'StartSel=⟦, StopSel=⟧, MaxWords=45, MinWords=20, MaxFragments=2, FragmentDelimiter=" … "'),
         a.rank
    from achados a join public.livros l on l.id = a.livro_id, q
   order by a.rank desc, a.id
$$;

revoke all on function public.buscar_nos_livros(text, integer) from public, anon;
grant execute on function public.buscar_nos_livros(text, integer) to authenticated;
