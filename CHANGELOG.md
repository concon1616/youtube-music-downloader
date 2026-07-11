# Changelog

All notable changes to YouTube Downloader will be documented in this file.

## [1.4.0] - 2026-07-08 (conversation: `f564511a-bc7e-4d64-8830-61ba45b8855b`)

### Fixed
- Downloads failing with `HTTP Error 403: Forbidden` on the media-download step
  (metadata/info step succeeded, then the actual download was rejected). Root cause
  was a stale system `yt-dlp` (2026.03.17, >90 days old) combined with the app having
  no retry or client-fallback when YouTube transiently 403s a download URL. Repro'd
  via `/tmp/ytdownloader-debug.log` (4 consecutive 403s on video `lvrGBYRZllc`).

### Added
- **Automatic yt-dlp updates.** On launch (throttled to once per 24h, non-blocking,
  silent on failure) the app now keeps `yt-dlp` current so YouTube player/signature
  changes don't cause 403s. Uses `brew upgrade yt-dlp` for Homebrew installs, falls
  back to `yt-dlp -U` otherwise. See `autoUpdateYtDlp()` in `src/main.js`.
- **Download resilience flags** (`YT_RESILIENCE_ARGS`) applied to both audio and video
  downloads: `--retries 10 --fragment-retries 10 --file-access-retries 3` plus a
  multi-client fallback `--extractor-args youtube:player_client=default,web_safari,android_vr`
  so a single 403 retries / switches clients instead of dead-ending. (`tv` client
  excluded - it serves DRM-protected formats.)

### Build
- Fixed `npm run build` failing at the DMG step. electron-builder's `dmgbuild`
  calls `python`, but modern macOS/Homebrew only ships `python3`, and Python 3.14's
  bundled `pyexpat` is broken against system libexpat. Added a project-local
  `build-tools/python` shim (PATH-injected by the build script) that resolves
  `python` to the first `python3.x` with a working `pyexpat` (prefers 3.12).
  No global changes. `npm run build` now produces `dist/YouTube Downloader-1.4.0-arm64.dmg`.

## [1.3.0] - 2025-12-28

### Added
- Load button to preview video/playlist info before downloading
- Stop button to cancel downloads in progress
- Preview shows title, artist, duration, and thumbnail

## [1.2.4] - 2025-12-28

### Fixed
- Switch to Apple AudioToolbox AAC encoder (aac_at) for better iPod compatibility
- Remove async resampling filter that may have caused audio artifacts
- Should eliminate clicking/popping sounds on iPod playback

## [1.2.3] - 2025-12-28

### Fixed
- iPod video conversion failing when thumbnail present (profile applied to wrong stream)
- Use stream-specific profile/level flags for H.264 encoding

## [1.2.2] - 2025-12-28

### Fixed
- Audio downloads now properly re-encoded to 44.1kHz AAC (was copying 48kHz)
- Added debug logging for video conversion errors
- Higher audio bitrate (256kbps) for better quality

## [1.2.1] - 2025-12-28

### Fixed
- Audio clicking/noise on iPod caused by sample rate conversion issues
- Added async resampling filter to smooth audio discontinuities
- Explicit 44.1kHz sample rate for iPod compatibility

## [1.2.0] - 2025-12-28

### Added
- iPod sync support for audio files (direct copy to iPod)
- iPod video conversion (640x480 H.264 Baseline for iPod Classic)
- "iPod Format" checkbox for iTunes-compatible video downloads (.m4v)
- Thumbnail/artwork embedding in iPod format videos
- iPod connection status indicator with free space display
- YouTube cookie authentication (bypasses bot detection)
- Extended PATH support for spawned processes (deno for JS challenges)

### Fixed
- Audio downloads now work reliably with artwork
- Fixed ffmpeg thumbnail embedding for m4a files
- Fixed YouTube n-challenge solving by ensuring deno is accessible
- More flexible format selection with retries

### Technical
- Uses Chrome cookies for YouTube authentication
- H.264 Baseline profile, level 3.0 for iPod compatibility
- Automatic retry on format selection failures

## [1.1.0] - 2025-12-28

### Added
- Video download support (MP4 format)
- Format toggle to switch between Audio (M4A) and Video (MP4)
- Best quality video with merged audio

### Changed
- Renamed app from "YouTube Music Downloader" to "YouTube Downloader"
- Updated subtitle to reflect dual format support

## [1.0.0] - 2025-12-28

### Added
- Initial release of YouTube Music Downloader
- Electron-based Mac app for downloading YouTube music
- High-quality M4A audio output with AAC encoding
- Automatic artwork embedding from YouTube thumbnails
- Metadata extraction (artist, song title, album name)
- Playlist/album support - download entire playlists
- Download queue with progress indicators
- Custom download folder selection
- Clean blue gradient app icon with white inner border

### Dependencies
- Requires `yt-dlp` and `ffmpeg` installed via Homebrew
- Install with: `brew install yt-dlp ffmpeg`

### Technical
- Built with Electron 39.x
- Uses yt-dlp for YouTube downloading
- Uses ffmpeg for audio processing and metadata embedding
