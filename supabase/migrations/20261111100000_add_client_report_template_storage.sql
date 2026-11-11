-- Store the canonical client-facing monthly report PowerPoint template.
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

drop policy if exists "Client report templates are publicly readable" on storage.objects;
create policy "Client report templates are publicly readable"
on storage.objects for select
using (bucket_id = 'client-report-templates');

drop policy if exists "Project admins can upload client report templates" on storage.objects;
create policy "Project admins can upload client report templates"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-report-templates'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'superadmin')
  )
);

drop policy if exists "Project admins can update client report templates" on storage.objects;
create policy "Project admins can update client report templates"
on storage.objects for update to authenticated
using (
  bucket_id = 'client-report-templates'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'superadmin')
  )
)
with check (
  bucket_id = 'client-report-templates'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'superadmin')
  )
);

drop policy if exists "Project admins can delete client report templates" on storage.objects;
create policy "Project admins can delete client report templates"
on storage.objects for delete to authenticated
using (
  bucket_id = 'client-report-templates'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role::text in ('admin', 'superadmin')
  )
);
