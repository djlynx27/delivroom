-- ============================================================
-- Migration : driver-screenshots bucket + RLS policies
-- Bucket privé. Path convention : {auth.uid()}/{timestamp}-{filename}
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'driver-screenshots',
  'driver-screenshots',
  false,
  10485760, -- 10 MB
  array['image/jpeg','image/png','image/webp','image/heic','image/heif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Drop policies si réexécution
drop policy if exists "driver_screenshots_insert_own" on storage.objects;
drop policy if exists "driver_screenshots_select_own" on storage.objects;
drop policy if exists "driver_screenshots_update_own" on storage.objects;
drop policy if exists "driver_screenshots_delete_own" on storage.objects;

-- INSERT : un user authentifié uploade uniquement dans son propre dossier
create policy "driver_screenshots_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'driver-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- SELECT : un user voit seulement ses propres fichiers
create policy "driver_screenshots_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'driver-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE : un user peut remplacer ses propres fichiers
create policy "driver_screenshots_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'driver-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'driver-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- DELETE : un user peut supprimer ses propres fichiers
create policy "driver_screenshots_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'driver-screenshots'
  and (storage.foldername(name))[1] = auth.uid()::text
);
