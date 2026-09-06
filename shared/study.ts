/**
 * 医学教学 Demo 的前后端共享“公开协议”。
 *
 * 这里绝对不能放病例标准答案、评分细则或隐藏病史，因为 shared 目录会被
 * Vite 打进浏览器 bundle。前端只需要知道当前阶段、可执行动作和公开病例信息。
 */

export const STUDY_STAGES = [
  "history",
  "clinical_feedback",
  "evidence",
  "reflection",
  "completed"
] as const;

export type StudyStage = (typeof STUDY_STAGES)[number];

/** 前端阶段条显示文案。 */
export const STUDY_STAGE_LABELS: Record<StudyStage, string> = {
  history: "问诊实践",
  clinical_feedback: "临床反馈",
  evidence: "循证拓展",
  reflection: "反思修订",
  completed: "已完成"
};

/** 学生提交的第一次结构化判断。 */
export type InitialAssessment = {
  primaryDiagnosis: string;
  differentials: string;
  reasoning: string;
  confidence: number;
};

/** 学生在最后阶段提交的最终判断与反思。 */
export type FinalReflection = {
  finalDiagnosis: string;
  revisedReasoning: string;
  evidenceImpact: string;
  cognitiveBiasReflection: string;
  reflection: string;
  confidence: number;
};

/**
 * 浏览器读取的训练状态。`startedAt` / `updatedAt` 主要用于研究阶段计时；
 * 标准答案、评分 rubric 仍然只存在服务端。
 */
export type StudyState = {
  caseId: string;
  stage: StudyStage;
  startedAt: number;
  updatedAt: number;
  initialAssessment?: InitialAssessment;
  finalReflection?: FinalReflection;
};

export type StudyEvent = {
  id: number;
  createdAt: number;
  eventType: string;
  stage: StudyStage;
  payload: unknown;
};

