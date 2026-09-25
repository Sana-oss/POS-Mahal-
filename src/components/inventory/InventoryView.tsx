import React, { useMemo, useState } from 'react';
import { formatArabicDate, formatCurrency } from '../../lib/calculations';
import { useStore } from '../../hooks/useStore';
import { Product } from '../../types';

interface InventoryViewProps {
  onOpenScanner: () => void;
  onOpenAddProduct: () => void;
  onRestockProduct: (product: Product) => void;
}

export const InventoryView: React.FC<InventoryViewProps> = ({
  onOpenScanner,
  onOpenAddProduct,
  onRestockProduct,
}) => {
  const { state, updateProduct, deleteProduct } = useStore();
  const { products, categories, stockMovements, settings } = state;

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'low' | 'out'>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>(products[0]?.id || '');

  // Edit Product Modal State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editName, setEditName] = useState('');
  const [editBarcode, setEditBarcode] = useState('');
  const [editSellingPrice, setEditSellingPrice] = useState('');
  const [editPurchasePrice, setEditPurchasePrice] = useState('');
  const [editStockQuantity, setEditStockQuantity] = useState('');
  const [editMinimumStock, setEditMinimumStock] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editUnit, setEditUnit] = useState('حبة');
  const [editShelf, setEditShelf] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  // Selected product
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || products[0],
    [products, selectedProductId]
  );

  // Calculations for stats
  const totalInventoryValue = useMemo(() => {
    return products.reduce((acc, p) => acc + p.stock_quantity * p.average_cost, 0);
  }, [products]);

  const lowStockCount = useMemo(
    () => products.filter((p) => p.stock_quantity > 0 && p.stock_quantity <= p.minimum_stock).length,
    [products]
  );

  const outOfStockCount = useMemo(
    () => products.filter((p) => p.stock_quantity <= 0).length,
    [products]
  );

  const averageMarginPercent = useMemo(() => {
    if (products.length === 0) return 0;
    const totalMargin = products.reduce((acc, p) => {
      const margin = p.selling_price > 0 ? ((p.selling_price - p.average_cost) / p.selling_price) * 100 : 0;
      return acc + Math.max(0, margin);
    }, 0);
    return Math.round((totalMargin / products.length) * 10) / 10;
  }, [products]);

  // Filtered Products
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // Search
      const q = searchQuery.trim().toLowerCase();
      const matchSearch =
        !q ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.includes(q));

      // Category
      const matchCat = selectedCategory === 'all' || p.category_id === selectedCategory;

      // Status
      let matchStatus = true;
      if (filterMode === 'low') {
        matchStatus = p.stock_quantity > 0 && p.stock_quantity <= p.minimum_stock;
      } else if (filterMode === 'out') {
        matchStatus = p.stock_quantity <= 0;
      }

      return matchSearch && matchCat && matchStatus;
    });
  }, [products, searchQuery, selectedCategory, filterMode]);

  // Stock movements for the selected product
  const productMovements = useMemo(() => {
    if (!selectedProduct) return [];
    return stockMovements.filter((sm) => sm.product_id === selectedProduct.id).slice(0, 5);
  }, [stockMovements, selectedProduct]);

  // Handle opening edit modal
  const handleOpenEdit = (p: Product) => {
    setEditingProduct(p);
    setEditName(p.name);
    setEditBarcode(p.barcode || '');
    setEditSellingPrice(p.selling_price.toString());
    setEditPurchasePrice(p.average_cost.toString());
    setEditStockQuantity(p.stock_quantity.toString());
    setEditMinimumStock(p.minimum_stock.toString());
    setEditCategory(p.category_id);
    setEditUnit(p.unit || 'حبة');
    setEditShelf(p.shelf_location || '');
    setEditError(null);
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;

    try {
      const sPrice = parseFloat(editSellingPrice);
      const pPrice = parseFloat(editPurchasePrice) || editingProduct.average_cost;
      const sQty = parseInt(editStockQuantity) || 0;
      const mStock = parseInt(editMinimumStock) || 0;

      if (!editName.trim()) {
        setEditError('اسم المنتج مطلوب');
        return;
      }
      if (isNaN(sPrice) || sPrice <= 0) {
        setEditError('يرجى إدخال سعر بيع صحيح');
        return;
      }

      updateProduct(editingProduct.id, {
        name: editName.trim(),
        barcode: editBarcode.trim(),
        category_id: editCategory,
        selling_price: sPrice,
        purchase_price: pPrice,
        average_cost: pPrice,
        stock_quantity: sQty,
        minimum_stock: mStock,
        unit: editUnit,
        shelf_location: editShelf,
      });

      setEditingProduct(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setEditError(msg);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`هل أنت متأكد من حذف المنتج "${name}" نهائياً من المخزون؟`)) {
      deleteProduct(id);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Headline & Key Retail Stats Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-teal-50 text-teal-700 border border-teal-100 flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[28px]">inventory_2</span>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900">المخزون والبضاعة</h1>
              <span className="px-2.5 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200 text-xs font-bold font-num">
                {products.length} صنف مسجل
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              متابعة الأرصدة، مستويات إعادة الطلب، وتكلفة ومتوسط هامش الربحية للمتجر
            </p>
          </div>
        </div>

        {/* Action Buttons Group */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onOpenScanner}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs sm:text-sm font-bold transition shadow-2xs active:scale-95"
            type="button"
          >
            <span className="material-symbols-outlined text-[20px] text-teal-600">barcode_scanner</span>
            <span>فحص بالباركود (F2)</span>
          </button>
          <button
            onClick={onOpenAddProduct}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-teal-600 text-white hover:bg-teal-700 rounded-xl text-xs sm:text-sm font-bold transition shadow-md shadow-teal-600/20 active:scale-95"
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">add_circle</span>
            <span>إضافة منتج جديد</span>
          </button>
        </div>
      </div>

      {/* Live KPI Pills Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-semibold">إجمالي القيمة التقديرية</span>
            <span className="text-xl sm:text-2xl font-extrabold text-slate-900 mt-1 font-num">
              {totalInventoryValue.toFixed(0)}{' '}
              <span className="text-xs text-slate-400 font-normal">{settings.currency}</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center text-teal-700">
            <span className="material-symbols-outlined text-[22px]">account_balance_wallet</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-semibold">أصناف وشك النفاد</span>
            <span className="text-xl sm:text-2xl font-extrabold text-amber-600 mt-1 font-num">
              {lowStockCount} <span className="text-xs text-slate-400 font-normal">أصناف</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-700">
            <span className="material-symbols-outlined text-[22px]">warning</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-semibold">مخزون حرج (نفد)</span>
            <span className="text-xl sm:text-2xl font-extrabold text-rose-600 mt-1 font-num">
              {outOfStockCount} <span className="text-xs text-slate-400 font-normal">صنف</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 flex items-center justify-center text-rose-700">
            <span className="material-symbols-outlined text-[22px]">emergency_home</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-2xs flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs text-slate-500 font-semibold">متوسط هامش الربح</span>
            <span className="text-xl sm:text-2xl font-extrabold text-emerald-700 mt-1 font-num">
              {averageMarginPercent}
              <span className="text-xs text-slate-400 font-normal">%</span>
            </span>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-700">
            <span className="material-symbols-outlined text-[22px]">trending_up</span>
          </div>
        </div>
      </div>

      {/* Search & Filtering Toolbar */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Search Field */}
        <div className="relative flex-1">
          <span className="material-symbols-outlined absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-[20px]">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث برقم الباركود أو اسم الصنف (مثال: 628100 أو حليب المراعي)..."
            className="w-full bg-slate-50 text-slate-800 placeholder:text-slate-400 pr-11 pl-10 py-2.5 rounded-xl text-sm border border-slate-200/90 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 shadow-inner"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <span className="material-symbols-outlined text-[18px]">cancel</span>
            </button>
          )}
        </div>

        {/* Filter Chips Carousel */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0 scrollbar-none select-none">
          <button
            onClick={() => {
              setFilterMode('all');
              setSelectedCategory('all');
            }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition ${
              filterMode === 'all' && selectedCategory === 'all'
                ? 'bg-teal-600 text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
            type="button"
          >
            جميع الأصناف ({products.length})
          </button>

          <button
            onClick={() => setFilterMode('low')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex items-center gap-1 ${
              filterMode === 'low'
                ? 'bg-amber-600 text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
            type="button"
          >
            <span>منخفض المخزون</span>
            <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-900 text-[10px] flex items-center justify-center font-bold">
              {lowStockCount}
            </span>
          </button>

          <button
            onClick={() => setFilterMode('out')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition flex items-center gap-1 ${
              filterMode === 'out'
                ? 'bg-rose-600 text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
            }`}
            type="button"
          >
            <span>نفد (0)</span>
            <span className="w-4 h-4 rounded-full bg-rose-100 text-rose-900 text-[10px] flex items-center justify-center font-bold">
              {outOfStockCount}
            </span>
          </button>

          <div className="h-6 w-px bg-slate-200 mx-1"></div>

          <div className="relative">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-xl text-xs font-bold focus:outline-none cursor-pointer"
            >
              <option value="all">كل الأقسام</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Main Two-Zone Split Layout (Table vs Product Details Drawer) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* Right Zone: Inventory Table (8 Cols) */}
        <div className="xl:col-span-8 flex flex-col gap-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs overflow-hidden">
            {/* Table Header / Summary Action */}
            <div className="px-4 py-2.5 bg-slate-50/80 border-b border-slate-200/80 flex items-center justify-between text-xs text-slate-500 font-bold">
              <span>عرض {filteredProducts.length} من {products.length} منتج مسجل</span>
              <span className="text-[11px] text-teal-700 font-normal">اضغط على أي صنف لعرض تفاصيله</span>
            </div>

            {/* Table Container */}
            <div className="overflow-x-auto">
              <table className="w-full text-right border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-b border-slate-100">
                    <th className="py-3 px-4">الصنف والباركود</th>
                    <th className="py-3 px-2">التصنيف</th>
                    <th className="py-3 px-2">التكلفة</th>
                    <th className="py-3 px-2">سعر البيع</th>
                    <th className="py-3 px-2">ربح القطعة</th>
                    <th className="py-3 px-2">المخزون الحالي</th>
                    <th className="py-3 px-2">الحالة</th>
                    <th className="py-3 px-3 text-center">إجراءات</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
                  {filteredProducts.map((product) => {
                    const isSelected = selectedProduct?.id === product.id;
                    const profitPerPiece = Math.max(0, product.selling_price - product.average_cost);
                    const isZero = product.stock_quantity <= 0;
                    const isLow = product.stock_quantity > 0 && product.stock_quantity <= product.minimum_stock;

                    return (
                      <tr
                        key={product.id}
                        onClick={() => setSelectedProductId(product.id)}
                        className={`hover:bg-slate-50 transition-colors cursor-pointer ${
                          isSelected ? 'bg-teal-50/60 font-medium' : ''
                        }`}
                      >
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-teal-600 shrink-0">
                              <span className="material-symbols-outlined text-[20px]">
                                {categories.find((c) => c.id === product.category_id)?.icon || 'inventory_2'}
                              </span>
                            </div>
                            <div className="flex flex-col min-w-0">
                              <span className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                                {product.name}
                              </span>
                              <span className="text-[10px] text-slate-400 font-mono tracking-wider truncate" dir="ltr">
                                {product.barcode || 'بدون باركود'}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-2 text-slate-500">
                          {categories.find((c) => c.id === product.category_id)?.name || 'عام'}
                        </td>

                        <td className="py-3 px-2 font-num font-semibold text-slate-600">
                          {product.average_cost.toFixed(2)}
                        </td>

                        <td className="py-3 px-2 font-num font-bold text-slate-900">
                          {product.selling_price.toFixed(2)}
                        </td>

                        <td className="py-3 px-2 font-num font-bold text-teal-700">
                          +{profitPerPiece.toFixed(2)}
                        </td>

                        <td className="py-3 px-2">
                          <div className="flex items-center gap-1 font-bold font-num text-slate-900">
                            <span className="text-sm">{product.stock_quantity}</span>
                            <span className="text-[10px] text-slate-400 font-normal">{product.unit || 'حبة'}</span>
                          </div>
                        </td>

                        <td className="py-3 px-2">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              isZero
                                ? 'bg-rose-100 text-rose-800'
                                : isLow
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-50 text-emerald-800'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                isZero ? 'bg-rose-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'
                              }`}
                            ></span>
                            {isZero ? 'نفد ⚠️' : isLow ? 'منخفض ⚠️' : 'متوفر'}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-center">
                          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              onClick={() => onRestockProduct(product)}
                              className="px-2 py-1 rounded-lg bg-teal-50 hover:bg-teal-600 hover:text-white text-teal-800 border border-teal-200 text-[11px] font-bold transition"
                              title="توريد شحنة مشتريات"
                              type="button"
                            >
                              + توريد
                            </button>
                            <button
                              onClick={() => handleOpenEdit(product)}
                              className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition"
                              title="تعديل بيانات"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[16px]">edit</span>
                            </button>
                            <button
                              onClick={() => handleDelete(product.id, product.name)}
                              className="p-1 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition"
                              title="حذف الصنف"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-slate-400">
                        <span className="material-symbols-outlined text-[40px] text-slate-300 block mb-1">
                          inventory_2
                        </span>
                        <span>لا توجد منتجات مطابقة في المخزون</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Left Zone: Selected Product Details & Stock Ledger Drawer (4 Cols) */}
        <div className="xl:col-span-4 flex flex-col gap-4">
          {selectedProduct ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-md p-5 flex flex-col gap-4">
              {/* Product Header Card */}
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-700 border border-teal-100 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[30px]">
                      {categories.find((c) => c.id === selectedProduct.category_id)?.icon || 'inventory_2'}
                    </span>
                  </div>
                  <div className="flex flex-col min-w-0">
                    <span className="px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 border border-teal-200 text-[10px] font-bold w-fit">
                      الرصيد: {selectedProduct.stock_quantity} {selectedProduct.unit}
                    </span>
                    <h2 className="text-base font-bold text-slate-900 mt-1 truncate">{selectedProduct.name}</h2>
                    <span className="text-[11px] text-slate-400 font-mono tracking-wider" dir="ltr">
                      {selectedProduct.barcode || 'بدون باركود'}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => handleOpenEdit(selectedProduct)}
                  className="p-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition"
                  title="تعديل بيانات الصنف"
                  type="button"
                >
                  <span className="material-symbols-outlined text-[18px]">edit</span>
                </button>
              </div>

              {/* Pricing & Profit Analysis Breakdown */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/70 flex flex-col gap-2.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>تحليل التسعير والربح</span>
                  <span className="px-2 py-0.5 rounded bg-teal-600 text-white text-[10px]">
                    هامش ربح{' '}
                    {selectedProduct.selling_price > 0
                      ? Math.round(
                          ((selectedProduct.selling_price - selectedProduct.average_cost) /
                            selectedProduct.selling_price) *
                            100
                        )
                      : 0}
                    %
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                  <div className="bg-white p-2 rounded-lg border border-slate-200 flex flex-col">
                    <span className="text-[10px] text-slate-400">سعر التكلفة</span>
                    <span className="text-sm font-bold text-slate-800 font-num mt-0.5">
                      {selectedProduct.average_cost.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-400">{settings.currency}</span>
                  </div>

                  <div className="bg-white p-2 rounded-lg border border-slate-200 flex flex-col">
                    <span className="text-[10px] text-slate-400">سعر البيع</span>
                    <span className="text-sm font-bold text-teal-700 font-num mt-0.5">
                      {selectedProduct.selling_price.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-400">{settings.currency}</span>
                  </div>

                  <div className="bg-white p-2 rounded-lg border border-slate-200 flex flex-col">
                    <span className="text-[10px] text-slate-400">صافي الربح</span>
                    <span className="text-sm font-bold text-emerald-700 font-num mt-0.5">
                      +{(selectedProduct.selling_price - selectedProduct.average_cost).toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-400">{settings.currency} للقطعة</span>
                  </div>
                </div>
              </div>

              {/* Stock Movement Audit Ledger (سجل حركة المخزون الأخيرة) */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-800">
                  <span>سجل حركة المخزون الأخيرة</span>
                  <span className="text-[11px] text-slate-400 font-normal">آخر 5 عمليات</span>
                </div>

                <div className="flex flex-col gap-2">
                  {productMovements.map((sm) => {
                    const isPositive = sm.quantity > 0;
                    return (
                      <div
                        key={sm.id}
                        className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                              isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[16px]">
                              {sm.type === 'purchase'
                                ? 'local_shipping'
                                : sm.type === 'sale'
                                ? 'shopping_cart'
                                : 'tune'}
                            </span>
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-800 text-[11px]">{sm.note || sm.type}</span>
                            <span className="text-[10px] text-slate-400">{formatArabicDate(sm.created_at)}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end text-left">
                          <span
                            className={`font-bold font-num ${
                              isPositive ? 'text-emerald-700' : 'text-rose-700'
                            }`}
                          >
                            {isPositive ? `+${sm.quantity}` : sm.quantity}
                          </span>
                          <span className="text-[10px] text-slate-400 font-num">الرصيد: {sm.remaining_stock}</span>
                        </div>
                      </div>
                    );
                  })}

                  {productMovements.length === 0 && (
                    <div className="py-4 text-center text-slate-400 text-xs">
                      لا توجد حركات مخزون مسجلة لهذا الصنف بعد
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Restock Action Button */}
              <button
                onClick={() => onRestockProduct(selectedProduct)}
                className="w-full py-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-xs shadow-md transition active:scale-98 flex items-center justify-center gap-1.5"
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">add_business</span>
                <span>+ توريد شحنة مخزون جديدة</span>
              </button>

              {/* Shelf location badge */}
              {selectedProduct.shelf_location && (
                <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-teal-600">pin_drop</span>
                  <span>موقع الرف: <strong>{selectedProduct.shelf_location}</strong></span>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
              حدد منتجاً من القائمة لعرض تفاصيله
            </div>
          )}
        </div>
      </div>

      {/* Edit Product Modal */}
      {editingProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
          <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-teal-600 text-white px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-bold text-sm">تعديل بيانات المنتج</h3>
              <button onClick={() => setEditingProduct(null)} className="text-teal-100 hover:text-white">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 flex flex-col gap-3.5 overflow-y-auto">
              {editError && (
                <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold">
                  {editError}
                </div>
              )}

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">اسم المنتج *</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">رقم الباركود</label>
                <input
                  type="text"
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  dir="ltr"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">سعر البيع *</label>
                  <input
                    type="number"
                    step="0.25"
                    value={editSellingPrice}
                    onChange={(e) => setEditSellingPrice(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-left focus:bg-white"
                    dir="ltr"
                    required
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">متوسط التكلفة</label>
                  <input
                    type="number"
                    step="0.25"
                    value={editPurchasePrice}
                    onChange={(e) => setEditPurchasePrice(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">المخزون الحالي (جرد يدوي)</label>
                  <input
                    type="number"
                    value={editStockQuantity}
                    onChange={(e) => setEditStockQuantity(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white"
                    dir="ltr"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">حد التنبيه بالنقص</label>
                  <input
                    type="number"
                    value={editMinimumStock}
                    onChange={(e) => setEditMinimumStock(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white"
                    dir="ltr"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">القسم</label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-2 py-2 text-xs"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">الوحدة</label>
                  <input
                    type="text"
                    value={editUnit}
                    onChange={(e) => setEditUnit(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">موقع الرف بالمحل</label>
                <input
                  type="text"
                  value={editShelf}
                  onChange={(e) => setEditShelf(e.target.value)}
                  placeholder="مثال: الممر 2 - رف A3"
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
                />
              </div>

              <div className="flex gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingProduct(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-sm"
                >
                  حفظ التعديلات
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
