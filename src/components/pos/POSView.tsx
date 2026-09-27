import React, { useEffect, useMemo, useRef, useState } from 'react';
import confetti from 'canvas-confetti';
import { playSound } from '../../lib/audio';
import { calculateCartSummary, formatCurrency, roundCurrency, validateStock } from '../../lib/calculations';
import { useStore } from '../../hooks/useStore';
import { useCart } from '../../hooks/useCart';
import { cartStore } from '../../lib/cartStore';
import { CartQuantityInput } from './CartQuantityInput';
import { Customer, Product, Sale } from '../../types';

interface POSViewProps {
  onOpenScanner: () => void;
  onOpenFastAdd: (barcode: string) => void;
  onSaleCompleted: (sale: Sale) => void;
  scannedBarcodeToProcess: string | null;
  onClearScannedBarcode: () => void;
}

export const POSView: React.FC<POSViewProps> = ({
  onOpenScanner,
  onOpenFastAdd,
  onSaleCompleted,
  scannedBarcodeToProcess,
  onClearScannedBarcode,
}) => {
  const { state, executeSale, addCustomer, addProduct } = useStore();
  const { products, categories, customers, settings, sales } = state;

  // The cart lives in the in-memory cart store so a half-finished sale survives
  // navigating away from the POS screen
  const [cart, setCart] = useCart();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [paymentMode, setPaymentMode] = useState<'cash' | 'debt'>('cash');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [receivedCash, setReceivedCash] = useState<number | ''>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Quick Customer Creation Modal State
  const [showAddCustomerModal, setShowAddCustomerModal] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustLimit, setNewCustLimit] = useState('150');
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);

  // Manual General Item Modal
  const [showManualItemModal, setShowManualItemModal] = useState(false);
  const [manualItemName, setManualItemName] = useState('');
  const [manualItemPrice, setManualItemPrice] = useState('');
  const [manualItemCost, setManualItemCost] = useState('');
  const [manualItemQty, setManualItemQty] = useState('1');
  const [manualItemError, setManualItemError] = useState<string | null>(null);
  const [isAddingManualItem, setIsAddingManualItem] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Synchronous re-entrancy latch for checkout.
  // `isProcessing` is React state, so a second Ctrl+Enter within the same tick
  // would read a stale `false` and fire a second rpc_execute_sale - producing a
  // duplicate invoice, a double stock deduction and a doubled debt balance.
  // The `disabled` prop on the confirm button does not help here because the
  // keyboard shortcut calls handleConfirmSale directly. A ref is written
  // synchronously, so the duplicate is rejected before any request goes out.
  const isSubmittingRef = useRef(false);

  // Cart summary
  const summary = useMemo(() => calculateCartSummary(cart), [cart]);

  // Handle scanned barcode passed from camera
  useEffect(() => {
    if (!scannedBarcodeToProcess) return;

    const matched = products.find((p) => p.barcode === scannedBarcodeToProcess.trim());
    if (matched) {
      addProductToCart(matched);
    } else {
      onOpenFastAdd(scannedBarcodeToProcess);
    }
    onClearScannedBarcode();
  }, [scannedBarcodeToProcess, products]);

  // Update received cash default when grand total changes
  useEffect(() => {
    if (summary.totalAmount > 0 && (receivedCash === '' || receivedCash < summary.totalAmount)) {
      setReceivedCash(summary.totalAmount);
    } else if (summary.totalAmount === 0) {
      setReceivedCash('');
    }
  }, [summary.totalAmount]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchCat = selectedCategory === 'all' || p.category_id === selectedCategory;
      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q));
      return matchCat && matchSearch;
    });
  }, [products, selectedCategory, searchQuery]);

  // Add Product to Cart
  const addProductToCart = (product: Product, quantityToAdd: number = 1) => {
    setErrorMessage(null);

    // Read the live cart from the store rather than the `cart` closure. Two
    // rapid taps on the same tile (the normal scanner-gun speed) both used to
    // read the same stale snapshot, so the second increment overwrote the first
    // and a unit silently vanished from the sale.
    const liveCart = cartStore.getSnapshot();
    const existingIndex = liveCart.findIndex((item) => item.product.id === product.id);
    const currentQtyInCart = existingIndex >= 0 ? liveCart[existingIndex].quantity : 0;
    const targetQty = currentQtyInCart + quantityToAdd;

    // Validate Stock
    const check = validateStock(targetQty, product.stock_quantity);
    if (!check.valid) {
      playSound('warning');
      setErrorMessage(`لا يمكن إضافة "${product.name}": ${check.message}`);
      return;
    }

    playSound('click');

    const unitPrice = product.selling_price;
    const unitCost = product.average_cost > 0 ? product.average_cost : product.purchase_price;

    // Functional update: the new quantity is derived from whatever the store
    // holds at apply time, so concurrent adds accumulate instead of clobbering.
    setCart((prev) => {
      const idx = prev.findIndex((item) => item.product.id === product.id);
      if (idx >= 0) {
        const newQty = prev[idx].quantity + quantityToAdd;
        const updated = [...prev];
        updated[idx] = {
          ...prev[idx],
          quantity: newQty,
          total_price: roundCurrency(newQty * unitPrice),
          total_cost: roundCurrency(newQty * unitCost),
          profit: roundCurrency(newQty * unitPrice - newQty * unitCost),
        };
        return updated;
      }
      return [
        ...prev,
        {
          product,
          quantity: quantityToAdd,
          unit_price: unitPrice,
          unit_cost: unitCost,
          total_price: roundCurrency(quantityToAdd * unitPrice),
          total_cost: roundCurrency(quantityToAdd * unitCost),
          profit: roundCurrency(quantityToAdd * unitPrice - quantityToAdd * unitCost),
        },
      ];
    });
  };

  // Update Cart Quantity
  const updateCartQuantity = (productId: string, delta: number) => {
    setErrorMessage(null);
    // Live snapshot for the guard; the mutation recomputes from the store's
    // current value so two same-tick clicks accumulate instead of both writing
    // the same target quantity.
    const item = cartStore.getSnapshot().find((i) => i.product.id === productId);
    if (!item) return;

    // Validate against the CURRENT catalogue, not the Product snapshot frozen
    // into the cart line when the item was added. Otherwise a restock or a
    // concurrent sale elsewhere in the app is invisible here, and the cashier
    // only discovers it as a server error after pressing confirm.
    const live = products.find((p) => p.id === productId);
    const available = live ? live.stock_quantity : item.product.stock_quantity;

    if (item.quantity + delta <= 0) {
      removeCartItem(productId);
      return;
    }

    const check = validateStock(item.quantity + delta, available);
    if (!check.valid) {
      playSound('warning');
      setErrorMessage(`"${item.product.name}": ${check.message}`);
      return;
    }

    playSound('click');
    setCart((prev) =>
      prev.flatMap((i) => {
        if (i.product.id !== productId) return [i];
        const newQty = i.quantity + delta;
        if (newQty <= 0) return [];
        return [
          {
            ...i,
            quantity: newQty,
            total_price: roundCurrency(newQty * i.unit_price),
            total_cost: roundCurrency(newQty * i.unit_cost),
            profit: roundCurrency(newQty * i.unit_price - newQty * i.unit_cost),
          },
        ];
      })
    );
  };

  /**
   * Commit an absolute quantity for a cart line, from the editable quantity
   * field. Fractional values are allowed so weighed goods ('كجم') can be sold at
   * the precision they were purchased at.
   */
  const setCartQuantity = (productId: string, nextQuantity: number) => {
    setErrorMessage(null);

    // Validate against the live catalogue, not the Product snapshot frozen into
    // the cart line when the item was added.
    const live = products.find((p) => p.id === productId);
    const available = live ? live.stock_quantity : cartStore.getSnapshot().find((i) => i.product.id === productId)?.product.stock_quantity ?? 0;

    const check = validateStock(nextQuantity, available);
    if (!check.valid) {
      playSound('warning');
      // validateStock types `message` as optional even though it is always set
      // on the invalid branch.
      setErrorMessage(check.message ?? 'الكمية المطلوبة غير متوفرة.');
      return;
    }

    setCart((prev) =>
      prev.flatMap((i) => {
        if (i.product.id !== productId) return [i];
        return [
          {
            ...i,
            quantity: nextQuantity,
            total_price: roundCurrency(nextQuantity * i.unit_price),
            total_cost: roundCurrency(nextQuantity * i.unit_cost),
            profit: roundCurrency(nextQuantity * i.unit_price - nextQuantity * i.unit_cost),
          },
        ];
      })
    );
  };

  // Remove Item
  const removeCartItem = (productId: string) => {
    playSound('click');
    setCart((prev) => prev.filter((i) => i.product.id !== productId));
  };

  // Clear Cart
  const handleClearCart = () => {
    if (cart.length === 0) return;
    playSound('click');
    setCart([]);
    setErrorMessage(null);
  };

  // Execute Sale
  const handleConfirmSale = async () => {
    // Guard first: a second submit while the first is still in flight is a
    // no-op. Checked before the validation below so an impatient double-tap on
    // an empty cart still gets the "cart is empty" message rather than silence.
    if (isSubmittingRef.current) return;

    if (cart.length === 0) {
      setErrorMessage('السلة فارغة! الرجاء إضافة منتجات أولاً.');
      playSound('warning');
      return;
    }

    if (paymentMode === 'debt' && !selectedCustomerId) {
      setErrorMessage('البيع الآجل يتطلب تحديد عميل. اختر عميلاً أو أضف عميلاً جديداً.');
      playSound('warning');
      return;
    }

    const received = typeof receivedCash === 'number' ? receivedCash : summary.totalAmount;
    if (paymentMode === 'cash' && received < summary.totalAmount) {
      setErrorMessage('المبلغ المستلم أقل من إجمالي الفاتورة.');
      playSound('warning');
      return;
    }

    // Pre-flight stock sweep against the live catalogue, accumulating per
    // product so two lines of the same item are checked together. Without this
    // the cashier only learns the sale is impossible from the server rejection
    // after pressing confirm. The server remains authoritative - this is purely
    // so the failure arrives in Arabic, before the invoice is attempted.
    const requested = new Map<string, number>();
    for (const line of cart) {
      const product = products.find((p) => p.id === line.product.id);
      if (!product) {
        setErrorMessage(`المنتج "${line.product.name}" لم يعد موجوداً في المخزون.`);
        playSound('warning');
        return;
      }
      const total = (requested.get(product.id) ?? 0) + line.quantity;
      const check = validateStock(total, product.stock_quantity);
      if (!check.valid) {
        setErrorMessage(`"${product.name}": ${check.message}`);
        playSound('warning');
        return;
      }
      requested.set(product.id, total);
    }

    // Latch before the first await so concurrent callers bail out.
    isSubmittingRef.current = true;

    try {
      setIsProcessing(true);
      setErrorMessage(null);

      const sale = await executeSale({
        items: cart.map((i) => ({ productId: i.product.id, quantity: i.quantity })),
        paymentMethod: paymentMode,
        customerId: paymentMode === 'debt' ? selectedCustomerId : null,
        receivedAmount: received,
      });

      // Play success chime & confetti
      playSound('success');
      confetti({
        particleCount: 50,
        spread: 60,
        origin: { y: 0.8 },
      });

      // Reset cart
      setCart([]);
      setReceivedCash('');
      setSelectedCustomerId('');
      setPaymentMode('cash');

      onSaleCompleted(sale);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      playSound('error');
    } finally {
      isSubmittingRef.current = false;
      setIsProcessing(false);
    }
  };

  // Quick Customer Creation
  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) {
      setCustomerError('اسم العميل مطلوب.');
      return;
    }

    setIsCreatingCustomer(true);
    setCustomerError(null);

    try {
      const created = await addCustomer({
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        credit_limit: parseFloat(newCustLimit) || 150,
        initial_balance: 0,
      });
      setSelectedCustomerId(created.id);
      setShowAddCustomerModal(false);
      setNewCustName('');
      setNewCustPhone('');
    } catch (err: unknown) {
      // Surfaced inline rather than with alert(), which cannot be styled and is
      // blocked in some PWA contexts.
      setCustomerError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCreatingCustomer(false);
    }
  };

  // Add Manual Custom Item (Without barcode)
  //
  // Registers a REAL product rather than pushing a virtual object into the
  // cart. The previous version fabricated `id: 'custom-' + Date.now()` and
  // `cost = price * 0.7`, which meant the line could never be checked out in
  // cloud mode (the id is not a uuid, so cloudSync rejected it), and in local
  // mode it booked an invented cost of goods sold. It also claimed
  // `stock_quantity: 9999`, which inflated the dashboard's inventory valuation
  // by 9999x the cost of the item.
  //
  // The PRD supports products without barcodes, so the feature stays - the cost
  // is now typed by the owner, and stock is the real quantity being sold. Once
  // it hits zero the item is restocked through the normal purchase flow.
  const handleAddManualItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const price = parseFloat(manualItemPrice);
    const cost = parseFloat(manualItemCost);
    const qty = parseInt(manualItemQty, 10);

    if (!manualItemName.trim() || isNaN(price) || price <= 0) {
      setManualItemError('يرجى إدخال اسم الصنف وسعر بيع صحيح.');
      return;
    }
    if (isNaN(cost) || cost < 0) {
      setManualItemError('يرجى إدخال سعر تكلفة صحيح.');
      return;
    }
    if (isNaN(qty) || qty <= 0) {
      setManualItemError('يرجى إدخال كمية أكبر من الصفر.');
      return;
    }

    setIsAddingManualItem(true);
    setManualItemError(null);

    try {
      const created = await addProduct({
        name: manualItemName.trim(),
        barcode: '',
        category_id: '',
        purchase_price: cost,
        average_cost: cost,
        selling_price: price,
        stock_quantity: qty,
        minimum_stock: 0,
        unit: 'حبة',
      });

      // Stock was just created for exactly this quantity, so the guard in
      // addProductToCart passes. A stale cached catalogue must not reject it.
      addProductToCart({ ...created, stock_quantity: qty }, qty);

      setShowManualItemModal(false);
      setManualItemName('');
      setManualItemPrice('');
      setManualItemCost('');
      setManualItemQty('1');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setManualItemError(msg);
    } finally {
      setIsAddingManualItem(false);
    }
  };

  // Keyboard Shortcuts Listener (F1, F2, Enter)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        onOpenScanner();
      } else if (e.key === 'F1') {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.altKey && e.key.toLowerCase() === 's') {
        // Alt+S jumps to the search box, as the placeholder advertises
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === 'Enter' && e.ctrlKey) {
        e.preventDefault();
        handleConfirmSale();
      } else if (e.key === 'F7') {
        // Advertised on the "إضافة صنف عام / يدوي" button.
        e.preventDefault();
        setManualItemError(null);
        setShowManualItemModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, paymentMode, selectedCustomerId, receivedCash, summary.totalAmount]);

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const changeAmount =
    paymentMode === 'cash' && typeof receivedCash === 'number'
      ? Math.max(0, Math.round((receivedCash - summary.totalAmount) * 100) / 100)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Top Status & Operational Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 bg-teal-50 text-teal-800 border border-teal-200/80 px-3 py-1.5 rounded-xl text-xs font-bold shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-teal-500 animate-pulse"></span>
            <span>فاتورة جديدة #{10843 + sales.length}</span>
          </div>
          <span className="text-slate-300 hidden sm:inline">•</span>
          <div className="flex items-center gap-1.5 text-slate-600 text-xs font-medium">
            <span className="material-symbols-outlined text-[18px] text-teal-600">schedule</span>
            <span>الوردية: 07:00 ص - مستمرة</span>
          </div>
          <span className="text-slate-300 hidden sm:inline">•</span>
          <div className="flex items-center gap-1.5 text-slate-600 text-xs">
            <span className="material-symbols-outlined text-[18px] text-slate-400">cloud_done</span>
            <span>جاهز للعمل المباشر ودون اتصال</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (sales.length > 0) {
                onSaleCompleted(sales[0]);
              }
            }}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl transition text-xs font-semibold"
            type="button"
            title="إعادة طباعة آخر وصل تم بيعه"
          >
            <span className="material-symbols-outlined text-[16px]">print</span>
            <span>آخر وصل ({sales[0]?.invoice_no || 'لا يوجد'})</span>
          </button>
        </div>
      </div>

      {/* Error / Alert banner */}
      {errorMessage && (
        <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl flex items-center justify-between gap-2 text-rose-800 text-xs font-bold animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-rose-600">error</span>
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={() => setErrorMessage(null)}
            className="p-1 hover:bg-rose-100 rounded-lg text-rose-500"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Main Dual-Zone Grid (Catalog & Cart) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* ZONE 1: Product Catalog & Quick Pick (Desktop: Span 7, Tablet/Mobile: Full) */}
        <section className="lg:col-span-7 flex flex-col gap-4 order-2 lg:order-1">
          {/* Search & Instant Barcode Input Section */}
          <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row gap-2.5 items-stretch">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-slate-400">
                <span className="material-symbols-outlined text-[22px]">search</span>
              </span>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ابحث عن منتج بالاسم أو الباركود... (Alt+S)"
                className="w-full h-12 pr-10 pl-10 bg-slate-50 focus:bg-white text-slate-800 placeholder:text-slate-400 rounded-xl text-sm border border-slate-200/90 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 transition-all shadow-inner"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 hover:text-slate-600"
                >
                  <span className="material-symbols-outlined text-[18px]">cancel</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenScanner}
              className="h-12 px-4 bg-teal-600 text-white hover:bg-teal-700 active:scale-98 transition rounded-xl shadow-sm flex items-center justify-center gap-2 text-sm font-bold whitespace-nowrap"
            >
              <span className="material-symbols-outlined text-[22px] animate-pulse">barcode_scanner</span>
              <span>مسح باركود (F2)</span>
            </button>
          </div>

          {/* Filter Chips: Category Selection */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-nowrap scrollbar-none select-none">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`h-10 px-3.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-2xs ${
                selectedCategory === 'all'
                  ? 'bg-teal-600 text-white shadow-teal-600/20'
                  : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200/70'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">grid_view</span>
              <span>الكل</span>
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                  selectedCategory === 'all' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {products.length}
              </span>
            </button>

            {categories.map((cat) => {
              const isSelected = selectedCategory === cat.id;
              const count = products.filter((p) => p.category_id === cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`h-10 px-3.5 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 shadow-2xs ${
                    isSelected
                      ? 'bg-teal-600 text-white font-bold shadow-teal-600/20'
                      : 'bg-white hover:bg-slate-100 text-slate-600 border border-slate-200/70'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">{cat.icon}</span>
                  <span>{cat.name}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-full text-[10px] ${
                      isSelected ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Touch Product Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.map((product) => {
              const isLow = product.stock_quantity <= product.minimum_stock;
              const isZero = product.stock_quantity <= 0;

              return (
                <div
                  key={product.id}
                  onClick={() => addProductToCart(product)}
                  className={`group cursor-pointer select-none bg-white rounded-2xl p-3 border border-slate-200/80 shadow-2xs hover:shadow-md hover:border-teal-200 transition-all active:scale-[0.98] flex flex-col justify-between min-h-[148px] relative overflow-hidden ${
                    isZero ? 'opacity-60 bg-slate-50' : ''
                  }`}
                >
                  {/* Top Metadata */}
                  <div className="flex items-start justify-between gap-1 text-[11px]">
                    <span
                      className={`px-2 py-0.5 rounded-md font-semibold ${
                        isZero
                          ? 'bg-rose-100 text-rose-800'
                          : isLow
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-50 text-emerald-800'
                      }`}
                    >
                      {isZero ? 'نفد الرصيد' : isLow ? `منخفض (${product.stock_quantity})` : `متوفر ${product.stock_quantity}`}
                    </span>
                    <span className="text-slate-400 truncate max-w-[80px]">
                      {categories.find((c) => c.id === product.category_id)?.name || 'عام'}
                    </span>
                  </div>

                  {/* Product Title & Barcode */}
                  <div className="my-2 flex items-center gap-2">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-teal-600 shrink-0 group-hover:bg-teal-600 group-hover:text-white transition-colors">
                      <span className="material-symbols-outlined text-[20px]">
                        {categories.find((c) => c.id === product.category_id)?.icon || 'inventory_2'}
                      </span>
                    </div>
                    <div className="flex flex-col min-w-0">
                      <span className="font-bold text-slate-800 text-xs sm:text-sm line-clamp-2 leading-tight">
                        {product.name}
                      </span>
                      {product.barcode && (
                        <span className="text-[10px] text-slate-400 font-mono tracking-tight truncate mt-0.5" dir="ltr">
                          {product.barcode}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bottom Price & Add button */}
                  <div className="pt-2 border-t border-slate-100 flex items-baseline justify-between -mx-3 -mb-3 px-3 py-2 bg-slate-50/70 group-hover:bg-teal-50/40 transition-colors">
                    <span className="font-bold text-teal-700 text-sm sm:text-base font-num">
                      {product.selling_price.toFixed(2)}{' '}
                      <span className="text-[11px] font-normal text-slate-500">{settings.currency}</span>
                    </span>
                    <span className="w-7 h-7 rounded-lg bg-teal-600/10 text-teal-700 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </span>
                  </div>
                </div>
              );
            })}

            {filteredProducts.length === 0 && (
              <div className="col-span-full py-12 flex flex-col items-center justify-center text-slate-400 gap-2 bg-white rounded-2xl border border-dashed border-slate-200">
                <span className="material-symbols-outlined text-[44px] text-slate-300">search_off</span>
                <span className="font-bold text-sm text-slate-600">لا توجد منتجات مطابقة للبحث</span>
                <span className="text-xs text-slate-400">تأكد من كتابة الاسم أو رقم الباركود بشكل صحيح</span>
              </div>
            )}
          </div>

          {/* Quick Item Addition Helpers (Fruit Scale & Manual Item) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <button
              type="button"
              onClick={() => setShowManualItemModal(true)}
              className="p-3 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between text-slate-800 transition"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">add_circle</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-xs font-bold">إضافة صنف عام / يدوي (F7)</span>
                  <span className="text-[10px] text-slate-400">تسجيل بيع سلعة سريعة بدون باركود</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-slate-400 text-[18px]">arrow_back</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setManualItemName('خضار وفواكه مشكلة');
                setManualItemPrice('5.00');
                setShowManualItemModal(true);
              }}
              className="p-3 bg-white hover:bg-slate-50 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between text-slate-800 transition"
            >
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">scale</span>
                </div>
                <div className="flex flex-col text-right">
                  <span className="text-xs font-bold">ميزان الخضار والوزن</span>
                  <span className="text-[10px] text-slate-400">إدخال سعر الصنف الموزون يدوياً</span>
                </div>
              </div>
              <span className="material-symbols-outlined text-slate-400 text-[18px]">arrow_back</span>
            </button>
          </div>
        </section>

        {/* ZONE 2: Active Cart & Order Summary Tray (Desktop: Span 5 Sticky, RTL Right) */}
        <section className="lg:col-span-5 flex flex-col gap-4 order-1 lg:order-2 lg:sticky lg:top-20">
          <div className="bg-white rounded-2xl border border-slate-200/90 shadow-md overflow-hidden flex flex-col">
            {/* Cart Header */}
            <div className="p-3.5 bg-slate-50 border-b border-slate-200/80 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-teal-600 text-white flex items-center justify-center shadow-xs">
                  <span className="material-symbols-outlined text-[18px]">shopping_cart</span>
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-slate-800 text-sm">سلة البيع الحالية</span>
                  <span className="text-[11px] text-slate-500 font-num">
                    {summary.distinctProductsCount} أصناف ({summary.totalItemsCount} قطع)
                  </span>
                </div>
              </div>

              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearCart}
                  className="flex items-center gap-1 px-2.5 py-1 text-rose-700 hover:bg-rose-50 border border-rose-200/80 rounded-lg text-xs font-semibold transition"
                >
                  <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                  <span>إفراغ</span>
                </button>
              )}
            </div>

            {/* Customer Assignment Strip */}
            <div className="p-3 bg-slate-100/60 border-b border-slate-200/60 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <span className="material-symbols-outlined text-[18px] text-teal-600">person</span>
                  <span>{selectedCustomer ? selectedCustomer.name : 'عميل نقدي عام'}</span>
                  {selectedCustomer && (
                    <span className="text-[11px] text-rose-600 font-normal">
                      (رصيد سابق: {selectedCustomer.balance.toFixed(2)} {settings.currency})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <select
                    value={selectedCustomerId}
                    onChange={(e) => {
                      setSelectedCustomerId(e.target.value);
                      if (e.target.value) setPaymentMode('debt');
                    }}
                    className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  >
                    <option value="">زبون نقدي عام</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.balance > 0 ? `دين ${c.balance} د.ل` : 'حساب مصفى'})
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setShowAddCustomerModal(true)}
                    className="p-1 text-teal-700 hover:bg-teal-50 border border-teal-200 rounded-lg"
                    title="فتح دفتر ديون لعميل جديد"
                  >
                    <span className="material-symbols-outlined text-[16px]">person_add</span>
                  </button>
                </div>
              </div>

              {/* Advisory only, by design.
                  credit_limit is an app addition, not part of the PRD: section 20
                  defines `customers` as id / name / balance / created_at with no
                  limit at all. Enforcing it in the UI, in store.executeSale and in
                  rpc_execute_sale would risk refusing a sale the owner needs to
                  complete, so the limit only informs the cashier via this badge.

                  If a hard limit is ever wanted it must be enforced in
                  rpc_execute_sale, not here - the browser check is cosmetic and
                  the anon key is public. */}
              {selectedCustomer && (
                <div className="flex items-center justify-between text-[11px] text-slate-500 bg-white px-2.5 py-1.5 rounded-lg border border-slate-200">
                  <span>سقف الدين المسموح: {selectedCustomer.credit_limit} {settings.currency}</span>
                  <span className={selectedCustomer.balance + summary.totalAmount > selectedCustomer.credit_limit ? 'text-rose-600 font-bold' : 'text-emerald-700'}>
                    الدين الجديد: {(selectedCustomer.balance + summary.totalAmount).toFixed(2)} {settings.currency}
                  </span>
                </div>
              )}
            </div>

            {/* Cart Items List */}
            <div className="max-h-[300px] overflow-y-auto p-2 flex flex-col gap-1.5 divide-y divide-slate-100">
              {cart.map((item) => (
                <div
                  key={item.product.id}
                  className="flex items-center justify-between p-2 rounded-xl bg-slate-50/60 hover:bg-slate-100/80 transition-colors"
                >
                  <div className="flex flex-col flex-1 min-w-0 pr-1">
                    <span className="font-bold text-slate-800 text-xs truncate">{item.product.name}</span>
                    <span className="text-[11px] text-slate-400 font-num">
                      {item.unit_price.toFixed(2)} {settings.currency} / {item.product.unit || 'قطعة'}
                    </span>
                  </div>

                  {/* Quantity Stepper (Ergonomic touch targets) */}
                  <div className="flex items-center gap-1 bg-white px-1 py-0.5 rounded-lg border border-slate-200 shadow-2xs mx-2">
                    <button
                      type="button"
                      onClick={() => updateCartQuantity(item.product.id, -1)}
                      className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm transition active:scale-90"
                    >
                      -
                    </button>
                    <CartQuantityInput
                      productId={item.product.id}
                      value={item.quantity}
                      max={products.find((p) => p.id === item.product.id)?.stock_quantity ?? item.product.stock_quantity}
                      onCommit={setCartQuantity}
                      onInvalid={setErrorMessage}
                    />
                    <button
                      type="button"
                      onClick={() => updateCartQuantity(item.product.id, 1)}
                      className="w-7 h-7 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm transition active:scale-90"
                    >
                      +
                    </button>
                  </div>

                  {/* Line Total Price & Delete */}
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-teal-800 text-xs sm:text-sm font-num w-16 text-left" dir="ltr">
                      {item.total_price.toFixed(2)}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeCartItem(item.product.id)}
                      className="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center transition"
                      title="حذف الصنف"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete</span>
                    </button>
                  </div>
                </div>
              ))}

              {cart.length === 0 && (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                  <span className="material-symbols-outlined text-[44px] text-slate-300">shopping_basket</span>
                  <span className="font-bold text-sm text-slate-600">سلة البيع فارغة حالياً</span>
                  <span className="text-xs text-slate-400">قم بمسح الباركود أو الضغط على أي صنف لإضافته</span>
                </div>
              )}
            </div>

            {/* Financial Breakdown & Totals Box */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex flex-col gap-3">
              {/* Grand Total Billboard Box */}
              <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-xs text-slate-400 font-semibold">إجمالي الحساب المطلوب</span>
                  <span className="text-sm font-bold text-slate-800">صافي الفاتورة</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-teal-700 font-num tracking-tight">
                    {summary.totalAmount.toFixed(2)}
                  </span>
                  <span className="text-sm font-bold text-teal-800">{settings.currency}</span>
                </div>
              </div>

              {/* Payment Type Selector (Cash vs Debt/Credit) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentMode('cash')}
                  className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                    paymentMode === 'cash'
                      ? 'bg-teal-600 text-white shadow-sm ring-1 ring-teal-600'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">payments</span>
                  <span>نقدي (Cash)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPaymentMode('debt');
                    // Deliberately does NOT auto-select a customer. It used to
                    // pick customers[0] - an arbitrary row in cache order - which
                    // silently booked the debt against a stranger if the cashier
                    // did not notice. handleConfirmSale already refuses a debt
                    // sale with no customer, so forcing the choice is safe.
                  }}
                  className={`py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                    paymentMode === 'debt'
                      ? 'bg-indigo-700 text-white shadow-sm ring-1 ring-indigo-700'
                      : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="material-symbols-outlined text-[18px]">menu_book</span>
                  <span>آجل / دين (Credit)</span>
                </button>
              </div>

              {/* Cash Tender & Change (Only in Cash Mode) */}
              {paymentMode === 'cash' && summary.totalAmount > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-slate-600">المبلغ المستلم من الزبون:</span>
                  <div className="grid grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setReceivedCash(summary.totalAmount)}
                      className="py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-800 text-center"
                    >
                      مضبوط
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceivedCash(Math.ceil(summary.totalAmount / 10) * 10 || 10)}
                      className="py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-800 text-center font-num"
                    >
                      {Math.ceil(summary.totalAmount / 10) * 10 || 10} {settings.currency}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceivedCash(50)}
                      className="py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-800 text-center font-num"
                    >
                      50 {settings.currency}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceivedCash(100)}
                      className="py-1.5 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg text-xs font-bold text-slate-800 text-center font-num"
                    >
                      100 {settings.currency}
                    </button>
                  </div>

                  {/* Change Return Box */}
                  <div className="p-2.5 rounded-xl bg-teal-50 border border-teal-200 flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1 text-teal-900 font-semibold">
                      <span className="material-symbols-outlined text-[18px] text-teal-600">currency_exchange</span>
                      <span>المتبقي للزبون (الفكة):</span>
                    </span>
                    <span className="font-bold text-teal-800 text-sm font-num" dir="ltr">
                      {changeAmount.toFixed(2)} {settings.currency}
                    </span>
                  </div>
                </div>
              )}

              {/* Primary Checkout Execution Button */}
              <button
                type="button"
                disabled={cart.length === 0 || isProcessing}
                onClick={handleConfirmSale}
                className={`w-full h-14 rounded-2xl shadow-lg font-bold text-base transition-all active:scale-[0.98] flex items-center justify-center gap-2 ${
                  cart.length === 0
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                    : paymentMode === 'cash'
                    ? 'bg-teal-600 hover:bg-teal-700 text-white shadow-teal-600/30'
                    : 'bg-indigo-700 hover:bg-indigo-800 text-white shadow-indigo-700/30'
                }`}
              >
                {isProcessing ? (
                  <>
                    <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                    <span>جارٍ تسجيل البيع...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[24px]">
                      {paymentMode === 'cash' ? 'check_circle' : 'menu_book'}
                    </span>
                    <span>
                      {paymentMode === 'cash'
                        ? 'إتمام البيع وطباعة الفاتورة (Enter)'
                        : 'تسجيل في دفتر الديون للعميل'}
                    </span>
                  </>
                )}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Quick Add Customer Modal */}
      {showAddCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[20px] text-indigo-600">person_add</span>
                <span>فتح دفتر ديون لزبون جديد</span>
              </h3>
              <button
                onClick={() => setShowAddCustomerModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleCreateCustomer} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="f-1" className="text-xs font-bold text-slate-700">الاسم الثلاثي أو اللقب المعروف *</label> id="f-1"
                <input
                  type="text"
                  value={newCustName}
                  onChange={(e) => setNewCustName(e.target.value)}
                  placeholder="مثال: خالد الفرجاني (المقاول)"
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                  autoFocus
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="f-2" className="text-xs font-bold text-slate-700">رقم الهاتف للتواصل</label> id="f-2"
                <input
                  type="text"
                  value={newCustPhone}
                  onChange={(e) => setNewCustPhone(e.target.value)}
                  placeholder="091xxxxxxx"
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  dir="ltr"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="f-3" className="text-xs font-bold text-slate-700">سقف الائتمان المسموح</label> id="f-3"
                <input
                  type="number" step="0.01"
                  value={newCustLimit}
                  onChange={(e) => setNewCustLimit(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left"
                  dir="ltr"
                />
              </div>

              {customerError && (
                <p className="text-xs font-bold text-rose-600 bg-rose-50 rounded-lg px-2.5 py-2">
                  {customerError}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  disabled={isCreatingCustomer}
                  onClick={() => {
                    setShowAddCustomerModal(false);
                    setCustomerError(null);
                  }}
                  className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold disabled:opacity-60"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isCreatingCustomer}
                  className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isCreatingCustomer ? 'جارٍ الحفظ...' : 'حفظ وتحديده'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Quick Item Modal */}
      {showManualItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[20px] text-teal-600">add_circle</span>
                <span>إضافة صنف سريع للسلة</span>
              </h3>
              <button
                onClick={() => setShowManualItemModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddManualItem} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="f-4" className="text-xs font-bold text-slate-700">اسم الصنف أو الوصف *</label> id="f-4"
                <input
                  type="text"
                  value={manualItemName}
                  onChange={(e) => setManualItemName(e.target.value)}
                  placeholder="مثال: بيع خضار متنوع / بند عام"
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                  autoFocus
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
            <label htmlFor="pos-manual-selling" className="text-xs font-bold text-slate-700">سعر البيع *</label>
            <div className="relative">
              <input
                id="pos-manual-selling"
                type="number"
                      step="0.01"
                      min="0.1"
                      value={manualItemPrice}
                      onChange={(e) => setManualItemPrice(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pl-8"
                      dir="ltr"
                      required
                    />
                    <span className="absolute left-2.5 top-2 text-[10px] font-bold text-slate-400">
                      {settings.currency}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-1">
            <label htmlFor="pos-manual-cost" className="text-xs font-bold text-slate-700">سعر التكلفة *</label>
            <div className="relative">
              <input
                id="pos-manual-cost"
                type="number"
                      step="0.01"
                      min="0"
                      value={manualItemCost}
                      onChange={(e) => setManualItemCost(e.target.value)}
                      placeholder="0.00"
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pl-8"
                      dir="ltr"
                      required
                    />
                    <span className="absolute left-2.5 top-2 text-[10px] font-bold text-slate-400">
                      {settings.currency}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor="f-5" className="text-xs font-bold text-slate-700">الكمية *</label> id="f-5"
                <input
                  type="number"
                  // A weighed line may be under 1 (0.5 kg), so the floor matches
                  // the NUMERIC(10,3) quantity columns rather than 1.
                  min="0.001"
                  step="0.001"
                  value={manualItemQty}
                  onChange={(e) => setManualItemQty(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  dir="ltr"
                  required
                />
              </div>

              <p className="text-[10px] text-slate-500 leading-4 bg-slate-50 rounded-lg px-2.5 py-2">
                سيُحفظ الصنف في المخزون باسمه وسعر تكلفته. عند نفاد الكمية يمكنك
                إعادة تعبئته من صفحة المشتريات.
              </p>

              {manualItemError && (
                <p className="text-xs font-bold text-rose-600 bg-rose-50 rounded-lg px-2.5 py-2">
                  {manualItemError}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowManualItemModal(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={isAddingManualItem}
                  className="flex-1 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isAddingManualItem ? 'جارٍ الحفظ...' : 'إضافة للسلة'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
