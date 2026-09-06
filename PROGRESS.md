# 项目状态快照

## 当前结论
- 现状：项目已从 `family-agent-v0` 派生为独立 Git 仓库，准备改造成医学教育多智能体实验 Demo。
- 已完成：
  - [x] 复制现成 Think / Agents SDK / AI Elements 技术底座。
  - [x] 清除 `node_modules`、构建产物、Wrangler 本地状态与 `.env.local` 后再建立新仓库。
  - [x] 明确第一版采用“后端状态机控制角色”的可重复实验路线。
  - [x] 建立前后端共享阶段协议、公开病例目录和 Worker 私有病例库。
  - [x] 建立虚拟患者 / 临床导师 / 科研导师 / 反思阶段的独立提示词生成器。
  - [x] Session system context 已改为按病例阶段动态生成，不再注入家庭助手 persona / memory / knowledge 指令。
  - [x] 通用 Weather/Calculator/Browser/Workspace tool surface 已从医学 Agent 的自定义工具中移除。
  - [x] 新增 Europe PMC `search_medical_evidence` 作为科研导师的真实文献检索工具。
  - [x] `beforeTurn` 已按服务端阶段强制角色与 activeTools，并关闭学生端 reasoning。
  - [x] 用户消息、工具调用和工具结果开始写入结构化研究事件日志。
  - [x] 子 Agent SQLite 已增加 `study_state` / `study_events`，状态与研究事件独立于自然语言消息保存。
  - [x] 增加严格 RPC：提交初判 → 循证 → 反思 → 最终提交；越级调用会被服务端拒绝。
  - [x] 增加单训练 JSON 导出 RPC，为后续教师端批量导出打基础。
  - [x] 助手回复也写入研究事件；usage 账本按锁定实验模型计价。
  - [x] 兼容 `updateConfig` RPC 但忽略学生传入值，服务端模型锁定不可绕过。
  - [x] 目录层已把每个聊天改成病例训练，持久化 `caseId + stage` 并同步子 Agent 阶段。
- 正在做：
  - [ ] `MyAssistant` 训练状态、研究日志与阶段推进 RPC。
- 下一步：
  - [ ] 改造 `MyAssistant` 与前端病例流程。
  - [ ] 本地测试后部署独立医学 Demo。

## 关键决策与理由
- 决策A：第一版继续使用 Think，不切换 OpenAI Agents SDK。（原因：现有会话、SQLite、工具循环和前端链路都已稳定，换底座与教学 Demo 无关。）
- 决策B：学生端不开放模型选择。（原因：正式实验需要控制底层模型，避免模型差异成为混杂因素。）
- 决策C：第一版先用单 Think 会话 + 明确阶段角色，而不是让模型自由 handoff。（原因：教学实验需要可重复、可审计的干预路径；后续再把角色升级为真正子 Agent。）
- 决策D：研究日志优先于通用功能。（原因：司老师明确要求开放给学生并收集数据写论文。）

## 常见坑 / 复现方法
- 坑1：不要把旧大创标书里计划的 80 人 / 8 周实验写成已经实施过的事实。
- 坑2：不要把 Family AI 的模型选择、费用面板、MCP、Workspace 等产品功能原样暴露给实验学生。
- 坑3：虚拟患者不能在问诊阶段直接说出标准诊断，否则病例训练失效。
