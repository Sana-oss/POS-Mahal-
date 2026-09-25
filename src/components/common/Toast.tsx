import React from 'react';

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
}

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 left-6 z-50 flex flex-col gap-2 pointer-events-none max-w-sm w-full">
      {toasts.map((toast) => {
        let bg = 'bg-slate-900 text-white';
        let icon = 'check_circle';
        let iconColor = 'text-teal-400';

        if (toast.type === 'error') {
          bg = 'bg-rose-900 text-white border border-rose-700';
          icon = 'error';
          iconColor = 'text-rose-400';
        } else if (toast.type === 'warning') {
          bg = 'bg-amber-900 text-white border border-amber-700';
          icon = 'warning';
          iconColor = 'text-amber-400';
        } else if (toast.type === 'info') {
          bg = 'bg-indigo-900 text-white border border-indigo-700';
          icon = 'info';
          iconColor = 'text-indigo-400';
        }

        return (
          <div
            key={toast.id}
            className={`${bg} px-4 py-3 rounded-xl shadow-xl flex items-center justify-between gap-3 pointer-events-auto transition-all transform animate-in slide-in-from-bottom-3 duration-200`}
          >
            <div className="flex items-center gap-2.5">
              <span className={`material-symbols-outlined ${iconColor} text-[22px]`}>{icon}</span>
              <span className="text-sm font-medium leading-snug">{toast.message}</span>
            </div>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-slate-400 hover:text-white p-1 rounded-lg"
              type="button"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};
