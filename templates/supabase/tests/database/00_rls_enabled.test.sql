-- Guard rail inherited by every idea: no table in `public` may exist without
-- row level security. The publishable key ships inside every client, so a
-- table without RLS is readable and writable by anyone on the internet.
begin;
create extension if not exists pgtap with schema extensions;

select plan(1);

select is_empty(
  $$ select tablename from pg_tables where schemaname = 'public' and not rowsecurity $$,
  'every table in the public schema has row level security enabled'
);

select * from finish();
rollback;
