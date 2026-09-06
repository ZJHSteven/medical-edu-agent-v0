/**
 * 医学病例训练状态机测试。
 *
 * 这组测试刻意不调用任何真实模型：论文所依赖的“阶段不能越级、结构化提交不会
 * 被覆盖、研究事件可导出”必须是纯后端确定性规则，不能依赖 LLM 是否听话。
 */

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { getAgentByName, getSubAgentByName } from "agents";
import { MyAssistant } from "../../agents/assistant/agents/my-assistant/agent";
import { readDirectoryState, uniqueDirectoryName } from "./helpers";

async function freshStudy() {
  const directoryName = uniqueDirectoryName("study");
  const directory = await getAgentByName(env.AssistantDirectory, directoryName);
  const summary = await directory.createChat({
    caseId: "thyrotoxicosis-001",
    title: "状态机测试病例"
  });
  const child = await getSubAgentByName(directory, MyAssistant, summary.id);
  return { directoryName, directory, child, summary };
}

describe("Medical study flow — deterministic stage machine", () => {
  it("starts in history and exposes no structured answers yet", async () => {
    const { child, summary } = await freshStudy();

    const state = await child.getStudyState();
    expect(state).toMatchObject({
      caseId: "thyrotoxicosis-001",
      stage: "history"
    });
    expect(state.initialAssessment).toBeUndefined();
    expect(state.finalReflection).toBeUndefined();
    expect(summary.stage).toBe("history");
  });

  it("rejects attempts to skip clinical feedback", async () => {
    const { child } = await freshStudy();

    await expect(child.advanceToEvidence()).rejects.toThrow(
      /当前阶段为 history/
    );
    expect((await child.getStudyState()).stage).toBe("history");
  });

  it("persists the first assessment and advances the directory stage", async () => {
    const { child, directoryName, summary } = await freshStudy();
    const assessment = {
      primaryDiagnosis: "甲状腺功能亢进症",
      differentials: "甲状腺炎、外源性甲状腺激素",
      reasoning: "心悸、怕热、多汗、体重下降提示甲状腺毒症。",
      confidence: 65
    };

    const state = await child.submitInitialAssessment(assessment);
    expect(state.stage).toBe("clinical_feedback");
    expect(state.initialAssessment).toEqual(assessment);

    // 第一次判断是研究基线，只允许提交一次，防止学生覆盖原始答案。
    await expect(child.submitInitialAssessment(assessment)).rejects.toThrow(
      /只能在问诊实践阶段提交一次/
    );

    const directoryState = await readDirectoryState(directoryName);
    expect(
      directoryState.chats.find((chat) => chat.id === summary.id)?.stage
    ).toBe("clinical_feedback");
  });

  it("runs the full feedback → evidence → reflection → completed sequence", async () => {
    const { child } = await freshStudy();

    await child.submitInitialAssessment({
      primaryDiagnosis: "Graves 病",
      differentials: "甲状腺炎、毒性结节性甲状腺肿",
      reasoning: "甲状腺毒症症状合并甲状腺肿和眼征。",
      confidence: 70
    });
    expect((await child.advanceToEvidence()).stage).toBe("evidence");
    expect((await child.advanceToReflection()).stage).toBe("reflection");

    const reflection = {
      finalDiagnosis: "Graves 病所致甲状腺功能亢进症",
      revisedReasoning: "结合临床表现、TRAb 与弥漫性甲状腺改变后提高诊断确定性。",
      evidenceImpact: "外部证据帮助我区分 Graves 病与甲状腺炎的病因判断路径。",
      cognitiveBiasReflection: "起初存在过早闭合倾向，看到甲状腺毒症表现后没有先区分病因。",
      reflection: "最初没有主动区分甲状腺毒症和病因诊断。",
      confidence: 90
    };
    const completed = await child.submitFinalReflection(reflection);

    expect(completed.stage).toBe("completed");
    expect(completed.finalReflection).toEqual(reflection);
    expect(completed.finalReflection?.cognitiveBiasReflection).toContain("过早闭合");
    await expect(child.advanceToReflection()).rejects.toThrow(
      /当前阶段为 completed/
    );
  });

  it("exports structured study events for later research analysis", async () => {
    const { child, summary } = await freshStudy();

    await child.submitInitialAssessment({
      primaryDiagnosis: "甲亢",
      differentials: "甲状腺炎",
      reasoning: "存在典型高代谢症状。",
      confidence: 55
    });
    await child.advanceToEvidence();

    const exported = await child.exportStudyData();
    expect(exported).toMatchObject({
      schemaVersion: 1,
      chatId: summary.id,
      state: { stage: "evidence", caseId: "thyrotoxicosis-001" }
    });

    const eventTypes = exported.events.map((event) => event.eventType);
    expect(eventTypes).toContain("study_started");
    expect(eventTypes).toContain("initial_assessment_submitted");
    expect(eventTypes).toContain("evidence_stage_started");
  });
});

