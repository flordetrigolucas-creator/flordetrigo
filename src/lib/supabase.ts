import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database.types';
import { env } from '@/config/env';

export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'flor-do-trigo-auth',
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

export type TypedSupabaseClient = typeof supabase;

