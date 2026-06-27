-- Feedback attachment storage (images, video, audio, documents)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feedback-attachments',
  'feedback-attachments',
  true,
  104857600,
  array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'image/bmp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-matroska',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    'application/pdf'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists feedback_attachments_public_read on storage.objects;
create policy feedback_attachments_public_read on storage.objects
  for select using (bucket_id = 'feedback-attachments');

drop policy if exists feedback_attachments_authenticated_insert on storage.objects;
create policy feedback_attachments_authenticated_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists feedback_attachments_authenticated_update on storage.objects;
create policy feedback_attachments_authenticated_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists feedback_attachments_authenticated_delete on storage.objects;
create policy feedback_attachments_authenticated_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
