'use client'

interface Props {
  agent: { id: string; full_name: string; done: boolean }
  onToggle: (agentId: string) => void
}

export default function AgentCheckRow({ agent, onToggle }: Props) {
  return (
    <button
      type="button"
      onClick={() => onToggle(agent.id)}
      className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
    >
      <span className="text-sm text-gray-700 dark:text-gray-300">{agent.full_name}</span>
      <span
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${agent.done ? 'bg-green-500' : 'bg-red-400'}`}
        title={agent.done ? '1-on-1 done this month' : 'Not done yet this month'}
      />
    </button>
  )
}
