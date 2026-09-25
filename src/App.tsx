/**
 * Mahall POS (محل POS)
 * A fast Arabic RTL POS, inventory, debt, expense, and profit-management system
 * for small grocery and food stores.
 */

import React, { useState } from 'react';
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
import { Product, Sale } from './types';

export default function App() {
  const { state } = useStore();
  const [currentTab, setCurrentTab] = useState<string>('pos');

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
      <MobileNav currentTab={currentTab} onNavigate={setCurrentTab} />

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
