import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_INDEX_ENABLED_ENV,
  KNOWLEDGE_INDEX_ROOT_ENV,
  loadKnowledgeInjectionConfig,
  parseKnowledgeEnabled,
  parseKnowledgeRoot,
} from '../../src/knowledge/config';
import {
  KnowledgeIndexError,
  loadKnowledgeIndex,
  readKnowledgeBody,
} from '../../src/knowledge/loader';
import type { KnowledgeIndexEntry } from '../../src/knowledge/types';

describe('知识注入开关与根目录解析（任务 1.1）', () => {
  it('缺省与无法识别的值均关闭；true/1/on 开启', () => {
    expect(parseKnowledgeEnabled(undefined)).toBe(false);
    expect(parseKnowledgeEnabled('')).toBe(false);
    expect(parseKnowledgeEnabled('maybe')).toBe(false);
    expect(parseKnowledgeEnabled('true')).toBe(true);
    expect(parseKnowledgeEnabled('1')).toBe(true);
    expect(parseKnowledgeEnabled('on')).toBe(true);
  });

  it('根目录：空白视为未设置，其余原样返回', () => {
    expect(parseKnowledgeRoot(undefined)).toBeUndefined();
    expect(parseKnowledgeRoot('  ')).toBeUndefined();
    expect(parseKnowledgeRoot(' fixtures/knowledge ')).toBe('fixtures/knowledge');
  });

  it('环境组装：默认关闭 + 默认根目录；开启与自定义根生效', () => {
    expect(loadKnowledgeInjectionConfig({})).toEqual({
      enabled: false,
      root: 'knowledge',
    });
    expect(
      loadKnowledgeInjectionConfig({
        [KNOWLEDGE_INDEX_ENABLED_ENV]: 'true',
        [KNOWLEDGE_INDEX_ROOT_ENV]: 'tmp-knowledge',
      }),
    ).toEqual({ enabled: true, root: 'tmp-knowledge' });
    expect(
      loadKnowledgeInjectionConfig({ [KNOWLEDGE_INDEX_ENABLED_ENV]: 'nope' }),
    ).toEqual({ enabled: false, root: 'knowledge' });
  });
});

describe('知识索引与正文加载（任务 1.2）', () => {
  let root: string;

  const writeIndex = async (content: string) => {
    await fs.writeFile(path.join(root, 'index.yaml'), content, 'utf8');
  };

  const entry = (id: string, file: string, triggers: string[] = [id]): KnowledgeIndexEntry => ({
    id,
    triggers,
    file,
  });

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mta-knowledge-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('目录不存在视为未配置：空索引不报错', async () => {
    const index = await loadKnowledgeIndex(path.join(root, 'absent'));
    expect(index.entries).toEqual([]);
  });

  it('合法索引通过校验并可读取正文', async () => {
    await writeIndex(
      ['entries:', '  - id: control-center', '    triggers: [控制中心]', '    file: entries/cc.md'].join(
        '\n',
      ),
    );
    await fs.mkdir(path.join(root, 'entries'));
    await fs.writeFile(path.join(root, 'entries', 'cc.md'), ' 从顶部右侧下拉。\n', 'utf8');

    const index = await loadKnowledgeIndex(root);
    expect(index.entries).toEqual([entry('control-center', 'entries/cc.md', ['控制中心'])]);
    await expect(readKnowledgeBody(root, index.entries[0]!)).resolves.toBe(' 从顶部右侧下拉。\n');
  });

  it('索引缺失、目录存在时报错', async () => {
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(KnowledgeIndexError);
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/index\.yaml/);
  });

  it('索引不是合法 YAML 或结构非法时报错', async () => {
    await writeIndex('entries: [_unclosed');
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/不是合法 YAML/);

    await writeIndex('foo: bar');
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/entries 数组/);
  });

  it('条目校验：id 重复、triggers 空、file 缺失/绝对路径/越界/正文不存在均报错并含条目 id', async () => {
    await fs.mkdir(path.join(root, 'entries'));
    await fs.writeFile(path.join(root, 'entries', 'a.md'), 'A', 'utf8');

    await writeIndex(
      ['entries:', '  - id: dup', '    triggers: [t]', '    file: entries/a.md', '  - id: dup', '    triggers: [t]', '    file: entries/a.md'].join('\n'),
    );
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/dup .*重复/);

    await writeIndex(['entries:', '  - id: no-triggers', '    triggers: []', '    file: entries/a.md'].join('\n'));
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/no-triggers .*triggers/);

    await writeIndex(['entries:', '  - id: no-file', '    triggers: [t]'].join('\n'));
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/no-file .*file/);

    await writeIndex(['entries:', '  - id: abs-file', '    triggers: [t]', '    file: /etc/hosts'].join('\n'));
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/abs-file .*绝对路径/);

    await writeIndex(['entries:', '  - id: escape', '    triggers: [t]', '    file: ../outside.md'].join('\n'));
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/escape .*越出/);

    await writeIndex(['entries:', '  - id: missing-body', '    triggers: [t]', '    file: entries/absent.md'].join('\n'));
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(/missing-body .*不存在/);
  });

  it('索引按进程缓存：同根目录重复加载不再读盘', async () => {
    await writeIndex(
      ['entries:', '  - id: cached', '    triggers: [t]', '    file: entries/a.md'].join('\n'),
    );
    await fs.mkdir(path.join(root, 'entries'));
    await fs.writeFile(path.join(root, 'entries', 'a.md'), 'A', 'utf8');

    await loadKnowledgeIndex(root);
    await writeIndex('entries: []');
    const again = await loadKnowledgeIndex(root);
    expect(again.entries.length).toBe(1);
  });

  it('索引加载失败不缓存：修复后同进程内可恢复', async () => {
    await writeIndex('entries: [broken');
    await expect(loadKnowledgeIndex(root)).rejects.toThrow(KnowledgeIndexError);
    await writeIndex('entries: []');
    await expect(loadKnowledgeIndex(root)).resolves.toEqual({ entries: [] });
  });

  it('正文按进程缓存：删除文件后仍可读（缓存），新条目 id 互不干扰', async () => {
    await fs.mkdir(path.join(root, 'entries'));
    const bodyPath = path.join(root, 'entries', 'b.md');
    await fs.writeFile(bodyPath, 'B', 'utf8');
    const item = entry('cached-body', 'entries/b.md');

    await expect(readKnowledgeBody(root, item)).resolves.toBe('B');
    await fs.rm(bodyPath);
    await expect(readKnowledgeBody(root, item)).resolves.toBe('B');
  });
});
