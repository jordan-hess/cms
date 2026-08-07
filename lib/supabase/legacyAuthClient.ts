import { createBrowserClient } from '@supabase/ssr'

// Grace-window-only: the original pre-Phase-1 browser client, with Supabase's
// own .auth namespace intact (no accessToken override). Used exclusively by
// app/login/legacy/page.tsx as a rollback path while migrating existing
// users off Supabase Auth. Delete this file once the grace window closes.
export function createLegacyAuthClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
