import { randomBytes } from 'node:crypto';
import { HttpError } from '../server/app';
import {
  assertDocumentInvariants,
  AUTHORING_PLATFORMS,
  createEmptyDocument,
  normalizeDocument,
  type AuthoringDocument,
  type AuthoringPlatform,
} from './document';
import type { Workspace } from '../server/workspace';

/**
 * 编写文档持久化：documents/<id>.json。保存做乐观并发控制——
 * 客户端带回所见 saveVersion，服务端版本前进即拒绝（409），
 * 防止旧标签页覆盖新内容。
 */

const DOCUMENTS_DIR = 'documents';

export interface DocumentSummary {
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
  readonly caseCount: number;
  readonly platforms: readonly AuthoringPlatform[];
}

export class DocumentStore {
  constructor(private readonly workspace: Workspace) {}
  private readonly writes = new Map<string, Promise<unknown>>();

  async list(): Promise<DocumentSummary[]> {
    await this.workspace.ensureDir(DOCUMENTS_DIR);
    const dir = this.workspace.resolve(DOCUMENTS_DIR);
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(dir)).filter(
      (name) => name.endsWith('.json'),
    );
    const summaries: DocumentSummary[] = [];
    for (const file of files) {
      try {
        const document = await this.load(file.replace(/\.json$/, ''));
        summaries.push({
          id: document.id,
          name: document.name,
          updatedAt: document.updatedAt,
          caseCount: document.cases.length,
          platforms: AUTHORING_PLATFORMS.filter((p) => document.variants[p]),
        });
      } catch {
        // 单个损坏文件不阻塞列表。
      }
    }
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return summaries;
  }

  async load(id: string): Promise<AuthoringDocument> {
    assertSafeId(id);
    try {
      const raw = await this.workspace.readJson<unknown>(
        `${DOCUMENTS_DIR}/${id}.json`,
      );
      return normalizeDocument(raw);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new HttpError(404, `编写文档不存在：${id}`);
      }
      throw error;
    }
  }

  /**
   * 保存。expectedSaveVersion 为客户端读取时的 saveVersion；
   * 不匹配说明有并发修改，返回 409 让客户端刷新后重试。
   */
  async save(
    document: AuthoringDocument,
    expectedSaveVersion: number,
  ): Promise<AuthoringDocument> {
    const previous = this.writes.get(document.id) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(() => this.saveUnlocked(document, expectedSaveVersion));
    this.writes.set(document.id, operation);
    try { return await operation; }
    finally { if (this.writes.get(document.id) === operation) this.writes.delete(document.id); }
  }

  private async saveUnlocked(document: AuthoringDocument, expectedSaveVersion: number): Promise<AuthoringDocument> {
    assertSafeId(document.id);
    assertDocumentInvariants(document);

    const existing = await this.loadOptional(document.id);
    if (existing && existing.saveVersion !== expectedSaveVersion) {
      throw new HttpError(
        409,
        `文档已被其他会话修改（磁盘 saveVersion=${existing.saveVersion}，提交基于 ${expectedSaveVersion}）；请刷新后重试`,
      );
    }

    const saved: AuthoringDocument = {
      ...document,
      saveVersion: (existing?.saveVersion ?? expectedSaveVersion - 1) + 1,
      updatedAt: new Date().toISOString(),
    };
    await this.workspace.writeJson(`${DOCUMENTS_DIR}/${document.id}.json`, saved);
    return saved;
  }

  async create(name: string): Promise<AuthoringDocument> {
    const id = `d-${randomBytes(4).toString('hex')}`;
    const document = createEmptyDocument(id, name.trim() || '未命名文档');
    await this.workspace.writeJson(`${DOCUMENTS_DIR}/${id}.json`, document);
    return document;
  }

  async delete(id: string): Promise<void> {
    assertSafeId(id);
    const path = `${DOCUMENTS_DIR}/${id}.json`;
    const existing = await this.loadOptional(id);
    if (!existing) {
      throw new HttpError(404, `编写文档不存在：${id}`);
    }
    const { rm } = await import('node:fs/promises');
    await rm(this.workspace.resolve(path), { force: true });
  }

  private async loadOptional(
    id: string,
  ): Promise<AuthoringDocument | undefined> {
    try {
      return await this.load(id);
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return undefined;
      throw error;
    }
  }
}

export function assertSafeId(id: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new HttpError(400, `非法文档 ID：${id}`);
  }
}
