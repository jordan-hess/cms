'use client'

import { useState } from 'react'
import { CoachingLeaderCard } from '@/types'
import AgentCheckRow from './AgentCheckRow'
import { ChevronDown, ChevronUp } from 'lucide-react'

interface Props {
  card: CoachingLeaderCard
  onToggleAgent: (agentId: string) => void
  onToggleLeaderCheckin: (leaderId: string) => void
}

export default function LeaderCard({ card, onToggleAgent, onToggleLeaderCheckin }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 shadow-sm p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-purple-700 dark:text-purple-400 font-semibold text-sm shrink-0">
          {card.leaderName.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{card.leaderName}</p>
          {card.leaderDepartment && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{card.leaderDepartment}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-center">
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg py-2">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{card.totalCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">Agents assigned</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-800 rounded-lg py-2">
          <p className="text-lg font-semibold text-gray-900 dark:text-white">{card.completedCount} / {card.totalCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">1-on-1s completed</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
      >
        View agents
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {expanded && (
        <div className="space-y-0.5 -mx-1">
          {card.agents.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-2">No agents assigned</p>
          ) : (
            card.agents.map(agent => (
              <AgentCheckRow key={agent.id} agent={agent} onToggle={onToggleAgent} />
            ))
          )}
        </div>
      )}

      <label className="flex items-center gap-2 pt-2 border-t border-gray-100 dark:border-gray-800 cursor-pointer">
        <input
          type="checkbox"
          checked={card.leaderCheckinDone}
          onChange={() => onToggleLeaderCheckin(card.leaderId)}
          className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
        />
        <span className="text-sm text-gray-700 dark:text-gray-300">1-on-1 done</span>
      </label>
    </div>
  )
}
