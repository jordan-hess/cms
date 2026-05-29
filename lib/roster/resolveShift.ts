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

  // 2. Find the rotation for the agent's team in the ISO week containing this date
  const weekStart = formatDateKey(getISOWeekStart(date))
  const rotation = rotations.find(
    r => r.team_id === member.team_id && r.week_start_date === weekStart,
  )
  if (!rotation || !rotation.shift_templates) return { ...base, effectiveStatus: 'no_rotation' }

  const template = rotation.shift_templates as ShiftTemplate
  const isoDow = getIsoDayOfWeek(date)
  const isWorkDay = template.work_days.includes(isoDow)

  // 3. Check for a roster override
  const override = overrides.find(o => o.profile_id === profileId && o.date === dateStr)
  const overrideType = override ? (override.override_type as OverrideType) : null

  // 4. Check for an attendance record (highest priority)
  const attendance = attendanceRecords.find(a => a.profile_id === profileId && a.date === dateStr)
  const attendanceStatus = attendance ? (attendance.status as AttendanceStatus) : null

  if (attendanceStatus) {
    return {
      profileId, date: dateStr,
      isWorkDay: overrideType === 'swap_in' || overrideType === 'extra_shift' ? true : isWorkDay,
      shiftTemplate: override?.shift_templates ? (override.shift_templates as unknown as ShiftTemplate) : template,
      overrideType,
      attendanceStatus,
      effectiveStatus: attendanceStatus,
    }
  }

  // 5. Override: forced off day
  if (overrideType === 'off') {
    return { ...base, isWorkDay: false, shiftTemplate: template, overrideType, attendanceStatus: null, effectiveStatus: 'off' }
  }

  // 6. Override: swap_in or extra_shift — use override template, treat as work day
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

  // 7. Not a work day per template
  if (!isWorkDay) {
    return { ...base, isWorkDay: false, shiftTemplate: template, overrideType: null, attendanceStatus: null, effectiveStatus: 'off' }
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
