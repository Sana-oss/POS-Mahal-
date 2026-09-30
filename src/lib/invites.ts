import { supabase } from './supabase';

/**
 * Shop sign-up and owner-issued cashier invites (migration 0009).
 *
 * Two things this replaces:
 *
 *   - Creating a shop owner meant making an account in the Supabase dashboard by
 *     hand. handle_new_user() always created a shop, but nothing in the app ever
 *     called signUp, so that path was only reachable from the database side.
 *
 *   - A second cashier could not join an existing shop. The signup trigger gave
 *     every new user a brand new shop, so signing up as a colleague silently
 *     produced a separate shop with its own books.
 *
 * The invite is a bearer credential, so the client treats it as one: it is read
 * from the URL, never stored, and never logged.
 */

export interface ShopInvite {
  shop_name: string;
  role: 'cashier';
  expires_at: string;
  is_open: boolean;
}

export interface CreatedInvite {
  token: string;
  expires_at: string;
}

/** Reads the invite token from the URL, tolerating a missing or malformed one. */
export function inviteTokenFromUrl(href: string = window.location.href): string | null {
  try {
    const token = new URL(href).searchParams.get('invite');
    return token && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/**
 * What the joiner is being asked to accept.
 *
 * Reachable before sign-in, so the RPC behind it deliberately returns only the
 * shop name and role - never the token, the invited address, or the issuer.
 */
export async function fetchInvite(token: string): Promise<ShopInvite | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('get_shop_invite', { p_token: token });
  if (error) throw new Error(error.message);
  // A single-row function returns an array; an unknown token returns none.
  const row = Array.isArray(data) ? data[0] : data;
  return (row as ShopInvite | undefined) ?? null;
}

/** Owner-only. Issues (or reissues) an invite for a cashier at `email`. */
export async function createInvite(email: string): Promise<CreatedInvite> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('create_shop_invite', {
    p_email: email.trim(),
    p_role: 'cashier',
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.token) throw new Error('The invite could not be created.');
  return row as CreatedInvite;
}

/**
 * Redeem an invite after sign-in.
 *
 * The signup trigger already links someone who signs up with an invited address,
 * so this is the recovery path: confirm-email-then-join, or an invite that
 * arrived after the account was created.
 */
export async function acceptInvite(token: string): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.rpc('accept_shop_invite', { p_token: token });
  if (error) throw new Error(error.message);
  return String(data);
}

/**
 * Create an owner account and its shop.
 *
 * `shop_name` and `full_name` go into user metadata, which is where
 * handle_new_user() reads them. A cashier joining an existing shop must not send
 * shop_name: the trigger would read it and create a shop for them.
 *
 * Supabase returns a session when email confirmation is off and null when it is
 * on, so the caller has to handle both.
 */
export async function signUpShopOwner(input: {
  email: string;
  password: string;
  shopName: string;
  fullName: string;
}): Promise<{ session: unknown | null; needsEmailConfirmation: boolean }> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: { shop_name: input.shopName.trim(), full_name: input.fullName.trim() },
    },
  });
  if (error) throw new Error(error.message);
  return { session: data.session ?? null, needsEmailConfirmation: data.session === null };
}

/** Sign up a joiner. No shop_name, so the trigger cannot create a shop for them. */
export async function signUpInvitedCashier(input: {
  email: string;
  password: string;
  fullName: string;
}): Promise<{ session: unknown | null; needsEmailConfirmation: boolean }> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { full_name: input.fullName.trim() } },
  });
  if (error) throw new Error(error.message);
  return { session: data.session ?? null, needsEmailConfirmation: data.session === null };
}

/**
 * The URL a cashier opens.
 *
 * The token is put in the query string rather than the fragment because the
 * Supabase client does not read a fragment, and a fragment would also keep it out
 * of server logs - but a query string is what an invite link has to be, so it is
 * treated as a secret: it is never logged by us, and the RPCs do not echo it back.
 */
export function inviteLink(token: string, origin: string = window.location.origin): string {
  return `${origin}/?invite=${encodeURIComponent(token)}`;
}
