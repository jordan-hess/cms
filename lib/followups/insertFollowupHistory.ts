import { createClient } from '@/lib/supabase/client'
import { FollowupStatus } from '@/types'

export async function insertFollowupHistory(
  supabase: ReturnType<typeof createClient>,
  followupId: string,
  changedBy: string,
  fromStatus: FollowupStatus,
  toStatus: FollowupStatus,
) {
  await supabase.from('followup_status_history').insert({
    followup_id: followupId,
    changed_by: changedBy,
    from_status: fromStatus,
    to_status: toStatus,
  })
}
