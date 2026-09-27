-- =============================================================================
-- Mahall POS - single-query audit
-- =============================================================================
-- The whole schema and data audit as ONE statement, returning one row per
-- check with a PASS/FAIL verdict. This exists so verifying the database costs a
-- single paste instead of fourteen result sets.
--
-- Run it in the Supabase SQL Editor (Dashboard > SQL Editor > New query), then
-- paste the one table it returns.
--
-- READ ONLY. It is a single SELECT; nothing is written or altered.
--
-- How to read it:
--   status = PASS  -> the check found nothing wrong
--   status = FAIL  -> the offenders column says how many rows, sample names them
--   status = INFO  -> not a verdict, just context
--
-- A PASS is only as meaningful as the data behind it, so the last row reports
-- how many sales exist. Zero sales makes the data checks pass trivially.
-- =============================================================================

WITH
-- Each CTE is a set of offending rows, so both the count and the sample come
-- from the same definition and cannot disagree.
bad_items_count AS (
  SELECT s.invoice_no AS k
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
   GROUP BY s.id, s.invoice_no, s.items_count
  HAVING s.items_count <> COALESCE(SUM(si.quantity), 0)
),
bad_money AS (
  SELECT s.invoice_no AS k
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
   GROUP BY s.id, s.invoice_no, s.total_amount, s.total_cost, s.profit
  HAVING s.total_amount <> COALESCE(SUM(si.total_price), 0)
      OR s.total_cost   <> COALESCE(SUM(si.total_cost), 0)
      OR s.profit       <> (s.total_amount - s.total_cost)
),
bad_no_items AS (
  SELECT s.invoice_no AS k
    FROM sales s
    LEFT JOIN sale_items si ON si.sale_id = s.id
   WHERE si.id IS NULL
),
bad_orphan_items AS (
  SELECT si.id::text AS k
    FROM sale_items si
    LEFT JOIN sales s ON s.id = si.sale_id
   WHERE s.id IS NULL
),
bad_movements AS (
  SELECT s.invoice_no AS k
    FROM sales s
    LEFT JOIN sale_items si      ON si.sale_id = s.id
    LEFT JOIN stock_movements sm ON sm.reference_id = s.invoice_no AND sm.type = 'sale'
   GROUP BY s.id, s.invoice_no
  HAVING COALESCE(SUM(sm.quantity), 0) <> -COALESCE(SUM(si.quantity), 0)
),
bad_orphan_movements AS (
  SELECT sm.id::text AS k
    FROM stock_movements sm
   WHERE sm.type IN ('sale', 'purchase')
     AND NOT EXISTS (SELECT 1 FROM sales s     WHERE s.invoice_no = sm.reference_id)
     AND NOT EXISTS (SELECT 1 FROM purchases p WHERE p.invoice_no = sm.reference_id)
),
bad_negative_stock AS (
  SELECT name AS k FROM products WHERE stock_quantity < 0
),
bad_stock_vs_ledger AS (
  SELECT p.name AS k
    FROM products p
    LEFT JOIN stock_movements sm ON sm.product_id = p.id
   GROUP BY p.id, p.name, p.stock_quantity
  HAVING p.stock_quantity <> COALESCE(SUM(sm.quantity), 0)
),
bad_debt_no_customer AS (
  SELECT s.invoice_no AS k
    FROM sales s
   WHERE s.payment_method = 'debt' AND s.customer_id IS NULL
),
bad_orphan_customer AS (
  SELECT s.invoice_no AS k
    FROM sales s
   WHERE s.customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = s.customer_id)
),
bad_negative_balance AS (
  SELECT name AS k FROM customers WHERE balance < 0
),
bad_item_type AS (
  -- items_count must be numeric(10,3) on both tables. If it is still integer,
  -- weighed goods are being truncated in the stored summary.
  SELECT table_name AS k
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('sales', 'purchases')
     AND column_name = 'items_count'
     AND (data_type <> 'numeric' OR numeric_precision <> 10 OR numeric_scale <> 3)
),
bad_not_published AS (
  -- Every table the client subscribes to must be in the realtime publication.
  SELECT t AS k
    FROM unnest(ARRAY['products','sales','sale_items','purchases','purchase_items',
                      'customers','customer_payments','stock_movements','expenses']) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_publication_tables pt
      WHERE pt.pubname = 'supabase_realtime' AND pt.tablename = t
   )
),
bad_no_rls AS (
  SELECT tablename AS k
    FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename IN ('products','sales','sale_items','purchases','purchase_items',
                       'customers','customer_payments','stock_movements','expenses')
     AND NOT rowsecurity
),
bad_no_policy AS (
  SELECT t AS k
    FROM unnest(ARRAY['products','sales','sale_items','purchases','purchase_items',
                      'customers','customer_payments','stock_movements','expenses']) AS t
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t
   )
),
bad_purchase_count AS (
  SELECT p.invoice_no AS k
    FROM purchases p
    LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
   GROUP BY p.id, p.invoice_no, p.items_count
  HAVING p.items_count <> COALESCE(SUM(pi.quantity), 0)
),
bad_purchase_money AS (
  SELECT p.invoice_no AS k
    FROM purchases p
    LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
   GROUP BY p.id, p.invoice_no, p.total_amount
  HAVING p.total_amount <> COALESCE(SUM(pi.total_cost), 0)
),
migrations AS (
  SELECT COUNT(*) AS n FROM supabase_migrations.schema_migrations
)

SELECT * FROM (
  SELECT 1 AS ord, 'schema: items_count is numeric(10,3)' AS check_name,
         CASE WHEN (SELECT COUNT(*) FROM bad_item_type) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
         (SELECT COUNT(*) FROM bad_item_type) AS offenders,
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_item_type LIMIT 3) x) AS sample

  UNION ALL SELECT 2, 'schema: all 7 migrations applied',
         CASE WHEN (SELECT n FROM migrations) >= 7 THEN 'PASS' ELSE 'FAIL' END,
         GREATEST(7 - (SELECT n FROM migrations), 0),
         'applied: ' || (SELECT n FROM migrations)::text || ' of 7'

  UNION ALL SELECT 3, 'schema: 9 watched tables in realtime publication',
         CASE WHEN (SELECT COUNT(*) FROM bad_not_published) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_not_published),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_not_published LIMIT 9) x)

  UNION ALL SELECT 4, 'security: RLS enabled on all 9 watched tables',
         CASE WHEN (SELECT COUNT(*) FROM bad_no_rls) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_no_rls),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_no_rls LIMIT 9) x)

  UNION ALL SELECT 5, 'security: every watched table has a policy',
         CASE WHEN (SELECT COUNT(*) FROM bad_no_policy) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_no_policy),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_no_policy LIMIT 9) x)

  UNION ALL SELECT 10, 'data: sale items_count matches its lines',
         CASE WHEN (SELECT COUNT(*) FROM bad_items_count) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_items_count),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_items_count LIMIT 3) x)

  UNION ALL SELECT 11, 'data: sale amount/cost/profit match its lines',
         CASE WHEN (SELECT COUNT(*) FROM bad_money) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_money),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_money LIMIT 3) x)

  UNION ALL SELECT 12, 'data: no sale without line items',
         CASE WHEN (SELECT COUNT(*) FROM bad_no_items) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_no_items),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_no_items LIMIT 3) x)

  UNION ALL SELECT 13, 'data: no orphaned sale_items',
         CASE WHEN (SELECT COUNT(*) FROM bad_orphan_items) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_orphan_items),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_orphan_items LIMIT 3) x)

  UNION ALL SELECT 14, 'data: sale movements sum to quantity sold',
         CASE WHEN (SELECT COUNT(*) FROM bad_movements) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_movements),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_movements LIMIT 3) x)

  UNION ALL SELECT 15, 'data: no orphaned stock movements',
         CASE WHEN (SELECT COUNT(*) FROM bad_orphan_movements) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_orphan_movements),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_orphan_movements LIMIT 3) x)

  UNION ALL SELECT 16, 'data: no negative stock',
         CASE WHEN (SELECT COUNT(*) FROM bad_negative_stock) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_negative_stock),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_negative_stock LIMIT 3) x)

  UNION ALL SELECT 17, 'data: product stock equals its ledger',
         CASE WHEN (SELECT COUNT(*) FROM bad_stock_vs_ledger) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_stock_vs_ledger),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_stock_vs_ledger LIMIT 3) x)

  UNION ALL SELECT 18, 'data: purchase items_count matches its lines',
         CASE WHEN (SELECT COUNT(*) FROM bad_purchase_count) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_purchase_count),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_purchase_count LIMIT 3) x)

  UNION ALL SELECT 19, 'data: purchase total equals its line costs',
         CASE WHEN (SELECT COUNT(*) FROM bad_purchase_money) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_purchase_money),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_purchase_money LIMIT 3) x)

  UNION ALL SELECT 20, 'debt: no debt sale without a customer',
         CASE WHEN (SELECT COUNT(*) FROM bad_debt_no_customer) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_debt_no_customer),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_debt_no_customer LIMIT 3) x)

  UNION ALL SELECT 21, 'debt: no sale points at a missing customer',
         CASE WHEN (SELECT COUNT(*) FROM bad_orphan_customer) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_orphan_customer),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_orphan_customer LIMIT 3) x)

  UNION ALL SELECT 22, 'debt: no negative customer balance',
         CASE WHEN (SELECT COUNT(*) FROM bad_negative_balance) = 0 THEN 'PASS' ELSE 'FAIL' END,
         (SELECT COUNT(*) FROM bad_negative_balance),
         (SELECT string_agg(k, ', ') FROM (SELECT k FROM bad_negative_balance LIMIT 3) x)

  UNION ALL SELECT 90, 'context: how much data is behind these verdicts',
         'INFO', (SELECT COUNT(*) FROM sales),
         'sales=' || (SELECT COUNT(*) FROM sales)
           || ' sale_items=' || (SELECT COUNT(*) FROM sale_items)
           || ' purchases=' || (SELECT COUNT(*) FROM purchases)
           || ' products=' || (SELECT COUNT(*) FROM products)
           || ' movements=' || (SELECT COUNT(*) FROM stock_movements)
           || ' customers=' || (SELECT COUNT(*) FROM customers)

  UNION ALL SELECT 91, 'context: fractional line quantities sold',
         'INFO', (SELECT COUNT(*) FROM sale_items WHERE quantity <> FLOOR(quantity)),
         'non-zero means the shop has sold weighed goods and the numeric check above is proven, not assumed'
) AS report
ORDER BY ord;
