import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const projectRoot = path.resolve(import.meta.dirname, '..')
const envPath = path.join(projectRoot, '.env.local')

const DEV_USERS = [
  {
    email: 'admin@carecms.local',
    password: 'Admin123!',
    full_name: 'Dev Admin',
    role: 'admin',
    department: 'Management',
  },
  {
    email: 'agent@carecms.local',
    password: 'Agent123!',
    full_name: 'Dev Agent',
    role: 'agent',
    department: 'Support',
  },
  {
    email: 'management-dev@carecms.local',
    password: 'Management123!',
    full_name: 'Dev Management',
    role: 'management',
    department: 'Management',
  },
]

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing env file: ${filePath}`)
  }

  const file = fs.readFileSync(filePath, 'utf8')
  const env = {}

  for (const rawLine of file.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex === -1) continue

    const key = line.slice(0, separatorIndex).trim()
    let value = line.slice(separatorIndex + 1).trim()

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    env[key] = value
  }

  return env
}

async function getUserByEmail(adminClient, email) {
  const pageSize = 1000
  let page = 1

  while (true) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: pageSize,
    })

    if (error) throw error

    const match = data.users.find(user => user.email?.toLowerCase() === email.toLowerCase())
    if (match) return match

    if (data.users.length < pageSize) return null
    page += 1
  }
}

async function ensureUser(adminClient, userConfig) {
  const existingUser = await getUserByEmail(adminClient, userConfig.email)

  if (!existingUser) {
    const { data, error } = await adminClient.auth.admin.createUser({
      email: userConfig.email,
      password: userConfig.password,
      email_confirm: true,
      user_metadata: {
        full_name: userConfig.full_name,
        role: userConfig.role,
      },
    })

    if (error) throw error

    const { error: profileError } = await adminClient
      .from('profiles')
      .update({ department: userConfig.department, is_active: true })
      .eq('id', data.user.id)

    if (profileError) throw profileError

    return { action: 'created', id: data.user.id }
  }

  const { error: updateError } = await adminClient.auth.admin.updateUserById(existingUser.id, {
    password: userConfig.password,
    email_confirm: true,
    user_metadata: {
      ...(existingUser.user_metadata ?? {}),
      full_name: userConfig.full_name,
      role: userConfig.role,
    },
  })

  if (updateError) throw updateError

  const { error: profileError } = await adminClient
    .from('profiles')
    .update({
      email: userConfig.email,
      full_name: userConfig.full_name,
      role: userConfig.role,
      department: userConfig.department,
      is_active: true,
    })
    .eq('id', existingUser.id)

  if (profileError) throw profileError

  return { action: 'updated', id: existingUser.id }
}

async function main() {
  const env = loadEnvFile(envPath)
  const supabaseUrl = normalizeSupabaseUrl(env.NEXT_PUBLIC_SUPABASE_URL)
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  }

  if (supabaseUrl.includes('placeholder') || serviceRoleKey.includes('placeholder')) {
    throw new Error('Replace the placeholder Supabase values in .env.local before running setup:users')
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  console.log('Setting up dev users...')

  for (const userConfig of DEV_USERS) {
    const result = await ensureUser(adminClient, userConfig)
    console.log(`${result.action.toUpperCase()}: ${userConfig.role} ${userConfig.email}`)
  }

  console.log('\nDev login details:')
  for (const userConfig of DEV_USERS) {
    console.log(`- ${userConfig.role}: ${userConfig.email} / ${userConfig.password}`)
  }
}

function normalizeSupabaseUrl(rawUrl) {
  if (!rawUrl) return rawUrl

  try {
    const url = new URL(rawUrl)

    // Accept common misconfigurations like a copied REST endpoint and reduce it to the project base URL.
    return url.origin
  } catch {
    return rawUrl
  }
}

main().catch(error => {
  console.error(`Setup failed: ${error.message}`)
  if (error.message.includes('Database error creating new user')) {
    console.error('Repair the auth trigger with supabase/fix-auth-trigger.sql, then rerun npm run setup:users')
  }
  process.exitCode = 1
})
