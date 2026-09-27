/**
 * Cloud verification for Mahall POS.
 *
 * The offline test suite covers the client, but two things can only be proven
 * against the live project:
 *
 *   1. DATA INTEGRITY  - whether rpc_execute_sale / rpc_execute_purchase have
 *                        actually been maintaining their invariants on real rows.
 *                        A client test can only assert what the client believes;
 *                        this checks what Postgres stored.
 *   2. ATOMICITY        - whether a rejected write leaves no partial rows behind.
 *
 * Realtime delivery needs two live sessions and is documented at the end of the
 * run; the subscription handshake is checked here.
 *
 * By default this script only READS. Pass --write to also run the atomicity
 * probe, which deliberately attempts an oversell that must be rejected.
 *
 *   node scripts/verify-cloud.mjs
 *   node scripts/verify-cloud.mjs --write
 *
 * Credentials come from the environment so nothing is hardcoded:
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY  (read from .env)
 *   VERIFY_EMAIL, VERIFY_PASSWORD              (a real shop account)
 *
 * The invariant analysis is exported and covered by verify-cloud.test.mjs, so the
 * checks themselves are tested even when no live credentials are available.
 */

import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function loadEnv() {
  if (!existsSync('.env')) return;
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadEnv();

const URL = process.env.VITE_SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY;
const EMAIL = process.env.VERIFY_EMAIL;
const PASSWORD = process.env.VERIFY_PASSWORD;
const DO_WRITE = process.argv.includes('--write');
const JSON_MODE = process.argv.includes('--json');

/** Tables whose movement means another register's cache is stale. */
export const WATCHED_TABLES = [
  'products',
  'sales',
  'sale_items',
  'purchases',
  'purchase_items',
  'customers',
  'customer_payments',
  'stock_movements',
  'expenses',
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** NUMERIC arrives from PostgREST as a string; compare as numbers. */
export const n = (v) => (v === null || v === undefined ? 0 : Number(v));
export const near = (a, b, tol = 0.005) => Math.abs(a - b) <= tol;

export function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

const MAX_DETAILS = 6;
const addDetail = (list, line) => {
  if (list.length < MAX_DETAILS) list.push(line);
};

/**
 * Check the invariants the RPCs are supposed to hold, against whatever rows are
 * given. Pure, so it can be tested offline with deliberately broken fixtures.
 *
 * @returns {{name: string, broken: number, details: string[], hint?: string}[]}
 */
export function analyseIntegrity(data) {
  const {
    sales = [],
    saleItems = [],
    purchases = [],
    purchaseItems = [],
    customers = [],
    customerPayments = [],
    stockMovements = [],
    products = [],
  } = data;

  const results = [];
  const record = (name, broken, details, hint) => {
    if (broken > 0 || hint) results.push({ name, broken, details, hint });
    else results.push({ name, broken: 0, details: [] });
  };

  const itemsBySale = groupBy(saleItems, 'sale_id');
  const itemsByPurchase = groupBy(purchaseItems, 'purchase_id');
  const movesByRef = groupBy(stockMovements, 'reference_id');

  // --- sales ---
  const d = [];
  let noLines = 0;
  let countBad = 0;
  let amountBad = 0;
  let costBad = 0;
  let profitBad = 0;
  let moveBad = 0;

  for (const sale of sales) {
    const items = itemsBySale.get(sale.id) ?? [];
    const sumQty = items.reduce((a, i) => a + n(i.quantity), 0);
    const sumPrice = items.reduce((a, i) => a + n(i.total_price), 0);
    const sumCost = items.reduce((a, i) => a + n(i.total_cost), 0);

    if (items.length === 0) {
      noLines++;
      addDetail(d, `sale ${sale.invoice_no}: no sale_items rows`);
    }
    if (!near(sumQty, n(sale.items_count))) {
      countBad++;
      addDetail(d, `sale ${sale.invoice_no}: items_count=${sale.items_count} but its lines sum to ${sumQty}`);
    }
    if (!near(sumPrice, n(sale.total_amount))) {
      amountBad++;
      addDetail(d, `sale ${sale.invoice_no}: total_amount=${sale.total_amount} but its lines sum to ${sumPrice}`);
    }
    if (!near(sumCost, n(sale.total_cost))) {
      costBad++;
      addDetail(d, `sale ${sale.invoice_no}: total_cost=${sale.total_cost} but its lines sum to ${sumCost}`);
    }
    if (!near(n(sale.profit), n(sale.total_amount) - n(sale.total_cost))) {
      profitBad++;
      addDetail(d, `sale ${sale.invoice_no}: profit=${sale.profit} but amount-cost=${n(sale.total_amount) - n(sale.total_cost)}`);
    }

    // stock_movements.reference_id is TEXT holding the invoice number ('INV-...'),
    // not the sale's uuid. Grouping by reference_id but looking up sale.id would
    // never match and would report every sale as missing its movement.
    const saleMoves = (movesByRef.get(sale.invoice_no) ?? []).filter((m) => m.type === 'sale');
    if (saleMoves.length === 0) {
      moveBad++;
      addDetail(d, `sale ${sale.invoice_no}: no stock_movements row with type='sale'`);
    } else {
      const moveQty = saleMoves.reduce((a, m) => a + n(m.quantity), 0);
      if (!near(moveQty, -sumQty)) {
        moveBad++;
        addDetail(d, `sale ${sale.invoice_no}: movements sum to ${moveQty} but its lines sum to ${sumQty}`);
      }
    }
  }

  record('every sale has line items and a matching stock movement', noLines + moveBad, [...d]);
  results.push({
    name: 'sales.items_count equals the sum of its line quantities',
    broken: countBad,
    details: d.filter((x) => x.includes('items_count')),
    hint: countBad ? 'migration 0007 widens items_count to NUMERIC(10,3); a mismatch here is what a floored fractional count looks like' : undefined,
  });
  results.push({
    name: 'sales.total_amount equals the sum of its line totals',
    broken: amountBad,
    details: d.filter((x) => x.includes('total_amount')),
  });
  results.push({
    name: 'sales.total_cost equals the sum of its line costs',
    broken: costBad,
    details: d.filter((x) => x.includes('total_cost')),
  });
  results.push({
    name: 'sales.profit equals total_amount - total_cost',
    broken: profitBad,
    details: d.filter((x) => x.includes('profit=')),
  });

  // --- line arithmetic ---
  const ld = [];
  let lineBad = 0;
  for (const item of saleItems) {
    const qty = n(item.quantity);
    if (!near(n(item.total_price), qty * n(item.unit_price))) {
      lineBad++;
      addDetail(ld, `sale_item ${item.id}: total_price ${item.total_price} != ${qty} x ${item.unit_price}`);
    }
    if (!near(n(item.profit), n(item.total_price) - n(item.total_cost))) {
      lineBad++;
      addDetail(ld, `sale_item ${item.id}: profit ${item.profit} != total_price - total_cost`);
    }
  }
  record('each sale line: total_price = quantity x unit_price and profit = price - cost', lineBad, ld);

  // --- purchases ---
  const pd = [];
  let purchaseCountBad = 0;
  let purchaseCostBad = 0;
  for (const purchase of purchases) {
    const items = itemsByPurchase.get(purchase.id) ?? [];
    const sumQty = items.reduce((a, i) => a + n(i.quantity), 0);
    if (!near(sumQty, n(purchase.items_count))) {
      purchaseCountBad++;
      addDetail(pd, `purchase ${purchase.invoice_no}: items_count=${purchase.items_count} but its lines sum to ${sumQty}`);
    }
    const sumCost = items.reduce((a, i) => a + n(i.total_cost), 0);
    if (!near(sumCost, n(purchase.total_amount))) {
      purchaseCostBad++;
      addDetail(pd, `purchase ${purchase.invoice_no}: total_amount=${purchase.total_amount} but its lines sum to ${sumCost}`);
    }
    for (const item of items) {
      if (!near(n(item.total_cost), n(item.quantity) * n(item.unit_cost))) {
        purchaseCostBad++;
        addDetail(pd, `purchase_item ${item.id}: total_cost != quantity x unit_cost`);
      }
    }
  }
  if (purchases.length) {
    record('purchases.items_count equals the sum of its line quantities', purchaseCountBad, pd);
    record('purchases.total_amount equals the sum of its line costs', purchaseCostBad, pd);
  }

  // --- customer ledger ---
  // A customer can legitimately be created with an opening balance, and no
  // payment row records it. So balance = opening + debt sales - paid can always
  // be made to fit by positing an opening, which means balance drift is NOT
  // provable from the data alone. Claiming otherwise would be a check that
  // cries wolf on correct data.
  //
  // What IS provable: the faults that leave no innocent explanation. A debt
  // sale with no customer (the RPC rejects this), a sale pointing at a customer
  // that does not exist, and a negative balance the CHECK should have stopped.
  const cd = [];
  const infoLines = [];
  let ledgerFaults = 0;
  let negativeBalance = 0;
  const customerIds = new Set(customers.map((c) => c.id));
  const paymentsByCustomer = groupBy(customerPayments, 'customer_id');

  for (const sale of sales) {
    if (sale.payment_method === 'debt' && !sale.customer_id) {
      ledgerFaults++;
      addDetail(cd, `sale ${sale.invoice_no}: payment_method is 'debt' but no customer is attached, which rpc_execute_sale rejects`);
    }
    if (sale.customer_id && !customerIds.has(sale.customer_id)) {
      ledgerFaults++;
      addDetail(cd, `sale ${sale.invoice_no}: points at customer ${sale.customer_id}, who does not exist`);
    }
  }
  for (const payment of customerPayments) {
    if (payment.customer_id && !customerIds.has(payment.customer_id)) {
      ledgerFaults++;
      addDetail(cd, `customer_payment ${payment.id}: points at customer ${payment.customer_id}, who does not exist`);
    }
  }

  for (const customer of customers) {
    if (n(customer.balance) < 0) {
      negativeBalance++;
      addDetail(cd, `customer ${customer.name}: balance ${customer.balance}, but the column has CHECK (balance >= 0)`);
    }
    const debtSales = sales.filter((s) => s.customer_id === customer.id && s.payment_method === 'debt');
    const paid = (paymentsByCustomer.get(customer.id) ?? []).reduce((a, p) => a + n(p.amount), 0);
    const debtTotal = debtSales.reduce((a, s) => a + n(s.total_amount), 0);
    // A debt sale raises the balance (rpc_execute_sale does
    // `balance = balance + total_amount`) and a payment lowers it, so
    //   balance = opening + debtSales - payments
    // which rearranges to opening = balance - debtSales + payments.
    // Adding debtSales here instead doubled it: a customer whose balance exactly
    // equalled their debt sales reported an opening of twice that amount.
    const impliedOpening = n(customer.balance) - debtTotal + paid;

    if (!near(impliedOpening, 0, 0.05) && infoLines.length < MAX_DETAILS) {
      infoLines.push(
        `customer ${customer.name}: opening balance of ${impliedOpening.toFixed(2)} (balance ${customer.balance}, debt sales ${debtTotal.toFixed(2)}, paid ${paid.toFixed(2)})`
      );
    }
  }
  // Emitted whenever there is anything that could point at a customer, which
  // includes the case where the customer list is empty and an orphan is the
  // only explanation for a dangling reference.
  if (sales.length || customerPayments.length || customers.length) {
    record(
      'every debt sale and payment points at a real customer',
      ledgerFaults,
      cd,
      ledgerFaults ? 'rpc_execute_sale rejects a debt sale with no customer, so these rows predate that guard' : undefined
    );
  }
  if (customers.length) {
    record('no customer has a negative balance', negativeBalance, cd);
  }
  if (infoLines.length) {
    results.push({ name: 'customer opening balances (informational)', broken: 0, details: infoLines, info: true });
  }

  // --- products ---
  const qd = [];
  let negativeStock = 0;
  const unknownCost = [];
  for (const product of products) {
    if (n(product.stock_quantity) < 0) {
      negativeStock++;
      addDetail(qd, `product ${product.name}: stock_quantity is ${product.stock_quantity}`);
    }
    if (n(product.average_cost) === 0) unknownCost.push(`${product.name} (${product.stock_quantity} ${product.unit ?? ''})`);
  }
  record('no product has negative stock', negativeStock, qd);

  return { results, unknownCost, hasTransactions: sales.length > 0 || purchases.length > 0 };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

// Colour is suppressed when stdout is not a TTY, so piping or redirecting the
// output produces text that is actually readable (and pasteable).
const PLAIN = JSON_MODE || process.env.NO_COLOR === '1' || !process.stdout.isTTY;
const GREEN = PLAIN ? '' : '\x1b[32m';
const RED = PLAIN ? '' : '\x1b[31m';
const YELLOW = PLAIN ? '' : '\x1b[33m';
const DIM = PLAIN ? '' : '\x1b[2m';
const BOLD = PLAIN ? '' : '\x1b[1m';
const OFF = PLAIN ? '' : '\x1b[0m';

let failures = 0;
let warnings = 0;
let checks = 0;
const results_log = [];

function emit(kind, name, detail, info = false) {
  checks++;
  if (kind === 'fail') failures++;
  else if (kind === 'warn') warnings++;
  results_log.push({ kind, name, detail, ...(info ? { info: true } : {}) });

  if (JSON_MODE) {
    // Machine-readable: one check per line, no colour, ready to paste.
    console.log(JSON.stringify({ kind, name, detail, ...(info ? { info: true } : {}) }));
    return;
  }
  if (info) {
    console.log(`  ${DIM}INFO${OFF}  ${name}`);
    for (const line of detail) console.log(`        ${DIM}${line}${OFF}`);
    return;
  }
  if (kind === 'pass') {
    console.log(`  ${GREEN}PASS${OFF}  ${name}`);
  } else {
    const tag = kind === 'fail' ? `${RED}FAIL${OFF}` : `${YELLOW}WARN${OFF}`;
    console.log(`  ${tag}  ${name}`);
    for (const line of detail) console.log(`        ${DIM}${line}${OFF}`);
  }
}
const info = (line) => console.log(`  ${DIM}${line}${OFF}`);
const section = (title) => console.log(`\n${BOLD}${title}${OFF}`);

// ---------------------------------------------------------------------------
// Live checks
// ---------------------------------------------------------------------------

async function fetchAll(supabase, table) {
  const { data, error } = await supabase.from(table).select('*');
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function checkDataIntegrity(supabase) {
  section('Data integrity - do the stored rows satisfy the RPC invariants?');

  const data = {
    sales: await fetchAll(supabase, 'sales'),
    saleItems: await fetchAll(supabase, 'sale_items'),
    purchases: await fetchAll(supabase, 'purchases'),
    purchaseItems: await fetchAll(supabase, 'purchase_items'),
    customers: await fetchAll(supabase, 'customers'),
    customerPayments: await fetchAll(supabase, 'customer_payments'),
    stockMovements: await fetchAll(supabase, 'stock_movements'),
    products: await fetchAll(supabase, 'products'),
  };

  info(
    `${data.sales.length} sales, ${data.purchases.length} purchases, ` +
      `${data.products.length} products, ${data.customers.length} customers`
  );

  if (!data.sales.length && !data.purchases.length) {
    emit('warn', 'no transactions to check', [
      'Every integrity check needs at least one recorded sale or purchase.',
      'Record one from the app (or run with --write) and re-run.',
    ]);
    return;
  }

  const { results, unknownCost } = analyseIntegrity(data);
  for (const r of results) {
    const lines = r.hint ? [r.hint, ...r.details] : r.details;
    emit(r.broken === 0 ? 'pass' : 'fail', r.name, lines);
  }

  if (unknownCost.length) {
    emit('warn', `${unknownCost.length} product(s) have no cost set (average_cost = 0)`, [
      'Not an error: cost is stored as 0 when unknown, and the app flags these in the',
      'inventory list. Until the first purchase, profit on them is overstated because the',
      'sale RPC falls back to purchase_price, which is also 0.',
      ...unknownCost.slice(0, 8),
      ...(unknownCost.length > 8 ? [`...and ${unknownCost.length - 8} more`] : []),
    ]);
  }
}

async function checkFractionalSupport(supabase) {
  section('Fractional quantity support');

  const { data } = await supabase.from('sale_items').select('quantity').limit(1000);
  const decimals = new Set();
  for (const row of data ?? []) {
    const s = String(row.quantity);
    const dot = s.indexOf('.');
    if (dot >= 0) decimals.add(s.length - dot - 1);
  }

  if (decimals.size > 0) {
    emit('pass', `fractional line quantities exist in real data (decimals seen: ${[...decimals].sort().join(', ')})`, []);
  } else {
    emit('warn', 'no fractional line quantities found', [
      'Expected if the shop has not sold a weighed item yet, so it does not prove',
      'migration 0007 is applied. Run schema query 1 below and confirm sales.items_count',
      'and purchases.items_count are NUMERIC(10,3) rather than INTEGER.',
    ]);
  }
}

/**
 * @param timeoutMs injectable so the ordering can be tested without waiting 15s.
 */
export async function checkRealtimeSubscription(supabase, { timeoutMs = 15000 } = {}) {
  if (!JSON_MODE) section('Realtime - can this client subscribe to every watched table?');

  const channel = supabase.channel('verify-probe');
  for (const table of WATCHED_TABLES) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {});
  }

  // The channel must NOT be removed here. removeChannel() runs synchronously
  // inside a Promise executor, so calling it before the handshake resolves tears
  // the channel down while it is still connecting, and the subscribe callback can
  // then never fire - the status is guaranteed to be TIMED_OUT no matter how
  // healthy the project is. Teardown happens after the await below.
  const status = await new Promise((resolve) => {
    let settled = false;
    const done = (s) => {
      if (settled) return;
      settled = true;
      resolve(s);
    };
    channel.subscribe(done);
    setTimeout(() => done('TIMED_OUT'), timeoutMs);
  });

  await supabase.removeChannel(channel);

  if (status === 'SUBSCRIBED') {
    emit('pass', `subscribed to all ${WATCHED_TABLES.length} watched tables`, []);
  } else if (status === 'CHANNEL_ERROR') {
    emit('fail', 'the realtime channel was refused', [
      'Usually a watched table is missing from the supabase_realtime publication (migration 0006), or RLS blocks it.',
    ]);
  } else if (status === 'TIMED_OUT') {
    emit('warn', 'the realtime subscription did not complete in time', [
      `No subscribe response after ${Math.round(timeoutMs / 1000)}s.`,
      'The websocket could be blocked by a firewall, proxy or VPN on this machine.',
      'This says nothing about the database: run the SQL audit to confirm the publication,',
      'and confirm delivery with the two-browser test below.',
    ]);
  } else {
    emit('warn', `unexpected subscription status: ${status}`, []);
  }
  if (!JSON_MODE) info('a successful subscribe does not prove events are delivered - see the two-browser steps below');
}

/**
 * Attempts to oversell. Correct behaviour: the RPC raises and not one row is
 * written anywhere. That is the atomicity proof, and when it holds it leaves
 * nothing behind. If it does not hold, residue appears and is reported loudly.
 */
async function checkAtomicity(supabase) {
  section('Atomicity - a rejected sale must leave no partial rows');

  const { data: product } = await supabase
    .from('products')
    .select('id, name, stock_quantity')
    .gt('stock_quantity', 0)
    .order('stock_quantity', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!product) {
    emit('warn', 'no product with stock to probe', ['Record a product with stock first, then re-run --write.']);
    return;
  }

  const stock = n(product.stock_quantity);
  const before = await rowCounts(supabase);
  const { data: shop } = await supabase.from('profiles').select('shop_id').limit(1).single();

  info(`probing with "${product.name}" (stock ${stock}), attempting to sell ${stock + 100}`);

  const { data: sale, error } = await supabase.rpc('rpc_execute_sale', {
    p_shop_id: shop?.shop_id,
    p_items: [{ product_id: product.id, quantity: stock + 100 }],
    p_payment_method: 'cash',
    p_customer_id: null,
    p_received_amount: null,
    p_notes: 'atomicity probe - must be rejected',
  });

  if (!error) {
    emit('fail', 'the oversell was ACCEPTED', [
      `The RPC returned sale ${sale?.invoice_no ?? 'unknown'} for more stock than exists.`,
      'Stock was oversold. Delete that sale in the app, then inspect the stock',
      'validation in migrations 0003/0004.',
    ]);
    return;
  }

  emit('pass', `the oversell was rejected: ${error.message.slice(0, 110)}`, []);

  const after = await rowCounts(supabase);
  const deltas = ['sales', 'sale_items', 'stock_movements'].map((t) => `${t} ${before[t]}->${after[t]}`);

  if (after.sales === before.sales && after.sale_items === before.sale_items && after.stock_movements === before.stock_movements) {
    emit('pass', `nothing was written (${deltas.join(', ')})`, []);
  } else {
    emit('fail', 'a rejected sale still wrote rows', [
      `Row counts changed despite the rejection (${deltas.join(', ')}).`,
      'The RPC is not atomic: it validated after writing, or the writes are not in one transaction.',
    ]);
  }

  const { data: after2 } = await supabase.from('products').select('stock_quantity').eq('id', product.id).single();
  if (near(n(after2?.stock_quantity), stock)) emit('pass', 'stock was left unchanged', []);
  else emit('fail', 'stock changed despite the rejection', [`${stock} -> ${after2?.stock_quantity}`]);
}

async function rowCounts(supabase) {
  const out = {};
  for (const t of ['sales', 'sale_items', 'stock_movements']) {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
    out[t] = count ?? -1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------

function printSqlForManualChecks() {
  const ref = (() => {
    const m = String(URL ?? '').match(/https:\/\/([a-z0-9-]+)\.supabase\./i);
    return m ? m[1] : null;
  })();
  const dashboard = ref
    ? `https://supabase.com/dashboard/project/${ref}/sql`
    : 'https://supabase.com/dashboard';

  console.log(
    `\n${BOLD}Run these in the Supabase SQL Editor${OFF} ${DIM}(RLS hides schema from the app, so a client script cannot read it)${OFF}\n` +
      `${DIM}    ${dashboard}${OFF}`
  );
  console.log(`
  -- 1. Is migration 0007 applied? Both must be numeric, not integer.
  SELECT table_name, column_name, data_type, numeric_precision, numeric_scale
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name IN ('sales','purchases') AND column_name = 'items_count';

  -- 2. Is every watched table in the realtime publication? Nine rows expected.
  SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
   ORDER BY tablename;

  -- 3. RLS enabled on every watched table? All nine must be true.
  SELECT tablename, rowsecurity FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename IN (${WATCHED_TABLES.map((t) => `'${t}'`).join(',')})
   ORDER BY tablename;

  -- 4. Any sale whose items_count disagrees with its lines? Expect zero rows.
  SELECT s.invoice_no, s.items_count, COALESCE(SUM(si.quantity),0) AS line_qty
    FROM sales s LEFT JOIN sale_items si ON si.sale_id = s.id
   GROUP BY s.id, s.invoice_no, s.items_count
  HAVING s.items_count <> COALESCE(SUM(si.quantity),0);
`);
}

function printRealtimeManualSteps() {
  console.log(`${BOLD}Realtime delivery - needs two live sessions${OFF} ${DIM}(subscribing cleanly is not proof of delivery)${OFF}

  1. Two browsers side by side, both signed in to the SAME shop.
  2. In browser A note a product's stock.
  3. In browser B sell 1 of that product.
  4. Within about 400ms A should show "جاري الحفظ في السحابة..." and then the new stock.
  5. Reload A and confirm its figures match B exactly.
  6. Repeat with B on a throttled connection to confirm A recovers.

  If A never updates, run SQL query 2 first: a table missing from
  supabase_realtime subscribes cleanly and then delivers nothing.
`);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  if (!URL || !ANON) {
    console.error(
      `${RED}VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required.${OFF}\nThey live in .env at the project root.`
    );
    return 2;
  }
  if (!EMAIL || !PASSWORD) {
    console.error(
      `${RED}VERIFY_EMAIL and VERIFY_PASSWORD are required.${OFF}\n` +
        `Use a real shop account: this reads that shop's rows under its own RLS policies.\n` +
        `  PowerShell:  $env:VERIFY_EMAIL="you@example.com"; $env:VERIFY_PASSWORD="..."`
    );
    return 2;
  }

  const supabase = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  if (authError) {
    console.error(`${RED}Sign-in failed: ${authError.message}${OFF}`);
    return 2;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('shop_id, full_name')
    .eq('id', auth.user.id)
    .single();
  console.log(`${BOLD}Cloud verification${OFF}  ${DIM}shop ${profile?.shop_id ?? '?'} as ${profile?.full_name ?? EMAIL}${OFF}`);

  await checkDataIntegrity(supabase);
  await checkFractionalSupport(supabase);
  await checkRealtimeSubscription(supabase);
  if (DO_WRITE) await checkAtomicity(supabase);

  if (JSON_MODE) {
    console.log(
      JSON.stringify({
        summary: { checks, failed: failures, warned: warnings },
        shop: profile?.shop_id ?? null,
        atomicityProbed: DO_WRITE,
        checks: results_log,
      })
    );
    return failures ? 1 : 0;
  }

  printSqlForManualChecks();
  printRealtimeManualSteps();

  console.log(
    `\n${BOLD}Summary${OFF}  ${checks} checks, ${GREEN}${checks - failures - warnings} passed${OFF}` +
      (failures ? `, ${RED}${failures} failed${OFF}` : '') +
      (warnings ? `, ${YELLOW}${warnings} warnings${OFF}` : '')
  );
  if (!DO_WRITE) console.log(`${DIM}Atomicity probe skipped. Re-run with --write to include it.${OFF}`);
  if (failures) {
    console.log(`${DIM}Re-run with --json and paste the output to get a precise reading.${OFF}`);
  }
  return failures ? 1 : 0;
}

// Only run when invoked directly, so the test file can import the analysis.
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('verify-cloud.mjs')) {
  // Setting exitCode rather than calling process.exit(): an abrupt exit while the
  // Supabase socket is still closing aborts a libuv handle on Windows.
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`\n${RED}Verification crashed:${OFF} ${err.message}`);
      process.exitCode = 2;
    });
}
