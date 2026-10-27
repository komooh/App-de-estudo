-- =====================================================================
-- Painel de Estudos · atualização 04: semestres (o histórico fica guardado)
-- Rode DEPOIS do schema.sql, 02_perfil_foto_senha.sql e 03_drive.sql.
-- Pode rodar de novo sem problema.
--
-- Cada aluno tem vários semestres; só um é o "atual". As matérias ficam
-- presas ao semestre delas, e provas, notas, temas e materiais seguem a
-- matéria. Quando o aluno passa de semestre, nada é apagado: o semestre
-- antigo só deixa de ser o atual.
-- =====================================================================

create table if not exists public.semestres (
  id            bigint generated always as identity primary key,
  aluno_id      uuid not null default auth.uid() references public.perfis(id) on delete cascade,
  numero        smallint check (numero between 1 and 14),
  turma         text check (turma is null or char_length(turma) <= 40),
  faculdade_id  bigint references public.faculdades(id),
  inicio        date not null default current_date,
  fim           date,
  atual         boolean not null default false,
  criado_em     timestamptz not null default now()
);

-- só UM semestre atual por aluno
create unique index if not exists semestres_um_atual on public.semestres(aluno_id) where atual;
create index if not exists semestres_aluno on public.semestres(aluno_id, inicio);

-- cada matéria pertence a um semestre. Sem "on delete cascade" de propósito:
-- não dá para apagar um semestre que ainda tem matérias (protege o histórico).
-- Apagar a conta do aluno continua apagando tudo (vem pelo aluno_id).
alter table public.disciplinas add column if not exists semestre_id bigint references public.semestres(id);
create index if not exists disciplinas_semestre on public.disciplinas(semestre_id);

-- ---------- Ao marcar um semestre como atual, o anterior é encerrado ----------
create or replace function public.semestre_um_atual() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.atual then
    update public.semestres set atual = false, fim = coalesce(fim, current_date)
     where aluno_id = new.aluno_id and atual and id is distinct from new.id;
    new.fim := null;
  end if;
  return new;
end $$;

drop trigger if exists semestre_um_atual on public.semestres;
create trigger semestre_um_atual before insert or update of atual on public.semestres
  for each row execute function public.semestre_um_atual();

-- ---------- O perfil mostra sempre o semestre e a turma atuais ----------
create or replace function public.semestre_no_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.atual then
    update public.perfis
       set semestre = new.numero, turma = new.turma, faculdade_id = coalesce(new.faculdade_id, faculdade_id)
     where id = new.aluno_id
       and (semestre is distinct from new.numero or turma is distinct from new.turma
            or (new.faculdade_id is not null and faculdade_id is distinct from new.faculdade_id));
  end if;
  return null;
end $$;

drop trigger if exists semestre_no_perfil on public.semestres;
create trigger semestre_no_perfil after insert or update on public.semestres
  for each row execute function public.semestre_no_perfil();

-- ---------- Matéria nova sem semestre vai para o semestre atual ----------
-- e ninguém consegue ligar a própria matéria ao semestre de outro aluno.
create or replace function public.disciplina_semestre() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.semestre_id is null then
    select id into new.semestre_id from public.semestres where aluno_id = new.aluno_id and atual;
  elsif not exists (select 1 from public.semestres where id = new.semestre_id and aluno_id = new.aluno_id) then
    raise exception 'Semestre inválido';
  end if;
  return new;
end $$;

drop trigger if exists disciplina_semestre on public.disciplinas;
create trigger disciplina_semestre before insert or update of semestre_id, aluno_id on public.disciplinas
  for each row execute function public.disciplina_semestre();

-- ---------- Regras de acesso (RLS): igual às outras tabelas do painel ----------
alter table public.semestres enable row level security;

drop policy if exists dono_tudo on public.semestres;
create policy dono_tudo on public.semestres for all to authenticated
  using (aluno_id = auth.uid() and public.acesso_ok())
  with check (aluno_id = auth.uid() and public.acesso_ok());
drop policy if exists admin_ler on public.semestres;
create policy admin_ler on public.semestres for select to authenticated
  using (public.is_admin());

grant select, insert, update, delete on public.semestres to authenticated;
revoke all on public.semestres from anon;

-- ---------- Quem já usa o site: cria o semestre atual com o que já existe ----------
insert into public.semestres (aluno_id, numero, turma, faculdade_id, inicio, atual)
select p.id, p.semestre, p.turma, p.faculdade_id,
       coalesce((select min(d.criado_em)::date from public.disciplinas d where d.aluno_id = p.id), p.criado_em::date),
       true
  from public.perfis p
 where (p.onboarding_ok or p.semestre is not null
        or exists (select 1 from public.disciplinas d where d.aluno_id = p.id))
   and not exists (select 1 from public.semestres s where s.aluno_id = p.id);

update public.disciplinas d set semestre_id = s.id
  from public.semestres s
 where s.aluno_id = d.aluno_id and s.atual and d.semestre_id is null;

-- =====================================================================
-- Catálogo: as matérias de cada semestre, por faculdade.
-- Ao escolher o semestre na configuração, o painel já preenche as matérias
-- daqui (o aluno pode mudar, tirar ou colocar outras). O administrador
-- edita a lista na página de administração ("Matérias por semestre").
-- =====================================================================
create table if not exists public.catalogo_materias (
  id            bigint generated always as identity primary key,
  faculdade_id  bigint not null references public.faculdades(id) on delete cascade,
  semestre      smallint not null check (semestre between 1 and 10),
  nome          text not null check (char_length(btrim(nome)) between 1 and 120),
  ordem         smallint not null default 0,
  unique (faculdade_id, semestre, nome)
);

alter table public.catalogo_materias enable row level security;
drop policy if exists cat_ler on public.catalogo_materias;
create policy cat_ler on public.catalogo_materias for select to authenticated using (true);
drop policy if exists cat_admin on public.catalogo_materias;
create policy cat_admin on public.catalogo_materias for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.catalogo_materias to authenticated;
revoke all on public.catalogo_materias from anon;

-- Lista da Universidad Interamericana (9º e 10º ainda sem lista).
-- Rodar de novo não duplica nem desfaz o que o administrador mudou.
insert into public.catalogo_materias (faculdade_id, semestre, nome, ordem)
select f.id, c.semestre, c.nome, c.ordem
  from public.faculdades f
 cross join (
  select s.semestre, m.nome, (m.ordem - 1)::smallint as ordem
    from (values
      (1, array['Historia de la Medicina','Anatomía','Biología','Histología','Embriología','Lengua Castellana']),
      (2, array['Anatomía II','Histología II','Bioestadística','Psicología','Metodología','Medicina Comunitaria','Guaraní','Optativa I']),
      (3, array['Biofísica','Bioquímica','Fisiología I','Genética','Inmunología','Microbiología','Inglés']),
      (4, array['Fisiología II','Bioquímica II','Microbiología II','Epidemiología','Nutrición','Bioética','Optativa II']),
      (5, array['Anatomía Patológica','Fisiopatología','Farmacología','Semiología','Medicina de la Familia','Gestión en Salud','Optativa II']),
      (6, array['Anatomía Patológica II','Fisiopatología II','Farmacología II','Semiología II','Gestión en Salud II','Primeros Auxilios','Seminario Integrador','Optativa III']),
      (7, array['Neurología','Neumología','Dermatología','Traumatología','Oftalmología','Toxicología','Primeros Auxilios','Optativa III']),
      (8, array['Medicina Interna','Cirugía','Ginecología','Hematología','Neumología','Psiquiatría','Redacción'])
    ) as s(semestre, nomes)
    cross join lateral unnest(s.nomes) with ordinality as m(nome, ordem)
 ) c
 where f.nome = 'Universidad Interamericana'
   and not exists (select 1 from public.catalogo_materias x where x.faculdade_id = f.id and x.semestre = c.semestre)
on conflict (faculdade_id, semestre, nome) do nothing;
