import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-side Supabase client using the service (secret) key. Bypasses RLS for
// trusted server actions (e.g. stamping the filed doc number onto nesting_jobs).
// Never import this into a client component — the secret key is server-only
// (not a NEXT_PUBLIC_ var, so Next will not bundle it), and it lives behind
// "use server" actions.
let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY are not configured");
  }
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}
