import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { auth } from '@/lib/auth/config'
import { mintSupabaseCompatibleJWT } from '@/lib/auth/jwt'

export async function createClient(): Promise<SupabaseClient> {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      accessToken: async () => {
        const session = await auth()
        const userId = session?.user?.id
        if (!userId) return null
        return mintSupabaseCompatibleJWT(userId, { email: session?.user?.email ?? undefined })
      },
    }
  )
}
