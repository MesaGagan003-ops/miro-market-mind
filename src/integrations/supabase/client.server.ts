// Server-side Supabase client with service role key - bypasses RLS.
// Use this for admin operations in server functions and server routes only.
// For user-authenticated queries (with RLS), use the auth middleware instead.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function getServerEnv(key: string): string | undefined {
  // Cloudflare Workers: env bindings injected into globalThis by the CF adapter
  const cfEnv = (globalThis as Record<string, unknown>).__cf_env__;
  if (cfEnv && typeof cfEnv === "object" && key in cfEnv) {
    return (cfEnv as Record<string, string>)[key];
  }
  // Node.js dev server — guarded so it won't throw on CF Workers runtime
  try {
    return (globalThis as any).process?.env?.[key];
  } catch {
    return undefined;
  }
}

function createSupabaseAdminClient() {
  const SUPABASE_URL = getServerEnv("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = getServerEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing Supabase server environment variables. " +
        "Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set. " +
        "On Cloudflare, add them via: wrangler secret put SUPABASE_SERVICE_ROLE_KEY",
    );
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

// Server-side Supabase client with service role - bypasses RLS
// SECURITY: Only use this for trusted server-side operations, never expose to client code
// Import like: import { supabaseAdmin } from "@/integrations/supabase/client.server";
export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
