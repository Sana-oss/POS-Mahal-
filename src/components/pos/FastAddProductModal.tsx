import React, { useState } from 'react';
import { useStore } from '../../hooks/useStore';
import { roundCurrency, roundQuantity } from '../../lib/calculations';
import { Product } from '../../types';

interface FastAddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  barcode: string;
  onProductCreated: (product: Product) => void;
}

export const FastAddProductModal: React.FC<FastAddProductModalProps> = ({
  isOpen,
  onClose,
  barcode,
  onProductCreated,
}) => {
  const { state, addProduct } = useStore();
  const [name, setName] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [stockQuantity, setStockQuantity] = useState('24');
  const [minimumStock, setMinimumStock] = useState('6');
  const [categoryId, setCategoryId] = useState(state.categories[0]?.id || 'cat-1');
  const [unit, setUnit] = useState('حبة');
  const [error, setError] = useState<string | null>(null);

  // Derived from the live form so the "unknown cost" warning updates as the
  // cashier types, and so the submit handler and the warning cannot disagree.
  //
  // Never invent a cost, and never let an explicit 0 be replaced. The previous
  // `parseFloat(purchasePrice) || sPrice * 0.8` fabricated a cost that became
  // the basis for gross profit on every later sale, and
  // `parseInt(stockQuantity) || 10` turned a deliberate opening stock of 0 into
  // 10 units, inflating inventory without warning.
  //
  // A missing cost is stored as 0 rather than demanded: this form opens with an
  // empty cost and 24 units of stock, so requiring it made every fast add fail.
  const enteredCost = parseFloat(purchasePrice);
  const hasCost = !isNaN(enteredCost) && enteredCost > 0;
  const qty = roundQuantity(parseFloat(stockQuantity) || 0);
  const min = roundQuantity(parseFloat(minimumStock) || 0);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const sPrice = parseFloat(sellingPrice);
    if (!name.trim()) {
      setError('يرجى كتابة اسم المنتج.');
      return;
    }
    if (isNaN(sPrice) || sPrice <= 0) {
      setError('يرجى تحديد سعر بيع صحيح.');
      return;
    }

    // See the derivation above: 0 means "unknown cost", never a guess.
    const pPrice = hasCost ? roundCurrency(enteredCost) : 0;

    try {
      const newProd = await addProduct({
        name: name.trim(),
        barcode: barcode.trim(),
        category_id: categoryId,
        selling_price: sPrice,
        purchase_price: pPrice,
        average_cost: pPrice,
        stock_quantity: qty,
        minimum_stock: min,
        unit: unit || 'حبة',
      });

      onProductCreated(newProd);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="إضافة صنف سريع للرف"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-200">
        {/* Header */}
        <div className="bg-teal-600 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[24px]">playlist_add</span>
            <h3 className="font-bold text-base">إضافة صنف سريع للرف</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-teal-100 hover:text-white"
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-semibold">
              {error}
            </div>
          )}

          {/* Barcode display */}
          <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-200/80 flex items-center justify-between">
            <span className="text-xs text-slate-500 font-semibold">الباركود المسحوب:</span>
            <span className="font-mono font-bold text-slate-900 text-sm bg-white px-2 py-0.5 rounded border border-slate-300" dir="ltr">
              {barcode}
            </span>
          </div>

          {/* Name */}
          <div className="flex flex-col gap-1">
            <label htmlFor="fa-name" className="text-xs font-bold text-slate-700">اسم المنتج التجاري *</label>
            <input
              id="fa-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: بسكويت أوريو بالشوكولاتة"
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              autoFocus
              required
            />
          </div>

          {/* Selling Price & Purchase Cost */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="fa-selling" className="text-xs font-bold text-slate-700">سعر البيع للزبون *</label>
              <div className="relative">
                <input
                  id="fa-selling"
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 font-bold focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pl-8"
                  dir="ltr"
                  required
                />
                <span className="absolute left-2.5 top-2 text-xs font-semibold text-slate-400 pointer-events-none">
                  {state.settings.currency}
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="fa-cost" className="text-xs font-bold text-slate-700">سعر التكلفة (شراء)</label>
              <div className="relative">
                <input
                  id="fa-cost"
                  type="number"
                  step="0.01"
                  min="0.1"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pl-8"
                  dir="ltr"
                />
                <span className="absolute left-2.5 top-2 text-xs font-semibold text-slate-400 pointer-events-none">
                  {state.settings.currency}
                </span>
              </div>
            </div>
          </div>

          {/* Category & Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="fa-category" className="text-xs font-bold text-slate-700">القسم / التصنيف</label>
              <select
                id="fa-category"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {state.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="fa-unit" className="text-xs font-bold text-slate-700">الوحدة</label>
              <select
                id="fa-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="حبة">حبة</option>
                <option value="علبة">علبة</option>
                <option value="كيس">كيس</option>
                <option value="كرتونة">كرتونة</option>
                <option value="ربطة">ربطة</option>
                <option value="كجم">كجم</option>
              </select>
            </div>
          </div>

          {/* Initial Stock & Minimum Stock */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="fa-stock" className="text-xs font-bold text-slate-700">الكمية بالمخزن حالياً</label>
              <input
                id="fa-stock"
                type="number"
                step="0.001"
                // 0, not 0.001: an opening balance of zero is a real and common
                // case (the item is known but not stocked yet), and the minimum
                // stock threshold is legitimately 0 too.
                min="0"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="fa-min" className="text-xs font-bold text-slate-700">حد التنبيه بالنقص</label>
              <input
                id="fa-min"
                type="number"
                step="0.001"
                min="0"
                value={minimumStock}
                onChange={(e) => setMinimumStock(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="bg-teal-50 p-2.5 rounded-xl border border-teal-100 flex items-center gap-2 text-teal-800 text-xs">
            <span className="material-symbols-outlined text-[18px] text-teal-600 shrink-0">bolt</span>
            <span>سيتم حفظ الصنف فوراً وإضافته إلى السلة لمتابعة الحساب مع الزبون دون تعطيل.</span>
          </div>

          {/* A missing cost is stored as 0 rather than refused, so the cashier is
              told here that profit will read high until a cost is entered. */}
          {!hasCost && qty > 0 && (
            <div
              role="alert"
              className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold"
            >
              لم تُحدَّد سعر التكلفة. سيُحسب ربح هذا الصنف ككامل سعر البيع حتى تدخل تكلفته.
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 px-4 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold text-sm shadow-md transition active:scale-95 flex items-center justify-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">add_shopping_cart</span>
              <span>حفظ وإضافة للسلة</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
