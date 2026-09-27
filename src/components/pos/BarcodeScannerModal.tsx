import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { playSound } from '../../lib/audio';
import { Product } from '../../types';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBarcodeDetected: (barcode: string) => void;
  onOpenFastAdd: (barcode: string) => void;
  products: Product[];
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onBarcodeDetected,
  onOpenFastAdd,
  products,
}) => {
  const [manualCode, setManualCode] = useState('');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [unknownBarcode, setUnknownBarcode] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const isStartingRef = useRef(false);
  const isStoppingRef = useRef(false);
  const isMountedRef = useRef(false);
  const containerId = 'interactive-barcode-reader';

  const safelyStopScanner = async () => {
    if (isStoppingRef.current) return;
    const scanner = scannerRef.current;
    if (!scanner) return;

    isStoppingRef.current = true;
    try {
      if (scanner.isScanning) {
        await scanner.stop();
      }
      try {
        scanner.clear();
      } catch {
        // Ignore clear errors if already detached
      }
    } catch (err) {
      console.debug('Handled scanner stop:', err);
    } finally {
      scannerRef.current = null;
      isStoppingRef.current = false;
      setIsScanning(false);
    }
  };

  const startScanner = async () => {
    if (!isMountedRef.current || isStartingRef.current || isStoppingRef.current) return;
    if (scannerRef.current) {
      await safelyStopScanner();
    }
    if (!isMountedRef.current) return;

    isStartingRef.current = true;
    setCameraError(null);

    try {
      const container = document.getElementById(containerId);
      if (!container || !isMountedRef.current) return;

      const html5QrCode = new Html5Qrcode(containerId);
      scannerRef.current = html5QrCode;

      const config = {
        fps: 15,
        qrbox: { width: 280, height: 160 },
        aspectRatio: 1.777778,
      };

      await html5QrCode.start(
        { facingMode: facingMode },
        config,
        (decodedText) => {
          if (!isMountedRef.current) return;
          handleDetectedCode(decodedText);
        },
        () => {
          // Frame parse failure - standard per frame, ignore
        }
      );

      if (isMountedRef.current) {
        setIsScanning(true);
      } else {
        await safelyStopScanner();
      }
    } catch (err: unknown) {
      if (isMountedRef.current) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!errMsg.includes('transition')) {
          console.warn('Barcode camera access issue:', err);
          setCameraError('تعذر تشغيل الكاميرا: ' + errMsg + '. يمكنك إدخال الباركود يدوياً.');
        }
        setIsScanning(false);
      }
    } finally {
      isStartingRef.current = false;
    }
  };

  // Initialize camera scanner when modal opens
  useEffect(() => {
    isMountedRef.current = true;

    if (isOpen) {
      const timer = setTimeout(() => {
        if (isMountedRef.current && isOpen) {
          startScanner();
        }
      }, 150);

      return () => {
        clearTimeout(timer);
        isMountedRef.current = false;
        safelyStopScanner();
      };
    } else {
      safelyStopScanner();
      setUnknownBarcode(null);
    }

    return () => {
      isMountedRef.current = false;
      safelyStopScanner();
    };
  }, [isOpen, facingMode]);

  const handleDetectedCode = (code: string) => {
    const cleanCode = code.trim();
    if (!cleanCode) return;

    // Check if product exists in database
    const product = products.find((p) => p.barcode === cleanCode);

    if (product) {
      playSound('beep');
      safelyStopScanner();
      onBarcodeDetected(cleanCode);
      onClose();
    } else {
      playSound('warning');
      setUnknownBarcode(cleanCode);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    handleDetectedCode(manualCode);
    setManualCode('');
  };

  const toggleFacingMode = () => {
    safelyStopScanner().then(() => {
      if (isMountedRef.current && isOpen) {
        setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
      }
    });
  };

  const handleModalClose = () => {
    safelyStopScanner();
    onClose();
  };

  // F3 shortcut: while the "unknown barcode" banner is on screen, jump straight
  // to creating that product, matching the button hint on the banner.
  useEffect(() => {
    if (!isOpen || !unknownBarcode) return;

    const handleFastAddShortcut = (event: KeyboardEvent) => {
      if (event.key !== 'F3') return;
      event.preventDefault();
      const code = unknownBarcode;
      handleModalClose();
      onOpenFastAdd(code);
    };

    window.addEventListener('keydown', handleFastAddShortcut);
    return () => window.removeEventListener('keydown', handleFastAddShortcut);
  }, [isOpen, unknownBarcode]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="ماسح الباركود"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col border border-slate-200">
        {/* Header */}
        <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse"></span>
            <span className="font-bold text-base flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[20px]">barcode_scanner</span>
              ماسح الباركود بالكاميرا (F2)
            </span>
          </div>
          <button
            onClick={handleModalClose}
            aria-label="إغلاق الماسح"
            className="w-8 h-8 rounded-full hover:bg-white/10 flex items-center justify-center transition text-slate-300 hover:text-white"
            type="button"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Camera View Area */}
        <div className="relative bg-black min-h-[260px] max-h-[340px] flex items-center justify-center overflow-hidden">
          <div id={containerId} className="w-full h-full"></div>

          {/* Laser Guide overlay */}
          {isScanning && !cameraError && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-64 h-36 border-2 border-teal-400/80 rounded-xl relative shadow-[0_0_15px_rgba(20,184,166,0.3)]">
                {/* Moving red laser scanning beam */}
                <div className="w-full h-0.5 bg-rose-500 shadow-[0_0_8px_#f43f5e] absolute top-1/2 -translate-y-1/2 animate-bounce"></div>
                <div className="absolute top-2 right-2 text-teal-300 text-[11px] font-mono flex items-center gap-1 bg-black/60 px-1.5 py-0.5 rounded">
                  <span className="material-symbols-outlined text-[14px]">center_focus_strong</span>
                  <span>مسح حي</span>
                </div>
                <div className="absolute bottom-2 inset-x-0 text-center text-slate-200 text-xs bg-black/60 mx-4 py-0.5 rounded">
                  وجّه الكاميرا نحو رمز الباركود
                </div>
              </div>
            </div>
          )}

          {/* Camera controls in corner */}
          <div className="absolute bottom-3 right-3 flex items-center gap-2 z-10">
            <button
              onClick={toggleFacingMode}
              className="p-2 rounded-xl bg-black/70 text-white hover:bg-black/90 transition shadow-md"
              title="تبديل الكاميرا (أمامية/خلفية)"
              type="button"
            >
              <span className="material-symbols-outlined text-[20px]">cameraswitch</span>
            </button>
          </div>

          {/* Camera error / fallback display */}
          {cameraError && (
            <div className="absolute inset-0 bg-slate-900/90 p-6 flex flex-col items-center justify-center text-center text-white gap-3 z-20">
              <span className="material-symbols-outlined text-amber-400 text-[40px]">videocam_off</span>
              <p className="text-xs text-slate-300 max-w-xs">{cameraError}</p>
            </div>
          )}
        </div>

        {/* Unknown Barcode Alert Banner */}
        {unknownBarcode && (
          <div className="p-4 bg-rose-50 border-y border-rose-200 flex flex-col gap-2.5 animate-in slide-in-from-top-2">
            <div className="flex items-start gap-2.5">
              <div className="w-8 h-8 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
                <span className="material-symbols-outlined text-[20px]">search_off</span>
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-rose-900 text-sm">هذا المنتج غير مسجل في المحل!</span>
                <p className="text-xs text-rose-700 mt-0.5">
                  الرمز الممسوح <span className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border border-rose-300 text-slate-900" dir="ltr">{unknownBarcode}</span> غير موجود بالمخزون.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => {
                  handleModalClose();
                  onOpenFastAdd(unknownBarcode);
                }}
                className="flex-1 py-2 px-3 bg-teal-600 hover:bg-teal-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm transition active:scale-95"
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                <span>إضافة كمنتج جديد فوراً (F3)</span>
              </button>
              <button
                onClick={() => setUnknownBarcode(null)}
                className="py-2 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-semibold"
                type="button"
              >
                تخطي والمتابعة
              </button>
            </div>
          </div>
        )}

        {/* Manual Barcode Input Fallback */}
        <form onSubmit={handleManualSubmit} className="p-4 bg-slate-50 flex flex-col gap-2">
          <label
            htmlFor="scanner-manual"
            className="text-xs font-bold text-slate-700 flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px] text-teal-600">keyboard</span>
            <span>إدخال الباركود يدوياً أو عبر قارئ الليزر USB:</span>
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                id="scanner-manual"
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="اكتب رقم الباركود (مثال: 628100...)"
                className="w-full bg-white text-slate-800 px-3 py-2.5 rounded-xl border border-slate-300 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 pl-10"
                dir="ltr"
                autoFocus
              />
              <span className="material-symbols-outlined text-slate-400 text-[20px] absolute left-2.5 top-2.5 pointer-events-none">
                barcode
              </span>
            </div>
            <button
              type="submit"
              disabled={!manualCode.trim()}
              className="px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-sm font-bold shadow-sm transition"
            >
              فحص
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
