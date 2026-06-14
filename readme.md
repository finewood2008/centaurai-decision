<div align="center">

# CentaurAI AIStation · 半人马 AI 工作站

**半人马 AI 自主研发的跨平台 AI 协作工作站 —— 内置 Agent、多 Agent 接入、办公助理、专家团队，以及局域网分发式客户端。**

A cross-platform AI cowork workstation developed by CentaurAI — built-in agent, multi-agent support, office assistants, expert advisors, and a LAN distributed client.

[![License](https://img.shields.io/badge/license-Proprietary%20%2B%20Apache--2.0%20components-32CD32?style=flat-square)](#-license--attribution)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-6C757D?style=flat-square)

简体中文 · [Official Site](https://www.centaurloop.com)

</div>

> [!NOTE]
> **基于开源项目 AionUi 的二次开发版本。** CentaurAI AIStation is a modified derivative of
> [AionUi](https://github.com/iOfficeAI/AionUi) (Copyright AionUi, Apache-2.0). See
> [License & Attribution](#-license--attribution) and [`NOTICE`](NOTICE).

---

## ✨ 核心特性 / Features

- **内置 Agent，零配置** — 安装即用,粘贴任意 API Key 即可开始;无需单独安装 CLI 工具。
- **多 Agent 接入** — 自动检测并统一接入 Claude Code、Codex、Gemini、Qwen、Hermes 等命令行 Agent。
- **办公助理(Office Assistants)** — 通用办公文档类助手:PPT / Word / Excel / 看板 / 财务模型 / 学术论文 / Mermaid 等。
- **专家团队(Experts)** — 200+ 各领域专业专家(营销 / 工程 / 设计 / 财务 / 安全…),按部门筛选,每位专家预设了**主代理 + 内置技能**。
- **管理员统一管理模型** — 管理员在桌面端集中配置模型 / API 接口,所有用户自动调用;WebUI 远程用户为只读。
- **局域网分发式客户端** — 把轻量客户端分发到每台电脑,开机**自动发现局域网内的服务器**(mDNS),登录即用;原生客户端让**语音输入**等能力可直接使用。
- **品牌主题** — 三套核心主题:暖米(默认)/ 素白 / 墨夜,遵循 centaurloop.com 设计语言。
- **随处访问** — WebUI(浏览器/手机)+ Telegram / 飞书 / 钉钉 / 微信 等渠道。
- **定时任务、文件管理、预览面板、图像生成** 等。

---

## 🚀 快速开始 / Quick Start

### 安装(普通用户)

> 客户端安装包**不在公网公开下载**。它内置在管理员部署的服务器中,由公司内部分发。

普通用户的上手流程:

1. **浏览器登录** —— 打开管理员提供的服务器地址(WebUI),用账号登录即可直接使用。
2. **下载客户端(可选)** —— 登录后进入 **设置 → 本地客户端**,选择对应平台与版本的安装包(Windows / macOS / Linux)下载安装。
3. **客户端登录** —— 安装后启动客户端,自动发现局域网内的服务器并登录(详见下方「局域网客户端模式」)。

> 为什么还要装客户端:浏览器在局域网 HTTP(非安全上下文)下会禁用麦克风等能力;原生客户端是安全上下文,**语音输入可直接录音**。

| 平台 | 产物 |
| --- | --- |
| Windows | `*-win-x64.exe`(安装版)/ `*-win-x64.zip`(免安装) |
| macOS | `*-mac-arm64.dmg` / `*-mac-x64.dmg` |
| Linux | `*-linux-x64.AppImage` / `.deb` |

### 局域网客户端模式 / LAN client mode

把同一个安装包分发到各电脑,用 **客户端模式** 启动即可连接中心服务器:

```bash
# 以客户端模式启动(做一个带该参数的快捷方式即可"双击即客户端")
CentaurAI.exe --client          # Windows
# 或设置环境变量 AIONUI_CLIENT=1
```

客户端启动后会自动发现局域网内的服务器(管理员机器开启 WebUI 后会广播 `_centaurai._tcp`),选择服务器 → 账号登录即可。未发现时可手动输入服务器 IP。

> 为什么用客户端而不是浏览器:浏览器在局域网 HTTP(非安全上下文)下会禁用麦克风,只能上传音频;原生客户端是安全上下文,**语音输入可直接录音**。

---

## 🛠️ 开发 / Development

技术栈:Electron · Vite · React 19 · Bun · TypeScript。后端为 `aioncore`(随应用分发的 Rust 服务)。

```bash
bun install            # 安装依赖
bun run dev            # 启动开发(electron-vite dev,从源码实时编译)
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
git tag v2.1.14
git push origin v2.1.14
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
bun run build-win      # Windows(在 Windows 上)
bun run build-mac      # macOS(在 macOS 上)
bun run build-deb      # Linux
```

产物输出到 `out/`,文件名形如 `CentaurAI-<version>-<os>-<arch>.<ext>`。

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
