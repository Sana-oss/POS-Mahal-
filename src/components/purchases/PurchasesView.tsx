import React, { useState } from 'react';
import { calculateAverageCost, formatArabicDate, formatCurrency } from '../../lib/calculations';
import { useStore } from '../../hooks/useStore';
import { Product } from '../../types';

interface PurchasesViewProps {
  initialRestockProduct?: Product | null;
  onClearInitialRestock?: () => void;
}

export const PurchasesView: React.FC<PurchasesViewProps> = ({
  initialRestockProduct,
  onClearInitialRestock,
}) => {
  const { state, executePurchase } = useStore();
  const { products, purchases, settings } = state;

  const [isAddingPurchase, setIsAddingPurchase] = useState(!!initialRestockProduct);
  const [supplierName, setSupplierName] = useState('شركة المراعي للتوزيع');
  const [selectedProductId, setSelectedProductId] = useState(
    initialRestockProduct ? initialRestockProduct.id : products[0]?.id || ''
  );
  const [purchaseQty, setPurchaseQty] = useState('24');
  const [purchaseUnitCost, setPurchaseUnitCost] = useState(
    initialRestockProduct ? initialRestockProduct.purchase_price.toString() : '2.80'
  );
  const [purchaseNotes, setPurchaseNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const selectedProduct = products.find((p) => p.id === selectedProductId);

  // Dynamic Average Cost Preview
  const qtyNum = parseInt(purchaseQty) || 0;
  const costNum = parseFloat(purchaseUnitCost) || 0;

  const previewNewAverageCost = selectedProduct
    ? calculateAverageCost(
        selectedProduct.stock_quantity,
        selectedProduct.average_cost,
        qtyNum,
        costNum
      )
    : 0;

  const previewNewStock = selectedProduct ? selectedProduct.stock_quantity + qtyNum : 0;
  const totalPurchaseCost = Math.round(qtyNum * costNum * 100) / 100;

  const handleProductChange = (prodId: string) => {
    setSelectedProductId(prodId);
    const prod = products.find((p) => p.id === prodId);
    if (prod) {
      setPurchaseUnitCost(prod.purchase_price ? prod.purchase_price.toString() : '1.00');
    }
  };

  const handleConfirmPurchase = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!selectedProduct) {
      setErrorMessage('يرجى اختيار المنتج المراد توريده.');
      return;
    }
    if (qtyNum <= 0) {
      setErrorMessage('الكمية المشتراة يجب أن تكون أكبر من الصفر.');
      return;
    }
    if (costNum <= 0) {
      setErrorMessage('سعر شراء الوحدة يجب أن يكون أكبر من الصفر.');
      return;
    }

    try {
      const purchase = executePurchase({
        supplierName: supplierName.trim() || 'مورّد عام',
        notes: purchaseNotes.trim(),
        items: [
          {
            productId: selectedProduct.id,
            quantity: qtyNum,
            unitCost: costNum,
          },
        ],
      });

      setSuccessMessage(
        `تم تسجيل فاتورة التوريد #${purchase.invoice_no} بنجاح! تم تحديث رصيد "${selectedProduct.name}" إلى ${previewNewStock} ${selectedProduct.unit} ومتوسط التكلفة إلى ${previewNewAverageCost.toFixed(2)} ${settings.currency}.`
      );
      setIsAddingPurchase(false);
      onClearInitialRestock?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-700 border border-amber-100 flex items-center justify-center shadow-xs">
            <span className="material-symbols-outlined text-[28px]">local_shipping</span>
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900">المشتريات والتوريد</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              تسجيل شحنات البضائع الجديدة، زيادة الأرصدة، واحتساب متوسط التكلفة المرجح تلقائياً
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            setIsAddingPurchase(!isAddingPurchase);
            setErrorMessage(null);
            setSuccessMessage(null);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-teal-600/20 transition active:scale-95"
          type="button"
        >
          <span className="material-symbols-outlined text-[20px]">
            {isAddingPurchase ? 'close' : 'add_circle'}
          </span>
          <span>{isAddingPurchase ? 'إغلاق النموذج' : '+ إضافة فاتورة مشتريات'}</span>
        </button>
      </div>

      {/* Success Notification */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 text-emerald-800 text-xs font-bold animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[20px] text-emerald-600">check_circle</span>
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="p-1 hover:bg-emerald-100 rounded-lg">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* Add Purchase Form Container */}
      {isAddingPurchase && (
        <div className="bg-white rounded-2xl border border-teal-200 shadow-md p-5 flex flex-col gap-4 animate-in slide-in-from-top-3 duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <span className="material-symbols-outlined text-[22px] text-teal-600">playlist_add</span>
              <span>تسجيل شحنة توريد بضاعة جديدة</span>
            </h2>
            <span className="text-xs text-slate-400 font-num">فاتورة توريد #{209 + purchases.length}</span>
          </div>

          {errorMessage && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-800 text-xs font-bold">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleConfirmPurchase} className="grid grid-cols-1 md:grid-cols-12 gap-4">
            {/* Supplier & Product Choice */}
            <div className="md:col-span-6 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">اسم المورّد / الشركة الموزعة *</label>
                <input
                  type="text"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="مثال: شركة المراعي / الموزع طارق"
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">اختيار المنتج لتوريده *</label>
                <select
                  value={selectedProductId}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  required
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} (رصيد حالي: {p.stock_quantity} {p.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">الكمية الموردة *</label>
                  <input
                    type="number"
                    min="1"
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(e.target.value)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-left focus:bg-white"
                    dir="ltr"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-700">سعر شراء القطعة (التكلفة) *</label>
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      min="0.05"
                      value={purchaseUnitCost}
                      onChange={(e) => setPurchaseUnitCost(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-bold text-left focus:bg-white pl-8"
                      dir="ltr"
                      required
                    />
                    <span className="absolute left-2 top-2 text-[10px] text-slate-400 font-bold">
                      {settings.currency}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-bold text-slate-700">ملاحظات الفاتورة (اختياري)</label>
                <input
                  type="text"
                  value={purchaseNotes}
                  onChange={(e) => setPurchaseNotes(e.target.value)}
                  placeholder="رقم إذن الاستلام أو دفعة التوريد..."
                  className="bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs focus:bg-white"
                />
              </div>
            </div>

            {/* Calculations & Weighted Average Preview */}
            <div className="md:col-span-6 bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-between gap-3">
              <div className="flex flex-col gap-2">
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[18px] text-teal-600">calculate</span>
                  <span>معاينة احتساب متوسط التكلفة والرصيد الجديد:</span>
                </span>

                <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex flex-col">
                    <span className="text-[10px] text-slate-400">الرصيد الحالي بالمخزن</span>
                    <span className="font-bold text-slate-800 font-num text-sm mt-0.5">
                      {selectedProduct?.stock_quantity || 0} {selectedProduct?.unit}
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex flex-col">
                    <span className="text-[10px] text-slate-400">الرصيد بعد التوريد</span>
                    <span className="font-bold text-emerald-700 font-num text-sm mt-0.5">
                      {previewNewStock} {selectedProduct?.unit}
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-lg border border-slate-200 flex flex-col">
                    <span className="text-[10px] text-slate-400">متوسط التكلفة السابق</span>
                    <span className="font-bold text-slate-600 font-num text-sm mt-0.5">
                      {selectedProduct?.average_cost.toFixed(2)} {settings.currency}
                    </span>
                  </div>

                  <div className="bg-white p-2.5 rounded-lg border border-teal-300 flex flex-col">
                    <span className="text-[10px] text-teal-700 font-bold">متوسط التكلفة الجديد</span>
                    <span className="font-bold text-teal-800 font-num text-sm mt-0.5">
                      {previewNewAverageCost.toFixed(2)} {settings.currency}
                    </span>
                  </div>
                </div>

                <div className="p-2.5 bg-teal-50 border border-teal-200 rounded-lg flex items-center justify-between text-xs">
                  <span className="font-bold text-teal-900">إجمالي قيمة الفاتورة:</span>
                  <span className="text-base font-extrabold text-teal-800 font-num">
                    {formatCurrency(totalPurchaseCost, settings.currency)}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddingPurchase(false)}
                  className="flex-1 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  className="flex-2 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold shadow-md transition active:scale-95 flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[18px]">check_circle</span>
                  <span>اعتماد التوريد وتحديث المخزون</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Past Purchases History Table */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-2xs flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[22px] text-amber-600">history</span>
            <h2 className="font-bold text-base text-slate-900">سجل فواتير المشتريات والتوريد السابقة</h2>
          </div>
          <span className="text-xs text-slate-400 font-num">{purchases.length} عملية توريد</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-right border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-xs font-bold border-y border-slate-100">
                <th className="py-2.5 px-3">رقم التوريد</th>
                <th className="py-2.5 px-3">التاريخ والوقت</th>
                <th className="py-2.5 px-3">اسم المورّد</th>
                <th className="py-2.5 px-3">الأصناف الموردة</th>
                <th className="py-2.5 px-3">الكمية الكلية</th>
                <th className="py-2.5 px-3">المبلغ الإجمالي</th>
                <th className="py-2.5 px-3">ملاحظات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-800">
              {purchases.map((purchase) => (
                <tr key={purchase.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="py-3 px-3 font-mono font-bold text-slate-900">{purchase.invoice_no}</td>
                  <td className="py-3 px-3 text-slate-400">{formatArabicDate(purchase.created_at)}</td>
                  <td className="py-3 px-3 font-bold text-slate-800">{purchase.supplier_name}</td>
                  <td className="py-3 px-3 text-slate-600">
                    {purchase.items.map((i) => `${i.product_name} (${i.quantity})`).join('، ')}
                  </td>
                  <td className="py-3 px-3 font-num font-bold text-slate-700">{purchase.items_count} قطعة</td>
                  <td className="py-3 px-3 font-bold font-num text-teal-800">
                    {formatCurrency(purchase.total_amount, settings.currency)}
                  </td>
                  <td className="py-3 px-3 text-slate-400">{purchase.notes || '-'}</td>
                </tr>
              ))}

              {purchases.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    لا توجد فواتير مشتريات سابقة مسجلة
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
