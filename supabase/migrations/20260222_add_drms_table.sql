-- Persisted DRM catalog for Admin UI
-- Note: service role bypasses RLS; policies below allow authenticated reads and admin writes.

create table if not exists public.drms (
  name text primary key,
  created_at timestamptz not null default now()
);

alter table public.drms enable row level security;

-- Everyone logged in can read DRM list
create policy "drms_select_authenticated"
  on public.drms
  for select
  to authenticated
  using (true);

-- Only admins can modify
create policy "drms_insert_admin"
  on public.drms
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

create policy "drms_delete_admin"
  on public.drms
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );
