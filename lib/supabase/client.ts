import { createBrowserClient } from '@supabase/ssr'
import { TOKEN_LIFETIME_MS, REFRESH_BUFFER_MS } from '@/lib/auth/supabase-token-constants'

let cachedToken: { value: string; expiresAt: number } | null = null
let pending: Promise<string | null> | null = null

async function getAccessToken(): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + REFRESH_BUFFER_MS) {
    return cachedToken.value
  }

  if (pending) return pending

  pending = (async () => {
    try {
      const res = await fetch('/api/auth/supabase-token')
      if (!res.ok) {
        cachedToken = null
        return null
      }

      const { token } = await res.json()
      cachedToken = { value: token, expiresAt: Date.now() + TOKEN_LIFETIME_MS }
      return token
    } catch {
      cachedToken = null
      return null
    } finally {
      pending = null
    }
  })()

  return pending
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: getAccessToken }
  )
}
