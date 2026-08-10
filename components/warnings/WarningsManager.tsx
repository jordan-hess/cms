'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Warning, WarningTargetCandidate, WarningType } from '@/types'
import { AlertTriangle, MessageSquare, FileText, ShieldAlert, Plus } from 'lucide-react'
import { format } from 'date-fns'
import WarningModal from './WarningModal'

interface Props {
  warnings: Warning[]
  targetCandidates: WarningTargetCandidate[]
  currentUserId: string
  isManagement: boolean
}

type ListTab = 'agent' | 'team_leader'

const typeBadge: Record<WarningType, string> = {
  verbal:  'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
  written: 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-400',
  final:   'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
}

const typeLabel: Record<WarningType, string> = {
  verbal: 'Verbal',
  written: 'Written',
  final: 'Final',
}

const tileCls = 'bg-white dark:bg-gray-900 rounded-xl p-5 shadow-sm border border-gray-100 dark:border-gray-800'

export default function WarningsManager({ warnings, targetCandidates, currentUserId, isManagement }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const [tab, setTab] = useState<ListTab>('agent')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Warning | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)
  const [error, setError] = useState('')

  const counts = useMemo(() => {
    const agentWarnings = warnings.filter(w => w.target?.role === 'agent')
    const teamLeaderWarnings = warnings.filter(w => w.target?.role === 'admin')
    const relevant = isManagement ? warnings : agentWarnings
    return {
      totalAgent: agentWarnings.length,
      totalTeamLeader: teamLeaderWarnings.length,
      verbal: relevant.filter(w => w.type === 'verbal').length,
      written: relevant.filter(w => w.type === 'written').length,
      final: relevant.filter(w => w.type === 'final').length,
    }
  }, [warnings, isManagement])

  const displayed = useMemo(() => {
    if (!isManagement) return warnings
    return warnings.filter(w => (tab === 'agent' ? w.target?.role === 'agent' : w.target?.role === 'admin'))
  }, [warnings, isManagement, tab])

  function openAdd() { setEditing(null); setError(''); setModal(true) }
  function openEdit(w: Warning) { setEditing(w); setError(''); setModal(true) }

  async function handleDelete(id: string) {
    const { error } = await supabase.from('warnings').delete().eq('id', id)
    if (error) { setError(error.message); return }
    setConfirmingDelete(null)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className={`grid grid-cols-2 ${isManagement ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-4`}>
        {isManagement ? (
          <>
            <div className={tileCls}>
              <div className="flex items-center justify-between mb-3">
                <div className="bg-blue-500 rounded-lg p-2"><AlertTriangle className="w-5 h-5 text-white" /></div>
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.totalAgent}</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total Agent Warnings</p>
            </div>
            <div className={tileCls}>
              <div className="flex items-center justify-between mb-3">
                <div className="bg-indigo-500 rounded-lg p-2"><AlertTriangle className="w-5 h-5 text-white" /></div>
                <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.totalTeamLeader}</span>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total Team-Leader Warnings</p>
            </div>
          </>
        ) : (
          <div className={tileCls}>
            <div className="flex items-center justify-between mb-3">
              <div className="bg-blue-500 rounded-lg p-2"><AlertTriangle className="w-5 h-5 text-white" /></div>
              <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.totalAgent}</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Total Recorded Warnings</p>
          </div>
        )}
        <div className={tileCls}>
          <div className="flex items-center justify-between mb-3">
            <div className="bg-yellow-500 rounded-lg p-2"><MessageSquare className="w-5 h-5 text-white" /></div>
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.verbal}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Verbal Warnings</p>
        </div>
        <div className={tileCls}>
          <div className="flex items-center justify-between mb-3">
            <div className="bg-orange-500 rounded-lg p-2"><FileText className="w-5 h-5 text-white" /></div>
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.written}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Written Warnings</p>
        </div>
        <div className={tileCls}>
          <div className="flex items-center justify-between mb-3">
            <div className="bg-red-500 rounded-lg p-2"><ShieldAlert className="w-5 h-5 text-white" /></div>
            <span className="text-3xl font-bold text-gray-900 dark:text-white">{counts.final}</span>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 font-medium">Final Warnings</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {isManagement && (
          <div className="flex items-center gap-1 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-1">
            {(['agent', 'team_leader'] as ListTab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  tab === t ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                {t === 'agent' ? 'Agent Warnings' : 'Team-Leader Warnings'}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={openAdd}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors ml-auto"
        >
          <Plus className="w-4 h-4" /> New Warning
        </button>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>}

      {displayed.length === 0 ? (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 py-16 text-center">
          <AlertTriangle className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400 font-medium">No warnings recorded</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800 shadow-sm">
          {displayed.map(w => (
            <div key={w.id} className="px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="font-medium text-gray-900 dark:text-white">{w.target?.full_name ?? 'Unknown'}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeBadge[w.type]}`}>{typeLabel[w.type]}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{w.reason}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {format(new Date(w.created_at), 'dd MMM yyyy HH:mm')} · by {w.issuer?.full_name ?? 'Unknown'}
                  </p>
                </div>
                {w.issued_by === currentUserId && (
                  <div className="flex items-center gap-2 shrink-0">
                    {confirmingDelete === w.id ? (
                      <>
                        <button onClick={() => handleDelete(w.id)} className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 font-medium">Confirm Delete</button>
                        <button onClick={() => setConfirmingDelete(null)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => openEdit(w)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 font-medium">Edit</button>
                        <button onClick={() => setConfirmingDelete(w.id)} className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 font-medium">Delete</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <WarningModal
          key={editing?.id ?? 'add'}
          open={modal}
          onClose={() => setModal(false)}
          editing={editing}
          targetCandidates={targetCandidates}
          currentUserId={currentUserId}
          onSaved={() => { setModal(false); router.refresh() }}
        />
      )}
    </div>
  )
}
