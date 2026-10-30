import { createWriteStream, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { ZipArchive } from 'archiver'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { applyMigrations } from '@data/db/applyMigrations'
import { assistantTable } from '@data/db/schemas/assistant'
import { messageTable } from '@data/db/schemas/message'
import { topicTable } from '@data/db/schemas/topic'
import { topicService } from '@data/services/TopicService'
import { conversationRestoreService } from '@main/services/ConversationRestoreService'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'
import type { MessageData } from '@shared/data/types/message'

const mocks = vi.hoisted(() => ({
  hasLiveStreams: vi.fn(() => false),
  listActiveWork: vi.fn((): Array<{ id: string; summary: string }> => [])
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiStreamManager: { hasLiveStreams: mocks.hasLiveStreams },
    AgentLifecycleService: { listActiveWork: mocks.listActiveWork }
  } as never)
})

const MIGRATIONS_PATH = path.resolve(process.cwd(), 'migrations/sqlite-drizzle')
const SOURCE_ASSISTANT_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_TOPIC_ID = '22222222-2222-4222-8222-222222222222'
const SOURCE_ROOT_ID = '33333333-3333-4333-8333-333333333333'
const SOURCE_USER_MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const SOURCE_ASSISTANT_MESSAGE_ID = '55555555-5555-4555-8555-555555555555'
const LOCAL_ASSISTANT_ID = '66666666-6666-4666-8666-666666666666'

const FULL_PARTS_DATA = {
  parts: [
    { type: 'text', text: 'hello' },
    { type: 'reasoning', text: 'thinking' },
    { type: 'data-code', data: { content: 'console.log(1)', language: 'js' } }
  ]
} satisfies MessageData

describe('ConversationRestoreService', () => {
  const dbh = setupTestDatabase()
  let tempRoot: string

  beforeAll(() => {
    tempRoot = mkdtempSync(path.join(tmpdir(), 'cs-conversation-restore-'))
  })

  afterAll(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  beforeEach(() => {
    mocks.hasLiveStreams.mockReturnValue(false)
    mocks.listActiveWork.mockReturnValue([])
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      if (key === 'feature.backup.temp') return tempRoot
      return filename ? path.join(tempRoot, key, filename) : path.join(tempRoot, key)
    })
  })

  function createSourceDb(options: { extraMigration?: boolean } = {}): string {
    const dbPath = path.join(tempRoot, `source-${Math.random().toString(16).slice(2)}.sqlite`)
    const sqlite = new Database(dbPath)
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    applyMigrations(db, MIGRATIONS_PATH)

    const now = Date.now()
    db.insert(assistantTable)
      .values({
        id: SOURCE_ASSISTANT_ID,
        name: 'Source Assistant',
        emoji: '🤖',
        prompt: '',
        description: '',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        modelId: null,
        groupId: null,
        orderKey: 'a0',
        createdAt: now,
        updatedAt: now
      })
      .run()
    db.insert(topicTable)
      .values({
        id: SOURCE_TOPIC_ID,
        name: 'Source Topic',
        isNameManuallyEdited: false,
        assistantId: SOURCE_ASSISTANT_ID,
        activeNodeId: null,
        traceId: null,
        orderKey: 'a0',
        lastActivityAt: now,
        createdAt: now,
        updatedAt: now
      })
      .run()
    db.insert(messageTable)
      .values({
        id: SOURCE_ROOT_ID,
        parentId: null,
        topicId: SOURCE_TOPIC_ID,
        role: 'root',
        data: { parts: [] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: now,
        updatedAt: now
      })
      .run()
    db.insert(messageTable)
      .values({
        id: SOURCE_USER_MESSAGE_ID,
        parentId: SOURCE_ROOT_ID,
        topicId: SOURCE_TOPIC_ID,
        role: 'user',
        data: { parts: [{ type: 'text', text: 'hello' }] },
        status: 'success',
        siblingsGroupId: 0,
        createdAt: now + 1,
        updatedAt: now + 1
      })
      .run()
    db.insert(messageTable)
      .values({
        id: SOURCE_ASSISTANT_MESSAGE_ID,
        parentId: SOURCE_USER_MESSAGE_ID,
        topicId: SOURCE_TOPIC_ID,
        role: 'assistant',
        data: FULL_PARTS_DATA,
        status: 'success',
        siblingsGroupId: 0,
        createdAt: now + 2,
        updatedAt: now + 2
      })
      .run()
    db.update(topicTable)
      .set({ activeNodeId: SOURCE_ASSISTANT_MESSAGE_ID })
      .where(eq(topicTable.id, SOURCE_TOPIC_ID))
      .run()

    if (options.extraMigration) {
      sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('deadbeef', now + 10_000)
    }

    sqlite.close()
    return dbPath
  }

  async function createBackupZip(dbPath: string): Promise<string> {
    const zipPath = path.join(tempRoot, `backup-${Math.random().toString(16).slice(2)}.zip`)
    const metadataPath = path.join(tempRoot, `metadata-${Math.random().toString(16).slice(2)}.json`)
    const metadata = {
      version: 7,
      timestamp: Date.now(),
      appName: 'Cherry Studio',
      appVersion: '2.1.6',
      platform: 'win32',
      arch: 'x64',
      resources: {
        database: false,
        cache: true,
        indexedDB: false,
        localStorage: false,
        appClaude: false,
        data: true
      }
    }
    const fs = await import('node:fs/promises')
    await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf8')

    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath)
      const archive = new ZipArchive({ zlib: { level: 1 }, zip64: true })
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)
      archive.file(dbPath, { name: 'Data/cherrystudio.sqlite' })
      archive.file(metadataPath, { name: 'metadata.json' })
      void archive.finalize()
    })
    return zipPath
  }

  async function inspectBackup(zipPath: string) {
    return conversationRestoreService.inspect(zipPath)
  }

  function seedLocalAssistant(id = LOCAL_ASSISTANT_ID): void {
    const now = Date.now()
    dbh.db
      .insert(assistantTable)
      .values({
        id,
        name: 'Local Assistant',
        emoji: '🙂',
        prompt: '',
        description: '',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        modelId: null,
        groupId: null,
        orderKey: 'a0',
        createdAt: now,
        updatedAt: now
      })
      .run()
  }

  function seedExistingTopic(assistantId = LOCAL_ASSISTANT_ID): void {
    topicService.create({ name: 'Existing Topic', assistantId })
  }

  it('inspects a v7 backup even when its migration chain is ahead', async () => {
    const dbPath = createSourceDb({ extraMigration: true })
    const zipPath = await createBackupZip(dbPath)

    const result = await inspectBackup(zipPath)

    expect(result).toMatchObject({
      ok: true,
      topicCount: 1,
      messageCount: 2,
      assistantCount: 1
    })
  })

  it('rejects a non-v7 archive', async () => {
    const dbPath = createSourceDb()
    // Rewrite metadata to v6
    const fs = await import('node:fs/promises')
    const rewriteDir = path.join(tempRoot, 'rewrite')
    await fs.mkdir(rewriteDir, { recursive: true })
    const rewriteZip = path.join(rewriteDir, 'v6.zip')
    const metadataPath = path.join(rewriteDir, 'metadata.json')
    await fs.writeFile(
      metadataPath,
      JSON.stringify({
        version: 6,
        appName: 'Cherry Studio',
        resources: { database: true, cache: false, indexedDB: true, localStorage: true, appClaude: true, data: true }
      }),
      'utf8'
    )
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(rewriteZip)
      const archive = new ZipArchive({ zlib: { level: 1 } })
      output.on('close', resolve)
      output.on('error', reject)
      archive.on('error', reject)
      archive.pipe(output)
      archive.file(dbPath, { name: 'Data/cherrystudio.sqlite' })
      archive.file(metadataPath, { name: 'metadata.json' })
      void archive.finalize()
    })

    const result = await inspectBackup(rewriteZip)
    expect(result).toMatchObject({ ok: false, reason: 'unsupported_format' })
  })

  it('keeps local assistants and conversations, creating an ID-matched assistant as a new "name*"', async () => {
    seedLocalAssistant(SOURCE_ASSISTANT_ID)
    seedExistingTopic(SOURCE_ASSISTANT_ID)
    const dbPath = createSourceDb()
    const zipPath = await createBackupZip(dbPath)
    const inspection = await inspectBackup(zipPath)
    expect(inspection.ok).toBe(true)
    if (!inspection.ok) throw new Error('inspection failed')

    const result = await conversationRestoreService.restore({
      backupPath: zipPath,
      sourceHash: inspection.sourceHash,
      keepExistingAssistants: true
    })

    expect(result).toMatchObject({
      topicsImported: 1,
      messagesImported: 2,
      assistantsCreated: 1,
      deletedAssistants: 0
    })

    const assistants = dbh.db.select().from(assistantTable).all()
    expect(assistants).toHaveLength(2)
    expect(assistants.find((assistant) => assistant.id === SOURCE_ASSISTANT_ID)?.name).toBe('Local Assistant')

    const topics = dbh.db.select().from(topicTable).all()
    expect(topics).toHaveLength(2)
    expect(topics.find((topic) => topic.name === 'Existing Topic')?.assistantId).toBe(SOURCE_ASSISTANT_ID)
    const importedTopic = topics.find((topic) => topic.name === 'Source Topic')
    const importedAssistant = dbh.db
      .select()
      .from(assistantTable)
      .where(eq(assistantTable.id, importedTopic!.assistantId!))
      .get()
    expect(importedAssistant?.name).toBe('Source Assistant*')

    const importedMessages = dbh.db
      .select()
      .from(messageTable)
      .where(eq(messageTable.topicId, importedTopic!.id))
      .all()
      .filter((message) => message.role !== 'root')
    expect(importedMessages).toHaveLength(2)
    const assistantMessage = importedMessages.find((message) => message.role === 'assistant')
    if (!assistantMessage) throw new Error('assistant message was not imported')
    expect((assistantMessage.data as typeof FULL_PARTS_DATA).parts).toEqual(FULL_PARTS_DATA.parts)
  })

  it('creates a new assistant when the backup assistant ID does not exist locally', async () => {
    seedLocalAssistant()
    seedExistingTopic()
    const dbPath = createSourceDb()
    const zipPath = await createBackupZip(dbPath)
    const inspection = await inspectBackup(zipPath)
    if (!inspection.ok) throw new Error('inspection failed')

    const result = await conversationRestoreService.restore({
      backupPath: zipPath,
      sourceHash: inspection.sourceHash,
      keepExistingAssistants: true
    })

    expect(result.assistantsCreated).toBe(1)
    const importedTopic = dbh.db
      .select()
      .from(topicTable)
      .all()
      .find((topic) => topic.name === 'Source Topic')
    const mappedAssistant = dbh.db
      .select()
      .from(assistantTable)
      .where(eq(assistantTable.id, importedTopic!.assistantId!))
      .get()
    expect(mappedAssistant?.name).toBe('Source Assistant')
  })

  it('deletes all local assistants while keeping existing conversations', async () => {
    seedLocalAssistant()
    seedExistingTopic()
    const dbPath = createSourceDb()
    const zipPath = await createBackupZip(dbPath)
    const inspection = await inspectBackup(zipPath)
    if (!inspection.ok) throw new Error('inspection failed')

    const result = await conversationRestoreService.restore({
      backupPath: zipPath,
      sourceHash: inspection.sourceHash,
      keepExistingAssistants: false
    })

    expect(result.deletedAssistants).toBe(1)
    const assistants = dbh.db.select().from(assistantTable).all()
    expect(assistants).toHaveLength(1)
    expect(assistants[0]?.name).toBe('Source Assistant')
    const topics = dbh.db.select().from(topicTable).all()
    expect(topics).toHaveLength(2)
    expect(topics.find((topic) => topic.name === 'Existing Topic')?.assistantId).toBeNull()
    expect(topics.find((topic) => topic.name === 'Source Topic')?.assistantId).toBe(assistants[0]?.id)
  })

  it('rejects a changed backup file', async () => {
    const dbPath = createSourceDb()
    const zipPath = await createBackupZip(dbPath)
    const inspection = await inspectBackup(zipPath)
    if (!inspection.ok) throw new Error('inspection failed')

    await expect(
      conversationRestoreService.restore({
        backupPath: zipPath,
        sourceHash: 'not-the-same-hash',
        keepExistingAssistants: true
      })
    ).rejects.toThrow('CONVERSATION_RESTORE_UNREADABLE')
  })

  it('rejects while a live AI stream exists', async () => {
    const dbPath = createSourceDb()
    const zipPath = await createBackupZip(dbPath)
    const inspection = await inspectBackup(zipPath)
    if (!inspection.ok) throw new Error('inspection failed')
    mocks.hasLiveStreams.mockReturnValue(true)

    await expect(
      conversationRestoreService.restore({
        backupPath: zipPath,
        sourceHash: inspection.sourceHash,
        keepExistingAssistants: true
      })
    ).rejects.toThrow('CONVERSATION_RESTORE_ACTIVE_WRITERS')
  })
})
