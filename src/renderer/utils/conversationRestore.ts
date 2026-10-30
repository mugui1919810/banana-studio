import i18n from '@renderer/i18n/resolver'
import {
  CONVERSATION_RESTORE_ACTIVE_WRITERS_ERROR_CODE,
  CONVERSATION_RESTORE_PENDING_RESTORE_ERROR_CODE,
  CONVERSATION_RESTORE_UNREADABLE_ERROR_CODE,
  CONVERSATION_RESTORE_UNSUPPORTED_FORMAT_ERROR_CODE,
  type ConversationRestoreReason
} from '@shared/types/backup'

const REASON_KEYS: Record<ConversationRestoreReason, string> = {
  unsupported_format: 'conversation_restore.error.unsupported_format',
  not_cherry_backup: 'conversation_restore.error.not_cherry_backup',
  missing_database: 'conversation_restore.error.missing_database',
  unreadable_database: 'conversation_restore.error.unreadable_database',
  missing_tables: 'conversation_restore.error.missing_tables',
  unreadable_message_data: 'conversation_restore.error.unreadable_message_data',
  no_conversations: 'conversation_restore.error.no_conversations',
  backup_changed: 'conversation_restore.error.backup_changed'
}

export function getConversationRestoreReasonMessage(reason: ConversationRestoreReason): string {
  return i18n.t(REASON_KEYS[reason])
}

export function getConversationRestoreErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)

  if (message.includes(CONVERSATION_RESTORE_ACTIVE_WRITERS_ERROR_CODE)) {
    return i18n.t('conversation_restore.error.active_writers')
  }
  if (message.includes(CONVERSATION_RESTORE_PENDING_RESTORE_ERROR_CODE)) {
    return i18n.t('conversation_restore.error.pending_restore')
  }
  if (message.includes(CONVERSATION_RESTORE_UNSUPPORTED_FORMAT_ERROR_CODE)) {
    return i18n.t('conversation_restore.error.unsupported_format')
  }
  if (message.includes(CONVERSATION_RESTORE_UNREADABLE_ERROR_CODE)) {
    for (const [reason, key] of Object.entries(REASON_KEYS) as Array<[ConversationRestoreReason, string]>) {
      if (message.includes(`:${reason}:`)) return i18n.t(key)
    }
    return i18n.t('conversation_restore.error.unreadable_database')
  }

  return i18n.t('conversation_restore.error.failed')
}
