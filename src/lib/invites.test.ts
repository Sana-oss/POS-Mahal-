import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
const signUp = vi.hoisted(() => vi.fn());
const configured = vi.hoisted(() => ({ value: true }));

vi.mock('./supabase', () => ({
  get isSupabaseConfigured() {
    return configured.value;
  },
  get supabase() {
    return configured.value ? { rpc, auth: { signUp } } : null;
  },
}));

import {
  acceptInvite,
  createInvite,
  fetchInvite,
  inviteLink,
  inviteTokenFromUrl,
  signUpInvitedCashier,
  signUpShopOwner,
} from './invites';

const rows = (data: unknown) => ({ data, error: null });
const fail = (message: string) => ({ data: null, error: { message } });

beforeEach(() => {
  configured.value = true;
  rpc.mockReset();
  signUp.mockReset();
});

describe('inviteTokenFromUrl', () => {
  it('reads the token from the query string', () => {
    expect(inviteTokenFromUrl('https://shop.app/?invite=abc123')).toBe('abc123');
  });

  it('is null when there is no token', () => {
    expect(inviteTokenFromUrl('https://shop.app/')).toBeNull();
    expect(inviteTokenFromUrl('https://shop.app/?invite=')).toBeNull();
  });

  it('is null rather than throwing on a malformed url', () => {
    // A throw here would blank the whole app on a malformed link.
    expect(inviteTokenFromUrl('not a url')).toBeNull();
  });
});

describe('fetchInvite', () => {
  it('unwraps the single row a table function returns', async () => {
    rpc.mockResolvedValueOnce(rows([{ shop_name: 'متجري', role: 'cashier', expires_at: 'x', is_open: true }]));
    await expect(fetchInvite('t1')).resolves.toMatchObject({ shop_name: 'متجري', is_open: true });
  });

  it('is null for an unknown token', async () => {
    rpc.mockResolvedValueOnce(rows([]));
    await expect(fetchInvite('nope')).resolves.toBeNull();
  });

  it('surfaces the server message', async () => {
    rpc.mockResolvedValueOnce(fail('boom'));
    await expect(fetchInvite('t1')).rejects.toThrow('boom');
  });
});

describe('createInvite', () => {
  it('requests a cashier invite and trims the address', async () => {
    rpc.mockResolvedValueOnce(rows([{ token: 'tok', expires_at: 'soon' }]));
    await createInvite('  cashier@shop.com  ');
    expect(rpc).toHaveBeenCalledWith('create_shop_invite', {
      p_email: 'cashier@shop.com',
      p_role: 'cashier',
    });
  });

  it('never asks for a role other than cashier', async () => {
    // A second owner would be a privilege change; the RPC refuses it, and the
    // client must not even offer it.
    rpc.mockResolvedValueOnce(rows([{ token: 't', expires_at: 'x' }]));
    await createInvite('a@b.com');
    expect(rpc.mock.calls[0][1].p_role).toBe('cashier');
  });

  it('rejects a response with no token rather than returning a broken link', async () => {
    rpc.mockResolvedValueOnce(rows([]));
    await expect(createInvite('a@b.com')).rejects.toThrow(/could not be created/i);
  });
});

describe('acceptInvite', () => {
  it('returns the shop id', async () => {
    rpc.mockResolvedValueOnce({ data: 'shop-uuid', error: null });
    await expect(acceptInvite('tok')).resolves.toBe('shop-uuid');
  });

  it('surfaces the refusal when the invite is spent or for another address', async () => {
    rpc.mockResolvedValueOnce(fail('This invite has already been used'));
    await expect(acceptInvite('tok')).rejects.toThrow(/already been used/);
  });
});

describe('signUpShopOwner', () => {
  it('sends the shop name in metadata, where the trigger reads it', async () => {
    signUp.mockResolvedValueOnce({ data: { session: { id: 's' } }, error: null });
    const result = await signUpShopOwner({
      email: ' owner@shop.com ',
      password: 'secret123',
      shopName: ' بقالة النور ',
      fullName: ' محمد ',
    });
    expect(result.needsEmailConfirmation).toBe(false);
    expect(signUp).toHaveBeenCalledWith({
      email: 'owner@shop.com',
      password: 'secret123',
      options: { data: { shop_name: 'بقالة النور', full_name: 'محمد' } },
    });
  });

  it('reports when email confirmation is required', async () => {
    // Supabase returns no session when Confirm email is on, and the account
    // still exists. Reporting that as failure would push people to sign up twice.
    signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
    const result = await signUpShopOwner({ email: 'a@b.com', password: 'secret123', shopName: 's', fullName: 'n' });
    expect(result.session).toBeNull();
    expect(result.needsEmailConfirmation).toBe(true);
  });
});

describe('signUpInvitedCashier', () => {
  it('never sends a shop name, so the trigger cannot create a shop', async () => {
    // This is the whole point of the flow. Sending shop_name would make
    // handle_new_user create a second shop for the cashier - the exact bug the
    // invite exists to prevent.
    signUp.mockResolvedValueOnce({ data: { session: null }, error: null });
    await signUpInvitedCashier({ email: 'c@shop.com', password: 'secret123', fullName: 'سالم' });
    const options = signUp.mock.calls[0][0].options;
    expect(options.data.shop_name).toBeUndefined();
    expect(options.data.full_name).toBe('سالم');
  });
});

describe('inviteLink', () => {
  it('builds an origin-relative link with an encoded token', () => {
    expect(inviteLink('a b/c', 'https://shop.app')).toBe('https://shop.app/?invite=a%20b%2Fc');
  });

  it('round-trips through the reader', () => {
    const token = 'deadbeef';
    const link = inviteLink(token, 'https://shop.app');
    expect(inviteTokenFromUrl(link)).toBe(token);
  });
});

describe('local-only mode', () => {
  it('refuses rather than pretending to work', async () => {
    configured.value = false;
    await expect(createInvite('a@b.com')).rejects.toThrow(/not configured/i);
    await expect(acceptInvite('t')).rejects.toThrow(/not configured/i);
    await expect(signUpShopOwner({ email: 'a@b.com', password: 'p', shopName: 's', fullName: 'n' })).rejects.toThrow(
      /not configured/i
    );
  });
});
