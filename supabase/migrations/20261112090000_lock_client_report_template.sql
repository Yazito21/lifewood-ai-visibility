-- The monthly report template is maintained centrally and is read-only to platform users.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'client-report-templates',
  'client-report-templates',
  true,
  10485760,
  array['application/vnd.openxmlformats-officedocument.presentationml.presentation']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Project admins can upload client report templates" on storage.objects;
drop policy if exists "Project admins can update client report templates" on storage.objects;
drop policy if exists "Project admins can delete client report templates" on storage.objects;

drop policy if exists "Client report templates are publicly readable" on storage.objects;
create policy "Client report templates are publicly readable"
on storage.objects for select
using (bucket_id = 'client-report-templates');
