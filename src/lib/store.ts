/**
 * Mahall POS - Central Persistent Data Store
 * Provides transaction-safe execution of sales, purchases, debt tracking,
 * stock movements, and financial calculations with real local persistence.
 */

import {
  Category,
  Customer,
  CustomerPayment,
  Expense,
  Product,
  Purchase,
  Sale,
  Settings,
  StockMovement,
  UserSession,
} from '../types';
import { calculateAverageCost, roundCurrency, validateStock } from './calculations';

const STORAGE_KEY = 'mahall_pos_database_v1';
const SESSION_KEY = 'mahall_pos_session_v1';

export interface DatabaseState {
  products: Product[];
  categories: Category[];
  sales: Sale[];
  purchases: Purchase[];
  customers: Customer[];
  customerPayments: CustomerPayment[];
  expenses: Expense[];
  stockMovements: StockMovement[];
  settings: Settings;
}

// Initial Seed Data
const defaultCategories: Category[] = [
  { id: 'cat-1', name: 'ألبان وأجبان', icon: 'local_drink', color: '#0284c7' },
  { id: 'cat-2', name: 'معلبات ومؤن', icon: 'set_meal', color: '#d97706' },
  { id: 'cat-3', name: 'مشروبات ومياه', icon: 'water_drop', color: '#06b6d4' },
  { id: 'cat-4', name: 'مخبوزات وحلويات', icon: 'bakery_dining', color: '#eab308' },
  { id: 'cat-5', name: 'حبوب وبقوليات', icon: 'grain', color: '#84cc16' },
  { id: 'cat-6', name: 'زيوت ومأكولات', icon: 'oil_barrel', color: '#f97316' },
  { id: 'cat-7', name: 'منظفات ومستلزمات', icon: 'cleaning_services', color: '#8b5cf6' },
  { id: 'cat-8', name: 'عام / خضار وفواكه', icon: 'scale', color: '#10b981' },
];

const defaultProducts: Product[] = [
  {
    id: 'prod-1',
    name: 'حليب المراعي كامل الدسم 1 لتر',
    barcode: '628100701234',
    category_id: 'cat-1',
    purchase_price: 2.80,
    selling_price: 3.50,
    average_cost: 2.80,
    stock_quantity: 28,
    minimum_stock: 10,
    unit: 'حبة',
    shelf_location: 'الممر 2 - ثلاجة الألبان (رف A3)',
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-2',
    name: 'تونة ريو ماري خفيفة 160 جم',
    barcode: '800403001201',
    category_id: 'cat-2',
    purchase_price: 4.10,
    selling_price: 5.00,
    average_cost: 4.10,
    stock_quantity: 15,
    minimum_stock: 8,
    unit: 'علبة',
    shelf_location: 'الممر 1 - رف المعلبات (C1)',
    created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-3',
    name: 'أرز الشعلان بسمتي 5 كجم',
    barcode: '628100987654',
    category_id: 'cat-5',
    purchase_price: 32.00,
    selling_price: 38.00,
    average_cost: 32.00,
    stock_quantity: 2, // Low stock!
    minimum_stock: 5,
    unit: 'كيس',
    shelf_location: 'الممر 3 - قسم الحبوب الأساسية',
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-4',
    name: 'زيت عافية ذرة 1.8 لتر',
    barcode: '628100112233',
    category_id: 'cat-6',
    purchase_price: 15.50,
    selling_price: 19.00,
    average_cost: 15.50,
    stock_quantity: 1, // Critical stock!
    minimum_stock: 6,
    unit: 'علبة',
    shelf_location: 'الممر 2 - رف الزيوت والطبخ',
    created_at: new Date(Date.now() - 15 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-5',
    name: 'مياه أروى 500 مل',
    barcode: '628100445566',
    category_id: 'cat-3',
    purchase_price: 0.50,
    selling_price: 0.75,
    average_cost: 0.50,
    stock_quantity: 56,
    minimum_stock: 24,
    unit: 'حبة',
    shelf_location: 'الممر 4 - ثلاجة المشروبات الغازية والمياه',
    created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-6',
    name: 'خبز طازج (ربطة 5 أرغفة)',
    barcode: '000000001001',
    category_id: 'cat-4',
    purchase_price: 0.70,
    selling_price: 1.00,
    average_cost: 0.70,
    stock_quantity: 38,
    minimum_stock: 15,
    unit: 'ربطة',
    shelf_location: 'ستاند المخبوزات اليومية',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-7',
    name: 'سكر الأسرة ناعم 1 كجم',
    barcode: '628100554411',
    category_id: 'cat-5',
    purchase_price: 3.40,
    selling_price: 4.25,
    average_cost: 3.40,
    stock_quantity: 30,
    minimum_stock: 10,
    unit: 'كيس',
    shelf_location: 'الممر 3 - التموين الأساسي',
    created_at: new Date(Date.now() - 18 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-8',
    name: 'شاي ليبتون العلامة الصفراء 100 كيس',
    barcode: '871256632400',
    category_id: 'cat-3',
    purchase_price: 6.00,
    selling_price: 7.50,
    average_cost: 6.00,
    stock_quantity: 4, // Low stock!
    minimum_stock: 8,
    unit: 'علبة',
    shelf_location: 'الممر 1 - الشاي والقهوة',
    created_at: new Date(Date.now() - 14 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-9',
    name: 'بيض مائدة طبق 30 بيضة',
    barcode: '000000004500',
    category_id: 'cat-1',
    purchase_price: 11.50,
    selling_price: 14.00,
    average_cost: 11.50,
    stock_quantity: 12,
    minimum_stock: 6,
    unit: 'طبق',
    shelf_location: 'ثلاجة البيض والأجبان',
    created_at: new Date(Date.now() - 5 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-10',
    name: 'حليب نيدو مجفف مدعم 900 جم',
    barcode: '761303598711',
    category_id: 'cat-1',
    purchase_price: 26.00,
    selling_price: 31.00,
    average_cost: 26.00,
    stock_quantity: 3, // Low stock!
    minimum_stock: 8,
    unit: 'علبة',
    shelf_location: 'الممر 2 - حليب الأطفال والمجفف',
    created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-11',
    name: 'جبنة مثلثات المراعي 8 قطع',
    barcode: '628100789012',
    category_id: 'cat-1',
    purchase_price: 2.70,
    selling_price: 3.50,
    average_cost: 2.70,
    stock_quantity: 24,
    minimum_stock: 8,
    unit: 'علبة',
    shelf_location: 'الممر 2 - ثلاجة الأجبان',
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'prod-12',
    name: 'عصير راني برتقال حبيبات 1 لتر',
    barcode: '628100456111',
    category_id: 'cat-3',
    purchase_price: 3.60,
    selling_price: 4.50,
    average_cost: 3.60,
    stock_quantity: 18,
    minimum_stock: 8,
    unit: 'حبة',
    shelf_location: 'الممر 4 - رف العصائر الطازجة',
    created_at: new Date(Date.now() - 8 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const defaultCustomers: Customer[] = [
  {
    id: 'cust-1',
    name: 'أبو سالم (الجار)',
    phone: '091-2345678',
    balance: 45.00,
    credit_limit: 150.00,
    notes: 'الجار المقابل للمحل - يسدد أسبوعياً',
    created_at: new Date(Date.now() - 60 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'cust-2',
    name: 'الحاج مصطفى النجار',
    phone: '092-3456789',
    balance: 120.00,
    credit_limit: 200.00,
    notes: 'صاحب ورشة النجارة المجاورة',
    created_at: new Date(Date.now() - 45 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'cust-3',
    name: 'طارق المهدي (المعلم)',
    phone: '091-9876543',
    balance: 0.00,
    credit_limit: 100.00,
    notes: 'حساب مصفى تماماً',
    created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'cust-4',
    name: 'مكتب الصيانة الحديثة',
    phone: '094-5671234',
    balance: 85.50,
    credit_limit: 300.00,
    notes: 'مكتب الصيانة بالشارع الخلفي',
    created_at: new Date(Date.now() - 20 * 86400000).toISOString(),
    updated_at: new Date().toISOString(),
  },
];

const defaultSales: Sale[] = [
  {
    id: 'sale-10839',
    invoice_no: 'INV-10839',
    total_amount: 9.50,
    total_cost: 6.90,
    profit: 2.60,
    payment_method: 'cash',
    customer_id: null,
    customer_name: 'عميل نقدي عام',
    received_amount: 10.00,
    change_amount: 0.50,
    items_count: 5,
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
    items: [
      {
        id: 'si-1',
        sale_id: 'sale-10839',
        product_id: 'prod-6',
        product_name: 'خبز طازج (ربطة 5 أرغفة)',
        quantity: 4,
        unit_price: 1.00,
        unit_cost: 0.70,
        total_price: 4.00,
        total_cost: 2.80,
        profit: 1.20,
      },
      {
        id: 'si-2',
        sale_id: 'sale-10839',
        product_id: 'prod-11',
        product_name: 'جبنة مثلثات المراعي 8 قطع',
        quantity: 1,
        unit_price: 3.50,
        unit_cost: 2.70,
        total_price: 3.50,
        total_cost: 2.70,
        profit: 0.80,
      },
      {
        id: 'si-3',
        sale_id: 'sale-10839',
        product_id: 'prod-1',
        product_name: 'حليب المراعي كامل الدسم 1 لتر',
        quantity: 2,
        unit_price: 1.00,
        unit_cost: 0.70,
        total_price: 2.00,
        total_cost: 1.40,
        profit: 0.60,
      },
    ],
  },
  {
    id: 'sale-10841',
    invoice_no: 'INV-10841',
    total_amount: 74.00,
    total_cost: 59.50,
    profit: 14.50,
    payment_method: 'debt',
    customer_id: 'cust-1',
    customer_name: 'أبو سالم (الجار)',
    items_count: 3,
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    items: [
      {
        id: 'si-4',
        sale_id: 'sale-10841',
        product_id: 'prod-4',
        product_name: 'زيت عافية ذرة 1.8 لتر',
        quantity: 2,
        unit_price: 19.00,
        unit_cost: 15.50,
        total_price: 38.00,
        total_cost: 31.00,
        profit: 7.00,
      },
      {
        id: 'si-5',
        sale_id: 'sale-10841',
        product_id: 'prod-7',
        product_name: 'سكر الأسرة ناعم 1 كجم',
        quantity: 6,
        unit_price: 4.25,
        unit_cost: 3.40,
        total_price: 25.50,
        total_cost: 20.40,
        profit: 5.10,
      },
      {
        id: 'si-6',
        sale_id: 'sale-10841',
        product_id: 'prod-8',
        product_name: 'شاي ليبتون العلامة الصفراء 100 كيس',
        quantity: 1,
        unit_price: 7.50,
        unit_cost: 6.00,
        total_price: 7.50,
        total_cost: 6.00,
        profit: 1.50,
      },
    ],
  },
  {
    id: 'sale-10842',
    invoice_no: 'INV-10842',
    total_amount: 18.50,
    total_cost: 13.90,
    profit: 4.60,
    payment_method: 'cash',
    customer_id: null,
    customer_name: 'عميل نقدي عام',
    received_amount: 20.00,
    change_amount: 1.50,
    items_count: 3,
    created_at: new Date(Date.now() - 5 * 60000).toISOString(),
    items: [
      {
        id: 'si-7',
        sale_id: 'sale-10842',
        product_id: 'prod-5',
        product_name: 'مياه أروى 500 مل',
        quantity: 4,
        unit_price: 0.75,
        unit_cost: 0.50,
        total_price: 3.00,
        total_cost: 2.00,
        profit: 1.00,
      },
      {
        id: 'si-8',
        sale_id: 'sale-10842',
        product_id: 'prod-2',
        product_name: 'تونة ريو ماري خفيفة 160 جم',
        quantity: 2,
        unit_price: 5.00,
        unit_cost: 4.10,
        total_price: 10.00,
        total_cost: 8.20,
        profit: 1.80,
      },
      {
        id: 'si-9',
        sale_id: 'sale-10842',
        product_id: 'prod-11',
        product_name: 'جبنة مثلثات المراعي 8 قطع',
        quantity: 1,
        unit_price: 3.50,
        unit_cost: 2.70,
        total_price: 3.50,
        total_cost: 2.70,
        profit: 0.80,
      },
    ],
  },
];

const defaultPurchases: Purchase[] = [
  {
    id: 'pur-208',
    invoice_no: 'PUR-208',
    supplier_name: 'شركة المراعي للتوزيع',
    total_amount: 131.80,
    items_count: 2,
    notes: 'توريد ألبان وأجبان أسبوعي',
    created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
    items: [
      {
        id: 'pi-1',
        purchase_id: 'pur-208',
        product_id: 'prod-1',
        product_name: 'حليب المراعي كامل الدسم 1 لتر',
        quantity: 24,
        unit_cost: 2.80,
        total_cost: 67.20,
      },
      {
        id: 'pi-2',
        purchase_id: 'pur-208',
        product_id: 'prod-11',
        product_name: 'جبنة مثلثات المراعي 8 قطع',
        quantity: 24,
        unit_cost: 2.70,
        total_cost: 64.60,
      },
    ],
  },
];

const defaultExpenses: Expense[] = [
  {
    id: 'exp-1',
    title: 'فاتورة كهرباء المحل',
    amount: 65.00,
    category: 'كهرباء',
    note: 'سداد استهلاك شهر مايو',
    created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'exp-2',
    title: 'شراء كراتين وأكياس تعبئة بلاستيكية',
    amount: 25.00,
    category: 'أكياس ومطبوعات',
    note: 'أكياس بقالة حجم كبير',
    created_at: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
  {
    id: 'exp-3',
    title: 'صيانة مكيف صالة البيع',
    amount: 40.00,
    category: 'صيانة',
    note: 'شحن غاز وتنظيف الفلاتر',
    created_at: new Date().toISOString(),
  },
];

const defaultStockMovements: StockMovement[] = [
  {
    id: 'sm-1',
    product_id: 'prod-1',
    product_name: 'حليب المراعي كامل الدسم 1 لتر',
    type: 'purchase',
    quantity: 24,
    remaining_stock: 30,
    reference_id: 'PUR-208',
    note: 'توريد مشتريات فاتورة #208 • شركة المراعي',
    created_at: new Date(Date.now() - 24 * 3600000).toISOString(),
  },
  {
    id: 'sm-2',
    product_id: 'prod-1',
    product_name: 'حليب المراعي كامل الدسم 1 لتر',
    type: 'sale',
    quantity: -2,
    remaining_stock: 28,
    reference_id: 'INV-10839',
    note: 'بيع فاتورة كاشير #10839',
    created_at: new Date(Date.now() - 45 * 60000).toISOString(),
  },
  {
    id: 'sm-3',
    product_id: 'prod-4',
    product_name: 'زيت عافية ذرة 1.8 لتر',
    type: 'sale',
    quantity: -2,
    remaining_stock: 1,
    reference_id: 'INV-10841',
    note: 'بيع فاتورة آجل #10841 • أبو سالم',
    created_at: new Date(Date.now() - 25 * 60000).toISOString(),
  },
];

const defaultSettings: Settings = {
  shop_name: 'بقالة البركة والخير',
  branch_name: 'الفرع الرئيسي',
  owner_name: 'أبو أحمد',
  phone: '091-0000000',
  address: 'طرابلس - شارع الجمهورية الرئيسي',
  currency: 'د.ل',
  tax_rate: 0,
  receipt_header: 'أهلاً وسهلاً بكم في بقالة البركة والخير',
  receipt_footer: 'شكراً لزيارتكم! البضاعة المباعة تستبدل خلال 24 ساعة بموجب الفاتورة',
  sound_effects: true,
  auto_print: false,
};

const defaultSession: UserSession = {
  id: 'usr-1',
  name: 'أبو أحمد',
  email: 'owner@mahallpos.com',
  role: 'owner',
  shift_started_at: new Date(new Date().setHours(7, 0, 0, 0)).toISOString(),
};

/**
 * Storage Manager Class
 */
class StoreManager {
  private state: DatabaseState;
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.state = this.loadInitialState();
  }

  private loadInitialState(): DatabaseState {
    if (typeof window === 'undefined') {
      return this.getDefaultState();
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          products: parsed.products || defaultProducts,
          categories: parsed.categories || defaultCategories,
          sales: parsed.sales || defaultSales,
          purchases: parsed.purchases || defaultPurchases,
          customers: parsed.customers || defaultCustomers,
          customerPayments: parsed.customerPayments || [],
          expenses: parsed.expenses || defaultExpenses,
          stockMovements: parsed.stockMovements || defaultStockMovements,
          settings: { ...defaultSettings, ...(parsed.settings || {}) },
        };
      }
    } catch (e) {
      console.error('Failed to load store from localStorage', e);
    }
    const def = this.getDefaultState();
    this.saveStateToDisk(def);
    return def;
  }

  private getDefaultState(): DatabaseState {
    return {
      products: defaultProducts,
      categories: defaultCategories,
      sales: defaultSales,
      purchases: defaultPurchases,
      customers: defaultCustomers,
      customerPayments: [],
      expenses: defaultExpenses,
      stockMovements: defaultStockMovements,
      settings: defaultSettings,
    };
  }

  private saveStateToDisk(state: DatabaseState) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.error('Failed to persist store', e);
    }
  }

  private notify() {
    this.saveStateToDisk(this.state);
    this.listeners.forEach((listener) => listener());
  }

  public subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getState(): DatabaseState {
    return this.state;
  }

  // --- Auth Session ---
  public getSession(): UserSession | null {
    if (typeof window === 'undefined') return defaultSession;
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : defaultSession;
    } catch {
      return defaultSession;
    }
  }

  public setSession(session: UserSession | null) {
    if (typeof window === 'undefined') return;
    if (session) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } else {
      localStorage.removeItem(SESSION_KEY);
    }
    this.notify();
  }

  // --- Products CRUD ---
  public getProductByBarcode(barcode: string): Product | undefined {
    const trimmed = barcode.trim();
    if (!trimmed) return undefined;
    return this.state.products.find((p) => p.barcode === trimmed);
  }

  public getProductById(id: string): Product | undefined {
    return this.state.products.find((p) => p.id === id);
  }

  public addProduct(productData: Omit<Product, 'id' | 'created_at' | 'updated_at'>): Product {
    // Check barcode uniqueness if provided
    if (productData.barcode?.trim()) {
      const existing = this.getProductByBarcode(productData.barcode);
      if (existing) {
        throw new Error('هذا الباركود مرتبط بمنتج آخر بالفعل.');
      }
    }

    const newProduct: Product = {
      ...productData,
      id: 'prod-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.state.products.push(newProduct);

    // Record initial stock movement if quantity > 0
    if (newProduct.stock_quantity > 0) {
      this.state.stockMovements.unshift({
        id: 'sm-' + Date.now(),
        product_id: newProduct.id,
        product_name: newProduct.name,
        type: 'opening_stock',
        quantity: newProduct.stock_quantity,
        remaining_stock: newProduct.stock_quantity,
        note: 'رصيد افتتاحي عند تسجيل المنتج',
        created_at: new Date().toISOString(),
      });
    }

    this.notify();
    return newProduct;
  }

  public updateProduct(id: string, updates: Partial<Product>): Product {
    const idx = this.state.products.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('المنتج غير موجود');

    // Check barcode conflict
    if (updates.barcode && updates.barcode !== this.state.products[idx].barcode) {
      const conflict = this.getProductByBarcode(updates.barcode);
      if (conflict && conflict.id !== id) {
        throw new Error('هذا الباركود مرتبط بمنتج آخر.');
      }
    }

    const prevStock = this.state.products[idx].stock_quantity;
    const updated = {
      ...this.state.products[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };

    // If stock manually edited
    if (updates.stock_quantity !== undefined && updates.stock_quantity !== prevStock) {
      const diff = updates.stock_quantity - prevStock;
      this.state.stockMovements.unshift({
        id: 'sm-' + Date.now(),
        product_id: id,
        product_name: updated.name,
        type: 'adjustment',
        quantity: diff,
        remaining_stock: updates.stock_quantity,
        note: 'تعديل يدوي للمخزون / جرد فعلي',
        created_at: new Date().toISOString(),
      });
    }

    this.state.products[idx] = updated;
    this.notify();
    return updated;
  }

  public deleteProduct(id: string) {
    this.state.products = this.state.products.filter((p) => p.id !== id);
    this.notify();
  }

  // --- Transaction Safety: Complete Sale Operation ---
  public executeSale(params: {
    items: Array<{ productId: string; quantity: number }>;
    paymentMethod: 'cash' | 'debt';
    customerId?: string | null;
    receivedAmount?: number;
    notes?: string;
  }): Sale {
    if (!params.items || params.items.length === 0) {
      throw new Error('سلة البيع فارغة! الرجاء إضافة منتجات أولاً.');
    }

    // Debt validation
    if (params.paymentMethod === 'debt' && !params.customerId) {
      throw new Error('البيع الآجل يتطلب تحديد عميل. اختر عميلاً أو أضف عميلاً جديداً.');
    }

    let customer: Customer | undefined;
    if (params.customerId) {
      customer = this.state.customers.find((c) => c.id === params.customerId);
      if (!customer) {
        throw new Error('العميل المحدد غير موجود في سجل الديون.');
      }
    }

    // 1. Stock Validation Step
    for (const item of params.items) {
      const product = this.getProductById(item.productId);
      if (!product) {
        throw new Error(`المنتج غير موجود في قاعدة البيانات.`);
      }
      const check = validateStock(item.quantity, product.stock_quantity);
      if (!check.valid) {
        throw new Error(`المنتج "${product.name}": ${check.message}`);
      }
    }

    // 2. Prepare Sale & Freeze unit_cost
    const saleId = 'sale-' + Date.now();
    const invoiceNo = 'INV-' + (10842 + this.state.sales.length + 1);
    const saleItems = [];
    let totalAmount = 0;
    let totalCost = 0;

    for (const item of params.items) {
      const product = this.getProductById(item.productId)!;
      const unitPrice = product.selling_price;
      // CRITICAL PRD RULE: Freeze cost at moment of sale!
      const unitCost = product.average_cost > 0 ? product.average_cost : product.purchase_price;

      const linePrice = roundCurrency(unitPrice * item.quantity);
      const lineCost = roundCurrency(unitCost * item.quantity);
      const lineProfit = roundCurrency(linePrice - lineCost);

      totalAmount += linePrice;
      totalCost += lineCost;

      saleItems.push({
        id: 'si-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        sale_id: saleId,
        product_id: product.id,
        product_name: product.name,
        barcode: product.barcode,
        quantity: item.quantity,
        unit_price: unitPrice,
        unit_cost: unitCost,
        total_price: linePrice,
        total_cost: lineCost,
        profit: lineProfit,
      });

      // Deduct stock
      const newStock = product.stock_quantity - item.quantity;
      product.stock_quantity = newStock;
      product.updated_at = new Date().toISOString();

      // Record stock movement
      this.state.stockMovements.unshift({
        id: 'sm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        product_id: product.id,
        product_name: product.name,
        type: 'sale',
        quantity: -item.quantity,
        remaining_stock: newStock,
        reference_id: invoiceNo,
        note: `بيع فاتورة #${invoiceNo}${customer ? ` • ${customer.name}` : ''}`,
        created_at: new Date().toISOString(),
      });
    }

    totalAmount = roundCurrency(totalAmount);
    totalCost = roundCurrency(totalCost);
    const grossProfit = roundCurrency(totalAmount - totalCost);

    const received = params.receivedAmount ?? totalAmount;
    const change = params.paymentMethod === 'cash' ? Math.max(0, roundCurrency(received - totalAmount)) : 0;

    const newSale: Sale = {
      id: saleId,
      invoice_no: invoiceNo,
      total_amount: totalAmount,
      total_cost: totalCost,
      profit: grossProfit,
      payment_method: params.paymentMethod,
      customer_id: customer ? customer.id : null,
      customer_name: customer ? customer.name : 'عميل نقدي عام',
      received_amount: received,
      change_amount: change,
      items_count: saleItems.reduce((acc, i) => acc + i.quantity, 0),
      notes: params.notes,
      created_at: new Date().toISOString(),
      items: saleItems,
    };

    // 3. Update customer balance if debt
    if (params.paymentMethod === 'debt' && customer) {
      customer.balance = roundCurrency(customer.balance + totalAmount);
      customer.updated_at = new Date().toISOString();
    }

    this.state.sales.unshift(newSale);
    this.notify();
    return newSale;
  }

  // --- Purchases / Restocking ---
  public executePurchase(params: {
    supplierName: string;
    notes?: string;
    items: Array<{ productId: string; quantity: number; unitCost: number }>;
  }): Purchase {
    if (!params.items || params.items.length === 0) {
      throw new Error('يرجى إضافة صنف واحد على الأقل للمشتريات.');
    }

    const purchaseId = 'pur-' + Date.now();
    const invoiceNo = 'PUR-' + (208 + this.state.purchases.length + 1);
    const purchaseItems = [];
    let totalAmount = 0;

    for (const item of params.items) {
      const product = this.getProductById(item.productId);
      if (!product) throw new Error('المنتج المحدد غير موجود.');

      const itemTotal = roundCurrency(item.quantity * item.unitCost);
      totalAmount += itemTotal;

      purchaseItems.push({
        id: 'pi-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        purchase_id: purchaseId,
        product_id: product.id,
        product_name: product.name,
        quantity: item.quantity,
        unit_cost: item.unitCost,
        total_cost: itemTotal,
      });

      // Recalculate Weighted Average Cost
      const newAverageCost = calculateAverageCost(
        product.stock_quantity,
        product.average_cost,
        item.quantity,
        item.unitCost
      );

      // Increase stock
      const newStock = product.stock_quantity + item.quantity;
      product.stock_quantity = newStock;
      product.average_cost = newAverageCost;
      product.purchase_price = item.unitCost;
      product.updated_at = new Date().toISOString();

      // Create stock movement
      this.state.stockMovements.unshift({
        id: 'sm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
        product_id: product.id,
        product_name: product.name,
        type: 'purchase',
        quantity: item.quantity,
        remaining_stock: newStock,
        reference_id: invoiceNo,
        note: `توريد مشتريات #${invoiceNo} • ${params.supplierName}`,
        created_at: new Date().toISOString(),
      });
    }

    const newPurchase: Purchase = {
      id: purchaseId,
      invoice_no: invoiceNo,
      supplier_name: params.supplierName || 'مورّد عام',
      total_amount: roundCurrency(totalAmount),
      items_count: purchaseItems.reduce((acc, i) => acc + i.quantity, 0),
      notes: params.notes,
      created_at: new Date().toISOString(),
      items: purchaseItems,
    };

    this.state.purchases.unshift(newPurchase);
    this.notify();
    return newPurchase;
  }

  // --- Customers & Debt Management ---
  public addCustomer(data: { name: string; phone?: string; credit_limit?: number; initial_balance?: number; notes?: string }): Customer {
    const trimmedName = data.name.trim();
    if (!trimmedName) throw new Error('اسم العميل مطلوب.');

    const newCustomer: Customer = {
      id: 'cust-' + Date.now(),
      name: trimmedName,
      phone: data.phone || '',
      balance: roundCurrency(data.initial_balance || 0),
      credit_limit: data.credit_limit || 200,
      notes: data.notes,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.state.customers.push(newCustomer);
    this.notify();
    return newCustomer;
  }

  public recordDebtPayment(params: { customerId: string; amount: number; note?: string }): CustomerPayment {
    const customer = this.state.customers.find((c) => c.id === params.customerId);
    if (!customer) throw new Error('العميل غير موجود.');

    if (params.amount <= 0) {
      throw new Error('مبلغ السداد يجب أن يكون أكبر من الصفر.');
    }

    const previousBalance = customer.balance;
    const newBalance = roundCurrency(previousBalance - params.amount);

    if (newBalance < 0) {
      throw new Error(`مبلغ السداد (${params.amount} د.ل) أكبر من إجمالي الدين الحالي (${previousBalance} د.ل). لا يمكن أن يصبح الرصيد سالباً.`);
    }

    customer.balance = newBalance;
    customer.updated_at = new Date().toISOString();

    const payment: CustomerPayment = {
      id: 'pay-' + Date.now(),
      customer_id: customer.id,
      customer_name: customer.name,
      amount: roundCurrency(params.amount),
      previous_balance: previousBalance,
      new_balance: newBalance,
      note: params.note,
      created_at: new Date().toISOString(),
    };

    this.state.customerPayments.unshift(payment);
    this.notify();
    return payment;
  }

  // --- Expenses ---
  public addExpense(params: { title: string; amount: number; category: string; note?: string }): Expense {
    if (!params.title.trim()) throw new Error('عنوان المصروف مطلوب.');
    if (params.amount <= 0) throw new Error('المبلغ يجب أن يكون أكبر من الصفر.');

    const expense: Expense = {
      id: 'exp-' + Date.now(),
      title: params.title.trim(),
      amount: roundCurrency(params.amount),
      category: params.category || 'أخرى',
      note: params.note,
      created_at: new Date().toISOString(),
    };

    this.state.expenses.unshift(expense);
    this.notify();
    return expense;
  }

  public deleteExpense(id: string) {
    this.state.expenses = this.state.expenses.filter((e) => e.id !== id);
    this.notify();
  }

  // --- Settings ---
  public updateSettings(settings: Partial<Settings>) {
    this.state.settings = { ...this.state.settings, ...settings };
    this.notify();
  }

  // --- Reset to Demo Data ---
  public resetToDefault() {
    this.state = this.getDefaultState();
    this.notify();
  }
}

export const store = new StoreManager();
