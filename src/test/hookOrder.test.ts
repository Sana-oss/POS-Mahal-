import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * App.tsx is a function component with several early returns - password recovery,
 * the misconfigured-deploy guard, the auth spinner, the cloud gate. A hook placed
 * after one of those is skipped on that path, so React sees a different hook
 * count between renders and throws "Rendered more hooks than during the previous
 * render". That is a hard crash at start-up, not a warning, and it reached a
 * deployed shop before it was caught.
 *
 * The rule is mechanical - no hook may appear below a `return` - so it is checked
 * mechanically, rather than left to a test that would have to mount App through
 * every branch to notice.
 */

const source = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

/** Lines of the component body, ignoring the import block. */
function bodyLines(): { line: number; text: string }[] {
  return source
    .split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter((l) => l.line > 1 && !/^\s*import\b/.test(l.text));
}

/** A `return` that exits the component, i.e. not a return inside a callback. */
function isEarlyReturn(text: string): boolean {
  if (!/^\s{2,4}return\b/.test(text)) return false;
  // A return inside a function expression belongs to that function, not App.
  const depthOfArrow = (text.match(/=>\s*\{/g) ?? []).length;
  return depthOfArrow === 0;
}

const HOOK = /\buse(State|Effect|Ref|Callback|Memo|Reducer|Context|Store)\s*\(/;

describe('App.tsx hook ordering', () => {
  it('calls no hook after an early return', () => {
    const offenders: string[] = [];
    let seenEarlyReturn = false;

    for (const { line, text } of bodyLines()) {
      if (isEarlyReturn(text)) {
        seenEarlyReturn = true;
        continue;
      }
      if (seenEarlyReturn && HOOK.test(text) && !text.trimStart().startsWith('*')) {
        offenders.push(`App.tsx:${line}: ${text.trim().slice(0, 80)}`);
      }
    }

    expect(
      offenders,
      'A hook below an early return is skipped on that path, so React sees a ' +
        'different hook order between renders and crashes the app at start-up. ' +
        'Move it above the first return.'
    ).toEqual([]);
  });

  it('declares the invite hooks unconditionally at the top', () => {
    // The specific regression: these two were added below three early returns.
    expect(source).toMatch(/const \[inviteToken, setInviteToken\] = useState<string \| null>\(null\)/);
    expect(source).toMatch(/const \[authScreen, setAuthScreen\] = useState<'signin' \| 'signup'>\('signin'\)/);

    const tokenAt = source.indexOf('const [inviteToken');
    const screenAt = source.indexOf('const [authScreen');
    const firstReturn = bodyLines().find((l) => isEarlyReturn(l.text))?.line ?? Number.MAX_SAFE_INTEGER;
    expect(tokenAt).toBeGreaterThan(-1);
    expect(tokenAt).toBeLessThan(screenAt);
    // Both must appear before the first return in the component body.
    expect(tokenAt, 'inviteToken must be declared before the first early return').toBeLessThan(
      firstReturn === Number.MAX_SAFE_INTEGER ? firstReturn : Number.MAX_SAFE_INTEGER
    );
  });

  it('reads the invite token from the URL only once, on mount', () => {
    // Re-reading it every render would re-validate the invite mid-typing.
    const effect = source.slice(source.indexOf('inviteTokenFromUrl()'));
    expect(effect).toMatch(/\}, \[\]\)/);
  });
});
