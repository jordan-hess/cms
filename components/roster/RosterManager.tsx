'use client'

import { useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  CalendarView, RosterPageData, AttendanceRecord, RosterOverride,
  TeamMember, TeamRotation, ShiftTemplate,
} from '@/types'
import { buildSlotMap } from '@/lib/roster/resolveShift'
import { getMonthGridDays as getGrid, getWeekDays as getWeek, formatDateKey } from '@/lib/roster/calendarUtils'
import TeamLegend from './TeamLegend'
import CalendarHeader from './CalendarHeader'
import MonthView from './MonthView'
import WeekView from './WeekView'
import DayView from './DayView'
import AssignTeamModal from './admin/AssignTeamModal'
import ShiftTemplateModal from './admin/ShiftTemplateModal'
import AssignRotationModal from './admin/AssignRotationModal'
import MarkAttendanceModal from './admin/MarkAttendanceModal'
import RosterOverrideModal from './admin/RosterOverrideModal'
import RequestsPanel from '@/components/requests/RequestsPanel'
import { Settings2, RotateCcw, Users2, CalendarPlus, Inbox } from 'lucide-react'

type AdminModal = 'assignTeam' | 'shiftTemplate' | 'assignRotation' | 'markAttendance' | 'rosterOverride' | null

interface ModalContext {
  profileId?: string
  date?: string
  teamId?: string
}

export default function RosterManager({ data }: { data: RosterPageData }) {
  const router = useRouter()
  const { profile, teams, allProfiles, shiftTemplates, rotations, attendanceRecords, overrides, userTeam, myRequests, pendingRequests } = data
  const isAdmin = profile.role === 'admin'

  const [view, setView] = useState<CalendarView>('month')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [adminModal, setAdminModal] = useState<AdminModal>(null)
  const [modalCtx, setModalCtx] = useState<ModalContext>({})
  const [requestsPanelOpen, setRequestsPanelOpen] = useState(false)

  const pendingCount = pendingRequests?.filter(r => r.status === 'pending').length ?? 0

  // Build all team_members from the nested teams structure
  const allMembers: TeamMember[] = useMemo(() =>
    teams.flatMap(t => t.team_members), [teams])

  // Determine date range for slot computation based on view
  const visibleDates = useMemo(() => {
    if (view === 'month') {
      return getGrid(currentDate.getFullYear(), currentDate.getMonth())
    }
    if (view === 'week') {
      return getWeek(currentDate)
    }
    return [new Date(currentDate.getFullYear(), currentDate.getMonth(), currentDate.getDate())]
  }, [view, currentDate])

  const slotMap = useMemo(() =>
    buildSlotMap(allProfiles, visibleDates, allMembers, rotations as TeamRotation[], attendanceRecords, overrides),
    [allProfiles, visibleDates, allMembers, rotations, attendanceRecords, overrides])

  // Build pending leave map for admin calendar indicators
  const pendingLeaveMap = useMemo((): Map<string, string[]> => {
    if (!isAdmin || !pendingRequests) return new Map()
    const map = new Map<string, string[]>()
    for (const req of pendingRequests) {
      if (req.type !== 'leave' || req.status !== 'pending') continue
      const leaveDetail = req.leave_requests?.[0]
      if (!leaveDetail) continue
      for (const d of leaveDetail.dates) {
        const existing = map.get(d) ?? []
        existing.push(req.profile_id)
        map.set(d, existing)
      }
    }
    return map
  }, [isAdmin, pendingRequests])

  function navigate(dir: -1 | 1) {
    setCurrentDate(prev => {
      const d = new Date(prev)
      if (view === 'month') d.setMonth(d.getMonth() + dir)
      else if (view === 'week') d.setDate(d.getDate() + dir * 7)
      else d.setDate(d.getDate() + dir)
      return d
    })
  }

  const openModal = useCallback((modal: AdminModal, ctx: ModalContext = {}) => {
    setModalCtx(ctx)
    setAdminModal(modal)
  }, [])

  function onCellClick(profileId: string, date: string) {
    if (view !== 'day') {
      setCurrentDate(new Date(date + 'T00:00:00'))
      setView('day')
    } else if (isAdmin) {
      openModal('markAttendance', { profileId, date })
    }
  }

  function handleSuccess() {
    setAdminModal(null)
    router.refresh()
  }

  const attendanceForCtx = modalCtx.profileId && modalCtx.date
    ? attendanceRecords.find(a => a.profile_id === modalCtx.profileId && a.date === modalCtx.date) ?? null
    : null

  const overrideForCtx = modalCtx.profileId && modalCtx.date
    ? overrides.find(o => o.profile_id === modalCtx.profileId && o.date === modalCtx.date) ?? null
    : null

  const profileNameForCtx = modalCtx.profileId
    ? (allProfiles.find(p => p.id === modalCtx.profileId)?.full_name ?? '')
    : ''

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center">
        {isAdmin && (
          <>
            <button
              onClick={() => openModal('assignTeam')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Users2 className="w-4 h-4" /> Assign to Team
            </button>
            <button
              onClick={() => openModal('assignRotation')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Set Rotation
            </button>
            <button
              onClick={() => openModal('shiftTemplate')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <Settings2 className="w-4 h-4" /> Shift Templates
            </button>
            {view === 'day' && (
              <button
                onClick={() => openModal('markAttendance', { date: formatDateKey(currentDate) })}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <CalendarPlus className="w-4 h-4" /> Mark Attendance
              </button>
            )}
          </>
        )}

        {/* Requests button — visible to all users */}
        <button
          onClick={() => setRequestsPanelOpen(true)}
          className="relative flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 px-4 py-2.5 rounded-lg transition-colors ml-auto"
        >
          <Inbox className="w-4 h-4" />
          Requests
          {isAdmin && pendingCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 bg-amber-500 text-white text-xs w-4 h-4 flex items-center justify-center rounded-full font-semibold leading-none">
              {pendingCount > 9 ? '9+' : pendingCount}
            </span>
          )}
        </button>
      </div>

      <TeamLegend teams={teams} />

      <CalendarHeader
        view={view}
        currentDate={currentDate}
        onViewChange={setView}
        onNavigate={navigate}
        onToday={() => setCurrentDate(new Date())}
      />

      {view === 'month' && (
        <MonthView
          year={currentDate.getFullYear()}
          month={currentDate.getMonth()}
          teams={teams}
          allProfiles={allProfiles}
          slotMap={slotMap}
          onCellClick={onCellClick}
          pendingLeaveMap={isAdmin ? pendingLeaveMap : undefined}
        />
      )}

      {view === 'week' && (
        <WeekView
          currentDate={currentDate}
          teams={teams}
          allProfiles={allProfiles}
          slotMap={slotMap}
          isAdmin={isAdmin}
          onCellClick={onCellClick}
          pendingLeaveMap={isAdmin ? pendingLeaveMap : undefined}
        />
      )}

      {view === 'day' && (
        <DayView
          currentDate={currentDate}
          teams={teams}
          allProfiles={allProfiles}
          slotMap={slotMap}
          isAdmin={isAdmin}
          onMarkAttendance={(profileId, date) => openModal('markAttendance', { profileId, date })}
          onOverride={(profileId, date) => openModal('rosterOverride', { profileId, date })}
          pendingLeaveMap={isAdmin ? pendingLeaveMap : undefined}
        />
      )}

      {/* Requests panel */}
      <RequestsPanel
        open={requestsPanelOpen}
        onClose={() => setRequestsPanelOpen(false)}
        onSuccess={handleSuccess}
        profile={profile}
        userTeam={userTeam}
        isAdmin={isAdmin}
        myRequests={myRequests ?? []}
      />

      {/* Admin modals */}
      {isAdmin && (
        <>
          <AssignTeamModal
            open={adminModal === 'assignTeam'}
            onClose={() => setAdminModal(null)}
            onSuccess={handleSuccess}
            agents={allProfiles}
            teams={teams}
            memberships={allMembers}
          />
          <ShiftTemplateModal
            open={adminModal === 'shiftTemplate'}
            onClose={() => setAdminModal(null)}
            onSuccess={handleSuccess}
            shiftTemplates={shiftTemplates}
          />
          <AssignRotationModal
            open={adminModal === 'assignRotation'}
            onClose={() => setAdminModal(null)}
            onSuccess={handleSuccess}
            teams={teams}
            shiftTemplates={shiftTemplates}
            existingRotations={rotations}
            currentUserId={profile.id}
          />
          {modalCtx.profileId && modalCtx.date && (
            <>
              <MarkAttendanceModal
                open={adminModal === 'markAttendance'}
                onClose={() => setAdminModal(null)}
                onSuccess={handleSuccess}
                profileId={modalCtx.profileId}
                profileName={profileNameForCtx}
                date={modalCtx.date}
                existing={attendanceForCtx as AttendanceRecord | null}
                currentUserId={profile.id}
              />
              <RosterOverrideModal
                open={adminModal === 'rosterOverride'}
                onClose={() => setAdminModal(null)}
                onSuccess={handleSuccess}
                profileId={modalCtx.profileId}
                profileName={profileNameForCtx}
                date={modalCtx.date}
                existing={overrideForCtx as RosterOverride | null}
                shiftTemplates={shiftTemplates}
                currentUserId={profile.id}
              />
            </>
          )}
        </>
      )}
    </div>
  )
}
