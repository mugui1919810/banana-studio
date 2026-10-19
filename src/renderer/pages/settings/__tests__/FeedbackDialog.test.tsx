import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import enUs from '@renderer/i18n/locales/en-us.json'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn(),
  loggerError: vi.fn(),
  toastError: vi.fn(),
  toastInfo: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: (...args: unknown[]) => mocks.ipcRequest(...args)
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    error: (...args: unknown[]) => mocks.toastError(...args),
    info: (...args: unknown[]) => mocks.toastInfo(...args)
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => (enUs as Record<string, string>)[key] ?? key
  })
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string) => (enUs as Record<string, string>)[key] ?? key
  }
}))

import { FeedbackDialog } from '../FeedbackDialog'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

describe('FeedbackDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ipcRequest.mockResolvedValue({ sessionId: 'feedback-session' })
  })

  it('keeps the feedback assistant and GitHub in order without the moved report entry', () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    const agent = screen.getByRole('button', { name: /Feedback assistant/ })
    const github = screen.getByRole('button', { name: /GitHub Issue/ })

    expect(screen.queryByRole('button', { name: /Report a problem/i })).not.toBeInTheDocument()
    expect(agent.compareDocumentPosition(github)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('shows the fork notice for the built-in feedback assistant', async () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: /Feedback assistant/ }))

    await waitFor(() =>
      expect(mocks.toastInfo).toHaveBeenCalledWith(enUs['fork.builtin_agent_unavailable'])
    )
    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('shows the fork notice instead of opening the GitHub issue chooser', async () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} />)

    await userEvent.setup().click(screen.getByRole('button', { name: /GitHub Issue/ }))

    await waitFor(() =>
      expect(mocks.toastInfo).toHaveBeenCalledWith(enUs['fork.external_link_unavailable'])
    )
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith(
      'system.shell.open_external_website',
      expect.stringContaining('github.com/CherryHQ')
    )
  })
})
