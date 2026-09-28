-- Confirm migration 0008 is live: the deployed rpc_execute_sale must reject a
-- debt sale that passes the customer's credit limit. Expect `true` in the
-- `limit_enforced` column, and the word 'Credit limit' in the definition.
select
  (pg_get_functiondef('public.rpc_execute_sale(uuid,uuid,text,numeric,text,jsonb)'::regprocedure)
     ilike '%credit_limit%')                       as limit_enforced,
  (pg_get_functiondef('public.rpc_execute_sale(uuid,uuid,text,numeric,text,jsonb)'::regprocedure)
     ilike '%Credit limit, enforced%')             as comment_present,
  (pg_get_functiondef('public.rpc_execute_sale(uuid,uuid,text,numeric,text,jsonb)'::regprocedure)
     ilike '%FOR UPDATE%')                         as customer_locked;

-- Who is currently over their limit. These customers can no longer buy on
-- credit until a payment is recorded or the limit is raised.
select name, balance, credit_limit,
       round(balance - credit_limit, 2) AS over_by
  from customers
 where credit_limit > 0 and balance > credit_limit
 order by over_by desc;
