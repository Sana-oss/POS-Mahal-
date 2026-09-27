/**
 * Vitest setup shared by every test file.
 *
 * Registers the jest-dom matchers (`toBeInTheDocument`, `toHaveTextContent`, …)
 * so component assertions read clearly, and unmounts rendered trees between
 * tests.
 *
 * The explicit cleanup matters: Testing Library only auto-registers it when
 * `afterEach` is a global, and this project runs Vitest with
 * `globals: false`. Without it, each render leaks into the next test and
 * `getByLabelText` fails with "found multiple elements".
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
