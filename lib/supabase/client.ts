import { createBrowserClient } from '@supabase/ssr'

let cachedToken: { value: string; expiresAt: number } | null = null

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 10_000) {
    return cachedToken.value
  }

  const res = await fetch('/api/auth/supabase-token')
  if (!res.ok) {
    cachedToken = null
    return null
  }

  const { token } = await res.json()
  cachedToken = { value: token, expiresAt: Date.now() + 5 * 60 * 1000 }
  return token
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: getAccessToken }
  )
}
