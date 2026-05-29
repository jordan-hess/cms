import { Team } from '@/types'
import { teamColorClasses } from '@/lib/roster/teamColors'

interface TeamLegendProps {
  teams: Team[]
}

export default function TeamLegend({ teams }: TeamLegendProps) {
  return (
    <div className="flex flex-wrap gap-3">
      {teams.map(team => {
        const colors = teamColorClasses[team.color]
        return (
          <div key={team.id} className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
            <span className="text-xs text-gray-600 font-medium">{team.name} Team</span>
          </div>
        )
      })}
    </div>
  )
}
