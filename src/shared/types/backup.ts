/**
 * Backup storage configs (WebDAV / S3). Cross-process: the renderer manages
 * these via settings UI and the main process consumes them in the backup
 * services; both sides pass them across the IPC boundary.
 */

export type WebDavConfig = {
  webdavHost: string
  webdavUser?: string
  webdavPass?: string
  webdavPath?: string
  fileName?: string
  maxBackups?: number
  skipBackupFile?: boolean
  disableStream?: boolean
  /** Opt-in: skip ALL certificate checks for this server (self-signed/private-CA, and also expired or wrong-hostname certificates). Default (unset/false) verifies. */
  allowSelfSignedTls?: boolean
}

export type LocalBackupConfig = {
  localBackupDir?: string
  maxBackups?: number
  skipBackupFile?: boolean
}

export type S3Config = {
  endpoint: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  root?: string
  fileName?: string
  skipBackupFile?: boolean
  autoSync: boolean
  syncInterval: number
  maxBackups: number
}

export type BackupResult<T> = {
  result: T
  cleanupFailed: boolean
}

export const AUTO_BACKUP_TYPES = ['webdav', 's3', 'local', 'nutstore'] as const
export type AutoBackupType = (typeof AUTO_BACKUP_TYPES)[number]

export type AutoBackupEventInput =
  | { type: AutoBackupType; status: 'running' }
  | { type: AutoBackupType; status: 'stopped' }
  | { type: AutoBackupType; status: 'succeeded'; timestamp: number }
  | { type: AutoBackupType; status: 'warning'; timestamp: number; reason: 'cleanup_failed' }
  | { type: AutoBackupType; status: 'failed'; timestamp: number; errorMessage: string }

export type AutoBackupEvent = AutoBackupEventInput & { id: number }

export type AutoBackupSnapshot = {
  pendingNotifications: AutoBackupEvent[]
}

export const BACKUP_ACTIVE_WRITERS_ERROR_CODE = 'BACKUP_ACTIVE_WRITERS'
export const BACKUP_BACKGROUND_TASKS_ERROR_CODE = 'BACKUP_BACKGROUND_TASKS'
export const BACKUP_DISK_FULL_ERROR_CODE = 'BACKUP_DISK_FULL'
export const BACKUP_NEWER_VERSION_ERROR_CODE = 'BACKUP_NEWER_VERSION'
export const BACKUP_OPERATION_BUSY_ERROR_CODE = 'BACKUP_OPERATION_BUSY'

export const CONVERSATION_RESTORE_UNSUPPORTED_FORMAT_ERROR_CODE = 'CONVERSATION_RESTORE_UNSUPPORTED_FORMAT'
export const CONVERSATION_RESTORE_UNREADABLE_ERROR_CODE = 'CONVERSATION_RESTORE_UNREADABLE'
export const CONVERSATION_RESTORE_ACTIVE_WRITERS_ERROR_CODE = 'CONVERSATION_RESTORE_ACTIVE_WRITERS'
export const CONVERSATION_RESTORE_PENDING_RESTORE_ERROR_CODE = 'CONVERSATION_RESTORE_PENDING_RESTORE'

export const CONVERSATION_RESTORE_REASONS = [
  'unsupported_format',
  'not_cherry_backup',
  'missing_database',
  'unreadable_database',
  'missing_tables',
  'unreadable_message_data',
  'no_conversations',
  'backup_changed'
] as const

export type ConversationRestoreReason = (typeof CONVERSATION_RESTORE_REASONS)[number]

export type ConversationRestoreInspection =
  | {
      ok: true
      sourceHash: string
      sourceAppVersion?: string
      topicCount: number
      messageCount: number
      assistantCount: number
    }
  | { ok: false; reason: ConversationRestoreReason; detail?: string }

export type ConversationRestoreOptions = {
  backupPath: string
  sourceHash: string
  keepExistingAssistants: boolean
}

export type ConversationRestoreResult = {
  topicsImported: number
  messagesImported: number
  assistantsCreated: number
  deletedAssistants: number
}
