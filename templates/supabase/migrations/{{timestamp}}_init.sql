-- Starter schema for {{title}}. Replace `notes` with this idea's real tables, but
-- keep the pattern: every table in `public` enables row level security and
-- ships explicit policies. The anon/publishable key is public by design, so RLS
-- is the only thing standing between a client and your data.
-- (tests/database/00_rls_enabled.test.sql fails if any table forgets it.)

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index notes_user_id_idx on public.notes (user_id);

alter table public.notes enable row level security;

-- `(select auth.uid())` is evaluated once per query instead of once per row.
create policy "notes: owner has full access"
  on public.notes
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
