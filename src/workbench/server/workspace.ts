import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';
import { HttpError } from './app';/**
 * 编写工作区文件访问边界：所有工作台触发的文件读写都必须落在
 * 工作区目录内。绝对路径与 `..` 逃逸一律拒绝，不提供工作区外
 * 任意文件访问。
 */
export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** 把工作区相对路径解析为受控绝对路径；越界即 400。 */
  resolve(relativePath: string): string {
    if (isAbsolute(relativePath)) {
      throw new HttpError(400, `不接受绝对路径：${relativePath}`);
    }
    const target = resolve(this.root, relativePath);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new HttpError(403, `路径越出工作区：${relativePath}`);
    }
    return target;
  }

  async ensureDir(relativePath: string): Promise<string> {
    const dir = this.resolve(relativePath);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async readText(relativePath: string): Promise<string> {
    return readFile(this.resolve(relativePath), 'utf8');
  }

  async writeText(relativePath: string, content: string): Promise<void> {
    const target = this.resolve(relativePath);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  async writeBinary(relativePath: string, data: Uint8Array): Promise<void> {
    const target = this.resolve(relativePath);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, data);
  }

  async readJson<T>(relativePath: string): Promise<T> {
    const text = await this.readText(relativePath);
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new HttpError(
        500,
        `工作区文件不是合法 JSON：${relativePath}`,
        error instanceof Error ? error.message : undefined,
      );
    }
  }

  async writeJson(relativePath: string, value: unknown): Promise<void> {
    await this.writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }
}
