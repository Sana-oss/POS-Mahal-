/**
 * The minimum password length Supabase enforces server-side for
 * `auth.updateUser({ password })`. Validating it here means the cashier is told
 * before the round trip, and the two rules cannot drift apart silently.
 */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Password problems, in the order a cashier should hear about them.
 *
 * Returns a human-readable Arabic problem, or null when the password is
 * acceptable. Shared by the update screen so both fields are judged by one rule
 * rather than a rule per call site.
 */
export function validateNewPassword(
  password: string,
  confirmation: string
): string | null {
  if (!password) return 'اكتب كلمة مرور جديدة.';
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `كلمة المرور قصيرة جداً. الحد الأدنى ${MIN_PASSWORD_LENGTH} أحرف.`;
  }
  if (password !== confirmation) return 'كلمتا المرور غير متطابقتين.';
  return null;
}
