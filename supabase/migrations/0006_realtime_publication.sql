-- 0006: publish business tables to Supabase Realtime
-- ---------------------------------------------------------------
-- A second register (another cashier, another device, another tab) previously
-- saw another cashier's writes only after a manual refresh or after its own next
-- write, which re-pulled the affected slices. CLOUD_MODE.md recorded that as a
-- known limitation.
--
-- Postgres change feeds only deliver rows for tables in the
-- `supabase_realtime` publication. Every table added here already has Row Level
-- Security enabled with a `shop_id = get_user_shop_id()` policy, so Realtime
-- delivers a change to a client only when that client's own token resolves to
-- the owning shop. No shop can observe another's traffic.
--
-- The client (src/services/realtime.ts) re-pulls the affected slices rather than
-- patching rows into the cache, because a single sale touches products, sales,
-- sale_items, stock_movements and customers at once, and only the server knows
-- the resulting weighted average cost and customer balance.

DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'products', 'sales', 'sale_items', 'purchases', 'purchase_items',
        'customers', 'customer_payments', 'stock_movements', 'expenses'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
        END IF;
    END LOOP;
END $$;

-- Record the state so this migration is idempotent if re-run.
COMMENT ON PUBLICATION supabase_realtime IS
    'Business tables published for multi-register live sync (migration 0006). RLS scopes delivery per shop.';

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('0006', 'realtime_publication', '{}'::text[])
ON CONFLICT (version) DO NOTHING;
