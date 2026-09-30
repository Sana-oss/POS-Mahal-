-- 0010: repair the email validation in create_shop_invite
-- ---------------------------------------------------------------
-- 0009 wrote the address check as
--
--     IF p_email IS NULL OR btrim(p_email) = '' OR p_email !* '@...' THEN
--
-- `!*` is not a PostgreSQL operator - the "does not match regex" operator is
-- `!~`. The intent was to avoid `!` being mangled on the way into the file, which
-- was a bad trade: it shipped a broken expression into a live database.
--
-- The migration reported success because the body is only compiled on first
-- call, so the failure surfaced the moment an owner actually generated an
-- invite:
--
--     operator does not exist: text !* unknown
--
-- Rewritten with position() and split_part(), which are ordinary functions with
-- no operator ambiguity and nothing to mangle. Same intent, no regex.

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

    v_token := encode(gen_random_bytes(24), 'hex');
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
    'Owner-only. Issues a cashier invite for this shop. Validates the address with position()/split_part() rather than a regex operator.';
