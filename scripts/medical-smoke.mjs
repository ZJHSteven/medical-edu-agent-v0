import { createDeepSeek } from "@ai-sdk/deepseek";
import { streamText } from "ai";

/**
 * 医学教育 Demo 的真实模型部署门禁。
 *
 * 这里故意只验证正式实验锁定的 DeepSeek V4 Flash，不再继承 Family AI 的
 * 多供应商 smoke。学生端没有模型选择器，因此无关中转商故障不应该阻塞部署。
 *
 * 除了检查“模型能回答”，还遍历 AI SDK 的 UIMessageStream，验证浏览器真正
 * 消费的 text-start / text-delta / text-end / finish framing，防止出现上游 SSE
 * 看似正常、React 端却因为缺 start chunk 而崩溃的情况。
 */

const TIMEOUT_MS = 45_000;

function required(value, name) {
  if (!value) throw new Error(`缺少部署 smoke test Secret：${name}`);
  return value;
}

function safeError(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/gi, "[redacted]")
    .slice(0, 500);
}

async function validateFramedStream(result) {
  const textParts = new Set();
  let textDeltaCount = 0;
  let sawFinish = false;

  // 医学学生端明确 `sendReasoning:false`，所以 smoke 也按同样的 UI 流形态验证。
  for await (const chunk of result.toUIMessageStream({ sendReasoning: false })) {
    switch (chunk.type) {
      case "text-start":
        textParts.add(chunk.id);
        break;
      case "text-delta":
        if (!textParts.has(chunk.id)) {
          throw new Error(`text-delta(${chunk.id}) 之前没有 text-start`);
        }
        textDeltaCount += 1;
        break;
      case "text-end":
        if (!textParts.has(chunk.id)) {
          throw new Error(`text-end(${chunk.id}) 之前没有 text-start`);
        }
        textParts.delete(chunk.id);
        break;
      case "finish":
        sawFinish = true;
        break;
    }
  }

  if (!sawFinish) throw new Error("UIMessageStream 没有 finish");
  if (textDeltaCount === 0) throw new Error("UIMessageStream 没有文本 delta");
  if (textParts.size !== 0) throw new Error("UIMessageStream 结束时仍有未闭合文本 part");
}

async function main() {
  const provider = createDeepSeek({
    apiKey: required(process.env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY"),
    baseURL: "https://api.deepseek.com"
  });

  const result = streamText({
    model: provider.chat("deepseek-v4-flash"),
    prompt: "Reply exactly MEDICAL_SMOKE_OK",
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    providerOptions: {
      deepseek: {
        thinking: { type: "enabled" },
        reasoningEffort: "high"
      }
    }
  });

  await validateFramedStream(result);
  console.log("PASS  DeepSeek V4 Flash / medical experiment model");
  console.log("PASS  medical provider smoke gate");
}

main().catch((error) => {
  console.error(`BLOCK ${safeError(error)}`);
  process.exitCode = 1;
});
