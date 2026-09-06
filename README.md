# Medical Education Multi-Agent Demo

面向医学生临床推理训练的多智能体教学研究 Demo。

项目从 `family-agent-v0` 的 Cloudflare Think / Agents SDK / AI Elements 技术底座派生，但已经改造成独立研究应用。当前重点不是做一个通用聊天机器人，而是提供一个**可控、可重复、可审计的数据采集型教学干预环境**。

## 当前教学流程

一次病例训练严格按以下阶段推进：

1. **问诊实践**：虚拟患者只回答学生主动询问到的病史、查体和检查信息。
2. **临床反馈**：学生必须先提交第一次临床判断，临床导师随后针对推理过程提供苏格拉底式反馈。
3. **循证拓展**：科研导师把病例中的不确定性转化成检索问题，并可调用 Europe PMC 检索真实医学文献。
4. **反思修订**：学生比较原始判断、临床反馈与循证证据，提交最终判断和反思。
5. **完成**：系统保留完整结构化研究日志，可供教师导出分析。

第一版内置病例：`病例 01：心悸与体重下降`。公开病例信息在 `shared/medical-cases.ts`，标准答案与评分相关的隐藏病例信息只保存在 Worker 端 `agents/medical/cases.ts`，不会进入浏览器 bundle。

## 技术架构

- **Cloudflare Think**：每次病例训练的 Agent harness、消息持久化、tool loop、流式输出。
- **Cloudflare Agents SDK / Durable Objects**：参与者隔离、病例训练子 Agent、SQLite 状态与 RPC。
- **AI SDK**：模型适配和工具协议。
- **AI Elements + shadcn/ui**：学生端聊天、阶段控制与结构化提交 UI。
- **DeepSeek V4 Flash**：Demo 当前锁定的实验模型，学生端不能切换模型。
- **Europe PMC REST API**：循证阶段真实文献检索。

当前 Demo 为了保证实验路径可重复，采用“**单 Think 会话 + 服务端状态机强制角色**”。虚拟患者、临床导师、科研导师的角色由服务器按阶段切换，而不是让模型自由 handoff。后续可把角色执行器升级成真正独立子 Agent，不需要推翻病例状态、日志结构或学生 UI。

## 研究数据

每个病例训练自己的 Durable Object SQLite 中至少保存：

- `study_state`：病例 ID、当前阶段、开始/更新时间、初次判断和最终判断等结构化状态。
- `study_events`：用户消息、Agent 回复、工具调用、文献检索、阶段变化、结构化提交等时间序列事件。
- `usage_ledger`：模型输入、缓存输入、输出、reasoning token 和估算成本。

`MyAssistant.exportStudyData()` 可导出单次训练的结构化 JSON。病例完成后，页面会直接显示“初始判断 → 最终判断”的最小推理轨迹摘要，并提供研究 JSON 下载入口；真正跨学生、跨病例的教师端批量汇总与评分 Dashboard 仍在后续计划中。

## 本地运行

### 1. 安装依赖

```powershell
npm install
```

### 2. 配置本地环境变量

复制 `.env.example` 为 `.env.local`，至少填写：

```dotenv
AUTH_SECRET=请使用足够长的随机字符串
DEEPSEEK_API_KEY=你的 DeepSeek API Key
```

`.env.local` 已被 `.gitignore` 排除，禁止提交真实 Secret。

### 3. 启动

```powershell
npm start
```

默认测试参与者：

| 账号 | 密码 |
|---|---|
| A | AAA |
| B | BBB |
| C | CCC |

这些账号只用于 Demo。正式开放学生前，应改成教师生成的匿名参与者编号，并将身份对应表与研究数据分离保存。

## 测试

```powershell
npm run types
npm test
npm run smoke:providers
```

当前阶段机测试覆盖：初始阶段、禁止越级、第一次判断不可覆盖、完整阶段推进、完成后不可回退、结构化研究事件导出。

## 部署

Worker 名称已经独立为：

```text
medical-edu-agent-demo
```

部署前需要先为该 Worker 配置 `AUTH_SECRET` 和 `DEEPSEEK_API_KEY` Secret，然后：

```powershell
npm run deploy
```

`predeploy` 会先运行单元测试、Wrangler 类型生成和真实实验模型 smoke test，任一失败都会阻止部署。

## 目录

```text
agents/medical/                隐藏病例数据与分阶段角色提示词
agents/assistant/              Directory / 每次病例训练的 Think Agent
shared/medical-cases.ts        学生端可安全公开的病例目录
shared/study.ts                前后端共享的研究阶段与结构化数据协议
src/app/case-start-shell.tsx   病例选择页
src/app/medical-chat-shell.tsx 医学训练主界面
src/app/study-controls.tsx     阶段进度与结构化提交
src/tests/study-flow.test.ts   教学状态机测试
```

## 当前边界

- 目前只有 1 个标准化病例。
- 当前三个角色由后端状态机切换，并非三个独立 DO 子 Agent。
- 教师端批量导出/数据看板尚未完成。
- 正式人体参与者研究前仍需完成研究方案、伦理/知情同意、匿名化和数据管理流程。

项目实施计划见 `PLANS.md`，最新状态见 `PROGRESS.md`。
