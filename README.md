# Ledger — Desktop (Windows & macOS)

This packages the Ledger money lending app as a normal desktop program that
installs and runs fully offline. Records live in a local encrypted SQLite
database on the computer it's installed on — nothing is synced or sent
anywhere.

## What changed from the Claude.ai version

The screen layout and workflow are the same, but storage is now local and
built for real books rather than a single JSON blob:

- A local SQLite database (`ledger.db`) replaces the old single-file store.
- The database is encrypted at rest with SQLCipher, and the key is protected
  by the operating system's secure storage where available.
- Screens load data in pages through Electron's IPC bridge, with searching,
  filtering, and totals calculated inside SQLite. This keeps the app fast
  even with hundreds of thousands of payments.
- Passwords and login checks run in the Electron main process (PBKDF2,
  salted, 100,000 iterations).
- Automatic recovery backups are readable JSON snapshots.

## One-time setup

You'll need [Node.js](https://nodejs.org) installed (the free LTS version).
This step needs internet access once, to download the packaging tools.

```
npm install
```

`npm install` also rebuilds the SQLite native module for the exact Electron
version used by the app (the `postinstall` script runs `electron-rebuild`).
If you ever change the Electron version, run:

```
npm run rebuild
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
4. When it finishes (a few minutes), click into that run, scroll to
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

## Build the macOS installer

```
npm run dist:mac
```

This produces `.dmg` and `.zip` files in `release/`. The included
`.github/workflows/build-mac.yml` workflow builds the same artifacts on a
GitHub macOS runner.

## Security

Three things worth knowing about how Ledger protects data on the machine
it's installed on:

- **Passwords are never stored in plain text.** Each user's password is
  hashed (PBKDF2, salted, 100,000 iterations) before it touches disk.
  Nobody, including someone with direct access to the database file, can
  read a password back out of it.
- **The database itself is encrypted at rest.** `ledger.db` is a
  SQLCipher-encrypted SQLite database. Opening it in a normal SQLite tool
  shows unreadable data, not your business records.
- **The database key is protected by the OS when possible.** The key lives
  in `ledger.key`; Electron's `safeStorage` encrypts it with Windows DPAPI,
  the macOS Keychain, or the Linux keyring when available. If no OS
  keyring is available, the key file is written with owner-only permissions
  (mode 0600), so protecting the computer account still protects the data.
- **Automatic backups are plain JSON**, not encrypted copies. The rolling
  snapshots in the app's `backups` folder are readable `.json` files so
  they can be inspected, copied, and restored with any JSON-capable tool.
  Treat that folder with the same care as any other unencrypted business
  record.

When `safeStorage` is available, the key is tied to the specific operating
system account that installed and runs Ledger. That has one important
consequence: **a raw copy of `ledger.db` without its `ledger.key` will not
open on a different computer, or even a different account on the same
computer.** For anything involving moving or restoring data elsewhere,
always use the in-app **Settings → Download full backup** button instead of
copying the files directly. That produces a portable file that restores
anywhere via **Settings → Restore from backup file**. See the next section
for details.

## Where the data lives

The app keeps its data in Electron's normal per-app data folder.

Windows:

```
%APPDATA%\Ledger\ledger.db
%APPDATA%\Ledger\ledger.key
%APPDATA%\Ledger\backups\
```

macOS:

```
~/Library/Application Support/Ledger/ledger.db
~/Library/Application Support/Ledger/ledger.key
~/Library/Application Support/Ledger/backups/
```

`ledger.db` is the encrypted live database. `ledger.key` is the small key
file described above; keep it with the database but never share it.

On first launch after upgrading from an older version, Ledger imports the
old `ledger-store.dat` / `ledger-store.json` file once. The old file is
deliberately left in place so it remains available as a fallback. Encrypted
`.bak` backups written by older builds are converted to `.json` snapshots
on launch.

Automatic recovery backups are complete, readable JSON snapshots:

```
backups/ledger-store.<timestamp>.json
```

## Backups

Ledger writes a full JSON snapshot:

- when the app starts, and
- after data changes (debounced to at most one snapshot every few minutes,
  and never more often than every 30 minutes).

It keeps the most recent 20 automatic snapshots, with a 2 GB cap on the
backup folder. Snapshots include borrowers, loans, payments, collateral,
expenses, external funding, users, settings, and the audit log.

Manual backups use the same JSON format:

- **Settings → Download full backup** saves a portable JSON file wherever
  you choose.
- **Settings → Restore from backup file** replaces the live data with the
  selected snapshot. It accepts these JSON snapshots, older full backups,
  and the old `ledger-store.json` contents.
- Per-screen CSV / Excel / PDF exports are still available for sharing or
  accounting; they are not full backups.

Because the automatic snapshots are unencrypted, store the `backups` folder
somewhere you would store any other private business record, and copy
important snapshots to a separate drive occasionally.

## Updating to a new version without losing data

This matters a lot for a business system, so here's exactly how it works
and what to watch out for.

**Why updates are safe by default:** the per-app data folder is completely
separate from wherever the program itself gets installed (Program Files,
or wherever you chose). Running a new `Ledger Setup x.x.x.exe` over an
existing install only replaces the program files, it never touches the
data folder, exactly like updating Chrome or Word doesn't erase your
documents. So a normal update (uninstall old version if prompted, install
new one) keeps every borrower, loan, and payment intact automatically.

**One rule to not break this:** don't change `"productName"` or
`"appId"` in `package.json` between builds. The operating system uses those
to decide where the per-app data folder points, so changing either would
make the new version look for its data in a different folder and appear
"empty" even though the old data is still sitting untouched at the old
location. As long as you keep rebuilding from this same project (or a copy
of it with those two fields unchanged), you're safe.

**Automatic backups, on top of that:** the rolling JSON snapshots in the
`backups` folder are a safety net for the rare cases an installer/update
process could go wrong (a crash mid-update, antivirus interference, etc.).
If the database is ever missing or corrupted after an update, close the app
and use **Settings → Restore from backup file** with the most recent
`.json` snapshot.

**The most reliable option, always available:** use **Settings → Download
full backup** inside the app itself regularly (weekly, or before any major
change). Unlike the raw database and key files, this export is portable and
not tied to one computer or OS account, so it also works as your plan for
moving Ledger to a new computer entirely: install Ledger fresh there, then
**Settings → Restore from backup file** using that exported file.

## Multiple computers / staff

Each install has its own separate local database — installs do not sync
with each other automatically. If several people need to work from the
same up-to-date records, either:

- Run Ledger on one shared computer that everyone uses, or
- Use **Settings → Download full backup** on one machine and **Settings →
  Restore from backup file** on another to sync manually at the end of each
  day.

A proper multi-computer/cloud-synced version is a bigger project (it would
need a real backend server) — worth doing later if the business grows past
one front desk.

## Scale and performance

The local database is designed to stay usable well past a million payment
records. List screens request one page at a time over IPC; searches,
filtering, grouping, and dashboard/report totals run as SQL queries backed
by indexes instead of loading the whole ledger into the browser window.

On a machine with 1,000,000 payments (10,000 borrowers and 10,000 loans),
the main screens and the JSON backup export were measured in roughly this
range:

| Operation | Time |
| --- | --- |
| Payment list, first page | under 50 ms |
| Payment list, deep page (page 5,000) | about 1 second |
| Payment search by borrower, loan number, or reference | under 100 ms |
| Borrower list / dashboard / reports | under 200 ms |
| Full JSON backup export (~217 MB) | 10–15 seconds |
| Warm app startup | under 100 ms |

The first launch after the SQLite upgrade does a one-time totals
verification and index build, which can take a few seconds on a very large
legacy ledger. Subsequent launches are fast.
