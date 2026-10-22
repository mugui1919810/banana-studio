import { useTranslation } from 'react-i18next'

import type { ResourceListRevealRequest } from '@renderer/components/chat/resourceList/base'
import type { AssistantTopicsSource } from '@renderer/hooks/resourceViewSources'
import type { Topic } from '@renderer/types/topic'
import type { TopicTabPosition } from '@shared/data/preference/preferenceTypes'

import { TopicRightPanelSortModeMenu } from '../Tabs/components/TopicRightPanelSortModeMenu'
import { Topics } from '../Tabs/components/Topics'
import type { AddNewTopicPayload } from '../types'

interface Props {
  activeTopic?: Topic
  assistantIdFilter: string | null
  assistantTopicsSource: AssistantTopicsSource
  clearActiveTopic: () => void
  dataEnabled: boolean
  historyRecordsActive?: boolean
  manageAssistantsActive?: boolean
  onNewTopic?: (payload?: AddNewTopicPayload) => void | Promise<void>
  onSetPanePosition?: (position: TopicTabPosition) => void | Promise<void>
  revealRequest?: ResourceListRevealRequest
  setActiveTopic: (topic: Topic) => void
}

/**
 * The left-docked conversation column shown beside the assistant rail in classic layout.
 * `presentation="right-panel"` is the assistant-filtered display/sort variant, not a screen position.
 */
export function ClassicTopicListPane({
  activeTopic,
  assistantIdFilter,
  assistantTopicsSource,
  clearActiveTopic,
  dataEnabled,
  historyRecordsActive,
  manageAssistantsActive,
  onNewTopic,
  onSetPanePosition,
  revealRequest,
  setActiveTopic
}: Props) {
  const { t } = useTranslation()

  return (
    <div
      data-ui="part:classic-topic-list"
      data-testid="classic-topic-list-pane"
      className="flex h-full min-h-0 flex-col overflow-hidden border-r-[0.5px] border-border">
      <div
        data-ui="part:classic-topic-list-header"
        className="flex h-(--navbar-height) shrink-0 items-center justify-between gap-2 border-b border-border-subtle px-2">
        <span className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-foreground select-none">
          {t('chat.topics.title')}
        </span>
        <div className="shrink-0">
          <TopicRightPanelSortModeMenu />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <Topics
          activeTopic={activeTopic}
          assistantIdFilter={assistantIdFilter}
          assistantTopicsSource={assistantTopicsSource}
          clearActiveTopic={clearActiveTopic}
          dataEnabled={dataEnabled}
          historyRecordsActive={historyRecordsActive}
          manageAssistantsActive={manageAssistantsActive}
          onNewTopic={onNewTopic}
          onSetPanePosition={onSetPanePosition}
          panePosition="left"
          presentation="right-panel"
          revealRequest={revealRequest}
          setActiveTopic={setActiveTopic}
        />
      </div>
    </div>
  )
}
