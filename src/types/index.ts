export type PaymentMethod = 'cash' | 'debt';

export type StockMovementType = 'opening_stock' | 'purchase' | 'sale' | 'adjustment' | 'return';

export interface Category {
  id: string;
  name: string;
  icon: string;
  color?: string;
}

export interface Product {
  id: string;
  name: string;
  barcode: string;
  category_id: string;
  purchase_price: number; // Last purchased unit cost
  selling_price: number;
  average_cost: number; // Weighted average cost
  stock_quantity: number;
  minimum_stock: number;
  unit: string; // 'حبة' | 'كيس' | 'كرتونة' | 'علبة' | 'كجم'
  shelf_location?: string;
  image_url?: string;
  created_at: string;
  updated_at: string;
}

export interface CartItem {
  product: Product;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  total_price: number;
  total_cost: number;
  profit: number;
}

export interface SaleItem {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  barcode?: string;
  quantity: number;
  unit_price: number;
  unit_cost: number; // Preserved cost at the moment of sale
  total_price: number;
  total_cost: number;
  profit: number;
}

export interface Sale {
  id: string;
  invoice_no: string;
  total_amount: number;
  total_cost: number;
  profit: number; // Gross Profit
  payment_method: PaymentMethod;
  customer_id?: string | null;
  customer_name?: string | null;
  received_amount?: number;
  change_amount?: number;
  items_count: number;
  notes?: string;
  created_at: string;
  items: SaleItem[];
}

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
}

export interface Purchase {
  id: string;
  invoice_no: string;
  supplier_name: string;
  total_amount: number;
  items_count: number;
  notes?: string;
  created_at: string;
  items: PurchaseItem[];
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  balance: number; // Current outstanding debt
  credit_limit: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface CustomerPayment {
  id: string;
  customer_id: string;
  customer_name?: string;
  amount: number;
  previous_balance: number;
  new_balance: number;
  note?: string;
  created_at: string;
}

export interface Expense {
  id: string;
  title: string;
  amount: number;
  category: string; // 'إيجار' | 'كهرباء' | 'مرتبات' | 'نقل وتوصيل' | 'أكياس ومطبوعات' | 'صيانة' | 'أخرى'
  note?: string;
  created_at: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  product_name: string;
  type: StockMovementType;
  quantity: number; // Positive for incoming, negative for outgoing
  remaining_stock: number;
  reference_id?: string; // invoice_no, purchase_id, etc.
  note?: string;
  created_at: string;
}

export interface Settings {
  shop_name: string;
  branch_name: string;
  owner_name: string;
  phone: string;
  address: string;
  currency: string;
  tax_rate: number;
  receipt_header: string;
  receipt_footer: string;
  sound_effects: boolean;
  auto_print: boolean;
}

export interface UserSession {
  id: string;
  name: string;
  email: string;
  role: 'owner' | 'cashier';
  shift_started_at: string;
}
