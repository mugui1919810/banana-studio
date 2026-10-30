/**
 * Conversation-only restore from a v7 backup.
 *
 * Unlike the full restore pipeline, this does not swap the live database or
 * care about the source DB's drizzle migration chain. It reads `topic`,
 * `message` and `assistant` rows from the backup, then appends the
 * conversations to the live database while the app stays running.
 */

import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import path from 'node:path'

import Database from 'better-sqlite3'
import { isNull } from 'drizzle-orm'
import * as fs from 'fs-extra'
import StreamZip from 'node-stream-zip'
import { v4 as uuidv4, v7 as uuidv7 } from 'uuid'

import { application } from '@application'
import { hasPendingRestore } from '@data/db/restore/restoreJournal'
import { assistantTable } from '@data/db/schemas/assistant'
import type { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { assistantDataService } from '@data/services/AssistantService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { loggerService } from '@logger'
import { assertNoFoldedPathCollisions, assertZipEntriesWithin } from '@main/utils/zipSafety'
import { type AssistantSettings, DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { MessageData, MessageSnapshot, MessageStats } from '@shared/data/types/message'
import {
  CONVERSATION_RESTORE_ACTIVE_WRITERS_ERROR_CODE,
  CONVERSATION_RESTORE_PENDING_RESTORE_ERROR_CODE,
  CONVERSATION_RESTORE_UNREADABLE_ERROR_CODE,
  CONVERSATION_RESTORE_UNSUPPORTED_FORMAT_ERROR_CODE,
  type ConversationRestoreInspection,
  type ConversationRestoreOptions,
  type ConversationRestoreReason,
  type ConversationRestoreResult
} from '@shared/types/backup'

const logger = loggerService.withContext('ConversationRestoreService')

const SUPPORTED_BACKUP_VERSION = 7
const MAX_ARCHIVE_ENTRIES = 100_000
const MAX_UNCOMPRESSED_BYTES = 4 * 1024 * 1024 * 1024
const MAX_MESSAGE_JSON_LENGTH = 64 * 1024 * 1024
const SQLITE_IN_CHUNK = 500

type SqliteDatabase = Database.Database
type SourceRow = Record<string, unknown>

interface SourceTopic {
  id: string
  name: string
  assistantId: string | null
  activeNodeId: string | null
  isNameManuallyEdited: boolean
  traceId: string | null
  lastActivityAt: number
  createdAt: number
  updatedAt: number
  orderKey: string | null
}

interface SourceAssistant {
  id: string
  name: string
  emoji: string
  prompt: string
  description: string
  settings: AssistantSettings
  modelId: string | null
  createdAt: number
  updatedAt: number
  orderKey: string | null
}

interface SourceMessage {
  id: string
  topicId: string
  parentId: string | null
  role: string
  data: MessageData
  status: string
  siblingsGroupId: number
  modelId: string | null
  messageSnapshot: MessageSnapshot | null
  stats: MessageStats | null
  compactionSummary: string | null
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

interface ImportBundle {
  topics: SourceTopic[]
  assistants: Map<string, SourceAssistant>
  messagesByTopic: Map<string, SourceMessage[]>
}

interface ExtractedArchive {
  workDir: string
  dbPath: string
  metadata: Record<string, unknown>
}

interface TopicPlan {
  source: SourceTopic
  newTopicId: string
  messageIdBySourceId: Map<string, string>
  rootSourceIds: Set<string>
}

class ConversationInspectionError extends Error {
  constructor(
    readonly reason: ConversationRestoreReason,
    detail?: string
  ) {
    super(detail ?? reason)
    this.name = 'ConversationInspectionError'
  }
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value ?? null
  if (value.length > MAX_MESSAGE_JSON_LENGTH) {
    throw new ConversationInspectionError('unreadable_message_data', 'message data is too large')
  }
  return JSON.parse(value)
}

function parseMessageData(value: unknown): MessageData {
  const parsed = parseJson(value)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConversationInspectionError('unreadable_message_data', 'message data is not an object')
  }
  const parts = (parsed as { parts?: unknown }).parts
  if (parts !== undefined && !Array.isArray(parts)) {
    throw new ConversationInspectionError('unreadable_message_data', 'message parts is not an array')
  }
  return parsed
}

function parseOptionalJson<T>(value: unknown): T | null {
  if (value === null || value === undefined || value === '') return null
  try {
    const parsed = parseJson(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null
  } catch {
    return null
  }
}

function parseAssistantSettings(value: unknown): AssistantSettings {
  const parsed = parseOptionalJson<Partial<AssistantSettings>>(value)
  return parsed ? { ...DEFAULT_ASSISTANT_SETTINGS, ...parsed } : DEFAULT_ASSISTANT_SETTINGS
}

function normalizeStatus(value: unknown): 'success' | 'error' | 'paused' {
  return value === 'error' || value === 'paused' ? value : 'success'
}

function toSourceTopic(row: SourceRow): SourceTopic | null {
  const id = nullableString(row.id)
  if (!id) return null
  return {
    id,
    name: stringValue(row.name),
    assistantId: nullableString(row.assistant_id),
    activeNodeId: nullableString(row.active_node_id),
    isNameManuallyEdited: Boolean(row.is_name_manually_edited),
    traceId: nullableString(row.trace_id),
    lastActivityAt: numberValue(row.last_activity_at, numberValue(row.updated_at, Date.now())),
    createdAt: numberValue(row.created_at, Date.now()),
    updatedAt: numberValue(row.updated_at, Date.now()),
    orderKey: nullableString(row.order_key)
  }
}

function toSourceAssistant(row: SourceRow): SourceAssistant | null {
  const id = nullableString(row.id)
  if (!id) return null
  return {
    id,
    name: stringValue(row.name),
    emoji: stringValue(row.emoji, '🌟'),
    prompt: stringValue(row.prompt),
    description: stringValue(row.description),
    settings: parseAssistantSettings(row.settings),
    modelId: nullableString(row.model_id),
    createdAt: numberValue(row.created_at, Date.now()),
    updatedAt: numberValue(row.updated_at, Date.now()),
    orderKey: nullableString(row.order_key)
  }
}

function toSourceMessage(row: SourceRow): SourceMessage | null {
  const id = nullableString(row.id)
  const topicId = nullableString(row.topic_id)
  if (!id || !topicId) return null

  const role = stringValue(row.role)
  if (!['user', 'assistant', 'system', 'root'].includes(role)) {
    throw new ConversationInspectionError('unreadable_message_data', `message ${id} has an invalid role`)
  }

  return {
    id,
    topicId,
    parentId: nullableString(row.parent_id),
    role,
    data: parseMessageData(row.data),
    status: normalizeStatus(row.status),
    siblingsGroupId: numberValue(row.siblings_group_id, 0),
    modelId: nullableString(row.model_id),
    messageSnapshot: parseOptionalJson<MessageSnapshot>(row.message_snapshot),
    stats: parseOptionalJson<MessageStats>(row.stats),
    compactionSummary: nullableString(row.compaction_summary),
    createdAt: numberValue(row.created_at, Date.now()),
    updatedAt: numberValue(row.updated_at, Date.now()),
    deletedAt: nullableNumber(row.deleted_at)
  }
}

function tableColumns(sqlite: SqliteDatabase, table: string): Set<string> {
  const rows = sqlite.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all() as SourceRow[]
  return new Set(rows.map((row) => stringValue(row.name)).filter(Boolean))
}

function errorCodeForInspection(reason: ConversationRestoreReason): string {
  if (
    reason === 'unsupported_format' ||
    reason === 'not_cherry_backup' ||
    reason === 'missing_database' ||
    reason === 'missing_tables'
  ) {
    return CONVERSATION_RESTORE_UNSUPPORTED_FORMAT_ERROR_CODE
  }
  return CONVERSATION_RESTORE_UNREADABLE_ERROR_CODE
}

class ConversationRestoreService {
  private restoring = false

  async inspect(backupPath: string): Promise<ConversationRestoreInspection> {
    let extracted: ExtractedArchive | undefined
    try {
      const sourceHash = await this.hashFile(backupPath)
      extracted = await this.extractArchive(backupPath)
      const sqlite = this.openSourceDb(extracted.dbPath)
      try {
        const bundle = this.readBundle(sqlite)
        if (bundle.topics.length === 0) {
          return { ok: false, reason: 'no_conversations' }
        }
        const messageCount = [...bundle.messagesByTopic.values()].reduce(
          (count, messages) => count + messages.filter((message) => message.role !== 'root').length,
          0
        )
        return {
          ok: true,
          sourceHash,
          sourceAppVersion: nullableString(extracted.metadata.appVersion) ?? undefined,
          topicCount: bundle.topics.length,
          messageCount,
          assistantCount: bundle.assistants.size
        }
      } finally {
        sqlite.close()
      }
    } catch (error) {
      if (error instanceof ConversationInspectionError) {
        return { ok: false, reason: error.reason, detail: error.message }
      }
      logger.error('Failed to inspect conversation backup', error as Error)
      return {
        ok: false,
        reason: 'unreadable_database',
        detail: error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (extracted) await fs.remove(extracted.workDir).catch(() => {})
    }
  }

  async restore(options: ConversationRestoreOptions): Promise<ConversationRestoreResult> {
    if (this.restoring) {
      throw new Error(`${CONVERSATION_RESTORE_ACTIVE_WRITERS_ERROR_CODE}: another conversation restore is running`)
    }
    if (hasPendingRestore()) {
      throw new Error(`${CONVERSATION_RESTORE_PENDING_RESTORE_ERROR_CODE}: a full restore is pending`)
    }
    this.assertNoActiveWriters()

    this.restoring = true
    let extracted: ExtractedArchive | undefined
    try {
      const sourceHash = await this.hashFile(options.backupPath)
      if (sourceHash !== options.sourceHash) {
        throw new ConversationInspectionError('backup_changed', 'the backup file changed during restore')
      }

      extracted = await this.extractArchive(options.backupPath)
      const sqlite = this.openSourceDb(extracted.dbPath)
      let bundle: ImportBundle
      try {
        bundle = this.readBundle(sqlite)
      } finally {
        sqlite.close()
      }

      if (bundle.topics.length === 0) {
        throw new ConversationInspectionError('no_conversations')
      }

      const result = this.importBundle(bundle, {
        keepExistingAssistants: options.keepExistingAssistants
      })
      logger.info('Conversation restore completed', result)
      return result
    } catch (error) {
      if (error instanceof ConversationInspectionError) {
        throw new Error(`${errorCodeForInspection(error.reason)}:${error.reason}:${error.message}`)
      }
      throw error
    } finally {
      this.restoring = false
      if (extracted) await fs.remove(extracted.workDir).catch(() => {})
    }
  }

  private assertNoActiveWriters(): void {
    if (application.get('AiStreamManager').hasLiveStreams()) {
      throw new Error(`${CONVERSATION_RESTORE_ACTIVE_WRITERS_ERROR_CODE}: an AI stream is still running`)
    }
    if (application.get('AgentLifecycleService').listActiveWork().length > 0) {
      throw new Error(`${CONVERSATION_RESTORE_ACTIVE_WRITERS_ERROR_CODE}: an agent task is still running`)
    }
  }

  private async hashFile(filePath: string): Promise<string> {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(filePath)) {
      hash.update(chunk as Buffer)
    }
    return hash.digest('hex')
  }

  private async extractArchive(backupPath: string): Promise<ExtractedArchive> {
    const tempRoot = application.getPath('feature.backup.temp')
    await fs.ensureDir(tempRoot)
    const workDir = path.join(tempRoot, `conversation-restore-${randomUUID()}`)
    await fs.ensureDir(workDir, { mode: 0o700 })
    await fs.chmod(workDir, 0o700).catch(() => {})

    let zip: InstanceType<typeof StreamZip.async> | undefined
    try {
      zip = new StreamZip.async({ file: backupPath })
      const entries = await zip.entries()
      const names = Object.keys(entries)
      if (names.length > MAX_ARCHIVE_ENTRIES) {
        throw new ConversationInspectionError('unsupported_format', 'archive has too many entries')
      }
      const totalBytes = Object.values(entries).reduce((total, entry) => total + entry.size, 0)
      if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
        throw new ConversationInspectionError('unsupported_format', 'archive is too large')
      }
      assertZipEntriesWithin(names, workDir)
      assertNoFoldedPathCollisions(names, 'Backup')
      await zip.extract(null, workDir)
      await zip.close()
      zip = undefined

      const metadataPath = path.join(workDir, 'metadata.json')
      if (!(await fs.pathExists(metadataPath))) {
        throw new ConversationInspectionError('unsupported_format', 'metadata.json is missing')
      }
      const metadata = (await fs.readJson(metadataPath)) as Record<string, unknown>
      if (metadata.appName !== 'Cherry Studio') {
        throw new ConversationInspectionError('not_cherry_backup')
      }
      if (metadata.version !== SUPPORTED_BACKUP_VERSION) {
        throw new ConversationInspectionError(
          'unsupported_format',
          `backup version ${String(metadata.version)} is not supported`
        )
      }

      const dataDir = path.join(workDir, 'Data')
      const dataDirStats = await fs.lstat(dataDir).catch(() => null)
      if (dataDirStats && (dataDirStats.isSymbolicLink() || !dataDirStats.isDirectory())) {
        throw new ConversationInspectionError('unsupported_format', 'Data is not a regular directory')
      }

      const candidates = [path.join(dataDir, 'cherrystudio.sqlite'), path.join(workDir, 'cherrystudio.sqlite')]
      let dbPath: string | null = null
      for (const candidate of candidates) {
        const stats = await fs.lstat(candidate).catch(() => null)
        if (stats?.isFile() && !stats.isSymbolicLink()) {
          dbPath = candidate
          break
        }
      }
      if (!dbPath) {
        throw new ConversationInspectionError('missing_database')
      }

      return { workDir, dbPath, metadata }
    } catch (error) {
      await fs.remove(workDir).catch(() => {})
      if (error instanceof ConversationInspectionError) throw error
      throw new ConversationInspectionError(
        'unsupported_format',
        error instanceof Error ? error.message : String(error)
      )
    } finally {
      if (zip) await zip.close().catch(() => {})
    }
  }

  private openSourceDb(dbPath: string): SqliteDatabase {
    let sqlite: SqliteDatabase | undefined
    try {
      sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
      sqlite.pragma('query_only = ON')
      const integrity = String(sqlite.pragma('integrity_check', { simple: true }))
      if (integrity !== 'ok') {
        throw new ConversationInspectionError('unreadable_database', integrity)
      }
      return sqlite
    } catch (error) {
      sqlite?.close()
      if (error instanceof ConversationInspectionError) throw error
      throw new ConversationInspectionError(
        'unreadable_database',
        error instanceof Error ? error.message : String(error)
      )
    }
  }

  private readBundle(sqlite: SqliteDatabase): ImportBundle {
    const tables = new Set(
      (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as SourceRow[])
        .map((row) => stringValue(row.name))
        .filter(Boolean)
    )
    if (!tables.has('topic') || !tables.has('message')) {
      throw new ConversationInspectionError('missing_tables', 'topic or message table is missing')
    }

    const topicColumns = tableColumns(sqlite, 'topic')
    const messageColumns = tableColumns(sqlite, 'message')
    if (!['id', 'name'].every((column) => topicColumns.has(column))) {
      throw new ConversationInspectionError('missing_tables', 'topic table is missing required columns')
    }
    if (!['id', 'topic_id', 'role', 'data'].every((column) => messageColumns.has(column))) {
      throw new ConversationInspectionError('missing_tables', 'message table is missing required columns')
    }

    const topicRows = sqlite.prepare('SELECT * FROM topic').all() as SourceRow[]
    const assistantRows = tables.has('assistant')
      ? (sqlite.prepare('SELECT * FROM assistant').all() as SourceRow[])
      : []

    const topics = topicRows
      .filter((row) => nullableNumber(row.deleted_at) === null)
      .map(toSourceTopic)
      .filter((topic): topic is SourceTopic => topic !== null)
    const activeTopicIds = [...new Set(topics.map((topic) => topic.id))]

    const assistants = new Map<string, SourceAssistant>()
    for (const row of assistantRows) {
      if (nullableNumber(row.deleted_at) !== null) continue
      const assistant = toSourceAssistant(row)
      if (assistant) assistants.set(assistant.id, assistant)
    }

    const messagesByTopic = new Map<string, SourceMessage[]>()
    for (let i = 0; i < activeTopicIds.length; i += SQLITE_IN_CHUNK) {
      const chunk = activeTopicIds.slice(i, i + SQLITE_IN_CHUNK)
      const placeholders = chunk.map(() => '?').join(',')
      const rows = sqlite
        .prepare(`SELECT * FROM message WHERE topic_id IN (${placeholders})`)
        .all(...chunk) as SourceRow[]
      for (const row of rows) {
        const topicId = nullableString(row.topic_id)
        if (!topicId) continue
        const message = toSourceMessage(row)
        if (!message) continue
        const messages = messagesByTopic.get(topicId) ?? []
        messages.push(message)
        messagesByTopic.set(topicId, messages)
      }
    }

    return { topics, assistants, messagesByTopic }
  }

  private importBundle(bundle: ImportBundle, options: { keepExistingAssistants: boolean }): ConversationRestoreResult {
    const dbService = application.get('DbService')
    const importedTopicIds: string[] = []
    const createdAssistantIds: string[] = []
    const deletedAssistantIds: string[] = []

    const result = dbService.withWriteTx((tx) => {
      const localAssistants = tx
        .select({ id: assistantTable.id })
        .from(assistantTable)
        .where(isNull(assistantTable.deletedAt))
        .all()
      const localAssistantIds = new Set(localAssistants.map((row) => row.id))
      const localModelIds = new Set(
        tx
          .select({ id: userModelTable.id })
          .from(userModelTable)
          .all()
          .map((row) => row.id)
      )

      const referencedAssistantIds = new Set(
        bundle.topics.map((topic) => topic.assistantId).filter((id): id is string => Boolean(id))
      )
      const assistantIdMap = new Map<string, string>()
      const assistantValues: Array<Omit<typeof assistantTable.$inferInsert, 'orderKey'>> = []

      const sortedAssistants = [...bundle.assistants.values()].sort((a, b) => {
        const orderA = a.orderKey ?? ''
        const orderB = b.orderKey ?? ''
        if (orderA !== orderB) return orderA.localeCompare(orderB)
        return a.name.localeCompare(b.name)
      })

      const assistantsToImport = options.keepExistingAssistants
        ? sortedAssistants.filter((assistant) => referencedAssistantIds.has(assistant.id))
        : sortedAssistants

      for (const assistant of assistantsToImport) {
        const newId = uuidv4()
        assistantIdMap.set(assistant.id, newId)
        const collidesWithLocal = options.keepExistingAssistants && localAssistantIds.has(assistant.id)
        assistantValues.push({
          id: newId,
          name: collidesWithLocal ? `${assistant.name}*` : assistant.name,
          emoji: assistant.emoji,
          prompt: assistant.prompt,
          description: assistant.description,
          settings: assistant.settings,
          modelId: assistant.modelId && localModelIds.has(assistant.modelId) ? assistant.modelId : null,
          groupId: null,
          createdAt: assistant.createdAt,
          updatedAt: assistant.updatedAt
        })
        createdAssistantIds.push(newId)
      }

      if (!options.keepExistingAssistants) {
        const activeAssistantIds = tx
          .select({ id: assistantTable.id })
          .from(assistantTable)
          .where(isNull(assistantTable.deletedAt))
          .all()
          .map((row) => row.id)
        deletedAssistantIds.push(...assistantDataService.purgeManyPermanentlyTx(tx, activeAssistantIds))
      }

      if (assistantValues.length > 0) {
        assistantDataService.importManyTx(tx, assistantValues)
      }

      const sortedTopics = [...bundle.topics].sort((a, b) => {
        if (a.lastActivityAt !== b.lastActivityAt) return b.lastActivityAt - a.lastActivityAt
        return a.id.localeCompare(b.id)
      })

      const topicPlans: TopicPlan[] = sortedTopics.map((topic) => {
        const newTopicId = uuidv4()
        const messages = bundle.messagesByTopic.get(topic.id) ?? []
        const rootSourceIds = new Set(
          messages.filter((message) => message.role === 'root').map((message) => message.id)
        )
        const nonRootMessages = messages.filter((message) => message.role !== 'root')
        const messageIdBySourceId = new Map(nonRootMessages.map((message) => [message.id, uuidv7()]))
        return { source: topic, newTopicId, messageIdBySourceId, rootSourceIds }
      })

      const topicValues: Array<Omit<typeof topicTable.$inferInsert, 'orderKey'>> = topicPlans.map(
        ({ source, newTopicId, messageIdBySourceId }) => {
          const activeNodeId =
            source.activeNodeId && messageIdBySourceId.has(source.activeNodeId)
              ? (messageIdBySourceId.get(source.activeNodeId) ?? null)
              : null
          return {
            id: newTopicId,
            name: source.name,
            isNameManuallyEdited: source.isNameManuallyEdited,
            assistantId: source.assistantId ? (assistantIdMap.get(source.assistantId) ?? null) : null,
            activeNodeId,
            traceId: source.traceId,
            lastActivityAt: source.lastActivityAt,
            createdAt: source.createdAt,
            updatedAt: source.updatedAt
          }
        }
      )
      topicService.importManyTx(tx, topicValues)
      importedTopicIds.push(...topicPlans.map((plan) => plan.newTopicId))

      let messagesImported = 0
      for (const plan of topicPlans) {
        const rootId = messageService.createRootMessageTx(tx, plan.newTopicId)
        const messages = bundle.messagesByTopic.get(plan.source.id) ?? []
        const nonRootMessages = messages.filter((message) => message.role !== 'root')
        const parentByNewId = new Map<string, string>()
        for (const message of nonRootMessages) {
          const newId = plan.messageIdBySourceId.get(message.id)
          if (!newId) continue
          const sourceParent = message.parentId
          const parentId =
            sourceParent && !plan.rootSourceIds.has(sourceParent)
              ? (plan.messageIdBySourceId.get(sourceParent) ?? rootId)
              : rootId
          parentByNewId.set(newId, parentId)
        }

        const entries = nonRootMessages.flatMap((message) => {
          const newId = plan.messageIdBySourceId.get(message.id)
          if (!newId) return []
          return [{ message, newId }]
        })
        const depthByNewId = this.assignDepths(rootId, entries, parentByNewId)

        const byDepth = new Map<number, typeof entries>()
        for (const entry of entries) {
          const depth = depthByNewId.get(entry.newId) ?? 1
          const group = byDepth.get(depth) ?? []
          group.push(entry)
          byDepth.set(depth, group)
        }

        for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
          const values = (byDepth.get(depth) ?? []).map(({ message, newId }) => ({
            id: newId,
            parentId: parentByNewId.get(newId) ?? rootId,
            topicId: plan.newTopicId,
            role: message.role as 'user' | 'assistant' | 'system',
            data: message.data,
            status: message.status as 'success' | 'error' | 'paused',
            siblingsGroupId: message.siblingsGroupId,
            modelId: message.modelId && localModelIds.has(message.modelId) ? message.modelId : null,
            messageSnapshot: message.messageSnapshot,
            stats: message.stats,
            compactionSummary: message.compactionSummary,
            createdAt: message.createdAt,
            updatedAt: message.updatedAt,
            deletedAt: message.deletedAt
          }))
          messageService.importManyTx(tx, values)
          messagesImported += values.length
        }
      }

      return {
        topicsImported: topicPlans.length,
        messagesImported,
        assistantsCreated: assistantValues.length,
        deletedAssistants: deletedAssistantIds.length
      }
    })

    if (deletedAssistantIds.length > 0) {
      assistantDataService.notifyReadModelChange(deletedAssistantIds, 'membership')
    }
    if (importedTopicIds.length > 0) {
      topicService.notifyReadModelChange(importedTopicIds, 'membership')
    }
    if (createdAssistantIds.length > 0) {
      assistantDataService.notifyReadModelChange(createdAssistantIds, 'membership')
    }

    return result
  }

  private assignDepths(
    rootId: string,
    entries: Array<{ newId: string }>,
    parentByNewId: Map<string, string>
  ): Map<string, number> {
    const depthByNewId = new Map<string, number>([[rootId, 0]])
    const remaining = new Set(entries.map((entry) => entry.newId))

    while (remaining.size > 0) {
      let progressed = false
      for (const id of [...remaining]) {
        const parentDepth = depthByNewId.get(parentByNewId.get(id) ?? rootId)
        if (parentDepth !== undefined) {
          depthByNewId.set(id, parentDepth + 1)
          remaining.delete(id)
          progressed = true
        }
      }
      if (!progressed) {
        const id = remaining.values().next().value
        if (id === undefined) break
        parentByNewId.set(id, rootId)
        depthByNewId.set(id, 1)
        remaining.delete(id)
      }
    }

    return depthByNewId
  }
}

export const conversationRestoreService = new ConversationRestoreService()
