import path from "node:path";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import agents from "agents/vite";
import { defineConfig } from "vitest/config";

const testsDir = import.meta.dirname;

export default defineConfig({
  plugins: [
    // 官方示例在 monorepo 中会从根目录加载一个仅用于压制第三方 sourcemap
    // 警告的辅助插件；独立产品仓库没有那个根目录脚本，而且它不影响测试语义，
    // 因此这里直接省略，避免测试环境反向依赖 Cloudflare 源码仓库布局。
    agents(),
    cloudflareTest({
      wrangler: {
        configPath: path.join(testsDir, "wrangler.jsonc")
      }
    })
  ],
  test: {
    name: "family-agent-v0",
    retry: 3,
    // Vitest 的 glob 语法统一使用 POSIX `/`。`path.join()` 在 Windows 会产生
    // 反斜杠，独立运行 Vitest 4 时会导致“测试文件明明存在却匹配为 0”。
    include: ["src/tests/**/*.test.ts"],
    setupFiles: ["src/tests/setup.ts"],
    testTimeout: 15_000,
    deps: {
      optimizer: {
        ssr: {
          // ajv ships its schema files via require('./*.json') which
          // vitest can't resolve without an explicit hint. Same fix
          // packages/ai-chat and packages/agents use.
          include: ["ajv"]
        }
      }
    }
  }
});
