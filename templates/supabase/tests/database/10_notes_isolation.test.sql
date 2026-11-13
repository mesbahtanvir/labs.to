-- Example of testing RLS as real users. Copy this shape for each new table:
-- one user writes, a second user and an anonymous caller must not see or spoof it.
begin;
create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.test');

-- Act as user A.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';

insert into public.notes (body) values ('written by a');
select is((select count(*)::int from public.notes), 1, 'an owner sees their own note');

-- Act as user B.
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is((select count(*)::int from public.notes), 0, 'another user sees none of it');
select throws_ok(
  $$ insert into public.notes (user_id, body) values ('00000000-0000-0000-0000-00000000000a', 'spoofed') $$,
  '42501',
  null,
  'a user cannot write rows as someone else'
);

-- Act as an anonymous caller.
set local role anon;
select is((select count(*)::int from public.notes), 0, 'an anonymous caller sees nothing');

select * from finish();
rollback;
