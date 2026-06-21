# ⚡ NEXUS 快速上手指南

> **5 分钟内，从零起步到搭建出经过编排的多 agent 流水线。**

---

## 什么是 NEXUS？

**NEXUS**（Network of EXperts, Unified in Strategy，专家网络，统一于战略）将 The Agency 的 AI 专家转变为一条协调有序的流水线。它不是逐个激活 agent 然后寄希望于它们能协同工作，而是精确定义谁在何时做什么，以及如何在每一步验证质量。

## 选择你的模式

| I want to...                             | Use              | Agents | Time     |
| ---------------------------------------- | ---------------- | ------ | -------- |
| 从零构建一个完整产品                     | **NEXUS-Full**   | All    | 12-24 周 |
| 构建一个功能或 MVP                       | **NEXUS-Sprint** | 15-25  | 2-6 周   |
| 完成一项具体任务（修 bug、做活动、审计） | **NEXUS-Micro**  | 5-10   | 1-5 天   |

---

## 🚀 NEXUS-Full：启动一个完整项目

**复制以下提示词以激活完整流水线：**

```
Activate Agents Orchestrator in NEXUS-Full mode.

Project: [YOUR PROJECT NAME]
Specification: [DESCRIBE YOUR PROJECT OR LINK TO SPEC]

Execute the complete NEXUS pipeline:
- Phase 0: Discovery (Trend Researcher, Feedback Synthesizer, UX Researcher, Analytics Reporter, Legal Compliance Checker, Tool Evaluator)
- Phase 1: Strategy (Studio Producer, Senior Project Manager, Sprint Prioritizer, UX Architect, Brand Guardian, Backend Architect, Finance Tracker)
- Phase 2: Foundation (DevOps Automator, Frontend Developer, Backend Architect, UX Architect, Infrastructure Maintainer)
- Phase 3: Build (Dev↔QA loops — all engineering + Evidence Collector)
- Phase 4: Harden (Reality Checker, Performance Benchmarker, API Tester, Legal Compliance Checker)
- Phase 5: Launch (Growth Hacker, Content Creator, all marketing agents, DevOps Automator)
- Phase 6: Operate (Analytics Reporter, Infrastructure Maintainer, Support Responder, ongoing)

Quality gates between every phase. Evidence required for all assessments.
Maximum 3 retries per task before escalation.
```

---

## 🏃 NEXUS-Sprint：构建一个功能或 MVP

**复制以下提示词：**

```
Activate Agents Orchestrator in NEXUS-Sprint mode.

Feature/MVP: [DESCRIBE WHAT YOU'RE BUILDING]
Timeline: [TARGET WEEKS]
Skip Phase 0 (market already validated).

Sprint team:
- PM: Senior Project Manager, Sprint Prioritizer
- Design: UX Architect, Brand Guardian
- Engineering: Frontend Developer, Backend Architect, DevOps Automator
- QA: Evidence Collector, Reality Checker, API Tester
- Support: Analytics Reporter

Begin at Phase 1 with architecture and sprint planning.
Run Dev↔QA loops for all implementation tasks.
Reality Checker approval required before launch.
```

---

## 🎯 NEXUS-Micro：完成一项具体任务

**选择你的场景并复制提示词：**

### 修复一个 Bug

```
Activate Backend Architect to investigate and fix [BUG DESCRIPTION].
After fix, activate API Tester to verify the fix.
Then activate Evidence Collector to confirm no visual regressions.
```

### 开展一场营销活动

```
Activate Social Media Strategist as campaign lead for [CAMPAIGN DESCRIPTION].
Team: Content Creator, Twitter Engager, Instagram Curator, Reddit Community Builder.
Brand Guardian reviews all content before publishing.
Analytics Reporter tracks performance daily.
Growth Hacker optimizes channels weekly.
```

### 进行一次合规审计

```
Activate Legal Compliance Checker for comprehensive compliance audit.
Scope: [GDPR / CCPA / HIPAA / ALL]
After audit, activate Executive Summary Generator to create stakeholder report.
```

### 排查性能问题

```
Activate Performance Benchmarker to diagnose performance issues.
Scope: [API response times / Page load / Database queries / All]
After diagnosis, activate Infrastructure Maintainer for optimization.
DevOps Automator deploys any infrastructure changes.
```

### 市场调研

```
Activate Trend Researcher for market intelligence on [DOMAIN].
Deliverables: Competitive landscape, market sizing, trend forecast.
After research, activate Executive Summary Generator for executive brief.
```

### UX 改进

```
Activate UX Researcher to identify usability issues in [FEATURE/PRODUCT].
After research, activate UX Architect to design improvements.
Frontend Developer implements changes.
Evidence Collector verifies improvements.
```

---

## 📁 战略文档

| Document                       | Purpose             | Location                                            |
| ------------------------------ | ------------------- | --------------------------------------------------- |
| **Master Strategy**            | 完整的 NEXUS 准则   | `strategy/nexus-strategy.md`                        |
| **Phase 0 Playbook**           | 发现与情报          | `strategy/playbooks/phase-0-discovery.md`           |
| **Phase 1 Playbook**           | 战略与架构          | `strategy/playbooks/phase-1-strategy.md`            |
| **Phase 2 Playbook**           | 基础与脚手架        | `strategy/playbooks/phase-2-foundation.md`          |
| **Phase 3 Playbook**           | 构建与迭代          | `strategy/playbooks/phase-3-build.md`               |
| **Phase 4 Playbook**           | 质量与加固          | `strategy/playbooks/phase-4-hardening.md`           |
| **Phase 5 Playbook**           | 上线与增长          | `strategy/playbooks/phase-5-launch.md`              |
| **Phase 6 Playbook**           | 运营与演进          | `strategy/playbooks/phase-6-operate.md`             |
| **Activation Prompts**         | 即用型 agent 提示词 | `strategy/coordination/agent-activation-prompts.md` |
| **Handoff Templates**          | 标准化交接格式      | `strategy/coordination/handoff-templates.md`        |
| **Startup MVP Runbook**        | 4-6 周 MVP 构建     | `strategy/runbooks/scenario-startup-mvp.md`         |
| **Enterprise Feature Runbook** | 企业级功能开发      | `strategy/runbooks/scenario-enterprise-feature.md`  |
| **Marketing Campaign Runbook** | 多渠道营销活动      | `strategy/runbooks/scenario-marketing-campaign.md`  |
| **Incident Response Runbook**  | 生产事件处理        | `strategy/runbooks/scenario-incident-response.md`   |

---

## 🔑 30 秒掌握核心概念

1. **Quality Gates（质量关卡）** —— 没有基于证据的批准，任何阶段都不得推进
2. **Dev↔QA Loop（Dev↔QA 闭环）** —— 每项任务先构建再测试；PASS 则继续，FAIL 则重试（最多 3 次）
3. **Handoffs（交接）** —— agent 之间的结构化上下文传递（绝不冷启动）
4. **Reality Checker** —— 最终质量权威；默认判定为"NEEDS WORK"
5. **Agents Orchestrator** —— 管理整个流程的流水线控制器
6. **Evidence Over Claims（证据优于断言）** —— 截图、测试结果和数据——而非空口断言

---

## 🎭 Agent 一览

```
ENGINEERING         │ DESIGN              │ MARKETING
Frontend Developer  │ UI Designer         │ Growth Hacker
Backend Architect   │ UX Researcher       │ Content Creator
Mobile App Builder  │ UX Architect        │ Twitter Engager
AI Engineer         │ Brand Guardian      │ TikTok Strategist
DevOps Automator    │ Visual Storyteller  │ Instagram Curator
Rapid Prototyper    │ Whimsy Injector     │ Reddit Community Builder
Senior Developer    │ Image Prompt Eng.   │ App Store Optimizer
                    │                     │ Social Media Strategist
────────────────────┼─────────────────────┼──────────────────────
PRODUCT             │ PROJECT MGMT        │ TESTING
Sprint Prioritizer  │ Studio Producer     │ Evidence Collector
Trend Researcher    │ Project Shepherd    │ Reality Checker
Feedback Synthesizer│ Studio Operations   │ Test Results Analyzer
                    │ Experiment Tracker  │ Performance Benchmarker
                    │ Senior Project Mgr  │ API Tester
                    │                     │ Tool Evaluator
                    │                     │ Workflow Optimizer
────────────────────┼─────────────────────┼──────────────────────
SUPPORT             │ SPATIAL             │ SPECIALIZED
Support Responder   │ XR Interface Arch.  │ Agents Orchestrator
Analytics Reporter  │ macOS Spatial/Metal │ Analytics Reporter
Finance Tracker     │ XR Immersive Dev    │ LSP/Index Engineer
Infra Maintainer    │ XR Cockpit Spec.    │ Sales Data Extraction
Legal Compliance    │ visionOS Spatial    │ Data Consolidation
Exec Summary Gen.   │ Terminal Integration│ Report Distribution
```

---

<div align="center">

**从一个模式开始。遵循 playbook。信任流水线。**

`strategy/nexus-strategy.md` —— 完整的准则

</div>
