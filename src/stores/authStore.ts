import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ProfileRow, UserRole } from '@/types/database.types';
import { supabase } from '@/lib/supabase';
import { pullSupabaseToLocalCache } from '@/lib/supabaseSync';

/**
 * Credenciais provisionadas no Supabase Auth do projeto (permitem autenticar JWT real
 * ao alternar de perfil na UI, respeitando 100% as políticas RLS e RPCs no PostgreSQL).
 */
const ROLE_CREDENTIALS: Record<UserRole, { email: string; password: string }> = {
  ADMIN: { email: 'admin@flordotrigo.com.br', password: 'FlorDoTrigo@2026' },
  GERENTE: { email: 'gerente@flordotrigo.com.br', password: 'FlorDoTrigo@2026' },
  PADEIRO: { email: 'padeiro@flordotrigo.com.br', password: 'FlorDoTrigo@2026' },
  CAIXA: { email: 'caixa@flordotrigo.com.br', password: 'FlorDoTrigo@2026' },
  ATENDENTE: { email: 'atendente@flordotrigo.com.br', password: 'FlorDoTrigo@2026' },
};

export const DEMO_PROFILES: Record<UserRole, ProfileRow> = {
  ADMIN: {
    id: 'aaaaaaaa-0000-4000-a000-000000000001',
    full_name: 'Lucas (Admin / Diretor)',
    role: 'ADMIN',
    commission_rate: 0,
    active: true,
    created_at: '2026-10-17T08:00:00Z',
    updated_at: '2026-10-17T08:00:00Z',
  },
  GERENTE: {
    id: 'aaaaaaaa-0000-4000-a000-000000000002',
    full_name: 'Helena (Gerente Industrial)',
    role: 'GERENTE',
    commission_rate: 1.5,
    active: true,
    created_at: '2026-10-17T08:00:00Z',
    updated_at: '2026-10-17T08:00:00Z',
  },
  PADEIRO: {
    id: 'aaaaaaaa-0000-4000-a000-000000000003',
    full_name: 'Mestre Zé (Chefe de Fornada)',
    role: 'PADEIRO',
    commission_rate: 0,
    active: true,
    created_at: '2026-10-17T08:00:00Z',
    updated_at: '2026-10-17T08:00:00Z',
  },
  CAIXA: {
    id: 'aaaaaaaa-0000-4000-a000-000000000004',
    full_name: 'Carla (Operadora PDV 01)',
    role: 'CAIXA',
    commission_rate: 0.5,
    active: true,
    created_at: '2026-10-17T08:00:00Z',
    updated_at: '2026-10-17T08:00:00Z',
  },
  ATENDENTE: {
    id: 'aaaaaaaa-0000-4000-a000-000000000005',
    full_name: 'Rafael (Balcão & WhatsApp)',
    role: 'ATENDENTE',
    commission_rate: 1.0,
    active: true,
    created_at: '2026-10-17T08:00:00Z',
    updated_at: '2026-10-17T08:00:00Z',
  },
};

interface AuthState {
  profile: ProfileRow | null;
  isSupabaseConnected: boolean;
  isLoading: boolean;
  initialize: () => Promise<void>;
  switchRoleForDemo: (role: UserRole) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      profile: DEMO_PROFILES.ADMIN,
      isSupabaseConnected: false,
      isLoading: false,

      initialize: async () => {
        set({ isLoading: true });
        try {
          const desiredRole = get().profile?.role ?? 'ADMIN';
          const expectedId = DEMO_PROFILES[desiredRole].id;
          const {
            data: { session },
          } = await supabase.auth.getSession();

          let userId = session?.user?.id;

          if (!userId || userId !== expectedId) {
            const creds = ROLE_CREDENTIALS[desiredRole];
            const signRes = await supabase.auth.signInWithPassword(creds);
            userId = signRes.data.user?.id;
          }

          if (userId) {
            const { data: remoteProfile } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', userId)
              .single();

            await pullSupabaseToLocalCache();

            if (remoteProfile) {
              set({ profile: remoteProfile, isSupabaseConnected: true, isLoading: false });
              return;
            }
          }

          set({
            profile: get().profile ?? DEMO_PROFILES.ADMIN,
            isSupabaseConnected: false,
            isLoading: false,
          });
        } catch {
          set({
            profile: get().profile ?? DEMO_PROFILES.ADMIN,
            isSupabaseConnected: false,
            isLoading: false,
          });
        }
      },

      switchRoleForDemo: async (role: UserRole) => {
        // Atualiza otimisticamente e autentica a sessão JWT correspondente no Supabase
        set({ profile: DEMO_PROFILES[role] });
        try {
          const creds = ROLE_CREDENTIALS[role];
          const { data, error } = await supabase.auth.signInWithPassword(creds);
          if (!error && data.user) {
            const { data: remoteProfile } = await supabase
              .from('profiles')
              .select('*')
              .eq('id', data.user.id)
              .single();

            await pullSupabaseToLocalCache();
            if (remoteProfile) {
              set({ profile: remoteProfile, isSupabaseConnected: true });
            }
          }
        } catch {
          // Mantém o perfil local caso esteja sem internet
        }
      },

      signOut: async () => {
        try {
          await supabase.auth.signOut();
        } finally {
          set({ profile: null, isSupabaseConnected: false });
        }
      },
    }),
    {
      name: 'flor-do-trigo-rbac-store',
      partialize: (state) => ({ profile: state.profile }),
    },
  ),
);

export function canAccess(userRole: UserRole | undefined | null, allowedRoles: readonly UserRole[]): boolean {
  if (!userRole) return false;
  return allowedRoles.includes(userRole);
}

export function defaultRouteForRole(role: UserRole): string {
  switch (role) {
    case 'CAIXA':
      return '/perdas';
    case 'PADEIRO':
      return '/pcp';
    case 'ATENDENTE':
      return '/crm';
    case 'ADMIN':
    case 'GERENTE':
      return '/dashboard';
  }
}
