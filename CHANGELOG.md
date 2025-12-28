# Changelog

All notable changes to YouTube Downloader will be documented in this file.

## [1.1.0] - 2024-12-28

### Added
- Video download support (MP4 format)
- Format toggle to switch between Audio (M4A) and Video (MP4)
- Best quality video with merged audio

### Changed
- Renamed app from "YouTube Music Downloader" to "YouTube Downloader"
- Updated subtitle to reflect dual format support

## [1.0.0] - 2024-12-28

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
