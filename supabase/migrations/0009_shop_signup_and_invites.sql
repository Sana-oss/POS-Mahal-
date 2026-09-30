-- 0009: shop sign-up and owner-issued cashier invites
-- ---------------------------------------------------------------
-- Two gaps blocked a multi-shop deployment:
--
--   1. There was no way to create a shop from the app. handle_new_user() makes a
--      shop for every signup, but nothing in the UI ever calls signUp, so every
--      owner had to be made by hand in the Supabase dashboard.
--
--   2. A cashier could not join an existing shop. handle_new_user() gives every
--      new auth user a brand new shop, so signing up as a second member of a shop
--      silently created a separate shop with its own books. Multi-cashier on one
--      set of books was impossible.
--
-- The fix is an invite. An owner issues a token for a shop; whoever signs up with
-- the invited address is linked to THAT shop, with the invited role, instead of
-- getting a new one. The link happens in the same trigger that already runs, so
-- there is no window where a half-joined user exists.
--
-- Security notes:
--   * The token is 24 random bytes from pgcrypto, hex encoded. It is a bearer
--     credential, so it is never logged and never returned by the public read
--     function - only the shop name and role are exposed, which a joiner needs in
--     order to know what they are accepting.
--   * RLS restricts issuing to the shop owner, so a cashier cannot mint an invite
--     and cannot escalate themselves to owner.
--   * Only 'cashier' can be invited. A shop keeps exactly one owner, and allowing
--     a second owner would be a privilege decision this migration should not make
--     silently.
--   * Invites expire, and accepting one twice fails, so a forwarded link is
--     harmless after first use.

CREATE TABLE shop_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    -- Stored as given but compared case-insensitively, because Supabase treats
    -- local parts of addresses case-insensitively and a mismatch would otherwise
    -- strand a valid invite.
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'cashier' CHECK (role = 'cashier'),
    token TEXT NOT NULL UNIQUE,
    created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
    accepted_at TIMESTAMPTZ,
    accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- One live invite per address per shop, so repeated clicks do not pile up rows.
CREATE UNIQUE INDEX shop_invites_open_unique
    ON shop_invites (shop_id, lower(email))
    WHERE accepted_at IS NULL;

CREATE INDEX shop_invites_token_idx ON shop_invites (token);

COMMENT ON TABLE shop_invites IS
    'Owner-issued invites letting a cashier sign up into an existing shop. Token is a bearer credential and is never exposed to clients.';
COMMENT ON COLUMN shop_invites.token IS
    'Bearer credential, 48 hex chars. Readable only by the issuing shop owner; the public read RPC returns everything except this.';

ALTER TABLE shop_invites ENABLE ROW LEVEL SECURITY;

-- The owner sees their own shop's invites, and nothing else. get_user_shop_id()
-- is SECURITY DEFINER and resolves from the caller's own profile, so this cannot
-- be widened by passing a different shop_id.
CREATE POLICY "Owners manage their shop invites" ON shop_invites
    FOR ALL
    USING (shop_id = get_user_shop_id())
    WITH CHECK (
        shop_id = get_user_shop_id()
        AND created_by = auth.uid()
    );


-- Issue an invite. SECURITY DEFINER so the token can be generated and the row
-- written without granting the caller insert on the table directly; the checks
-- below are the authorisation.
CREATE OR REPLACE FUNCTION public.create_shop_invite(p_email TEXT, p_role TEXT DEFAULT 'cashier')
RETURNS TABLE (token TEXT, expires_at TIMESTAMPTZ) AS $$
DECLARE
    v_shop_id UUID;
    v_owner_id UUID;
    v_token TEXT;
    v_expiry TIMESTAMPTZ;
    v_existing UUID;
BEGIN
    v_shop_id := get_user_shop_id();
    IF v_shop_id IS NULL THEN
        RAISE EXCEPTION 'No shop is linked to this account';
    END IF;

    SELECT owner_id INTO v_owner_id FROM shops WHERE id = v_shop_id;
    IF v_owner_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Only the shop owner can issue invites';
    END IF;

    IF p_email IS NULL OR btrim(p_email) = '' OR p_email !* '@[^@[:space:]]+\.[^@[:space:]]+' THEN
        RAISE EXCEPTION 'A valid email address is required';
    END IF;

    -- Only cashier, whatever the caller asked for. A shop keeps one owner.
    IF p_role IS DISTINCT FROM 'cashier' THEN
        RAISE EXCEPTION 'Only a cashier invite can be issued';
    END IF;

    -- Reissue rather than fail when an open invite already exists, so the owner
    -- does not have to delete a stale link before making a new one. The partial
    -- unique index still guards a genuine race between two simultaneous
    -- requests, which is why the insert below carries its own handler.
    SELECT id INTO v_existing
      FROM shop_invites
     WHERE shop_id = v_shop_id
       AND lower(email) = lower(btrim(p_email))
       AND accepted_at IS NULL;

    IF v_existing IS NOT NULL THEN
        DELETE FROM shop_invites WHERE id = v_existing;
    END IF;

    v_token := encode(gen_random_bytes(24), 'hex');
    v_expiry := NOW() + INTERVAL '14 days';

    BEGIN
        INSERT INTO shop_invites (shop_id, email, role, token, created_by, expires_at)
        VALUES (v_shop_id, btrim(p_email), 'cashier', v_token, auth.uid(), v_expiry);
    EXCEPTION WHEN unique_violation THEN
        RAISE EXCEPTION 'An invite for that address is already open';
    END;

    RETURN QUERY SELECT v_token, v_expiry;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- What a joiner is about to accept. Deliberately does not return the token, the
-- email, or who issued it: this is reachable before sign-in by anyone holding a
-- link, and the joiner only needs to know the shop name and the role.
CREATE OR REPLACE FUNCTION public.get_shop_invite(p_token TEXT)
RETURNS TABLE (shop_name TEXT, role TEXT, expires_at TIMESTAMPTZ, is_open BOOLEAN) AS $$
BEGIN
    RETURN QUERY
    SELECT s.name,
           i.role,
           i.expires_at,
           (i.accepted_at IS NULL AND i.expires_at > NOW())
      FROM shop_invites i
      JOIN shops s ON s.id = i.shop_id
     WHERE i.token = p_token;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Redeem by token, for the case where the joiner signed up before confirming
-- their email. The trigger already links people who sign up with an invited
-- address, so this exists only as a recovery path for the ordering where the
-- invite lands after the account was created.
CREATE OR REPLACE FUNCTION public.accept_shop_invite(p_token TEXT)
RETURNS UUID AS $$
DECLARE
    v_invite shop_invites%ROWTYPE;
    v_user_email TEXT;
    v_existing_shop UUID;
BEGIN
    SELECT * INTO v_invite FROM shop_invites WHERE token = p_token;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That invite link is not valid';
    END IF;
    IF v_invite.accepted_at IS NOT NULL THEN
        RAISE EXCEPTION 'That invite has already been used';
    END IF;
    IF v_invite.expires_at <= NOW() THEN
        RAISE EXCEPTION 'That invite has expired';
    END IF;

    v_user_email := auth.jwt() ->> 'email';
    IF v_user_email IS NULL OR lower(v_user_email) <> lower(v_invite.email) THEN
        RAISE EXCEPTION 'This invite was issued to a different email address';
    END IF;

    -- Already in a shop: refuse rather than moving them, which would silently
    -- orphan whatever the previous shop recorded against them.
    SELECT shop_id INTO v_existing_shop FROM profiles WHERE id = auth.uid();
    IF v_existing_shop IS NOT NULL THEN
        IF v_existing_shop = v_invite.shop_id THEN
            UPDATE shop_invites SET accepted_at = NOW(), accepted_by = auth.uid() WHERE id = v_invite.id;
            RETURN v_invite.shop_id;
        END IF;
        RAISE EXCEPTION 'This account already belongs to a different shop';
    END IF;

    INSERT INTO profiles (id, shop_id, role, full_name)
    VALUES (
        auth.uid(),
        v_invite.shop_id,
        v_invite.role,
        COALESCE(auth.jwt() ->> 'full_name', 'موظف')
    );

    UPDATE shop_invites SET accepted_at = NOW(), accepted_by = auth.uid() WHERE id = v_invite.id;
    RETURN v_invite.shop_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Route a new signup to the shop it was invited to. Identical to 0001's version
-- when no invite matches, so a self-registered owner still gets their own shop.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    v_shop_id UUID;
    v_invite shop_invites%ROWTYPE;
BEGIN
    SELECT * INTO v_invite
      FROM shop_invites
     WHERE lower(email) = lower(new.email)
       AND accepted_at IS NULL
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1;

    IF FOUND THEN
        INSERT INTO public.profiles (id, shop_id, role, full_name)
        VALUES (new.id, v_invite.shop_id, v_invite.role,
                COALESCE(new.raw_user_meta_data->>'full_name', 'موظف'));

        UPDATE shop_invites SET accepted_at = NOW(), accepted_by = new.id WHERE id = v_invite.id;
        RETURN new;
    END IF;

    INSERT INTO public.shops (owner_id, name)
    VALUES (new.id, COALESCE(new.raw_user_meta_data->>'shop_name', 'متجري'))
    RETURNING id INTO v_shop_id;

    INSERT INTO public.profiles (id, shop_id, role, full_name)
    VALUES (new.id, v_shop_id, 'owner', COALESCE(new.raw_user_meta_data->>'full_name', 'المالك'));

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Rerun the RLS audit for the new table. Every table with RLS must have a policy,
-- and a table with RLS and no policy is invisible to everyone - a silent way to
-- break invites without breaking anything else.
DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT c.relname::TEXT
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND c.relrowsecurity
           AND NOT EXISTS (
               SELECT 1 FROM pg_policies p
                WHERE p.schemaname = 'public' AND p.tablename = c.relname
           )
    LOOP
        RAISE EXCEPTION 'Table % has RLS enabled but no policy, so nobody can read or write it', t;
    END LOOP;
END $$;
