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
  - [x] 完成病例后显示最小“临床推理轨迹”卡片，对照学生初判/终判、信心变化、循证影响与反思；聊天菜单支持直接导出单病例结构化研究 JSON。
  - [x] 完成阶段与前四阶段统一走同一条隐藏 handoff 会话链，不另建总结 Agent；完成页将同一会话的最终 AI 回复渲染为学习结算，并与结构化推理轨迹并列展示。
  - [x] 反思阶段增加认知偏差复盘字段；完成阶段固定要求推理轨迹、Evidence Ledger、认知偏差复盘、四维 AI 形成性评价和下一步建议，并明确不替代正式教师评分。
  - [x] 完成页增加程序化 Evidence Ledger（直接读取真实 Europe PMC 工具结果）与手动“重新生成总结”。取消会撤掉已生成内容的自动 repair；第五阶段固定使用第一次 completed handoff 作为视图边界，重生成期间保留旧总结，新总结成功后再替换，旧 completed 记录也可恢复显示。
  - [x] 增加严格 RPC：提交初判 → 循证 → 反思 → 最终提交；越级调用会被服务端拒绝。
  - [x] 增加单训练 JSON 导出 RPC，为后续教师端批量导出打基础。
  - [x] 助手回复也写入研究事件；usage 账本按锁定实验模型计价。
  - [x] 兼容 `updateConfig` RPC 但忽略学生传入值，服务端模型锁定不可绕过。
  - [x] 目录层已把每个聊天改成病例训练，持久化 `caseId + stage` 并同步子 Agent 阶段。
- 正在做：
  - [ ] 医学病例入口与聊天页阶段控制前端。
- 已完成：
  - [x] 增加病例选择首页（只读取公开病例元数据）。
  - [x] 增加阶段进度条、初步判断结构化表单和最终反思结构化表单。
  - [x] 应用入口从“新聊天”改为“新病例训练”，侧栏展示病例训练阶段。
  - [x] 新增医学专用 ChatShell / Composer，复用 AI Elements 但隐藏模型选择、附件、费用、重生成和消息编辑。
  - [x] 结构化提交会先由服务端推进阶段，再作为可读消息送入对应角色，保证真正由正确角色回复。
  - [x] 主应用已切换到医学专用 ChatShell，旧 Family AI ChatShell 只保留作代码参考，不再进入学生流程。
  - [x] 新增纯后端阶段机测试：初始状态、越级阻止、初判不可覆盖、完整阶段推进和研究事件导出。
  - [x] 项目包名与 Worker 名称已独立为 `medical-edu-agent-v0` / `medical-edu-agent-demo`，不会覆盖 Family AI。
  - [x] 登录页和测试账号文案改为医学教学参与者语义。
  - [x] 结合大创/国自然历史材料与当前系统状态，形成 2026-09-06 给司老师的阶段进展与实验方案草案，明确“临床推理过程轨迹”、评分和两组实验的初步设计。
  - [x] 在详细底稿基础上另整理一版面向司老师的精简汇报稿，保留项目承接、当前进展、推理轨迹和实验设计，弱化标书/论文腔。
- 下一步：
  - [x] 改造 `MyAssistant` 与前端病例流程。
  - [x] 清理 README / 环境模板 / Cookie / Worker 身份，去除 Family AI showcase 语义。
  - [x] 改造部署 smoke，只验证医学 Demo 锁定的 DeepSeek V4 Flash 与真实 UIMessageStream framing。
  - [x] 移除医学 Demo 已不使用的远程 Browser binding，避免本地 Vite 强制创建 Cloudflare remote preview session。
  - [x] 浏览器真实问诊与临床导师阶段已跑通；修复阶段推进后结构化 Dialog 仍可见的问题。
  - [x] 修复 AI Elements `MessageAction` 的 TooltipTrigger 嵌套 button React 警告。
  - [x] 完整病例闭环已用真实 DeepSeek + Europe PMC 跑到 completed，并验证刷新后状态、聊天和工具痕迹持久化恢复。
  - [x] 撤销循证检索次数硬上限；Agent 可自由检索/阅读全文，工具执行层最多 3 个 Europe PMC 并发并带排队、jitter 与 429/5xx 指数退避。
  - [x] Europe PMC 检索升级为 core metadata + abstract，并增加 OA `fullTextXML` 分页全文阅读工具。
  - [x] 定位 Base UI Dialog 关闭后 Portal 偶发不卸载：closed Popup 已带 `data-closed`，但退出动画未结束；为 Popup/Backdrop 增加 `data-closed:hidden` 语义兜底，避免旧表单遮挡后续阶段。
  - [x] 长对话滚动层修复：在 `StickToBottom.Content` 的真实 scrollRef 上显式启用 `overflow-y-auto`。
  - [x] 首 token 延迟期间接入 AI Elements `Shimmer`，按当前角色显示“正在思考/分析”，避免 DeepSeek thinking 阶段页面空白。
  - [x] 从“大二下笔记”恢复 3 个真实 PBL 纵向病例 × 3 幕，共 9 个公开训练单元；Graves 临时病例退为内部 smoke fixture。
  - [x] 本地真实 Provider + 浏览器端到端验收。
  - [x] 建立远程仓库并部署独立医学 Demo；Custom Domain 为 `https://mededu.zjhstudio.com`。

## 关键决策与理由
- 决策A：第一版继续使用 Think，不切换 OpenAI Agents SDK。（原因：现有会话、SQLite、工具循环和前端链路都已稳定，换底座与教学 Demo 无关。）
- 决策B：学生端不开放模型选择。（原因：正式实验需要控制底层模型，避免模型差异成为混杂因素。）
- 决策C：第一版先用单 Think 会话 + 明确阶段角色，而不是让模型自由 handoff。（原因：教学实验需要可重复、可审计的干预路径；后续再把角色升级为真正子 Agent。）
- 决策D：研究日志优先于通用功能。（原因：司老师明确要求开放给学生并收集数据写论文。）

## 常见坑 / 复现方法
- 坑1：不要把旧大创标书里计划的 80 人 / 8 周实验写成已经实施过的事实。
- 坑2：不要把 Family AI 的模型选择、费用面板、MCP、Workspace 等产品功能原样暴露给实验学生。
- 坑3：虚拟患者不能在问诊阶段直接说出标准诊断，否则病例训练失效。
