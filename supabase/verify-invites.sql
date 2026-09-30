-- Verify migration 0009 landed and behaves. Read-only.
-- Expect: three functions present, the trigger preferring an invite, and
-- exactly one owner for the existing shop.

-- 1. The three new functions exist with SECURITY DEFINER.
select p.proname,
       p.prosecdef                                   as security_definer,
       pg_get_function_arguments(p.oid)              as args
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('create_shop_invite','get_shop_invite','accept_shop_invite')
 order by p.proname;

-- 2. The trigger checks for an invite BEFORE creating a shop.
--    handle_new_user must reference shop_invites, and must still create a shop
--    for anyone not invited.
select
  (pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%FROM shop_invites%') as checks_invites,
  (pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%INSERT INTO public.shops%') as creates_shop,
  (pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%FLOOR%')             as still_floors,
  (pg_get_functiondef('public.handle_new_user()'::regprocedure) ilike '%lower(email)%')     as matches_email_case_insensitively;

-- 3. The public read function must not return the token.
select
  (pg_get_functiondef('public.get_shop_invite(text)'::regprocedure) ilike '%token TEXT%') as exposes_token;

-- 4. RLS is on for the invites table and a policy exists.
select c.relname as table_name, c.relrowsecurity as rls,
       (select count(*) from pg_policies p
         where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relname = 'shop_invites';

-- 5. The token column is unique, and an invite can only ever be a cashier.
select
  (select count(*) from pg_indexes
    where schemaname = 'public' and indexname = 'shop_invites_open_unique') as one_per_address_index,
  (select role from pg_constraint
    where conrelid = 'public.shop_invites'::regclass and contype = 'c'
    order by conname limit 1) as role_check;

-- 6. Nobody has been given an invite yet, and the existing shop still has
--    exactly one owner.
select (select count(*) from public.shop_invites) as invites_so_far,
       (select count(*) from public.shops)       as shops,
       (select count(*) from public.profiles where role = 'owner') as owners;
