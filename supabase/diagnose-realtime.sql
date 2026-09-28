-- Diagnose why a subscribed register receives no change events.
-- A register can subscribe successfully and still be sent nothing, because the
-- publication lists the table but is not configured to publish the operations,
-- or the table has no replica identity and so cannot be decoded for the feed.
-- Both are invisible to the table-membership check in audit-one-query.sql.
--
-- Run in the Supabase SQL Editor. Expect pubinsert/pubupdate/pubdelete all true.

select
  p.pubname,
  p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate,
  -- Any false here means the feed is silent for that operation.
  (p.pubinsert and p.pubupdate and p.pubdelete) as publishes_all_ops
  from pg_publication p
 where p.pubname = 'supabase_realtime';

-- Replica identity per watched table. For UPDATE and DELETE the realtime server
-- needs a key to identify the changed row; 'd' (default) uses the primary key,
-- which is fine. Anything NULL or 'n' (nothing) on a table with a primary key
-- would silently block those events.
select
  c.relname as table_name,
  c.relreplident as replica_identity,
  i.indisprimary,
  (select count(*) from pg_index x where x.indrelid = c.oid) as index_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_index i on i.indrelid = c.oid and i.indisprimary
 where n.nspname = 'public'
   and c.relname in ('products','sales','sale_items','purchases','purchase_items',
                     'customers','customer_payments','stock_movements','expenses')
 order by c.relname;

-- The publication's table list, with the operations it will actually send.
select pt.tablename, p.pubinsert, p.pubupdate, p.pubdelete
  from pg_publication_tables pt
  join pg_publication p on p.pubname = pt.pubname
 where pt.pubname = 'supabase_realtime'
 order by pt.tablename;

-- Live proof that the feed is firing: publish_enabled, and whether anything has
-- actually been written recently. An empty result means there is nothing to see
-- yet, which is a different problem from the feed being broken.
select
  current_setting('wal_level')       as wal_level,
  current_setting('max_replication_slots') as replication_slots,
  (select count(*) from sales where created_at > now() - interval '1 day') as sales_last_24h,
  (select count(*) from stock_movements where created_at > now() - interval '1 day') as movements_last_24h;
