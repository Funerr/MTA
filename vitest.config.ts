import { defineConfig } from 'vitest/config';

// 框架自身测试：仅发现 tests/ 下的单元与边界集成测试，
// 与使用方业务用例目录 cases/ 严格分离。
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
