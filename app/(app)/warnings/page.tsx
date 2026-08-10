import { createClient } from '@/lib/supabase/server'
import { getCurrentUserId } from '@/lib/auth/getCurrentUserId'
import { redirect } from 'next/navigation'
import Header from '@/components/layout/Header'
import WarningsManager from '@/components/warnings/WarningsManager'
import { Warning, WarningTargetCandidate } from '@/types'

export default async function WarningsPage() {
  const supabase = await createClient()
  const userId = await getCurrentUserId(supabase)
  if (!userId) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .single()

  if (!profile) redirect('/login')
  if (profile.role === 'agent') redirect('/dashboard')

  const isAdmin = profile.role === 'admin'
  const isManagement = profile.role === 'management'

  const { data: teamLeaderRows } = isAdmin
    ? await supabase.from('team_leaders').select('team_id').eq('profile_id', userId)
    : { data: [] as { team_id: string }[] }
  const isTeamLeader = (teamLeaderRows ?? []).length > 0

  // RLS alone determines which rows come back — no manual filtering needed.
  // target.role is fetched specifically so the client can split management's
  // list into "Agent Warnings" vs "Team-Leader Warnings" (issued_to is never
  // anything but 'agent' or 'admin', per the warnings_insert policy).
  const { data: warnings } = await supabase
    .from('warnings')
    .select('*, target:profiles!warnings_issued_to_fkey(id, full_name, email, role), issuer:profiles!warnings_issued_by_fkey(id, full_name, email)')
    .order('created_at', { ascending: false })

  // Target-candidate pool for the "New Warning" picker, role-dependent.
  let targetCandidates: WarningTargetCandidate[] = []
  if (isManagement) {
    const { data: leaders } = await supabase
      .from('team_leaders')
      .select('profiles!team_leaders_profile_id_fkey(id, full_name, email)')
    const map = new Map<string, WarningTargetCandidate>()
    for (const row of leaders ?? []) {
      const p = row.profiles as unknown as WarningTargetCandidate | null
      if (p && !map.has(p.id)) map.set(p.id, p)
    }
    targetCandidates = Array.from(map.values())
  } else if (isAdmin && isTeamLeader) {
    const teamIds = (teamLeaderRows ?? []).map(r => r.team_id)
    const { data: members } = await supabase
      .from('team_members')
      .select('profiles(id, full_name, email)')
      .in('team_id', teamIds)
    const map = new Map<string, WarningTargetCandidate>()
    for (const row of members ?? []) {
      const p = row.profiles as unknown as WarningTargetCandidate | null
      if (p && !map.has(p.id)) map.set(p.id, p)
    }
    targetCandidates = Array.from(map.values())
  } else if (isAdmin) {
    const { data: agents } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'agent')
      .eq('is_active', true)
      .order('full_name')
    targetCandidates = agents ?? []
  }

  return (
    <div className="flex-1 overflow-auto">
      <Header title="Warnings" userId={profile.id} userRole={profile.role} />
      <div className="p-6">
        <WarningsManager
          warnings={(warnings ?? []) as Warning[]}
          targetCandidates={targetCandidates}
          currentUserId={userId}
          isManagement={isManagement}
        />
      </div>
    </div>
  )
}
