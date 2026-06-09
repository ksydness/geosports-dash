import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Server-side only — uses service role key, never expose to client
let _client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
    _client = createClient(url, key);
  }
  return _client;
}

// Convenience alias — same as calling getSupabase() directly
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabase() as any)[prop];
  },
});
