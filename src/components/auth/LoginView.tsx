import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Store, Loader2, LogIn, MailCheck } from 'lucide-react';

type Mode = 'signin' | 'forgot';

export function LoginView({ onSignUp }: { onSignUp?: () => void }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError('الاتصال بالسحابة غير مُهيّأ. النظام يعمل حالياً بالوضع المحلي دون تسجيل دخول.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message);
      }
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Email a recovery link.
   *
   * The confirmation is deliberately the same whether or not the address belongs
   * to an account. Saying "no such user" would turn this form into a way to test
   * whether a given email is registered with the shop, which is information a
   * stranger could use. Supabase also returns success for an unknown address, so
   * the honest message is the only one that matches what happened.
   */
  const handleSendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!supabase) {
      setError('الاتصال بالسحابة غير مُهيّأ. الاستعادة تتطلب ربط النظام بالسحابة.');
      return;
    }

    setLoading(true);
    try {
      // No redirectTo: Supabase sends the link to the project's Site URL, which
      // must be the address the app is served from. An unknown or unlisted
      // redirect is silently replaced with the Site URL, so passing a wrong one
      // would send the cashier to a page that never loads the recovery token.
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) {
        setError(error.message);
        return;
      }
      setSent(true);
    } catch (err: any) {
      setError(err.message || 'تعذر إرسال رابط الاستعادة.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-teal-100 text-teal-600 rounded-2xl flex items-center justify-center mb-4">
            <Store size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            {mode === 'signin' ? 'محل POS' : 'استعادة كلمة المرور'}
          </h1>
          <p className="text-slate-500 mt-2">
            {mode === 'signin' ? 'تسجيل الدخول للنظام' : 'أدخل بريدك المسجل لإرسال رابط تعيين كلمة مرور جديدة'}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-6 text-center border border-red-100"
          >
            {error === 'Invalid login credentials' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : error}
          </div>
        )}

        {sent ? (
          <div className="space-y-5">
            <div className="bg-emerald-50 text-emerald-800 p-4 rounded-xl text-sm text-center border border-emerald-100">
              <MailCheck className="w-6 h-6 mx-auto mb-2" />
              <p>إذا كان البريد مسجلاً لدينا، فقد أرسلنا إليه رابط تعيين كلمة مرور جديدة.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setMode('signin');
              }}
              className="w-full text-center text-sm text-slate-500 hover:text-slate-700 transition-colors"
            >
              العودة لتسجيل الدخول
            </button>
          </div>
        ) : (
          <form onSubmit={mode === 'signin' ? handleLogin : handleSendReset} className="space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1">البريد الإلكتروني</label>
              <input
                id="login-email"
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-slate-50"
                placeholder="admin@mahallpos.com"
              />
            </div>

            {mode === 'signin' && (
              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1">كلمة المرور</label>
                <input
                  id="login-password"
                  type="password"
                  dir="ltr"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-slate-50"
                  placeholder="••••••••"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-teal-500 text-white py-3 rounded-xl font-medium hover:bg-teal-600 active:bg-teal-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-teal-500/30 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : mode === 'signin' ? (
                <>
                  <LogIn className="w-5 h-5" />
                  <span>دخول</span>
                </>
              ) : (
                <>
                  <MailCheck className="w-5 h-5" />
                  <span>إرسال رابط الاستعادة</span>
                </>
              )}
            </button>

            <div className="text-center">
              {mode === 'signin' ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setError(null);
                  }}
                  className="text-sm text-teal-600 hover:text-teal-700 transition-colors"
                >
                  نسيت كلمة المرور؟
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode('signin');
                    setError(null);
                  }}
                  className="text-sm text-slate-500 hover:text-slate-700 transition-colors"
                >
                  العودة لتسجيل الدخول
                </button>
              )}
            </div>
          </form>
        )}

        {/* Registration, for a new shop owner or a cashier joining by invite.
            Shown only on the sign-in screen: a cashier arriving from an invite
            link lands on the join screen instead, and must not be able to
            wander into creating a shop by accident. */}
        {onSignUp && mode === 'signin' && !sent && (
          <div className="mt-5 pt-5 border-t border-slate-100 text-center">
            <button
              type="button"
              onClick={onSignUp}
              className="text-sm text-slate-500 hover:text-teal-600 transition-colors"
            >
              ليس لديك حساب؟ افتح متجراً جديداً أو انضم بدعوة
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
