/**
 * Worker 端私有病例库。
 *
 * 与 `shared/medical-cases.ts` 不同，本文件包含完整答案，因此只能被 Worker 端
 * Agent 代码引用。第一版先用 TypeScript 常量，后续正式实验可迁移到经过教师
 * 审核的版本化病例 JSON / 数据库，并记录病例版本号以保证研究可复现。
 */

export type MedicalCase = {
  id: string;
  title: string;
  opening: string;
  patientProfile: string;
  historyFacts: string[];
  physicalExam: string[];
  investigations: string[];
  referenceDiagnosis: string;
  differentialFocus: string[];
  teachingPoints: string[];
};

const CASES: Record<string, MedicalCase> = {
  "thyrotoxicosis-001": {
    id: "thyrotoxicosis-001",
    title: "病例 01：心悸与体重下降",
    opening: "28 岁女性，因反复心悸、怕热、体重下降 2 个月就诊。",
    patientProfile:
      "28岁女性，公司职员。两个月前逐渐出现心悸、怕热、多汗、手抖，食量增加但体重下降约6kg。近期容易疲劳、情绪急躁、睡眠变差，月经量较前减少。",
    historyFacts: [
      "心悸呈持续性加重，活动后明显，无典型胸痛或晕厥。",
      "怕热、多汗，双手细颤，食欲增加但体重下降约6kg。",
      "排便次数由每日1次增至每日2~3次，无明显腹痛或血便。",
      "近1个月自觉眼睛发涩、畏光，家人觉得眼睛比以前突出。",
      "无近期发热、上呼吸道感染或明显颈前疼痛。",
      "无糖尿病、高血压、心脏病史；未服用甲状腺激素、减肥药或胺碘酮。",
      "母亲曾有甲状腺功能异常，具体类型不详。",
      "不吸烟，偶尔饮酒；近期工作压力较大。"
    ],
    physicalExam: [
      "体温 37.1℃，心率 112 次/分，节律规则，血压 132/68 mmHg。",
      "神志清楚，交流较快，皮肤温暖湿润，双手细颤。",
      "双眼轻度突出，上睑退缩，无明显眼球活动障碍。",
      "甲状腺弥漫性Ⅱ度肿大，质软，无明显压痛，可闻及血管杂音。",
      "心界不大，心率快，未闻及明显病理性杂音。",
      "双下肢无水肿。"
    ],
    investigations: [
      "TSH <0.01 mIU/L（降低），FT4 35.8 pmol/L（升高），FT3 10.6 pmol/L（升高）。",
      "TRAb 阳性；TPOAb 阳性。",
      "血常规、肝肾功能未见明显异常。",
      "心电图：窦性心动过速，心率约110次/分。",
      "甲状腺超声：双叶弥漫性增大，实质回声不均，血流信号丰富。"
    ],
    referenceDiagnosis: "Graves 病所致甲状腺功能亢进症",
    differentialFocus: [
      "无痛性/亚急性甲状腺炎导致的一过性甲状腺毒症",
      "外源性甲状腺激素摄入",
      "毒性多结节性甲状腺肿或自主功能性腺瘤",
      "焦虑障碍、贫血等可造成心悸和体重变化的非甲状腺疾病"
    ],
    teachingPoints: [
      "从症状簇识别甲状腺毒症，并主动询问药物、感染、疼痛及家族史。",
      "区分“甲状腺毒症”与其病因诊断，不能只凭 FT3/FT4 升高就直接等同 Graves 病。",
      "利用弥漫性甲状腺肿、眼征、TRAb 和血流特征支持 Graves 病。",
      "理解鉴别不同病因时 TRAb、摄碘率/显像及病史信息的价值。",
      "提出治疗前需要关注的心血管症状、血常规/肝功能及妊娠相关信息。"
    ]
  }
};

export function getMedicalCase(caseId: string): MedicalCase {
  const medicalCase = CASES[caseId];
  if (!medicalCase) {
    throw new Error(`未知医学教学病例：${caseId}`);
  }
  return medicalCase;
}

export function hasMedicalCase(caseId: string): boolean {
  return caseId in CASES;
}

