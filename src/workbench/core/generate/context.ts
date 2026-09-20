import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthoringPlatform } from '../document';

/**
 * 生成上下文加载：复用当前项目的 case-to-yaml Skill 规则、YAML 指南
 * 与目标平台 Node 参考（由 `pnpm nodes` 从真实注册表生成）。
 * 引用缺失时明确报告，不能套用其他版本语法。
 */

export interface ProjectGenerationContext {
  skillRules: string;
  conversionContract: string;
  assertionPolicy: string;
  yamlGuide: string;
  nodeReference: string;
  /** 缺失的项目引用（相对路径）。 */
  missing: readonly string[];
}

const FILES = {
  skillRules: '.agents/skills/case-to-yaml/SKILL.md',
  conversionContract: '.agents/skills/case-to-yaml/references/conversion-contract.md',
  assertionPolicy: '.agents/skills/case-to-yaml/references/assertion-policy.md',
  yamlGuide: 'docs/midscene-yaml-guide.md',
} as const;

export function nodeReferenceFile(platform: AuthoringPlatform): string {
  return `midscene-node-reference.${platform}.md`;
}

export async function loadProjectGenerationContext(
  projectRoot: string,
  platform: AuthoringPlatform,
): Promise<ProjectGenerationContext> {
  const missing: string[] = [];
  const read = async (relativePath: string): Promise<string> => {
    try {
      return await readFile(join(projectRoot, relativePath), 'utf8');
    } catch {
      missing.push(relativePath);
      return '';
    }
  };

  const [skillRules, conversionContract, assertionPolicy, yamlGuide, nodeReference] =
    await Promise.all([
      read(FILES.skillRules),
      read(FILES.conversionContract),
      read(FILES.assertionPolicy),
      read(FILES.yamlGuide),
      read(nodeReferenceFile(platform)),
    ]);

  return { skillRules, conversionContract, assertionPolicy, yamlGuide, nodeReference, missing };
}

/** 从 Node 参考文档解析可用 Node 名（“### `name`” 形式的标题）。 */
export function nodeNamesFromReference(nodeReference: string): string[] {
  const names: string[] = [];
  for (const match of nodeReference.matchAll(/^### `([A-Za-z0-9_.-]+)`/gm)) {
    names.push(match[1]!);
  }
  return [...new Set(names)];
}
