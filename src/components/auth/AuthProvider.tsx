import React, { createContext, useContext, useEffect, useState } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '../../lib/supabase';
import { store } from '../../lib/store';
import { onSessionEnded, unbindShop } from '../../lib/dataSource';

interface UserProfile {
  id: string;
  shop_id: string;
  role: string;
  full_name: string;
}

export interface AuthContextType {
  session: Session | null;
  user: User | null;
  shopId: string | null;
  profile: UserProfile | null;
  loading: boolean;
  /** 'cloud' when Supabase is configured, 'offline' when running local-only. */
  mode: 'cloud' | 'offline';
  signOut: () => Promise<void>;
  /**
   * True while the signed-in session came from a password-recovery link.
   *
   * Supabase establishes a real session from the emailed link before the new
   * password is set, so the app would otherwise drop the cashier straight into
   * the POS with the old password still in force. App.tsx checks this ahead of
   * everything else and shows the set-a-new-password screen instead.
   */
  recoveryMode: boolean;
  /** Set a new password during a recovery session. Throws with a usable message. */
  updatePassword: (password: string) => Promise<void>;
  /** Abandon a recovery and return to the sign-in screen. */
  cancelRecovery: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  shopId: null,
  profile: null,
  loading: true,
  mode: 'offline',
  signOut: async () => {},
  recoveryMode: false,
  updatePassword: async () => {},
  cancelRecovery: async () => {},
});

export const useAuth = () => useContext(AuthContext);

/**
 * In local-only mode there is no backend identity, so mirror the cashier session
 * that lib/store.ts keeps in localStorage. This keeps the header and sidebar
 * showing the real operator instead of placeholder text.
 */
function localProfile(): UserProfile | null {
  const localSession = store.getSession();
  if (!localSession) return null;
  return {
    id: localSession.id,
    shop_id: 'local',
    role: localSession.role,
    full_name: localSession.name,
  };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [shopId, setShopId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(
    isSupabaseConfigured ? null : localProfile()
  );
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [recoveryMode, setRecoveryMode] = useState(false);

  useEffect(() => {
    // Local-only mode: there is no backend session to restore.
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false);
      return;
    }

    // Capture the narrowed client so the nested closure below stays type-safe.
    const client = supabase;

    let mounted = true;

    async function getInitialSession() {
      try {
        const { data: { session } } = await client.auth.getSession();
        
        if (mounted) {
          setSession(session);
          setUser(session?.user ?? null);
          
          if (session?.user) {
            fetchProfile(session.user.id, session.user.email ?? '');
          } else {
            setLoading(false);
          }
        }
      } catch (error) {
        console.error('Error fetching session:', error);
        if (mounted) setLoading(false);
      }
    }

    getInitialSession();

    const { data: { subscription } } = client.auth.onAuthStateChange(async (event, session) => {
      if (mounted) {
        // PASSWORD_RECOVERY means the emailed link established a session. The
        // event was previously discarded, so the app could not tell a recovery
        // apart from an ordinary sign-in and let the cashier straight into the
        // POS without ever setting the new password.
        if (event === 'PASSWORD_RECOVERY') {
          setRecoveryMode(true);
        }
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          fetchProfile(session.user.id, session.user.email ?? '');
        } else {
          setShopId(null);
          setProfile(null);
          setLoading(false);
          // The session can also end without an explicit signOut() call - an
          // expired or revoked token, or a sign-out from another tab.
          onSessionEnded();
        }
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function fetchProfile(userId: string, email = '') {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
        
      if (error) {
        console.error('Error fetching profile:', error);
      } else if (data) {
        setShopId(data.shop_id);
        setProfile(data as UserProfile);

        // Mirror the signed-in profile into the store's session.
        //
        // The header, sidebar and dashboard greeting all read the store session,
        // which otherwise stays at the seeded placeholder ('Ø£Ø¨Ùˆ Ø£Ø­Ù…Ø¯') because
        // nothing in cloud mode ever wrote a name into it. Without this, signing
        // in as anybody showed a placeholder name, and the greeting looked
        // hardcoded no matter what the profile said.
        store.setSession({
          id: data.id,
          name: data.full_name,
          email,
          role: data.role,
          shift_started_at: new Date(new Date().setHours(7, 0, 0, 0)).toISOString(),
        });
      }
    } catch (err) {
      console.error('Failed to load profile', err);
    } finally {
      setLoading(false);
    }
  }

  const signOut = async () => {
    // There is no backend session to clear in local-only mode.
    if (!supabase) return;
    await supabase.auth.signOut();
    // Drop the cached shop data: the next cashier must never open the app and
    // see the previous shop's products/debts (or the demo seed) before the
    // cloud bootstrap runs. The mirrored name goes with it, or the next person to
    // sign in briefly sees the previous operator's name.
    store.setSession(null);
    setRecoveryMode(false);
    unbindShop();
  };

  /**
   * Replace the password of the account behind the recovery session.
   *
   * `updateUser` only works because the emailed link already established a
   * session; a plain sign-out link has no authority to change a password. The
   * error is re-thrown as a string so the screen can show it - Supabase's own
   * message is already fit to show, unlike a fetch failure.
   */
  const updatePassword = async (password: string) => {
    if (!supabase) return;
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw new Error(error.message);
    // The session is already valid and stays valid, so leaving recovery mode
    // hands the cashier straight into the POS with the new password in force.
    setRecoveryMode(false);
  };

  /**
   * Abandon the recovery. Signing out is what makes it safe to walk away from a
   * shared till: the recovery session is dropped, so the reset link cannot be
   * replayed later from the browser history.
   */
  const cancelRecovery = async () => {
    await signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user,
        shopId,
        profile,
        loading,
        mode: isSupabaseConfigured ? 'cloud' : 'offline',
        signOut,
        recoveryMode,
        updatePassword,
        cancelRecovery,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
