// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SignUpView } from './SignUpView';

const invites = vi.hoisted(() => ({
  fetchInvite: vi.fn(),
  signUpShopOwner: vi.fn(),
  signUpInvitedCashier: vi.fn(),
}));

vi.mock('../../lib/invites', () => invites);

/**
 * Two account kinds share one screen, and the difference is the whole feature:
 *
 *   no invite   -> opens a shop, and the signup trigger makes this user its owner
 *   with invite -> joins the shop that issued it, as a cashier
 *
 * Getting the second one wrong is silent and expensive: sending a shop name on
 * the join path makes the trigger create a *second* shop, so the cashier works
 * from their own empty books while believing they are on the shop's.
 */
const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText(/اسمك/), 'سالم');
  await user.type(screen.getByLabelText(/البريد الإلكتروني/), 'salem@shop.com');
  await user.type(screen.getByLabelText(/كلمة المرور/), 'secret123');
};

beforeEach(() => {
  invites.fetchInvite.mockReset().mockResolvedValue(null);
  invites.signUpShopOwner.mockReset().mockResolvedValue({ session: {}, needsEmailConfirmation: false });
  invites.signUpInvitedCashier.mockReset().mockResolvedValue({ session: {}, needsEmailConfirmation: false });
});

describe('SignUpView - opening a new shop', () => {
  it('asks for a shop name as well as a name, email and password', () => {
    render(<SignUpView inviteToken={null} onBackToLogin={vi.fn()} />);
    expect(screen.getByLabelText(/اسمك/)).toBeTruthy();
    expect(screen.getByLabelText(/اسم المحل/)).toBeTruthy();
    expect(screen.getByLabelText(/البريد الإلكتروني/)).toBeTruthy();
    expect(screen.getByLabelText(/كلمة المرور/)).toBeTruthy();
  });

  it('creates the shop owner, passing the shop name through', async () => {
    const user = userEvent.setup();
    render(<SignUpView inviteToken={null} onBackToLogin={vi.fn()} />);

    await user.type(screen.getByLabelText(/اسمك/), 'سالم');
    await user.type(screen.getByLabelText(/اسم المحل/), 'بقالة النور');
    await user.type(screen.getByLabelText(/البريد الإلكتروني/), 'salem@shop.com');
    await user.type(screen.getByLabelText(/كلمة المرور/), 'secret123');
    await user.click(screen.getByRole('button', { name: /إنشاء المتجر/ }));

    await waitFor(() =>
      expect(invites.signUpShopOwner).toHaveBeenCalledWith({
        email: 'salem@shop.com',
        password: 'secret123',
        shopName: 'بقالة النور',
        fullName: 'سالم',
      })
    );
    expect(invites.signUpInvitedCashier).not.toHaveBeenCalled();
  });

  it('refuses a short password before calling the server', async () => {
    const user = userEvent.setup();
    render(<SignUpView inviteToken={null} onBackToLogin={vi.fn()} />);

    // Every required field, because a missing one would make the browser block
    // submission and the alert would never appear - a false pass.
    await user.type(screen.getByLabelText(/اسمك/), 'سالم');
    await user.type(screen.getByLabelText(/اسم المحل/), 'متجري');
    await user.type(screen.getByLabelText(/البريد الإلكتروني/), 'a@b.com');
    await user.type(screen.getByLabelText(/كلمة المرور/), 'abc');
    await user.click(screen.getByRole('button', { name: /إنشاء المتجر/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/قصيرة/);
    expect(invites.signUpShopOwner).not.toHaveBeenCalled();
  });
});

describe('SignUpView - joining by invite', () => {
  const openInvite = {
    shop_name: 'بقالة النور',
    role: 'cashier' as const,
    expires_at: '2099-01-01',
    is_open: true,
  };

  it('shows which shop is being joined', async () => {
    invites.fetchInvite.mockResolvedValue(openInvite);
    render(<SignUpView inviteToken="tok" onBackToLogin={vi.fn()} />);

    expect(await screen.findByText('بقالة النور')).toBeTruthy();
  });

  it('never offers a shop name, because the joiner must not create one', async () => {
    // This is the assertion that matters most. The trigger reads shop_name from
    // metadata, so showing the field would let a joiner create a second shop.
    invites.fetchInvite.mockResolvedValue(openInvite);
    render(<SignUpView inviteToken="tok" onBackToLogin={vi.fn()} />);

    await screen.findByText('بقالة النور');
    expect(screen.queryByLabelText(/اسم المحل/)).toBeNull();
  });

  it('signs up as an invited cashier, not as a shop owner', async () => {
    const user = userEvent.setup();
    invites.fetchInvite.mockResolvedValue(openInvite);
    render(<SignUpView inviteToken="tok" onBackToLogin={vi.fn()} />);
    await screen.findByText('بقالة النور');

    await fill(user);
    await user.click(screen.getByRole('button', { name: /الانضمام للمتجر/ }));

    await waitFor(() =>
      expect(invites.signUpInvitedCashier).toHaveBeenCalledWith({
        email: 'salem@shop.com',
        password: 'secret123',
        fullName: 'سالم',
      })
    );
    expect(invites.signUpShopOwner).not.toHaveBeenCalled();
  });

  it('tells the joiner which address the invite was issued to', async () => {
    invites.fetchInvite.mockResolvedValue(openInvite);
    render(<SignUpView inviteToken="tok" onBackToLogin={vi.fn()} />);
    expect(await screen.findByText(/نفس البريد الذي وصلكت منه الدعوة/)).toBeTruthy();
  });

  it('refuses to continue on a used or expired invite', async () => {
    const user = userEvent.setup();
    invites.fetchInvite.mockResolvedValue({ ...openInvite, is_open: false });
    render(<SignUpView inviteToken="tok" onBackToLogin={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/انتهت صلاحية/);
    expect(screen.getByRole('button', { name: /الانضمام للمتجر/ })).toBeDisabled();
  });

  it('refuses an unknown token', async () => {
    invites.fetchInvite.mockResolvedValue(null);
    render(<SignUpView inviteToken="bad" onBackToLogin={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/غير صالح/);
  });

  it('waits for the invite before enabling the form', async () => {
    let release: (v: ShopInviteLike) => void = () => {};
    invites.fetchInvite.mockReturnValueOnce(new Promise((res) => (release = res)));
    render(<SignUpView inviteToken="tok" onBackToLogin={vi.fn()} />);

    expect(screen.getByText(/جاري التحقق/)).toBeTruthy();
    release(openInvite);
    await waitFor(() => expect(screen.queryByText(/جاري التحقق/)).toBeNull());
  });
});

type ShopInviteLike = { shop_name: string; role: 'cashier'; expires_at: string; is_open: boolean };

describe('SignUpView - email confirmation', () => {
  it('treats a confirmation-required signup as success, not failure', async () => {
    // Supabase returns no session when Confirm email is on. Showing an error here
    // would push people to sign up twice and end up with two accounts.
    const user = userEvent.setup();
    invites.signUpShopOwner.mockResolvedValue({ session: null, needsEmailConfirmation: true });
    render(<SignUpView inviteToken={null} onBackToLogin={vi.fn()} />);

    await user.type(screen.getByLabelText(/اسمك/), 'سالم');
    await user.type(screen.getByLabelText(/اسم المحل/), 'متجري');
    await user.type(screen.getByLabelText(/البريد الإلكتروني/), 'a@b.com');
    await user.type(screen.getByLabelText(/كلمة المرور/), 'secret123');
    await user.click(screen.getByRole('button', { name: /إنشاء المتجر/ }));

    expect(await screen.findByText(/أرسلنا رابط تأكيد/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('SignUpView - failures', () => {
  it('surfaces a duplicate account without wiping what was typed', async () => {
    const user = userEvent.setup();
    invites.signUpShopOwner.mockRejectedValue(new Error('User already registered'));
    render(<SignUpView inviteToken={null} onBackToLogin={vi.fn()} />);

    await user.type(screen.getByLabelText(/اسمك/), 'سالم');
    await user.type(screen.getByLabelText(/اسم المحل/), 'متجري');
    await user.type(screen.getByLabelText(/البريد الإلكتروني/), 'taken@shop.com');
    await user.type(screen.getByLabelText(/كلمة المرور/), 'secret123');
    await user.click(screen.getByRole('button', { name: /إنشاء المتجر/ }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already registered/);
    // Losing the typed name after an error is how people sign up twice.
    expect((screen.getByLabelText(/اسم المحل/) as HTMLInputElement).value).toBe('متجري');
  });
});
