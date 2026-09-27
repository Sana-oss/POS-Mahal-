import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Store, Loader2, LogIn } from 'lucide-react';

export function LoginView() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-teal-100 text-teal-600 rounded-2xl flex items-center justify-center mb-4">
            <Store size={32} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">محل POS</h1>
          <p className="text-slate-500 mt-2">تسجيل الدخول للنظام</p>
        </div>

        {error && (
          <div
            role="alert"
            className="bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-6 text-center border border-red-100"
          >
            {error === 'Invalid login credentials' ? 'البريد الإلكتروني أو كلمة المرور غير صحيحة' : error}
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-teal-500 text-white py-3 rounded-xl font-medium hover:bg-teal-600 active:bg-teal-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-teal-500/30"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <LogIn className="w-5 h-5" />
                <span>دخول</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
