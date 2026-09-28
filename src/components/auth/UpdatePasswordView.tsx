import React, { useState } from 'react';
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from './AuthProvider';
import { validateNewPassword } from '../../lib/password';

/**
 * Shown instead of the POS when the session came from a password-recovery link.
 *
 * Supabase establishes a full session from the emailed link before any new
 * password exists, so without this screen the recovery would drop the cashier
 * into the POS with the old password still in force and no idea the reset was
 * half-finished.
 */
export function UpdatePasswordView() {
  const { updatePassword, cancelRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const problem = validateNewPassword(password, confirmation);
    if (problem) {
      setError(problem);
      return;
    }

    setSaving(true);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر تغيير كلمة المرور.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4" dir="rtl">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-teal-100 text-teal-600 flex items-center justify-center mb-4">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">تعيين كلمة مرور جديدة</h1>
          <p className="text-slate-500 mt-2 text-center">
            {done
              ? 'تم تغيير كلمة المرور بنجاح.'
              : 'أنت على وشك الدخول من رابط الاستعادة. اختر كلمة مرور جديدة للمتابعة.'}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-6 text-center border border-red-100"
          >
            {error}
          </div>
        )}

        {done ? (
          <button
            type="button"
            onClick={() => void cancelRecovery()}
            className="w-full bg-teal-500 text-white py-3 rounded-xl font-medium hover:bg-teal-600 active:bg-teal-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-teal-500/30"
          >
            <span>متابعة إلى نقطة البيع</span>
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 mb-1">
                كلمة المرور الجديدة
              </label>
              <input
                id="new-password"
                type="password"
                dir="ltr"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-slate-50"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700 mb-1">
                تأكيد كلمة المرور
              </label>
              <input
                id="confirm-password"
                type="password"
                dir="ltr"
                required
                autoComplete="new-password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-slate-50"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-teal-500 text-white py-3 rounded-xl font-medium hover:bg-teal-600 active:bg-teal-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-teal-500/30 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <KeyRound className="w-5 h-5" />
                  <span>حفظ كلمة المرور</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => void cancelRecovery()}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              إلغاء والعودة لتسجيل الدخول
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
