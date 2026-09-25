import React, { useState } from 'react';
import { useStore } from '../../hooks/useStore';

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenScanner?: () => void;
}

export const AddProductModal: React.FC<AddProductModalProps> = ({
  isOpen,
  onClose,
  onOpenScanner,
}) => {
  const { state, addProduct } = useStore();
  const { categories, settings } = state;

  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [stockQuantity, setStockQuantity] = useState('24');
  const [minimumStock, setMinimumStock] = useState('6');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || 'cat-1');
  const [unit, setUnit] = useState('حبة');
  const [shelfLocation, setShelfLocation] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleGenerateBarcode = () => {
    // Generate a clean 12-digit grocery EAN/UPC style numeric barcode
    const random12 = '628100' + Math.floor(100000 + Math.random() * 900000);
    setBarcode(random12);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const sPrice = parseFloat(sellingPrice);
    if (!name.trim()) {
      setError('يرجى إدخال اسم المنتج.');
      return;
    }
    if (isNaN(sPrice) || sPrice <= 0) {
      setError('يرجى تحديد سعر بيع صحيح.');
      return;
    }

    const pPrice = parseFloat(purchasePrice) || sPrice * 0.75;
    const qty = parseInt(stockQuantity) || 0;
    const min = parseInt(minimumStock) || 0;

    try {
      addProduct({
        name: name.trim(),
        barcode: barcode.trim(),
        category_id: categoryId,
        selling_price: sPrice,
        purchase_price: pPrice,
        average_cost: pPrice,
        stock_quantity: qty,
        minimum_stock: min,
        unit: unit.trim() || 'حبة',
        shelf_location: shelfLocation.trim() || undefined,
      });

      onClose();
      // Reset
      setName('');
      setBarcode('');
      setSellingPrice('');
      setPurchasePrice('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-teal-600 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[24px]">add_box</span>
            <h3 className="font-bold text-base">إضافة منتج جديد للمخزون</h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center text-teal-100 hover:text-white"
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3.5 overflow-y-auto">
          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold">
              {error}
            </div>
          )}

          {/* Barcode field with generate & scan helpers */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700">رقم الباركود</label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleGenerateBarcode}
                  className="text-[11px] text-teal-700 hover:underline font-semibold"
                >
                  توليد باركود تلقائي
                </button>
                {onOpenScanner && (
                  <>
                    <span className="text-slate-300">•</span>
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenScanner();
                      }}
                      className="text-[11px] text-teal-700 hover:underline font-semibold flex items-center gap-0.5"
                    >
                      <span className="material-symbols-outlined text-[14px]">photo_camera</span>
                      <span>مسح</span>
                    </button>
                  </>
                )}
              </div>
            </div>
            <div className="relative">
              <input
                type="text"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="اتركه فارغاً إذا كان المنتج بدون باركود"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-mono text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pl-8"
                dir="ltr"
              />
              <span className="material-symbols-outlined text-slate-400 text-[18px] absolute left-2.5 top-2 pointer-events-none">
                barcode
              </span>
            </div>
          </div>

          {/* Product Name */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-700">اسم المنتج التجاري *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: حليب المراعي كامل الدسم 1 لتر"
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              required
              autoFocus
            />
          </div>

          {/* Pricing Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">سعر البيع للزبون *</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.25"
                  min="0.1"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
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
              <label className="text-xs font-bold text-slate-700">سعر الشراء (التكلفة)</label>
              <div className="relative">
                <input
                  type="number"
                  step="0.25"
                  min="0.1"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pl-8"
                  dir="ltr"
                />
                <span className="absolute left-2.5 top-2 text-[10px] font-bold text-slate-400">
                  {settings.currency}
                </span>
              </div>
            </div>
          </div>

          {/* Category & Unit */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">التصنيف / القسم</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs focus:bg-white"
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
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-2 text-xs focus:bg-white"
              >
                <option value="حبة">حبة</option>
                <option value="علبة">علبة</option>
                <option value="كيس">كيس</option>
                <option value="كرتونة">كرتونة</option>
                <option value="ربطة">ربطة</option>
                <option value="طبق">طبق</option>
                <option value="كجم">كجم</option>
              </select>
            </div>
          </div>

          {/* Initial Stock & Minimum Stock */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">الكمية الافتتاحية للمخزن</label>
              <input
                type="number"
                min="0"
                value={stockQuantity}
                onChange={(e) => setStockQuantity(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white"
                dir="ltr"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-bold text-slate-700">حد التنبيه بنقص المخزون</label>
              <input
                type="number"
                min="0"
                value={minimumStock}
                onChange={(e) => setMinimumStock(e.target.value)}
                className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-left focus:bg-white"
                dir="ltr"
              />
            </div>
          </div>

          {/* Shelf Location */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-slate-700">موقع الرف في المحل (اختياري)</label>
            <input
              type="text"
              value={shelfLocation}
              onChange={(e) => setShelfLocation(e.target.value)}
              placeholder="مثال: الممر 2 - ثلاجة الألبان (رف A3)"
              className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
            />
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold"
            >
              إلغاء
            </button>
            <button
              type="submit"
              className="flex-1 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold shadow-md shadow-teal-600/20 transition active:scale-95"
            >
              حفظ المنتج
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
