/**
 * docs/midscene-yaml-guide.md「Node 清单」生成区块构建（纯函数，无副作用）。
 *
 * 输入是 `midscene-test nodes --project <name>` 生成的
 * midscene-node-reference.<project>.md；解析每个 Node 的说明、字符串简写与
 * JSON Schema，折叠 multi-device 参考中的别名重复项，产出可直接拼进指南的
 * Markdown 区块。scripts/generate-node-references.mjs 与单元测试共用本模块，
 * 保证指南清单与真实注册表派生的参考文档一致。
 */

export const GUIDE_PATH = 'docs/midscene-yaml-guide.md';
export const PROJECTS = ['android', 'harmony', 'multi-device'];

/**
 * multi-device 全局 Node 判定：`wait` 与 `device.*` 命名空间（别名配置禁止
 * 使用 `device`/`wait` 作别名，该前缀不会与别名冲突）。其余带 `.` 的名称视为
 * 别名化 Node；`experienceAct` 等无点名称落入全局分支。
 */
function isGlobalMultiDeviceNodeName(name) {
  return name === 'wait' || name.startsWith('device.');
}

export function regionMarker(project, edge) {
  return `<!-- generated:node-inventory:${project}:${edge} -->`;
}

/** 解析参考文档 `### \`node.name\`` 小节；解析失败的 Schema 记为 null。 */
export function parseNodeReference(markdown) {
  const headings = [...markdown.matchAll(/^### `([^`]+)`$/gm)];
  const nodes = [];
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i][0].length;
    const end = i + 1 < headings.length ? headings[i + 1].index : markdown.length;
    const body = markdown.slice(start, end);
    const descriptionLine = body
      .split('\n')
      .map((line) => line.trim())
      .find(
        (line) =>
          line &&
          !line.startsWith('#') &&
          !line.startsWith('**') &&
          !line.startsWith('```'),
      );
    const shorthandMatch = body.match(
      /\*\*String shorthand:\*\* Maps to `\{ (\w+): value \}`\./,
    );
    const schemaMatch = body.match(/```json\n([\s\S]*?)\n```/);
    let schema = null;
    if (schemaMatch) {
      try {
        schema = JSON.parse(schemaMatch[1]);
      } catch {
        schema = null;
      }
    }
    nodes.push({
      name: headings[i][1],
      description: descriptionLine ?? '',
      shorthand: shorthandMatch ? shorthandMatch[1] : null,
      schema,
    });
  }
  return nodes;
}

function typeSummary(schema) {
  if (!schema || typeof schema !== 'object') return 'unknown';
  if (Array.isArray(schema.enum)) {
    return [...new Set(schema.enum.map((value) => JSON.stringify(value)))].join('|');
  }
  if ('const' in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.anyOf)) {
    return [...new Set(schema.anyOf.map(typeSummary))].join('|');
  }
  if (Array.isArray(schema.type)) return schema.type.join('|');
  if (typeof schema.type === 'string') return schema.type;
  return 'unknown';
}

function propertySummary(name, property) {
  let summary = typeSummary(property);
  if (name === 'prompt' && summary.includes('object')) {
    summary = 'string 或富对象（见 prompt 详解）';
  } else if (name === 'options' && summary === 'object') {
    summary = 'object（字段见 options 详解）';
  }
  if ('default' in property) {
    summary += `，默认 ${JSON.stringify(property.default)}`;
  }
  const describe =
    typeof property.description === 'string' ? property.description.trim() : '';
  return describe ? `${name}: ${summary}（${describe}）` : `${name}: ${summary}`;
}

/** 表格单元格内转义管道符；正文单元格额外转义尖括号，避免内联 HTML 吞字。代码 span 内保持原样。 */
function escapePipes(text) {
  return text.replace(/\|/g, '\\|');
}

function escapeCell(text) {
  return escapePipes(text).replace(/</g, '\\<').replace(/>/g, '\\>');
}

function nodeSignature(node) {
  const required = node.schema?.required ?? [];
  const properties = Object.keys(node.schema?.properties ?? {});
  return JSON.stringify([node.description, node.shorthand, required, properties]);
}

function inputColumns(node) {
  const properties = Object.entries(node.schema?.properties ?? {});
  if (properties.length === 0) {
    return ['无（写 `{}`）', '—'];
  }
  const required = new Set(node.schema?.required ?? []);
  const requiredCells = [];
  const optionalCells = [];
  for (const [name, property] of properties) {
    const cell = propertySummary(name, property);
    (required.has(name) ? requiredCells : optionalCells).push(cell);
  }
  return [
    requiredCells.length ? requiredCells.join('；') : '—',
    optionalCells.length ? optionalCells.join('；') : '—',
  ];
}

function nodeRow(node, extraCells = []) {
  const [required, optional] = inputColumns(node);
  const shorthand = node.shorthand ? `\`${node.shorthand}\`` : '不支持';
  const cells = [
    escapePipes(`\`${node.name}\``),
    ...extraCells.map(escapeCell),
    escapeCell(node.description),
    escapeCell(required),
    escapeCell(optional),
    escapeCell(shorthand),
  ];
  return `| ${cells.join(' | ')} |`;
}

/** 单设备项目（android / harmony）区块：逐 Node 一行。 */
export function buildSingleProjectRegion(project, nodes) {
  const rows = nodes.map((node) => nodeRow(node));
  return [
    '| Node | 说明 | 必填参数 | 可选参数 | 字符串简写 |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** multi-device 区块：全局 Node 与折叠别名后的 `<alias>.<Node>` 两组表格。 */
export function buildMultiDeviceRegion(nodes) {
  const globalNodes = [];
  const aliasedGroups = new Map();
  const nativeNameCounts = new Map();
  for (const node of nodes) {
    if (isGlobalMultiDeviceNodeName(node.name)) {
      globalNodes.push(node);
      continue;
    }
    const separator = node.name.indexOf('.');
    if (separator <= 0) {
      globalNodes.push(node);
      continue;
    }
    const alias = node.name.slice(0, separator);
    const nativeName = node.name.slice(separator + 1);
    nativeNameCounts.set(nativeName, (nativeNameCounts.get(nativeName) ?? 0) + 1);
    const key = `${nativeName}::${nodeSignature(node)}`;
    if (!aliasedGroups.has(key)) {
      aliasedGroups.set(key, { nativeName, aliases: [], signature: nodeSignature(node) });
    }
    aliasedGroups.get(key).aliases.push(alias);
  }

  const globalTable = [
    '### 全局 Node（不加别名前缀）',
    '',
    '| Node | 说明 | 必填参数 | 可选参数 | 字符串简写 |',
    '| --- | --- | --- | --- | --- |',
    ...globalNodes.map((node) => nodeRow(node)),
  ].join('\n');

  const aliasedTable = [
    '### 别名化 Node（每个已绑定别名一组，写 `<alias>.<Node>`）',
    '',
    '| Node | 适用别名 | 说明 | 必填参数 | 可选参数 | 字符串简写 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...[...aliasedGroups.values()].map((group) => {
      const collapsed =
        nativeNameCounts.get(group.nativeName) === group.aliases.length;
      const representative = nodes.find(
        (node) =>
          !isGlobalMultiDeviceNodeName(node.name) &&
          node.name.endsWith(`.${group.nativeName}`) &&
          nodeSignature(node) === group.signature,
      );
      const displayName = collapsed
        ? `<alias>.${group.nativeName}`
        : group.aliases.map((alias) => `${alias}.${group.nativeName}`).join('、');
      return nodeRow(
        { ...representative, name: displayName },
        [group.aliases.slice().sort().join('、')],
      );
    }),
  ].join('\n');

  return [
    '「适用别名」列出本次参考生成时已绑定的别名（由 `.env` 的 `MULTI_DEVICE_BINDINGS` 决定；未设置时兼容默认 `phone1`/`phone2`）。实际别名以配置为准，`<alias>.<Node>` 语法不变。',
    '',
    globalTable,
    '',
    aliasedTable,
  ].join('\n');
}

/** 用最新区块替换指南中 start/end 标记之间的内容；标记缺失时抛错。 */
export function spliceGeneratedRegions(guideMarkdown, regions) {
  let updated = guideMarkdown;
  for (const [project, region] of Object.entries(regions)) {
    const start = regionMarker(project, 'start');
    const end = regionMarker(project, 'end');
    const startIndex = updated.indexOf(start);
    const endIndex = updated.indexOf(end);
    if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
      throw new Error(`${GUIDE_PATH} 缺少 ${project} 的 Node 清单生成区块标记`);
    }
    updated =
      updated.slice(0, startIndex) +
      `${start}\n\n${region}\n\n` +
      updated.slice(endIndex);
  }
  return updated;
}

/** 提取指南中某个项目的当前生成区块内容，用于一致性校验。 */
export function extractGeneratedRegion(guideMarkdown, project) {
  const start = regionMarker(project, 'start');
  const end = regionMarker(project, 'end');
  const startIndex = guideMarkdown.indexOf(start);
  const endIndex = guideMarkdown.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`${GUIDE_PATH} 缺少 ${project} 的 Node 清单生成区块标记`);
  }
  return guideMarkdown.slice(startIndex + start.length, endIndex).trim();
}

export function buildGuideRegionsFromReferences(referencesByProject) {
  return {
    android: buildSingleProjectRegion(
      'android',
      parseNodeReference(referencesByProject.android),
    ),
    harmony: buildSingleProjectRegion(
      'harmony',
      parseNodeReference(referencesByProject.harmony),
    ),
    'multi-device': buildMultiDeviceRegion(
      parseNodeReference(referencesByProject['multi-device']),
    ),
  };
}
