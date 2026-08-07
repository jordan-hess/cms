import { createBrowserClient } from '@supabase/ssr'

// Grace-window-only: the original pre-Phase-1 browser client, with Supabase's
// own .auth namespace intact (no accessToken override). Used by
// app/login/legacy/page.tsx as a rollback path while migrating existing
// users off Supabase Auth, and by Sidebar.tsx to also clear a legacy session
// on sign-out. Delete this file once the grace window closes.
//
// isSingleton: false is required here. @supabase/ssr's createBrowserClient()
// caches ONE client in a module-level variable shared by the whole page,
// keyed by nothing at all (not even URL/key) -- the first caller anywhere in
// the app wins and every later call silently receives that same cached
// client, ignoring whatever options it was given. lib/supabase/client.ts's
// createClient() (the accessToken-configured client used for all normal
// browser-side reads/writes) relies on being that first-cached singleton.
// Without isSingleton: false, whichever of these two clients happens to be
// constructed first in a given browser tab (e.g. this one, if the user's tab
// started at /login/legacy) would clobber the other for the rest of the
// tab's lifetime: either every accessToken-based query app-wide silently
// loses its JWT, or this client silently gains an accessToken option and
// throws "accessing supabase.auth.signOut is not possible" the moment
// Sidebar.tsx's handleLogout calls it.
export function createLegacyAuthClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { isSingleton: false }
  )
}
