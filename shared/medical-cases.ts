/**
 * 学生端可以安全看到的病例目录。
 *
 * 这里只保存进入训练前本来就会展示的信息。诊断、完整病史、检查答案和评分
 * 规则全部放在 `agents/medical/cases.ts`，防止学生通过前端源码提前看到答案。
 */

export type PublicMedicalCase = {
  id: string;
  title: string;
  opening: string;
  level: string;
  estimatedMinutes: number;
  tags: string[];
};

export const PUBLIC_MEDICAL_CASES: PublicMedicalCase[] = [
  {
    id: "thyrotoxicosis-001",
    title: "病例 01：心悸与体重下降",
    opening: "28 岁女性，因“反复心悸、怕热、体重下降 2 个月”就诊。请从问诊开始完成临床推理。",
    level: "本科临床思维基础",
    estimatedMinutes: 25,
    tags: ["内分泌", "问诊", "鉴别诊断", "循证"]
  }
];

export function getPublicMedicalCase(caseId: string) {
  return PUBLIC_MEDICAL_CASES.find((item) => item.id === caseId) ?? null;
}

