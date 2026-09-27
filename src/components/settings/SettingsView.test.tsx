// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsView } from './SettingsView';
import { store } from '../../lib/store';

/**
 * The backup controls were inconsistent. handleImportBackup wrote to localStorage
 * and reloaded, but in cloud mode bootstrapFromCloud immediately replaced the
 * cache from Postgres, so the uploaded file was discarded while the UI implied it
 * had been restored. The demo reset was already blocked in cloud mode; restore
 * now matches it. These tests pin that pairing so it cannot regress.
 */

// vi.mock factories are hoisted above the imports, so anything they close over
// has to be created with vi.hoisted or it hits the temporal dead zone.
const cloudState = vi.hoisted(() => ({ active: true }));

const cloudSyncMock = vi.hoisted(() => ({
  BACKUP_ROW_LIMIT: 50000,
  fetchFullSnapshot: vi.fn(),
  isBackupTruncated: vi.fn(() => false),
}));

vi.mock('../../lib/audio', () => ({ playSound: vi.fn() }));
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));

vi.mock('../../services/cloudSync', () => cloudSyncMock);

vi.mock('../../lib/dataSource', () => ({
  isCloudActive: () => cloudState.active,
  getBoundShopId: () => (cloudState.active ? 'shop-1' : null),
  bootstrapFromCloud: vi.fn(),
  refreshFromCloud: vi.fn(),
  refreshOperationalSlices: vi.fn(),
  unbindShop: vi.fn(),
  onSessionEnded: vi.fn(),
  // Mirrors the real guard: the demo seed must never replace real shop data.
  resetToDefault: vi.fn(() => {
    if (cloudState.active) {
      throw new Error('إعادة تعيين البيانات متاحة في الوضع المحلي فقط.');
    }
    store.resetToDefault();
  }),
}));

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement | null;

beforeEach(() => {
  store.resetToDefault();
  cloudState.active = true;
  cloudSyncMock.fetchFullSnapshot.mockReset();
  cloudSyncMock.isBackupTruncated.mockReturnValue(false);
});

describe('SettingsView - backup controls in cloud mode', () => {
  it('disables restore and explains why', () => {
    render(<SettingsView />);

    expect(screen.getByText('غير متاح في وضع السحابة')).toBeInTheDocument();
    // The hidden file input that silently did nothing is not rendered at all.
    expect(fileInput()).toBeNull();
  });

  it('still offers the export, since it produces a real snapshot', () => {
    render(<SettingsView />);

    expect(
      screen.getByRole('button', { name: /تحميل نسخة احتياطية/ })
    ).toBeEnabled();
  });

  it('refuses the demo reset instead of replacing real shop data', async () => {
    // dataSource.resetToDefault() throws in cloud mode. The view must surface
    // that rather than swallow it or, worse, proceed.
    const user = userEvent.setup();
    const before = store.getState().products.length;
    render(<SettingsView />);

    await user.click(screen.getByText('إعادة تعيين البيانات النموذجية'));
    await user.click(screen.getByText('تأكيد الاستعادة'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('متاحة في الوضع المحلي فقط');
    // The shop's data is intact and the dialog is dismissed.
    expect(store.getState().products.length).toBe(before);
  });

  it('can still cancel the demo reset', async () => {
    const user = userEvent.setup();
    render(<SettingsView />);

    await user.click(screen.getByText('إعادة تعيين البيانات النموذجية'));
    await user.click(screen.getByText('إلغاء'));

    expect(screen.queryByText('تأكيد الاستعادة')).not.toBeInTheDocument();
  });
});

describe('SettingsView - backup controls in local-only mode', () => {
  it('enables restore', () => {
    cloudState.active = false;
    render(<SettingsView />);

    expect(screen.queryByText('غير متاح في وضع السحابة')).not.toBeInTheDocument();
    expect(fileInput()).not.toBeNull();
  });

  it('rejects a backup file that is not a shop database', async () => {
    cloudState.active = false;
    const user = userEvent.setup();
    render(<SettingsView />);

    await user.upload(fileInput()!, new File(['{"nope":1}'], 'backup.json'));

    // A native alert() cannot be styled and is blocked in some PWA contexts, so
    // the failure is rendered inline instead.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('ملف النسخة الاحتياطية غير صالح.');
  });

  it('rejects a file that is not JSON at all', async () => {
    cloudState.active = false;
    const user = userEvent.setup();
    render(<SettingsView />);

    await user.upload(fileInput()!, new File(['not json'], 'backup.json'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('حدث خطأ أثناء قراءة ملف النسخة الاحتياطية.');
  });
});
