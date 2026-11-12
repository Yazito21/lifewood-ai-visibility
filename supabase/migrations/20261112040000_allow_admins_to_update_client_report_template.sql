-- Allow only platform Admins and Superadmins to upload or replace the centrally managed report template.
-- Public read access remains unchanged so the platform can preview and download the active template.

drop policy if exists "Platform admins can upload client report templates" on storage.objects;
create policy "Platform admins can upload client report templates"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'client-report-templates'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role::text in ('admin', 'superadmin')
  )
);

drop policy if exists "Platform admins can replace client report templates" on storage.objects;
create policy "Platform admins can replace client report templates"
on storage.objects for update to authenticated
using (
  bucket_id = 'client-report-templates'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role::text in ('admin', 'superadmin')
  )
)
with check (
  bucket_id = 'client-report-templates'
  and exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role::text in ('admin', 'superadmin')
  )
);
