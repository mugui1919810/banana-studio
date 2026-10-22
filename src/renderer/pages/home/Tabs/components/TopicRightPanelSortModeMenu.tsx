import { ArrowUpDown, Clock, GripVertical } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { ConversationListOptionsMenu } from '@renderer/components/chat/resourceList/base'
import type { TopicDisplayMode } from '@shared/data/preference/preferenceTypes'

type RightPanelTopicDisplayMode = Extract<TopicDisplayMode, 'time' | 'custom'>

const OPTIONS: ReadonlyArray<{
  value: RightPanelTopicDisplayMode
  icon: ReactNode
  labelKey: string
}> = [
  { value: 'time', icon: <Clock size={16} />, labelKey: 'chat.topics.display.time' },
  { value: 'custom', icon: <GripVertical size={16} />, labelKey: 'chat.topics.display.custom' }
]

export function TopicRightPanelSortModeMenu() {
  const { t } = useTranslation()
  const [storedMode, setStoredMode] = usePreference('topic.right_panel.display_mode')
  const mode: RightPanelTopicDisplayMode = storedMode === 'custom' ? 'custom' : 'time'

  return (
    <ConversationListOptionsMenu
      title={t('chat.topics.sort_mode.title')}
      mode={mode}
      onChange={(nextMode) => void setStoredMode(nextMode)}
      options={OPTIONS.map((option) => ({
        icon: option.icon,
        label: t(option.labelKey),
        value: option.value
      }))}
      openOnHover
      triggerIcon={<ArrowUpDown className="block" />}
    />
  )
}
