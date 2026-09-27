-- 0002: archive products instead of deleting them
-- ---------------------------------------------------------------
-- `sale_items`, `purchase_items` and `stock_movements` all reference
-- products(id) without ON DELETE CASCADE, so a hard DELETE of a product that
-- already appears on an invoice is rejected by Postgres (good for accounting,
-- useless for a cashier who needs to retire a product).
--
-- This migration adds the archive flag used by the app (src/services/cloudSync.ts
-- probes for the column at runtime, so applying it is optional and backwards
-- compatible).

ALTER TABLE products
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Partial index: the POS only ever lists active products.
CREATE INDEX IF NOT EXISTS products_shop_active_idx
    ON products (shop_id, name)
    WHERE is_active;

COMMENT ON COLUMN products.is_active IS
    'false = archived product: hidden from the POS lists but kept for invoice history';
