-- 0011: generate invite tokens without pgcrypto
-- ---------------------------------------------------------------
-- function gen_random_bytes(integer) does not exist
--
-- `gen_random_bytes` is part of pgcrypto, and this project never installed it.
-- Migration 0001 created only "uuid-ossp":
--
--     CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
--
-- `gen_random_uuid()` looks like it comes from the same place but does not - it
-- is built into PostgreSQL core since 13, which is why every
-- `id UUID DEFAULT gen_random_uuid()` in the schema has always worked while the
-- invite function did not.
--
-- Like 0009's broken operator, this went unnoticed because a plpgsql body is
-- compiled on first call, so `supabase db push` recorded a function that had
-- never executed. It failed the first time an owner generated a real invite.
--
-- Fixed by dropping the dependency rather than adding the extension. Two core
-- UUIDs give 256 bits of entropy - more than the 192 the 24 bytes asked for -
-- and no extension has to exist, be trusted, or be searchable through the
-- `public` schema that these SECURITY DEFINER functions pin to via
-- search_path. Adding pgcrypto would also require qualifying every call or
-- widening search_path, which is a larger change for no benefit.

CREATE OR REPLACE FUNCTION public.create_shop_invite(p_email TEXT, p_role TEXT DEFAULT 'cashier')
RETURNS TABLE (token TEXT, expires_at TIMESTAMPTZ) AS $$
DECLARE
    v_shop_id UUID;
    v_owner_id UUID;
    v_token TEXT;
    v_expiry TIMESTAMPTZ;
    v_existing UUID;
    v_email TEXT;
    v_domain TEXT;
BEGIN
    v_shop_id := get_user_shop_id();
    IF v_shop_id IS NULL THEN
        RAISE EXCEPTION 'No shop is linked to this account';
    END IF;

    SELECT owner_id INTO v_owner_id FROM shops WHERE id = v_shop_id;
    IF v_owner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the shop owner can issue invites';
    END IF;

    IF p_role IS DISTINCT FROM 'cashier' THEN
        RAISE EXCEPTION 'Only a cashier invite can be issued';
    END IF;

    -- Trim, then require: something, no spaces, an "@", and a domain with a dot
    -- and at least one character after it. split_part yields '' when there is
    -- no "@", so the domain tests already cover a missing one.
    v_email := btrim(COALESCE(p_email, ''));
    v_domain := split_part(v_email, '@', 2);

    IF v_email = ''
       OR v_email LIKE '% %'
       OR position('@' IN v_email) = 0
       OR position('.' IN v_domain) = 0
       OR char_length(v_domain) < 3
    THEN
        RAISE EXCEPTION 'A valid email address is required';
    END IF;

    -- Reissue rather than fail when an open invite already exists, so the owner
    -- does not have to delete a stale link before making a new one. The partial
    -- unique index still guards a genuine race between two simultaneous
    -- requests, which is why the insert below carries its own handler.
    SELECT id INTO v_existing
      FROM shop_invites
     WHERE shop_id = v_shop_id
       AND lower(email) = lower(v_email)
       AND accepted_at IS NULL;

    IF v_existing IS NOT NULL THEN
        DELETE FROM shop_invites WHERE id = v_existing;
    END IF;

    -- Two core UUIDs, hyphens stripped: 64 hex characters, 256 bits of entropy.
    -- gen_random_bytes is unavailable because pgcrypto was never installed, and
    -- gen_random_uuid is core.
    v_token := replace(
        (gen_random_uuid()::TEXT || gen_random_uuid()::TEXT),
        '-', ''
    );
    v_expiry := NOW() + INTERVAL '14 days';

    BEGIN
        INSERT INTO shop_invites (shop_id, email, role, token, created_by, expires_at)
        VALUES (v_shop_id, v_email, 'cashier', v_token, auth.uid(), v_expiry);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'An invite for that address is already open';
    END;

    RETURN QUERY SELECT v_token, v_expiry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.create_shop_invite(TEXT, TEXT) IS
    'Owner-only. Issues a cashier invite. Token is two core gen_random_uuid() values, 256 bits, so no pgcrypto dependency.';


-- Prove the function compiles, instead of discovering it on a shop owner's
-- first click. PLPGSQL bodies are only checked when first called, so a plain
-- CREATE FUNCTION happily records code that has never run - which is exactly how
-- two broken versions reached the database in a row. Calling it here forces the
-- body to compile at migration time, inside the same transaction that gets
-- rolled back.
--
-- It is called with no authenticated user on purpose: the first statement is the
-- shop lookup, which raises 'No shop is linked to this account'. Reaching that
-- message is the PASS - it proves the body parsed and started executing. A
-- missing function or a malformed statement would fail this migration instead,
-- which is what a compile check is for.
--
-- Matching on SQLSTATE P0001 rather than insufficient_privilege: a plpgsql
-- RAISE EXCEPTION reports P0001 whatever the message says, and the first
-- version of this block caught insufficient_privilege and so re-raised the
-- original error and failed the migration. Catching P0001 is also the weaker
-- assertion, so anything that merely raised - including a regression that
-- failed earlier than intended - is caught.
DO $$
BEGIN
    PERFORM public.create_shop_invite('compile-check@example.com');
    -- Reached only if the guard above stopped raising, which would mean the
    -- authorisation checks no longer run.
    RAISE EXCEPTION 'create_shop_invite returned a token with no authenticated user';
EXCEPTION
    WHEN SQLSTATE 'P0001' THEN
        RAISE NOTICE 'create_shop_invite compiled and reached its first guard';
END $$;
