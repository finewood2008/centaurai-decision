# 超级参谋团 ↔ 团队版 跨机器 A2A 通讯（F-A2A）

> **状态：📋 计划中（控制平面，后续可选）。本文档为设计与实施计划，尚未实现。**
>
> **定位（2026-06 更新）**：本文档是**控制平面**——实时提问、主动汇报、双向推送等 agent 对话能力。
> 产品方决定先做**数据平面 v1**（两端共享同一个共享盘，见姊妹文档
> [shared-drive-access.md](shared-drive-access.md)），本文档的实时能力推迟到"真的需要老板即时追问"时再做。
> 两套方案共用同一套 mDNS 发现与 token 鉴权底子，不冲突。
>
> 本文档定义超级参谋团（老板机）与团队版（团队服务器）在同一局域网内的 agent-to-agent 通讯能力：
> 超级参谋团能拉取团队版的日常工作汇报；团队版能主动向决策者发起汇报。双方均为 agent，通讯是真·A2A 对话。
> 设计方向已与产品方确认（见 §3 已锁定决策）。

---

## 1. 背景与目标

### 1.1 用户故事

- **作为老板（超级参谋团）**，我希望随时问一句「看看销售部这周进展」，系统就去团队那边把信息聚合回来，落到我的「最新情报」里。
- **作为员工 / 团队负责人（团队版）**，我希望能主动把一份日报 / 阶段汇报推送给老板，也希望系统能每天定时自动汇报。
- 双方背后都是 agent：决策侧的「情报官」对团队侧的「对外联络」agent 发起对话，而不是冷冰冰的数据同步。

### 1.2 目标

1. 超级参谋团按需向团队版发起**实时提问**（query），团队版聚合后应答（report）。
2. 团队版**定时自动**产出并推送日报，以及员工**手动发起**汇报。
3. 全程在局域网内完成，零公网依赖；老板机保持回环、不对外开端口。
4. 最大化复用现有基建（mDNS、Remote Agent 连接机制、cron、共享盘）。

### 1.3 非目标（本期不做）

- 跨公网 / 跨局域网的通讯（仅同一 LAN）。
- 与外部第三方 A2A agent 互通（见 §9 待定项，可能后续升级为标准协议）。
- 多个超级参谋团之间、或团队版之间的横向通讯（仅 1 决策 ↔ N 团队服务器，典型为 1↔1）。
- 修改 Rust 后端 aioncore（设计目标为纯 TS 层实现，见 §5.1）。

---

## 2. 术语

| 术语                 | 含义                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **A2A**              | Agent-to-Agent，本文档指决策侧 agent 与团队侧 agent 之间的跨机器对话。本期采用**轻量自定义信封**，非 Google A2A 标准协议。 |
| **情报官 agent**     | 决策侧专职 agent，代表老板发起 query、接收 report、落地到 intel 板块。                                                     |
| **对外联络 agent**   | 团队侧专职 agent，对内向本团队 agents/工作台聚合信息，对外应答 query、主动推 report。                                      |
| **A2A 信道**         | 团队服务器上一个专用的、经设备配对鉴权的 WebSocket（区别于员工浏览器走的密码 cookie 信道）。                               |
| **信封（envelope）** | A2A 报文的统一外层结构（id/ts/from/sig/type/payload），见 §6.3。                                                           |

---

## 3. 已锁定的设计决策

与产品方讨论后确认（2026-06）：

| #   | 决策点       | 选定方案                                | 理由                                                                            |
| --- | ------------ | --------------------------------------- | ------------------------------------------------------------------------------- |
| D1  | **连接拓扑** | **团队做服务器，决策拨出，单条双向 WS** | 决策机保持回环、不开放任何 LAN 端口，最安全；复用现有 Remote Agent 拨出连接机制 |
| D2  | **汇报形态** | **实时对话 + 定时日报 都要**            | 覆盖「老板随时问」与「团队主动 / 自动汇报」两类场景                             |
| D3  | **协议规格** | **轻量自定义信封**                      | 贴合现有 Ed25519 / Remote Agent 机制，落地最快；后续可平滑升级为标准 A2A        |

推荐默认（路上可再敲定，见 §9）：

| #   | 待定项     | 推荐默认                                                     |
| --- | ---------- | ------------------------------------------------------------ |
| D4  | 报告持久化 | 先 `localStorage`，P3 视需要升 SQLite                        |
| D5  | 配对审批   | 团队服务器端**人工批准一次**新设备接入                       |
| D6  | 代码归属   | 放 `centaurai-station` 核心，用 `IS_DECISION`/`IS_TEAM` 门控 |

---

## 4. 现状盘点

### 4.1 可复用基建

| 基建                                                                               | 位置                                                                                                                                      | 复用方式                                                                       |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **mDNS 局域网发现** `_centaurai._tcp`，`advertiseServer()` / `discoverServers()`   | `packages/desktop/src/process/discovery/lanDiscovery.ts`                                                                                  | 决策机自动发现团队服务器，免手填 IP                                            |
| **团队版 LAN 服务器**，绑 `0.0.0.0:25808`（dev 25809），反向代理到 aioncore        | `packages/web-host/src/static-server.ts`、`packages/desktop/src/process/utils/webuiConfig.ts`                                             | 团队天然是「对外服务的一方」；A2A 端点挂在这个服务器上                         |
| **WebUI 鉴权门**（HMAC cookie `webui_gate`，密码登录）                             | `packages/web-host/src/webui-auth-gate.ts`                                                                                                | A2A 信道复用「服务器有鉴权门」的模式，但换用设备 token + 签名（非密码 cookie） |
| **Remote Agent 协议**：WS + Ed25519 签名 + 配对 + 设备 token + 指数退避重连 + 心跳 | `OpenClawGatewayConnection`、`remoteAgentBridge.ts`、`RemoteAgentCore`/`RemoteAgentManager`、`remoteAgentTypes.ts`，DB `remote_agents` 表 | **配对 / 签名 / 持久连接 / 重连的轮子已造好**，直接改造为 A2A 客户端           |
| **Cron 定时任务**（能让 agent 定时产「日报 / 巡检 / 汇总」）                       | `packages/desktop/src/renderer/pages/cron/`，`/api/cron/jobs`（`ipcBridge.ts` cron 段），`ICronJob`                                       | 「定时自动日报」直接挂 cron 触发对外联络 agent                                 |
| **共享盘 / NAS API**（list/upload/download/preview）                               | `static-server.ts` 的 `/api/shared-drive/*`、`/api/nas/*`                                                                                 | 大附件落共享盘，信封只带引用                                                   |
| **超级参谋团 intel 板块**（UI 占位 + i18n 已就位，目前 `<Empty>`）                 | `packages/desktop/src/renderer/pages/decision/DecisionHome.tsx`（intel 段）、`locales/*/decision.json` 的 `intel.*`                       | 替换 `<Empty>` 为真实收件箱                                                    |
| **edition 标志**                                                                   | `packages/desktop/src/common/config/constants.ts`                                                                                         | `IS_DECISION`/`IS_TEAM` 门控两侧代码                                           |

### 4.2 缺口（本期要补）

1. **跨机信道**：aioncore 仅绑 `127.0.0.1`，两机后端互不可见 —— 最核心缺口。
2. **机器间互信**：现有只有「浏览器密码门」，没有「机器↔机器」服务级 token / 签名。
3. **A2A 报文 / 会话语义**：现有 agent 间通讯都在单机内由 aioncore 中介（团队会议室那套），无跨机信封。
4. **汇报数据模型 + 决策落地**：无 `ITeamReport` 类型，intel 板块未接数据。

---

## 5. 总体架构

```
       决策机 (超级参谋团 · 回环)                团队服务器 (团队版 · 0.0.0.0)
   ┌─────────────────────────┐          ┌───────────────────────────┐
   │  情报官 agent            │          │  对外联络 agent(聚合本团队)│
   │      ▲ IPC               │          │      ▲ IPC                │
   │  ┌───┴────┐   拨出        │ 单条     │  ┌───┴────┐               │
   │  │aioncore│════════════════双向 WS══│►│web-host │◄── 员工浏览器  │
   │  │(回环)  │   Ed25519配对 │         │  │0.0.0.0  │   (现有多用户) │
   │  └────────┘              │          │  └───┬────┘               │
   │   intel 收件箱 ◄─推送─────┼─────────┤  ┌───┴────┐               │
   └─────────────────────────┘          │  │aioncore │               │
         └──── mDNS 互相发现 ────────────┤  └────────┘               │
                                          └───────────────────────────┘

   决策→团队(拉):情报官 → query → WS → 联络agent 聚合本团队 → report 沿 WS 回传
   团队→决策(推):cron/手动「发起汇报」→ 联络agent 产 report → 沿 WS 上推 → intel 板块
```

### 5.1 关键架构判断：纯 TS 层实现，不碰 aioncore

整条 A2A 链路落在 Electron / TS 层：

- **团队侧**：`web-host` 增加 A2A WebSocket 路由；主进程持有 A2A server 逻辑，桥接到本地回环 aioncore。
- **决策侧**：主进程持有 A2A client 连接（改造 `OpenClawGatewayConnection`），桥接到本地回环 aioncore。
- 「对外联络 agent」「情报官 agent」都是**普通的 aioncore 会话**，由 TS 层用现有 `conversation.sendMessage` 等驱动。

这样可避免重新编译 Rust 后端。**P0 的首要任务就是验证这个假设成立**（aioncore 的 HTTP/WS API 足够从 TS 层驱动一个专职会话并取回结果）。若验证失败，再评估是否需要 aioncore 改动。

---

## 6. 详细设计

### 6.1 服务发现与配对

**发现**：复用 `lanDiscovery.ts`。团队服务器已通过 `advertiseServer()` 广播 `_centaurai._tcp`（TXT 含 `ver/os/lanIP/share`）。
扩展 TXT 增加：`a2a=1`（声明支持 A2A）、`a2aPort`（若与 webui 不同端口）。决策机用 `discoverServers()` 列出候选团队服务器。

**配对（一次性，参考 Remote Agent 握手 F-RAGENT-06/07）**：

1. 决策机生成 Ed25519 密钥对（`deviceId` = 公钥指纹），向团队服务器发起 `pair.request`（带公钥、设备名）。
2. 团队服务器（D5：人工批准）弹出「新设备请求接入：半人马AI-超级参谋团 · {hostname}」，管理员点「批准」。
3. 团队签发设备 token（写入团队侧 DB），回传决策机持久化。
4. 此后决策机每次连接用 Ed25519 私钥对挑战 nonce 签名（v2 格式），团队验签放行。

> 直接复用现有 `remote_agents` 表结构与签名工具（`v2|deviceId|clientId|...|nonce` 管道分隔串）。

### 6.2 A2A 信道

**端点**：团队 `web-host` 新增 `/a2a/ws`（或在现有 `/ws` 上按鉴权类型分流）。该端点：

- 不接受 `webui_gate` 密码 cookie；只接受配对设备的签名鉴权。
- 升级为 WebSocket 后，承载双向信封流。

**连接**：决策机改造 `OpenClawGatewayConnection` → `A2AClientConnection`，拨向 `wss://{teamIp}:25808/a2a/ws`：

- 复用其指数退避重连（1s→30s，最多 10 次）、心跳 tick 监控、`closed` flag 互锁。
- 连接建立后双向通信：决策可发 query，团队可在同一 socket 反向推 report。

**鉴权信任边界**：A2A 信道授予的能力**仅限 A2A 信封类型**（query/report/ack），不等同于完整 `/api/*` 访问权限。团队侧需校验信封 type 白名单，拒绝越权。

### 6.3 报文协议（信封）

```ts
// 拟放 packages/desktop/src/common/types/a2a/a2aTypes.ts（待实现）
type A2AEnvelope = {
  id: string; // UUID，用于 ack / 关联
  ts: number; // 发送时间戳
  from: { edition: 'decision' | 'team'; deviceId: string };
  sig: string; // Ed25519 签名（覆盖 id|ts|from|type|payload 摘要）
  type: 'query' | 'report' | 'ack' | 'error';
  payload: A2AQuery | A2AReport | A2AAck | A2AError;
};

type A2AQuery = {
  topic: string; // 老板的问题，如「销售部本周进展」
  scope?: string; // 可选：限定部门 / 项目 / 时间范围
  replyTo: string; // 期望应答关联到哪个 query id
};

type A2AReport = {
  inReplyTo?: string; // 若为应答，关联的 query id；为空则是主动推送
  title: string;
  summary: string; // 一句话摘要，用于 intel 列表
  body: string; // 完整正文（markdown）
  period?: { from: number; to: number }; // 日报覆盖时段
  attachments?: SharedDriveRef[]; // 大附件引用（不内联字节）
};

type SharedDriveRef = { path: string; name: string; size: number; mime?: string };
type A2AAck = { ackOf: string };
type A2AError = { ofId?: string; code: string; message: string };
```

约束：信封 payload 上限沿用现有 WS `maxPayload`（25MB）；超限内容必须走共享盘。

### 6.4 团队侧：对外联络 agent

- 是团队服务器上一个长驻的 aioncore 会话（专用 conversation，`extra` 标注 `role: 'a2a-liaison'`）。
- **收到 query**：把 `topic`/`scope` 作为提示，向本团队相关 agents / 工作台 / 共享盘聚合信息（可直接调用现有团队会议室编排 `useMeetingOrchestrator` 的能力，或简化为单 agent 检索）→ 产出 → 封装 `report`（`inReplyTo` = query.id）沿 WS 回传。
- **主动推送**：cron 触发（§6.6）或员工点「发起汇报」按钮 → 产出日报 → 封装 `report`（无 `inReplyTo`）上推。
- 失败时回 `error` 信封。

### 6.5 决策侧：情报官 agent + intel 收件箱

- **情报官**：老板在决策首页 / 会议室提问 → 情报官组装 `query` 经 A2A client 发出 → 等 `report` → 写入 intel 收件箱并提示。
- **intel 收件箱**：`DecisionHome.tsx` 的 intel 段从 `<Empty>` 改为：
  - 列表：每条 report 显示 `title` + `summary` + 时间 + 来源（团队名）+ 已读/未读。
  - 详情：点开渲染 `body`（markdown），附件可下载（走共享盘）。
  - 主动推送的 report 触发未读红点 / 通知。
- 新增 IPC（`ipcBridge.ts`）：`a2a.listReports`、`a2a.getReport`、`a2a.sendQuery`、`a2a.onReportReceived`（WS emitter）、`a2a.markRead`。

### 6.6 定时日报（cron 集成）

- 复用 cron：在团队服务器为「对外联络 agent」的 conversation 建一条 `ICronJob`（如每工作日 18:00），`target.payload` 为「生成今日团队日报并推送给超级参谋团」。
- cron 触发 → 联络 agent 产出 → §6.4 主动推送路径。
- 决策侧无需配置；团队侧在设置中可开关 / 调频率。

### 6.7 大附件（共享盘）

- report 的大附件（截图、报表、归档 md）先 upload 到团队共享盘（`/api/shared-drive/upload`），信封 `attachments` 仅带 `SharedDriveRef`。
- 决策侧按需 download / preview（`/api/shared-drive/download|preview`）。
- 团队会议室产出的方案书（`{topic}_方案书.md`，见 `useMeetingOrchestrator` 的 `archivePlan`）天然可作为附件来源。

### 6.8 数据模型与持久化

- **决策侧**：收到的 report 列表（D4：先 `localStorage` key 如 `decision-intel-inbox`，结构含 `ITeamReport[]` + 已读状态；P3 视检索 / 多设备需求升 SQLite）。
- **团队侧**：配对设备复用 `remote_agents` 表；cron 任务复用 cron 存储；已推送 report 的发件记录可选落库。
- 新类型集中在 `packages/desktop/src/common/types/a2a/`。

### 6.9 edition 门控与代码归属（D6）

- 代码放核心仓库，用 `IS_DECISION`/`IS_TEAM` 门控：
  - 超级参谋团编译：A2A **client** + 情报官 + intel 收件箱。
  - 团队版编译：A2A **server**（`/a2a/ws`、配对审批）+ 对外联络 agent + 日报 cron 默认项。
  - full 版编译两侧，便于单机自测（client 连本机 server）。
- 沿现有 fork 同步流程发布到 `centaurai-decision` / `centaurai-team`。

---

## 7. 分期实施计划

每期独立可验证，建议顺序交付。

### P0 — 地基：发现 + 配对 + 双向信道 [待实现]

- 扩展 mDNS TXT（`a2a=1`）；决策机发现团队服务器。
- 团队 `web-host` 加 `/a2a/ws`；决策机 `A2AClientConnection` 拨出。
- Ed25519 配对 + 人工批准 + 设备 token 持久化。
- 互发 `ack`（ping/pong），验证重连 / 心跳。
- **关键验证**：整条链路不改 aioncore（§5.1）。
- **交付**：两机能配对并维持一条经鉴权的持久双向 WS，互通 ack。

### P1 — 单向：团队定时日报 → 决策 intel [待实现]

- 团队侧对外联络 agent（最小版：单 agent 产报告）。
- cron 触发 → 产日报 → `report` 上推。
- 决策 intel 收件箱：列表 + 详情，替换 `<Empty>`。
- **交付**：第一条可见价值链 —— 老板能在「最新情报」看到团队自动日报。

### P2 — 反向：决策实时提问 → 团队聚合应答 [待实现]

- 决策情报官：发起 `query`、等 `report`、落 intel。
- 团队联络 agent 升级：按 query 聚合本团队（接入会议室编排能力）。
- **交付**：真·实时 A2A 对话（老板问，团队答）。

### P3 — 完善 [待实现]

- 团队侧「发起汇报」按钮（员工手动推）。
- 共享盘大附件全链路。
- 决策侧未读红点 / 通知；report 持久化按需升 SQLite。
- 配对管理 UI（解绑 / 重新配对 / 多团队服务器）。
- **交付**：体验闭环。

---

## 8. 安全考量

| #   | 风险                          | 缓解                                                                |
| --- | ----------------------------- | ------------------------------------------------------------------- |
| S1  | 老板机暴露                    | 决策机仅拨出、不开 LAN 端口（D1）                                   |
| S2  | A2A 信道被滥用为完整 API 通道 | 信道授权仅限 A2A 信封类型白名单，团队侧严格校验 type（§6.2）        |
| S3  | 伪造设备接入                  | Ed25519 配对 + 人工批准（D5）+ 每次连接挑战签名                     |
| S4  | 局域网窃听                    | 优先 `wss://`；`allowInsecure` 仅显式开启（沿用 Remote Agent 策略） |
| S5  | 大附件打爆信道                | 25MB payload 上限 + 强制走共享盘引用                                |
| S6  | query 注入 / 越权聚合         | 联络 agent 的聚合范围受 `scope` 与团队侧权限约束                    |

---

## 9. 待定问题（Open Questions）

| #   | 问题                                                                                                    | 现状倾向                                                  |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Q1  | 报告持久化用 localStorage 还是 SQLite                                                                   | 先 localStorage，P3 升级（D4）                            |
| Q2  | 配对是人工批准还是共享密钥自动信任                                                                      | 人工批准一次（D5）                                        |
| Q3  | 是否后续升级为标准 Google A2A 协议（`.well-known/agent` + agent card + JSON-RPC tasks）以与外部生态互通 | 本期不做；信封设计预留升级空间                            |
| Q4  | 拓扑是否需支持 1 决策 ↔ N 团队服务器                                                                    | 设计已兼容（决策持多条 client 连接），P3 配对管理 UI 落地 |
| Q5  | 聚合是否复用会议室编排（多 agent）还是单 agent                                                          | P1 单 agent，P2 接入编排                                  |

---

## 10. 涉及的关键文件

> 以下为预计改动 / 新增点，实施时以实际代码为准。

**复用 / 改造**

- `packages/desktop/src/process/discovery/lanDiscovery.ts` —— mDNS TXT 扩展
- `packages/web-host/src/static-server.ts` —— 新增 `/a2a/ws` 路由
- `packages/web-host/src/webui-auth-gate.ts` —— 参考鉴权门模式
- `OpenClawGatewayConnection` / `remoteAgentBridge.ts` / `RemoteAgentCore` —— 改造为 A2A 客户端
- `packages/desktop/src/common/types/agent/remoteAgentTypes.ts`、DB `remote_agents` —— 配对 / 设备 token
- `packages/desktop/src/renderer/pages/decision/DecisionHome.tsx` —— intel 收件箱
- `packages/desktop/src/renderer/services/i18n/locales/*/decision.json` —— intel 文案
- `packages/desktop/src/renderer/pages/cron/`、`ipcBridge.ts`（cron 段） —— 日报定时
- `static-server.ts` 的 `/api/shared-drive/*` —— 大附件
- `packages/desktop/src/renderer/pages/team/meeting/useMeetingOrchestrator.ts` —— 聚合编排
- `packages/desktop/src/common/config/constants.ts` —— edition 门控

**新增**

- `packages/desktop/src/common/types/a2a/a2aTypes.ts` —— 信封 / 报文类型
- A2A server（团队侧）/ A2A client（决策侧）模块（位置实施时定）
- 对外联络 agent / 情报官 agent 的驱动逻辑
- `ipcBridge.ts` 新增 `a2a.*` 接口
- intel 收件箱组件 + 配对管理 UI

---

## 11. 验收标准（总）

- [ ] 决策机经 mDNS 发现团队服务器，完成一次性 Ed25519 配对（人工批准），持久化设备 token。
- [ ] 两机维持一条经鉴权的双向 WebSocket，支持自动重连与心跳。
- [ ] 决策机不监听任何 LAN 端口（仅回环 + 拨出）。
- [ ] 团队版 cron 定时产出日报并推送，超级参谋团「最新情报」实时显示（替换 `<Empty>`）。
- [ ] 超级参谋团可发起实时提问，团队版聚合本团队后应答，结果落 intel。
- [ ] 团队版「发起汇报」按钮可手动推送。
- [ ] 大附件经共享盘传递，信封仅带引用，不超 payload 上限。
- [ ] A2A 信道仅放行信封白名单类型，不等同完整 API 访问。
- [ ] 全程不改 aioncore（若 P0 证伪，记录实际方案）。
- [ ] 代码以 `IS_DECISION`/`IS_TEAM` 门控，full 版可单机自测。
