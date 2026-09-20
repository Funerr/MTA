import { randomBytes } from 'node:crypto';
import { HttpError } from './app';

/**
 * 内存任务注册表：耗时操作（模型生成、设备核查）返回任务 ID，
 * 进度与终态通过轮询或事件流获取。取消通过 AbortSignal 传播；
 * 服务重启后任务消失，不会自动续跑或覆盖草稿。
 */

export type WorkbenchTaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WorkbenchTask {
  readonly id: string;
  readonly kind: string;
  status: WorkbenchTaskStatus;
  readonly createdAt: string;
  endedAt?: string;
  progress: { at: string; message: string }[];
  result?: unknown;
  error?: string;
}

export class TaskAbortedError extends Error {
  constructor(message = '任务已取消') {
    super(message);
    this.name = 'TaskAbortedError';
  }
}

type TaskListener = (task: WorkbenchTask) => void;

export class TaskRegistry {
  private readonly tasks = new Map<string, WorkbenchTask>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly listeners = new Map<string, Set<TaskListener>>();

  list(): WorkbenchTask[] {
    return [...this.tasks.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  get(id: string): WorkbenchTask {
    const task = this.tasks.get(id);
    if (!task) throw new HttpError(404, `任务不存在：${id}`);
    return task;
  }

  subscribe(id: string, listener: TaskListener): () => void {
    const set = this.listeners.get(id) ?? new Set<TaskListener>();
    set.add(listener);
    this.listeners.set(id, set);
    return () => set.delete(listener);
  }

  /** 启动任务；run 收到信号与进度回调，返回值进入 task.result。 */
  start(
    kind: string,
    run: (handle: {
      signal: AbortSignal;
      report: (message: string) => void;
    }) => Promise<unknown>,
  ): WorkbenchTask {
    const id = `t-${randomBytes(4).toString('hex')}`;
    const task: WorkbenchTask = {
      id,
      kind,
      status: 'running',
      createdAt: new Date().toISOString(),
      progress: [],
    };
    this.tasks.set(id, task);
    const controller = new AbortController();
    this.controllers.set(id, controller);

    const report = (message: string) => {
      task.progress.push({ at: new Date().toISOString(), message });
      this.notify(task);
    };

    run({ signal: controller.signal, report })
      .then((result) => {
        task.status = 'completed';
        task.result = result;
        task.endedAt = new Date().toISOString();
        this.notify(task);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          task.status = 'cancelled';
          task.error = '任务已取消';
        } else {
          task.status = 'failed';
          task.error = error instanceof Error ? error.message : String(error);
        }
        task.endedAt = new Date().toISOString();
        this.notify(task);
      })
      .finally(() => {
        this.controllers.delete(id);
      });

    this.notify(task);
    return task;
  }

  cancel(id: string): WorkbenchTask {
    const task = this.get(id);
    const controller = this.controllers.get(id);
    if (task.status !== 'running') return task;
    if (controller) controller.abort(new TaskAbortedError());
    task.progress.push({ at: new Date().toISOString(), message: '已请求取消' });
    this.notify(task);
    return task;
  }

  private notify(task: WorkbenchTask): void {
    for (const listener of this.listeners.get(task.id) ?? []) {
      listener(task);
    }
  }
}
