import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { streamText } from "ai";

const HEYIWEI_BASE_URL = "https://ai.websee.top/v1";
// 必须和生产 model-provider 保持同一真实入口；smoke gate 的意义就是验证
// 产品实际会走的协议/中转，而不是另找一个“看起来像”海豹云的地址。
const HAIBAO_BASE_URL = "http://42.192.94.176:5002/v1";
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

async function validateFramedStream(label, result) {
  const textParts = new Set();
  const reasoningParts = new Set();
  const toolInputs = new Set();
  let textDeltaCount = 0;
  let sawFinish = false;

  // Think 实际消费的是 `result.toUIMessageStream()`，不是 `fullStream`。
  // 2026-09-06 的生产故障恰好发生在 UIMessageStream framing 层：客户端报
  // text-delta 对应的 text-start 不存在。因此部署门禁必须验证“产品真正会
  // 发送给 useAgentChat 的 UI chunks”，不能只证明 provider fullStream 正常。
  for await (const chunk of result.toUIMessageStream({ sendReasoning: true })) {
    switch (chunk.type) {
      case "text-start":
        textParts.add(chunk.id);
        break;
      case "text-delta":
        if (!textParts.has(chunk.id)) {
          throw new Error(
            `${label}: text-delta(${chunk.id}) 之前没有 text-start`
          );
        }
        textDeltaCount += 1;
        break;
      case "text-end":
        if (!textParts.has(chunk.id)) {
          throw new Error(`${label}: text-end(${chunk.id}) 之前没有 text-start`);
        }
        textParts.delete(chunk.id);
        break;
      case "reasoning-start":
        reasoningParts.add(chunk.id);
        break;
      case "reasoning-delta":
        if (!reasoningParts.has(chunk.id)) {
          throw new Error(
            `${label}: reasoning-delta(${chunk.id}) 之前没有 reasoning-start`
          );
        }
        break;
      case "reasoning-end":
        if (!reasoningParts.has(chunk.id)) {
          throw new Error(
            `${label}: reasoning-end(${chunk.id}) 之前没有 reasoning-start`
          );
        }
        reasoningParts.delete(chunk.id);
        break;
      case "tool-input-start":
        toolInputs.add(chunk.id ?? chunk.toolCallId);
        break;
      case "tool-input-delta": {
        const id = chunk.id ?? chunk.toolCallId;
        if (!toolInputs.has(id)) {
          throw new Error(`${label}: tool-input-delta(${id}) 缺少 start`);
        }
        break;
      }
      case "tool-input-end": {
        const id = chunk.id ?? chunk.toolCallId;
        if (!toolInputs.has(id)) {
          throw new Error(`${label}: tool-input-end(${id}) 缺少 start`);
        }
        toolInputs.delete(id);
        break;
      }
      case "finish":
        sawFinish = true;
        break;
    }
  }

  if (!sawFinish) throw new Error(`${label}: 流没有 finish`);
  if (textDeltaCount === 0) throw new Error(`${label}: 没有收到文本 delta`);
  if (textParts.size || reasoningParts.size || toolInputs.size) {
    throw new Error(`${label}: 流结束时仍有未闭合 part`);
  }
}

async function smokeHeyiwei(groupId, apiKey) {
  const label = `何一位 g${groupId} / GPT-5.6 Luna`;
  const provider = createOpenAI({
    apiKey,
    baseURL: HEYIWEI_BASE_URL,
    name: "openai"
  });
  const result = streamText({
    model: provider.responses("gpt-5.6-luna"),
    prompt: "Reply exactly SMOKE_OK",
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    providerOptions: {
      openai: {
        store: false,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"]
      }
    }
  });
  await validateFramedStream(label, result);
  return label;
}

async function smokeBigFish() {
  const label = "海豹云 g19 大肥鱼 / DeepSeek V4 Flash";
  const provider = createDeepSeek({
    apiKey: required(process.env.HAIBAO_G19_KEY, "HAIBAO_G19_KEY"),
    baseURL: HAIBAO_BASE_URL
  });
  const result = streamText({
    model: provider.chat("deepseek-v4-flash"),
    prompt: "Reply exactly SMOKE_OK",
    abortSignal: AbortSignal.timeout(TIMEOUT_MS)
  });
  await validateFramedStream(label, result);
  return label;
}

async function main() {
  const heyiweiCandidates = [
    ["9", process.env.HEYIWEI_G9_KEY],
    ["2", process.env.HEYIWEI_G2_KEY]
  ].filter(([, key]) => Boolean(key));

  if (heyiweiCandidates.length === 0) {
    throw new Error("何一位 smoke test 至少需要 HEYIWEI_G9_KEY 或 HEYIWEI_G2_KEY");
  }

  let heyiweiPassed = null;
  const heyiweiFailures = [];
  for (const [groupId, key] of heyiweiCandidates) {
    try {
      heyiweiPassed = await smokeHeyiwei(groupId, key);
      console.log(`PASS  ${heyiweiPassed}`);
      break;
    } catch (error) {
      const reason = safeError(error);
      heyiweiFailures.push(`g${groupId}: ${reason}`);
      console.error(`FAIL  何一位 g${groupId}: ${reason}`);
    }
  }

  if (!heyiweiPassed) {
    throw new Error(
      `何一位 GPT-5.6 所有部署候选均失败：${heyiweiFailures.join(" | ")}`
    );
  }

  const bigFish = await smokeBigFish();
  console.log(`PASS  ${bigFish}`);
  console.log("PASS  provider smoke gate");
}

main().catch((error) => {
  console.error(`BLOCK ${safeError(error)}`);
  process.exitCode = 1;
});
