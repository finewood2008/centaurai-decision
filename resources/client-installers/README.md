# Client installers (bundled with the server)

Native client installers placed in this directory are bundled into the packaged
app via electron-builder `extraResources` (→ `<resources>/client-installers`)
and served by the WebUI at:

- `GET /api/downloads/list` — list available installers
- `GET /api/downloads/get?file=<name>` — download one

Browser users reach them in **Settings → Download Client** after logging into
the server's WebUI. The installers are **not** published to any public site.

## What to drop here

Built installers, named like the electron-builder `artifactName`:

```
CentaurAI-<version>-win-x64.exe
CentaurAI-<version>-mac-arm64.dmg
CentaurAI-<version>-mac-x64.dmg
CentaurAI-<version>-linux-x64.AppImage
```

Recognized extensions: `.exe .msi .zip .dmg .pkg .AppImage .deb .rpm`.
OS/arch/version are inferred from the filename, so keep the standard naming.

A typical release flow: build the per-platform installers, copy the ones you
want to distribute into this folder, then build the **server** package so they
ship inside it.

## Override

Set `AIONUI_INSTALLER_DIR=/path/to/dir` to serve installers from a different
location at runtime (e.g. an admin-managed folder outside the app bundle).

> This folder is intentionally kept in git (via `.gitkeep`) but the installer
> binaries themselves are **not** committed.
