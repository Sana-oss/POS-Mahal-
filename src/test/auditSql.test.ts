import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The audit SQL cannot be executed in CI: it needs the postgres role to bypass
 * RLS, and no local Postgres or Docker is available. That makes it exactly the
 * kind of file that rots silently - it looks fine and is only ever run by a
 * human against production.
 *
 * So these checks assert the things that would have broken it on first run,
 * all of which were real defects found while writing it.
 */

const SUPABASE = join(process.cwd(), 'supabase');
const files = readdirSync(SUPABASE).filter((f) => f.endsWith('.sql'));

function collect(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (full.endsWith('.sql')) acc.push(full);
  }
  return acc;
}

const sqlFiles = collect(SUPABASE);
const allSql = sqlFiles.map((f) => readFileSync(f, 'utf8')).join('\n');

/** Strip line comments so keyword checks are not fooled by prose. */
const code = (sql: string) => sql.replace(/--[^\n]*/g, '');

/** Executable SQL only, with comments removed. */
const auditCode = (file: string) => code(readFileSync(join(SUPABASE, file), 'utf8'));

/** Every table the migrations create. */
function createdTables(): Set<string> {
  const out = new Set<string>();
  for (const sql of sqlFiles) {
    for (const m of readFileSync(sql, 'utf8').matchAll(
      /CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/gi
    )) {
      out.add(m[1].toLowerCase());
    }
  }
  return out;
}

describe('supabase SQL audit', () => {
  it('finds the SQL files', () => {
    // The migrations live in supabase/migrations, so walk the tree rather than
    // the top level.
    expect(sqlFiles.length).toBeGreaterThan(5);
    expect(files).toContain('audit.sql');
    expect(files).toContain('audit-one-query.sql');
  });

  it('is read only - no audit statement can write', () => {
    for (const file of files.filter((f) => f.startsWith('audit'))) {
      const body = code(readFileSync(join(SUPABASE, file), 'utf8'));
      for (const danger of [
        /\bINSERT\b/i,
        /\bUPDATE\s+\w+\s+SET/i,
        /\bDELETE\s+FROM\b/i,
        /\bDROP\b/i,
        /\bTRUNCATE\b/i,
        /\bALTER\b/i,
        /\bGRANT\b/i,
        /\bREVOKE\b/i,
        /\bCREATE\b(?!TABLE IF NOT EXISTS)/i,
      ]) {
        expect(danger.test(body), `${file} must not contain ${danger}`).toBe(false);
      }
    }
  });

  // CHECK is a reserved word in Postgres; `AS check` is a syntax error and the
  // whole audit would fail on the first run with no useful output.
  it('never aliases a column to a reserved word', () => {
    const reserved = [
      'check', 'user', 'order', 'group', 'table', 'select', 'where',
      'from', 'and', 'or', 'not', 'null', 'default', 'references', 'all',
    ];
    for (const file of files) {
      const body = code(readFileSync(join(SUPABASE, file), 'utf8'));
      for (const word of reserved) {
        expect(
          new RegExp(`\\bAS\\s+${word}\\b`, 'i').test(body),
          `${file} aliases a column to the reserved word "${word}"`
        ).toBe(false);
      }
    }
  });

  it('joins from a table the migrations actually create', () => {
    const tables = createdTables();
    const audit = code(readFileSync(join(SUPABASE, 'audit-one-query.sql'), 'utf8'));
    const referenced = new Set<string>();
    for (const m of audit.matchAll(/\b(?:FROM|JOIN)\s+(\w+)/gi)) {
      referenced.add(m[1].toLowerCase());
    }
    // Catalog and CTE names are not tables the migrations create.
    const allowed = new Set([
      'unnest', 'information_schema', 'columns', 'pg_tables', 'pg_policies',
      'pg_publication_tables', 'supabase_migrations', 'schema_migrations',
      ...Array.from(tables),
      ...audit.matchAll(/^(\w+) AS \(/gm),
    ].map((x) => (typeof x === 'string' ? x : x[1]).toLowerCase()));

    for (const t of referenced) {
      expect(allowed.has(t), `audit-one-query.sql references unknown table "${t}"`).toBe(true);
    }
  });

  // An inner join drops rows that have no match on the other side, which is how
  // sections 6, 7 and 9 came to be unable to report a sale with no movements.
  it('uses left joins wherever a missing row is itself the finding', () => {
    const audit = code(readFileSync(join(SUPABASE, 'audit-one-query.sql'), 'utf8'));
    for (const m of audit.matchAll(/^\s*JOIN\s+(\w+)\s+ON\s+(.+)$/gim)) {
      const [, table, on] = m;
      // The only remaining inner join is sale_items in the fractional-evidence
      // count, where a row without a fractional line must be excluded.
      expect(
        table.toLowerCase(),
        `inner join to ${table} can hide the rows this check exists to find`
      ).toBe('sale_items');
      expect(on).toMatch(/FLOOR/);
    }
  });

  it('matches movements on the invoice number, not a uuid', () => {
    for (const file of files) {
      const body = code(readFileSync(join(SUPABASE, file), 'utf8'));
      // stock_movements.reference_id is TEXT holding the invoice number.
      expect(
        /reference_id\s*=\s*\w+\.id\b/i.test(body),
        `${file} joins stock_movements by reference_id = id, but it holds an invoice number`
      ).toBe(false);
    }
  });

  it('references only columns the migrations define', () => {
    // One-directional: anything the audit reads must exist in the schema. The
    // audit is not required to read every column the schema has.
    for (const col of [
      'items_count', 'total_amount', 'total_cost', 'profit', 'reference_id',
      'invoice_no', 'quantity', 'unit_cost', 'stock_quantity', 'average_cost',
      'balance', 'customer_id', 'payment_method', 'selling_price', 'purchase_price',
    ]) {
      const usedByAudit = files
        .filter((f) => f.startsWith('audit'))
        .some((f) => auditCode(f).includes(col));
      if (!usedByAudit) continue;
      expect(allSql.includes(col), `audit reads "${col}" but no migration defines it`).toBe(true);
    }
  });

  // opening_stock is a stock_movements.type, never a products column. An
  // earlier draft of the audit joined on products.opening_stock and would have
  // failed on the first run; the prose explaining that is fine, executable SQL
  // reading it is not.
  it('never reads a products.opening_stock column', () => {
    for (const file of files.filter((f) => f.startsWith('audit'))) {
      expect(
        /opening_stock/i.test(auditCode(file)),
        `${file} reads products.opening_stock in executable SQL, but that column does not exist`
      ).toBe(false);
    }
  });
});

/**
 * The credit limit. `customers.credit_limit` existed from 0001 and was read by
 * no SQL at all, so a customer reached 234.60 against a limit of 50. The rule
 * now lives in the database, and these assertions fail if a future edit to the
 * RPC drops it.
 */
describe('credit limit enforcement', () => {
  const sale = readFileSync(join(SUPABASE, 'migrations', '0008_enforce_credit_limit.sql'), 'utf8');

  it('has a migration that enforces the limit', () => {
    expect(sale).toMatch(/CREATE OR REPLACE FUNCTION\s+rpc_execute_sale/);
    expect(sale).toMatch(/credit_limit/);
  });

  it('treats a limit of zero as no limit rather than as no credit', () => {
    // The column defaults to 0, so reading zero as "no credit" would block
    // every customer who was never given an explicit limit.
    expect(sale).toMatch(/credit_limit\s*>\s*0/);
  });

  it('checks the total owing, which includes debt already accrued', () => {
    expect(sale).toMatch(/balance[\s\S]{0,80}\+[\s\S]{0,40}v_total_amount/);
  });

  it('checks after the total is known and before the balance is written', () => {
    const check = sale.search(/Credit limit, enforced/i);
    expect(check).toBeTruthy();
    const at = sale.indexOf('v_projected_balance > v_credit_limit');
    const update = sale.indexOf('UPDATE customers SET balance = balance + v_total_amount');
    expect(at).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(-1);
    expect(at, 'the limit must be checked before the balance is updated').toBeLessThan(update);
  });

  it('reads the customer under a row lock, so two tills cannot race the limit', () => {
    expect(sale).toMatch(/FROM customers WHERE id = p_customer_id AND shop_id = p_shop_id FOR UPDATE/);
  });

  it('keeps the client rule in step with the database rule', () => {
    const client = readFileSync(join(process.cwd(), 'src', 'lib', 'calculations.ts'), 'utf8');
    expect(client).toMatch(/export function validateCreditLimit/);
    // The coerced `limit` local, matching the `v_credit_limit > 0` in SQL.
    expect(client).toMatch(/const limit = Number\.isFinite\(creditLimit\)[\s\S]{0,120}if \(limit <= 0\)/);
  });
});

/**
 * Shop sign-up and cashier invites (migration 0009).
 *
 * The trigger this migration replaces gave every signup a brand new shop, so a
 * second cashier joining a shop silently produced a separate shop with its own
 * books. These assert the rules that close that, because the failure mode is
 * invisible until two people are looking at different numbers.
 */
describe('shop invites (migration 0009)', () => {
  const sql = readFileSync(join(SUPABASE, 'migrations', '0009_shop_signup_and_invites.sql'), 'utf8');

  it('routes an invited signup to the invited shop instead of a new one', () => {
    // The trigger must look up a pending invite BEFORE creating a shop.
    const inviteLookup = sql.indexOf('FROM shop_invites');
    const shopInsert = sql.indexOf('INSERT INTO public.shops');
    expect(inviteLookup, 'the trigger must check for a pending invite').toBeGreaterThan(-1);
    expect(shopInsert, 'the trigger must still create a shop when uninvited').toBeGreaterThan(-1);
    expect(inviteLookup).toBeLessThan(shopInsert);
  });

  it('still creates a shop for an uninvited signup', () => {
    // Otherwise nobody could ever open a shop from the app again.
    expect(sql).toMatch(/INSERT INTO public\.shops/);
    expect(sql).toMatch(/role\s*=\s*'owner'|'owner'/);
  });

  it('only ever invites a cashier, never a second owner', () => {
    expect(sql).toMatch(/role\s+TEXT\s+NOT NULL\s+DEFAULT\s+'cashier'\s+CHECK\s*\(role\s*=\s*'cashier'\)/);
    expect(sql).toMatch(/Only a cashier invite can be issued/);
  });

  it('restricts issuing an invite to the shop owner', () => {
    expect(sql).toMatch(/Only the shop owner can issue invites/);
    expect(sql).toMatch(/owner_id\s+IS\s+DISTINCT\s+FROM\s+auth\.uid\(\)/);
  });

  it('enables RLS on the invites table with a shop-scoped policy', () => {
    expect(sql).toMatch(/ALTER TABLE shop_invites ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ON shop_invites[\s\S]{0,80}shop_id\s*=\s*get_user_shop_id\(\)/);
  });

  it('generates an unguessable token', () => {
    // 24 random bytes, hex encoded. A sequential or short token would let anyone
    // mint access to another shop's books.
    expect(sql).toMatch(/gen_random_bytes\(24\)/);
    expect(sql).toMatch(/token\s+TEXT\s+NOT NULL\s+UNIQUE/);
  });

  it('never returns the token from the public read function', () => {
    // Reachable before sign-in by anyone holding a link, so it must expose only
    // what a joiner needs to know what they are accepting. The token belongs in
    // the WHERE clause as the lookup key; what matters is that it is not among
    // the returned columns.
    const start = sql.indexOf('FUNCTION public.get_shop_invite');
    const body = sql.slice(start, sql.indexOf('$$ LANGUAGE', start));

    // Only the RETURNS TABLE column list, which starts after the closing
    // parenthesis of the parameter list. The signature itself names p_token -
    // that is the lookup key, not a returned value.
    const columns = body.slice(body.indexOf('RETURNS TABLE') + 'RETURNS TABLE'.length);
    expect(columns.slice(0, columns.indexOf(') AS'))).not.toMatch(/\btoken\b/);

    // The projection is the four safe fields and nothing else.
    const projection = body.slice(body.indexOf('SELECT'), body.indexOf('FROM shop_invites'));
    expect(projection).not.toMatch(/i\.token/);
    expect(projection).toMatch(/s\.name/);
    expect(projection).toMatch(/i\.role/);

    // It is still used to find the row, which is the point of the function.
    expect(body).toMatch(/WHERE i\.token = p_token/);
  });

  it('expires invites and refuses a used one', () => {
    expect(sql).toMatch(/expires_at\s+TIMESTAMPTZ\s+NOT NULL\s+DEFAULT\s*\(NOW\(\)\s*\+\s*INTERVAL\s+'14 days'\)/);
    expect(sql).toMatch(/That invite has already been used/);
    expect(sql).toMatch(/That invite has expired/);
  });

  it('refuses to move a user who already belongs to a shop', () => {
    // Silently re-homing them would orphan whatever the previous shop recorded.
    expect(sql).toMatch(/already belongs to a different shop/);
  });

  it('matches the invited email case-insensitively', () => {
    // Supabase treats the local part case-insensitively; a strict match would
    // strand a valid invite on a capitalisation difference alone.
    expect(sql).toMatch(/lower\(email\)\s*=\s*lower\(/);
  });

  it('fails loudly if any RLS table has no policy', () => {
    // An RLS table with no policy is invisible to everyone: a silent break.
    expect(sql).toMatch(/has RLS enabled but no policy/);
  });
});

/**
 * Malformed SQL operators.
 *
 * Migration 0009 shipped `p_email !* '...'` - `!*` is not a PostgreSQL operator;
 * `!~` is. It was chosen to avoid `!` being mangled on the way into the file,
 * which was a bad trade. The migration reported success because a plpgsql body
 * is only compiled on first call, so the failure appeared as
 * "operator does not exist: text !* unknown" the first time a shop owner
 * actually tried to invite a cashier.
 *
 * Nothing local can execute plpgsql, and `supabase db push` is happy to record a
 * migration whose function body never compiles. So the sequences are checked
 * statically, with line comments stripped first - 0010's prose names these
 * exact sequences in order to explain what it fixed, and that must not trip it.
 */
describe('migration SQL operators', () => {
  const NOT_OPERATORS = ['!*', '!<', '!~', '!#', '!|', '!!', '@*', '@#', '~~', '~*', '~#'];

  it('leaves no malformed operator in any migration that is still in force', () => {
    const dir = join(SUPABASE, 'migrations');
    // 0009 is applied history and is deliberately left as written: editing an
    // applied migration changes nothing, because Supabase tracks versions
    // rather than file contents. 0010 supersedes the broken function.
    //
    // Each entry is the body of one function, not the whole file - a file can
    // hold several functions, and only the latest definition of each is live.
    const latest = new Map<string, string>();
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      const raw = readFileSync(join(dir, name), 'utf8');
      for (const m of raw.matchAll(
        /CREATE OR REPLACE FUNCTION\s+(?:public\.)?(\w+)\s*\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/gi
      )) {
        latest.set(m[1].toLowerCase(), m[2]);
      }
    }

    const offenders: string[] = [];
    for (const [fn, body] of latest) {
      body.split('\n').forEach((line, i) => {
        const code = line.split('--')[0];
        for (const bad of NOT_OPERATORS) {
          if (code.includes(bad)) offenders.push(`${fn}:${i + 1} contains ${bad}`);
        }
      });
    }

    expect(
      offenders,
      'These are not PostgreSQL operators. A plpgsql body is compiled on first ' +
        'call, so supabase db push will accept a function that can never run.'
    ).toEqual([]);
  });

  it('validates an email without a regex operator', () => {
    // 0010 replaced the operator with ordinary functions, which cannot be
    // mangled on the way into the file.
    const fixed = readFileSync(
      join(SUPABASE, 'migrations', '0010_fix_invite_email_validation.sql'),
      'utf8'
    );
    const code = fixed.split('\n').map((l) => l.split('--')[0]).join('\n');
    expect(code).toMatch(/position\('@' IN v_email\)/);
    expect(code).toMatch(/split_part\(v_email, '@', 2\)/);
  });
});
