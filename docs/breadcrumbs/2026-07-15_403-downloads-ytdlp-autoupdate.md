# Fixing intermittent 403 download failures + yt-dlp auto-update (v1.4.0)

**Conversation ID:** `f564511a-bc7e-4d64-8830-61ba45b8855b`
**Date:** 2026-07-15

## Context
User reported a specific video (`lvrGBYRZllc`, Bill Evans - "I Love You") "wasn't
downloading" in the app. Needed root-cause, not a guess.

## Decision / Outcome
Root cause found via the app's own debug log (`/tmp/ytdownloader-debug.log`): the
**info step succeeded** (`--dump-json` returned title/metadata) but the **media
download step failed** with `ERROR: unable to download video data: HTTP Error 403:
Forbidden`, four times in a row as the user retried. The video itself was fully
downloadable - both yt-dlp steps worked fine from the CLI with the same system
binary. So the failure was environmental/timing, not the video, command, or app
plumbing.

Contributing factors:
1. System yt-dlp was stale (`2026.03.17`, >90 days old). YouTube changes its
   player/signature scheme constantly; old yt-dlp gets intermittent 403s on the
   download step. This was the primary lever - upgrading to `2026.07.04` fixed the
   immediate failure (the app shells out to system yt-dlp, so even the old build
   benefited immediately).
2. The app made two YouTube hits per download (`--dump-json` then a separate
   download process) and the user retried 4× in 30s - a rate-limit-shaped pattern.
3. The app had no 403 handling: `--extractor-retries` only retries *metadata
   extraction*, not the media download that was actually 403ing. One 403 =
   instant dead-end, no client fallback.

Shipped in v1.4.0:
- `autoUpdateYtDlp()` (src/main.js) - on launch, throttled to once/24h via a stamp
  file in userData, non-blocking, silent on failure. `brew upgrade yt-dlp` for
  Homebrew installs (detected via realpath containing `/Cellar/` or `/homebrew/`),
  else `yt-dlp -U`. Keeps yt-dlp current so this class of 403 stops recurring.
- `YT_RESILIENCE_ARGS` spliced into both audio and video download arg arrays:
  `--retries 10 --fragment-retries 10 --file-access-retries 3` plus
  `--extractor-args youtube:player_client=default,web_safari,android_vr`. A single
  403 now retries / switches player clients instead of failing.
- Build fix: `npm run build` DMG step was dying on `which python` (macOS/Homebrew
  ships only `python3`), and after shimming that, dmgbuild crashed under Python
  3.14 (`pyexpat` ImportError: `_XML_SetAllocTrackerActivationThreshold` missing
  against system libexpat). Fixed with `build-tools/python`, a PATH-injected shim
  that picks the first `python3.x` whose `pyexpat` imports (prefers 3.12).

## Rationale
- `tv` client was deliberately excluded from the player_client list - it emits a
  DRM-format-skipped warning and can steer format selection toward DRM'd streams.
  `android_vr` was the client that succeeded in every manual test.
- Auto-update is throttled + non-blocking so it never delays the UI or hammers
  brew/network on every launch.
- The python shim is project-local and version-probing rather than a global
  symlink or a hardcoded `python3.14` path - portable and won't rot when Python
  bumps.

## Impact
- Downloads survive transient YouTube 403s instead of dead-ending.
- yt-dlp stays current automatically - the single biggest cause of YouTube
  breakage is now self-healing.
- `npm run build` produces a DMG again (`dist/YouTube Downloader-1.4.0-arm64.dmg`).
- Debug log remains the first place to look for download failures - it records the
  yt-dlp path, full args, download exit code + stderr, and auto-update results.

## Chain of Events
1. Located the app (`~/Projects/youtube-music-downloader`, Electron wrapping yt-dlp).
2. Ran the URL through yt-dlp directly - downloaded fine. Ruled out the video.
3. Ran the app's exact `--dump-json` info step - also fine. Ruled out metadata.
4. Read `/tmp/ytdownloader-debug.log` - found the 403 on the download step, 4×.
5. Reproduced the app's exact download command - it worked *now*, confirming the
   403 was intermittent, not deterministic.
6. Confirmed yt-dlp was Homebrew-managed (not pip, despite its own misleading
   self-update warning) and 4 months stale. Upgraded via brew → fixed immediately.
7. Hardened the app (auto-update + resilience flags), bumped 1.3.0→1.4.0, verified
   JS parses and the hardened command downloads end-to-end.
8. Rebuilt: hit the `which python` + Python 3.14 pyexpat wall. Built the version-
   probing shim. DMG built. Installed the signed .app (also cleaned up a corrupted
   nested-.app from a prior botched install).
9. Committed + pushed. Later downloaded the actual video into ~/Movies/Videos on
   request (earlier downloads had only been throwaway /tmp test copies).

## Thoughts
Textbook "works on CLI, fails in app" that turned out to be neither - same binary,
same command, intermittent external cause. The debug log was the decisive evidence;
without it this would have been guesswork. The build fix was an unplanned rabbit
hole (two stacked Python problems) but the version-probing shim is the right durable
answer. Auto-update is the real win: it converts a recurring manual-upgrade chore
into a self-healing property.
