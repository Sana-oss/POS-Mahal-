-- 0005: keep human-readable attribution on the stock-movement ledger
-- ---------------------------------------------------------------
-- rpc_execute_sale / rpc_execute_purchase wrote a hardcoded English note
-- ('Sale' / 'Purchase') into stock_movements, while the local-only store writes
-- a descriptive one:
--
--   local sale:     'بيع فاتورة #<invoice>' + ' • <customer>'   (customer optional)
--   local purchase: 'توريد مشتريات #<invoice> • <supplier>'
--
-- So the cloud ledger lost who a movement belonged to, and the two storage modes
-- disagreed on the same transaction. The information is recoverable via
-- reference_id -> invoice_no -> the parent row, but the ledger itself should
-- not need a join to be readable.
--
-- The fix needs NO signature change: both functions already hold the customer
-- and supplier names, so the note is composed in SQL exactly as the local store
-- composes it in TypeScript.
--
-- rpc_execute_sale additionally resolves and locks the debt customer BEFORE
-- inserting anything. Previously the customer was validated after the item loop
-- had already written sale_items and stock_movements; a bad customer id could
-- only be caught by the transaction-level rollback, and the early check now fails
-- before a single row is written.

CREATE OR REPLACE FUNCTION rpc_execute_sale(
    p_shop_id UUID,
    p_customer_id UUID,
    p_payment_method TEXT,
    p_received_amount NUMERIC,
    p_notes TEXT,
    p_items JSONB
) RETURNS UUID AS $$
DECLARE
    v_sale_id UUID;
    v_invoice_no TEXT;
    v_total_amount NUMERIC := 0;
    v_total_cost NUMERIC := 0;
    v_profit NUMERIC := 0;
    v_item JSONB;
    v_product RECORD;
    v_quantity NUMERIC;
    v_unit_price NUMERIC;
    v_unit_cost NUMERIC;
    v_line_price NUMERIC;
    v_line_cost NUMERIC;
    v_line_profit NUMERIC;
    v_customer RECORD;
    v_customer_name TEXT := NULL;
    v_movement_note TEXT;
    v_total_units NUMERIC := 0;
BEGIN
    -- Verify shop_id securely
    IF get_user_shop_id() IS NULL OR p_shop_id IS NULL OR p_shop_id != get_user_shop_id() THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    IF p_payment_method NOT IN ('cash', 'debt') THEN
        RAISE EXCEPTION 'Invalid payment method';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Sale has no items';
    END IF;

    -- Resolve and lock the debt customer up front, so a bad customer id fails
    -- before any row is written rather than relying on the rollback.
    IF p_payment_method = 'debt' THEN
        IF p_customer_id IS NULL THEN
            RAISE EXCEPTION 'Customer is required for debt sales';
        END IF;

        SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND shop_id = p_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Customer not found';
        END IF;

        v_customer_name := v_customer.name;
    END IF;

    -- Generate Invoice No (timestamp + random suffix: unique even for same-second sales)
    v_invoice_no := 'INV-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS') || '-' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 4);

    -- Same wording as the local store's movement note.
    v_movement_note := 'بيع فاتورة #' || v_invoice_no
        || CASE WHEN v_customer_name IS NOT NULL THEN ' • ' || v_customer_name ELSE '' END;

    -- Insert draft sale
    INSERT INTO sales (shop_id, invoice_no, total_amount, total_cost, profit, payment_method, customer_id, received_amount, notes)
    VALUES (p_shop_id, v_invoice_no, 0, 0, 0, p_payment_method, p_customer_id, p_received_amount, p_notes)
    RETURNING id INTO v_sale_id;

    -- Process items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_quantity := (v_item->>'quantity')::NUMERIC;

        IF v_quantity IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION 'Quantity must be greater than zero';
        END IF;

        -- Lock product. Re-read on every iteration, so two lines for the same
        -- product validate and deduct against the already-updated quantity.
        SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID AND shop_id = p_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found', (v_item->>'product_id');
        END IF;

        IF v_product.stock_quantity < v_quantity THEN
            RAISE EXCEPTION 'Insufficient stock for product % (Available: %)', v_product.name, v_product.stock_quantity;
        END IF;

        -- Cost frozen at the moment of sale (PRD rule: history must not depend
        -- on the product's current cost).
        v_unit_cost := CASE WHEN v_product.average_cost > 0 THEN v_product.average_cost ELSE v_product.purchase_price END;

        -- Price is read from the locked row, never from the request body.
        v_unit_price := v_product.selling_price;

        v_line_price := ROUND((v_quantity * v_unit_price), 2);
        v_line_cost := ROUND((v_quantity * v_unit_cost), 2);
        v_line_profit := v_line_price - v_line_cost;

        v_total_amount := v_total_amount + v_line_price;
        v_total_cost := v_total_cost + v_line_cost;
        v_profit := v_profit + v_line_profit;
        v_total_units := v_total_units + v_quantity;

        INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost, total_price, total_cost, profit)
        VALUES (v_sale_id, v_product.id, v_product.name, v_product.barcode, v_quantity, v_unit_price, v_unit_cost, v_line_price, v_line_cost, v_line_profit);

        UPDATE products SET stock_quantity = stock_quantity - v_quantity WHERE id = v_product.id;

        INSERT INTO stock_movements (shop_id, product_id, product_name, type, quantity, remaining_stock, reference_id, note)
        VALUES (p_shop_id, v_product.id, v_product.name, 'sale', -v_quantity, v_product.stock_quantity - v_quantity, v_invoice_no, v_movement_note);
    END LOOP;

    -- Handle Debt
    IF p_payment_method = 'debt' THEN
        UPDATE customers SET balance = balance + v_total_amount WHERE id = p_customer_id;
        UPDATE sales SET customer_name = v_customer_name WHERE id = v_sale_id;
    END IF;

    -- Update Sale totals (items_count = total units, same as local store.ts)
    UPDATE sales SET
        total_amount = v_total_amount,
        total_cost = v_total_cost,
        profit = v_profit,
        items_count = FLOOR(v_total_units)::INT,
        change_amount = CASE
            WHEN p_payment_method = 'cash' AND p_received_amount IS NOT NULL
            THEN GREATEST(0, ROUND(p_received_amount - v_total_amount, 2))
            ELSE 0
        END
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


CREATE OR REPLACE FUNCTION rpc_execute_purchase(
    p_shop_id UUID,
    p_supplier_name TEXT,
    p_notes TEXT,
    p_items JSONB
) RETURNS UUID AS $$
DECLARE
    v_purchase_id UUID;
    v_invoice_no TEXT;
    v_total_amount NUMERIC := 0;
    v_item JSONB;
    v_product RECORD;
    v_quantity NUMERIC;
    v_unit_cost NUMERIC;
    v_line_cost NUMERIC;
    v_new_average_cost NUMERIC;
    v_supplier TEXT;
    v_movement_note TEXT;
    v_total_units NUMERIC := 0;
BEGIN
    IF get_user_shop_id() IS NULL OR p_shop_id IS NULL OR p_shop_id != get_user_shop_id() THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Purchase has no items';
    END IF;

    v_supplier := COALESCE(NULLIF(btrim(COALESCE(p_supplier_name, '')), ''), 'مورّد عام');

    v_invoice_no := 'PUR-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS') || '-' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 4);

    -- Same wording as the local store's movement note.
    v_movement_note := 'توريد مشتريات #' || v_invoice_no || ' • ' || v_supplier;

    INSERT INTO purchases (shop_id, invoice_no, supplier_name, total_amount, items_count, notes)
    VALUES (p_shop_id, v_invoice_no, v_supplier, 0, 0, p_notes)
    RETURNING id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_quantity := (v_item->>'quantity')::NUMERIC;
        v_unit_cost := (v_item->>'unit_cost')::NUMERIC;

        IF v_quantity IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION 'Quantity must be greater than zero';
        END IF;

        IF v_unit_cost IS NULL OR v_unit_cost < 0 THEN
            RAISE EXCEPTION 'Purchase unit cost cannot be negative';
        END IF;

        SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID AND shop_id = p_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found', (v_item->>'product_id');
        END IF;

        v_line_cost := ROUND((v_quantity * v_unit_cost), 2);
        v_total_amount := v_total_amount + v_line_cost;
        v_total_units := v_total_units + v_quantity;

        INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, total_cost)
        VALUES (v_purchase_id, v_product.id, v_product.name, v_quantity, v_unit_cost, v_line_cost);

        IF v_product.stock_quantity <= 0 THEN
            v_new_average_cost := v_unit_cost;
        ELSE
            v_new_average_cost := ROUND(((v_product.stock_quantity * (CASE WHEN v_product.average_cost > 0 THEN v_product.average_cost ELSE v_product.purchase_price END)) + v_line_cost) / (v_product.stock_quantity + v_quantity), 2);
        END IF;

        UPDATE products SET
            stock_quantity = stock_quantity + v_quantity,
            purchase_price = v_unit_cost,
            average_cost = v_new_average_cost
        WHERE id = v_product.id;

        INSERT INTO stock_movements (shop_id, product_id, product_name, type, quantity, remaining_stock, reference_id, note)
        VALUES (p_shop_id, v_product.id, v_product.name, 'purchase', v_quantity, v_product.stock_quantity + v_quantity, v_invoice_no, v_movement_note);
    END LOOP;

    UPDATE purchases SET total_amount = v_total_amount, items_count = FLOOR(v_total_units)::INT WHERE id = v_purchase_id;

    RETURN v_purchase_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
