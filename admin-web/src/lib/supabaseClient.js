import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Fail loudly in dev rather than silently hitting undefined endpoints.
  // eslint-disable-next-line no-console
  console.error(
    '[supabaseClient] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in.'
  );
}

// IMPORTANT: this is the browser client — it only ever uses the PUBLIC
// anon key. Every read/write from this app is subject to Supabase Row
// Level Security. Never import the service_role key into this project.
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
});
