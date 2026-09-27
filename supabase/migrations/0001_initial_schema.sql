-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Core Auth & Multi-tenant
CREATE TABLE shops (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES auth.users(id) NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    shop_id UUID REFERENCES shops(id) NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'cashier')),
    full_name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE shop_settings (
    shop_id UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
    shop_name TEXT,
    branch_name TEXT,
    owner_name TEXT,
    phone TEXT,
    address TEXT,
    currency TEXT DEFAULT 'د.ل',
    tax_rate NUMERIC(5,2) DEFAULT 0,
    receipt_header TEXT,
    receipt_footer TEXT,
    sound_effects BOOLEAN DEFAULT TRUE,
    auto_print BOOLEAN DEFAULT FALSE
);

-- Business Tables
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES categories(id),
    name TEXT NOT NULL,
    barcode TEXT,
    purchase_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    selling_price NUMERIC(12,2) NOT NULL DEFAULT 0,
    average_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
    stock_quantity NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
    minimum_stock NUMERIC(10,3) NOT NULL DEFAULT 0,
    unit TEXT NOT NULL,
    shelf_location TEXT,
    image_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(shop_id, barcode) -- Ensures barcode uniqueness per shop
);

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    balance NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
    credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE expenses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    category TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Transaction Tables
CREATE TABLE sales (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
    invoice_no TEXT NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    total_cost NUMERIC(12,2) NOT NULL,
    profit NUMERIC(12,2) NOT NULL,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'debt')),
    customer_id UUID REFERENCES customers(id),
    customer_name TEXT,
    received_amount NUMERIC(12,2),
    change_amount NUMERIC(12,2),
    items_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sale_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    sale_id UUID REFERENCES sales(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES products(id) NOT NULL,
    product_name TEXT NOT NULL,
    barcode TEXT,
    quantity NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL,
    unit_cost NUMERIC(12,2) NOT NULL,
    total_price NUMERIC(12,2) NOT NULL,
    total_cost NUMERIC(12,2) NOT NULL,
    profit NUMERIC(12,2) NOT NULL
);

CREATE TABLE purchases (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
    invoice_no TEXT NOT NULL,
    supplier_name TEXT NOT NULL,
    total_amount NUMERIC(12,2) NOT NULL,
    items_count INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    purchase_id UUID REFERENCES purchases(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES products(id) NOT NULL,
    product_name TEXT NOT NULL,
    quantity NUMERIC(10,3) NOT NULL CHECK (quantity > 0),
    unit_cost NUMERIC(12,2) NOT NULL,
    total_cost NUMERIC(12,2) NOT NULL
);

CREATE TABLE customer_payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
    customer_id UUID REFERENCES customers(id) NOT NULL,
    customer_name TEXT,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    previous_balance NUMERIC(12,2) NOT NULL,
    new_balance NUMERIC(12,2) NOT NULL CHECK (new_balance >= 0),
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    shop_id UUID REFERENCES shops(id) ON DELETE CASCADE NOT NULL,
    product_id UUID REFERENCES products(id) NOT NULL,
    product_name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('opening_stock', 'purchase', 'sale', 'adjustment', 'return')),
    quantity NUMERIC(10,3) NOT NULL,
    remaining_stock NUMERIC(10,3) NOT NULL CHECK (remaining_stock >= 0),
    reference_id TEXT,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- RLS Configuration
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

-- Helper Function for RLS
CREATE OR REPLACE FUNCTION public.get_user_shop_id()
RETURNS UUID AS $$
    SELECT shop_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Shop Policies
CREATE POLICY "Users can view their own shop" ON shops FOR SELECT USING (owner_id = auth.uid() OR id = get_user_shop_id());
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (id = auth.uid() OR shop_id = get_user_shop_id());

-- Business Data Policies (Access own shop data)
CREATE POLICY "Shop data access" ON shop_settings FOR ALL USING (shop_id = get_user_shop_id());
CREATE POLICY "Shop data access" ON categories FOR ALL USING (shop_id = get_user_shop_id());
CREATE POLICY "Shop data access" ON products FOR ALL USING (shop_id = get_user_shop_id());
CREATE POLICY "Shop data access" ON customers FOR ALL USING (shop_id = get_user_shop_id());
CREATE POLICY "Shop data access" ON expenses FOR ALL USING (shop_id = get_user_shop_id());
CREATE POLICY "Shop data access" ON sales FOR ALL USING (shop_id = get_user_shop_id());
CREATE POLICY "Shop data access" ON sale_items FOR ALL USING (sale_id IN (SELECT id FROM sales WHERE shop_id = get_user_shop_id()));
CREATE POLICY "Shop data access" ON purchases FOR ALL USING (shop_id = get_user_shop_id());
CREATE POLICY "Shop data access" ON purchase_items FOR ALL USING (purchase_id IN (SELECT id FROM purchases WHERE shop_id = get_user_shop_id()));
CREATE POLICY "Shop data access" ON customer_payments FOR ALL USING (shop_id = get_user_shop_id());
CREATE POLICY "Shop data access" ON stock_movements FOR ALL USING (shop_id = get_user_shop_id());

-- RPCs
-- 1. Execute Sale
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
    v_unit_cost NUMERIC;
    v_line_price NUMERIC;
    v_line_cost NUMERIC;
    v_line_profit NUMERIC;
    v_customer RECORD;
    v_total_units NUMERIC := 0;
BEGIN
    -- Verify shop_id securely
    IF get_user_shop_id() IS NULL OR p_shop_id IS NULL OR p_shop_id != get_user_shop_id() THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    -- Generate Invoice No (timestamp + random suffix: unique even for same-second sales)
    v_invoice_no := 'INV-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS') || '-' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 4);

    -- Insert draft sale
    INSERT INTO sales (shop_id, invoice_no, total_amount, total_cost, profit, payment_method, customer_id, received_amount, notes)
    VALUES (p_shop_id, v_invoice_no, 0, 0, 0, p_payment_method, p_customer_id, p_received_amount, p_notes)
    RETURNING id INTO v_sale_id;

    -- Process items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        -- Lock product
        SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID AND shop_id = p_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found', (v_item->>'product_id');
        END IF;

        IF v_product.stock_quantity < (v_item->>'quantity')::NUMERIC THEN
            RAISE EXCEPTION 'Insufficient stock for product % (Available: %)', v_product.name, v_product.stock_quantity;
        END IF;

        -- Calculate costs
        v_unit_cost := CASE WHEN v_product.average_cost > 0 THEN v_product.average_cost ELSE v_product.purchase_price END;
        v_line_price := ROUND(((v_item->>'quantity')::NUMERIC * (v_item->>'unit_price')::NUMERIC), 2);
        v_line_cost := ROUND(((v_item->>'quantity')::NUMERIC * v_unit_cost), 2);
        v_line_profit := v_line_price - v_line_cost;

        v_total_amount := v_total_amount + v_line_price;
        v_total_cost := v_total_cost + v_line_cost;
        v_profit := v_profit + v_line_profit;
        -- Total units (matches UI: saleItems.reduce((acc, i) => acc + i.quantity, 0))
        v_total_units := v_total_units + (v_item->>'quantity')::NUMERIC;

        -- Insert sale item
        INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, unit_cost, total_price, total_cost, profit)
        VALUES (v_sale_id, v_product.id, v_product.name, v_product.barcode, (v_item->>'quantity')::NUMERIC, (v_item->>'unit_price')::NUMERIC, v_unit_cost, v_line_price, v_line_cost, v_line_profit);

        -- Update stock
        UPDATE products SET stock_quantity = stock_quantity - (v_item->>'quantity')::NUMERIC WHERE id = v_product.id;

        -- Stock movement
        INSERT INTO stock_movements (shop_id, product_id, product_name, type, quantity, remaining_stock, reference_id, note)
        VALUES (p_shop_id, v_product.id, v_product.name, 'sale', -((v_item->>'quantity')::NUMERIC), v_product.stock_quantity - (v_item->>'quantity')::NUMERIC, v_invoice_no, 'Sale');
    END LOOP;

    -- Handle Debt
    IF p_payment_method = 'debt' THEN
        IF p_customer_id IS NULL THEN
            RAISE EXCEPTION 'Customer is required for debt sales';
        END IF;
        
        SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND shop_id = p_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Customer not found';
        END IF;
        
        UPDATE customers SET balance = balance + v_total_amount WHERE id = p_customer_id;
        
        UPDATE sales SET customer_name = v_customer.name WHERE id = v_sale_id;
    END IF;

    -- Update Sale totals (items_count = total units, same as local store.ts)
    UPDATE sales SET 
        total_amount = v_total_amount, 
        total_cost = v_total_cost, 
        profit = v_profit,
        items_count = FLOOR(v_total_units)::INT,
        change_amount = CASE WHEN p_payment_method = 'cash' AND p_received_amount IS NOT NULL THEN p_received_amount - v_total_amount ELSE 0 END
    WHERE id = v_sale_id;

    RETURN v_sale_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 2. Execute Purchase
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
    v_line_cost NUMERIC;
    v_new_average_cost NUMERIC;
    v_total_units NUMERIC := 0;
BEGIN
    IF get_user_shop_id() IS NULL OR p_shop_id IS NULL OR p_shop_id != get_user_shop_id() THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    v_invoice_no := 'PUR-' || TO_CHAR(NOW(), 'YYYYMMDD-HH24MISS') || '-' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', ''), 1, 4);

    INSERT INTO purchases (shop_id, invoice_no, supplier_name, total_amount, items_count, notes)
    VALUES (p_shop_id, v_invoice_no, p_supplier_name, 0, 0, p_notes)
    RETURNING id INTO v_purchase_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        SELECT * INTO v_product FROM products WHERE id = (v_item->>'product_id')::UUID AND shop_id = p_shop_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Product % not found', (v_item->>'product_id');
        END IF;

        v_line_cost := ROUND(((v_item->>'quantity')::NUMERIC * (v_item->>'unit_cost')::NUMERIC), 2);
        v_total_amount := v_total_amount + v_line_cost;
        -- Total units (matches UI: purchaseItems.reduce((acc, i) => acc + i.quantity, 0))
        v_total_units := v_total_units + (v_item->>'quantity')::NUMERIC;

        INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit_cost, total_cost)
        VALUES (v_purchase_id, v_product.id, v_product.name, (v_item->>'quantity')::NUMERIC, (v_item->>'unit_cost')::NUMERIC, v_line_cost);

        -- Calculate average cost
        IF v_product.stock_quantity <= 0 THEN
            v_new_average_cost := (v_item->>'unit_cost')::NUMERIC;
        ELSE
            v_new_average_cost := ROUND(((v_product.stock_quantity * (CASE WHEN v_product.average_cost > 0 THEN v_product.average_cost ELSE v_product.purchase_price END)) + v_line_cost) / (v_product.stock_quantity + (v_item->>'quantity')::NUMERIC), 2);
        END IF;

        UPDATE products SET 
            stock_quantity = stock_quantity + (v_item->>'quantity')::NUMERIC,
            purchase_price = (v_item->>'unit_cost')::NUMERIC,
            average_cost = v_new_average_cost
        WHERE id = v_product.id;

        INSERT INTO stock_movements (shop_id, product_id, product_name, type, quantity, remaining_stock, reference_id, note)
        VALUES (p_shop_id, v_product.id, v_product.name, 'purchase', (v_item->>'quantity')::NUMERIC, v_product.stock_quantity + (v_item->>'quantity')::NUMERIC, v_invoice_no, 'Purchase');
    END LOOP;

    UPDATE purchases SET total_amount = v_total_amount, items_count = FLOOR(v_total_units)::INT WHERE id = v_purchase_id;

    RETURN v_purchase_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- 3. Execute Customer Payment
CREATE OR REPLACE FUNCTION rpc_execute_customer_payment(
    p_shop_id UUID,
    p_customer_id UUID,
    p_amount NUMERIC,
    p_note TEXT
) RETURNS UUID AS $$
DECLARE
    v_payment_id UUID;
    v_customer RECORD;
BEGIN
    IF get_user_shop_id() IS NULL OR p_shop_id IS NULL OR p_shop_id != get_user_shop_id() THEN
        RAISE EXCEPTION 'Unauthorized shop access';
    END IF;

    SELECT * INTO v_customer FROM customers WHERE id = p_customer_id AND shop_id = p_shop_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Customer not found';
    END IF;

    IF v_customer.balance < p_amount THEN
        RAISE EXCEPTION 'Payment amount exceeds current balance';
    END IF;

    INSERT INTO customer_payments (shop_id, customer_id, customer_name, amount, previous_balance, new_balance, note)
    VALUES (p_shop_id, p_customer_id, v_customer.name, p_amount, v_customer.balance, v_customer.balance - p_amount, p_note)
    RETURNING id INTO v_payment_id;

    UPDATE customers SET balance = balance - p_amount WHERE id = p_customer_id;

    RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- User Bootstrapping
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_shop_id UUID;
BEGIN
    INSERT INTO public.shops (owner_id, name)
    VALUES (new.id, 'متجري')
    RETURNING id INTO v_shop_id;
    
    INSERT INTO public.profiles (id, shop_id, role, full_name)
    VALUES (new.id, v_shop_id, 'owner', COALESCE(new.raw_user_meta_data->>'full_name', 'المالك'));
    
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
