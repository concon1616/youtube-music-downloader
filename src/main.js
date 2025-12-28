const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

let mainWindow;
let downloadPath = app.getPath('downloads');

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 600,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Find yt-dlp binary
function getYtDlpPath() {
  const possiblePaths = [
    '/usr/local/bin/yt-dlp',
    '/opt/homebrew/bin/yt-dlp',
    '/usr/bin/yt-dlp',
    path.join(process.env.HOME, '.local/bin/yt-dlp')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return 'yt-dlp'; // Fallback to PATH
}

// Find ffmpeg binary
function getFfmpegPath() {
  const possiblePaths = [
    '/usr/local/bin/ffmpeg',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/bin/ffmpeg'
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return 'ffmpeg';
}

// Download thumbnail
function downloadThumbnail(url, filepath) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(filepath);

    protocol.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        downloadThumbnail(response.headers.location, filepath)
          .then(resolve)
          .catch(reject);
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(filepath);
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

// Get video/playlist info
ipcMain.handle('get-info', async (event, url) => {
  return new Promise((resolve, reject) => {
    const ytdlp = getYtDlpPath();
    const args = [
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      url
    ];

    let output = '';
    let errorOutput = '';

    const process = spawn(ytdlp, args);

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(errorOutput || 'Failed to get video info'));
        return;
      }

      try {
        // Handle multiple JSON objects (playlist)
        const lines = output.trim().split('\n');
        const items = lines.map(line => JSON.parse(line));

        if (items.length === 1) {
          resolve({ type: 'single', data: items[0] });
        } else {
          resolve({ type: 'playlist', data: items });
        }
      } catch (e) {
        reject(new Error('Failed to parse video info'));
      }
    });
  });
});

// Download a single track
ipcMain.handle('download-track', async (event, url, outputDir) => {
  return new Promise((resolve, reject) => {
    const ytdlp = getYtDlpPath();
    const ffmpeg = getFfmpegPath();
    const tempDir = path.join(app.getPath('temp'), 'ytmusic-' + Date.now());

    fs.mkdirSync(tempDir, { recursive: true });

    // First get full metadata
    const infoArgs = [
      '--dump-json',
      '--no-warnings',
      url
    ];

    let infoOutput = '';
    const infoProcess = spawn(ytdlp, infoArgs);

    infoProcess.stdout.on('data', (data) => {
      infoOutput += data.toString();
    });

    infoProcess.on('close', async (infoCode) => {
      if (infoCode !== 0) {
        reject(new Error('Failed to get track info'));
        return;
      }

      let info;
      try {
        info = JSON.parse(infoOutput);
      } catch (e) {
        reject(new Error('Failed to parse track info'));
        return;
      }

      // Extract metadata
      const title = info.title || 'Unknown Title';
      const artist = info.artist || info.uploader || info.channel || 'Unknown Artist';
      const album = info.album || info.playlist_title || title;
      const thumbnail = info.thumbnail || (info.thumbnails && info.thumbnails.length > 0 ? info.thumbnails[info.thumbnails.length - 1].url : null);

      // Clean filename
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
      const safeArtist = artist.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);

      const tempAudio = path.join(tempDir, 'audio.m4a');
      const tempThumb = path.join(tempDir, 'thumbnail.jpg');
      const finalFile = path.join(outputDir || downloadPath, `${safeArtist} - ${safeTitle}.m4a`);

      // Download audio
      const downloadArgs = [
        '-f', 'bestaudio[ext=m4a]/bestaudio',
        '-x',
        '--audio-format', 'm4a',
        '--audio-quality', '0',
        '-o', tempAudio,
        '--no-playlist',
        '--progress',
        url
      ];

      const downloadProcess = spawn(ytdlp, downloadArgs);

      downloadProcess.stdout.on('data', (data) => {
        const match = data.toString().match(/(\d+\.?\d*)%/);
        if (match) {
          mainWindow.webContents.send('download-progress', {
            percent: parseFloat(match[1]),
            title: title
          });
        }
      });

      downloadProcess.stderr.on('data', (data) => {
        const match = data.toString().match(/(\d+\.?\d*)%/);
        if (match) {
          mainWindow.webContents.send('download-progress', {
            percent: parseFloat(match[1]),
            title: title
          });
        }
      });

      downloadProcess.on('close', async (downloadCode) => {
        if (downloadCode !== 0) {
          reject(new Error('Failed to download audio'));
          return;
        }

        mainWindow.webContents.send('download-progress', {
          percent: 100,
          title: title,
          status: 'Processing...'
        });

        // Download thumbnail if available
        let hasThumb = false;
        if (thumbnail) {
          try {
            await downloadThumbnail(thumbnail, tempThumb);
            hasThumb = fs.existsSync(tempThumb);
          } catch (e) {
            console.log('Thumbnail download failed:', e.message);
          }
        }

        // Use ffmpeg to add metadata and artwork
        const ffmpegArgs = [
          '-i', tempAudio,
          ...(hasThumb ? ['-i', tempThumb] : []),
          '-map', '0:a',
          ...(hasThumb ? ['-map', '1:0'] : []),
          '-c:a', 'copy',
          ...(hasThumb ? ['-c:v', 'mjpeg', '-disposition:v', 'attached_pic'] : []),
          '-metadata', `title=${title}`,
          '-metadata', `artist=${artist}`,
          '-metadata', `album=${album}`,
          '-y',
          finalFile
        ];

        const ffmpegProcess = spawn(ffmpeg, ffmpegArgs);

        ffmpegProcess.on('close', (ffmpegCode) => {
          // Clean up temp files
          fs.rmSync(tempDir, { recursive: true, force: true });

          if (ffmpegCode !== 0) {
            // If ffmpeg fails, try to just copy the file without artwork
            fs.copyFileSync(tempAudio, finalFile);
          }

          resolve({
            success: true,
            file: finalFile,
            title: title,
            artist: artist,
            album: album
          });
        });
      });
    });
  });
});

// Select download folder
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    defaultPath: downloadPath
  });

  if (!result.canceled && result.filePaths.length > 0) {
    downloadPath = result.filePaths[0];
    return downloadPath;
  }
  return null;
});

// Get current download path
ipcMain.handle('get-download-path', () => {
  return downloadPath;
});

// Open folder in Finder
ipcMain.handle('open-folder', async (event, folderPath) => {
  shell.showItemInFolder(folderPath);
});

// Check dependencies
ipcMain.handle('check-dependencies', async () => {
  const ytdlp = getYtDlpPath();
  const ffmpeg = getFfmpegPath();

  const ytdlpExists = fs.existsSync(ytdlp) || await checkCommand(ytdlp);
  const ffmpegExists = fs.existsSync(ffmpeg) || await checkCommand(ffmpeg);

  return {
    ytdlp: ytdlpExists,
    ffmpeg: ffmpegExists
  };
});

function checkCommand(cmd) {
  return new Promise((resolve) => {
    const process = spawn('which', [cmd]);
    process.on('close', (code) => {
      resolve(code === 0);
    });
  });
}

// Download a video as MP4
ipcMain.handle('download-video', async (event, url, outputDir) => {
  return new Promise((resolve, reject) => {
    const ytdlp = getYtDlpPath();
    const tempDir = path.join(app.getPath('temp'), 'ytvideo-' + Date.now());

    fs.mkdirSync(tempDir, { recursive: true });

    // First get full metadata
    const infoArgs = [
      '--dump-json',
      '--no-warnings',
      url
    ];

    let infoOutput = '';
    const infoProcess = spawn(ytdlp, infoArgs);

    infoProcess.stdout.on('data', (data) => {
      infoOutput += data.toString();
    });

    infoProcess.on('close', async (infoCode) => {
      if (infoCode !== 0) {
        reject(new Error('Failed to get video info'));
        return;
      }

      let info;
      try {
        info = JSON.parse(infoOutput);
      } catch (e) {
        reject(new Error('Failed to parse video info'));
        return;
      }

      // Extract metadata
      const title = info.title || 'Unknown Title';
      const artist = info.artist || info.uploader || info.channel || 'Unknown Artist';

      // Clean filename
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
      const safeArtist = artist.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);

      const finalFile = path.join(outputDir || downloadPath, `${safeArtist} - ${safeTitle}.mp4`);

      // Download video with best quality
      const downloadArgs = [
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        '--merge-output-format', 'mp4',
        '-o', finalFile,
        '--no-playlist',
        '--progress',
        url
      ];

      const downloadProcess = spawn(ytdlp, downloadArgs);

      downloadProcess.stdout.on('data', (data) => {
        const match = data.toString().match(/(\d+\.?\d*)%/);
        if (match) {
          mainWindow.webContents.send('download-progress', {
            percent: parseFloat(match[1]),
            title: title
          });
        }
      });

      downloadProcess.stderr.on('data', (data) => {
        const match = data.toString().match(/(\d+\.?\d*)%/);
        if (match) {
          mainWindow.webContents.send('download-progress', {
            percent: parseFloat(match[1]),
            title: title
          });
        }
      });

      downloadProcess.on('close', async (downloadCode) => {
        // Clean up temp dir
        fs.rmSync(tempDir, { recursive: true, force: true });

        if (downloadCode !== 0) {
          reject(new Error('Failed to download video'));
          return;
        }

        mainWindow.webContents.send('download-progress', {
          percent: 100,
          title: title,
          status: 'Complete!'
        });

        resolve({
          success: true,
          file: finalFile,
          title: title,
          artist: artist
        });
      });
    });
  });
});
