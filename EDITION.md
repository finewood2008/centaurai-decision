# CentaurAI 决策版 · Decision Edition

This is a **downstream distribution** of
[centaurai-station](https://github.com/finewood2008/centaurai-station) — the core / full app.
It is built as the **Decision edition** (`AIONUI_EDITION=decision`):

- Single-user **决策作战室** (智囊团 / multi-agent decision room), reframed as the boss's
  decision war-room.
- **No** workbench / image studio, **no** multi-user WebUI server (loopback only).

The edition split lives in the **core**, behind a build-time flag that defaults to
`full`. This repo selects `decision` via the GitHub **repo variable**
`AIONUI_EDITION=decision` (Settings → Secrets and variables → Actions → Variables) —
no source fork of the build logic, so upstream merges stay conflict-free.

## Pull core updates from upstream

```bash
./scripts/sync-upstream.sh        # adds the upstream remote if missing, then merges upstream/main
```

## Build locally

```bash
bun install
bun run build-mac:decision        # or build-win:decision / build-deb:decision
# Plain `bun dev` runs the FULL app; for the decision UI use:
AIONUI_EDITION=decision bun dev
```

## Release

Push a version tag (e.g. `v2.5.0`). The inherited **Build and Release** workflow reads
`AIONUI_EDITION=decision` (repo variable) and builds + publishes the decision installers
to this repo's Releases.
