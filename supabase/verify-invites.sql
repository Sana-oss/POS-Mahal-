-- Verify migration 0009 landed and behaves. Read-only.
-- Expect: three SECURITY DEFINER functions, the trigger preferring an invite,
-- the public read returning no token, RLS on with one policy, and a role CHECK
-- that only allows 'cashier'.
--
-- Two earlier versions of this file were wrong. One selected a `role` column
-- that pg_constraint does not have. The other tested for the token with
-- `ilike '%token TEXT%'` against the whole function body, which also matches the
-- parameter `p_token TEXT` in the signature - so it reported a leak that was not
-- there, and would have missed one that was. Both are fixed below.

-- 1. The three new functions exist, and all are SECURITY DEFINER.
--    SECURITY DEFINER matters: it is what lets them read the invite table and
--    generate a token without granting the caller direct access.
select p.proname,
       p.prosecdef                              as security_definer,
       pg_get_function_arguments(p.oid)         as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('create_shop_invite','get_shop_invite','accept_shop_invite')
 order by p.proname;

-- 2. The trigger checks for a pending invite BEFORE creating a shop, and still
--    creates one for anyone not invited. `still_floors` must be false: 0003 left
--    a FLOOR() in this function and a later migration removed it.
select
  (pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%FROM shop_invites%')  as checks_invites,
  (pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%INSERT INTO public.shops%') as creates_shop,
  (pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%FLOOR%')              as still_floors,
  (pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%lower(email)%')      as matches_email_case_insensitively;

-- 3. What get_shop_invite actually RETURNS. Checked against the return type, not
--    the body, so the parameter name cannot be mistaken for a returned column.
--    exposes_token must be false: the joiner needs the shop name and role, and
--    anyone holding a link can call this before signing in.
select pg_get_function_result(p.oid)                                        as returns_clause,
       (pg_get_function_result(p.oid) ilike '%token%')                     as exposes_token
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'get_shop_invite';

-- 4. RLS is on for the invites table, with at least one policy. RLS on with no
--    policy would make the table invisible to everyone - a silent break.
select c.relname as table_name,
       c.relrowsecurity as rls,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'shop_invites';

-- 5. The role CHECK must confine an invite to 'cashier', so a shop keeps exactly
--    one owner. pg_constraint has no `role` column; the text is in the definition.
select conname,
       pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
 where c.conrelid = 'public.shop_invites'::regclass
   and c.contype = 'c'
 order by conname;

-- 6. One live invite per address per shop, enforced by a partial unique index.
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'shop_invites'
 order by indexname;

-- 7. State: invites issued so far, and that the existing shop still has one owner.
select (select count(*) from public.shop_invites)               as invites_so_far,
       (select count(*) from public.shops)                     as shops,
       (select count(*) from public.profiles where role = 'owner') as owners,
       (select count(*) from public.profiles)                  as profiles;
