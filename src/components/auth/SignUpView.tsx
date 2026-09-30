import React, { useEffect, useState } from 'react';
import { Loader2, LogIn, MailCheck, ShieldCheck, Store, UserPlus } from 'lucide-react';
import {
  fetchInvite,
  signUpInvitedCashier,
  signUpShopOwner,
  type ShopInvite,
} from '../../lib/invites';
import { MIN_PASSWORD_LENGTH } from '../../lib/password';

/**
 * Registration, for both kinds of new account.
 *
 *   No invite   -> creates a shop, and the signup trigger makes this user its
 *                  owner. This is the path that did not exist before migration
 *                  0009; owners previously had to be made in the dashboard.
 *
 *   With invite -> joins the shop that issued it, as a cashier. The trigger sees
 *                  the invited address and links the profile to that shop rather
 *                  than creating a new one, so two cashiers can share one set of
 *                  books.
 *
 * The distinction matters and is not cosmetic: sending shop_name on the cashier
 * path would make the trigger create a second shop for them, which is the exact
 * bug this feature removes.
 */
export function SignUpView({
  inviteToken,
  onBackToLogin,
}: {
  inviteToken: string | null;
  onBackToLogin: () => void;
}) {
  const [invite, setInvite] = useState<ShopInvite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteLoading, setInviteLoading] = useState(Boolean(inviteToken));

  const [fullName, setFullName] = useState('');
  const [shopName, setShopName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = useState(false);

  useEffect(() => {
    if (!inviteToken) {
      setInviteLoading(false);
      return;
    }
    let active = true;
    setInviteLoading(true);
    fetchInvite(inviteToken)
      .then((found) => {
        if (!active) return;
        if (!found) setInviteError('رابط الدعوة غير صالح.');
        else if (!found.is_open) setInviteError('انتهت صلاحية رابط الدعوة أو تم استخدامه.');
        else setInvite(found);
      })
      .catch((e: unknown) => {
        if (active) setInviteError(e instanceof Error ? e.message : 'تعذر التحقق من الدعوة.');
      })
      .finally(() => {
        if (active) setInviteLoading(false);
      });
    return () => {
      active = false;
    };
  }, [inviteToken]);

  // Joining is decided by the token being present, not by the invite resolving.
  // Keyed off `invite` instead, a spent or expired link left `invite` null and
  // the screen silently switched to "open a new shop" - so someone following a
  // dead link was offered to create a second shop rather than being told the
  // link is dead.
  const joining = Boolean(inviteToken);
  const blocked = Boolean(inviteError);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`كلمة المرور قصيرة جداً. الحد الأدنى ${MIN_PASSWORD_LENGTH} أحرف.`);
      return;
    }
    if (!joining && !shopName.trim()) {
      setError('اكتب اسم المحل.');
      return;
    }
    if (!fullName.trim()) {
      setError('اكتب اسمك.');
      return;
    }

    setLoading(true);
    try {
      const result = joining
        ? await signUpInvitedCashier({ email, password, fullName })
        : await signUpShopOwner({ email, password, shopName, fullName });

      // Supabase returns no session when "Confirm email" is on. The account
      // exists either way, so this is a success state, not a failure.
      if (result.needsEmailConfirmation) {
        setAwaitingConfirmation(true);
        return;
      }
      // A session means the trigger has already run: the profile exists, and the
      // AuthProvider will pick it up and sign the cashier into the right shop.
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الحساب.');
    } finally {
      setLoading(false);
    }
  };

  if (inviteLoading) {
    return (
      <CenteredCard>
        <Loader2 className="w-8 h-8 animate-spin text-teal-500 mx-auto" />
        <p className="mt-4 text-center text-sm text-slate-500">جاري التحقق من رابط الدعوة...</p>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <div className="flex flex-col items-center mb-6">
        <div className="w-16 h-16 rounded-2xl bg-teal-100 text-teal-600 flex items-center justify-center mb-4">
          {joining ? <UserPlus className="w-8 h-8" /> : <Store className="w-8 h-8" />}
        </div>
        <h1 className="text-2xl font-bold text-slate-800">
          {joining ? 'الانضمام إلى المتجر' : 'فتح متجر جديد'}
        </h1>
        {joining && invite ? (
          <p className="text-slate-500 mt-2 text-center text-sm">
            دُعيت للانضمام إلى <span className="font-bold text-slate-700">{invite.shop_name}</span> كموظف
            ({invite.role === 'cashier' ? 'كاشير' : invite.role}).
          </p>
        ) : (
          <p className="text-slate-500 mt-2 text-center text-sm">
            أنشئ حساب متجرك. البيانات تُحفظ في سحابة متجرك.
          </p>
        )}
      </div>

      {inviteError && (
        <div role="alert" className="bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-5 text-center border border-red-100">
          {inviteError}
        </div>
      )}

      {awaitingConfirmation ? (
        <div className="space-y-5">
          <div className="bg-emerald-50 text-emerald-800 p-4 rounded-xl text-sm text-center border border-emerald-100">
            <MailCheck className="w-6 h-6 mx-auto mb-2" />
            <p>أرسلنا رابط تأكيد إلى بريدك. أكّد الحساب ثم سجّل الدخول.</p>
          </div>
          <button
            type="button"
            onClick={onBackToLogin}
            className="w-full text-center text-sm text-slate-500 hover:text-slate-700"
          >
            الذهاب لتسجيل الدخول
          </button>
        </div>
      ) : (
        <>
          {error && (
            <div role="alert" className="bg-red-50 text-red-600 p-4 rounded-xl text-sm mb-5 text-center border border-red-100">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="su-name" className="block text-sm font-medium text-slate-700 mb-1">
                اسمك
              </label>
              <input
                id="su-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className={inputClass}
                placeholder="محمد"
              />
            </div>

            {!joining && (
              <div>
                <label htmlFor="su-shop" className="block text-sm font-medium text-slate-700 mb-1">
                  اسم المحل
                </label>
                <input
                  id="su-shop"
                  type="text"
                  required
                  value={shopName}
                  onChange={(e) => setShopName(e.target.value)}
                  className={inputClass}
                  placeholder="متجري"
                />
              </div>
            )}

            <div>
              <label htmlFor="su-email" className="block text-sm font-medium text-slate-700 mb-1">
                البريد الإلكتروني
              </label>
              <input
                id="su-email"
                type="email"
                dir="ltr"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="owner@shop.com"
              />
              {joining && invite && (
                <p className="mt-1 text-xs text-amber-700">
                  استخدم نفس البريد الذي وصلكت منه الدعوة.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="su-password" className="block text-sm font-medium text-slate-700 mb-1">
                كلمة المرور
              </label>
              <input
                id="su-password"
                type="password"
                dir="ltr"
                required
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading || blocked}
              className="w-full bg-teal-500 text-white py-3 rounded-xl font-medium hover:bg-teal-600 active:bg-teal-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-teal-500/30 disabled:opacity-60"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  {joining ? <ShieldCheck className="w-5 h-5" /> : <LogIn className="w-5 h-5" />}
                  <span>{joining ? 'الانضمام للمتجر' : 'إنشاء المتجر'}</span>
                </>
              )}
            </button>
          </form>

          <button
            type="button"
            onClick={onBackToLogin}
            className="mt-4 w-full text-center text-sm text-slate-500 hover:text-slate-700 transition-colors"
          >
            لدي حساب بالفعل
          </button>
        </>
      )}
    </CenteredCard>
  );
}

const inputClass =
  'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-slate-50';

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 flex flex-col justify-center items-center p-4" dir="rtl">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8">{children}</div>
    </div>
  );
}
