docs: record the deployment target and required environment

The build bakes in two values, so a deploy without them silently runs
local-only: the POS would look healthy while every sale went to one browser's
localStorage instead of the shop's database. App.tsx now stops a production
build in that state, and this records what a fresh deploy needs.

  VITE_SUPABASE_URL       project URL
  VITE_SUPABASE_ANON_KEY  public anon key

Both are safe in the browser bundle by design - Supabase protects data with RLS
rather than by hiding the anon key. No service_role key is needed or wanted;
it must never reach a client bundle.

Deployed to https://pos-mahal.vercel.app, connected to this repository so every
push to main builds automatically.
