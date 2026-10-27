-- =====================================================================
-- Painel de Estudos · atualização 02: nome de usuário e foto de perfil
-- Rode DEPOIS do schema.sql. Pode rodar de novo sem problema.
-- =====================================================================

alter table public.perfis add column if not exists usuario text;
alter table public.perfis add column if not exists avatar_url text;

-- nome de usuário: até 30 caracteres, sem espaços nas pontas
alter table public.perfis drop constraint if exists usuario_tamanho;
alter table public.perfis add constraint usuario_tamanho
  check (usuario is null or (char_length(btrim(usuario)) between 2 and 30));

-- ---------- Fotos de perfil (Supabase Storage) ----------
-- Pasta pública "avatares": a foto aparece sem login (é só a foto),
-- mas cada aluno só pode enviar, trocar ou apagar a própria (pasta = id dele).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists avatar_enviar on storage.objects;
create policy avatar_enviar on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatar_trocar on storage.objects;
create policy avatar_trocar on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatar_apagar on storage.objects;
create policy avatar_apagar on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists avatar_ler_proprio on storage.objects;
create policy avatar_ler_proprio on storage.objects for select to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
