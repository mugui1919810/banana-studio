import * as z from 'zod'

import {
  AUTO_BACKUP_TYPES,
  type AutoBackupEvent,
  CONVERSATION_RESTORE_REASONS,
  type ConversationRestoreInspection,
  type ConversationRestoreResult
} from '@shared/types/backup'

import { defineRoute } from '../define'

const autoBackupTypeSchema = z.enum(AUTO_BACKUP_TYPES)
const eventFields = { id: z.number().int().positive(), type: autoBackupTypeSchema }
const autoBackupEventSchema = z.discriminatedUnion('status', [
  z.object({ ...eventFields, status: z.literal('running') }),
  z.object({ ...eventFields, status: z.literal('stopped') }),
  z.object({ ...eventFields, status: z.literal('succeeded'), timestamp: z.number() }),
  z.object({
    ...eventFields,
    status: z.literal('warning'),
    timestamp: z.number(),
    reason: z.literal('cleanup_failed')
  }),
  z.object({ ...eventFields, status: z.literal('failed'), timestamp: z.number(), errorMessage: z.string() })
])

const conversationRestoreReasonSchema = z.enum(CONVERSATION_RESTORE_REASONS)
const conversationRestoreInspectionSchema: z.ZodType<ConversationRestoreInspection> = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    sourceHash: z.string().min(1),
    sourceAppVersion: z.string().optional(),
    topicCount: z.number().int().nonnegative(),
    messageCount: z.number().int().nonnegative(),
    assistantCount: z.number().int().nonnegative()
  }),
  z.object({
    ok: z.literal(false),
    reason: conversationRestoreReasonSchema,
    detail: z.string().optional()
  })
])

const conversationRestoreResultSchema: z.ZodType<ConversationRestoreResult> = z.object({
  topicsImported: z.number().int().nonnegative(),
  messagesImported: z.number().int().nonnegative(),
  assistantsCreated: z.number().int().nonnegative(),
  deletedAssistants: z.number().int().nonnegative()
})

export const backupRequestSchemas = {
  'backup.get_auto_sync_state': defineRoute({
    input: z.void(),
    output: z.object({ pendingNotifications: z.array(autoBackupEventSchema) })
  }),
  'backup.acknowledge_auto_sync_notification': defineRoute({
    input: z.object({ type: autoBackupTypeSchema, id: z.number().int().positive() }),
    output: z.void()
  }),
  'backup.manual_completion.record': defineRoute({
    input: z.object({ type: autoBackupTypeSchema }),
    output: z.void()
  }),
  'backup.inspect_conversations': defineRoute({
    input: z.object({ backupPath: z.string().min(1) }),
    output: conversationRestoreInspectionSchema
  }),
  'backup.restore_conversations': defineRoute({
    input: z.object({
      backupPath: z.string().min(1),
      sourceHash: z.string().min(1),
      keepExistingAssistants: z.boolean()
    }),
    output: conversationRestoreResultSchema
  })
}

export type BackupEventSchemas = {
  'backup.auto_sync_state_changed': AutoBackupEvent
}
