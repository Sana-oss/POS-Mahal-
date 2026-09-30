import React, { useState } from 'react';
import { Check, Copy, Link2, Loader2, Mail, UserPlus } from 'lucide-react';
import { createInvite, inviteLink } from '../../lib/invites';
import { isCloudActive } from '../../lib/dataSource';

/**
 * Owner-only panel for bringing a cashier onto this shop's books.
 *
 * Without it, a second user signing up got a brand new shop with its own data -
 * two tills, two sets of books - because the signup trigger always created a
 * shop. An invite redirects that new account into the existing one.
 *
 * The link is a bearer credential, so it is shown once, never stored, and the
 * owner is told to send it privately.
 */
export function StaffInvitePanel({ role }: { role: string | undefined }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Not an owner, or not on the cloud: the RPC would refuse either way, so do not
  // offer an action that cannot succeed.
  if (role !== 'owner' || !isCloudActive()) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLink(null);
    setCopied(false);
    setBusy(true);
    try {
      const invite = await createInvite(email);
      setLink(inviteLink(invite.token));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'تعذر إنشاء الدعوة.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError('تعذر النسخ تلقائياً. انسخ الرابط يدوياً من الحقل أدناه.');
    }
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col gap-4">
      <h2 className="text-sm font-bold text-slate-800 pb-2 border-b border-slate-100 flex items-center gap-1.5">
        <span className="material-symbols-outlined text-[20px] text-teal-600">group_add</span>
        <span>إضافة موظف للمتجر</span>
      </h2>

      <p className="text-[11px] text-slate-500 leading-5">
        يُنشأ رابط دعوة يتيح لصاحب كاشير فتح حساب وربطه بسجل متجرك، فيرى نفس
        المنتجات والفواتير والديون. صالح لأسبوعين، ويمكنك إصدار رابط جديد في أي وقت.
      </p>

      {error && (
        <div role="alert" className="bg-red-50 text-red-600 p-3 rounded-xl text-xs border border-red-100">
          {error}
        </div>
      )}

      <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Mail className="absolute top-1/2 -translate-y-1/2 right-3 w-4 h-4 text-slate-400" />
          <input
            type="email"
            dir="ltr"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="cashier@shop.com"
            className="w-full pr-9 pl-3 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          />
        </div>
        <button
          type="submit"
          disabled={busy}
          className="bg-teal-500 text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-teal-600 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <>
              <UserPlus className="w-4 h-4" />
              <span>أنشئ رابط</span>
            </>
          )}
        </button>
      </form>

      {link && (
        <div className="flex flex-col gap-2 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-800">
            <Link2 className="w-3.5 h-3.5" />
            <span>أرسل هذا الرابط للموظف على انفراد. يربطه بحسابك مباشرة.</span>
          </div>
          <div className="flex gap-2">
            <input
              readOnly
              dir="ltr"
              value={link}
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1 px-3 py-2 rounded-lg border border-emerald-200 bg-white text-xs font-mono focus:outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-colors flex items-center gap-1.5"
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
