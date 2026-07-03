<div align="center">

# 半人马AI-超级参谋团

**半人马AI-超级参谋团 —— 老板的AI超级参谋团，随时召集200+专家顾问开决策会议，多方意见、快速拍板。**

半人马AI-超级参谋团 — CentaurAI's Super Advisory Council: the boss's AI advisory council with 200+ expert advisors for strategic decision-making.

[![License](https://img.shields.io/badge/license-Proprietary%20%2B%20Apache--2.0%20components-32CD32?style=flat-square)](#-license--attribution)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6C757D?style=flat-square)
![Version](https://img.shields.io/badge/latest-v2.5.0-8B5CF6?style=flat-square)

简体中文 · [Official Site](https://www.centaurloop.com) · [Latest Release](https://github.com/finewood2008/centaurai-station/releases/tag/v2.5.0)

</div>

> [!NOTE]
> **基于开源项目 AionUi 的二次开发版本。** CentaurAI AIStation is a modified derivative of
> [AionUi](https://github.com/iOfficeAI/AionUi) (Copyright AionUi, Apache-2.0). See
> [License & Attribution](#-license--attribution) and [`NOTICE`](NOTICE).

> [!IMPORTANT]
> 当前标准版本为 **CentaurAI 2.5.0**。`main`、`v2.5.0` Release 均指向已验证的 2.5 代码线。

---

## ✨ 核心特性 / Features

- **超级参谋团会议室** — 面向老板的单用户 AI 决策圆桌,围绕一个议题快速召集顾问、展开多方论证并沉淀决议。
- **200+ 专家顾问** — 覆盖营销、产品、法务、财务、运营、人力、战略等领域,可按部门模板快速组团。
- **多 Agent 底座** — 统一接入 Claude Code、Codex、Gemini、Qwen、Hermes 等命令行 Agent,按可用状态选择参会角色。
- **单机私有部署** — 默认单用户、仅回环访问,不启用团队版的多用户 WebUI / 局域网服务器能力。
- **本地模型管理** — 检测本机 Ollama 等本地模型能力,可在设置中集中管理并加入对话配置。
- **决策档案** — 进行中的会议、历史决议与方案书集中管理,便于复盘与追踪。
- **品牌主题** — 三套核心主题:暖米(默认)/ 素白 / 墨夜,遵循 centaurloop.com 设计语言。

---

## 🚀 快速开始 / Quick Start

### 安装

> 安装包不在公网公开下载,由半人马人工智能或授权渠道分发。

老板机上手流程:

1. **安装桌面端** —— 下载对应平台安装包并安装。
2. **配置模型 / API Key** —— 首次启动后在设置中配置可用模型或本地模型。
3. **发起会议** —— 进入「超级参谋团」,选择议题、讨论方式和部门模板,召集顾问开始决策会议。

| 平台    | 产物                                             |
| ------- | ------------------------------------------------ |
| Windows | `*-win-x64.exe`(安装版)/ `*-win-x64.zip`(免安装) |
| macOS   | `*-mac-arm64.dmg` / `*-mac-x64.dmg`              |
| Linux   | `*-linux-x64.AppImage` / `.deb`                  |

### 启动超级参谋团构建

```bash
# 开发时启用超级参谋团 UI
AIONUI_EDITION=decision bun dev
```

---

## 🛠️ 开发 / Development

技术栈:Electron · Vite · React 19 · Bun · TypeScript。后端为 `aioncore`(随应用分发的 Rust 服务)。

```bash
bun install            # 安装依赖
bun run dev            # 启动完整核心版开发
AIONUI_EDITION=decision bun dev  # 启动超级参谋团开发
bun run test           # 单元测试 (Vitest)
bunx tsc --noEmit      # 类型检查
bun run lint           # oxlint
node scripts/check-i18n.js   # i18n 校验(改动 i18n 后需先 bun run i18n:types)
```

提交前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md) 与 `AGENTS.md`。

---

## 📦 多平台构建与发布 / Build & Release

### 一键多端发布(推荐,通过 GitHub Actions)

发布工作流 `.github/workflows/build-and-release.yml` 在**推送版本 tag** 时自动:构建 **macOS(arm64/x64)、Windows(x64/arm64)、Linux(x64/arm64)** 全部 6 个变体,并通过 `softprops/action-gh-release` 创建一个**草稿 Release**,把所有安装包作为附件上传。

```bash
# 打 tag 并推送即可触发全平台构建 + 发布到 Releases(草稿)
git tag v2.5.0
git push origin v2.5.0
# 构建完成后到 GitHub → Releases,检查草稿并点击 "Publish"
```

### 手动构建单平台(GitHub Actions)

`.github/workflows/build-manual.yml`(workflow_dispatch)可选平台手动触发:

```bash
gh workflow run build-manual.yml -f branch=main -f platform=windows-x64
# platform 可选:macos-arm64 | macos-x64 | windows-x64 | windows-arm64 | linux-x64 | linux-arm64 | all
gh run download <run-id>     # 构建完成后下载产物
```

### 本地构建(在目标系统上)

原生模块与后端二进制是平台相关的,**需在对应系统上构建**(不能在 Linux 上交叉打 Windows/mac 的可用包):

```bash
bun run build-win:decision      # Windows(在 Windows 上)
bun run build-mac:decision      # macOS(在 macOS 上)
bun run build-deb:decision      # Linux
```

产物输出到 `out/`,文件名形如 `半人马AI-超级参谋团-<version>-<os>-<arch>.<ext>`。

---

## 📁 目录结构 / Project Layout

```
packages/desktop/src
├── process/        # Electron 主进程(无 DOM API);后端启动、桥接、局域网发现
├── preload/        # 预加载桥(IPC)
├── renderer/       # 渲染进程(无 Node API);页面、组件、主题、i18n
└── common/         # 主/渲染共享:配置、类型、ipcBridge、httpBridge
scripts/            # 构建、导入专家、匹配专家技能、局域网发现 demo 等
.github/workflows/  # CI:多平台构建与发布
```

---

## 📜 License & Attribution

CentaurAI AIStation 是 **半人马人工智能(深圳)有限公司自主研发的产品**,采用**双重许可**:

- **半人马自研代码与素材(专有,不开源)** —— 由半人马原创编写的全部代码、设计与资源,版权归 半人马人工智能(深圳)有限公司所有,**保留一切权利**;未经书面许可,不得使用、复制、修改或再分发(源自 AionUi 的部分按 Apache-2.0 处理除外)。
- **源自 AionUi 的部分(Apache-2.0)** —— 本产品基于 **[AionUi](https://github.com/iOfficeAI/AionUi)**(Copyright 2025 AionUi, Apache-2.0)二次开发(衍生作品)。对这部分我们严格遵守 Apache-2.0:保留原始版权与许可声明、随附 [`LICENSE`](LICENSE) 与 [`NOTICE`](NOTICE)、并在 [`NOTICE`](NOTICE) 中声明对原作品的主要修改(品牌化、板块重构、模型集中管理、专家技能匹配、局域网客户端等)。

> 说明:Apache-2.0 为宽松许可,允许在衍生作品中加入并以专有方式发布自研内容,只要对源自 AionUi 的部分继续履行 Apache-2.0 的义务。

感谢 AionUi 团队及其上游开源依赖的工作。

---

<sub>© 2025 半人马人工智能（深圳）有限公司 · CentaurAI AIStation · centaurloop.com</sub>
