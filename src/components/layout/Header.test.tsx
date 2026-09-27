// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Header } from './Header';
import { store } from '../../lib/store';
import type { SyncStatus } from '../../lib/dataSource';

/**
 * The header is the register's only always-visible statement about whether data
 * is reaching the database. It previously branched on `pending` alone, so a write
 * that the server had rejected -- pending back to 0, state 'error' -- rendered the
 * reassuring "متزامن مع السحابة" badge.
 */

const syncState = { current: null as SyncStatus | null };

vi.mock('../../hooks/useSyncStatus', () => ({
  useSyncStatus: () => syncState.current as SyncStatus,
}));

vi.mock('../../hooks/useStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useStore')>();
  return { useStore: actual.useStore };
});

vi.mock('../pwa/PWAInstallButton', () => ({ PWAInstallButton: () => null }));

const authState = { mode: 'cloud' as 'cloud' | 'local', profile: null as { full_name: string; role: string } | null };
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState,
}));

const status = (overrides: Partial<SyncStatus> = {}): SyncStatus => ({
  state: 'ready',
  error: null,
  lastSyncAt: Date.now(),
  pending: 0,
  ...overrides,
});

function renderHeader() {
  const props = { onOpenScanner: vi.fn(), onNavigate: vi.fn(), currentTab: 'pos' };
  render(<Header {...props} />);
  return props;
}

beforeEach(() => {
  store.resetToDefault();
  authState.mode = 'cloud';
  authState.profile = null;
  syncState.current = status();
});

describe('Header - shop identity', () => {
  it('shows the shop and branch from settings', () => {
    store.updateSettings({ shop_name: 'سوبرماركت النور', branch_name: 'الفرع الثاني' });
    renderHeader();

    expect(screen.getByText('سوبرماركت النور')).toBeInTheDocument();
    expect(screen.getByText('الفرع الثاني')).toBeInTheDocument();
  });
});

describe('Header - cloud sync indicator', () => {
  it('reports synced when idle', () => {
    renderHeader();
    expect(screen.getByText('متزامن مع السحابة')).toBeInTheDocument();
  });

  it('reports saving while a write is in flight', () => {
    syncState.current = status({ pending: 1 });
    renderHeader();
    expect(screen.getByText('جاري الحفظ في السحابة...')).toBeInTheDocument();
  });

  it('reports a failure instead of claiming success', () => {
    // The regression: pending is 0 after a rejected write, so the old two-way
    // branch showed "synced" immediately after a failure.
    syncState.current = status({ state: 'error', error: 'قيد قاعدة البيانات', pending: 0 });
    renderHeader();

    expect(screen.getByText('تعذر الحفظ في السحابة')).toBeInTheDocument();
    expect(screen.queryByText('متزامن مع السحابة')).not.toBeInTheDocument();
  });

  it('exposes the failure reason for the cashier to hover', () => {
    syncState.current = status({ state: 'error', error: 'الكمية غير متوفرة بالمخزون' });
    renderHeader();
    expect(screen.getByRole('status')).toHaveAttribute('title', 'الكمية غير متوفرة بالمخزون');
  });

  it('prefers the saving state while a write is in flight over a stale error', () => {
    syncState.current = status({ state: 'error', error: 'خطأ سابق', pending: 1 });
    renderHeader();
    expect(screen.getByText('جاري الحفظ في السحابة...')).toBeInTheDocument();
  });

  it('is hidden entirely in local-only mode', () => {
    // There is no cloud to be out of sync with, and showing a stale cloud badge
    // would imply a safety the local mode does not have.
    authState.mode = 'local';
    renderHeader();

    expect(screen.queryByText('متزامن مع السحابة')).not.toBeInTheDocument();
    expect(screen.queryByText('جاري الحفظ في السحابة...')).not.toBeInTheDocument();
    expect(screen.getByText('حفظ محلي')).toBeInTheDocument();
  });

  it('labels the storage mode honestly', () => {
    authState.mode = 'local';
    renderHeader();
    expect(screen.getByText('حفظ محلي')).toBeInTheDocument();
    expect(
      screen.getByTitle('البيانات محفوظة على هذا الجهاز فقط (وضع محلي)')
    ).toBeInTheDocument();
  });
});

describe('Header - profile', () => {
  it('falls back to a generic user when no profile is loaded', () => {
    renderHeader();
    expect(screen.getByText('المستخدم')).toBeInTheDocument();
    expect(screen.getByText('كاشير')).toBeInTheDocument();
  });

  it('shows the name and owner role', () => {
    authState.profile = { full_name: 'سارة أحمد', role: 'owner' };
    renderHeader();
    expect(screen.getByText('سارة أحمد')).toBeInTheDocument();
    expect(screen.getByText('المالك')).toBeInTheDocument();
  });

  it('shows the first letter of the name in the avatar', () => {
    authState.profile = { full_name: 'سارة', role: 'owner' };
    renderHeader();
    expect(screen.getByText('س')).toBeInTheDocument();
  });

  it('is reachable by keyboard, not click only', async () => {
    // It was a <div onClick>, so there was no role, no focus and no key handling.
    authState.profile = { full_name: 'سارة', role: 'owner' };
    const { onNavigate } = renderHeader();

    const button = screen.getByTitle('إعدادات الحساب والمتجر');
    expect(button.tagName).toBe('BUTTON');

    button.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('settings');
  });
});

describe('Header - navigation', () => {
  it('opens the scanner', async () => {
    const user = userEvent.setup();
    const { onOpenScanner } = renderHeader();
    await user.click(screen.getByTitle('مسح باركود بالكاميرا (F2)'));
    expect(onOpenScanner).toHaveBeenCalled();
  });

  it('navigates to reports', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderHeader();
    await user.click(screen.getByTitle('التقارير والأرباح'));
    expect(onNavigate).toHaveBeenCalledWith('reports');
  });
});
