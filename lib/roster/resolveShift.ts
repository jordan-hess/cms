import {
  TeamMember, TeamRotation, AttendanceRecord, RosterOverride,
  ShiftTemplate, ResolvedDaySlot, AttendanceStatus, OverrideType,
} from '@/types'
import { formatDateKey, getIsoDayOfWeek, getISOWeekStart } from './calendarUtils'

export function resolveShift(
  profileId: string,
  date: Date,
  teamMembers: TeamMember[],
  rotations: TeamRotation[],
  attendanceRecords: AttendanceRecord[],
  overrides: RosterOverride[],
): ResolvedDaySlot {
  const dateStr = formatDateKey(date)

  const base: Omit<ResolvedDaySlot, 'effectiveStatus'> = {
    profileId,
    date: dateStr,
    isWorkDay: false,
    shiftTemplate: null,
    overrideType: null,
    attendanceStatus: null,
  }

  // 1. Find agent's team membership
  const member = teamMembers.find(m => m.profile_id === profileId)
  if (!member) return { ...base, effectiveStatus: 'no_rotation' }

  // 2. Find all rotations for the agent's team in the ISO week containing this date.
  //    A team can have multiple rotations per week (e.g. Morning Mon–Fri + Night Sat–Sun).
  const weekStart = formatDateKey(getISOWeekStart(date))
  const weekRotations = rotations.filter(
    r => r.team_id === member.team_id && r.week_start_date === weekStart,
  )
  if (weekRotations.length === 0) return { ...base, effectiveStatus: 'no_rotation' }

  // 3. Pick the rotation whose shift template covers today's day-of-week.
  const isoDow = getIsoDayOfWeek(date)
  const rotation = weekRotations.find(r => {
    const t = r.shift_templates as ShiftTemplate | undefined
    return t && t.work_days.includes(isoDow)
  })

  // Team has rotations this week but none cover today → off day
  if (!rotation || !rotation.shift_templates) {
    return { ...base, effectiveStatus: 'off' }
  }

  const template = rotation.shift_templates as ShiftTemplate

  // 4. Check for a roster override
  const override = overrides.find(o => o.profile_id === profileId && o.date === dateStr)
  const overrideType = override ? (override.override_type as OverrideType) : null

  // 5. Check for an attendance record (highest priority)
  const attendance = attendanceRecords.find(a => a.profile_id === profileId && a.date === dateStr)
  const attendanceStatus = attendance ? (attendance.status as AttendanceStatus) : null

  if (attendanceStatus) {
    return {
      profileId, date: dateStr,
      isWorkDay: overrideType === 'swap_in' || overrideType === 'extra_shift' ? true : true,
      shiftTemplate: override?.shift_templates ? (override.shift_templates as unknown as ShiftTemplate) : template,
      overrideType,
      attendanceStatus,
      effectiveStatus: attendanceStatus,
    }
  }

  // 6. Override: forced off day
  if (overrideType === 'off') {
    return { ...base, isWorkDay: false, shiftTemplate: template, overrideType, attendanceStatus: null, effectiveStatus: 'off' }
  }

  // 7. Override: swap_in or extra_shift — use override template, treat as work day
  if (overrideType === 'swap_in' || overrideType === 'extra_shift') {
    const overrideTemplate = override?.shift_templates
      ? (override.shift_templates as unknown as ShiftTemplate)
      : template
    return {
      profileId, date: dateStr,
      isWorkDay: true,
      shiftTemplate: overrideTemplate,
      overrideType,
      attendanceStatus: null,
      effectiveStatus: 'on_shift',
    }
  }

  // 8. Scheduled work day, no attendance record yet
  return {
    profileId, date: dateStr,
    isWorkDay: true,
    shiftTemplate: template,
    overrideType: null,
    attendanceStatus: null,
    effectiveStatus: 'on_shift',
  }
}

/** Build a lookup map for an entire date range at once */
export function buildSlotMap(
  profiles: { id: string }[],
  dates: Date[],
  teamMembers: TeamMember[],
  rotations: TeamRotation[],
  attendanceRecords: AttendanceRecord[],
  overrides: RosterOverride[],
): Map<string, ResolvedDaySlot> {
  const map = new Map<string, ResolvedDaySlot>()
  for (const profile of profiles) {
    for (const date of dates) {
      const slot = resolveShift(profile.id, date, teamMembers, rotations, attendanceRecords, overrides)
      map.set(`${profile.id}:${slot.date}`, slot)
    }
  }
  return map
}
