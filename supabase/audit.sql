-- =============================================================================
-- Mahall POS - schema & data audit
-- =============================================================================
-- Run this whole file in the Supabase SQL Editor (Dashboard > SQL Editor > New
-- query) and paste the result back. It needs no password, no service_role key
-- and no Docker, because the SQL Editor runs as the `postgres` role and so
-- bypasses RLS - which is exactly why these things cannot be checked from the
-- app.
--
-- READ ONLY. Every statement is a SELECT; nothing is written, nothing is
-- altered, and running it twice is harmless.
--
-- How to read the result: each section prints a single row. A section that
-- prints ZERO rows is GOOD - it means the thing it hunts for is absent. A
-- section that prints rows is a finding worth investigating.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Migration history
--    Every version from 0001 to 0007 must be present. A gap means a migration
--    was skipped. Only `version` is selected: the `name` column was dropped in
--    newer Supabase CLI versions, so selecting it would error.
--    Expect: 7 rows, 0001 through 0007, no gaps.
-- -----------------------------------------------------------------------------
SELECT version AS migration
  FROM supabase_migrations.schema_migrations
 ORDER BY version;


-- -----------------------------------------------------------------------------
-- 2. items_count column type  (migration 0007)
--    Both rows must read data_type = 'numeric', numeric_precision = 10,
--    numeric_scale = 3. If either still says 'integer', fractional sales are
--    being truncated by the database and that is a data-loss bug.
--    Expect: 2 rows, both numeric(10,3).
-- -----------------------------------------------------------------------------
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('sales', 'purchases')
   AND column_name = 'items_count'
 ORDER BY table_name;


-- -----------------------------------------------------------------------------
-- 3. Realtime publication membership
--    The client subscribes to all nine tables. A table missing here is the
--    classic cause of "it subscribes fine but nothing ever arrives".
--    Expect: 9 rows.
-- -----------------------------------------------------------------------------
SELECT tablename
  FROM pg_publication_tables
 WHERE pubname = 'supabase_realtime'
 ORDER BY tablename;


-- -----------------------------------------------------------------------------
-- 4. RLS enabled per table
--    rowsecurity must be true for every row. A false here means that table is
--    readable by any signed-in user from any shop - a cross-tenant data leak.
--    Expect: 9 rows, all rowsecurity = true.
-- -----------------------------------------------------------------------------
SELECT tablename, rowsecurity
  FROM pg_tables
 WHERE schemaname = 'public'
   AND tablename IN (
     'products', 'sales', 'sale_items', 'purchases', 'purchase_items',
     'customers', 'customer_payments', 'stock_movements', 'expenses'
   )
 ORDER BY tablename;


-- -----------------------------------------------------------------------------
-- 5. RLS policy count per table
--    Zero policies on a table with RLS enabled means the table is locked down
--    completely - legitimate for some, but for the nine watched tables it
--    usually means a policy was lost.
--    Expect: at least one policy per watched table.
-- -----------------------------------------------------------------------------
SELECT tablename, COUNT(*) AS policy_count,
       string_agg(COALESCE(qual, '(no USING)'), ' | ') AS using_clauses
  FROM pg_policies
 WHERE schemaname = 'public'
   AND tablename IN (
     'products', 'sales', 'sale_items', 'purchases', 'purchase_items',
     'customers', 'customer_payments', 'stock_movements', 'expenses'
   )
 GROUP BY tablename
 ORDER BY tablename;


-- -----------------------------------------------------------------------------
-- 6. Sales whose items_count disagrees with their lines
--    The core integrity invariant. Expect ZERO rows.
-- -----------------------------------------------------------------------------
SELECT s.invoice_no, s.items_count AS recorded, SUM(si.quantity) AS actual
  FROM sales s
  JOIN sale_items si ON si.sale_id = s.id
 GROUP BY s.id, s.invoice_no, s.items_count
HAVING s.items_count <> SUM(si.quantity);


-- -----------------------------------------------------------------------------
-- 7. Sales whose money columns disagree with their lines
--    Catches a header that was never updated after its items were written.
--    Expect ZERO rows.
-- -----------------------------------------------------------------------------
SELECT s.invoice_no,
       s.total_amount AS recorded_amount, SUM(si.total_price) AS lines_amount,
       s.total_cost   AS recorded_cost,   SUM(si.total_cost) AS lines_cost,
       s.profit       AS recorded_profit, s.total_amount - s.total_cost AS implied_profit
  FROM sales s
  JOIN sale_items si ON si.sale_id = s.id
 GROUP BY s.id, s.invoice_no, s.total_amount, s.total_cost, s.profit
HAVING s.total_amount <> SUM(si.total_price)
    OR s.total_cost   <> SUM(si.total_cost)
    OR s.profit       <> (s.total_amount - s.total_cost);


-- -----------------------------------------------------------------------------
-- 8. Sales with no line items, or lines pointing at a missing sale
--    Both are orphaned-data symptoms. Expect ZERO rows.
-- -----------------------------------------------------------------------------
SELECT s.invoice_no, 'sale with no items' AS problem
  FROM sales s
  LEFT JOIN sale_items si ON si.sale_id = s.id
 WHERE si.id IS NULL
UNION ALL
SELECT si.id::text, 'orphan sale_item'
  FROM sale_items si
  LEFT JOIN sales s ON s.id = si.sale_id
 WHERE s.id IS NULL;


-- -----------------------------------------------------------------------------
-- 9. Stock movement whose total contradicts its sale
--    reference_id is the invoice number, NOT the sale uuid. A sale sells N
--    units, so its movements must sum to -N. Expect ZERO rows.
-- -----------------------------------------------------------------------------
SELECT s.invoice_no,
       SUM(sm.quantity) AS movement_total,
       -SUM(si.quantity) AS expected_total
  FROM sales s
  JOIN sale_items si   ON si.sale_id = s.id
  JOIN stock_movements sm ON sm.reference_id = s.invoice_no AND sm.type = 'sale'
 GROUP BY s.id, s.invoice_no
HAVING SUM(sm.quantity) <> -SUM(si.quantity);


-- -----------------------------------------------------------------------------
-- 10. Fractional evidence
--     Shows whether the shop has actually sold anything weighed, and confirms
--     the fraction survives to the header. A fractional sale with a whole
--     items_count would prove truncation is still happening.
-- -----------------------------------------------------------------------------
SELECT s.invoice_no, s.items_count, si.quantity, si.unit_price, si.total_price
  FROM sales s
  JOIN sale_items si ON si.sale_id = s.id
 WHERE si.quantity <> FLOOR(si.quantity)
 ORDER BY s.id
 LIMIT 20;


-- -----------------------------------------------------------------------------
-- 11. Negative stock, and stock that disagrees with its ledger
--     There is no opening_stock column on products: a product's opening
--     quantity is recorded as a stock_movements row of type 'opening_stock',
--     created by rpc_create_product. So the expected quantity is the sum of
--     every movement, and that total must equal the stored stock_quantity.
--     Expect ZERO rows on both counts.
-- -----------------------------------------------------------------------------
SELECT name, stock_quantity AS negative_stock
  FROM products
 WHERE stock_quantity < 0;

SELECT p.name,
       p.stock_quantity AS recorded,
       COALESCE(SUM(sm.quantity), 0) AS ledger_total
  FROM products p
  LEFT JOIN stock_movements sm ON sm.product_id = p.id
 GROUP BY p.id, p.name, p.stock_quantity
HAVING p.stock_quantity <> COALESCE(SUM(sm.quantity), 0);


-- -----------------------------------------------------------------------------
-- 12. Customer debt ledger - INFORMATIONAL, not a pass/fail check
--     Read this one carefully rather than expecting zero rows.
--
--     A customer can be created with an opening balance (the store does exactly
--     that, and no payment row records it), so `implied_opening` being non-zero
--     is NORMAL, not drift. Genuine ledger drift is simply not detectable from
--     the data alone, because an opening balance and a corrupted balance look
--     identical once written.
--
--     So treat this as: implied_opening should be zero for any customer who was
--     NOT created with an opening balance. If a shop only ever opens accounts at
--     zero, every implied_opening must be 0.00 and anything else is a real bug.
-- -----------------------------------------------------------------------------
SELECT c.name, c.balance,
       COALESCE(SUM(s.total_amount) FILTER (WHERE s.payment_method = 'debt'), 0) AS debt_sales,
       COALESCE((SELECT SUM(cp.amount) FROM customer_payments cp WHERE cp.customer_id = c.id), 0) AS paid,
       c.balance - COALESCE(SUM(s.total_amount) FILTER (WHERE s.payment_method = 'debt'), 0)
         + COALESCE((SELECT SUM(cp.amount) FROM customer_payments cp WHERE cp.customer_id = c.id), 0)
         AS implied_opening
  FROM customers c
  LEFT JOIN sales s ON s.customer_id = c.id
 GROUP BY c.id, c.name, c.balance
 ORDER BY c.name;


-- -----------------------------------------------------------------------------
-- 12b. Genuine ledger faults - these SHOULD be zero rows
--      A debt sale with no customer (the RPC rejects this, so any row is a bug),
--      a negative balance, or an overpayment driving a balance below zero.
-- -----------------------------------------------------------------------------
SELECT s.invoice_no, 'debt sale with no customer' AS problem
  FROM sales s
 WHERE s.payment_method = 'debt' AND s.customer_id IS NULL
UNION ALL
SELECT c.name, 'negative balance: ' || c.balance::text
  FROM customers c
 WHERE c.balance < 0;


-- -----------------------------------------------------------------------------
-- 13. Products with no cost recorded
--     Not an error - cost is stored as 0 when unknown and the app flags these
--     in the inventory list. But until the first purchase, profit on them is
--     overstated because the sale RPC falls back to purchase_price, also 0.
--     This query is informational; it lists them.
-- -----------------------------------------------------------------------------
SELECT name, stock_quantity, selling_price, purchase_price, average_cost
  FROM products
 WHERE COALESCE(average_cost, 0) = 0
   AND COALESCE(stock_quantity, 0) <> 0
 ORDER BY name
 LIMIT 20;


-- -----------------------------------------------------------------------------
-- 14. Volume summary
--     Gives a sense of how much real data exists, which tells you how much the
--     zero-row results above are actually worth.
-- -----------------------------------------------------------------------------
SELECT 'sales'          AS entity, COUNT(*) AS rows FROM sales
UNION ALL SELECT 'sale_items',      COUNT(*) FROM sale_items
UNION ALL SELECT 'purchases',       COUNT(*) FROM purchases
UNION ALL SELECT 'purchase_items',  COUNT(*) FROM purchase_items
UNION ALL SELECT 'products',        COUNT(*) FROM products
UNION ALL SELECT 'customers',       COUNT(*) FROM customers
UNION ALL SELECT 'customer_payments', COUNT(*) FROM customer_payments
UNION ALL SELECT 'stock_movements', COUNT(*) FROM stock_movements
UNION ALL SELECT 'expenses',        COUNT(*) FROM expenses
UNION ALL SELECT 'profiles',        COUNT(*) FROM profiles
ORDER BY 1;
