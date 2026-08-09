import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import Header from '@/components/layout/Header'
import FollowupManager from '@/components/followups/FollowupManager'
import { FollowupStatusHistory, FollowupAssignee } from '@/types'

export default async function FollowupsPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', userId!).single()

  const isManagement = profile?.role === 'management'
  const isAdmin = profile?.role === 'admin'

  const followupQuery = supabase
    .from('followups')
    .select('*, customers(name, phone), profiles!followups_agent_id_fkey(full_name), creator:profiles!followups_created_by_fkey(full_name)')
    .order('created_at', { ascending: false })

  if (isManagement) {
    followupQuery.eq('created_by', userId!)   // what they created/assigned
  } else if (!isAdmin) {
    followupQuery.eq('agent_id', userId!)     // unchanged agent behavior
  }
  // admin: no filter, unchanged

  const [{ data: followups }, { data: customers }] = await Promise.all([
    followupQuery,
    supabase.from('customers').select('id, name, phone').order('name', { ascending: true }),
  ])

  const ids = (followups || []).map(f => f.id)
  const { data: statusHistory } = ids.length
    ? await supabase.from('followup_status_history').select('*, profiles(full_name)').in('followup_id', ids).order('changed_at', { ascending: true })
    : { data: [] as FollowupStatusHistory[] }

  let agentCandidates: FollowupAssignee[] = []
  let teamLeaderCandidates: { profile_id: string; profiles: (FollowupAssignee & { is_active: boolean }) | null }[] = []

  if (isManagement) {
    const [{ data: agents }, { data: leaders }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').eq('role', 'agent').eq('is_active', true).order('full_name'),
      // team_leaders has two FKs to profiles (profile_id, assigned_by) — the
      // embed must be qualified or PostgREST errors instead of returning rows
      // (established convention, see app/(app)/coaching/page.tsx).
      supabase.from('team_leaders').select('profile_id, profiles!team_leaders_profile_id_fkey(id, full_name, email, is_active)'),
    ])
    agentCandidates = agents || []
    teamLeaderCandidates = leaders || []
  }

  return (
    <div>
      <Header title="Follow-ups & Escalations" userId={userId!} userRole={profile?.role} />
      <div className="p-6">
        <FollowupManager
          followups={followups || []}
          customers={customers || []}
          userId={userId!}
          isAdmin={isAdmin}
          isManagement={isManagement}
          agentCandidates={agentCandidates}
          teamLeaderCandidates={teamLeaderCandidates}
          statusHistory={statusHistory || []}
        />
      </div>
    </div>
  )
}
