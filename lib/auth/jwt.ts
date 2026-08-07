import { SignJWT, jwtVerify } from 'jose'

/**
 * Mints and verifies JWTs shaped like Supabase GoTrue's access tokens.
 *
 * Why this exists: Phase 1 of the Supabase migration (see
 * docs/superpowers/plans or C:\Users\JordanHess\.claude\plans\linear-chasing-shannon.md)
 * swaps the auth system first while leaving Supabase Postgres — and its ~64
 * `auth.uid()`-keyed RLS policies — completely untouched. That only works if
 * the new auth system's tokens are byte-for-byte compatible with what
 * Supabase's PostgREST layer expects: same signing algorithm (HS256), same
 * secret, and the same two claims PostgREST actually reads (`sub` for
 * `auth.uid()`, `role` for which Postgres role the request runs as).
 *
 * The real signing secret is the Supabase project's JWT secret (Project
 * Settings -> API -> JWT Settings) — NOT the anon key or service role key.
 * It must be provided via SUPABASE_JWT_SECRET once Phase 1 actually starts;
 * this module does not hardcode or fabricate one.
 */

const SUPABASE_JWT_AUDIENCE = 'authenticated'
const SUPABASE_JWT_ROLE = 'authenticated'

export interface SupabaseCompatibleClaims {
  sub: string
  role: typeof SUPABASE_JWT_ROLE
  aud: typeof SUPABASE_JWT_AUDIENCE
  email?: string
  iat: number
  exp: number
}

function getSigningSecret(): Uint8Array {
  const secret = process.env.SUPABASE_JWT_SECRET
  if (!secret) {
    throw new Error(
      'SUPABASE_JWT_SECRET is not set. This must be the Supabase project\'s JWT secret ' +
      '(Project Settings -> API -> JWT Settings) so minted tokens validate against the ' +
      'live Supabase Postgres during the Phase 1 auth cutover.'
    )
  }
  return new TextEncoder().encode(secret)
}

export async function mintSupabaseCompatibleJWT(
  userId: string,
  options: { email?: string; expiresInSeconds?: number } = {}
): Promise<string> {
  const expiresInSeconds = options.expiresInSeconds ?? 3600

  return new SignJWT({
    role: SUPABASE_JWT_ROLE,
    ...(options.email ? { email: options.email } : {}),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setAudience(SUPABASE_JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSeconds)
    .sign(getSigningSecret())
}

export async function verifySupabaseCompatibleJWT(token: string): Promise<SupabaseCompatibleClaims> {
  const { payload } = await jwtVerify(token, getSigningSecret(), {
    audience: SUPABASE_JWT_AUDIENCE,
  })

  if (typeof payload.sub !== 'string') {
    throw new Error('Token is missing a valid "sub" claim')
  }
  if (payload.role !== SUPABASE_JWT_ROLE) {
    throw new Error(`Unexpected role claim: ${String(payload.role)}`)
  }

  return {
    sub: payload.sub,
    role: SUPABASE_JWT_ROLE,
    aud: SUPABASE_JWT_AUDIENCE,
    email: typeof payload.email === 'string' ? payload.email : undefined,
    iat: payload.iat!,
    exp: payload.exp!,
  }
}
