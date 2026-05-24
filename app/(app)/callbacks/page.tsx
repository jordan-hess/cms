import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import CallbackManager from '@/components/callbacks/CallbackManager'

export default async function CallbacksPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user!.id).single()

  const callbackQuery = supabase
    .from('callbacks')
    .select('*, customers(name, phone)')
    .order('scheduled_at', { ascending: true })

  if (profile?.role !== 'admin') callbackQuery.eq('agent_id', user!.id)

  const { data: callbacks } = await callbackQuery

  const { data: customers } = await supabase
    .from('customers')
    .select('id, name, phone')
    .eq('created_by', user!.id)

  return (
    <div>
      <Header title="Callbacks" userId={user!.id} />
      <div className="p-6">
        <CallbackManager callbacks={callbacks || []} customers={customers || []} userId={user!.id} />
      </div>
    </div>
  )
}
