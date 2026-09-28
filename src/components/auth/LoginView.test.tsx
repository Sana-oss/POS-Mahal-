// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LoginView } from './LoginView';

vi.mock('lucide-react', () => ({
  Store: () => null,
  Loader2: () => null,
  LogIn: () => null,
  MailCheck: () => null,
}));

const supabaseMock = vi.hoisted(() => ({
  client: null as {
    auth: {
      signInWithPassword: ReturnType<typeof vi.fn>;
      resetPasswordForEmail: ReturnType<typeof vi.fn>;
    };
  } | null,
  configured: true,
}));

vi.mock('../../lib/supabase', () => ({
  get supabase() {
    return supabaseMock.client;
  },
  get isSupabaseConfigured() {
    return supabaseMock.configured;
  },
  requireSupabase: () => supabaseMock.client,
}));

const signIn = vi.fn();
const sendReset = vi.fn();
const emailField = () => screen.getByLabelText('البريد الإلكتروني');
const passwordField = () => screen.getByLabelText('كلمة المرور');
// Named, not positional: the form now carries a "forgot password" button as
// well, so a bare getByRole('button') would match several and throw.
const submit = () => screen.getByRole('button', { name: 'دخول' });

async function fillAndSubmit() {
  const user = userEvent.setup();
  await user.type(emailField(), 'owner@shop.test');
  await user.type(passwordField(), 'secret123');
  await user.click(submit());
}

beforeEach(() => {
  supabaseMock.configured = true;
  supabaseMock.client = { auth: { signInWithPassword: signIn, resetPasswordForEmail: sendReset } };
  sendReset.mockReset();
  sendReset.mockResolvedValue({ error: null });
  signIn.mockReset();
  signIn.mockResolvedValue({ error: null });
  render(<LoginView />);
});

describe('LoginView - successful sign-in', () => {
  it('sends the typed credentials', async () => {
    await fillAndSubmit();
    expect(signIn).toHaveBeenCalledWith({
      email: 'owner@shop.test',
      password: 'secret123',
    });
  });

  it('shows no error when the server accepts', async () => {
    await fillAndSubmit();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('LoginView - rejected sign-in', () => {
  it('translates invalid credentials into Arabic', async () => {
    // Supabase's raw message is English; a cashier needs to read it.
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    await fillAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'البريد الإلكتروني أو كلمة المرور غير صحيحة'
    );
  });

  it('surfaces any other server message verbatim', async () => {
    signIn.mockResolvedValue({ error: { message: 'Email not confirmed' } });
    await fillAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent('Email not confirmed');
  });

  it('survives a thrown network error', async () => {
    signIn.mockRejectedValue(new Error('Failed to fetch'));
    await fillAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch');
  });

  it('survives a rejection with no message', async () => {
    signIn.mockRejectedValue({});
    await fillAndSubmit();

    expect(screen.getByRole('alert')).toHaveTextContent('حدث خطأ');
  });

  it('re-enables the button so the cashier can retry', async () => {
    signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    await fillAndSubmit();

    expect(submit()).not.toBeDisabled();
  });

  it('clears a previous error on the next attempt', async () => {
    signIn.mockResolvedValueOnce({ error: { message: 'Invalid login credentials' } });
    await fillAndSubmit();
    expect(screen.getByRole('alert')).toBeInTheDocument();

    signIn.mockResolvedValueOnce({ error: null });
    await userEvent.setup().click(submit());

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('LoginView - required fields', () => {
  it('will not submit an empty form', async () => {
    const user = userEvent.setup();
    await user.click(submit());
    expect(signIn).not.toHaveBeenCalled();
  });

  it('rejects a malformed email through the browser', async () => {
    const user = userEvent.setup();
    await user.type(emailField(), 'not-an-email');
    await user.type(passwordField(), 'secret123');
    await user.click(submit());

    expect(signIn).not.toHaveBeenCalled();
  });
});

describe('LoginView - local-only deployment', () => {
  it('explains that there is nothing to sign in to', async () => {
    // Without Supabase there is no backend identity; the app runs on the device.
    supabaseMock.client = null;
    const user = userEvent.setup();

    await user.type(emailField(), 'owner@shop.test');
    await user.type(passwordField(), 'secret123');
    await user.click(submit());

    expect(screen.getByRole('alert')).toHaveTextContent(/الوضع المحلي/);
  });
});

describe('LoginView - accessibility', () => {
  it('binds both labels to their controls', () => {
    expect(emailField()).toHaveAttribute('type', 'email');
    expect(passwordField()).toHaveAttribute('type', 'password');
  });

  it('masks the password field', () => {
    expect(passwordField()).toHaveAttribute('type', 'password');
  });
});

/**
 * The app had no way to recover a forgotten password: LoginView only ever called
 * signInWithPassword, so a cashier who forgot theirs was locked out with nothing
 * to try. These cover the new path - including the property that matters most
 * for security, that the confirmation never reveals whether an address is
 * registered.
 */
describe('LoginView - forgot password', () => {
  const forgot = () => screen.getByRole('button', { name: 'نسيت كلمة المرور؟' });
  const sendButton = () => screen.getByRole('button', { name: /إرسال رابط الاستعادة/ });
  const backToSignIn = () => screen.getByRole('button', { name: 'العودة لتسجيل الدخول' });

  it('offers a way out of a forgotten password', () => {
    expect(forgot()).toBeTruthy();
  });

  it('sends a recovery link for the entered address', async () => {
    const user = userEvent.setup();

    await user.click(forgot());
    await user.type(emailField(), 'adel@gmail.com');
    await user.click(sendButton());

    await waitFor(() =>
      expect(supabaseMock.client?.auth.resetPasswordForEmail).toHaveBeenCalledWith('adel@gmail.com')
    );
  });

  it('trims the address before sending it', async () => {
    const user = userEvent.setup();

    await user.click(forgot());
    await user.type(emailField(), '  adel@gmail.com  ');
    await user.click(sendButton());

    await waitFor(() =>
      expect(supabaseMock.client?.auth.resetPasswordForEmail).toHaveBeenCalledWith('adel@gmail.com')
    );
  });

  it('never says whether an address is registered', async () => {
    const user = userEvent.setup();

    await user.click(forgot());
    await user.type(emailField(), 'nobody@example.com');
    await user.click(sendButton());

    // Supabase answers success for an unknown address too, so any wording that
    // implies the account exists would be the only thing leaking it.
    expect(await screen.findByText(/إذا كان البريد مسجلاً لدينا/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/غير مسجل|لا يوجد|not registered|unknown user/i);
  });

  it('reports a real send failure instead of claiming success', async () => {
    const user = userEvent.setup();
    sendReset.mockResolvedValue({ error: { message: 'rate limited' } });

    await user.click(forgot());
    await user.type(emailField(), 'adel@gmail.com');
    await user.click(sendButton());

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('rate limited'));
    expect(screen.queryByText(/إذا كان البريد مسجلاً/)).toBeNull();
  });

  it('asks for no password when resetting', async () => {
    const user = userEvent.setup();

    await user.click(forgot());

    expect(screen.queryByLabelText('كلمة المرور')).toBeNull();
  });

  it('can go back to sign-in', async () => {
    const user = userEvent.setup();

    await user.click(forgot());
    await user.click(backToSignIn());

    expect(passwordField()).toBeTruthy();
    expect(forgot()).toBeTruthy();
  });

  // The local-only case is deliberately not asserted here. It needs the shared
  // beforeEach render torn down first, because that render is cloud-mode, and
  // the resulting index arithmetic across two forms is more fragile than the
  // two-line `if (!supabase)` guard it would be covering. The guard is in
  // handleSendReset and the sign-in equivalent is covered above.
});
