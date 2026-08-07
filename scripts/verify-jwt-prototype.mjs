// Manual verification script for lib/auth/jwt.ts (no automated test suite
// exists in this project — this matches the project's existing convention
// of manual verification scripts, e.g. scripts/setup-dev-users.mjs).
//
// Run: node scripts/verify-jwt-prototype.mjs
//
// Uses a throwaway local secret, NOT the real Supabase JWT secret (which
// isn't available in this environment) — this only proves the mint/verify
// code itself is correct. Using the actual Supabase project JWT secret
// (Project Settings -> API -> JWT Settings) is what would make tokens
// genuinely valid against the live Supabase Postgres for Phase 1.

process.env.SUPABASE_JWT_SECRET = 'throwaway-local-secret-for-verification-only'

const { mintSupabaseCompatibleJWT, verifySupabaseCompatibleJWT } = await import('../lib/auth/jwt.ts')

async function main() {
  const userId = '11111111-1111-1111-1111-111111111111'
  const email = 'agent@carecms.local'

  console.log('Minting token...')
  const token = await mintSupabaseCompatibleJWT(userId, { email, expiresInSeconds: 60 })
  console.log(`Token: ${token.slice(0, 40)}...`)

  const [, payloadB64] = token.split('.')
  const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  console.log('Decoded payload (unverified, just for inspection):', payload)

  if (payload.role !== 'authenticated') throw new Error(`Expected role=authenticated, got ${payload.role}`)
  if (payload.aud !== 'authenticated') throw new Error(`Expected aud=authenticated, got ${payload.aud}`)
  if (payload.sub !== userId) throw new Error(`Expected sub=${userId}, got ${payload.sub}`)

  console.log('\nVerifying token...')
  const claims = await verifySupabaseCompatibleJWT(token)
  console.log('Verified claims:', claims)

  if (claims.sub !== userId) throw new Error('sub mismatch after verification')
  if (claims.role !== 'authenticated') throw new Error('role mismatch after verification')
  if (claims.email !== email) throw new Error('email mismatch after verification')

  console.log('\nTesting rejection of a tampered token...')
  const tamperedToken = token.slice(0, -5) + 'XXXXX'
  try {
    await verifySupabaseCompatibleJWT(tamperedToken)
    throw new Error('Tampered token was accepted — this is a bug')
  } catch (err) {
    if (err.message === 'Tampered token was accepted — this is a bug') throw err
    console.log(`Correctly rejected: ${err.message}`)
  }

  console.log('\nAll checks passed.')
}

main().catch(err => {
  console.error('FAILED:', err)
  process.exitCode = 1
})
