// app/lib/supabaseServer.ts
import { createClient } from '@supabase/supabase-js';

export function getSupabaseServer() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    process.env.SUPABASE_PROJECT_URL;

  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      'Supabase env vars missing. Need SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL and a key (e.g. SUPABASE_PUBLISHABLE_KEY).',
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  return { supabase, supabaseUrl };
}
