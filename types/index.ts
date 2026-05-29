export type Role = 'agent' | 'admin'
export type CallbackStatus = 'pending' | 'completed' | 'cancelled' | 'rescheduled'
export type FollowupStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type FollowupType = 'followup' | 'escalation'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type NotificationType = 'info' | 'followup' | 'escalation' | 'reminder'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  department: string | null
  avatar_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Customer {
  id: string
  name: string
  phone: string
  email: string | null
  account_number: string | null
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
  profiles?: Pick<Profile, 'full_name' | 'email'>
}

export interface Callback {
  id: string
  customer_id: string
  agent_id: string
  scheduled_at: string
  query_description: string
  possible_solution: string | null
  status: CallbackStatus
  notes: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
  customers?: Pick<Customer, 'name' | 'phone'>
  profiles?: Pick<Profile, 'full_name'>
}

export interface Followup {
  id: string
  customer_id: string
  agent_id: string
  created_by: string
  type: FollowupType
  query_description: string
  possible_solution: string | null
  status: FollowupStatus
  priority: Priority
  due_date: string | null
  resolution_notes: string | null
  resolved_at: string | null
  created_at: string
  updated_at: string
  customers?: Pick<Customer, 'name' | 'phone'>
  profiles?: Pick<Profile, 'full_name'>
  creator?: Pick<Profile, 'full_name'>
}

export interface Notification {
  id: string
  recipient_id: string
  sender_id: string | null
  followup_id: string | null
  title: string
  message: string
  type: NotificationType
  read: boolean
  read_at: string | null
  created_at: string
  sender?: Pick<Profile, 'full_name'>
  followups?: Pick<Followup, 'type' | 'status' | 'customer_id'>
}

// ─── Roster ──────────────────────────────────────────────────────────────────

export type TeamColor = 'green' | 'blue' | 'red' | 'yellow'
export type AttendanceStatus = 'on_shift' | 'late' | 'absent' | 'sick' | 'leave' | 'off'
export type OverrideType = 'off' | 'swap_in' | 'extra_shift'
export type CalendarView = 'month' | 'week' | 'day'

export interface Team {
  id: string
  name: string
  color: TeamColor
  description: string | null
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  profile_id: string
  joined_at: string
  teams?: Pick<Team, 'id' | 'name' | 'color'>
  profiles?: Pick<Profile, 'id' | 'full_name' | 'email' | 'is_active'>
}

export interface ShiftTemplate {
  id: string
  name: string
  start_time: string   // 'HH:MM:SS' from Postgres
  end_time: string
  work_days: number[]  // ISO day-of-week: 1=Mon … 7=Sun
  description: string | null
  created_at: string
  updated_at: string
}

export interface TeamRotation {
  id: string
  team_id: string
  shift_template_id: string
  week_start_date: string   // 'YYYY-MM-DD', always a Monday
  created_by: string
  created_at: string
  teams?: Pick<Team, 'id' | 'name' | 'color'>
  shift_templates?: Pick<ShiftTemplate, 'id' | 'name' | 'start_time' | 'end_time' | 'work_days'>
}

export interface AttendanceRecord {
  id: string
  profile_id: string
  date: string   // 'YYYY-MM-DD'
  status: AttendanceStatus
  notes: string | null
  marked_by: string
  marked_at: string
  created_at: string
  updated_at: string
}

export interface RosterOverride {
  id: string
  profile_id: string
  date: string   // 'YYYY-MM-DD'
  override_type: OverrideType
  shift_template_id: string | null
  notes: string | null
  created_by: string
  created_at: string
  shift_templates?: Pick<ShiftTemplate, 'id' | 'name' | 'start_time' | 'end_time'> | null
}

/** Fully resolved shift state for one agent on one date — computed client-side */
export interface ResolvedDaySlot {
  profileId: string
  date: string
  isWorkDay: boolean
  shiftTemplate: ShiftTemplate | null
  overrideType: OverrideType | null
  attendanceStatus: AttendanceStatus | null
  effectiveStatus: AttendanceStatus | 'off' | 'no_rotation'
}

/** Shape passed from roster page.tsx → RosterManager */
export interface RosterPageData {
  profile: Profile
  teams: (Team & { team_members: TeamMember[] })[]
  allProfiles: Pick<Profile, 'id' | 'full_name' | 'email' | 'is_active'>[]
  shiftTemplates: ShiftTemplate[]
  rotations: TeamRotation[]
  attendanceRecords: AttendanceRecord[]
  overrides: RosterOverride[]
  userTeam: Team | null
}
