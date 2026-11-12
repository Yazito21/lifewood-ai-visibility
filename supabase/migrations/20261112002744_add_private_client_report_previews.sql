insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-report-previews',
  'client-report-previews',
  false,
  10485760,
  array['application/vnd.openxmlformats-officedocument.presentationml.presentation']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Users can read their own report previews" on storage.objects;
create policy "Users can read their own report previews"
on storage.objects for select
to authenticated
using (
  bucket_id = 'client-report-previews'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can upload their own report previews" on storage.objects;
create policy "Users can upload their own report previews"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'client-report-previews'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "Users can delete their own report previews" on storage.objects;
create policy "Users can delete their own report previews"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'client-report-previews'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);