import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TopicRightPanelSortModeMenu } from '../TopicRightPanelSortModeMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('TopicRightPanelSortModeMenu', () => {
  beforeEach(() => {
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setPreferenceValue('topic.right_panel.display_mode' as never, 'time')
  })

  it('opens on hover and lists only the time and custom modes', () => {
    render(<TopicRightPanelSortModeMenu />)

    fireEvent.mouseEnter(screen.getByLabelText('chat.topics.sort_mode.title'))

    expect(screen.getByText('chat.topics.display.time')).toBeInTheDocument()
    expect(screen.getByText('chat.topics.display.custom')).toBeInTheDocument()
  })

  it('persists the selected mode', async () => {
    render(<TopicRightPanelSortModeMenu />)

    fireEvent.click(screen.getByLabelText('chat.topics.sort_mode.title'))
    fireEvent.click(screen.getByText('chat.topics.display.custom'))

    await vi.waitFor(() =>
      expect(MockUsePreferenceUtils.getPreferenceValue('topic.right_panel.display_mode' as never)).toBe('custom')
    )
  })
})
