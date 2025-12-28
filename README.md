# YouTube Downloader

A macOS Electron app for downloading YouTube videos and music with full metadata and artwork support. Optimized for iPod Classic sync via iTunes.

## Features

### Audio Downloads (M4A)
- High-quality AAC audio extraction
- Automatic artwork embedding from YouTube thumbnails
- Metadata: artist, title, album
- Direct copy to iPod (Rockbox)

### Video Downloads (MP4/M4V)
- Best quality video with merged audio
- **iPod Format** option for iTunes sync compatibility
  - H.264 Baseline profile, 640x480
  - .m4v format with embedded artwork
  - Compatible with iPod Classic

### iPod Integration
- Auto-detect connected iPod
- Shows free space on device
- Copy audio directly to iPod Music folder
- Convert videos to iPod-compatible format

## Requirements

Install dependencies via Homebrew:

```bash
brew install yt-dlp ffmpeg deno
```

## Installation

1. Download the latest release from [Releases](https://github.com/concon1616/youtube-music-downloader/releases)
2. Open the DMG and drag to Applications
3. Or build from source:

```bash
git clone https://github.com/concon1616/youtube-music-downloader.git
cd youtube-music-downloader
npm install
npm run build
```

## Usage

1. Launch **YouTube Downloader** from Applications
2. Select format: **Audio (M4A)** or **Video (MP4)**
3. For iPod video sync, check **iPod Format**
4. Paste a YouTube URL (video or playlist)
5. Click **Download**

### Syncing to iPod

**Audio files:**
- Import .m4a files into Apple Music/iTunes
- Sync to iPod normally

**Video files (iPod Format):**
- Import .m4v files into Apple Music/iTunes
- Files appear under Movies or Music Videos
- Sync to iPod via iTunes

## Tech Stack

- Electron 39.x
- yt-dlp for YouTube downloading
- ffmpeg for audio/video processing
- deno for YouTube JS challenge solving

## License

MIT
