# 🔌 集成

本目录包含 The Agency 针对受支持的智能体编码工具的集成与转换后格式。

## 受支持的工具

- **[Claude Code](#claude-code)** —— `.md` 智能体，直接使用本仓库
- **[GitHub Copilot](#github-copilot)** —— `.md` 智能体，直接使用本仓库
- **[Antigravity](#antigravity)** —— 每个智能体在 `antigravity/` 中对应一个 `SKILL.md`
- **[Gemini CLI](#gemini-cli)** —— `gemini-cli/agents/` 中的 `.md` 智能体文件
- **[OpenCode](#opencode)** —— `opencode/` 中的 `.md` 智能体文件
- **[OpenClaw](#openclaw)** —— `SOUL.md` + `AGENTS.md` + `IDENTITY.md` 工作区
- **[Cursor](#cursor)** —— `cursor/` 中的 `.mdc` 规则文件
- **[Aider](#aider)** —— `aider/` 中的 `CONVENTIONS.md`
- **[Windsurf](#windsurf)** —— `windsurf/` 中的 `.windsurfrules`
- **[Kimi Code](#kimi-code)** —— `kimi/` 中的 YAML 智能体规格
- **[Qwen Code](#qwen-code)** —— `.qwen/agents/` 中项目范围的 `.md` 子智能体
- **[Codex](#codex)** —— `codex/` 中的 `.toml` 自定义智能体

## 快速安装

```bash
# Install for all detected tools automatically
./scripts/install.sh

# Install a specific home-scoped tool
./scripts/install.sh --tool antigravity
./scripts/install.sh --tool copilot
./scripts/install.sh --tool openclaw
./scripts/install.sh --tool claude-code
./scripts/install.sh --tool codex

# Gemini CLI needs generated integration files on a fresh clone
./scripts/convert.sh --tool gemini-cli
./scripts/install.sh --tool gemini-cli

# Qwen Code also needs generated SubAgent files on a fresh clone
./scripts/convert.sh --tool qwen
./scripts/install.sh --tool qwen
```

如果你安装了 OpenClaw 且网关已在运行，请在安装后重启它：

```bash
openclaw gateway restart
```

对于项目范围的工具，如 OpenCode、Cursor、Aider、Windsurf 和 Qwen Code，请按照下文各工具专属章节所示，从目标项目根目录运行安装程序。

## 重新生成集成文件

如果你新增或修改了智能体，请重新生成所有集成文件：

```bash
./scripts/convert.sh
```

---

## Claude Code

The Agency 最初是为 Claude Code 设计的。智能体无需转换即可原生运行。

```bash
cp -r <category>/*.md ~/.claude/agents/
# or install everything at once:
./scripts/install.sh --tool claude-code
```

详见 [claude-code/README.md](claude-code/README.md)。

---

## GitHub Copilot

The Agency 同样可与 GitHub Copilot 原生协作。智能体无需转换即可直接复制到 `~/.github/agents/` 和 `~/.copilot/agents/`。

```bash
./scripts/install.sh --tool copilot
```

详见 [github-copilot/README.md](github-copilot/README.md)。

---

## Antigravity

技能安装到 `~/.gemini/antigravity/skills/`。每个智能体都会成为一个独立的技能，并以 `agency-` 为前缀以避免命名冲突。

```bash
./scripts/install.sh --tool antigravity
```

详见 [antigravity/README.md](antigravity/README.md)。

---

## Gemini CLI

智能体被打包为 Gemini CLI 子智能体。子智能体安装到 `~/.gemini/agents/`。由于这些智能体文件是生成产物，在全新克隆的仓库中安装前请先运行 `./scripts/convert.sh --tool gemini-cli`。

```bash
./scripts/convert.sh --tool gemini-cli
./scripts/install.sh --tool gemini-cli
```

详见 [gemini-cli/README.md](gemini-cli/README.md)。

---

## OpenCode

每个智能体都会成为 `.opencode/agents/` 中一个项目范围的 `.md` 文件。

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool opencode
```

详见 [opencode/README.md](opencode/README.md)。

---

## OpenClaw

每个智能体都会成为一个 OpenClaw 工作区，其中包含 `SOUL.md`、`AGENTS.md` 和 `IDENTITY.md`。

安装前，请先生成 OpenClaw 工作区：

```bash
./scripts/convert.sh --tool openclaw
```

然后安装它们：

```bash
./scripts/install.sh --tool openclaw
```

详见 [openclaw/README.md](openclaw/README.md)。

---

## Cursor

每个智能体都会成为一个 `.mdc` 规则文件。规则是项目范围的——请从项目根目录运行安装程序。

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool cursor
```

详见 [cursor/README.md](cursor/README.md)。

---

## Aider

所有智能体被整合到单个 `CONVENTIONS.md` 文件中，Aider 在你的项目根目录存在该文件时会自动读取。

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool aider
```

详见 [aider/README.md](aider/README.md)。

---

## Windsurf

所有智能体被整合到一个用于项目根目录的 `.windsurfrules` 文件中。

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool windsurf
```

详见 [windsurf/README.md](windsurf/README.md)。

---

## Kimi Code

每个智能体被转换为一个 Kimi Code CLI 智能体规格（YAML 格式，附带独立的系统提示文件）。智能体安装到 `~/.config/kimi/agents/`。

由于 Kimi 智能体文件是从源 Markdown 生成的，在全新克隆的仓库中安装前请先运行 `./scripts/convert.sh --tool kimi`。

```bash
./scripts/convert.sh --tool kimi
./scripts/install.sh --tool kimi
```

### 用法

安装后，使用 `--agent-file` 标志来调用某个智能体：

```bash
kimi --agent-file ~/.config/kimi/agents/frontend-developer/agent.yaml
```

或在特定项目中：

```bash
cd /your/project
kimi --agent-file ~/.config/kimi/agents/frontend-developer/agent.yaml \
     --work-dir /your/project
```

详见 [kimi/README.md](kimi/README.md)。

---

## Qwen Code

每个智能体都会成为 `.qwen/agents/` 中一个项目范围的 `.md` 子智能体文件。

从全新克隆的仓库开始时，请先生成 Qwen 文件：

```bash
./scripts/convert.sh --tool qwen
```

然后从你的项目根目录安装它们：

```bash
cd /your/project && /path/to/agency-agents/scripts/install.sh --tool qwen
```

详见 [qwen/README.md](qwen/README.md)。

---

## Codex

每个智能体被转换为一个独立的 Codex 自定义智能体 TOML 文件，并安装到 `~/.codex/agents/`。

由于 Codex 使用生成的 TOML 文件而非直接使用源 Markdown，在全新克隆的仓库中安装前请先运行转换器：

```bash
./scripts/convert.sh --tool codex
./scripts/install.sh --tool codex
```

详见 [codex/README.md](codex/README.md)。
