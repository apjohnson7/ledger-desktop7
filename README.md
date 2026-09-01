# Ledger — Desktop (Windows)

This packages the Ledger money lending app as a normal Windows program that
installs and runs fully offline. Data is saved to a local file on the
computer it's installed on (nothing is synced or sent anywhere).

## What changed from the Claude.ai version

The app's own code (`src/App.jsx`) is **completely unchanged**. The only
addition is a small storage layer (`electron/main.js` + `electron/preload.js`)
that gives `window.storage` a real file on disk to read and write instead of
Claude's artifact storage. Everything else — screens, logic, styling — is
exactly what you saw in the chat.

## One-time setup

You'll need [Node.js](https://nodejs.org) installed (the free LTS version).
This step needs internet access once, to download the packaging tools.

```
npm install
```

## Run it while developing (optional)

```
npm run dev
```

This opens the app in a desktop window with live-reload, useful for testing
changes before building the installer.

## Build the Windows installer

You're on a Mac — cross-building a Windows `.exe` locally needs Wine, which
can be unreliable (especially on Apple Silicon). Two options, pick one:

### Option A — Build it in the cloud with GitHub Actions (recommended)

This uses a free, real Windows machine in the cloud to build the installer,
so nothing needs to work on your Mac at all.

1. Create a free [GitHub](https://github.com) account if you don't have one.
2. Create a new repository and push this project folder to it:
   ```
   git init
   git add .
   git commit -m "Ledger desktop app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<repo-name>.git
   git push -u origin main
   ```
3. On GitHub, open your repo → the **Actions** tab → you'll see the
   "Build Windows Installer" workflow run automatically (it's already
   included in this project, at `.github/workflows/build-windows.yml`).
4. When it finishes (a couple of minutes), click into that run, scroll to
   **Artifacts**, and download `ledger-windows-installer` — unzip it to get
   `Ledger Setup 1.0.0.exe`.
5. Copy that `.exe` to any Windows computer and run it to install.

If you'd rather not push to GitHub, you can also trigger a build manually
from the Actions tab any time using the "Run workflow" button, without
needing a `push`.

### Option B — Cross-build locally on your Mac with Wine

```
brew install --cask wine-stable
npm run dist
```

electron-builder detects Wine automatically and uses it to assemble the
Windows installer. If this errors out (common on Apple Silicon Macs),
switch to Option A instead of fighting with Wine.

### Option C — Build directly on a Windows PC

The most bulletproof option if you have any Windows machine handy (even a
borrowed one, or a free-tier Windows VM): copy this folder over, install
Node.js, then run `npm install` and `npm run dist` there directly.

---

Whichever option you use, the result is the same: a `.exe` installer
inside `release/`. Copy that file to the target Windows computer and run
it — no internet, no Node.js, no dependencies needed there. It installs
like any normal Windows program, with a Start Menu entry and optional
desktop shortcut.

## Where the data lives

Each install keeps its own data at:

```
%APPDATA%\Ledger\ledger-store.json
```

Back this file up regularly (copy it somewhere safe) — it's the entire
business's records. To move the app to a new computer, install Ledger
there and copy this file into the same folder.

## Multiple computers / staff

Each Windows install has its own separate local data file — they do not
sync with each other automatically. If several people need to work from
the same up-to-date records, either:

- Run Ledger on one shared computer that everyone uses, or
- Manually copy `ledger-store.json` between machines at the end of each day.

A proper multi-computer/cloud-synced version is a bigger project (it would
need a real backend server) — worth doing later if the business grows past
one front desk.
