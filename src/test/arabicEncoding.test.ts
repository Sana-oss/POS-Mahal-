import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Arabic must stay real UTF-8, and nothing in CI can see a mojibake regression.
 *
 * App.tsx shipped nine corrupted strings for several commits - the error card,
 * the retry button, the loading line - because an edit round-tripped the file
 * through the Windows console codepage. TypeScript compiled it, Vite bundled it,
 * and every test passed: the assertions in the affected test file compared
 * mojibake against mojibake, so they agreed with each other exactly as the
 * corrupted code did. Nothing about the pipeline can detect this, which is why
 * it is checked here instead.
 *
 * Mojibake has a signature no correct Arabic can have: Latin-1 supplement
 * letters, above all the Arabic letter's own bytes read as CP1252 (D8 AA renders
 * as "Øª"). This asserts no source line mixes those with a recoverable Arabic
 * round trip, and separately that every Arabic literal is well-formed UTF-8.
 */

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', 'dist', 'dev-dist', '.git', 'temp', '.vite']);
const SUFFIXES = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.html', '.css', '.sql', '.json', '.md']);

/**
 * Files that must name the mojibake characters in order to do their job: this
 * detector, and the SQL that searches stored values for them. Both are excluded
 * rather than special-cased, because a scanner that cannot look at itself is not
 * a scanner.
 */
const SELF = 'arabicEncoding.test.ts';
const MOJIBAKE_PROBES = new Set(['arabic-roundtrip.sql']);

/** Latin-1 letters that only appear when UTF-8 bytes are read as CP1252. */
const SUSPECT = new Set('ØÙÚÃÂÐÑ');
const ARABIC_LO = 0x0600;
const ARABIC_HI = 0x06ff;

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (SUFFIXES.has(full.slice(full.lastIndexOf('.'))) && !full.endsWith(SELF)) {
      const name = full.slice(full.lastIndexOf('\\') + 1);
      if (!MOJIBAKE_PROBES.has(name)) acc.push(full);
    }
  }
  return acc;
}

const files = collect(ROOT);

const isArabic = (ch: string) => {
  const cp = ch.codePointAt(0)!;
  return cp >= ARABIC_LO && cp <= ARABIC_HI;
};

const hasArabic = (line: string) => [...line].some(isArabic);

const hasSuspect = (line: string) => [...line].some((ch) => SUSPECT.has(ch));

/** Mojibake is a line with Latin-1 letters that is supposed to be Arabic. */
const looksCorrupted = (line: string) => !hasArabic(line) && hasSuspect(line);

describe('Arabic encoding integrity', () => {
  it('finds the source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no mojibake anywhere in the source', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        if (looksCorrupted(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 90)}`);
        }
      });
    }
    expect(
      offenders,
      'These lines are mojibake: UTF-8 bytes decoded as CP1252 and written back. ' +
        'Recover each with: read as UTF-8, map Latin-1/CP1252 chars back to bytes, decode as UTF-8. ' +
        'Do not edit the text through a console - that is what caused it.'
    ).toEqual([]);
  });

  it('reads every source file as valid UTF-8', () => {
    // readFileSync(..., 'utf8') replaces bad bytes with U+FFFD rather than
    // throwing, so a file that is not valid UTF-8 has to be detected explicitly.
    const invalid: string[] = [];
    for (const file of files) {
      const buffer = readFileSync(file);
      const text = buffer.toString('utf8');
      // Round-trip: re-encoding a correctly decoded file reproduces the bytes.
      if (!Buffer.from(text, 'utf8').equals(buffer)) {
        invalid.push(relative(ROOT, file));
      }
    }
    expect(invalid, 'These files are not valid UTF-8 on disk').toEqual([]);
  });

  it('carries real Arabic in the error and auth surfaces', () => {
    // A guard that only ever sees ASCII passes trivially, so assert the strings
    // that matter are genuinely Arabic and not empty or English stand-ins.
    const app = readFileSync(join(ROOT, 'src', 'App.tsx'), 'utf8');
    expect(app).toMatch(/تعذر تحميل بيانات المتجر/);
    expect(app).toMatch(/إعادة المحاولة/);

    const dataSource = readFileSync(join(ROOT, 'src', 'lib', 'dataSource.ts'), 'utf8');
    // The refusal translations the cashier reads.
    expect(dataSource).toMatch(/تجاوز الحد الائتماني/);

    const login = readFileSync(join(ROOT, 'src', 'components', 'auth', 'LoginView.tsx'), 'utf8');
    expect(login).toMatch(/البريد الإلكتروني/);
  });

  it('declares UTF-8 in the document', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/<meta\s+charset=["']?utf-8/i);
  });

  it('keeps the html RTL direction', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    expect(html).toMatch(/<html[^>]*dir=["']rtl["']/i);
  });
});
