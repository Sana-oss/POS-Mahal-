// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { makeProduct } from '../../test/fixtures';
import type { Product } from '../../types';

/**
 * The scanner is the busiest control in the shop. html5-qrcode is replaced with a
 * fake so the decode callback can be fired on demand, which is the only way to
 * test the routing decision (known product vs unknown) without a camera.
 */

const scanner = vi.hoisted(() => ({
  instances: [] as FakeScanner[],
  startShouldThrow: null as string | null,
}));

interface FakeScanner {
  id: string;
  isScanning: boolean;
  started: boolean;
  stopped: number;
  cleared: number;
  facing: string | null;
  onSuccess?: (text: string) => void;
}

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    // The component reads `scanner.isScanning` on the instance itself, so it has
    // to be a real property here and not only on the test-facing record.
    isScanning = false;
    private self: FakeScanner;
    constructor(id: string) {
      this.self = { id, isScanning: false, started: false, stopped: 0, cleared: 0, facing: null };
      scanner.instances.push(this.self);
    }
    async start(
      camera: { facingMode: string },
      _config: unknown,
      onSuccess: (t: string) => void
    ) {
      if (scanner.startShouldThrow) throw new Error(scanner.startShouldThrow);
      this.isScanning = true;
      this.self.isScanning = true;
      this.self.started = true;
      this.self.facing = camera.facingMode;
      this.self.onSuccess = onSuccess;
    }
    async stop() {
      this.self.stopped += 1;
      this.isScanning = false;
      this.self.isScanning = false;
    }
    clear() {
      this.self.cleared += 1;
    }
  },
}));

const playSound = vi.hoisted(() => vi.fn());
vi.mock('../../lib/audio', () => ({ playSound }));

const KNOWN = '1111111111111';
const UNKNOWN = '9999999999999';

const products: Product[] = [makeProduct({ name: 'حليب', barcode: KNOWN })];

function renderModal(overrides: Partial<Parameters<typeof BarcodeScannerModal>[0]> = {}) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    onBarcodeDetected: vi.fn(),
    onOpenFastAdd: vi.fn(),
    products,
    ...overrides,
  };
  const result = render(<BarcodeScannerModal {...props} />);
  return { ...props, unmount: result.unmount };
}

const latest = () => scanner.instances[scanner.instances.length - 1];
const manualField = () => screen.getByLabelText(/إدخال الباركود يدوياً/);
const checkButton = () => screen.getByText('فحص');

/** Wait past the 150ms mount delay, then fire a decode from the fake scanner. */
async function decode(code: string) {
  await waitFor(() => expect(latest()?.onSuccess).toBeTypeOf('function'));
  await act(async () => {
    latest().onSuccess!(code);
  });
}

beforeEach(() => {
  vi.useRealTimers();
  scanner.instances = [];
  scanner.startShouldThrow = null;
  playSound.mockReset();
});

describe('BarcodeScannerModal - lifecycle', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <BarcodeScannerModal
        isOpen={false}
        onClose={vi.fn()}
        onBarcodeDetected={vi.fn()}
        onOpenFastAdd={vi.fn()}
        products={products}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('starts the camera once open', async () => {
    renderModal();
    await waitFor(() => expect(latest()?.started).toBe(true));
    expect(latest().facing).toBe('environment');
  });

  it('stops the camera on unmount so the light is released', async () => {
    const { unmount } = renderModal();
    await waitFor(() => expect(latest()?.started).toBe(true));

    unmount();

    await waitFor(() => expect(latest().stopped).toBeGreaterThan(0));
  });

  it('closes and stops the camera from the close button', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await waitFor(() => expect(latest()?.started).toBe(true));

    await user.click(screen.getByLabelText('إغلاق الماسح'));

    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(latest().stopped).toBeGreaterThan(0));
  });
});

describe('BarcodeScannerModal - a known barcode', () => {
  it('reports it and closes', async () => {
    const { onBarcodeDetected, onClose } = renderModal();
    await decode(KNOWN);

    expect(onBarcodeDetected).toHaveBeenCalledWith(KNOWN);
    expect(onClose).toHaveBeenCalled();
  });

  it('trims whitespace from the decoded text', async () => {
    // Scanners often append a newline or a trailing space.
    const { onBarcodeDetected } = renderModal();
    await decode(`  ${KNOWN}\n`);

    expect(onBarcodeDetected).toHaveBeenCalledWith(KNOWN);
  });

  it('beeps on success', async () => {
    renderModal();
    await decode(KNOWN);
    expect(playSound).toHaveBeenCalledWith('beep');
  });

  it('ignores an empty decode', async () => {
    const { onBarcodeDetected, onClose } = renderModal();
    await decode('   ');

    expect(onBarcodeDetected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not offer fast-add for a product that already exists', async () => {
    const { onOpenFastAdd } = renderModal();
    await decode(KNOWN);

    expect(onOpenFastAdd).not.toHaveBeenCalled();
    expect(screen.queryByText(/غير مسجل في المحل/)).not.toBeInTheDocument();
  });
});

describe('BarcodeScannerModal - an unknown barcode', () => {
  it('warns and keeps the scanner open', async () => {
    // Closing here would lose the scan and force a re-scan.
    const { onBarcodeDetected, onClose } = renderModal();
    await decode(UNKNOWN);

    expect(playSound).toHaveBeenCalledWith('warning');
    expect(onBarcodeDetected).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/غير مسجل في المحل/)).toBeInTheDocument();
  });

  it('offers to create the product, carrying the code through', async () => {
    const user = userEvent.setup();
    const { onOpenFastAdd, onClose } = renderModal();
    await decode(UNKNOWN);

    await user.click(screen.getByText(/إضافة كمنتج جديد فوراً/));

    expect(onOpenFastAdd).toHaveBeenCalledWith(UNKNOWN);
    expect(onClose).toHaveBeenCalled();
  });

  it('supports the F3 shortcut for the same action', async () => {
    const { onOpenFastAdd, onClose } = renderModal();
    await decode(UNKNOWN);

    await userEvent.setup().keyboard('{F3}');

    expect(onOpenFastAdd).toHaveBeenCalledWith(UNKNOWN);
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores F3 when nothing is pending', async () => {
    const { onOpenFastAdd } = renderModal();
    await userEvent.setup().keyboard('{F3}');
    expect(onOpenFastAdd).not.toHaveBeenCalled();
  });

  it('can be dismissed to keep scanning', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await decode(UNKNOWN);

    await user.click(screen.getByText('تخطي والمتابعة'));

    expect(screen.queryByText(/غير مسجل في المحل/)).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('BarcodeScannerModal - manual entry fallback', () => {
  it('routes a typed known code like a scan', async () => {
    const user = userEvent.setup();
    const { onBarcodeDetected, onClose } = renderModal();

    await user.type(manualField(), KNOWN);
    await user.click(checkButton());

    expect(onBarcodeDetected).toHaveBeenCalledWith(KNOWN);
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the unknown banner for a typed code that is not stocked', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(manualField(), UNKNOWN);
    await user.click(checkButton());

    expect(screen.getByText(/غير مسجل في المحل/)).toBeInTheDocument();
  });

  it('disables the check button until something is typed', async () => {
    const user = userEvent.setup();
    renderModal();
    expect(checkButton()).toBeDisabled();

    await user.type(manualField(), '  ');
    // Whitespace is not a barcode.
    expect(checkButton()).toBeDisabled();

    await user.type(manualField(), '6');
    expect(checkButton()).not.toBeDisabled();
  });

  it('clears the field after a lookup', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(manualField(), UNKNOWN);
    await user.click(checkButton());

    expect(manualField()).toHaveValue('');
  });

  it('works when the camera failed entirely', async () => {
    // The manual path is the only way to scan on a device without camera access.
    scanner.startShouldThrow = 'Permission denied by the browser';
    const user = userEvent.setup();
    const { onBarcodeDetected } = renderModal();

    await waitFor(() => expect(screen.getByText(/تعذر تشغيل الكاميرا/)).toBeInTheDocument());

    await user.type(manualField(), KNOWN);
    await user.click(checkButton());

    expect(onBarcodeDetected).toHaveBeenCalledWith(KNOWN);
  });
});

describe('BarcodeScannerModal - camera problems', () => {
  it('tells the cashier the camera failed and points at manual entry', async () => {
    scanner.startShouldThrow = 'NotAllowedError: permission denied';
    renderModal();

    const message = await screen.findByText(/تعذر تشغيل الكاميرا/);
    expect(message).toHaveTextContent(/يدوياً/);
  });

  it('does not surface a camera transition error', async () => {
    // The library throws this routinely while the video element is swapping, and
    // showing it would flash a scary message on every camera flip.
    scanner.startShouldThrow = 'Html5QrcodeShim transition not ready';
    renderModal();

    await waitFor(() => expect(latest()).toBeDefined());
    expect(screen.queryByText(/تعذر تشغيل الكاميرا/)).not.toBeInTheDocument();
  });

  it('restarts the camera on the opposite lens', async () => {
    const user = userEvent.setup();
    renderModal();
    await waitFor(() => expect(latest()?.started).toBe(true));

    await user.click(screen.getByTitle('تبديل الكاميرا (أمامية/خلفية)'));

    await waitFor(() => expect(scanner.instances.length).toBeGreaterThan(1));
    await waitFor(() => expect(latest().facing).toBe('user'));
  });
});
