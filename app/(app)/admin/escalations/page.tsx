import { createClient } from '@/lib/supabase/server'
import Header from '@/components/layout/Header'
import EscalationManager from '@/components/admin/EscalationManager'

export default async function AdminEscalationsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [{ data: agents }, { data: customers }, { data: followups }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, email').eq('role', 'agent').eq('is_active', true),
    supabase.from('customers').select('id, name, phone'),
    supabase.from('followups')
      .select('*, customers(name, phone), profiles!followups_agent_id_fkey(full_name)')
      .eq('type', 'escalation')
      .order('created_at', { ascending: false }),
  ])

  return (
    <div>
      <Header title="Escalations" userId={user!.id} userRole="admin" />
      <div className="p-6">
        <EscalationManager
          agents={agents || []}
          customers={customers || []}
          escalations={followups || []}
          adminId={user!.id}
        />
      </div>
    </div>
  )
}
