import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CalendarView } from '@/types'

interface CalendarHeaderProps {
  view: CalendarView
  currentDate: Date
  onViewChange: (v: CalendarView) => void
  onNavigate: (dir: -1 | 1) => void
  onToday: () => void
}

const VIEWS: { value: CalendarView; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week',  label: 'Week'  },
  { value: 'day',   label: 'Day'   },
]

function formatLabel(view: CalendarView, date: Date): string {
  if (view === 'month') {
    return date.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric' })
  }
  if (view === 'week') {
    const mon = new Date(date)
    const day = mon.getDay()
    mon.setDate(mon.getDate() + (day === 0 ? -6 : 1 - day))
    const sun = new Date(mon)
    sun.setDate(mon.getDate() + 6)
    const fmt = (d: Date) => d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })
    return `${fmt(mon)} – ${fmt(sun)} ${sun.getFullYear()}`
  }
  return date.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

export default function CalendarHeader({ view, currentDate, onViewChange, onNavigate, onToday }: CalendarHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <button
          onClick={() => onNavigate(-1)}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          aria-label="Previous"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onToday}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Today
        </button>
        <button
          onClick={() => onNavigate(1)}
          className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900 transition-colors"
          aria-label="Next"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <h2 className="text-base font-semibold text-gray-900 ml-1">
          {formatLabel(view, currentDate)}
        </h2>
      </div>

      <div className="flex items-center border border-gray-200 rounded-lg overflow-hidden">
        {VIEWS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onViewChange(value)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              view === value
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
