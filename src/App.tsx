/**
 * Mahall POS (محل POS)
 * A fast Arabic RTL POS, inventory, debt, expense, and profit-management system
 * for small grocery and food stores.
 */

import React, { useEffect, useState } from 'react';
import { Header } from './components/layout/Header';
import { Sidebar } from './components/layout/Sidebar';
import { MobileNav } from './components/layout/MobileNav';
import { POSView } from './components/pos/POSView';
import { DashboardView } from './components/dashboard/DashboardView';
import { InventoryView } from './components/inventory/InventoryView';
import { PurchasesView } from './components/purchases/PurchasesView';
import { DebtsView } from './components/debts/DebtsView';
import { ExpensesView } from './components/expenses/ExpensesView';
import { ReportsView } from './components/reports/ReportsView';
import { SettingsView } from './components/settings/SettingsView';
import { BarcodeScannerModal } from './components/pos/BarcodeScannerModal';
import { FastAddProductModal } from './components/pos/FastAddProductModal';
import { AddProductModal } from './components/inventory/AddProductModal';
import { ThermalReceiptModal } from './components/pos/ThermalReceiptModal';
import { ToastContainer, ToastMessage } from './components/common/Toast';
import { useStore } from './hooks/useStore';
import { isSupabaseConfigured } from './lib/supabase';
import { bootstrapFromCloud, refreshFromCloud } from './lib/dataSource';
import { useSyncStatus } from './hooks/useSyncStatus';
import { useCart } from './hooks/useCart';
import { calculateCartSummary } from './lib/calculations';
import { Product, Sale } from './types';
import { useAuth } from './components/auth/AuthProvider';
import { LoginView } from './components/auth/LoginView';
import { UpdatePasswordView } from './components/auth/UpdatePasswordView';
import { SignUpView } from './components/auth/SignUpView';
import { inviteTokenFromUrl } from './lib/invites';
import { AlertTriangle, CloudOff, Loader2, RefreshCw } from 'lucide-react';

export default function App() {
  const { session, loading: authLoading, mode, shopId, recoveryMode } = useAuth();
  const { state } = useStore();
  const sync = useSyncStatus();
  const [cart] = useCart();
  const [currentTab, setCurrentTab] = useState<string>('pos');

  // Cloud bootstrap: pull the whole shop into the local cache once we know
  // which shop this session belongs to. The cache (and therefore every screen)
  // is empty until this resolves, so a failed sync can never show stale or
  // demo data as if it were real.
  useEffect(() => {
    if (mode !== 'cloud' || !session || !shopId) return;
    bootstrapFromCloud(shopId).catch(() => {
      /* the sync status carries the message and App renders the retry screen */
    });
  }, [mode, session?.user?.id, shopId]);

  // Badge for the mobile bottom nav. The cart now survives tab switches, so this
  // stays accurate from every screen.
  const cartCount = calculateCartSummary(cart).totalItemsCount;

  // Modals
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [fastAddBarcode, setFastAddBarcode] = useState<string | null>(null);
  const [isAddProductOpen, setIsAddProductOpen] = useState(false);
  const [activeReceiptSale, setActiveReceiptSale] = useState<Sale | null>(null);
  const [productToRestock, setProductToRestock] = useState<Product | null>(null);

  // Barcode detection bridge
  const [scannedBarcodeForPOS, setScannedBarcodeForPOS] = useState<string | null>(null);

  // Toast notifications
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Global keyboard shortcuts: F1 jumps to the POS screen and F2 opens the camera
  // scanner. These mirror the hints advertised on the sidebar and header buttons.
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        setCurrentTab('pos');
      } else if (event.key === 'F2') {
        event.preventDefault();
        setIsScannerOpen(true);
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const addToast = (message: string, type: ToastMessage['type'] = 'success') => {
    const id = 'toast-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Barcode scanned from camera modal
  const handleBarcodeDetected = (barcode: string) => {
    setScannedBarcodeForPOS(barcode);
    if (currentTab !== 'pos') {
      setCurrentTab('pos');
    }
  };

  // Unknown barcode triggers fast add
  const handleOpenFastAdd = (barcode: string) => {
    setFastAddBarcode(barcode);
  };

  const handleFastProductCreated = (product: Product) => {
    addToast(`تم تسجيل "${product.name}" بنجاح وإضافته للمخزون`);
    setScannedBarcodeForPOS(product.barcode);
    if (currentTab !== 'pos') {
      setCurrentTab('pos');
    }
  };

  // Sale completed handler
  const handleSaleCompleted = (sale: Sale) => {
    addToast(`تم تسجيل الفاتورة #${sale.invoice_no} بنجاح!`, 'success');
    setActiveReceiptSale(sale);
  };

  // Restock trigger from inventory or low stock
  const handleRestockProduct = (product: Product) => {
    setProductToRestock(product);
    setCurrentTab('purchases');
  };

  // Password recovery outranks everything else, including the auth spinner.
  // Supabase establishes a full session from the emailed link before any new
  // password exists, so without this check the recovery would fall through to
  // the cloud gate below - still pulling the shop, or showing the "could not
  // load shop data" wall - and the cashier would never be asked for a new
  // password. It also outranks the sign-in wall, because during recovery
  // `session` is deliberately set.
  //
  // Ahead of `authLoading` on purpose: setting a new password needs no shop
  // data, so a slow or failed profile fetch must not leave someone who followed
  // a reset link staring at a spinner.
  if (recoveryMode) {
    return <UpdatePasswordView />;
  }

  // A production build with no Supabase configuration would otherwise run
  // local-only, and silently. It would look like a working POS: sales would
  // complete, the cashier would see totals, and every one of them would be
  // written to that one browser's localStorage instead of the shop's database.
  // Nothing would look wrong until the day that browser's cache was cleared.
  //
  // That matters most for a multi-shop deployment, where data isolated per shop
  // by RLS is the only thing keeping one owner out of another's books. A
  // misconfigured deploy must stop, not degrade.
  if (import.meta.env.PROD && !isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6" dir="rtl">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-7 text-center">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
            <AlertTriangle size={28} />
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">إعداد النشر غير مكتمل</h1>
          <p className="mt-2 text-sm text-slate-600 leading-6">
            هذا البناء لم يُضبط عليه الاتصال بقاعدة البيانات، لذلك تم إيقافه بدل أن يعمل
            محلياً. أضف المتغيرات التالية ثم أعد النشر:
          </p>
          <ul className="mt-3 text-left text-sm text-slate-700 space-y-1" dir="ltr">
            <li className="font-mono">VITE_SUPABASE_URL</li>
            <li className="font-mono">VITE_SUPABASE_ANON_KEY</li>
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.
          </p>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <Loader2 className="w-10 h-10 animate-spin text-teal-500" />
      </div>
    );
  }


  // Registration and invitation. Read once on mount from the URL rather than on
  // every render, so the token is not re-read (and cannot be re-fetched) while
  // the cashier types.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [authScreen, setAuthScreen] = useState<'signin' | 'signup'>('signin');

  useEffect(() => {
    const token = inviteTokenFromUrl();
    if (token) {
      setInviteToken(token);
      setAuthScreen('signup');
    }
  }, []);

  // The cloud sign-in wall only applies when Supabase is actually configured;
  // otherwise the app runs local-only against localStorage.
  if (isSupabaseConfigured && !session) {
    if (authScreen === 'signup') {
      return (
        <SignUpView
          inviteToken={inviteToken}
          onBackToLogin={() => {
            setAuthScreen('signin');
            // Drop the token from the URL, so a reload does not bounce the
            // cashier back into the join screen and Back does not re-enter it.
            if (inviteToken) {
              window.history.replaceState({}, '', window.location.pathname);
              setInviteToken(null);
            }
          }}
        />
      );
    }
    return <LoginView onSignUp={() => setAuthScreen('signup')} />;
  }

  // Cloud gate: while the shop is being pulled (or when it failed) we must not
  // render the POS on top of an empty/stale cache — that is how a cashier ends
  // up selling against the wrong stock numbers.
  if (mode === 'cloud' && session && sync.state !== 'ready') {
    if (sync.state === 'error' || !shopId) {
      return (
        <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6" dir="rtl">
          <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl p-7 text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center">
              <CloudOff size={28} />
            </div>
            <h1 className="mt-4 text-lg font-bold text-slate-900">تعذر تحميل بيانات المتجر</h1>
            <p className="mt-2 text-sm text-slate-600 leading-6">
              {shopId
                ? (sync.error ?? 'حدث خطأ غير متوقع أثناء الاتصال بقاعدة البيانات.')
                : 'لم يتم العثور على متجر مرتبط بهذا الحساب. تأكد من تسجيل الدخول بالحساب الصحيح أو راجع مالك المتجر.'}
            </p>
            {shopId && (
              <button
                onClick={() => refreshFromCloud().catch(() => undefined)}
                className="mt-5 inline-flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-bold px-5 py-2.5 rounded-xl transition"
              >
                <RefreshCw size={16} />
                إعادة المحاولة
              </button>
            )}
            <p className="mt-4 text-xs text-slate-400">
              لم يتم عرض أي بيانات تجريبية. كل حركة بيع تُحفظ في سحابة متجرك فقط بعد نجاح الاتصال.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center gap-3" dir="rtl">
        <Loader2 className="w-10 h-10 animate-spin text-teal-500" />
        <p className="text-sm text-slate-500">جاري تحميل بيانات المتجر من السحابة...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 flex flex-col antialiased selection:bg-teal-500 selection:text-white">
      {/* Desktop Sidebar Navigation */}
      <Sidebar currentTab={currentTab} onNavigate={setCurrentTab} />

      {/* Main App Content Container */}
      <div className="lg:pr-64 flex flex-col flex-1">
        {/* Top Header */}
        <Header
          currentTab={currentTab}
          onNavigate={setCurrentTab}
          onOpenScanner={() => setIsScannerOpen(true)}
        />

        {/* Dynamic Screen View */}
        <main className="flex-1 pt-20 pb-24 lg:pb-8 px-4 sm:px-6 max-w-7xl w-full mx-auto">
          {currentTab === 'pos' && (
            <POSView
              onOpenScanner={() => setIsScannerOpen(true)}
              onOpenFastAdd={handleOpenFastAdd}
              onSaleCompleted={handleSaleCompleted}
              scannedBarcodeToProcess={scannedBarcodeForPOS}
              onClearScannedBarcode={() => setScannedBarcodeForPOS(null)}
            />
          )}

          {currentTab === 'dashboard' && (
            <DashboardView
              onNavigate={setCurrentTab}
              onOpenScanner={() => setIsScannerOpen(true)}
              onOpenAddProduct={() => setIsAddProductOpen(true)}
              onPrintSale={(s) => setActiveReceiptSale(s)}
            />
          )}

          {currentTab === 'inventory' && (
            <InventoryView
              onOpenScanner={() => setIsScannerOpen(true)}
              onOpenAddProduct={() => setIsAddProductOpen(true)}
              onRestockProduct={handleRestockProduct}
            />
          )}

          {currentTab === 'purchases' && (
            <PurchasesView
              initialRestockProduct={productToRestock}
              onClearInitialRestock={() => setProductToRestock(null)}
            />
          )}

          {currentTab === 'debts' && <DebtsView />}

          {currentTab === 'expenses' && <ExpensesView />}

          {currentTab === 'reports' && (
            <ReportsView onPrintSale={(s) => setActiveReceiptSale(s)} />
          )}

          {currentTab === 'settings' && <SettingsView />}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav currentTab={currentTab} onNavigate={setCurrentTab} cartCount={cartCount} />

      {/* Camera Barcode Scanner Modal */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onBarcodeDetected={handleBarcodeDetected}
        onOpenFastAdd={handleOpenFastAdd}
        products={state.products}
      />

      {/* Unknown Barcode Fast Add Modal */}
      {fastAddBarcode && (
        <FastAddProductModal
          isOpen={!!fastAddBarcode}
          barcode={fastAddBarcode}
          onClose={() => setFastAddBarcode(null)}
          onProductCreated={handleFastProductCreated}
        />
      )}

      {/* General Add Product Modal */}
      <AddProductModal
        isOpen={isAddProductOpen}
        onClose={() => setIsAddProductOpen(false)}
        onOpenScanner={() => setIsScannerOpen(true)}
      />

      {/* Thermal Receipt Print Modal */}
      <ThermalReceiptModal
        sale={activeReceiptSale}
        settings={state.settings}
        onClose={() => setActiveReceiptSale(null)}
      />

      {/* System Toast Notifications */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
