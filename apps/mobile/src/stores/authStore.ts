import { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';

interface AuthState {
  session: Session | null;
  user: User | null;
  tenantId: string | null;
  userRole: string | null;
  isLoading: boolean;

  setSession: (session: Session | null) => void;
  setLoading: (loading: boolean) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  user: null,
  tenantId: null,
  userRole: null,
  isLoading: true,

  setSession: (session) => {
    if (!session) {
      set({ session: null, user: null, tenantId: null, userRole: null });
      return;
    }

    // Extract custom claims injected by Supabase auth hook
    const payload = session.access_token
      ? JSON.parse(atob(session.access_token.split('.')[1]))
      : {};

    set({
      session,
      user: session.user,
      tenantId: payload.tenant_id ?? null,
      userRole: payload.user_role ?? null,
    });
  },

  setLoading: (isLoading) => set({ isLoading }),

  clearAuth: () =>
    set({ session: null, user: null, tenantId: null, userRole: null }),
}));
