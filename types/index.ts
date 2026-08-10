export type Role = 'agent' | 'admin' | 'management'
export type CallbackStatus = 'pending' | 'completed' | 'cancelled' | 'rescheduled'
export type FollowupStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
export type FollowupType = 'followup' | 'escalation'
export type Priority = 'low' | 'normal' | 'high' | 'urgent'
export type NotificationType = 'info' | 'followup' | 'escalation' | 'reminder' | 'request' | 'callback'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: Role
  department: string | null
  avatar_url: string | null
  is_active: boolean
  force_password_change: boolean
  created_at: string
  updated_at: string
}

export interface PasswordResetRequest {
  id: string
  profile_id: string
  status: 'pending' | 'approved' | 'rejected'
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  profiles?: Pick<Profile, 'full_name' | 'email'>
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
  created_by: string | null
  scheduled_at: string
  query_description: string
  possible_solution: string | null
  status: CallbackStatus
  notes: string | null
  completed_at: string | null
  reminder_sent: boolean
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
  callback_id: string | null
  request_id: string | null
  title: string
  message: string
  type: NotificationType
  read: boolean
  read_at: string | null
  created_at: string
  sender?: Pick<Profile, 'full_name'>
  followups?: Pick<Followup, 'type' | 'status' | 'customer_id'>
}

export interface FollowupStatusHistory {
  id: string
  followup_id: string
  changed_by: string
  from_status: FollowupStatus
  to_status: FollowupStatus
  comment: string | null
  changed_at: string
  profiles?: Pick<Profile, 'full_name'>
}

/** Shared shape for the "Assign to" candidate pool (agents ∪ team leaders) */
export type FollowupAssignee = Pick<Profile, 'id' | 'full_name' | 'email'>

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
  myRequests?: RequestWithDetail[]
  pendingRequests?: RequestWithDetail[]
  teamLeaderTeamIds?: string[]
}

// ─── Team Leaders ─────────────────────────────────────────────────────────────

export interface TeamLeader {
  id: string
  team_id: string
  profile_id: string
  assigned_by: string
  created_at: string
  teams?: Pick<Team, 'id' | 'name' | 'color'>
  profiles?: Pick<Profile, 'id' | 'full_name' | 'email'>
}

export interface RequestApprovalHistory {
  id: string
  request_id: string
  changed_by: string
  from_status: RequestStatus
  to_status: RequestStatus
  comment: string | null
  changed_at: string
  profiles?: Pick<Profile, 'full_name'>
}

// ─── Requests ─────────────────────────────────────────────────────────────────

export type RequestStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'changes_requested'
export type RequestType = 'leave' | 'overtime'
export type LeaveType = 'annual' | 'sick' | 'family_responsibility' | 'unpaid' | 'other'
export type ShiftType = 'day' | 'night' | 'evening'

export interface Request {
  id: string
  profile_id: string
  team_id: string | null
  type: RequestType
  status: RequestStatus
  admin_comment: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  profiles?: Pick<Profile, 'id' | 'full_name' | 'email'>
  teams?: Pick<Team, 'id' | 'name' | 'color'> | null
  reviewer?: Pick<Profile, 'full_name'> | null
}

export interface LeaveRequest {
  id: string
  request_id: string
  leave_type: LeaveType
  dates: string[]
  notes: string | null
}

export interface OvertimeRequest {
  id: string
  request_id: string
  month: number
  year: number
  notes: string | null
  overtime_entries?: OvertimeEntry[]
}

export interface OvertimeEntry {
  id: string
  overtime_request_id: string
  date: string
  shift: ShiftType
  ot_1_5: number
  ot_2_0: number
  night_hours: number
  sort_order: number
}

/** A request with its type-specific detail joined in */
export interface RequestWithDetail extends Request {
  leave_requests?: LeaveRequest[]
  overtime_requests?: (OvertimeRequest & { overtime_entries?: OvertimeEntry[] })[]
}

// ─── Warnings ─────────────────────────────────────────────────────────────────

export type WarningType = 'verbal' | 'written' | 'final'

export interface Warning {
  id: string
  issued_to: string
  issued_by: string
  type: WarningType
  reason: string
  created_at: string
  updated_at: string
  target?: Pick<Profile, 'id' | 'full_name' | 'email' | 'role'>
  issuer?: Pick<Profile, 'id' | 'full_name' | 'email'>
}

/** Shared shape for the "who can I warn" target-candidate pool */
export type WarningTargetCandidate = Pick<Profile, 'id' | 'full_name' | 'email'>

// ─── Coaching ─────────────────────────────────────────────────────────────────

export interface CoachingAgentCheckin {
  id: string
  profile_id: string
  period_month: string   // 'YYYY-MM-DD', always the 1st of the month
  done: boolean
  completed_at: string | null
  marked_by: string | null
  created_at: string
  updated_at: string
}

export type CoachingLeaderCheckin = CoachingAgentCheckin

// ─── Team Leaders Management (board view-model) ────────────────────────────────

/** Computed client-side board-column view-model, one per team */
export interface TeamBoardColumn {
  team: Team
  leader: (Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'> & { teamLeaderRowId: string }) | null
  members: Pick<Profile, 'id' | 'full_name' | 'email' | 'role' | 'department' | 'is_active'>[]
}

/** Computed client-side card view-model, one per unique team leader */
export interface CoachingLeaderCard {
  leaderId: string
  leaderName: string
  leaderDepartment: string | null
  teamIds: string[]
  agents: { id: string; full_name: string; done: boolean }[]
  completedCount: number
  totalCount: number
  leaderCheckinDone: boolean
}
