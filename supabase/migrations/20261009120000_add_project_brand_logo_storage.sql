-- Store one uploaded logo per project in the public project-brand-logos bucket.
-- The object path is the project UUID followed by the original safe file extension.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'project-brand-logos',
  'project-brand-logos',
  true,
  5242880,
  array['image/png','image/jpeg','image/webp','image/gif','image/svg+xml','image/avif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Public read access is intentional: logos are displayed in the workspace header.
drop policy if exists "Project brand logos are publicly readable" on storage.objects;
create policy "Project brand logos are publicly readable"
on storage.objects for select
to public
using (bucket_id = 'project-brand-logos');

-- Only the project’s Admins and global Superadmins can upload/update/delete its logo.
drop policy if exists "Project admins can upload brand logos" on storage.objects;
create policy "Project admins can upload brand logos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-brand-logos'
  and name ~ '^[0-9a-fA-F-]{36}/logo\.(png|jpe?g|webp|gif|svg|avif)$'
  and (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'superadmin'
    )
    or exists (
      select 1 from public.project_members pm
      where pm.user_id = auth.uid()
        and pm.project_id::text = split_part(name, '/', 1)
        and pm.role in ('admin', 'superadmin')
    )
  )
);

drop policy if exists "Project admins can update brand logos" on storage.objects;
create policy "Project admins can update brand logos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'project-brand-logos'
  and name ~ '^[0-9a-fA-F-]{36}/logo\.(png|jpe?g|webp|gif|svg|avif)$'
  and (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'superadmin'
    )
    or exists (
      select 1 from public.project_members pm
      where pm.user_id = auth.uid()
        and pm.project_id::text = split_part(name, '/', 1)
        and pm.role in ('admin', 'superadmin')
    )
  )
)
with check (
  bucket_id = 'project-brand-logos'
  and name ~ '^[0-9a-fA-F-]{36}/logo\.(png|jpe?g|webp|gif|svg|avif)$'
  and (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'superadmin'
    )
    or exists (
      select 1 from public.project_members pm
      where pm.user_id = auth.uid()
        and pm.project_id::text = split_part(name, '/', 1)
        and pm.role in ('admin', 'superadmin')
    )
  )
);

drop policy if exists "Project admins can delete brand logos" on storage.objects;
create policy "Project admins can delete brand logos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-brand-logos'
  and name ~ '^[0-9a-fA-F-]{36}/logo\.(png|jpe?g|webp|gif|svg|avif)$'
  and (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'superadmin'
    )
    or exists (
      select 1 from public.project_members pm
      where pm.user_id = auth.uid()
        and pm.project_id::text = split_part(name, '/', 1)
        and pm.role in ('admin', 'superadmin')
    )
  )
);
