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

interface AuthContextType {
  session: Session | null;
  user: User | null;
  shopId: string | null;
  profile: UserProfile | null;
  loading: boolean;
  /** 'cloud' when Supabase is configured, 'offline' when running local-only. */
  mode: 'cloud' | 'offline';
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  shopId: null,
  profile: null,
  loading: true,
  mode: 'offline',
  signOut: async () => {},
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
            fetchProfile(session.user.id);
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

    const { data: { subscription } } = client.auth.onAuthStateChange(async (_event, session) => {
      if (mounted) {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          fetchProfile(session.user.id);
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

  async function fetchProfile(userId: string) {
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
    // cloud bootstrap runs.
    unbindShop();
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
