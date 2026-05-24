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
