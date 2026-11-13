import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}. Copy .env.example to .env.local and fill it in.`);
  return value;
}

// NEXT_PUBLIC_* variables must be read as literal `process.env.NAME` so Next can inline them.
// The publishable key is safe to ship to browsers; row level security protects the data.
export function getSupabase() {
  return createClient<Database>(
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
  );
}
