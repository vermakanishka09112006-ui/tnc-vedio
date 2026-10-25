import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

let supabaseClient: SupabaseClient | null = null;
let clientPromise: Promise<SupabaseClient | null> | null = null;

function createSupabaseClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { flowType: "pkce", autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
  });
}

if (supabaseUrl && supabaseAnonKey) supabaseClient = createSupabaseClient(supabaseUrl, supabaseAnonKey);

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (supabaseClient) return supabaseClient;
  if (!clientPromise) {
    clientPromise = fetch("/api/site-auth/config")
      .then(async (response) => {
        if (!response.ok) return null;
        const config = await response.json() as { supabaseUrl?: string; supabasePublicKey?: string };
        if (!config.supabaseUrl || !config.supabasePublicKey) return null;
        supabaseClient = createSupabaseClient(config.supabaseUrl, config.supabasePublicKey);
        return supabaseClient;
      })
      .catch(() => null);
  }
  return clientPromise;
}

export async function signInWithGoogle(redirectTo: string): Promise<void> {
  const client = await getSupabaseClient();
  if (!client) throw new Error("Google sign-in is not configured. Confirm the latest deployment includes the Supabase public key at build time or serves /api/site-auth/config.");
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  if (error) throw error;
}