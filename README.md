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

## Updating to a new version without losing data

This matters a lot for a business system, so here's exactly how it works
and what to watch out for.

**Why updates are safe by default:** `%APPDATA%\Ledger\` is completely
separate from wherever the program itself gets installed (Program Files,
or wherever you chose). Running a new `Ledger Setup x.x.x.exe` over an
existing install only replaces the program files — it never touches
`%APPDATA%`, exactly like updating Chrome or Word doesn't erase your
documents. So a normal update (uninstall old version if prompted, install
new one) keeps every borrower, loan, and payment intact automatically.

**One rule to not break this:** don't change `"productName"` or
`"appId"` in `package.json` between builds. Windows uses those to decide
where `%APPDATA%` points, so changing either would make the new version
look for its data in a different folder and appear "empty" even though
the old data is still sitting untouched at the old location. As long as
you keep rebuilding from this same project (or a copy of it with those
two fields unchanged), you're safe.

**Automatic backups, on top of that:** every time the app starts, and
every time anything is saved, it also copies the data file into:

```
%APPDATA%\Ledger\backups\
```

keeping the last 20 copies, each named with a timestamp. This is a safety
net for the rare cases an installer/update process could go wrong (a
crash mid-update, antivirus interference, etc.) — if `ledger-store.json`
is ever missing or corrupted after an update, close the app, go to that
`backups` folder, copy the most recent `ledger-store.<timestamp>.json`
file back into the parent folder, and rename it to `ledger-store.json`.

**Extra precaution before any major update:** it costs nothing to
manually copy `%APPDATA%\Ledger\ledger-store.json` somewhere safe (a USB
drive, cloud folder, email to yourself) right before installing a new
version, purely as a second safety net beyond the automatic one above.

## Multiple computers / staff

Each Windows install has its own separate local data file — they do not
sync with each other automatically. If several people need to work from
the same up-to-date records, either:

- Run Ledger on one shared computer that everyone uses, or
- Manually copy `ledger-store.json` between machines at the end of each day.

A proper multi-computer/cloud-synced version is a bigger project (it would
need a real backend server) — worth doing later if the business grows past
one front desk.
