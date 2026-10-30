import { Check } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  RadioGroup,
  RadioGroupItem
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { createPopup, type PopupInjectedProps, popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'
import {
  getConversationRestoreErrorMessage,
  getConversationRestoreReasonMessage
} from '@renderer/utils/conversationRestore'
import type { ConversationRestoreInspection } from '@shared/types/backup'

type Props = PopupInjectedProps<void>

type ConfirmInspection = Extract<ConversationRestoreInspection, { ok: true }>

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<'select' | 'confirm'>('select')
  const [inspection, setInspection] = useState<ConfirmInspection>()
  const [backupPath, setBackupPath] = useState<string>()
  const [keepAssistants, setKeepAssistants] = useState(true)
  const [inspecting, setInspecting] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const busy = inspecting || restoring

  const onCancel = () => {
    if (busy) return
    resolve()
  }

  const onSelectFile = async () => {
    setInspecting(true)
    try {
      const file = await window.api.file.open({
        filters: [{ name: t('conversation_restore.file_filter'), extensions: ['zip'] }]
      })
      if (!file) return

      const result = await ipcApi.request('backup.inspect_conversations', { backupPath: file.filePath })
      if (!result.ok) {
        void popup.error({
          title: t('conversation_restore.error.title'),
          content: getConversationRestoreReasonMessage(result.reason),
          centered: true
        })
        return
      }
      setInspection(result)
      setBackupPath(file.filePath)
      setKeepAssistants(true)
      setStep('confirm')
    } catch (error) {
      void popup.error({
        title: t('conversation_restore.error.title'),
        content: getConversationRestoreErrorMessage(error),
        centered: true
      })
    } finally {
      setInspecting(false)
    }
  }

  const onConfirm = async () => {
    if (!inspection || !backupPath) return

    if (!keepAssistants) {
      const confirmed = await popup.confirm({
        title: t('conversation_restore.warning.title'),
        content: (
          <div className="space-y-2">
            <p>{t('conversation_restore.warning.content')}</p>
            <p className="text-xs text-foreground-tertiary">{t('conversation_restore.warning.detail')}</p>
          </div>
        ),
        okText: t('common.confirm'),
        cancelText: t('common.cancel'),
        okButtonProps: { danger: true },
        centered: true
      })
      if (!confirmed) return
    }

    setRestoring(true)
    try {
      const result = await ipcApi.request('backup.restore_conversations', {
        backupPath,
        sourceHash: inspection.sourceHash,
        keepExistingAssistants: keepAssistants
      })
      toast.success(
        t('conversation_restore.success', {
          topics: result.topicsImported,
          messages: result.messagesImported
        })
      )
      resolve()
    } catch (error) {
      void popup.error({
        title: t('conversation_restore.error.title'),
        content: getConversationRestoreErrorMessage(error),
        centered: true
      })
      setRestoring(false)
    }
  }

  const onAssistantModeChange = (value: string) => {
    setKeepAssistants(value === 'keep')
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent
        closeOnOverlayClick={false}
        className="sm:max-w-[560px]"
        onPointerDownOutside={(event) => event.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{t('conversation_restore.title')}</DialogTitle>
        </DialogHeader>

        {step === 'select' ? (
          <div>{t('conversation_restore.content')}</div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-border bg-background-subtle px-3 py-2 text-sm">
              {t('conversation_restore.summary', {
                topics: inspection?.topicCount ?? 0,
                messages: inspection?.messageCount ?? 0,
                assistants: inspection?.assistantCount ?? 0,
                version: inspection?.sourceAppVersion ?? '?'
              })}
            </div>

            <div className="space-y-2">
              <div className="font-medium text-sm">{t('conversation_restore.assistants.title')}</div>
              <RadioGroup value={keepAssistants ? 'keep' : 'delete'} onValueChange={onAssistantModeChange}>
                <Label htmlFor="conversation-restore-keep-assistants" className="flex items-start gap-2">
                  <AssistantRadio id="conversation-restore-keep-assistants" value="keep" />
                  <span>
                    <span className="block text-sm">{t('conversation_restore.assistants.keep')}</span>
                    <span className="block text-foreground-tertiary text-xs">
                      {t('conversation_restore.assistants.keep_hint')}
                    </span>
                  </span>
                </Label>
                <Label htmlFor="conversation-restore-delete-assistants" className="flex items-start gap-2">
                  <AssistantRadio id="conversation-restore-delete-assistants" value="delete" />
                  <span>
                    <span className="block text-sm">{t('conversation_restore.assistants.delete')}</span>
                    <span className="block text-foreground-tertiary text-xs">
                      {t('conversation_restore.assistants.delete_hint')}
                    </span>
                  </span>
                </Label>
              </RadioGroup>
            </div>

            <p className="text-foreground-tertiary text-xs">{t('conversation_restore.dropped_hint')}</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          {step === 'select' ? (
            <Button onClick={onSelectFile} loading={inspecting}>
              {t('restore.confirm.button')}
            </Button>
          ) : (
            <Button onClick={onConfirm} loading={restoring} disabled={!inspection}>
              {t('conversation_restore.confirm.button')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const AssistantRadio = ({ id, value }: { id: string; value: string }) => (
  <span className="relative mt-1 flex size-4 shrink-0 items-center justify-center">
    <RadioGroupItem
      id={id}
      value={value}
      className="peer data-[state=checked]:border-primary data-[state=checked]:bg-primary"
    />
    <Check
      aria-hidden
      strokeWidth={3}
      className="pointer-events-none absolute inset-0 m-auto size-2.5 text-white opacity-0 peer-data-[state=checked]:opacity-100"
    />
  </span>
)

const RestoreConversationsPopup = createPopup<Record<string, never>, void>(PopupContainer, { dismissResult: undefined })

export default RestoreConversationsPopup
