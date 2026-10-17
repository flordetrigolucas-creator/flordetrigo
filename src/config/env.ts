import { z } from 'zod';

const envSchema = z.object({
  VITE_SUPABASE_URL: z.string().url('VITE_SUPABASE_URL inválida'),
  VITE_SUPABASE_ANON_KEY: z.string().min(20, 'VITE_SUPABASE_ANON_KEY ausente'),
  VITE_POS_TERMINAL_ID: z
    .string()
    .regex(/^[A-Z0-9-]{3,20}$/, 'VITE_POS_TERMINAL_ID deve conter A-Z, 0-9 e hífen')
    .default('CAIXA-01'),
});

const parsed = envSchema.safeParse(import.meta.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Configuração de ambiente inválida. Verifique o arquivo .env:\n${issues}`);
}

export const env = {
  supabaseUrl: parsed.data.VITE_SUPABASE_URL,
  supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
  posTerminalId: parsed.data.VITE_POS_TERMINAL_ID,
} as const;

