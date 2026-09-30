-- Prove create_shop_invite actually runs, which is what 0009's broken operator
-- prevented. Run as the shop owner; expect one row with a token.
--
-- The insert is deleted at the end, so this leaves no invite behind. The token
-- is displayed because you need it to confirm one was issued; treat it as a
-- secret and delete this row after reading it.
begin;

select set_config('request.jwt.claims',
  json_build_object(
    'sub', (select u.id::text
              from auth.users u
              join public.profiles p on p.id = u.id
              join public.shops s on s.id = p.shop_id
             where s.owner_id = u.id
             limit 1),
    'email', (select u.email
                from auth.users u
                join public.profiles p on p.id = u.id
                join public.shops s on s.id = p.shop_id
               where s.owner_id = u.id
               limit 1)
  )::text, true);

-- Valid address: must succeed and return a token.
select 'valid address' as case, token, expires_at
  from public.create_shop_invite('probe-cashier@example.com');

-- Reissue for the same address: must succeed again, replacing the first.
select 'reissue' as case, count(*) as rows
  from public.create_shop_invite('probe-cashier@example.com');

-- The three shapes that must be refused. Each should raise, and the transaction
-- below is rolled back, so a failure here leaves nothing behind.
select public.create_shop_invite('not-an-email');
select public.create_shop_invite('missing-domain@');
select public.create_shop_invite('   ');

-- Exactly one live invite for that address survived.
select count(*) as should_be_one
  from public.shop_invites
 where lower(email) = 'probe-cashier@example.com' and accepted_at is null;

rollback;
