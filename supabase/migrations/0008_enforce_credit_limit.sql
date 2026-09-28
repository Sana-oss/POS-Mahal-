-- 0008: enforce the customer credit limit on debt sales
-- ---------------------------------------------------------------
-- `customers.credit_limit` was created in 0001 and has been written by the app
-- ever since, but no SQL ever read it. A debt sale went straight to
-- `balance = balance + v_total_amount` with no comparison against the limit, so
-- a customer could be run arbitrarily far past their limit. A customer with a
-- limit of 50 reached a balance of 234.60 before this migration.
--
-- Why it has to live here and not in the client: the client check is advisory.
-- The RPC is reachable directly, and it is the only place that knows the final
-- total, because prices are derived server-side from the locked product rows
-- rather than trusted from the request. A limit enforced anywhere else could be
-- bypassed, and would also disagree with the total that actually gets charged.
--
-- The rule, as agreed:
--   * credit_limit = 0 means no limit. The column defaults to 0, so treating
--     zero as "no credit" would block every customer who has never been given an
--     explicit limit, including every one created before this migration.
--   * The limit covers total owing, not just this sale: a customer already over
--     their limit cannot add more debt, they can only pay down or have the limit
--     raised.
--   * The sale is rejected, not merely warned about.
--
-- The customer row is already selected FOR UPDATE near the top of the function,
-- before the item loop, so the limit is read under a row lock and the check
-- cannot race a second till against the same customer.

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
    v_projected_balance NUMERIC;
    v_credit_limit NUMERIC;
BEGIN
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

    v_invoice_no := 'INV-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS') || '-' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 4);

    v_movement_note := 'بيع فاتورة #' || v_invoice_no
        || CASE WHEN v_customer_name IS NOT NULL THEN ' • ' || v_customer_name ELSE '' END;

    INSERT INTO sales (shop_id, invoice_no, total_amount, total_cost, profit, payment_method, customer_id, received_amount, notes)
    VALUES (p_shop_id, v_invoice_no, 0, 0, 0, p_payment_method, p_customer_id, p_received_amount, p_notes)
    RETURNING id INTO v_sale_id;

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

    IF p_payment_method = 'debt' THEN
        -- Credit limit, enforced against the total owing after this sale.
        -- Placed after the item loop because the total is only known once prices
        -- have been derived from the locked products; placed before the UPDATE so
        -- nothing is written when the sale is rejected.
        v_credit_limit := COALESCE(v_customer.credit_limit, 0);
        v_projected_balance := COALESCE(v_customer.balance, 0) + v_total_amount;

        IF v_credit_limit > 0 AND v_projected_balance > v_credit_limit THEN
            RAISE EXCEPTION 'Credit limit exceeded for % (Owes: %, Limit: %)', v_customer.name, v_projected_balance, v_credit_limit;
        END IF;

        UPDATE customers SET balance = balance + v_total_amount WHERE id = p_customer_id;
        UPDATE sales SET customer_name = v_customer_name WHERE id = v_sale_id;
    END IF;

    UPDATE sales SET
        total_amount = v_total_amount,
        total_cost = v_total_cost,
        profit = v_profit,
        items_count = v_total_units,
        change_amount = CASE
            WHEN p_payment_method = 'cash' AND p_received_amount IS NOT NULL
            THEN GREATEST(0, ROUND(p_received_amount - v_total_amount, 2))
            ELSE 0
        END
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
