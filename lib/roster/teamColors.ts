import { TeamColor } from '@/types'

export const teamColorClasses: Record<TeamColor, {
  bg: string
  text: string
  border: string
  dot: string
  lightBg: string
}> = {
  green:  { bg: 'bg-green-500',  text: 'text-green-700',  border: 'border-green-300',  dot: 'bg-green-500',  lightBg: 'bg-green-50'  },
  blue:   { bg: 'bg-blue-500',   text: 'text-blue-700',   border: 'border-blue-300',   dot: 'bg-blue-500',   lightBg: 'bg-blue-50'   },
  red:    { bg: 'bg-red-500',    text: 'text-red-700',    border: 'border-red-300',    dot: 'bg-red-500',    lightBg: 'bg-red-50'    },
  yellow: { bg: 'bg-yellow-500', text: 'text-yellow-700', border: 'border-yellow-300', dot: 'bg-yellow-500', lightBg: 'bg-yellow-50' },
}

export const statusColorClasses: Record<string, { bg: string; text: string }> = {
  on_shift:    { bg: 'bg-green-100',  text: 'text-green-700'  },
  late:        { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  absent:      { bg: 'bg-red-100',    text: 'text-red-700'    },
  sick:        { bg: 'bg-orange-100', text: 'text-orange-700' },
  leave:       { bg: 'bg-purple-100', text: 'text-purple-700' },
  off:         { bg: 'bg-gray-100',   text: 'text-gray-500'   },
  no_rotation: { bg: 'bg-gray-50',    text: 'text-gray-400'   },
}

export const statusLabels: Record<string, string> = {
  on_shift:    'On Shift',
  late:        'Late',
  absent:      'Absent',
  sick:        'Sick',
  leave:       'Leave',
  off:         'Off',
  no_rotation: 'No Rotation',
}
