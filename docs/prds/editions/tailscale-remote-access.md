# 超级参谋团 Tailscale 远程访问（F-TSREMOTE）

> **状态：📋 计划中，目标排期下个版本。本文档为设计与实施计划，尚未实现。**
>
> 让超级参谋团（单用户老板机）的私人 AI 服务能从**任何地方**安全访问：通过用户自己的 Tailscale
> tailnet（基于 WireGuard 的私有 mesh VPN），而**不把任何端口暴露到公网或局域网 0.0.0.0**。
> 设计方向已与产品方确认（见 §2 已锁定决策）。

---

## 1. 背景与目标

### 1.1 用户故事

- **作为老板**，我希望出差/在家也能用手机或笔记本访问我办公室那台超级参谋团 AI 服务器，像在本机一样，但不想把它开到公网被人扫。

### 1.2 目标

1. 超级参谋团的 WebUI 能经 Tailscale tailnet 被**远程私有访问**（HTTPS）。
2. 超级参谋团**仍绑回环 `127.0.0.1`**，不暴露 0.0.0.0、不碰 aioncore——网络暴露完全交给 Tailscale 外部进程。
3. 双层鉴权：tailnet 成员身份 + app 密码门。
4. 仅 tailnet 私有（`tailscale serve`），**默认禁用公网 funnel**。

### 1.3 非目标（本期不做）

- app 内嵌 tailnet（tsnet/Go sidecar）——留作未来"一键"升级路径（见 §6 方案 B）。
- 公网 funnel 暴露（高危，当前缺速率限制/防暴破）。
- 团队版的远程访问（团队版本就是 LAN 服务器，另说）。

---

## 2. 已锁定的设计决策

与产品方讨论后确认（2026-06）：

| #   | 决策点   | 选定方案                                                                        | 理由                                                    |
| --- | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- |
| T1  | 集成深度 | **用户自装系统 Tailscale + app 引导/检测，用 `tailscale serve` 反代回环 WebUI** | 超级参谋团几乎不改、不碰 aioncore、自动 TLS；工作量 S–M |
| T2  | 远程鉴权 | **tailnet 成员身份 + app 密码门（双层）**                                       | 堵住回环 web-host 无鉴权的洞（见 §4）；复用现有密码门   |
| T3  | 暴露范围 | **仅 tailnet 私有（serve），默认禁用 funnel**                                   | 私人 AI 服务器的安全默认                                |

---

## 3. 现状盘点（代码坐实）

| 事实                                                         | 证据                                                                                                                                                   | 含义                                                                              |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| 超级参谋团能跑 web-host，但默认 `enabled=false` 且 UI 无开关 | `webuiConfig.ts:472-501`（`if (!enabled) return` @484）；`SettingsModal/index.tsx:209-220`（webui/users 标签受 `MULTI_USER_ENABLED` 门控）             | 需要一个 decision-only 的受控开启入口                                             |
| 超级参谋团 `allowRemote` 恒 false                            | `constants.ts:98`（`MULTI_USER_ENABLED = EDITION!=='decision'`）；`webuiConfig.ts:328`（`allowRemote = MULTI_USER_ENABLED && opts.allowRemote`）       | web-host 绑 `127.0.0.1`（`static-server.ts:588-589,916`），符合预期，**保持不动** |
| 后端 aioncore 也只绑回环                                     | `backend-launcher.ts:255`（`listen(port,'127.0.0.1')`）                                                                                                | 隧道只反代 web-host，**绝不直接 serve 后端端口**                                  |
| **回环 web-host 无鉴权门**                                   | `static-server.ts:595`（`requireAuth = allowRemote`）；`webui-auth-gate.ts:7-11`（`--local` 后端注入 synthetic system_default_user 不校验 JWT）        | **安全洞**：谁连到 `127.0.0.1:25808` = 以老板身份登录。见 §4                      |
| 现有鉴权门可复用                                             | `webui-auth-gate.ts`（bcrypt `/login` + HMAC `webui_gate` cookie / `x-webui-gate-token` 头）；`static-server.ts:596,627`（createAuthGate/enforceGate） | 补鉴权门无需新依赖                                                                |
| 全栈纯 HTTP，无 TLS                                          | `webui-auth-gate.ts`（`AIONUI_HTTPS` 仅改 cookie 属性，不实现 TLS）                                                                                    | Tailscale serve 自动签发 `*.ts.net` 证书，顺带解决                                |

---

## 4. ⚠️ 安全前提（动手第一步，必做）

**回环 web-host 当前没有鉴权门**（`static-server.ts:595` `requireAuth = allowRemote`，超级参谋团 allowRemote 恒 false → requireAuth=false）。本机使用无妨，但**一旦用 `tailscale serve` 把它暴露给 tailnet，tailnet 内任意设备（含被 share 进来的、被攻陷的）都能无密码全权操作老板的 AI**。

因此"加远程访问"的**前置必做项**：解耦鉴权门，让回环 web-host 在隧道模式下也挂上 auth gate。

```ts
// static-server.ts:595 改：
- const requireAuth = allowRemote;
+ const requireAuth = allowRemote || opts.requireAuthOnLoopback === true;
```

超级参谋团隧道场景传 `requireAuthOnLoopback: true`，复用现成的 `createAuthGate`/`enforceGate` 与 bcrypt `/login`。超级参谋团关掉了 MULTI_USER、只有一行 `system_default_user`，因此需给它**设一个远程访问 PIN/密码**（bcrypt），作为最小密码层。

---

## 5. 总体架构

```
   远程设备(手机/笔记本)                            老板机 (超级参谋团)
  ┌────────────────────┐                       ┌─────────────────────────────┐
  │  浏览器             │   Tailscale tailnet    │  系统 Tailscale daemon        │
  │  https://boss.      │  (WireGuard 加密 mesh) │   tailscale serve https /     │
  │   <tailnet>.ts.net ─┼═══════════════════════│►   → http://127.0.0.1:25808   │
  │  (自动 TLS)         │   仅 tailnet 成员可达   │  ┌──────────┐                 │
  └────────────────────┘                       │  │ web-host │ 仍绑 127.0.0.1   │
        ▲ 加入同一 tailnet                       │  │ +鉴权门  │ (allowRemote=false)│
        │                                        │  └────┬─────┘                 │
   tailnet 成员身份 = 第一层认证                  │  ┌────┴─────┐                 │
   app 密码门(PIN) = 第二层认证                   │  │ aioncore │ 绑 127.0.0.1     │
                                                 │  └──────────┘                 │
                                                 └─────────────────────────────┘
```

数据流：远程设备加入老板的 tailnet → 访问 `https://<host>.<tailnet>.ts.net` → Tailscale 私有隧道 →
老板机 `tailscale serve` 反代到回环 `127.0.0.1:25808` 的 web-host（带鉴权门）→ aioncore。
超级参谋团自身网络绑定**零改动**，仍是回环。

---

## 6. 集成方案对比（锁定 A）

| 方案                                                                 | 深度                             | 工作量        | 取舍                                                                   |
| -------------------------------------------------------------------- | -------------------------------- | ------------- | ---------------------------------------------------------------------- |
| **A（锁定）** 系统 Tailscale + `tailscale serve` 反代回环 + 补鉴权门 | 网络层零侵入，超级参谋团仍绑回环 | S–M（1–3 天） | 需用户自装/登录 Tailscale；最贴合"仅回环"设计、自动 TLS、不碰 aioncore |
| B（未来升级） app 内嵌 tsnet/libtailscale 一键上 tailnet             | 深度侵入，引 Go sidecar          | L（2–4 周+）  | 纯 app 内体验，但跨语言/三平台打包/维护重，与"精简"原则相悖            |
| C（过渡） 纯文档引导                                                 | 几乎零代码                       | XS            | 体验差、无受支持的开启路径、仍须配合 A 的鉴权改动才安全                |

---

## 7. 分期实施计划

### P0 — 安全前提（必做第一步）[待实现]

- 解耦 `static-server.ts:595` → `requireAuth = allowRemote || opts.requireAuthOnLoopback`（超级参谋团隧道传 true）。
- 透传 `requireAuthOnLoopback` 到 `startDesktopWebUI`（`webuiConfig.ts`），超级参谋团"远程访问"开启时置 true。
- 设远程访问 PIN/密码：给超级参谋团 `system_default_user` 设 bcrypt 密码的入口。
- 校验 `/ws` 在 requireAuth=true 时也走 gate（`static-server.ts` peekWsRoute）。
- **交付**：回环 web-host 在隧道模式下要求登录；本机直连行为不回归（默认仍 requireAuth=false）。

### P1 — 超级参谋团受控启用回环 web-host [待实现]

- decision-only 的「远程访问」设置入口（绕开 `SettingsModal/index.tsx:209` 的 MULTI_USER 门）。
- 开启即写 `webui.desktop.enabled=true`（`webuiConfig.ts:118` 键），`allowRemote` 保持 false、host 仍 `127.0.0.1`（不动 `:328`/`static-server.ts:589`）。
- **交付**：老板可在超级参谋团里"开启远程访问"，回环 web-host 拉起并挂鉴权门。

### P2 — Tailscale 引导 / 检测 [待实现]

- 设置页检测系统 Tailscale（`tailscale status`，child_process），未装则给安装指引。
- 展示并可代执行 `tailscale serve https / http://127.0.0.1:25808`；显示 MagicDNS 访问地址（`<host>.<tailnet>.ts.net`）+ 复制/二维码。
- **明确禁用 funnel**：UI 不提供 funnel 开关，文档红字警告。
- **交付**：老板照引导几步即可从任何加入 tailnet 的设备访问。

### P3 — 完善 [待实现]

- 连接/serve 状态显示、错误处理 UX、断开/关闭远程访问一键。
- 文档建议用 Tailscale ACL 把 `100.x:443` 限制到老板自己的设备。

---

## 8. 安全考量

| #   | 风险                                                     | 缓解                                                         |
| --- | -------------------------------------------------------- | ------------------------------------------------------------ |
| S1  | 回环 web-host 无鉴权 → 隧道暴露后 tailnet 内设备全权访问 | **P0 必做**：解耦 requireAuth + 启用密码门（见 §4）          |
| S2  | funnel 公网暴露                                          | T3 默认禁用，UI 不提供，仅 tailnet serve                     |
| S3  | tailnet 成员 ≠ 单用户（多设备/共享成员共享同一 AI）      | 叠加 app 密码门；文档建议 Tailscale ACL 限定到老板设备       |
| S4  | 直接 serve 后端端口会绕过鉴权门                          | 隧道**只**反代 web-host（25808），绝不反代 aioncore 回环端口 |
| S5  | 无速率限制/防暴破（全栈缺失）                            | 仅 tailnet（非公网）已大幅降风险；若将来开 funnel 必须先补   |
| S6  | HMAC session 是 per-process 临时密钥，重启失效           | 超级参谋团可接受；隧道场景确认重启后重新登录的体验           |

---

## 9. 待定问题（Open Questions）

| #   | 问题                                                        | 现状倾向                                   |
| --- | ----------------------------------------------------------- | ------------------------------------------ |
| Q1  | 超级参谋团加"远程访问"入口是否与"单用户老板机"定位冲突      | 产品已要此功能，加 decision-only 受控入口  |
| Q2  | 远程 PIN 是复用 system_default_user 的 bcrypt，还是单独存   | 倾向复用 `/login` bcrypt（最省，无新依赖） |
| Q3  | app 是否代执行 `tailscale serve`（child_process）还是纯引导 | P2 先检测 + 一键执行，失败回退文档         |
| Q4  | 是否需要 per-device 会话隔离                                | 本期接受"共享老板上下文"，叠密码门 + ACL   |
| Q5  | 将来是否做方案 B（app 内嵌 tsnet）去掉"自装 Tailscale"      | 留作升级路径，本期不做                     |

---

## 10. 涉及的关键文件

**改造**

- `packages/web-host/src/static-server.ts:595` —— 解耦 `requireAuth`（核心安全改动）；`:588-589,916` host 绑定保持不动；`:596,627` 复用 gate
- `packages/web-host/src/webui-auth-gate.ts` —— 复用 bcrypt `/login` + HMAC token（不改协议）
- `packages/desktop/src/process/utils/webuiConfig.ts:328`（allowRemote 不动）、`:472-501,484`（enabled 门）、`:118`（enabled 键）—— 透传 `requireAuthOnLoopback`、超级参谋团受控 enable
- `packages/desktop/src/renderer/components/settings/SettingsModal/index.tsx:209-220` —— decision-only「远程访问」入口（绕开 MULTI_USER 门）
- `packages/desktop/src/index.ts:1025` —— restoreDesktopWebUIFromPreferences 路径
- `packages/desktop/src/common/config/constants.ts:98` —— edition 门控参考（MULTI_USER_ENABLED 不改）

**新增**

- 超级参谋团「远程访问」设置页：Tailscale 检测（`tailscale status`）、`tailscale serve` 引导/代执行、MagicDNS 地址展示、远程 PIN 设置、funnel 明确禁用
- `requireAuthOnLoopback` 选项贯穿 web-host 启动链

**不碰**

- aioncore（Rust 后端，仍绑回环）；`allowRemote`/host 绑定逻辑；团队版

---

## 11. 验收标准

- [ ] 超级参谋团仍绑 `127.0.0.1`，不监听任何 0.0.0.0 端口；aioncore 仍绑回环。
- [ ] 开启"远程访问"后，回环 web-host 拉起并**要求登录**（密码门生效）；未开启时本机行为无回归。
- [ ] 远程设备加入同一 tailnet 后，经 `https://<host>.<tailnet>.ts.net` 可访问（自动 TLS）。
- [ ] 未加入 tailnet 的设备无法访问（tailnet 成员身份是第一层认证）。
- [ ] 已加入 tailnet 但无 PIN 的设备仍被密码门挡住（双层认证）。
- [ ] funnel 公网暴露在 UI 不可达；文档明确禁用。
- [ ] 设置页能检测系统 Tailscale 安装/登录状态并给出引导。
- [ ] 全程不改 aioncore；隧道只反代 web-host，不反代后端端口。
- [ ] 代码以 `IS_DECISION` 门控；full 版可自测。
