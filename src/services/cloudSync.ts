/**
 * Mahall POS — Cloud Data Layer (Supabase / Postgres)
 * ---------------------------------------------------------------
 * Single module for every cloud read/write, so no React component ever talks to
 * PostgREST directly.
 *
 * Money-critical writes (sales, purchases, debt payments) go through the
 * SECURITY DEFINER RPCs in supabase/migrations/0001_initial_schema.sql:
 *   rpc_execute_sale / rpc_execute_purchase / rpc_execute_customer_payment
 * They lock the product row (SELECT ... FOR UPDATE), so two registers can never
 * oversell the same stock or double-post a debt payment.
 *
 * Master data (products, customers, expenses, settings) is written straight
 * through PostgREST — the RLS "Shop data access" policies scope every statement
 * to get_user_shop_id(), so a leaked anon key can only touch its own shop.
 *
 * lib/store.ts stays the render cache: after a write succeeds we apply the rows
 * Postgres computed (invoice number, stock, weighted average cost, balance), so
 * the UI can never drift from the database.
 */

import { requireSupabase } from '../lib/supabase';
import {
  Category,
  Customer,
  CustomerPayment,
  Expense,
  Product,
  Purchase,
  PurchaseItem,
  Sale,
  SaleItem,
  Settings,
  StockMovement,
  StockMovementType,
} from '../types';

/** Lazily resolved so importing this module never throws in local-only mode. */
const db = () => requireSupabase();

// ---------------------------------------------------------------------------
// PostgREST row shapes
// ---------------------------------------------------------------------------
// These mirror the tables in supabase/migrations/0001_initial_schema.sql plus
// the `products.is_active` column from 0002. They replace the previous
// `Record<string, any>`, which let a column be renamed or dropped without any
// compile error and silently produced `undefined` at runtime.
//
// NUMERIC columns are typed `number` because that is what PostgREST emits for
// NUMERIC in JSON. The `num()` helper still coerces at runtime, so a value that
// ever arrives as a string is handled rather than propagated.

interface ProductRow {
  id: string;
  shop_id: string;
  category_id: string | null;
  name: string;
  barcode: string | null;
  purchase_price: number;
  selling_price: number;
  average_cost: number;
  stock_quantity: number;
  minimum_stock: number;
  unit: string;
  shelf_location: string | null;
  image_url: string | null;
  is_active?: boolean;
  created_at: string;
  updated_at: string;
}

interface CategoryRow {
  id: string;
  shop_id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface CustomerRow {
  id: string;
  shop_id: string;
  name: string;
  phone: string | null;
  balance: number;
  credit_limit: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ExpenseRow {
  id: string;
  shop_id: string;
  title: string;
  amount: number;
  category: string;
  note: string | null;
  created_at: string;
}

interface CustomerPaymentRow {
  id: string;
  shop_id: string;
  customer_id: string;
  customer_name: string | null;
  amount: number;
  previous_balance: number;
  new_balance: number;
  note: string | null;
  created_at: string;
}

interface StockMovementRow {
  id: string;
  shop_id: string;
  product_id: string;
  product_name: string;
  type: string;
  quantity: number;
  remaining_stock: number;
  reference_id: string | null;
  note: string | null;
  created_at: string;
}

interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  barcode: string | null;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  total_price: number;
  total_cost: number;
  profit: number;
}

interface SaleRow {
  id: string;
  shop_id: string;
  invoice_no: string;
  total_amount: number;
  total_cost: number;
  profit: number;
  payment_method: string;
  customer_id: string | null;
  customer_name: string | null;
  received_amount: number | null;
  change_amount: number | null;
  items_count: number;
  notes: string | null;
  created_at: string;
  /** Present only when the read embedded `sale_items(*)` under this key. */
  items?: SaleItemRow[] | null;
}

interface PurchaseItemRow {
  id: string;
  purchase_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
}

interface PurchaseRow {
  id: string;
  shop_id: string;
  invoice_no: string;
  supplier_name: string;
  total_amount: number;
  items_count: number;
  notes: string | null;
  created_at: string;
  /** Present only when the read embedded `purchase_items(*)` under this key. */
  items?: PurchaseItemRow[] | null;
}

interface ShopSettingsRow {
  shop_id: string;
  shop_name: string | null;
  branch_name: string | null;
  owner_name: string | null;
  phone: string | null;
  address: string | null;
  currency: string | null;
  tax_rate: number | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  sound_effects: boolean | null;
  auto_print: boolean | null;
}

/** Narrow projection read by the pre-sale price lookup. */
interface SellingPriceRow {
  id: string;
  name: string;
  selling_price: number;
}

const str = (v: unknown, fallback = ''): string =>
  v === null || v === undefined ? fallback : String(v);

const num = (v: unknown, fallback = 0): number => {
  if (v === null || v === undefined || v === '') return fallback;
  const parsed = Number(v);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const iso = (v: unknown): string => str(v, new Date().toISOString());

/** Empty / null text columns become undefined so the UI never renders "null". */
const opt = (v: unknown): string | undefined => {
  const s = str(v).trim();
  return s === '' ? undefined : s;
};

interface ApiError {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
}

const FALLBACK = 'تعذر حفظ البيانات على السحابة. تحقق من الاتصال ثم أعد المحاولة.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_RE.test(value.trim());

/**
 * The local store (and the demo seed) uses readable ids like `cat-1` / `prod-3`
 * while every cloud column is a UUID. Postgres answers
 * `invalid input syntax for type uuid: "cat-1"` for those, so they are caught
 * here instead of at the database.
 */
function asUuidOrNull(value: unknown): string | null {
  return isUuid(value) ? value.trim().toLowerCase() : null;
}

function requireUuid(value: unknown, message: string): string {
  if (!isUuid(value)) throw new Error(message);
  return value.trim().toLowerCase();
}

const STALE_PRODUCT_ID =
  'هذا المنتج غير محمّل من السحابة (معرّف غير صالح). أعد تحميل المخزون ثم أعد المحاولة.';
const STALE_CUSTOMER_ID =
  'هذا العميل غير محمّل من السحابة (معرّف غير صالح). أعد تحميل قائمة العملاء ثم أعد المحاولة.';

/** Translate PostgREST / PLpgSQL errors into Arabic the cashier can act on. */
export function cloudError(error: ApiError | null | undefined, fallback: string = FALLBACK): Error {
  const raw = str(error?.message, fallback);
  const low = raw.toLowerCase();

  if (low.includes('insufficient stock')) {
    const match = raw.match(/Available:\s*([\d.]+)/i);
    return new Error(
      match
        ? `الكمية غير متوفرة بالمخزون حسب بيانات الخادم (المتاح: ${match[1]}).`
        : 'الكمية غير متوفرة بالمخزون حسب بيانات الخادم.'
    );
  }
  if (low.includes('row-level security') || low.includes('unauthorized shop access')) {
    return new Error('لا تملك صلاحية الوصول لبيانات هذا المتجر. أعد تسجيل الدخول ثم حاول مجدداً.');
  }
  if (low.includes('duplicate key') && low.includes('barcode')) {
    return new Error('هذا الباركود مستخدم بالفعل لمنتج آخر في متجرك.');
  }
  if (low.includes('duplicate key')) {
    return new Error('هذا السجل موجود مسبقاً، لا يمكن التكرار.');
  }
  if (low.includes('foreign key')) {
    return new Error('لا يمكن حذف هذا السجل لأنه مرتبط بفواتير أو حركة مخزون سابقة.');
  }
  if (low.includes('payment amount exceeds')) {
    return new Error('مبلغ السداد أكبر من رصيد الدين الحالي في السحابة.');
  }
  if (low.includes('customer not found')) {
    return new Error('العميل غير موجود في قاعدة بيانات السحابة. أعد تحميل قائمة العملاء.');
  }
  if (low.includes('customer is required for debt sales')) {
    return new Error('البيع الآجل يتطلب تحديد عميل مسجل في السحابة.');
  }
  if (low.includes('not found') && low.includes('product')) {
    return new Error('أحد منتجات الفاتورة لم يعد موجوداً في السحابة. أعد تحميل المخزون.');
  }
  if (low.includes('failed to fetch') || low.includes('networkerror') || low.includes('fetch failure')) {
    return new Error('تعذر الاتصال بخادم Supabase. تحقق من الاتصال بالإنترنت أو من VITE_SUPABASE_URL.');
  }
  return new Error(raw);
}

/** Await a PostgREST builder and throw the Arabic-mapped error on failure. */
async function unwrap<T>(
  builder: PromiseLike<{ data: T | null; error: ApiError | null }>,
  fallback: string = FALLBACK
): Promise<T> {
  const { data, error } = await builder;
  if (error) throw cloudError(error, fallback);
  if (data === null || data === undefined) throw new Error(fallback);
  return data;
}


// ---------------------------------------------------------------------------
// Row mappers (snake_case row -> app type)
// ---------------------------------------------------------------------------

export function mapProduct(r: ProductRow): Product {
  return {
    id: str(r.id),
    name: str(r.name),
    barcode: str(r.barcode),
    category_id: str(r.category_id),
    purchase_price: num(r.purchase_price),
    selling_price: num(r.selling_price),
    average_cost: num(r.average_cost),
    stock_quantity: num(r.stock_quantity),
    minimum_stock: num(r.minimum_stock),
    unit: str(r.unit, 'حبة'),
    shelf_location: opt(r.shelf_location),
    image_url: opt(r.image_url),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function mapCategory(r: CategoryRow): Category {
  return {
    id: str(r.id),
    name: str(r.name),
    icon: str(r.icon, 'category'),
    color: opt(r.color),
  };
}

export function mapCustomer(r: CustomerRow): Customer {
  return {
    id: str(r.id),
    name: str(r.name),
    phone: str(r.phone),
    balance: num(r.balance),
    credit_limit: num(r.credit_limit),
    notes: opt(r.notes),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function mapExpense(r: ExpenseRow): Expense {
  return {
    id: str(r.id),
    title: str(r.title),
    amount: num(r.amount),
    category: str(r.category, 'أخرى'),
    note: opt(r.note),
    created_at: iso(r.created_at),
  };
}

export function mapPayment(r: CustomerPaymentRow): CustomerPayment {
  return {
    id: str(r.id),
    customer_id: str(r.customer_id),
    customer_name: opt(r.customer_name),
    amount: num(r.amount),
    previous_balance: num(r.previous_balance),
    new_balance: num(r.new_balance),
    note: opt(r.note),
    created_at: iso(r.created_at),
  };
}

export function mapMovement(r: StockMovementRow): StockMovement {
  return {
    id: str(r.id),
    product_id: str(r.product_id),
    product_name: str(r.product_name),
    type: str(r.type, 'adjustment') as StockMovementType,
    quantity: num(r.quantity),
    remaining_stock: num(r.remaining_stock),
    reference_id: opt(r.reference_id),
    note: opt(r.note),
    created_at: iso(r.created_at),
  };
}

export function mapSaleItem(r: SaleItemRow): SaleItem {
  return {
    id: str(r.id),
    sale_id: str(r.sale_id),
    product_id: str(r.product_id),
    product_name: str(r.product_name),
    barcode: opt(r.barcode),
    quantity: num(r.quantity),
    unit_price: num(r.unit_price),
    unit_cost: num(r.unit_cost),
    total_price: num(r.total_price),
    total_cost: num(r.total_cost),
    profit: num(r.profit),
  };
}

export function mapSale(r: SaleRow, customerNames?: Map<string, string>): Sale {
  const customerId = opt(r.customer_id);
  const knownName = customerId ? customerNames?.get(customerId) : undefined;
  return {
    id: str(r.id),
    invoice_no: str(r.invoice_no),
    total_amount: num(r.total_amount),
    total_cost: num(r.total_cost),
    profit: num(r.profit),
    payment_method: str(r.payment_method, 'cash') as 'cash' | 'debt',
    customer_id: customerId ?? null,
    customer_name: opt(r.customer_name) ?? knownName ?? (customerId ? '' : 'عميل نقدي عام'),
    received_amount:
      r.received_amount === null || r.received_amount === undefined
        ? undefined
        : num(r.received_amount),
    change_amount: Math.max(0, num(r.change_amount)),
    items_count: num(r.items_count),
    notes: opt(r.notes),
    created_at: iso(r.created_at),
    items: Array.isArray(r.items) ? r.items.map(mapSaleItem) : [],
  };
}

export function mapPurchaseItem(r: PurchaseItemRow): PurchaseItem {
  return {
    id: str(r.id),
    purchase_id: str(r.purchase_id),
    product_id: str(r.product_id),
    product_name: str(r.product_name),
    quantity: num(r.quantity),
    unit_cost: num(r.unit_cost),
    total_cost: num(r.total_cost),
  };
}

export function mapPurchase(r: PurchaseRow): Purchase {
  return {
    id: str(r.id),
    invoice_no: str(r.invoice_no),
    supplier_name: str(r.supplier_name, 'مورّد عام'),
    total_amount: num(r.total_amount),
    items_count: num(r.items_count),
    notes: opt(r.notes),
    created_at: iso(r.created_at),
    items: Array.isArray(r.items) ? r.items.map(mapPurchaseItem) : [],
  };
}


// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Migration 0002_soft_delete_products.sql adds `products.is_active`. It is
 * deliberately optional: a shop that has not applied it yet keeps working, we
 * just fall back to hard deletes. The probe asks Postgres directly (a missing
 * column answers with SQLSTATE 42703) so no extra bookkeeping is needed.
 */
let softDeleteSupported: boolean | null = null;

export async function probeSoftDelete(): Promise<boolean> {
  const { error } = await db().from('products').select('id, is_active').limit(1);
  softDeleteSupported = !error;
  return softDeleteSupported;
}

export function supportsSoftDelete(): boolean {
  return softDeleteSupported === true;
}

/**
 * Archived products (products.is_active = false, migration 0002) are hidden
 * from product reads.
 *
 * This is applied inline at each call site rather than in a shared helper: a
 * generic helper constrained on a PostgREST query builder makes TypeScript
 * instantiate the builder's own deeply-parameterised generics and bail out with
 * TS2589. Inline, the local keeps its concrete inferred type, so `.order()` and
 * `.in()` still resolve and the query stays fully typed.
 */

export interface CloudSnapshot {
  products: Product[];
  categories: Category[];
  customers: Customer[];
  sales: Sale[];
  purchases: Purchase[];
  expenses: Expense[];
  customerPayments: CustomerPayment[];
  stockMovements: StockMovement[];
  settings: Settings;
}

export async function fetchProducts(shopId: string): Promise<Product[]> {
  let q = db().from('products').select('*').eq('shop_id', shopId);
  if (softDeleteSupported) q = q.eq('is_active', true);

  const rows = await unwrap<ProductRow[]>(q.order('name', {
      ascending: true,
    }),
    'تعذر قراءة المنتجات من السحابة.'
  );
  return rows.map(mapProduct);
}

export async function fetchCategories(shopId: string): Promise<Category[]> {
  const rows = await unwrap<CategoryRow[]>(
    db().from('categories').select('*').eq('shop_id', shopId).order('name', { ascending: true }),
    'تعذر تحميل الأصناف من السحابة.'
  );
  return rows.map(mapCategory);
}

export async function fetchCustomers(shopId: string): Promise<Customer[]> {
  const rows = await unwrap<CustomerRow[]>(
    db().from('customers').select('*').eq('shop_id', shopId).order('name', { ascending: true }),
    'تعذر تحميل العملاء من السحابة.'
  );
  return rows.map(mapCustomer);
}

export async function fetchExpenses(shopId: string): Promise<Expense[]> {
  const rows = await unwrap<ExpenseRow[]>(
    db().from('expenses').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
    'تعذر تحميل المصروفات من السحابة.'
  );
  return rows.map(mapExpense);
}

export async function fetchCustomerPayments(shopId: string, limit = 500): Promise<CustomerPayment[]> {
  const rows = await unwrap<CustomerPaymentRow[]>(
    db().from('customer_payments')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'تعذر تحميل سدادات الديون من السحابة.'
  );
  return rows.map(mapPayment);
}

export async function fetchStockMovements(shopId: string, limit = 800): Promise<StockMovement[]> {
  const rows = await unwrap<StockMovementRow[]>(
    db().from('stock_movements')
      .select('*')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'تعذر تحميل حركة المخزون من السحابة.'
  );
  return rows.map(mapMovement);
}

export async function fetchSales(shopId: string, limit = 400): Promise<Sale[]> {
  const rows = await unwrap<SaleRow[]>(
    db().from('sales')
      .select('*, items:sale_items(*)')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'تعذر تحميل الفواتير من السحابة.'
  );
  return rows.map((r) => mapSale(r));
}

export async function fetchPurchases(shopId: string, limit = 200): Promise<Purchase[]> {
  const rows = await unwrap<PurchaseRow[]>(
    db().from('purchases')
      .select('*, items:purchase_items(*)')
      .eq('shop_id', shopId)
      .order('created_at', { ascending: false })
      .limit(limit),
    'تعذر تحميل عمليات الشراء من السحابة.'
  );
  return rows.map(mapPurchase);
}


/** shop_settings is created lazily: the signup trigger does not insert it. */
export function mapSettings(row: ShopSettingsRow | null | undefined, fallback: Settings): Settings {
  if (!row) return { ...fallback };
  const flag = (value: unknown, dflt: boolean) =>
    value === null || value === undefined ? dflt : Boolean(value);
  return {
    shop_name: str(row.shop_name, fallback.shop_name),
    branch_name: str(row.branch_name, fallback.branch_name),
    owner_name: str(row.owner_name, fallback.owner_name),
    phone: str(row.phone, fallback.phone),
    address: str(row.address, fallback.address),
    currency: str(row.currency, fallback.currency),
    tax_rate: num(row.tax_rate, fallback.tax_rate),
    receipt_header: str(row.receipt_header, fallback.receipt_header),
    receipt_footer: str(row.receipt_footer, fallback.receipt_footer),
    sound_effects: flag(row.sound_effects, fallback.sound_effects),
    auto_print: flag(row.auto_print, fallback.auto_print),
  };
}

export async function fetchSettings(shopId: string, fallback: Settings): Promise<Settings> {
  const { data, error } = await db().from('shop_settings')
    .select('*')
    .eq('shop_id', shopId)
    .maybeSingle();
  if (error) throw cloudError(error, 'تعذر تحميل إعدادات المتجر من السحابة.');
  return mapSettings(data as ShopSettingsRow | null, fallback);
}

/** One-shot bootstrap pull, executed once right after sign-in. */
export async function fetchSnapshot(shopId: string, fallbackSettings: Settings): Promise<CloudSnapshot> {
  const [products, categories, customers, sales, purchases, expenses, customerPayments, stockMovements, settings] =
    await Promise.all([
      fetchProducts(shopId),
      fetchCategories(shopId),
      fetchCustomers(shopId),
      fetchSales(shopId),
      fetchPurchases(shopId),
      fetchExpenses(shopId),
      fetchCustomerPayments(shopId),
      fetchStockMovements(shopId),
      fetchSettings(shopId, fallbackSettings),
    ]);

  return { products, categories, customers, sales, purchases, expenses, customerPayments, stockMovements, settings };
}

/**
 * Row ceiling for a backup export.
 *
 * The interactive reads cap history (400 sales, 200 purchases, 500 payments,
 * 800 movements) to keep the POS responsive. That cap must never apply to a
 * backup: at roughly 30 sales a day, 400 sales is about a fortnight, after which
 * a downloaded "complete" backup would silently stop containing the shop's
 * history. A backup that quietly truncates is worse than none, because the owner
 * trusts it.
 *
 * If a table ever reaches this ceiling the export reports it, so a truncated
 * backup is visible rather than assumed complete.
 */
export const BACKUP_ROW_LIMIT = 50_000;

/** Per-table row counts, so the export can state exactly what it captured. */
export interface BackupRowCounts {
  products: number;
  sales: number;
  purchases: number;
  customers: number;
  customerPayments: number;
  stockMovements: number;
  expenses: number;
}

/** True when any table hit the ceiling, i.e. the backup may be incomplete. */
export function isBackupTruncated(counts: BackupRowCounts): boolean {
  return (
    counts.sales >= BACKUP_ROW_LIMIT ||
    counts.purchases >= BACKUP_ROW_LIMIT ||
    counts.customerPayments >= BACKUP_ROW_LIMIT ||
    counts.stockMovements >= BACKUP_ROW_LIMIT
  );
}

/**
 * Full-fidelity pull for a backup export: same shape as fetchSnapshot but with
 * the history caps lifted.
 */
export async function fetchFullSnapshot(
  shopId: string,
  fallbackSettings: Settings
): Promise<CloudSnapshot> {
  const [products, categories, customers, sales, purchases, expenses, customerPayments, stockMovements, settings] =
    await Promise.all([
      fetchProducts(shopId),
      fetchCategories(shopId),
      fetchCustomers(shopId),
      fetchSales(shopId, BACKUP_ROW_LIMIT),
      fetchPurchases(shopId, BACKUP_ROW_LIMIT),
      fetchExpenses(shopId),
      fetchCustomerPayments(shopId, BACKUP_ROW_LIMIT),
      fetchStockMovements(shopId, BACKUP_ROW_LIMIT),
      fetchSettings(shopId, fallbackSettings),
    ]);

  return { products, categories, customers, sales, purchases, expenses, customerPayments, stockMovements, settings };
}


// ---------------------------------------------------------------------------
// Mutations — master data (RLS-scoped direct writes)
// ---------------------------------------------------------------------------

export type ProductCreateInput = Omit<Product, 'id' | 'created_at' | 'updated_at'>;
export type ProductPatchInput = Partial<Product>;

export interface CustomerCreateInput {
  name: string;
  phone?: string;
  credit_limit?: number;
  initial_balance?: number;
  notes?: string;
}

interface MovementInput {
  shopId: string;
  productId: string;
  productName: string;
  type: StockMovementType;
  quantity: number;
  remainingStock: number;
  referenceId?: string | null;
  note?: string;
}

export async function createProduct(shopId: string, data: ProductCreateInput): Promise<Product> {
  // rpc_create_product writes the product row and its opening-stock movement in
  // one transaction (migration 0004). The previous two-statement version could
  // commit the product and then fail on the movement, leaving stock with no
  // ledger entry - and it reported that failure to the cashier as if the whole
  // save had failed.
  const { data: row, error } = await db().rpc('rpc_create_product', {
    p_shop_id: shopId,
    p_name: str(data.name),
    p_barcode: str(data.barcode),
    p_category_id: asUuidOrNull(data.category_id),
    p_purchase_price: num(data.purchase_price),
    p_selling_price: num(data.selling_price),
    p_average_cost: num(data.average_cost) || num(data.purchase_price),
    p_stock_quantity: num(data.stock_quantity),
    p_minimum_stock: num(data.minimum_stock),
    p_unit: str(data.unit, 'حبة'),
    p_shelf_location: str(data.shelf_location),
    p_image_url: str(data.image_url),
    p_note: 'رصيد افتتاحي عند تسجيل المنتج',
  });

  if (error) throw cloudError(error, 'تعذر حفظ المنتج في السحابة.');
  if (!row) throw new Error('تعذر حفظ المنتج في السحابة.');

  return mapProduct(row);
}

export async function updateProduct(
  shopId: string,
  productId: string,
  updates: ProductPatchInput,
  previousStock: number
): Promise<Product> {
  // rpc_update_product applies the sparse patch and writes the adjustment
  // movement in one transaction (migration 0004). It reads the previous stock
  // from the locked row itself, so `previousStock` is only a hint and is no
  // longer required to be accurate.
  //
  // average_cost is stripped here as well as in SQL: it is owned by
  // rpc_execute_purchase, and the inventory edit form must not be able to
  // overwrite the basis for every future sale's profit.
  const patch: Record<string, unknown> = {};

  if (updates.name !== undefined) patch.name = str(updates.name);
  if (updates.barcode !== undefined) patch.barcode = str(updates.barcode);
  if (updates.category_id !== undefined) patch.category_id = asUuidOrNull(updates.category_id);
  if (updates.purchase_price !== undefined) patch.purchase_price = num(updates.purchase_price);
  if (updates.selling_price !== undefined) patch.selling_price = num(updates.selling_price);
  if (updates.minimum_stock !== undefined) patch.minimum_stock = num(updates.minimum_stock);
  if (updates.unit !== undefined) patch.unit = str(updates.unit, 'حبة');
  if (updates.shelf_location !== undefined) patch.shelf_location = str(updates.shelf_location);
  if (updates.image_url !== undefined) patch.image_url = str(updates.image_url);
  if (updates.stock_quantity !== undefined) {
    patch.stock_quantity = Math.max(0, num(updates.stock_quantity));
  }

  const { data: row, error } = await db().rpc('rpc_update_product', {
    p_shop_id: shopId,
    p_product_id: requireUuid(productId, STALE_PRODUCT_ID),
    p_previous_stock: num(previousStock),
    p_updates: patch,
    p_note: 'تعديل يدوي للمخزون / جرد فعلي',
  });

  if (error) throw cloudError(error, 'تعذر تحديث المنتج في السحابة.');
  if (!row) throw new Error('تعذر تحديث المنتج في السحابة.');

  return mapProduct(row);
}

export async function deleteProduct(shopId: string, productId: string): Promise<void> {
  // With `is_active` available the row is archived so past invoices and stock
  // movements keep pointing at it; otherwise we hard delete and let Postgres
  // refuse when history exists (the UI shows a clear Arabic message then).
  if (softDeleteSupported) {
    await unwrap<ProductRow[]>(
      db().from('products')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('shop_id', shopId)
        .eq('id', requireUuid(productId, STALE_PRODUCT_ID))
        .select('id'),
      'تعذر أرشفة المنتج في السحابة.'
    );
    return;
  }

  await unwrap<ProductRow[]>(
    db()
      .from('products')
      .delete()
      .eq('shop_id', shopId)
      .eq('id', requireUuid(productId, STALE_PRODUCT_ID))
      .select('id'),
    'تعذر حذف المنتج من السحابة.'
  );
}

export async function createCustomer(shopId: string, data: CustomerCreateInput): Promise<Customer> {
  const payload = {
    shop_id: shopId,
    name: str(data.name).trim(),
    phone: str(data.phone).trim() || null,
    balance: Math.max(0, num(data.initial_balance)),
    credit_limit: data.credit_limit === undefined ? 200 : num(data.credit_limit),
    notes: str(data.notes).trim() || null,
  };

  const row = await unwrap<CustomerRow>(
    db().from('customers').insert(payload).select('*').single(),
    'تعذر حفظ العميل في السحابة.'
  );
  return mapCustomer(row);
}

export async function createExpense(
  shopId: string,
  data: { title: string; amount: number; category: string; note?: string }
): Promise<Expense> {
  const payload = {
    shop_id: shopId,
    title: str(data.title).trim(),
    amount: num(data.amount),
    category: str(data.category, 'أخرى').trim() || 'أخرى',
    note: str(data.note).trim() || null,
  };

  const row = await unwrap<ExpenseRow>(
    db().from('expenses').insert(payload).select('*').single(),
    'تعذر حفظ المصروف في السحابة.'
  );
  return mapExpense(row);
}

export async function deleteExpense(shopId: string, expenseId: string): Promise<void> {
  await unwrap<Pick<ExpenseRow, 'id'>[]>(
    db().from('expenses').delete().eq('shop_id', shopId).eq('id', expenseId).select('id'),
    'تعذر حذف المصروف من السحابة.'
  );
}

export async function upsertSettings(shopId: string, settings: Settings): Promise<Settings> {
  const payload = {
    shop_id: shopId,
    shop_name: settings.shop_name,
    branch_name: settings.branch_name,
    owner_name: settings.owner_name,
    phone: settings.phone,
    address: settings.address,
    currency: settings.currency,
    tax_rate: num(settings.tax_rate),
    receipt_header: settings.receipt_header,
    receipt_footer: settings.receipt_footer,
    sound_effects: Boolean(settings.sound_effects),
    auto_print: Boolean(settings.auto_print),
  };

  const row = await unwrap<ShopSettingsRow>(
    db().from('shop_settings').upsert(payload, { onConflict: 'shop_id' }).select('*').single(),
    'تعذر حفظ إعدادات المتجر في السحابة.'
  );
  return mapSettings(row, settings);
}


// ---------------------------------------------------------------------------
// Transactions — atomic RPC calls (sales / purchases / debt payments)
// ---------------------------------------------------------------------------

export interface CloudSaleInput {
  items: Array<{ productId: string; quantity: number }>;
  paymentMethod: 'cash' | 'debt';
  customerId?: string | null;
  receivedAmount?: number | null;
  notes?: string;
}

export interface CloudPurchaseInput {
  supplierName: string;
  notes?: string;
  items: Array<{ productId: string; quantity: number; unitCost: number }>;
}

export interface CloudPaymentInput {
  customerId: string;
  amount: number;
  note?: string;
}

/** Live selling prices straight from Postgres, so the invoice matches the DB. */
async function loadSellingPrices(shopId: string, productIds: string[]): Promise<Map<string, number>> {
  let q = db().from('products').select('id, name, selling_price').eq('shop_id', shopId);
  if (softDeleteSupported) q = q.eq('is_active', true);

  const rows = await unwrap<SellingPriceRow[]>(
    q.in('id', productIds),
    'تعذر قراءة أسعار المنتجات من السحابة.'
  );
  return new Map(rows.map((r) => [str(r.id), num(r.selling_price)]));
}

export async function executeSale(shopId: string, input: CloudSaleInput): Promise<Sale> {
  if (!input.items.length) throw new Error('سلة البيع فارغة! الرجاء إضافة منتجات أولاً.');

  // Normalise the ids before they reach PostgREST: a stale local id ("prod-3")
  // must fail here with a readable message instead of a uuid cast error inside
  // the .in() filter below.
  const items = input.items.map((item) => ({
    productId: requireUuid(item.productId, STALE_PRODUCT_ID),
    quantity: item.quantity,
  }));

  const ids = Array.from(new Set(items.map((i) => i.productId)));
  const prices = await loadSellingPrices(shopId, ids);
  if (ids.some((id) => !prices.has(id))) {
    throw new Error('أحد منتجات الفاتورة لم يعد موجوداً في السحابة. أعد تحميل المخزون.');
  }

  const p_items = items.map((item) => ({
    product_id: item.productId,
    quantity: item.quantity,
    unit_price: prices.get(item.productId) ?? 0,
  }));

  const debtCustomerId =
    input.paymentMethod === 'debt'
      ? requireUuid(input.customerId, 'يجب اختيار عميل مسجل في السحابة لتسجيل بيع آجل.')
      : null;

  const saleId = await unwrap<string>(
    db().rpc('rpc_execute_sale', {
      p_shop_id: shopId,
      p_customer_id: debtCustomerId,
      p_payment_method: input.paymentMethod,
      p_received_amount: input.receivedAmount ?? null,
      p_notes: input.notes ?? null,
      p_items,
    }),
    'تعذر تسجيل الفاتورة في السحابة.'
  );

  return fetchSaleById(shopId, saleId);
}

export async function executePurchase(shopId: string, input: CloudPurchaseInput): Promise<Purchase> {
  if (!input.items.length) throw new Error('يرجى إضافة صنف واحد على الأقل للمشتريات.');

  const p_items = input.items.map((item) => ({
    product_id: requireUuid(item.productId, STALE_PRODUCT_ID),
    quantity: item.quantity,
    unit_cost: item.unitCost,
  }));

  const purchaseId = await unwrap<string>(
    db().rpc('rpc_execute_purchase', {
      p_shop_id: shopId,
      p_supplier_name: input.supplierName || 'مورّد عام',
      p_notes: input.notes ?? null,
      p_items,
    }),
    'تعذر تسجيل عملية الشراء في السحابة.'
  );

  return fetchPurchaseById(shopId, purchaseId);
}

export interface CloudPaymentResult {
  payment: CustomerPayment;
  customer: Customer;
}

export async function recordCustomerPayment(
  shopId: string,
  input: CloudPaymentInput
): Promise<CloudPaymentResult> {
  const paymentId = await unwrap<string>(
    db().rpc('rpc_execute_customer_payment', {
      p_shop_id: shopId,
      p_customer_id: requireUuid(input.customerId, STALE_CUSTOMER_ID),
      p_amount: input.amount,
      p_note: input.note ?? null,
    }),
    'تعذر تسجيل السداد في السحابة.'
  );

  const [payment, customer] = await Promise.all([
    fetchPaymentById(shopId, paymentId),
    fetchCustomerById(shopId, input.customerId),
  ]);

  return { payment, customer };
}


// ---------------------------------------------------------------------------
// Single-row readers — used right after an RPC returns an id
// ---------------------------------------------------------------------------

export async function fetchSaleById(shopId: string, saleId: string): Promise<Sale> {
  const row = await unwrap<SaleRow>(
    db().from('sales').select('*, items:sale_items(*)').eq('shop_id', shopId).eq('id', saleId).single(),
    'تم تسجيل الفاتورة في السحابة لكن تعذر قراءتها.'
  );
  return mapSale(row);
}

export async function fetchPurchaseById(shopId: string, purchaseId: string): Promise<Purchase> {
  const row = await unwrap<PurchaseRow>(
    db().from('purchases')
      .select('*, items:purchase_items(*)')
      .eq('shop_id', shopId)
      .eq('id', purchaseId)
      .single(),
    'تم تسجيل عملية الشراء في السحابة لكن تعذر قراءتها.'
  );
  return mapPurchase(row);
}

export async function fetchCustomerById(shopId: string, customerId: string): Promise<Customer> {
  const row = await unwrap<CustomerRow>(
    db().from('customers').select('*').eq('shop_id', shopId).eq('id', customerId).single(),
    'تعذر تحديث بيانات العميل من السحابة.'
  );
  return mapCustomer(row);
}

export async function fetchPaymentById(shopId: string, paymentId: string): Promise<CustomerPayment> {
  const row = await unwrap<CustomerPaymentRow>(
    db().from('customer_payments').select('*').eq('shop_id', shopId).eq('id', paymentId).single(),
    'تم تسجيل السداد في السحابة لكن تعذر قراءته.'
  );
  return mapPayment(row);
}

// ---------------------------------------------------------------------------
// Post-mutation refresh bundles
// ---------------------------------------------------------------------------
// The database is the source of truth: after a write we pull the affected
// slices back instead of recomputing stock, weighted average cost or balances
// in the browser (which is exactly how a POS drifts out of sync).

async function withCustomerNames(sales: Sale[], customers: Customer[]): Promise<Sale[]> {
  const names = new Map(customers.map((c) => [c.id, c.name]));
  return sales.map((s) => ({
    ...s,
    customer_name: s.customer_name || (s.customer_id ? names.get(s.customer_id) || '' : 'عميل نقدي عام'),
  }));
}

export interface SaleRefresh {
  products: Product[];
  customers: Customer[];
  movements: StockMovement[];
  sales: Sale[];
}

export async function refreshAfterSale(shopId: string): Promise<SaleRefresh> {
  const [products, customers, movements, sales] = await Promise.all([
    fetchProducts(shopId),
    fetchCustomers(shopId),
    fetchStockMovements(shopId),
    fetchSales(shopId),
  ]);
  return { products, customers, movements, sales: await withCustomerNames(sales, customers) };
}

export interface PurchaseRefresh {
  products: Product[];
  movements: StockMovement[];
  purchases: Purchase[];
}

export async function refreshAfterPurchase(shopId: string): Promise<PurchaseRefresh> {
  const [products, movements, purchases] = await Promise.all([
    fetchProducts(shopId),
    fetchStockMovements(shopId),
    fetchPurchases(shopId),
  ]);
  return { products, movements, purchases };
}

export interface PaymentRefresh {
  customers: Customer[];
  payments: CustomerPayment[];
}

export async function refreshAfterPayment(shopId: string): Promise<PaymentRefresh> {
  const [customers, payments] = await Promise.all([
    fetchCustomers(shopId),
    fetchCustomerPayments(shopId),
  ]);
  return { customers, payments };
}

export interface InventoryRefresh {
  products: Product[];
  movements: StockMovement[];
}

export async function refreshInventory(shopId: string): Promise<InventoryRefresh> {
  const [products, movements] = await Promise.all([fetchProducts(shopId), fetchStockMovements(shopId)]);
  return { products, movements };
}
