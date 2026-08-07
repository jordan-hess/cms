import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth/config'
import { mintSupabaseCompatibleJWT } from '@/lib/auth/jwt'
import { TOKEN_LIFETIME_SECONDS } from '@/lib/auth/supabase-token-constants'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = await mintSupabaseCompatibleJWT(userId, { email: session?.user?.email ?? undefined, expiresInSeconds: TOKEN_LIFETIME_SECONDS })
  return NextResponse.json({ token })
}
