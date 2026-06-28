# 产品版本（Editions）

CentaurAI AIStation 从单一应用拆分为三个编译期版本，由 `AIONUI_EDITION` 环境变量在构建时选定，
派生标志集中在 `packages/desktop/src/common/config/constants.ts`：

| 版本                | `EDITION`      | 面向               | 核心板块                   | 网络                 |
| ------------------- | -------------- | ------------------ | -------------------------- | -------------------- |
| **核心版 / 完整版** | `full`（默认） | 开发/自测          | 全部                       | 完整                 |
| **决策版**          | `decision`     | 中小企业老板，单人 | 决策会议室（智囊团）、专家 | 单用户、仅回环       |
| **团队版**          | `team`         | 员工，多人         | 办公助理、专家、工作台     | 多用户、局域网服务器 |

派生标志：`IS_DECISION` / `IS_TEAM` / `TEAM_MODE_ENABLED` / `WORKBENCH_ENABLED` /
`MULTI_USER_ENABLED` / `OFFICE_ASSISTANTS_ENABLED`。

## 仓库与分发模型

- `centaurai-station` —— 核心/上游，两个版本的代码都在这里，靠 edition 标志门控。
- `centaurai-decision` / `centaurai-team` —— 下游 fork，各自设置自己的 `AIONUI_EDITION` 仓库变量，
  从上游 `git merge feat/edition-split` 同步，按各自的 `electron-builder.{decision,team}.yml` 发布与自动更新。

详见各 fork 根目录的 `EDITION.md`。

## 文档索引

决策版 ↔ 团队版 跨机器协作分两个平面，共用 mDNS 发现 + token 鉴权底子：

| 文档                                             | 平面                     | 主题                                                       | 状态                        |
| ------------------------------------------------ | ------------------------ | ---------------------------------------------------------- | --------------------------- |
| [shared-drive-access.md](shared-drive-access.md) | **数据平面 v1**          | 决策版访问团队版共享盘（两端看到同一份数据；本期不做汇报） | 📋 计划中（下个版本，先做） |
| [inter-edition-a2a.md](inter-edition-a2a.md)     | **控制平面（后续可选）** | 跨机器 A2A 实时通讯（日常汇报 / 实时提问 / 双向推送）      | 📋 计划中（后续）           |

决策版独有功能：

| 文档                                                     | 主题                                                                               | 状态                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------- |
| [tailscale-remote-access.md](tailscale-remote-access.md) | 决策版 Tailscale 远程访问（经私有 tailnet 从任何地方安全访问，不暴露公网/0.0.0.0） | 📋 计划中（下个版本） |
