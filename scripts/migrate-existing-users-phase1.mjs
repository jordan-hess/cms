import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const projectRoot = path.resolve(import.meta.dirname, '..')
const envPath = path.join(projectRoot, '.env.local')

function loadEnvFile(filePath) {
  const file = fs.readFileSync(filePath, 'utf8')
  const env = {}
  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue
    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    env[key] = value
  }
  return env
}

async function main() {
  const env = loadEnvFile(envPath)
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: rows, error: selectErr } = await adminClient
    .from('profiles')
    .select('id, email')
    .is('password_hash', null)

  if (selectErr) throw selectErr

  console.log(`Found ${rows.length} profile(s) with no password_hash yet:`)
  rows.forEach(r => console.log(`  - ${r.email}`))

  if (rows.length === 0) {
    console.log('Nothing to migrate.')
    return
  }

  const { error: updateErr } = await adminClient
    .from('profiles')
    .update({ force_password_change: true })
    .is('password_hash', null)

  if (updateErr) throw updateErr

  console.log(`\nSet force_password_change = true on ${rows.length} profile(s).`)
  console.log('Each of these users must log in via /login/legacy (their existing Supabase Auth')
  console.log('password still works there), which will redirect them to /change-password —')
  console.log('setting a new password there populates profiles.password_hash, after which they')
  console.log('can use the normal /login page going forward.')
}

main().catch(error => {
  console.error(`Migration failed: ${error.message}`)
  process.exitCode = 1
})
