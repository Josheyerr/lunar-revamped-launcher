# Lunar Revamped Launcher

Desktop launcher for **Lunar Revamped** (Minecraft **1.8.9**). It installs the client from GitHub Releases, signs in with Microsoft or an offline username, and launches `com.moonsworth.lunar.genesis.Genesis` with the local FakeLauncher / FakeBackend (no Lunar production relay).

## Setup

```bash
npm install
```

## Dev

```bash
npm run dev
```

The window loads the Vite renderer. Point **Settings → Dev runtime** at a checkout of the remake (default `F:\Projects\LunarClientremake-main` when that folder exists) so Play works before a client release is published.

## Build a Windows installer

```bash
npm run dist
```

Output: `release/LunarRevampedSetup.exe`

## Share an installer

Push a tag on `lunar-revamped-launcher`:

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions (`.github/workflows/release-launcher.yml`) publishes the NSIS installer. Pushing that workflow needs a token with the `workflow` scope (`gh auth refresh -s workflow`). Stable link:

`https://github.com/Josheyerr/lunar-revamped-launcher/releases/latest/download/LunarRevampedSetup.exe`

People who already installed the app get the same release through `electron-updater`.

## Client releases

From a machine that has the remake tree:

```bash
node scripts/package-client.mjs --runtime F:/Projects/LunarClientremake-main --version 1.0.0 --publish
```

That uploads a zip to `Josheyerr/lunar-revamped-client`. The launcher downloads it from Play.

## Data

Settings and instances live in `%APPDATA%\.lunar-revamped\`.

## Java

The launcher ships a small PVP Java kit (timer agent + forwarder) and downloads **GraalVM CE 21** on first launch into `%APPDATA%\.lunar-revamped\runtimes\`. That becomes the default Java. Temurin 21 remains a fallback if the Graal download fails. Java 8 cannot run the client.
