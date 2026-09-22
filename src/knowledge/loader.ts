import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import type { KnowledgeIndex, KnowledgeIndexEntry } from './types';

/**
 * 知识索引与正文加载：索引首次加载后按进程缓存，正文仅在首次命中时读取并缓存。
 * 索引/正文非法时抛出含条目标识与原因的 KnowledgeIndexError（调用方让步骤显式失败），
 * knowledge 目录不存在视为未配置（空索引）。
 */

const INDEX_FILE = 'index.yaml';

/** 知识索引或正文非法：消息包含条目 id 与原因，供步骤失败报告定位。 */
export class KnowledgeIndexError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'KnowledgeIndexError';
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function entryFieldError(id: string, reason: string): never {
  throw new KnowledgeIndexError(`知识条目 ${id} 非法：${reason}`);
}

/** 解析并校验索引结构；引用的正文文件必须存在且不越出知识根目录。 */
async function readIndex(root: string): Promise<KnowledgeIndex> {
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { entries: [] };
    }
    throw new KnowledgeIndexError(`无法访问知识根目录 ${root}`, { cause: error });
  }
  if (!rootStat.isDirectory()) {
    return { entries: [] };
  }

  const indexPath = path.join(root, INDEX_FILE);
  let raw: string;
  try {
    raw = await readFile(indexPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new KnowledgeIndexError(
        `知识目录存在但缺少 ${INDEX_FILE}：${indexPath}。请补齐索引或移除目录。`,
      );
    }
    throw new KnowledgeIndexError(`无法读取知识索引 ${indexPath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (error) {
    throw new KnowledgeIndexError(`知识索引不是合法 YAML：${indexPath}`, { cause: error });
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.entries)) {
    throw new KnowledgeIndexError(
      `知识索引结构非法：${indexPath}，需要顶层 entries 数组。`,
    );
  }

  const seenIds = new Set<string>();
  const entries: KnowledgeIndexEntry[] = [];
  for (const item of parsed.entries) {
    if (!isPlainObject(item)) {
      throw new KnowledgeIndexError(`知识索引包含非对象条目：${indexPath}`);
    }
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    if (id.length === 0) entryFieldError('(缺失 id)', 'id 必须是非空字符串');
    if (seenIds.has(id)) entryFieldError(id, 'id 重复');
    seenIds.add(id);

    if (
      !Array.isArray(item.triggers) ||
      item.triggers.length === 0 ||
      item.triggers.some((t) => typeof t !== 'string' || t.trim().length === 0)
    ) {
      entryFieldError(id, 'triggers 必须是至少含一个非空字符串的数组');
    }

    const file = typeof item.file === 'string' ? item.file.trim() : '';
    if (file.length === 0) entryFieldError(id, 'file 必须是非空字符串');
    if (path.isAbsolute(file)) entryFieldError(id, `file 不得使用绝对路径：${file}`);
    const resolved = path.resolve(root, file);
    const contained = path.relative(root, resolved);
    if (contained.startsWith('..') || path.isAbsolute(contained)) {
      entryFieldError(id, `file 越出知识根目录：${file}`);
    }
    try {
      const fileStat = await stat(resolved);
      if (!fileStat.isFile()) entryFieldError(id, `file 不是常规文件：${file}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        entryFieldError(id, `正文文件不存在：${file}`);
      }
      throw new KnowledgeIndexError(`知识条目 ${id} 无法访问正文 ${file}`, { cause: error });
    }

    entries.push({
      id,
      triggers: (item.triggers as unknown[]).map((t) => (t as string).trim()),
      file,
    });
  }
  return { entries };
}

const indexCache = new Map<string, Promise<KnowledgeIndex>>();

/** 加载并缓存索引；失败不缓存，下次调用重新尝试。 */
export function loadKnowledgeIndex(root: string): Promise<KnowledgeIndex> {
  const resolved = path.resolve(root);
  const cached = indexCache.get(resolved);
  if (cached) return cached;
  const pending = readIndex(resolved).catch((error: unknown) => {
    indexCache.delete(resolved);
    throw error;
  });
  indexCache.set(resolved, pending);
  return pending;
}

const bodyCache = new Map<string, Promise<string>>();

/** 读取条目正文；首次读取后按进程缓存。索引加载时已校验存在，读取失败仍显式报错。 */
export function readKnowledgeBody(root: string, entry: KnowledgeIndexEntry): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const cacheKey = `${resolvedRoot}\n${entry.id}`;
  const cached = bodyCache.get(cacheKey);
  if (cached) return cached;
  const pending = readFile(path.join(resolvedRoot, entry.file), 'utf8').catch(
    (error: unknown) => {
      bodyCache.delete(cacheKey);
      throw new KnowledgeIndexError(
        `知识条目 ${entry.id} 正文读取失败：${entry.file}`,
        { cause: error },
      );
    },
  );
  bodyCache.set(cacheKey, pending);
  return pending;
}
