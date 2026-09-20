import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  collectWorkflowDocument,
  defineNode,
  NodeInputValidationError,
  NodeRegistry,
  WorkflowError,
  WorkflowParseError,
  z,
} from '@midscene/test';
import { loadTestProject } from '@midscene/test/config';

// 编写工作台静态检查管线的契约测试：锁定 @midscene/test 1.12.7 的
// 纯收集/校验行为——加载配置不触发项目 setup，收集与输入校验不做
// 设备/模型 I/O，也不执行任何 Node。

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
let tempDir: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'mta-workbench-contract-'));
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

const writeCase = (name: string, yaml: string): string => {
  const absolutePath = join(tempDir, name);
  writeFileSync(absolutePath, yaml, 'utf8');
  return absolutePath;
};

const collect = (absolutePath: string, registry: NodeRegistry) =>
  collectWorkflowDocument(
    {
      projectId: 'workbench-contract',
      sourcePath: absolutePath,
      absolutePath,
    },
    {
      resolveNode: (name) => registry.get(name),
      // 显式空 env：证明静态收集不依赖模型密钥等环境变量。
      env: {},
    },
  );

describe('loadTestProject：纯加载不触发项目 setup', () => {
  it('加载配置得到各项目 NodeRegistry，且不产生会话绑定日志', async () => {
    const logs: string[] = [];
    const spy = vi
      .spyOn(console, 'log')
      .mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(' '));
      });
    try {
      const loaded = await loadTestProject(
        join(repoRoot, 'midscene.config.ts'),
      );

      const projects = new Map(loaded.projects.map((p) => [p.name, p]));
      expect([...projects.keys()].sort()).toEqual([
        'android',
        'harmony',
        'multi-device',
      ]);

      const android = projects.get('android')!;
      expect(android.nodes.has('aiAct')).toBe(true);
      expect(android.nodes.has('device.prepare')).toBe(true);
      expect(android.nodes.has('runHdcShell')).toBe(false);

      const harmony = projects.get('harmony')!;
      expect(harmony.nodes.has('runHdcShell')).toBe(true);
      expect(harmony.nodes.has('runAdbShell')).toBe(false);

      const multiDevice = projects.get('multi-device')!;
      expect(multiDevice.nodes.has('device.parallel')).toBe(true);
      // 默认绑定为 phone1/phone2；即使环境覆盖，也应存在别名节点。
      const aliasedNodes = multiDevice.nodes
        .names()
        .filter((name) => /\.aiAct$/.test(name));
      expect(aliasedNodes.length).toBeGreaterThan(0);

      // setup 若被触发会输出“[mta] … 会话已绑定”日志；纯加载必须没有。
      expect(
        logs.filter((line) => line.includes('会话已绑定')),
      ).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('collectWorkflowDocument：纯静态收集', () => {
  let executions: string[];
  let registry: NodeRegistry;

  beforeAll(() => {
    executions = [];
    const promptNode = defineNode({
      name: 'stub.act',
      stringInputKey: 'prompt',
      inputSchema: z.strictObject({ prompt: z.string() }),
      execute: (execution) => {
        executions.push(execution.input.prompt);
        return { data: 'ok' };
      },
    });
    const noArgsNode = defineNode({
      name: 'stub.noargs',
      inputSchema: z.strictObject({}),
      execute: () => {
        executions.push('stub.noargs');
      },
    });
    registry = new NodeRegistry([promptNode, noArgsNode]);
  });

  it('收集合法工作流：规范化步骤且不执行任何 Node', () => {
    const absolutePath = writeCase(
      'valid.workbench-contract.yaml',
      [
        'cases:',
        '  - name: 静态收集',
        '    steps:',
        '      - stub.act: 打开设置',
        '      - stub.noargs: {}',
        '      - stub.act:',
        '          prompt: 返回主屏',
        '          $:',
        '            timeout: 3000',
      ].join('\n'),
    );

    const document = collect(absolutePath, registry);

    expect(document.cases).toHaveLength(1);
    const steps = document.cases[0]!.definition.steps;
    expect(steps.map((step) => step.node)).toEqual([
      'stub.act',
      'stub.noargs',
      'stub.act',
    ]);
    // 字符串简写经 stringInputKey 映射为对象输入；$ 元数据进入 meta。
    expect(steps[0]!.input).toEqual({ prompt: '打开设置' });
    expect(steps[2]!.meta.timeoutMs).toBe(3000);
    expect(steps[2]!.input).toEqual({ prompt: '返回主屏' });
    expect(executions).toEqual([]);
  });

  it('未知节点名在收集阶段被拒绝', () => {
    const absolutePath = writeCase(
      'unknown-node.workbench-contract.yaml',
      ['cases:', '  - name: 未知节点', '    steps:', '      - stub.missing: {}'].join(
        '\n',
      ),
    );

    expect(() => collect(absolutePath, registry)).toThrow(WorkflowParseError);
    expect(() => collect(absolutePath, registry)).toThrow(/stub\.missing/);
    expect(executions).toEqual([]);
  });

  it('未定义的变量插值在收集阶段被拒绝', () => {
    const absolutePath = writeCase(
      'missing-var.workbench-contract.yaml',
      [
        'cases:',
        '  - name: 缺失变量',
        '    steps:',
        '      - stub.act:',
        '          prompt: "${WORKBENCH_CONTRACT_MISSING_VAR}"',
      ].join('\n'),
    );

    expect(() => collect(absolutePath, registry)).toThrow(WorkflowParseError);
    expect(() => collect(absolutePath, registry)).toThrow(
      /WORKBENCH_CONTRACT_MISSING_VAR/,
    );
  });

  it('Node 输入校验与引擎一致：safeParseAsync 且不执行', async () => {
    const absolutePath = writeCase(
      'input-validation.workbench-contract.yaml',
      [
        'cases:',
        '  - name: 输入校验',
        '    steps:',
        '      - stub.act:',
        '          prompt: 123',
      ].join('\n'),
    );

    // prompt 为数字是非法输入，但结构合法，收集本身不校验输入 schema。
    const document = collect(absolutePath, registry);
    const step = document.cases[0]!.definition.steps[0]!;

    const node = registry.get('stub.act')!;
    const result = await node.inputSchema!.safeParseAsync(step.input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const error = NodeInputValidationError.fromZod('stub.act', result.error);
      expect(error).toBeInstanceOf(WorkflowError);
      expect(String(error)).toContain('stub.act');
    }
    // 校验全程没有触发执行。
    expect(executions).toEqual([]);
  });

  it('真实 wait 节点的输入契约可在不执行的情况下静态校验', async () => {
    const loaded = await loadTestProject(
      join(repoRoot, 'midscene.config.ts'),
    );
    const android = loaded.projects.find((p) => p.name === 'android')!;
    const wait = android.nodes.get('wait')!;

    const bad = await wait.inputSchema!.safeParseAsync({
      duration: -1,
      unit: 'ms',
    });
    expect(bad.success).toBe(false);

    const good = await wait.inputSchema!.safeParseAsync({ duration: 5 });
    expect(good.success).toBe(true);
  });
});
