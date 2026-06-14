<div align="center">

# CentaurAI AIStation · 半人马 AI 工作站

**一个免费、跨平台的 AI 协作工作站 —— 内置 Agent、多 Agent 接入、办公助理、专家团队，以及局域网分发式客户端。**

A free, cross-platform AI cowork workstation — built-in agent, multi-agent support, office assistants, expert advisors, and a LAN distributed client.

[![License](https://img.shields.io/badge/license-Apache--2.0-32CD32?style=flat-square)](LICENSE)
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

前往 [**Releases**](https://github.com/finewood2008/centaurai-aionui/releases) 下载对应平台的安装包:

| 平台 | 产物 |
| --- | --- |
| Windows | `*-win-x64.exe`(安装版)/ `*-win-x64.zip`(免安装) |
| macOS | `*-mac-arm64.dmg` / `*-mac-x64.dmg` |
| Linux | `*-linux-x64.AppImage` / `.deb` |

三步上手:**安装 → 填入任意 API Key → 开始协作**。

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

本项目以 **Apache License 2.0** 授权,完整条款见 [`LICENSE`](LICENSE)。

CentaurAI AIStation 是基于 **[AionUi](https://github.com/iOfficeAI/AionUi)**(Copyright 2025 AionUi, Apache-2.0)的**二次开发(衍生作品)**。我们遵守 Apache-2.0:

- 保留了源自 AionUi 文件中的原始版权与许可声明;
- 随附本仓库的 [`LICENSE`](LICENSE)(Apache-2.0)与 [`NOTICE`](NOTICE);
- 在 [`NOTICE`](NOTICE) 中声明了对原作品的主要修改(品牌化、板块重构、模型集中管理、专家技能匹配、局域网客户端等)。

感谢 AionUi 团队及其上游开源依赖的工作。

---

<sub>© 2025 半人马人工智能（深圳）有限公司 · CentaurAI AIStation · centaurloop.com</sub>
