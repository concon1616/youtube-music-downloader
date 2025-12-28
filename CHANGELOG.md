# Changelog

All notable changes to YouTube Downloader will be documented in this file.

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
