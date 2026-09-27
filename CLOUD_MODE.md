# Cloud Mode (Supabase)

The POS runs in one of two modes, decided by the environment:

| | local-only | cloud |
|---|---|---|
| Trigger | `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` missing | both variables set |
| Data | `localStorage` via `src/lib/store.ts` | Postgres via the RPCs in `src/services/cloudSync.ts` |
| Auth | demo cashier session | Supabase email/password + `profiles.shop_id` |

## How a write flows

```
component → useStore() → src/lib/dataSource.ts
                           ├── local-only → store.executeSale(...)        (synchronous logic)
                           └── cloud       → services/cloudSync.ts
                                                ├─ rpc_execute_sale / rpc_execute_purchase /
                                                │  rpc_execute_customer_payment   (atomic, row-locked)
                                                ├─ rpc_create_product / rpc_update_product
                                                │  (product row + stock movement, one transaction)
                                                └─ PostgREST writes for customers /
                                                   expenses / shop_settings        (RLS scoped)
                                              → server rows pulled back
                                              → store.applyCloudSlices(...)  (render cache)
```

`lib/store.ts` stays the render cache in **both** modes — the cloud path only replaces its
slices with the values Postgres computed (invoice number, stock, weighted average cost,
customer balance). Nothing financial is recomputed in the browser, so two registers can
never disagree with the ledger.

`dataSource` functions are `async` in both modes, so every screen `await`s them; in
local-only mode the promise resolves on the microtask queue, which keeps a single UI code path.

## Database setup

1. Apply `supabase/migrations/0001_initial_schema.sql` (tables, RLS, RPCs, signup trigger)
   — Supabase Dashboard → SQL Editor.
2. **Required security fix:** apply `supabase/migrations/0003_server_authoritative_pricing.sql`.
   It rewrites `rpc_execute_sale` so the invoice price is read from the locked
   product row instead of the value the browser sends. Without it, any client
   holding the anon key can post `unit_price: 0.01` and have `total_amount`,
   `profit` and the customer's debt balance written at that price. It also
   clamps `change_amount` at zero and rejects non-positive quantities/costs.
3. **Required integrity fix:** apply `supabase/migrations/0004_atomic_product_writes.sql`.
   It adds `rpc_create_product` and `rpc_update_product`, which write the product
   row and its `stock_movements` entry in a single transaction. The previous
   client-side two-statement version could commit the product and then fail on
   the movement, leaving stock with no traceable reason (PRD §12).
4. Optional: apply `supabase/migrations/0002_soft_delete_products.sql` to get *archived*
   products instead of hard deletes (see "Deleting products" below).
5. Apply `supabase/migrations/0005_movement_ledger_notes.sql` so the cloud
   `stock_movements` ledger carries the same descriptive Arabic notes the local
   store writes, instead of a hardcoded English `Sale` / `Purchase`.
6. Apply `supabase/migrations/0006_realtime_publication.sql` to publish the
   business tables for live multi-register sync. Without it the app still works;
   a second register just needs a refresh.
7. Apply `supabase/migrations/0007_fractional_items_count.sql` so weighed goods
   are counted exactly: it widens `items_count` to `NUMERIC(10,3)` and stops the
   RPCs flooring it, so a 2.5 kg sale records 2.5 rather than 2. The UI labels
   this figure "كمية" (quantity), not "قطعة" (pieces).
8. Put the project URL + anon key in `.env`:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

`shops` / `profiles` rows are created automatically by the `on_auth_user_created` trigger
on signup, so the first cashier to register owns a fresh, empty shop.
`shop_settings` is created lazily on the first settings save.

### Applying a migration

`supabase/config.toml` must carry the real project ref in `project_id` — the CLI
resolves the linked project from there, and the value written by `supabase init`
is just the working-directory name, which resolves to nothing.

```bash
npx supabase link --project-ref <project-ref>
npx supabase db query --linked --file supabase/migrations/0006_realtime_publication.sql
```

`supabase db push` also works: `supabase_migrations.schema_migrations` has been
backfilled with 0001-0006 so the CLI knows they are applied. Adding 0007 and
beyond is then just `npx supabase db push`. If you ever add a migration by hand,
either run it through `db query --linked --file` and record it, or let `db push`
apply it — do not mix the two, or the two will disagree about what is deployed.

To confirm a migration landed, compare the function body before and after:

```bash
npx supabase db query --linked \
  "SELECT proname, md5(prosrc) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND proname LIKE 'rpc_%';"
```

## Verifying the wiring

```bash
# 1. does the live project expose the exact RPC signatures the app sends?
node temp/probe-rpc-contract.mjs

# 2. same check for the two product RPCs added in migration 0004
node temp/probe-product-rpc.mjs

# 3. can a postgres_changes subscription actually be established for every
#    published table? (row delivery itself needs a signed-in session)
node temp/probe-realtime.mjs

# 4. full round trip with a real account (sale, debt sale, payment, purchase,
#    expense, settings + the two safety guards), then cleans up after itself
node temp/smoke-cloud.mjs you@example.com your-password
```

## Loading a demo catalogue into an empty cloud shop

The local seed uses readable ids (`cat-1`, `prod-3`, …) while every cloud column is a
`uuid`. Pasting the local data straight into Postgres therefore fails with
`invalid input syntax for type uuid: "cat-1"`. Use the seeder instead — it inserts the
categories first and maps every product onto the uuid it received:

```bash
npx tsx temp/seed-demo-shop.ts you@example.com your-password          # seed
npx tsx temp/seed-demo-shop.ts you@example.com your-password --reset  # undo
```

The same guard now runs inside the app: `cloudSync` validates every id before it reaches
PostgREST, so a stale local id produces a readable Arabic message
(«هذا المنتج غير محمّل من السحابة…») instead of a raw Postgres error, and a non-uuid
`category_id` is stored as `NULL` (product saves without a category).

## Calling the REST API by hand

Every request to `https://<ref>.supabase.co/rest/v1/...` needs the anon key in the
`apikey` header, otherwise the gateway answers
`{"message":"No API key found in request"}`:

```bash
curl "https://<ref>.supabase.co/rest/v1/categories?select=*" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY"
```

## Behaviour notes

- **Bootstrap gate** – in cloud mode the app shows a loading screen until the shop is pulled,
  and a retry screen (never demo data) if that fails. Local-only mode is unaffected.
- **Sign-out** – clears the cached shop data so the next cashier cannot see the previous
  shop's numbers offline.
- **Deleting products** – `sale_items` / `purchase_items` / `stock_movements` reference
  `products(id)` without `ON DELETE CASCADE`, so Postgres refuses to delete a product that
  already has history. With `0002_soft_delete_products.sql` applied, deletes archive the row
  (`is_active = false`) instead. `cloudSync.probeSoftDelete()` detects the column at runtime,
  so the app works with or without the migration.
- **Reset to demo data** – local-only feature; blocked in cloud mode so real shop data can
  never be replaced by the sample dataset.
- **Realtime** – a second register now sees another cashier's writes without a
  reload. `supabase/migrations/0006_realtime_publication.sql` publishes the nine
  business tables to the `supabase_realtime` publication, and
  `src/services/realtime.ts` subscribes to them per shop. A change is treated
  only as a *signal to re-read* (`dataSource.refreshOperationalSlices`) rather
  than patched into the cache, because a single sale touches five tables at once
  and only the server knows the resulting weighted average cost, invoice number
  and customer balance. Events are debounced 400ms to coalesce the per-table
  burst, categories and `shop_settings` are excluded from the watch list, and the
  subscription is torn down in `unbindShop()` / `onSessionEnded()`. Delivery is
  scoped by the existing RLS policies, so a client only ever receives changes for
  the shop its own token resolves to.
