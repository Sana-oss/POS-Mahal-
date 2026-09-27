import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards a bug that TypeScript cannot see.
 *
 * A JSX attribute that lands after the closing tag instead of inside the open
 * tag is still perfectly valid TypeScript - it just becomes a text node, and
 * renders literally in the UI. This shipped as visible `id="f-1"` beside 27
 * field labels across four views, and the label's `htmlFor` dangled because the
 * id it pointed at did not exist anywhere.
 *
 * Both halves are asserted here: no attribute-shaped text after a closing tag,
 * and no label pointing at an id that is not in the same file.
 */

const SRC = join(process.cwd(), 'src');

function collectTsx(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collectTsx(full, acc);
    else if (full.endsWith('.tsx')) acc.push(full);
  }
  return acc;
}

const files = collectTsx(SRC);

/** Attributes that would be meaningless, and visible, as a text node. */
const STRAY_ATTRIBUTE = /<\/(?:label|div|span|button|p|h[1-6]|td|th|option|a|li|section|form)>[ \t]+\b(?:id|className|htmlFor|type|value|style|key|placeholder|name|onClick|onChange|onSubmit|disabled|readOnly)=/;

describe('JSX integrity', () => {
  it('finds the source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never renders a JSX attribute as visible text after a closing tag', () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (STRAY_ATTRIBUTE.test(line)) {
            offenders.push(`${file.replace(SRC, 'src')}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it('has no label whose htmlFor points at a missing id', () => {
    const dangling: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const declared = new Set([...source.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
      for (const m of source.matchAll(/\bhtmlFor="([^"]+)"/g)) {
        if (!declared.has(m[1])) {
          dangling.push(`${file.replace(SRC, 'src')} -> htmlFor="${m[1]}"`);
        }
      }
    }
    expect(dangling).toEqual([]);
  });
});
