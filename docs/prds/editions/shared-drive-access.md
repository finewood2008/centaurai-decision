# 决策版访问团队版共享盘（F-SHARE）

> **状态：📋 计划中，目标排期下个版本。本文档为设计与实施计划，尚未实现。**
>
> 本文档定义**数据平面 v1**：把团队版（团队服务器）当作共享盘服务器，让决策版（另一台机器）
> 通过局域网访问**同一个共享盘**，实现跨机器数据共享。
>
> **本期范围**：仅「两台机器看到同一个共享盘」。**汇报 / intel 收件箱 / 联络 agent 等功能本期不做**
> （产品方决定 2026-06：「目前先不做汇报功能，先让团队版跟决策版都能看到同个共享盘」）。
> 实时提问、主动汇报等控制平面能力见姊妹文档 [inter-edition-a2a.md](inter-edition-a2a.md)（后续可选）。

---

## 1. 背景与目标

### 1.1 用户故事

- **作为老板（决策版）**，我希望能直接浏览/下载团队那台机器上的共享盘内容，和团队看到的是同一份数据。
- **作为团队（团队版）**，我这台机器本来就是共享盘服务器（员工通过浏览器访问），现在让老板的机器也能接进来看。

### 1.2 目标（本期）

1. 团队版作为共享盘服务器（**已具备**，见 §3）。
2. 决策版作为共享盘**客户端**，经局域网访问团队版的同一个共享盘（浏览 / 下载，视需要上传）。
3. 决策机保持回环、不对外开端口；只是「拨出去」访问团队服务器。
4. 鉴权用**专用服务账号 token（可吊销）**。
5. 最大化复用现有基建——团队服务端**几乎零改动**。

### 1.3 非目标（本期不做）

- 汇报 / 日报 / intel 收件箱 / 对外联络 agent / 情报官 agent（推迟，见 A2A 文档）。
- 实时 agent 对话 / 双向推送（属控制平面，见 A2A 文档）。
- 跨公网访问（仅同一 LAN）。
- OS 层 SMB/NFS 挂载（见 §6.5 备选，本期走应用层 HTTP 客户端）。

---

## 2. 已锁定的设计决策

与产品方讨论后确认（2026-06）：

| #   | 决策点                              | 选定方案                                   | 理由                                                         |
| --- | ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------ |
| N1  | NAS/共享盘方案 vs WS 实时方案的定位 | **NAS 做 v1 主数据层；WS 实时层后续可选**  | 服务端几乎零改动、最快落地；两者共用 mDNS + token 底子       |
| N2  | 决策版访问团队盘的鉴权              | **专用服务账号 token（可吊销）**           | 独立于员工账号，可单独吊销；复用现有 `webui_gate` token 机制 |
| N3  | 本期范围                            | **仅「两端看到同一共享盘」，不做汇报功能** | 先打通数据共享，汇报留到下一步                               |

---

## 3. 现状盘点（关键：服务端已基本就绪）

### 3.1 团队版已是共享盘服务器，且已对局域网可达

| 能力                                    | 位置                                                               | 说明                                                                                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **共享库 `/api/shared-drive/*`**        | `packages/web-host/src/shared-drive.ts`，路由 `static-server.ts`   | 带分类/清单的托管库，存 `~/.aionui[-dev]/sharedDrive/`（manifest.json + blobs/）。端点：list / categories / upload / download / preview / remove                                   |
| **网盘 `/api/nas/*`**                   | `packages/web-host/src/nas-drive.ts`，路由 `static-server.ts`      | 1:1 真实目录树，根目录可配（`AIONUI_NAS_ROOT` 或设置 `webui.desktop.nasRootDir`，「指向企业共享磁盘」）。端点：list / download / preview / upload / mkdir / move / remove + 回收站 |
| **两套都是"本地处理"且经 0.0.0.0 暴露** | `static-server.ts` 路由分流                                        | 团队版绑 `0.0.0.0:25808` 时，这些端点**已对局域网可达**（不是反代 aioncore，是 web-host 直接处理）                                                                                 |
| **鉴权门支持请求头 token**              | `packages/web-host/src/webui-auth-gate.ts`                         | 对外 `/api/*` 走鉴权门，除 `webui_gate` cookie 外**还认 `x-webui-gate-token` 请求头** —— 程序化跨机访问的关键，绕开跨域 cookie                                                     |
| **内容中心 UI**                         | `packages/desktop/src/renderer/pages/contentHub/`（路由 `/files`） | 4 个 Tab：我的产物 / 共享库 / 网盘 / 知识库。当前**无 edition 门控**，决策/团队都可见                                                                                              |

**结论**：团队版当共享盘服务器 ≈ **已具备**。另一台机器现在就能 `GET http://团队IP:25808/api/shared-drive/list`，前提是带有效凭证。

### 3.2 缺口（本期要补，几乎全在决策侧）

1. **远程客户端缺失**：决策侧 `NasService` / `SharedDriveService` 只连本机 `localhost`/IPC，没有"连远程团队服务器"的能力。
2. **远程目标 + 凭证配置缺失**：决策侧没有"连哪台团队服务器、用什么 token"的配置。
3. **专用服务账号 token 机制**：需在团队侧为决策机签发一个可吊销的专用凭证（见 §6.2）。
4. **UI**：决策侧 `/files` 需要一个"团队共享盘"数据源/服务器切换。

---

## 4. 总体架构

```
      决策机 (决策版 · 回环)                  团队服务器 (团队版 · 0.0.0.0:25808)
  ┌──────────────────────────┐          ┌─────────────────────────────┐
  │ 内容中心 /files           │  HTTP    │  web-host 鉴权门             │
  │  └「团队共享盘」源 ───────┼─────────►│   x-webui-gate-token 校验    │
  │     远程 SharedDrive/Nas  │ + token  │   ├ /api/shared-drive/* (就绪)│
  │     Service               │          │   └ /api/nas/*          (就绪)│
  │  (回环本地盘仍照旧)        │          │  共享盘文件 (sharedDrive/    │
  └──────────────────────────┘          │            或 NAS 根目录)     │
      mDNS 发现团队服务器 ◄──────────────┤  服务账号 token (可吊销)      │
                                          └─────────────────────────────┘
```

数据流：决策机经 mDNS 发现团队服务器 → 用服务账号凭证换取 token → 带 `x-webui-gate-token` 头访问
团队的 `/api/shared-drive/*`（和可选 `/api/nas/*`）→ 在决策版 `/files` 里浏览/下载团队的同一份共享盘。

---

## 5. 关键架构判断：纯应用层 HTTP 客户端，不碰 aioncore

- 决策侧只是给 `SharedDriveService` / `NasService` 增加一个"远程 baseUrl + 鉴权头"模式；走的是团队 web-host 已有的 HTTP 端点。
- 团队侧除"签发服务账号 token"外**不需要新端点**。
- 不涉及 Rust 后端 aioncore 改动。

---

## 6. 详细设计

### 6.1 服务发现

复用 `lanDiscovery.ts`：团队服务器已广播 `_centaurai._tcp`（TXT 含 `lanIP`）。决策机用 `discoverServers()`
列出候选团队服务器，供用户在配置时选择。TXT 可加 `share=1` 表明共享盘可用（已有类似字段）。

### 6.2 专用服务账号 token（N2）

- **签发**：团队侧为决策机创建一个**专用账号**（如用户名 `decision-station`，复用现有用户管理 / `remote_agents` 思路），决策机用该凭证 `POST http://团队IP:25808/login` 换取 `webui_gate` token。
- **使用**：决策机持久化 token，之后所有共享盘请求带 `x-webui-gate-token` 头（已有支持，绕开 cookie/跨域）。
- **吊销**：团队侧禁用/删除该账号即失效。
- **持久化**：决策侧存 `{ teamHost, teamPort, serviceToken }`（位置：configService / 设置）。

> ⚠️ **权限范围（重要设计点，见 §8 S1）**：现有 `webui_gate` token 一旦有效即可访问**全部** `/api/*`
> （含反代到 aioncore 的路由），并非仅共享盘。本期若用专用账号，等于给决策机授予了团队后端的完整 API 访问。
> 最小权限（token scope 限定为 drive-only）是**后续增强项**；小团队信任环境下 v1 可接受，但需在文档/设置中标注。

### 6.3 远程共享盘客户端

把决策侧服务泛化为支持远程模式：

- `SharedDriveService`（主，对应 N3 的"共享盘"）：增加 `baseUrl + authHeader` 模式，请求路由到团队
  `/api/shared-drive/list|download|preview|categories`（写入 `upload` 视需要）。
- `NasService`（可选，同机制）：远程 `/api/nas/*`。
- 本机回环盘逻辑保持不变；远程是新增的并列数据源。

### 6.4 决策侧 UI

- 在 `/files`（ContentHubPage）增加一个**「团队共享盘」数据源**（或服务器切换器）：选中后浏览团队的共享库/网盘。
- 首次使用引导："发现团队服务器（mDNS 列表）→ 填服务账号凭证 → 连接"。
- 本期以**浏览 + 下载**为主；上传/写入按需。

### 6.5 备选：OS 层挂载（本期不采用）

也可在 OS 层把团队磁盘以 SMB/NFS 挂载，再把决策版 `nasRootDir` 指向挂载点——**几乎零应用代码**，但需各平台 OS 级网络共享配置、绕开应用鉴权门、IT 负担重、体验割裂。**本期采用应用层 HTTP 客户端方案（§6.3）**，与现有鉴权门和发现机制一致。

### 6.6 edition 门控（D6 沿用）

- 代码放核心仓库，`IS_DECISION`/`IS_TEAM` 门控：
  - 决策版编译：远程共享盘客户端 + 连接配置 UI。
  - 团队版编译：服务账号签发 / 管理（服务端端点已有）。
  - full 版两侧都编，便于单机自测。
- 沿现有 fork 同步流程发布。

---

## 7. 分期实施计划

### P0 — 发现 + 服务账号 + 连接 [待实现]

- 团队侧：创建/管理专用服务账号，签发可吊销凭证。
- 决策侧：mDNS 发现团队服务器；填凭证 → 换 token → 持久化；连通性自检（`/api/shared-drive/categories`）。
- **交付**：决策机能经鉴权连上团队服务器的共享盘 API。

### P1 — 决策版浏览团队共享盘 [待实现]

- 决策侧 `SharedDriveService` 远程模式；`/files` 加「团队共享盘」源。
- 浏览分类 / 文件列表、下载、预览。
- **交付**：两台机器看到**同一个共享盘**（本期主目标达成）。

### P2 — 增强（按需，可选） [待实现]

- 网盘 `/api/nas/*` 远程浏览（同机制）。
- 决策侧上传/写回。
- token scope 最小权限（drive-only）。

> 汇报 / intel / 联络 agent 等不在本计划范围，见 [inter-edition-a2a.md](inter-edition-a2a.md)。

---

## 8. 安全考量

| #   | 风险                                     | 缓解                                                                          |
| --- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| S1  | 服务账号 token 授予完整 `/api/*`（越权） | v1 小团队信任可接受并标注；P2 增加 token scope（drive-only）作最小权限        |
| S2  | 凭证泄露                                 | 专用账号可单独吊销（N2）；token 走 `x-webui-gate-token` 头，不落浏览器 cookie |
| S3  | 局域网窃听                               | LAN HTTP 现状；优先 HTTPS/可信网络；标注风险                                  |
| S4  | 路径穿越                                 | 沿用现有 `resolveWithinRoot` / `isRealContained` 服务端校验（已有）           |
| S5  | 决策机暴露                               | 决策机仅拨出、不开 LAN 端口                                                   |

---

## 9. 待定问题（Open Questions）

| #   | 问题                                                      | 现状倾向                                                  |
| --- | --------------------------------------------------------- | --------------------------------------------------------- |
| Q1  | 本期共享"哪个盘"：共享库(shared-drive) / 网盘(NAS) / 两者 | N3 指向"共享盘"，以**共享库**为主；NAS 同机制可顺带（P2） |
| Q2  | 服务账号是复用 users 表的专用用户，还是新建 token 概念    | 倾向复用 users 表专用账号（最省，吊销=禁用该账号）        |
| Q3  | token scope 最小权限何时做                                | P2；v1 信任环境先全权并标注                               |
| Q4  | 决策侧是否允许写入团队盘                                  | 本期以读为主，写按需（P2）                                |

---

## 10. 涉及的关键文件

**复用 / 改造**

- `packages/desktop/src/process/discovery/lanDiscovery.ts` —— mDNS 发现团队服务器
- `packages/web-host/src/shared-drive.ts` / `nas-drive.ts` —— 服务端端点（已就绪，本期基本不改）
- `packages/web-host/src/webui-auth-gate.ts` —— `x-webui-gate-token` 鉴权（已支持）
- 决策侧 `SharedDriveService` / `NasService`（`packages/desktop/src/renderer/...` 内容中心服务层）—— 增加远程 baseUrl + 鉴权头模式
- `packages/desktop/src/renderer/pages/contentHub/`（ContentHubPage / SharedLibraryPanel / NasPanel）—— 「团队共享盘」数据源
- `packages/desktop/src/common/adapter/ipcBridge.ts`（`sharedDriveLocal` / `nasDriveLocal`）—— 远程模式接口
- 团队侧用户管理 / `remote_agents` —— 服务账号签发与吊销
- `packages/desktop/src/common/config/constants.ts` —— edition 门控
- `locales/*/contentHub.json`、`settings.json` —— 「团队共享盘」文案

**新增**

- 决策侧远程共享盘连接配置（目标 + 服务账号 token 持久化）
- 决策侧 `/files` 「团队共享盘」源 UI + 首次连接引导

---

## 11. 验收标准

- [ ] 决策机经 mDNS 发现团队服务器。
- [ ] 团队侧可签发并吊销专用服务账号凭证。
- [ ] 决策机用服务账号换取 token 并持久化，请求带 `x-webui-gate-token` 头。
- [ ] 决策版 `/files` 出现「团队共享盘」源，可浏览团队共享库的分类与文件。
- [ ] 决策版可下载 / 预览团队共享盘文件（两端看到同一份数据）。
- [ ] 决策机不监听任何 LAN 端口（仅回环 + 拨出）。
- [ ] 全程不改 aioncore；服务端除签发服务账号外无新端点。
- [ ] 代码以 `IS_DECISION`/`IS_TEAM` 门控，full 版可单机自测。
- [ ] 越权风险（S1）在文档/设置中标注；token scope 列为 P2。

```

```
