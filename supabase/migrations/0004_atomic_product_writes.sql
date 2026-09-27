-- 0004: make product writes and their stock movements atomic
-- ---------------------------------------------------------------
-- cloudSync.createProduct / updateProduct each issued TWO statements:
--
--   1. INSERT/UPDATE products            (commits on its own)
--   2. INSERT stock_movements            (commits on its own)
--
-- If step 2 failed, the product already carried the new stock with no ledger
-- entry explaining it - which PRD section 12 forbids outright ("Never modify
-- inventory silently. Every stock change should have a traceable reason"). The
-- client made it worse: insertMovement's own comment claimed it was "best
-- effort ... log instead of failing" while the code actually threw, so the
-- cashier saw an error for a product that had in fact been saved.
--
-- These two RPCs perform the product write and its movement in a single
-- transaction, so both land or neither does. Postgres runs each RPC in one
-- implicit transaction, and an exception rolls the whole thing back.
--
-- The stock-movement `note` is now supplied by the caller so the cloud ledger
-- keeps the same descriptive text the local store writes, instead of the
-- hardcoded English 'Sale' / 'Purchase' that 0001/0003 emitted.

-- Create a product together with its opening-stock movement.
CREATE OR REPLACE FUNCTION rpc_create_product(
    p_shop_id UUID,
    p_name TEXT,
    p_barcode TEXT,
    p_category_id UUID,
    p_purchase_price NUMERIC,
    p_selling_price NUMERIC,
    p_average_cost NUMERIC,
    p_stock_quantity NUMERIC,
    p_minimum_stock NUMERIC,
    p_unit TEXT,
    p_shelf_location TEXT,
    p_image_url TEXT,
    p_note TEXT
) RETURNS products AS $$
DECLARE
    v_product products%ROWTYPE;
    v_stock NUMERIC;
BEGIN
    IF get_user_shop_id() IS NULL OR p_shop_id IS NULL OR p_shop_id != get_user_shop_id() THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    IF p_name IS NULL OR btrim(p_name) = '' THEN
        RAISE EXCEPTION 'Product name is required';
    END IF;

    IF COALESCE(p_purchase_price, 0) < 0 OR COALESCE(p_selling_price, 0) < 0 THEN
        RAISE EXCEPTION 'Prices cannot be negative';
    END IF;

    v_stock := COALESCE(p_stock_quantity, 0);
    IF v_stock < 0 THEN
        RAISE EXCEPTION 'Stock cannot be negative';
    END IF;

    IF COALESCE(p_minimum_stock, 0) < 0 THEN
        RAISE EXCEPTION 'Minimum stock cannot be negative';
    END IF;

    INSERT INTO products (
        shop_id, name, barcode, category_id, purchase_price, selling_price,
        average_cost, stock_quantity, minimum_stock, unit, shelf_location, image_url
    ) VALUES (
        p_shop_id,
        btrim(p_name),
        -- Empty barcodes must be NULL: UNIQUE(shop_id, barcode) treats NULLs as
        -- distinct, so two empty strings would collide.
        NULLIF(btrim(COALESCE(p_barcode, '')), ''),
        p_category_id,
        COALESCE(p_purchase_price, 0),
        COALESCE(p_selling_price, 0),
        COALESCE(p_average_cost, 0),
        v_stock,
        COALESCE(p_minimum_stock, 0),
        COALESCE(NULLIF(btrim(COALESCE(p_unit, '')), ''), 'حبة'),
        NULLIF(btrim(COALESCE(p_shelf_location, '')), ''),
        NULLIF(btrim(COALESCE(p_image_url, '')), '')
    )
    RETURNING * INTO v_product;

    IF v_product.stock_quantity > 0 THEN
        INSERT INTO stock_movements (
            shop_id, product_id, product_name, type, quantity, remaining_stock, reference_id, note
        ) VALUES (
            p_shop_id, v_product.id, v_product.name, 'opening_stock',
            v_product.stock_quantity, v_product.stock_quantity, NULL,
            COALESCE(p_note, 'رصيد افتتاحي عند تسجيل المنتج')
        );
    END IF;

    RETURN v_product;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Update a product, recording an adjustment movement in the same transaction
-- whenever the stock level actually changes.
--
-- p_updates is a sparse JSONB patch. Only the keys present are written, so an
-- edit that does not touch the stock can never create a phantom movement.
CREATE OR REPLACE FUNCTION rpc_update_product(
    p_shop_id UUID,
    p_product_id UUID,
    p_previous_stock NUMERIC,
    p_updates JSONB,
    p_note TEXT
) RETURNS products AS $$
DECLARE
    v_product products%ROWTYPE;
    v_new_stock NUMERIC;
    v_old_stock NUMERIC;
BEGIN
    IF get_user_shop_id() IS NULL OR p_shop_id IS NULL OR p_shop_id != get_user_shop_id() THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    SELECT * INTO v_product FROM products
    WHERE id = p_product_id AND shop_id = p_shop_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found', p_product_id;
    END IF;

    v_old_stock := v_product.stock_quantity;

    UPDATE products SET
        name = CASE WHEN p_updates ? 'name' THEN btrim(p_updates->>'name') ELSE name END,
        barcode = CASE
            WHEN p_updates ? 'barcode' THEN NULLIF(btrim(COALESCE(p_updates->>'barcode', '')), '')
            ELSE barcode END,
        category_id = CASE WHEN p_updates ? 'category_id' THEN NULLIF(p_updates->>'category_id', '')::UUID ELSE category_id END,
        purchase_price = CASE WHEN p_updates ? 'purchase_price' THEN (p_updates->>'purchase_price')::NUMERIC ELSE purchase_price END,
        selling_price = CASE WHEN p_updates ? 'selling_price' THEN (p_updates->>'selling_price')::NUMERIC ELSE selling_price END,
        -- average_cost is intentionally NOT updatable here. It is a weighted
        -- average owned by rpc_execute_purchase; letting the inventory edit
        -- form write it would destroy the basis for every future sale's profit.
        average_cost = average_cost,
        stock_quantity = CASE WHEN p_updates ? 'stock_quantity' THEN (p_updates->>'stock_quantity')::NUMERIC ELSE stock_quantity END,
        minimum_stock = CASE WHEN p_updates ? 'minimum_stock' THEN (p_updates->>'minimum_stock')::NUMERIC ELSE minimum_stock END,
        unit = CASE WHEN p_updates ? 'unit' THEN COALESCE(NULLIF(btrim(p_updates->>'unit'), ''), 'حبة') ELSE unit END,
        shelf_location = CASE WHEN p_updates ? 'shelf_location' THEN NULLIF(btrim(COALESCE(p_updates->>'shelf_location', '')), '') ELSE shelf_location END,
        image_url = CASE WHEN p_updates ? 'image_url' THEN NULLIF(btrim(COALESCE(p_updates->>'image_url', '')), '') ELSE image_url END,
        updated_at = NOW()
    WHERE id = p_product_id
    RETURNING * INTO v_product;

    IF v_product.name IS NULL OR btrim(v_product.name) = '' THEN
        RAISE EXCEPTION 'Product name is required';
    END IF;

    IF v_product.purchase_price < 0 OR v_product.selling_price < 0 THEN
        RAISE EXCEPTION 'Prices cannot be negative';
    END IF;

    v_new_stock := v_product.stock_quantity;
    IF v_new_stock < 0 THEN
        RAISE EXCEPTION 'Stock cannot be negative';
    END IF;

    -- Movement in the SAME transaction as the product update. p_previous_stock is
    -- the caller's cached figure; v_old_stock is the row we just locked, and the
    -- latter wins when they disagree, so the ledger records the real delta.
    IF v_new_stock <> v_old_stock THEN
        INSERT INTO stock_movements (
            shop_id, product_id, product_name, type, quantity, remaining_stock, reference_id, note
        ) VALUES (
            p_shop_id, v_product.id, v_product.name, 'adjustment',
            v_new_stock - v_old_stock, v_new_stock, NULL,
            COALESCE(p_note, 'تعديل يدوي للمخزون / جرد فعلي')
        );
    END IF;

    RETURN v_product;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
