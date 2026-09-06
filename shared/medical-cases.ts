/**
 * 学生端可以安全看到的病例目录。
 *
 * 这里只保存进入训练前本来就会展示的信息。诊断、完整病史、检查答案和评分
 * 规则全部放在 `agents/medical/cases.ts`，防止学生通过前端源码提前看到答案。
 */

export type PublicMedicalCase = {
  id: string;
  title: string;
  seriesId: string;
  seriesTitle: string;
  act: 1 | 2 | 3;
  opening: string;
  level: string;
  estimatedMinutes: number;
  tags: string[];
};

/**
 * 三个真实 PBL 纵向病例，共九个可独立启动的训练单元。
 * 每个 series 内的三幕属于同一患者，只是随病程逐步披露新信息。
 */
export const PUBLIC_MEDICAL_CASES: PublicMedicalCase[] = [
  {
    id: "pbl-cml-act1",
    seriesId: "pbl-cml",
    seriesTitle: "Case 1 · 劳碌半生赵阿姨的入院波折",
    act: 1,
    title: "第一幕 · 肺炎背后的异常",
    opening:
      "62 岁女性因高热、咳嗽、气短住院，影像提示肺部感染和胸腔积液，但病史与血象还藏着无法用肺炎解释的线索。",
    level: "本科临床推理 · 血液与肿瘤",
    estimatedMinutes: 25,
    tags: ["肺炎", "异常血象", "鉴别诊断", "问诊"]
  },
  {
    id: "pbl-cml-act2",
    seriesId: "pbl-cml",
    seriesTitle: "Case 1 · 劳碌半生赵阿姨的入院波折",
    act: 2,
    title: "第二幕 · 胸水与骨髓异常",
    opening:
      "胸水、外周血涂片和骨髓检查带来新的证据。请判断现有证据能把诊断推进到哪一步，还缺什么。",
    level: "本科临床推理 · 血液与肿瘤",
    estimatedMinutes: 25,
    tags: ["胸水", "骨髓", "CML", "诊断证据"]
  },
  {
    id: "pbl-cml-act3",
    seriesId: "pbl-cml",
    seriesTitle: "Case 1 · 劳碌半生赵阿姨的入院波折",
    act: 3,
    title: "第三幕 · 分子确诊与靶向治疗",
    opening:
      "细胞遗传学、分子生物学和流式结果返回。请完成疾病分期、治疗选择和长期监测的临床推理。",
    level: "本科临床推理 · 血液与肿瘤",
    estimatedMinutes: 30,
    tags: ["BCR::ABL1", "分期", "TKI", "循证"]
  },

  {
    id: "pbl-stemi-act1",
    seriesId: "pbl-stemi",
    seriesTitle: "Case 2 · “追逐时尚”的刘阿姨",
    act: 1,
    title: "第一幕 · 胸痛与 ST 段抬高",
    opening:
      "53 岁女性有高血压、糖尿病和长期劳力性胸痛，本次活动后出现持续胸痛、大汗和气短。请在不完整信息下做出急诊判断。",
    level: "本科临床推理 · 循环系统",
    estimatedMinutes: 25,
    tags: ["胸痛", "STEMI", "急诊", "鉴别诊断"]
  },
  {
    id: "pbl-stemi-act2",
    seriesId: "pbl-stemi",
    seriesTitle: "Case 2 · “追逐时尚”的刘阿姨",
    act: 2,
    title: "第二幕 · 冠脉造影与 PCI",
    opening:
      "冠脉造影、PCI 和心肌损伤标志物结果已经出现。请把症状、心电图、生化和冠脉解剖串成完整证据链。",
    level: "本科临床推理 · 循环系统",
    estimatedMinutes: 25,
    tags: ["冠脉造影", "PCI", "心肌标志物", "并发症"]
  },
  {
    id: "pbl-stemi-act3",
    seriesId: "pbl-stemi",
    seriesTitle: "Case 2 · “追逐时尚”的刘阿姨",
    act: 3,
    title: "第三幕 · 出院与二级预防",
    opening:
      "PCI 后患者进入稳定恢复期。请把急性期治疗延伸为抗栓、危险因素控制、心脏康复和再发胸痛管理。",
    level: "本科临床推理 · 循环系统",
    estimatedMinutes: 25,
    tags: ["二级预防", "抗血小板", "心脏康复", "随访"]
  },

  {
    id: "pbl-cirrhosis-act1",
    seriesId: "pbl-cirrhosis",
    seriesTitle: "Case 3 · 这是一场持久战",
    act: 1,
    title: "第一幕 · 呕血与黑便",
    opening:
      "76 岁女性有慢性乙肝、肝硬化和重度食管静脉曲张史，本次呕血、黑便并伴头晕心慌。请先判断严重程度和最可能出血来源。",
    level: "本科临床推理 · 消化系统",
    estimatedMinutes: 25,
    tags: ["上消化道出血", "肝硬化", "门静脉高压", "急救"]
  },
  {
    id: "pbl-cirrhosis-act2",
    seriesId: "pbl-cirrhosis",
    seriesTitle: "Case 3 · 这是一场持久战",
    act: 2,
    title: "第二幕 · 失代偿与门静脉高压",
    opening:
      "查体、肝肾功能、凝血和影像学结果进一步返回。请判断失代偿程度、器官风险以及肝占位下一步如何处理。",
    level: "本科临床推理 · 消化系统",
    estimatedMinutes: 30,
    tags: ["失代偿", "肝功能", "肾功能", "肝占位"]
  },
  {
    id: "pbl-cirrhosis-act3",
    seriesId: "pbl-cirrhosis",
    seriesTitle: "Case 3 · 这是一场持久战",
    act: 3,
    title: "第三幕 · 止血、内镜与长期管理",
    opening:
      "急性出血暂时稳定，接下来要决定内镜、门静脉高压二级预防、长期抗病毒及肝癌筛查的完整管理路径。",
    level: "本科临床推理 · 消化系统",
    estimatedMinutes: 30,
    tags: ["内镜", "再出血预防", "抗病毒", "长期随访"]
  }
];

export function getPublicMedicalCase(caseId: string) {
  return PUBLIC_MEDICAL_CASES.find((item) => item.id === caseId) ?? null;
}
