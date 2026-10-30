import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createContext, type ComponentProps, type PropsWithChildren, use } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PopupHost } from '@renderer/components/PopupHost'
import { popup } from '@renderer/services/popup'
import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  openFile: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: { success: mocks.toastSuccess }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const RadioContext = createContext<{
  value?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
}>({})

vi.mock('@cherrystudio/ui', () => ({
  Button: ({
    children,
    disabled,
    loading,
    variant,
    ...props
  }: ComponentProps<'button'> & { loading?: boolean; variant?: string }) => {
    void variant
    return (
      <button {...props} type="button" disabled={disabled || loading} aria-busy={loading || undefined}>
        {children}
      </button>
    )
  },
  Dialog: ({ children, open }: PropsWithChildren<{ open?: boolean }>) => (open ? children : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <footer>{children}</footer>,
  DialogHeader: ({ children }: PropsWithChildren) => <header>{children}</header>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  Label: ({ children, ...props }: PropsWithChildren<ComponentProps<'label'>>) => <label {...props}>{children}</label>,
  RadioGroup: ({
    value,
    onValueChange,
    disabled,
    children
  }: PropsWithChildren<{ value?: string; onValueChange?: (value: string) => void; disabled?: boolean }>) => (
    <RadioContext value={{ value, onValueChange, disabled }}>
      <div>{children}</div>
    </RadioContext>
  ),
  RadioGroupItem: ({ value, id, disabled, ...props }: ComponentProps<'input'> & { value: string }) => {
    const context = use(RadioContext)
    return (
      <input
        {...props}
        type="radio"
        id={id}
        value={value}
        checked={context.value === value}
        disabled={disabled || context.disabled}
        onChange={() => context.onValueChange?.(value)}
      />
    )
  }
}))

import RestoreConversationsPopup from '../RestoreConversationsPopup'

const INSPECTION = {
  ok: true as const,
  sourceHash: 'source-hash',
  sourceAppVersion: '2.1.6',
  topicCount: 2,
  messageCount: 3,
  assistantCount: 1
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.openFile.mockResolvedValue({ filePath: '/tmp/backup.zip' })
  mocks.request.mockImplementation((route: string) => {
    if (route === 'backup.inspect_conversations') return Promise.resolve(INSPECTION)
    if (route === 'backup.restore_conversations') {
      return Promise.resolve({
        topicsImported: 2,
        messagesImported: 3,
        assistantsCreated: 1,
        deletedAssistants: 1
      })
    }
    return Promise.resolve(undefined)
  })
  Object.assign(window.api.file, { open: mocks.openFile })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useFakeTimers()
  for (const entry of [...popupService.getSnapshot()]) {
    popupService.settle(entry.instanceId, {})
  }
  vi.advanceTimersByTime(POPUP_EXIT_MS)
  vi.useRealTimers()
})

describe('RestoreConversationsPopup', () => {
  it('inspects the selected backup and shows the confirmation step', async () => {
    const user = userEvent.setup()
    render(<PopupHost />)
    act(() => {
      void RestoreConversationsPopup.show()
    })

    await user.click(await screen.findByRole('button', { name: 'restore.confirm.button' }))

    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('backup.inspect_conversations', {
        backupPath: '/tmp/backup.zip'
      })
    )
    expect(await screen.findByText('conversation_restore.summary')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'conversation_restore.confirm.button' })).toBeInTheDocument()
  })

  it('shows an error popup when the archive cannot provide conversations', async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(popup, 'error').mockResolvedValue(false)
    mocks.request.mockImplementationOnce(() => Promise.resolve({ ok: false, reason: 'unsupported_format' }))
    render(<PopupHost />)
    act(() => {
      void RestoreConversationsPopup.show()
    })

    await user.click(await screen.findByRole('button', { name: 'restore.confirm.button' }))

    await waitFor(() => expect(errorSpy).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'restore.confirm.button' })).toBeInTheDocument()
  })

  it('warns before deleting all local assistants', async () => {
    const user = userEvent.setup()
    vi.spyOn(popup, 'error').mockResolvedValue(false)
    const confirmSpy = vi.spyOn(popup, 'confirm').mockResolvedValue(true)
    render(<PopupHost />)
    act(() => {
      void RestoreConversationsPopup.show()
    })

    await user.click(await screen.findByRole('button', { name: 'restore.confirm.button' }))
    await screen.findByText('conversation_restore.summary')

    fireEvent.click(document.getElementById('conversation-restore-delete-assistants')!)

    await user.click(screen.getByRole('button', { name: 'conversation_restore.confirm.button' }))

    await waitFor(() =>
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'conversation_restore.warning.title',
          okButtonProps: { danger: true }
        })
      )
    )
    await waitFor(() =>
      expect(mocks.request).toHaveBeenCalledWith('backup.restore_conversations', {
        backupPath: '/tmp/backup.zip',
        sourceHash: 'source-hash',
        keepExistingAssistants: false
      })
    )
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledOnce())
  })
})
