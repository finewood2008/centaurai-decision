# 🌐 NEXUS — Network of EXperts, Unified in Strategy（专家网络，统一于战略）

## The Agency 多 agent 编排的完整运营 Playbook

> **NEXUS** 将 The Agency 中各自独立的 AI 专家转变为一个同步协作的智能网络。这不是一份提示词集合——它是一套**部署准则**，把 The Agency 转变为任何项目、产品或组织的力量倍增器。

---

## 目录

1. [战略基础](#1-战略基础)
2. [NEXUS 运营模型](#2-nexus-运营模型)
3. [第 0 阶段 — 情报与发现](#3-第-0-阶段--情报与发现)
4. [第 1 阶段 — 战略与架构](#4-第-1-阶段--战略与架构)
5. [第 2 阶段 — 基础与脚手架](#5-第-2-阶段--基础与脚手架)
6. [第 3 阶段 — 构建与迭代](#6-第-3-阶段--构建与迭代)
7. [第 4 阶段 — 质量与加固](#7-第-4-阶段--质量与加固)
8. [第 5 阶段 — 上线与增长](#8-第-5-阶段--上线与增长)
9. [第 6 阶段 — 运营与演进](#9-第-6-阶段--运营与演进)
10. [Agent 协调矩阵](#10-agent-协调矩阵)
11. [交接协议](#11-交接协议)
12. [质量关卡](#12-质量关卡)
13. [风险管理](#13-风险管理)
14. [成功指标](#14-成功指标)
15. [快速上手激活指南](#15-快速上手激活指南)

---

## 1. 战略基础

### 1.1 NEXUS 解决了什么

单个 agent 很强大。但在缺乏协调的情况下，它们会产生：

- 相互冲突的架构决策
- 跨部门的重复工作
- 交接边界处的质量缺口
- 没有共享的上下文或组织记忆

**NEXUS 消除了这些失败模式**，方法是定义：

- 在每个阶段**谁**被激活
- 他们产出**什么**、为谁产出
- 他们**何时**交接、交接给谁
- 在推进之前**如何**验证质量
- 每个 agent **为何**存在于流水线中（没有搭便车的人）

### 1.2 核心原则

| Principle                                     | Description                                 |
| --------------------------------------------- | ------------------------------------------- |
| **Pipeline Integrity（流水线完整性）**        | 不通过质量关卡，任何阶段都不得推进          |
| **Context Continuity（上下文连续性）**        | 每次交接都携带完整上下文——没有 agent 冷启动 |
| **Parallel Execution（并行执行）**            | 独立的工作流并发运行以压缩时间线            |
| **Evidence Over Claims（证据优于断言）**      | 所有质量评估都需要证据，而非断言            |
| **Fail Fast, Fix Fast（快速失败，快速修复）** | 每项任务最多重试 3 次后升级                 |
| **Single Source of Truth（单一事实来源）**    | 一份权威规格、一份任务清单、一份架构文档    |

### 1.3 按部门划分的 Agent 名册

| Division               | Agents                                                                                                                                                                      | Primary NEXUS Role                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| **Engineering**        | Frontend Developer, Backend Architect, Mobile App Builder, AI Engineer, DevOps Automator, Rapid Prototyper, Senior Developer                                                | 构建、部署和维护所有技术系统       |
| **Design**             | UI Designer, UX Researcher, UX Architect, Brand Guardian, Visual Storyteller, Whimsy Injector, Image Prompt Engineer                                                        | 定义视觉标识、用户体验和品牌一致性 |
| **Marketing**          | Growth Hacker, Content Creator, Twitter Engager, TikTok Strategist, Instagram Curator, Reddit Community Builder, App Store Optimizer, Social Media Strategist               | 驱动获客、互动和市场存在感         |
| **Product**            | Sprint Prioritizer, Trend Researcher, Feedback Synthesizer                                                                                                                  | 定义构建什么、何时构建以及为什么   |
| **Project Management** | Studio Producer, Project Shepherd, Studio Operations, Experiment Tracker, Senior Project Manager                                                                            | 编排时间线、资源和跨职能协调       |
| **Testing**            | Evidence Collector, Reality Checker, Test Results Analyzer, Performance Benchmarker, API Tester, Tool Evaluator, Workflow Optimizer                                         | 通过基于证据的评估来验证质量       |
| **Support**            | Support Responder, Analytics Reporter, Finance Tracker, Infrastructure Maintainer, Legal Compliance Checker, Executive Summary Generator                                    | 维系运营、合规和商业智能           |
| **Spatial Computing**  | XR Interface Architect, macOS Spatial/Metal Engineer, XR Immersive Developer, XR Cockpit Interaction Specialist, visionOS Spatial Engineer, Terminal Integration Specialist | 构建沉浸式和空间计算体验           |
| **Specialized**        | Agents Orchestrator, Analytics Reporter, LSP/Index Engineer, Sales Data Extraction Agent, Data Consolidation Agent, Report Distribution Agent                               | 横向协调、深度分析和代码智能       |

---

## 2. NEXUS 运营模型

### 2.1 七阶段流水线

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        NEXUS PIPELINE                                   │
│                                                                         │
│  Phase 0        Phase 1         Phase 2          Phase 3                │
│  DISCOVER  ───▶ STRATEGIZE ───▶ SCAFFOLD   ───▶  BUILD                 │
│  Intelligence   Architecture    Foundation       Dev ↔ QA Loop          │
│                                                                         │
│  Phase 4        Phase 5         Phase 6                                 │
│  HARDEN   ───▶  LAUNCH    ───▶  OPERATE                                │
│  Quality Gate   Go-to-Market    Sustained Ops                           │
│                                                                         │
│  ◆ Quality Gate between every phase                                     │
│  ◆ Parallel tracks within phases                                        │
│  ◆ Feedback loops at every boundary                                     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 指挥结构

```
                    ┌──────────────────────┐
                    │  Agents Orchestrator  │  ◄── Pipeline Controller
                    │  (Specialized)        │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼──────┐ ┌──────▼───────┐ ┌──────▼──────────┐
     │ Studio        │ │ Project      │ │ Senior Project   │
     │ Producer      │ │ Shepherd     │ │ Manager          │
     │ (Portfolio)   │ │ (Execution)  │ │ (Task Scoping)   │
     └───────────────┘ └──────────────┘ └─────────────────┘
              │                │                │
              ▼                ▼                ▼
     ┌─────────────────────────────────────────────────┐
     │           Division Leads (per phase)             │
     │  Engineering │ Design │ Marketing │ Product │ QA │
     └─────────────────────────────────────────────────┘
```

### 2.3 激活模式

NEXUS 支持三种部署配置：

| Mode             | Agents Active | Use Case                       | Timeline |
| ---------------- | ------------- | ------------------------------ | -------- |
| **NEXUS-Full**   | All           | 企业级产品发布、完整生命周期   | 12-24 周 |
| **NEXUS-Sprint** | 15-25         | 功能开发、MVP 构建             | 2-6 周   |
| **NEXUS-Micro**  | 5-10          | Bug 修复、内容活动、单项交付物 | 1-5 天   |

---

## 3. 第 0 阶段 — 情报与发现

> **目标**：在投入资源之前理解全局。在问题得到验证之前不动工。

### 3.1 活跃的 Agent

| Agent                        | Role in Phase  | Primary Output                |
| ---------------------------- | -------------- | ----------------------------- |
| **Trend Researcher**         | 市场情报负责人 | 含 TAM/SAM/SOM 的市场分析报告 |
| **Feedback Synthesizer**     | 用户需求分析   | 含痛点的综合反馈报告          |
| **UX Researcher**            | 用户行为分析   | 含用户画像和旅程图的研究发现  |
| **Analytics Reporter**       | 数据现状评估   | 含可用信号的数据审计报告      |
| **Legal Compliance Checker** | 监管扫描       | 合规要求矩阵                  |
| **Tool Evaluator**           | 技术格局       | 技术栈评估                    |

### 3.2 并行工作流

```
WORKSTREAM A: Market Intelligence          WORKSTREAM B: User Intelligence
├── Trend Researcher                       ├── Feedback Synthesizer
│   ├── Competitive landscape              │   ├── Multi-channel feedback collection
│   ├── Market sizing (TAM/SAM/SOM)        │   ├── Sentiment analysis
│   └── Trend lifecycle mapping            │   └── Pain point prioritization
│                                          │
├── Analytics Reporter                     ├── UX Researcher
│   ├── Existing data audit                │   ├── User interviews/surveys
│   ├── Signal identification              │   ├── Persona development
│   └── Baseline metrics                   │   └── Journey mapping
│                                          │
└── Legal Compliance Checker               └── Tool Evaluator
    ├── Regulatory requirements                ├── Technology assessment
    ├── Data handling constraints               ├── Build vs. buy analysis
    └── Jurisdiction mapping                   └── Integration feasibility
```

### 3.3 第 0 阶段质量关卡

**关卡守门人**：Executive Summary Generator

| Criterion        | Threshold          | Evidence Required                         |
| ---------------- | ------------------ | ----------------------------------------- |
| 市场机会已验证   | TAM > 最低可行门槛 | 含来源的 Trend Researcher 报告            |
| 用户需求已确认   | ≥3 个经验证的痛点  | Feedback Synthesizer + UX Researcher 数据 |
| 监管路径清晰     | 无阻塞性合规问题   | Legal Compliance Checker 矩阵             |
| 数据基础已评估   | 关键指标已识别     | Analytics Reporter 审计                   |
| 技术可行性已确认 | 技术栈已验证       | Tool Evaluator 评估                       |

**产出**：高管摘要（≤500 字，SCQA 格式）→ 决策：GO / NO-GO / PIVOT

---

## 4. 第 1 阶段 — 战略与架构

> **目标**：在写下一行代码之前，定义我们要构建什么、它如何组织，以及成功是什么样子。

### 4.1 活跃的 Agent

| Agent                      | Role in Phase        | Primary Output                  |
| -------------------------- | -------------------- | ------------------------------- |
| **Studio Producer**        | 战略组合对齐         | 战略组合计划                    |
| **Senior Project Manager** | 规格转任务           | 完整任务清单                    |
| **Sprint Prioritizer**     | 功能优先级排序       | 优先级排序后的待办（RICE 评分） |
| **UX Architect**           | 技术架构 + UX 基础   | 架构规格 + CSS 设计系统         |
| **Brand Guardian**         | 品牌标识系统         | 品牌基础文档                    |
| **Backend Architect**      | 系统架构             | 系统架构规格说明                |
| **AI Engineer**            | AI/ML 架构（如适用） | ML 系统设计                     |
| **Finance Tracker**        | 预算与资源规划       | 含 ROI 预测的财务计划           |

### 4.2 执行序列

```
STEP 1: Strategic Framing (Parallel)
├── Studio Producer → Strategic Portfolio Plan (vision, objectives, ROI targets)
├── Brand Guardian → Brand Foundation (purpose, values, visual identity system)
└── Finance Tracker → Budget Framework (resource allocation, cost projections)

STEP 2: Technical Architecture (Parallel, after Step 1)
├── UX Architect → CSS Design System + Layout Framework + UX Structure
├── Backend Architect → System Architecture (services, databases, APIs)
├── AI Engineer → ML Architecture (models, pipelines, inference strategy)
└── Senior Project Manager → Task List (spec → tasks, exact requirements)

STEP 3: Prioritization (Sequential, after Step 2)
└── Sprint Prioritizer → RICE-scored backlog with sprint assignments
    ├── Input: Task List + Architecture Spec + Budget Framework
    ├── Output: Prioritized sprint plan with dependency map
    └── Validation: Studio Producer confirms strategic alignment
```

### 4.3 第 1 阶段质量关卡

**关卡守门人**：Studio Producer + Reality Checker（双重签字）

| Criterion           | Threshold                     | Evidence Required                     |
| ------------------- | ----------------------------- | ------------------------------------- |
| 架构覆盖所有需求    | 100% 规格覆盖                 | 交叉引用的 Senior PM 任务清单         |
| 品牌系统完整        | 已定义 Logo、配色、字体、语调 | Brand Guardian 交付物                 |
| 技术可行性已验证    | 所有组件都有实现路径          | Backend Architect + UX Architect 规格 |
| 预算已批准          | 在组织约束之内                | Finance Tracker 计划                  |
| Sprint 计划现实可行 | 基于速率的估算                | Sprint Prioritizer 待办               |

**产出**：经批准的架构包 → 激活第 2 阶段

---

## 5. 第 2 阶段 — 基础与脚手架

> **目标**：构建所有后续工作所依赖的技术与运营基础。先把骨架立起来，再添肌肉。

### 5.1 活跃的 Agent

| Agent                         | Role in Phase           | Primary Output                 |
| ----------------------------- | ----------------------- | ------------------------------ |
| **DevOps Automator**          | CI/CD 流水线 + 基础设施 | 部署流水线 + IaC 模板          |
| **Frontend Developer**        | 项目脚手架 + 组件库     | 应用骨架 + 设计系统实现        |
| **Backend Architect**         | 数据库 + API 基础       | Schema + API 脚手架 + 鉴权系统 |
| **UX Architect**              | CSS 系统实现            | 设计令牌 + 布局框架            |
| **Infrastructure Maintainer** | 云基础设施搭建          | 监控 + 日志 + 告警             |
| **Studio Operations**         | 流程搭建                | 协作工具 + 工作流              |

### 5.2 并行工作流

```
WORKSTREAM A: Infrastructure              WORKSTREAM B: Application Foundation
├── DevOps Automator                      ├── Frontend Developer
│   ├── CI/CD pipeline (GitHub Actions)   │   ├── Project scaffolding
│   ├── Container orchestration           │   ├── Component library setup
│   └── Environment provisioning          │   └── Design system integration
│                                         │
├── Infrastructure Maintainer             ├── Backend Architect
│   ├── Cloud resource provisioning       │   ├── Database schema deployment
│   ├── Monitoring (Prometheus/Grafana)   │   ├── API scaffold + auth
│   └── Security hardening               │   └── Service communication layer
│                                         │
└── Studio Operations                     └── UX Architect
    ├── Git workflow + branch strategy        ├── CSS design tokens
    ├── Communication channels                ├── Responsive layout system
    └── Documentation templates               └── Theme system (light/dark/system)
```

### 5.3 第 2 阶段质量关卡

**关卡守门人**：DevOps Automator + Evidence Collector

| Criterion            | Threshold              | Evidence Required       |
| -------------------- | ---------------------- | ----------------------- |
| CI/CD 流水线可运行   | 构建 + 测试 + 部署正常 | 流水线执行日志          |
| 数据库 schema 已部署 | 所有表/索引已创建      | 迁移成功 + schema dump  |
| API 脚手架有响应     | 健康检查端点已上线     | curl 响应截图           |
| 前端可渲染           | 骨架应用在浏览器中加载 | Evidence Collector 截图 |
| 监控已激活           | 仪表盘显示指标         | Grafana/监控截图        |
| 设计系统已实现       | 令牌 + 组件可用        | 组件库演示              |

**产出**：带完整 DevOps 流水线的可运行骨架应用 → 激活第 3 阶段

---

## 6. 第 3 阶段 — 构建与迭代

> **目标**：通过持续的 Dev↔QA 闭环实现功能。每项任务在下一项开始之前都得到验证。这是大部分工作发生的地方。

### 6.1 Dev↔QA 闭环

这是 NEXUS 的核心。Agents Orchestrator 管理一个**逐任务的质量闭环**：

```
┌─────────────────────────────────────────────────────────┐
│                   DEV ↔ QA LOOP                          │
│                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────────────┐   │
│  │ Developer │───▶│ Evidence │───▶│ Decision Logic    │   │
│  │ Agent     │    │ Collector│    │                   │   │
│  │           │    │ (QA)     │    │ PASS → Next Task  │   │
│  │ Implements│    │          │    │ FAIL → Retry (≤3) │   │
│  │ Task N    │    │ Tests    │    │ BLOCKED → Escalate│   │
│  │           │◀───│ Task N   │◀───│                   │   │
│  └──────────┘    └──────────┘    └──────────────────┘   │
│       ▲                                    │             │
│       │            QA Feedback             │             │
│       └────────────────────────────────────┘             │
│                                                          │
│  Orchestrator tracks: attempt count, QA feedback,        │
│  task status, cumulative quality metrics                 │
└─────────────────────────────────────────────────────────┘
```

### 6.2 按任务类型分配 Agent

| Task Type         | Primary Developer                 | QA Agent                | Specialist Support           |
| ----------------- | --------------------------------- | ----------------------- | ---------------------------- |
| Frontend UI       | Frontend Developer                | Evidence Collector      | UI Designer, Whimsy Injector |
| Backend API       | Backend Architect                 | API Tester              | Performance Benchmarker      |
| Database          | Backend Architect                 | API Tester              | Analytics Reporter           |
| Mobile            | Mobile App Builder                | Evidence Collector      | UX Researcher                |
| AI/ML Feature     | AI Engineer                       | Test Results Analyzer   | Analytics Reporter           |
| Infrastructure    | DevOps Automator                  | Performance Benchmarker | Infrastructure Maintainer    |
| Premium Polish    | Senior Developer                  | Evidence Collector      | Visual Storyteller           |
| Rapid Prototype   | Rapid Prototyper                  | Evidence Collector      | Experiment Tracker           |
| Spatial/XR        | XR Immersive Developer            | Evidence Collector      | XR Interface Architect       |
| visionOS          | visionOS Spatial Engineer         | Evidence Collector      | macOS Spatial/Metal Engineer |
| Cockpit UI        | XR Cockpit Interaction Specialist | Evidence Collector      | XR Interface Architect       |
| CLI/Terminal      | Terminal Integration Specialist   | API Tester              | LSP/Index Engineer           |
| Code Intelligence | LSP/Index Engineer                | Test Results Analyzer   | Senior Developer             |

### 6.3 并行构建轨道

对于复杂项目，多条轨道同时运行：

```
TRACK A: Core Product                    TRACK B: Growth & Marketing
├── Frontend Developer                   ├── Growth Hacker
│   └── UI implementation                │   └── Viral loops + referral system
├── Backend Architect                    ├── Content Creator
│   └── API + business logic             │   └── Launch content + editorial calendar
├── AI Engineer                          ├── Social Media Strategist
│   └── ML features + pipelines          │   └── Cross-platform campaign
│                                        ├── App Store Optimizer (if mobile)
│                                        │   └── ASO strategy + metadata
│                                        │
TRACK C: Quality & Operations            TRACK D: Brand & Experience
├── Evidence Collector                   ├── UI Designer
│   └── Continuous QA screenshots        │   └── Component refinement
├── API Tester                           ├── Brand Guardian
│   └── Endpoint validation              │   └── Brand consistency audit
├── Performance Benchmarker              ├── Visual Storyteller
│   └── Load testing + optimization      │   └── Visual narrative assets
├── Workflow Optimizer                   └── Whimsy Injector
│   └── Process improvement                  └── Delight moments + micro-interactions
└── Experiment Tracker
    └── A/B test management
```

### 6.4 第 3 阶段质量关卡

**关卡守门人**：Agents Orchestrator

| Criterion        | Threshold               | Evidence Required                  |
| ---------------- | ----------------------- | ---------------------------------- |
| 所有任务通过 QA  | 100% 任务完成           | 每项任务的 Evidence Collector 截图 |
| API 端点已验证   | 所有端点已测试          | API Tester 报告                    |
| 性能基线达标     | P95 < 200ms, LCP < 2.5s | Performance Benchmarker 报告       |
| 品牌一致性已核实 | 95%+ 遵从度             | Brand Guardian 审计                |
| 无关键 bug       | 零 P0/P1 未决问题       | Test Results Analyzer 摘要         |

**产出**：功能完整的应用 → 激活第 4 阶段

---

## 7. 第 4 阶段 — 质量与加固

> **目标**：最终的质量大考。Reality Checker 默认判定为"NEEDS WORK"——你必须以压倒性的证据证明生产就绪。

### 7.1 活跃的 Agent

| Agent                         | Role in Phase                         | Primary Output     |
| ----------------------------- | ------------------------------------- | ------------------ |
| **Reality Checker**           | 最终集成测试（默认判定为 NEEDS WORK） | 基于现实的集成报告 |
| **Evidence Collector**        | 全面的视觉证据                        | 截图证据包         |
| **Performance Benchmarker**   | 负载测试 + 优化                       | 性能认证           |
| **API Tester**                | 完整 API 回归套件                     | API 测试报告       |
| **Test Results Analyzer**     | 汇总质量指标                          | 质量指标仪表盘     |
| **Legal Compliance Checker**  | 最终合规审计                          | 合规认证           |
| **Infrastructure Maintainer** | 生产就绪检查                          | 基础设施就绪报告   |
| **Workflow Optimizer**        | 流程效率评审                          | 优化建议           |

### 7.2 加固序列

```
STEP 1: Evidence Collection (Parallel)
├── Evidence Collector → Full screenshot suite (desktop, tablet, mobile)
├── API Tester → Complete endpoint regression
├── Performance Benchmarker → Load test at 10x expected traffic
└── Legal Compliance Checker → Final regulatory audit

STEP 2: Analysis (Parallel, after Step 1)
├── Test Results Analyzer → Aggregate all test data into quality dashboard
├── Workflow Optimizer → Identify remaining process inefficiencies
└── Infrastructure Maintainer → Production environment validation

STEP 3: Final Judgment (Sequential, after Step 2)
└── Reality Checker → Integration Report
    ├── Cross-validates ALL previous QA findings
    ├── Tests complete user journeys with screenshot evidence
    ├── Verifies specification compliance point-by-point
    ├── Default verdict: NEEDS WORK
    └── READY only with overwhelming evidence across all criteria
```

### 7.3 第 4 阶段质量关卡（最终关卡）

**关卡守门人**：Reality Checker（唯一权威）

| Criterion    | Threshold                         | Evidence Required             |
| ------------ | --------------------------------- | ----------------------------- |
| 用户旅程完整 | 所有关键路径正常                  | 端到端截图                    |
| 跨设备一致性 | 桌面 + 平板 + 手机                | 响应式截图                    |
| 性能已认证   | P95 < 200ms, 正常运行时间 > 99.9% | 负载测试结果                  |
| 安全已验证   | 零关键漏洞                        | 安全扫描报告                  |
| 合规已认证   | 满足所有监管要求                  | Legal Compliance Checker 报告 |
| 规格遵从     | 100% 的规格要求                   | 逐条核实                      |

**裁定选项**：

- **READY** —— 推进至上线（首轮即通过较为罕见）
- **NEEDS WORK** —— 带具体修复清单返回第 3 阶段（预期情况）
- **NOT READY** —— 重大架构问题，返回第 1/2 阶段

**预期**：首次实现通常需要 2-3 轮修订。B/B+ 评级是正常且健康的。

---

## 8. 第 5 阶段 — 上线与增长

> **目标**：在所有渠道同时协调上市执行。在上线时实现最大影响。

### 8.1 活跃的 Agent

| Agent                           | Role in Phase          | Primary Output              |
| ------------------------------- | ---------------------- | --------------------------- |
| **Growth Hacker**               | 上线策略负责人         | 含病毒式循环的增长 Playbook |
| **Content Creator**             | 上线内容               | 博文、视频、社交内容        |
| **Social Media Strategist**     | 跨平台营销活动         | 营销日历 + 内容             |
| **Twitter Engager**             | Twitter/X 上线活动     | Thread 策略 + 互动计划      |
| **TikTok Strategist**           | TikTok 病毒式内容      | 短视频策略                  |
| **Instagram Curator**           | 视觉上线活动           | 视觉内容 + stories          |
| **Reddit Community Builder**    | 真实的社区上线         | 社区互动计划                |
| **App Store Optimizer**         | 商店优化（如为移动端） | ASO 包                      |
| **Executive Summary Generator** | 利益相关方沟通         | 上线高管摘要                |
| **Project Shepherd**            | 上线协调               | 上线清单 + 时间线           |
| **DevOps Automator**            | 部署执行               | 零停机部署                  |
| **Infrastructure Maintainer**   | 上线监控               | 实时仪表盘                  |

### 8.2 上线序列

```
T-7 DAYS: Pre-Launch
├── Content Creator → Launch content queued and scheduled
├── Social Media Strategist → Campaign assets finalized
├── Growth Hacker → Viral mechanics tested and armed
├── App Store Optimizer → Store listing optimized
├── DevOps Automator → Blue-green deployment prepared
└── Infrastructure Maintainer → Auto-scaling configured for 10x

T-0: Launch Day
├── DevOps Automator → Execute deployment
├── Infrastructure Maintainer → Monitor all systems
├── Twitter Engager → Launch thread + real-time engagement
├── Reddit Community Builder → Authentic community posts
├── Instagram Curator → Visual launch content
├── TikTok Strategist → Launch videos published
├── Support Responder → Customer support active
└── Analytics Reporter → Real-time metrics dashboard

T+1 TO T+7: Post-Launch
├── Growth Hacker → Analyze acquisition data, optimize funnels
├── Feedback Synthesizer → Collect and analyze early user feedback
├── Analytics Reporter → Daily metrics reports
├── Content Creator → Response content based on reception
├── Experiment Tracker → Launch A/B tests
└── Executive Summary Generator → Daily stakeholder briefings
```

### 8.3 第 5 阶段质量关卡

**关卡守门人**：Studio Producer + Analytics Reporter

| Criterion        | Threshold                | Evidence Required                |
| ---------------- | ------------------------ | -------------------------------- |
| 部署成功         | 零停机，所有健康检查通过 | DevOps 部署日志                  |
| 系统稳定         | 前 48 小时无 P0/P1 事件  | 基础设施监控                     |
| 用户获取活跃     | 渠道正在引流             | Analytics Reporter 仪表盘        |
| 反馈闭环运转     | 正在收集用户反馈         | Feedback Synthesizer 报告        |
| 利益相关方已知会 | 高管摘要已交付           | Executive Summary Generator 产出 |

**产出**：带活跃增长渠道的稳定上线产品 → 激活第 6 阶段

---

## 9. 第 6 阶段 — 运营与演进

> **目标**：持续运营，伴随不断改进。产品已上线——现在让它茁壮成长。

### 9.1 活跃的 Agent（持续进行）

| Agent                           | Cadence     | Responsibility                 |
| ------------------------------- | ----------- | ------------------------------ |
| **Infrastructure Maintainer**   | 持续        | 系统可靠性、正常运行时间、性能 |
| **Support Responder**           | 持续        | 客户支持与问题解决             |
| **Analytics Reporter**          | 每周        | KPI 追踪、仪表盘、洞察         |
| **Feedback Synthesizer**        | 每两周      | 用户反馈分析与综合             |
| **Finance Tracker**             | 每月        | 财务表现、预算追踪             |
| **Legal Compliance Checker**    | 每月        | 监管监测与合规                 |
| **Trend Researcher**            | 每月        | 市场情报与竞争分析             |
| **Executive Summary Generator** | 每月        | 高管层汇报                     |
| **Sprint Prioritizer**          | 每个 sprint | 待办梳理与 sprint 规划         |
| **Experiment Tracker**          | 每个实验    | A/B 测试管理与分析             |
| **Growth Hacker**               | 持续进行    | 获客优化与增长实验             |
| **Workflow Optimizer**          | 每季度      | 流程改进与效率提升             |

### 9.2 持续改进循环

```
┌──────────────────────────────────────────────────────────┐
│              CONTINUOUS IMPROVEMENT LOOP                   │
│                                                           │
│  MEASURE          ANALYZE           PLAN          ACT     │
│  ┌─────────┐     ┌──────────┐     ┌─────────┐   ┌─────┐ │
│  │Analytics │────▶│Feedback  │────▶│Sprint   │──▶│Build│ │
│  │Reporter  │     │Synthesizer│    │Prioritizer│  │Loop │ │
│  └─────────┘     └──────────┘     └─────────┘   └─────┘ │
│       ▲                                            │      │
│       │              Experiment                    │      │
│       │              Tracker                       │      │
│       └────────────────────────────────────────────┘      │
│                                                           │
│  Monthly: Executive Summary Generator → C-suite report    │
│  Monthly: Finance Tracker → Financial performance         │
│  Monthly: Legal Compliance Checker → Regulatory update    │
│  Monthly: Trend Researcher → Market intelligence          │
│  Quarterly: Workflow Optimizer → Process improvements     │
└──────────────────────────────────────────────────────────┘
```

---

## 10. Agent 协调矩阵

### 10.1 完整的跨部门依赖图

此矩阵展示了哪些 agent 产出的成果被其他 agent 消费。读法为：**行 agent 产出 → 列 agent 消费**。

```
PRODUCER →          │ ENG │ DES │ MKT │ PRD │ PM  │ TST │ SUP │ SPC │ SPZ
────────────────────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼────
Engineering         │  ●  │     │     │     │     │  ●  │  ●  │  ●  │
Design              │  ●  │  ●  │  ●  │     │     │  ●  │     │  ●  │
Marketing           │     │     │  ●  │  ●  │     │     │  ●  │     │
Product             │  ●  │  ●  │  ●  │  ●  │  ●  │     │     │     │  ●
Project Management  │  ●  │  ●  │  ●  │  ●  │  ●  │  ●  │  ●  │  ●  │  ●
Testing             │  ●  │  ●  │     │  ●  │  ●  │  ●  │     │  ●  │
Support             │  ●  │     │  ●  │  ●  │  ●  │     │  ●  │     │  ●
Spatial Computing   │  ●  │  ●  │     │     │     │  ●  │     │  ●  │
Specialized         │  ●  │     │     │  ●  │  ●  │  ●  │  ●  │     │  ●

● = Active dependency (producer creates artifacts consumed by this division)
```

### 10.2 关键交接对

这些是 NEXUS 中流量最高的交接关系：

| From                        | To                     | Artifact                         | Frequency   |
| --------------------------- | ---------------------- | -------------------------------- | ----------- |
| Senior Project Manager      | All Developers         | Task List                        | 每个 sprint |
| UX Architect                | Frontend Developer     | CSS Design System + Layout Spec  | 每个项目    |
| Backend Architect           | Frontend Developer     | API Specification                | 每个功能    |
| Frontend Developer          | Evidence Collector     | Implemented Feature              | 每项任务    |
| Evidence Collector          | Agents Orchestrator    | QA Verdict (PASS/FAIL)           | 每项任务    |
| Agents Orchestrator         | Developer (any)        | QA Feedback + Retry Instructions | 每次失败    |
| Brand Guardian              | All Design + Marketing | Brand Guidelines                 | 每个项目    |
| Analytics Reporter          | Sprint Prioritizer     | Performance Data                 | 每个 sprint |
| Feedback Synthesizer        | Sprint Prioritizer     | User Insights                    | 每个 sprint |
| Trend Researcher            | Studio Producer        | Market Intelligence              | 每月        |
| Reality Checker             | Agents Orchestrator    | Integration Verdict              | 每个阶段    |
| Executive Summary Generator | Studio Producer        | Executive Brief                  | 每个里程碑  |

---

## 11. 交接协议

### 11.1 标准交接模板

每一次 agent 到 agent 的交接都必须包含：

```markdown
## NEXUS Handoff Document

### Metadata

- **From**: [Agent Name] ([Division])
- **To**: [Agent Name] ([Division])
- **Phase**: [Current NEXUS Phase]
- **Task Reference**: [Task ID from Sprint Prioritizer backlog]
- **Priority**: [Critical / High / Medium / Low]
- **Timestamp**: [ISO 8601]

### Context

- **Project**: [Project name and brief description]
- **Current State**: [What has been completed so far]
- **Relevant Files**: [List of files/artifacts to review]
- **Dependencies**: [What this work depends on]

### Deliverable Request

- **What is needed**: [Specific, measurable deliverable]
- **Acceptance criteria**: [How success will be measured]
- **Constraints**: [Technical, timeline, or resource constraints]
- **Reference materials**: [Links to specs, designs, previous work]

### Quality Expectations

- **Must pass**: [Specific quality criteria]
- **Evidence required**: [What proof of completion looks like]
- **Handoff to next**: [Who receives the output and what they need]
```

### 11.2 QA 反馈闭环协议

当一项任务未通过 QA 时，反馈必须是可操作的：

```markdown
## QA Failure Feedback

### Task: [Task ID and description]

### Attempt: [1/2/3] of 3 maximum

### Verdict: FAIL

### Specific Issues Found

1. **[Issue Category]**: [Exact description with screenshot reference]
   - Expected: [What should happen]
   - Actual: [What actually happens]
   - Evidence: [Screenshot filename or test output]

2. **[Issue Category]**: [Exact description]
   - Expected: [...]
   - Actual: [...]
   - Evidence: [...]

### Fix Instructions

- [Specific, actionable fix instruction 1]
- [Specific, actionable fix instruction 2]

### Files to Modify

- [file path 1]: [what needs to change]
- [file path 2]: [what needs to change]

### Retry Expectations

- Fix the above issues and re-submit for QA
- Do NOT introduce new features — fix only
- Attempt [N+1] of 3 maximum
```

### 11.3 升级协议

当一项任务超过 3 次重试尝试时：

```markdown
## Escalation Report

### Task: [Task ID]

### Attempts Exhausted: 3/3

### Escalation Level: [To Agents Orchestrator / To Studio Producer]

### Failure History

- Attempt 1: [Summary of issues and fixes attempted]
- Attempt 2: [Summary of issues and fixes attempted]
- Attempt 3: [Summary of issues and fixes attempted]

### Root Cause Analysis

- [Why the task keeps failing]
- [What systemic issue is preventing resolution]

### Recommended Resolution

- [ ] Reassign to different developer agent
- [ ] Decompose task into smaller sub-tasks
- [ ] Revise architecture/approach
- [ ] Accept current state with known limitations
- [ ] Defer to future sprint

### Impact Assessment

- **Blocking**: [What other tasks are blocked by this]
- **Timeline Impact**: [How this affects the overall schedule]
- **Quality Impact**: [What quality compromises exist]
```

---

## 12. 质量关卡

### 12.1 关卡总览

| Phase | Gate Name         | Gate Keeper                           | Pass Criteria                                         |
| ----- | ----------------- | ------------------------------------- | ----------------------------------------------------- |
| 0 → 1 | Discovery Gate    | Executive Summary Generator           | 市场已验证、用户需求已确认、监管路径清晰              |
| 1 → 2 | Architecture Gate | Studio Producer + Reality Checker     | 架构完整、品牌已定义、预算已批准、sprint 计划现实可行 |
| 2 → 3 | Foundation Gate   | DevOps Automator + Evidence Collector | CI/CD 正常、骨架应用运行、监控激活                    |
| 3 → 4 | Feature Gate      | Agents Orchestrator                   | 所有任务通过 QA、无关键 bug、性能基线达标             |
| 4 → 5 | Production Gate   | Reality Checker（唯一权威）           | 用户旅程完整、跨设备一致、安全已验证、规格遵从        |
| 5 → 6 | Launch Gate       | Studio Producer + Analytics Reporter  | 部署成功、系统稳定、增长渠道活跃                      |

### 12.2 关卡失败处理

```
IF gate FAILS:
  ├── Gate Keeper produces specific failure report
  ├── Agents Orchestrator routes failures to responsible agents
  ├── Failed items enter Dev↔QA loop (Phase 3 mechanics)
  ├── Maximum 3 gate re-attempts before escalation to Studio Producer
  └── Studio Producer decides: fix, descope, or accept with risk
```

---

## 13. 风险管理

### 13.1 风险类别与负责人

| Risk Category             | Primary Owner            | Mitigation Agent          | Escalation Path     |
| ------------------------- | ------------------------ | ------------------------- | ------------------- |
| Technical Debt            | Backend Architect        | Workflow Optimizer        | Senior Developer    |
| Security Vulnerability    | Legal Compliance Checker | Infrastructure Maintainer | DevOps Automator    |
| Performance Degradation   | Performance Benchmarker  | Infrastructure Maintainer | Backend Architect   |
| Brand Inconsistency       | Brand Guardian           | UI Designer               | Studio Producer     |
| Scope Creep               | Senior Project Manager   | Sprint Prioritizer        | Project Shepherd    |
| Budget Overrun            | Finance Tracker          | Studio Operations         | Studio Producer     |
| Regulatory Non-Compliance | Legal Compliance Checker | Support Responder         | Studio Producer     |
| Market Shift              | Trend Researcher         | Growth Hacker             | Studio Producer     |
| Team Bottleneck           | Project Shepherd         | Studio Operations         | Studio Producer     |
| Quality Regression        | Reality Checker          | Evidence Collector        | Agents Orchestrator |

### 13.2 风险响应矩阵

| Severity          | Response Time | Decision Authority  | Action                 |
| ----------------- | ------------- | ------------------- | ---------------------- |
| **Critical** (P0) | 立即          | Studio Producer     | 全员出动，暂停其他工作 |
| **High** (P1)     | < 4 小时      | Project Shepherd    | 专人 agent 分配        |
| **Medium** (P2)   | < 24 小时     | Agents Orchestrator | 下个 sprint 优先级     |
| **Low** (P3)      | < 1 周        | Sprint Prioritizer  | 待办项                 |

---

## 14. 成功指标

### 14.1 流水线指标

| Metric               | Target                   | Measurement Agent   |
| -------------------- | ------------------------ | ------------------- |
| 阶段完成率           | 首次尝试 95%             | Agents Orchestrator |
| 任务首次通过 QA 率   | 70%+                     | Evidence Collector  |
| 每项任务平均重试次数 | < 1.5                    | Agents Orchestrator |
| 流水线周期时间       | 在 sprint 估算 ±15% 之内 | Project Shepherd    |
| 质量关卡通过率       | 首次尝试 80%+            | Reality Checker     |

### 14.2 产品指标

| Metric             | Target                  | Measurement Agent         |
| ------------------ | ----------------------- | ------------------------- |
| API 响应时间 (P95) | < 200ms                 | Performance Benchmarker   |
| 页面加载时间 (LCP) | < 2.5s                  | Performance Benchmarker   |
| 系统正常运行时间   | > 99.9%                 | Infrastructure Maintainer |
| Lighthouse 评分    | > 90（性能 + 可访问性） | Frontend Developer        |
| 安全漏洞           | 零关键                  | Legal Compliance Checker  |
| 规格遵从           | 100%                    | Reality Checker           |

### 14.3 业务指标

| Metric                 | Target    | Measurement Agent    |
| ---------------------- | --------- | -------------------- |
| 用户获取（环比 MoM）   | 20%+ 增长 | Growth Hacker        |
| 激活率                 | 首周 60%+ | Analytics Reporter   |
| 留存（Day 7 / Day 30） | 40% / 20% | Analytics Reporter   |
| LTV:CAC 比率           | > 3:1     | Finance Tracker      |
| NPS 得分               | > 50      | Feedback Synthesizer |
| 组合 ROI               | > 25%     | Studio Producer      |

### 14.4 运营指标

| Metric           | Target      | Measurement Agent           |
| ---------------- | ----------- | --------------------------- |
| 部署频率         | 每天多次    | DevOps Automator            |
| 平均恢复时间     | < 30 分钟   | Infrastructure Maintainer   |
| 合规遵从度       | 98%+        | Legal Compliance Checker    |
| 利益相关方满意度 | 4.5/5       | Executive Summary Generator |
| 流程效率提升     | 每季度 20%+ | Workflow Optimizer          |

---

## 15. 快速上手激活指南

### 15.1 NEXUS-Full 激活（企业级）

```bash
# Step 1: Initialize NEXUS pipeline
"Activate Agents Orchestrator in NEXUS-Full mode for [PROJECT NAME].
 Project specification: [path to spec file].
 Execute complete 7-phase pipeline with all quality gates."

# The Orchestrator will:
# 1. Read the project specification
# 2. Activate Phase 0 agents for discovery
# 3. Progress through all phases with quality gates
# 4. Manage Dev↔QA loops automatically
# 5. Report status at each phase boundary
```

### 15.2 NEXUS-Sprint 激活（功能/MVP）

```bash
# Step 1: Initialize sprint pipeline
"Activate Agents Orchestrator in NEXUS-Sprint mode for [FEATURE/MVP NAME].
 Requirements: [brief description or path to spec].
 Skip Phase 0 (market already validated).
 Begin at Phase 1 with architecture and sprint planning."

# Recommended agent subset (15-25):
# PM: Senior Project Manager, Sprint Prioritizer, Project Shepherd
# Design: UX Architect, UI Designer, Brand Guardian
# Engineering: Frontend Developer, Backend Architect, DevOps Automator
# + AI Engineer or Mobile App Builder (if applicable)
# Testing: Evidence Collector, Reality Checker, API Tester, Performance Benchmarker
# Support: Analytics Reporter, Infrastructure Maintainer
# Specialized: Agents Orchestrator
```

### 15.3 NEXUS-Micro 激活（定向任务）

```bash
# Step 1: Direct agent activation
"Activate [SPECIFIC AGENT] for [TASK DESCRIPTION].
 Context: [relevant background].
 Deliverable: [specific output expected].
 Quality check: Evidence Collector to verify upon completion."

# Common NEXUS-Micro configurations:
#
# Bug Fix:
#   Backend Architect → API Tester → Evidence Collector
#
# Content Campaign:
#   Content Creator → Social Media Strategist → Twitter Engager
#   + Instagram Curator + Reddit Community Builder
#
# Performance Issue:
#   Performance Benchmarker → Infrastructure Maintainer → DevOps Automator
#
# Compliance Audit:
#   Legal Compliance Checker → Executive Summary Generator
#
# Market Research:
#   Trend Researcher → Analytics Reporter → Executive Summary Generator
#
# UX Improvement:
#   UX Researcher → UX Architect → Frontend Developer → Evidence Collector
```

### 15.4 Agent 激活提示词模板

#### 给 Orchestrator（流水线启动）

```
You are the Agents Orchestrator running NEXUS pipeline for [PROJECT].

Project spec: [path]
Mode: [Full/Sprint/Micro]
Current phase: [Phase N]

Execute the NEXUS protocol:
1. Read the project specification
2. Activate Phase [N] agents per the NEXUS strategy
3. Manage handoffs using the NEXUS Handoff Template
4. Enforce quality gates before phase advancement
5. Track all tasks with status reporting
6. Run Dev↔QA loops for all implementation tasks
7. Escalate after 3 failed attempts per task

Report format: NEXUS Pipeline Status Report (see template in strategy doc)
```

#### 给开发型 Agent（任务实现）

```
You are [AGENT NAME] working within the NEXUS pipeline.

Phase: [Current Phase]
Task: [Task ID and description from Sprint Prioritizer backlog]
Architecture reference: [path to architecture doc]
Design system: [path to CSS/design tokens]
Brand guidelines: [path to brand doc]

Implement this task following:
1. The architecture specification exactly
2. The design system tokens and patterns
3. The brand guidelines for visual consistency
4. Accessibility standards (WCAG 2.1 AA)

When complete, your work will be reviewed by Evidence Collector.
Acceptance criteria: [specific criteria from task list]
```

#### 给 QA 型 Agent（任务验证）

```
You are [QA AGENT] validating work within the NEXUS pipeline.

Phase: [Current Phase]
Task: [Task ID and description]
Developer: [Which agent implemented this]
Attempt: [N] of 3 maximum

Validate against:
1. Task acceptance criteria: [specific criteria]
2. Architecture specification: [path]
3. Brand guidelines: [path]
4. Performance requirements: [specific thresholds]

Provide verdict: PASS or FAIL
If FAIL: Include specific issues, evidence, and fix instructions
Use the NEXUS QA Feedback Loop Protocol format
```

---

## 附录 A：部门速查

### Engineering Division — "Build It Right"（把它做对）

| Agent              | Superpower                                   | Activation Trigger    |
| ------------------ | -------------------------------------------- | --------------------- |
| Frontend Developer | React/Vue/Angular、Core Web Vitals、可访问性 | 任何 UI 实现任务      |
| Backend Architect  | 可扩展系统、数据库设计、API 架构             | 服务端架构或 API 工作 |
| Mobile App Builder | iOS/Android、React Native、Flutter           | 移动应用开发          |
| AI Engineer        | ML 模型、LLM、RAG 系统、数据管道             | 任何 AI/ML 功能       |
| DevOps Automator   | CI/CD、IaC、Kubernetes、监控                 | 基础设施或部署工作    |
| Rapid Prototyper   | Next.js、Supabase、3 天 MVP                  | 快速验证或概念验证    |
| Senior Developer   | Laravel/Livewire、高端实现                   | 复杂或高端功能工作    |

### Design Division — "Make It Beautiful"（把它做美）

| Agent                 | Superpower                   | Activation Trigger       |
| --------------------- | ---------------------------- | ------------------------ |
| UI Designer           | 视觉设计系统、组件库         | 界面设计或组件创建       |
| UX Researcher         | 用户测试、行为分析、用户画像 | 用户研究或可用性测试     |
| UX Architect          | CSS 系统、布局框架、技术 UX  | 技术基础或架构           |
| Brand Guardian        | 品牌标识、一致性、定位       | 品牌战略或一致性审计     |
| Visual Storyteller    | 视觉叙事、多媒体内容         | 视觉内容或叙事需求       |
| Whimsy Injector       | 微交互、愉悦感、个性         | 为 UX 增添乐趣与个性     |
| Image Prompt Engineer | AI 图像生成提示词、摄影      | 为 AI 工具创建摄影提示词 |

### Marketing Division — "Grow It Fast"（让它快速增长）

| Agent                    | Superpower                 | Activation Trigger |
| ------------------------ | -------------------------- | ------------------ |
| Growth Hacker            | 病毒式循环、漏斗优化、实验 | 用户获取或增长战略 |
| Content Creator          | 多平台内容、编辑日历       | 内容战略或创作     |
| Twitter Engager          | 实时互动、思想领导力       | Twitter/X 营销活动 |
| TikTok Strategist        | 病毒式短视频、算法优化     | TikTok 增长战略    |
| Instagram Curator        | 视觉叙事、美学塑造         | Instagram 营销活动 |
| Reddit Community Builder | 真实互动、价值驱动内容     | Reddit 社区战略    |
| App Store Optimizer      | ASO、转化优化              | 移动应用商店存在感 |
| Social Media Strategist  | 跨平台战略、营销活动       | 多平台社交活动     |

### Product Division — "Build the Right Thing"（构建正确的东西）

| Agent                | Superpower                | Activation Trigger    |
| -------------------- | ------------------------- | --------------------- |
| Sprint Prioritizer   | RICE 评分、敏捷规划、速率 | sprint 规划或待办梳理 |
| Trend Researcher     | 市场情报、竞争分析        | 市场研究或机会评估    |
| Feedback Synthesizer | 用户反馈分析、情感分析    | 用户反馈处理          |

### Project Management Division — "Keep It on Track"（保持正轨）

| Agent                  | Superpower                 | Activation Trigger |
| ---------------------- | -------------------------- | ------------------ |
| Studio Producer        | 组合战略、高管编排         | 战略规划或组合管理 |
| Project Shepherd       | 跨职能协调、利益相关方对齐 | 复杂项目协调       |
| Studio Operations      | 日常效率、流程优化         | 运营支持           |
| Experiment Tracker     | A/B 测试、假设验证         | 实验管理           |
| Senior Project Manager | 规格转任务、现实的范围界定 | 任务规划或范围管理 |

### Testing Division — "Prove It Works"（证明它可用）

| Agent                   | Superpower                 | Activation Trigger |
| ----------------------- | -------------------------- | ------------------ |
| Evidence Collector      | 基于截图的 QA、视觉证据    | 任何视觉核实需求   |
| Reality Checker         | 基于证据的认证、怀疑式评估 | 最终集成测试       |
| Test Results Analyzer   | 测试评估、质量指标         | 测试输出分析       |
| Performance Benchmarker | 负载测试、性能优化         | 性能测试           |
| API Tester              | API 验证、集成测试         | API 端点测试       |
| Tool Evaluator          | 技术评估、工具选型         | 技术评估           |
| Workflow Optimizer      | 流程分析、效率改进         | 流程优化           |

### Support Division — "Sustain It"（维系它）

| Agent                       | Superpower                 | Activation Trigger |
| --------------------------- | -------------------------- | ------------------ |
| Support Responder           | 客户服务、问题解决         | 客户支持需求       |
| Analytics Reporter          | 数据分析、仪表盘、KPI 追踪 | 商业智能或报告     |
| Finance Tracker             | 财务规划、预算管理         | 财务分析或预算     |
| Infrastructure Maintainer   | 系统可靠性、性能优化       | 基础设施管理       |
| Legal Compliance Checker    | 合规、法规、法务审查       | 法务或合规需求     |
| Executive Summary Generator | 高管层沟通、SCQA 框架      | 高管层报告         |

### Spatial Computing Division — "Immerse Them"（让他们沉浸）

| Agent                             | Superpower              | Activation Trigger |
| --------------------------------- | ----------------------- | ------------------ |
| XR Interface Architect            | 空间交互设计            | AR/VR/XR 界面设计  |
| macOS Spatial/Metal Engineer      | Swift、Metal、高性能 3D | macOS 空间计算     |
| XR Immersive Developer            | WebXR、浏览器端 AR/VR   | 浏览器端沉浸式体验 |
| XR Cockpit Interaction Specialist | 座舱式控制              | 沉浸式控制界面     |
| visionOS Spatial Engineer         | Apple Vision Pro 开发   | Vision Pro 应用    |
| Terminal Integration Specialist   | CLI 工具、终端工作流    | 开发者工具集成     |

### Specialized Division — "Connect Everything"（连接一切）

| Agent                       | Superpower               | Activation Trigger  |
| --------------------------- | ------------------------ | ------------------- |
| Agents Orchestrator         | 多 agent 流水线管理      | 任何多 agent 工作流 |
| Analytics Reporter          | 商业智能、深度分析       | 深度数据分析        |
| LSP/Index Engineer          | 语言服务器协议、代码智能 | 代码智能系统        |
| Sales Data Extraction Agent | Excel 监控、销售指标提取 | 销售数据摄取        |
| Data Consolidation Agent    | 销售数据聚合、仪表盘报告 | 区域和销售代表报告  |
| Report Distribution Agent   | 自动化报告分发           | 定时报告分发        |

---

## 附录 B：NEXUS 流水线状态报告模板

```markdown
# NEXUS Pipeline Status Report

## Pipeline Metadata

- **Project**: [Name]
- **Mode**: [Full / Sprint / Micro]
- **Current Phase**: [0-6]
- **Started**: [Timestamp]
- **Estimated Completion**: [Timestamp]

## Phase Progress

| Phase          | Status         | Completion | Gate Result |
| -------------- | -------------- | ---------- | ----------- |
| 0 - Discovery  | ✅ Complete    | 100%       | PASSED      |
| 1 - Strategy   | ✅ Complete    | 100%       | PASSED      |
| 2 - Foundation | 🔄 In Progress | 75%        | PENDING     |
| 3 - Build      | ⏳ Pending     | 0%         | —           |
| 4 - Harden     | ⏳ Pending     | 0%         | —           |
| 5 - Launch     | ⏳ Pending     | 0%         | —           |
| 6 - Operate    | ⏳ Pending     | 0%         | —           |

## Current Phase Detail

**Phase**: [N] - [Name]
**Active Agents**: [List]
**Tasks**: [Completed/Total]
**Current Task**: [ID] - [Description]
**QA Status**: [PASS/FAIL/IN_PROGRESS]
**Retry Count**: [N/3]

## Quality Metrics

- Tasks passed first attempt: [X/Y] ([Z]%)
- Average retries per task: [N]
- Critical issues found: [Count]
- Critical issues resolved: [Count]

## Risk Register

| Risk          | Severity | Status                    | Owner   |
| ------------- | -------- | ------------------------- | ------- |
| [Description] | [P0-P3]  | [Active/Mitigated/Closed] | [Agent] |

## Next Actions

1. [Immediate next step]
2. [Following step]
3. [Upcoming milestone]

---

**Report Generated**: [Timestamp]
**Orchestrator**: Agents Orchestrator
**Pipeline Health**: [ON_TRACK / AT_RISK / BLOCKED]
```

---

## 附录 C：NEXUS 术语表

| Term                     | Definition                                                      |
| ------------------------ | --------------------------------------------------------------- |
| **NEXUS**                | Network of EXperts, Unified in Strategy（专家网络，统一于战略） |
| **Quality Gate**         | 阶段之间的强制检查点，需要基于证据的批准                        |
| **Dev↔QA Loop**          | 持续的开发-测试循环，每项任务必须通过 QA 才能继续               |
| **Handoff**              | agent 之间工作与上下文的结构化传递                              |
| **Gate Keeper**          | 有权批准或拒绝阶段推进的 agent                                  |
| **Escalation**           | 在重试耗尽后将受阻任务路由至更高权威                            |
| **NEXUS-Full**           | 启用全部 agent 的完整流水线激活                                 |
| **NEXUS-Sprint**         | 用于功能/MVP 工作的 15-25 个 agent 的聚焦流水线                 |
| **NEXUS-Micro**          | 用于特定任务的 5-10 个 agent 的定向激活                         |
| **Pipeline Integrity**   | 不通过质量关卡任何阶段都不得推进的原则                          |
| **Context Continuity**   | 每次交接都携带完整上下文的原则                                  |
| **Evidence Over Claims** | 质量评估需要证据而非断言的原则                                  |

---

<div align="center">

**🌐 NEXUS：9 个部门。7 个阶段。一个统一的战略。🌐**

_从发现到持续运营——每个 agent 都清楚自己的角色、时机和交接。_

</div>
