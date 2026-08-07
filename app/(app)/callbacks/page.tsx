import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import CallbackManager from '@/components/callbacks/CallbackManager'

export default async function CallbacksPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId!).single()
  const isAdmin = profile?.role === 'admin'

  const callbackQuery = supabase
    .from('callbacks')
    .select('*, customers(name, phone), profiles!callbacks_agent_id_fkey(full_name)')
    .order('scheduled_at', { ascending: true })

  if (!isAdmin) callbackQuery.eq('agent_id', userId!)

  const [{ data: callbacks }, { data: customers }, { data: agents }] = await Promise.all([
    callbackQuery,
    supabase.from('customers').select('id, name, phone').order('name', { ascending: true }),
    isAdmin
      ? supabase.from('profiles').select('id, full_name').eq('role', 'agent').eq('is_active', true).order('full_name')
      : Promise.resolve({ data: [] }),
  ])

  return (
    <div>
      <Header title="Callbacks" userId={userId!} userRole={profile?.role} />
      <div className="p-6">
        <CallbackManager
          callbacks={callbacks || []}
          customers={customers || []}
          userId={userId!}
          isAdmin={isAdmin}
          agents={agents || []}
        />
      </div>
    </div>
  )
}
