const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');

// Extended PATH for spawned processes (needed for deno, ffmpeg, etc.)
const extendedPath = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  process.env.PATH
].join(':');

const spawnEnv = { ...process.env, PATH: extendedPath };

// Debug logging to file
const logFile = '/tmp/ytdownloader-debug.log';
function debugLog(msg) {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
  console.log(msg);
}

let mainWindow;
let downloadPath = path.join(app.getPath('home'), 'Movies'); // Root folder for downloads
let currentDownloadProcess = null; // Track current download for cancellation

// Ensure download folders exist
function ensureDownloadFolders() {
  const audioPath = path.join(downloadPath, 'Audio');
  const videoPath = path.join(downloadPath, 'Videos');
  fs.mkdirSync(audioPath, { recursive: true });
  fs.mkdirSync(videoPath, { recursive: true });
  return { audioPath, videoPath };
}

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
      '--cookies-from-browser', 'chrome',
      url
    ];

    let output = '';
    let errorOutput = '';

    const process = spawn(ytdlp, args, { env: spawnEnv });

    process.stdout.on('data', (data) => {
      output += data.toString();
    });

    process.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    process.on('close', (code) => {
      if (code !== 0) {
        debugLog('get-info failed with code: ' + code);
        debugLog('get-info error: ' + errorOutput);
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
  downloadCancelled = false;

  return new Promise((resolve, reject) => {
    const ytdlp = getYtDlpPath();
    const ffmpeg = getFfmpegPath();
    const tempDir = path.join(app.getPath('temp'), 'ytmusic-' + Date.now());

    // Use Audio subfolder
    const { audioPath } = ensureDownloadFolders();
    const finalOutputDir = audioPath;

    debugLog('=== DOWNLOAD TRACK DEBUG ===');
    debugLog('yt-dlp path: ' + ytdlp);
    debugLog('ffmpeg path: ' + ffmpeg);
    debugLog('temp dir: ' + tempDir);
    debugLog('output dir: ' + finalOutputDir);

    fs.mkdirSync(tempDir, { recursive: true });

    // First get full metadata
    const infoArgs = [
      '--dump-json',
      '--no-warnings',
      '--cookies-from-browser', 'chrome',
      url
    ];

    let infoOutput = '';
    let infoError = '';
    const infoProcess = spawn(ytdlp, infoArgs, { env: spawnEnv });

    infoProcess.stdout.on('data', (data) => {
      infoOutput += data.toString();
    });

    infoProcess.stderr.on('data', (data) => {
      infoError += data.toString();
    });

    infoProcess.on('close', async (infoCode) => {
      if (infoCode !== 0) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        reject(new Error('Failed to get track info: ' + infoError));
        return;
      }

      let info;
      try {
        info = JSON.parse(infoOutput);
      } catch (e) {
        fs.rmSync(tempDir, { recursive: true, force: true });
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

      const tempAudioTemplate = path.join(tempDir, 'audio.%(ext)s');
      const tempThumb = path.join(tempDir, 'thumbnail.jpg');
      const finalFile = path.join(finalOutputDir, `${safeArtist} - ${safeTitle}.m4a`);

      // Download audio - use flexible format selection
      const downloadArgs = [
        '-f', 'bestaudio/best',
        '-x',
        '--audio-format', 'm4a',
        '--audio-quality', '0',
        '--ffmpeg-location', path.dirname(ffmpeg),
        '-o', tempAudioTemplate,
        '--no-playlist',
        '--progress',
        '--cookies-from-browser', 'chrome',
        '--no-check-certificates',
        '--extractor-retries', '3',
        url
      ];

      let dlError = '';
      const downloadProcess = spawn(ytdlp, downloadArgs, { env: spawnEnv });
      currentDownloadProcess = downloadProcess;

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
        dlError += data.toString();
        const match = data.toString().match(/(\d+\.?\d*)%/);
        if (match) {
          mainWindow.webContents.send('download-progress', {
            percent: parseFloat(match[1]),
            title: title
          });
        }
      });

      downloadProcess.on('close', async (downloadCode) => {
        debugLog('Download process closed with code: ' + downloadCode);
        debugLog('Download stderr: ' + dlError);

        // List temp directory contents
        const tempFiles = fs.readdirSync(tempDir);
        debugLog('Temp dir contents: ' + JSON.stringify(tempFiles));
        tempFiles.forEach(f => {
          const stats = fs.statSync(path.join(tempDir, f));
          debugLog(`  ${f}: ${stats.size} bytes`);
        });

        if (downloadCode !== 0 || downloadCancelled) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          if (downloadCancelled) {
            reject(new Error('Download cancelled'));
          } else {
            reject(new Error('Failed to download audio: ' + dlError));
          }
          return;
        }

        mainWindow.webContents.send('download-progress', {
          percent: 100,
          title: title,
          status: 'Processing...'
        });

        // Find the downloaded audio file
        const files = fs.readdirSync(tempDir);
        const audioFile = files.find(f => f.startsWith('audio.') && (f.endsWith('.m4a') || f.endsWith('.mp3') || f.endsWith('.webm') || f.endsWith('.opus') || f.endsWith('.aac')));

        if (!audioFile) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          reject(new Error('Downloaded audio file not found. Files in temp: ' + files.join(', ')));
          return;
        }

        const tempAudio = path.join(tempDir, audioFile);

        // Download thumbnail if available
        let hasThumb = false;
        if (thumbnail) {
          try {
            await downloadThumbnail(thumbnail, tempThumb);
            hasThumb = fs.existsSync(tempThumb);
          } catch (e) {
            // Ignore thumbnail errors
          }
        }

        // Use ffmpeg to add metadata and artwork
        let ffmpegArgs;
        if (hasThumb) {
          // For m4a with artwork, need specific format
          // Re-encode to 44.1kHz AAC for iPod compatibility
          ffmpegArgs = [
            '-i', tempAudio,
            '-i', tempThumb,
            '-map', '0:a',
            '-map', '1:v',
            '-c:a', 'aac_at',
            '-b:a', '256k',
            '-ar', '44100',
            '-c:v', 'mjpeg',
            '-disposition:v:0', 'attached_pic',
            '-metadata', `title=${title}`,
            '-metadata', `artist=${artist}`,
            '-metadata', `album=${album}`,
            '-y',
            finalFile
          ];
        } else {
          // Re-encode to 44.1kHz AAC for iPod compatibility (Apple encoder)
          ffmpegArgs = [
            '-i', tempAudio,
            '-c:a', 'aac_at',
            '-b:a', '256k',
            '-ar', '44100',
            '-metadata', `title=${title}`,
            '-metadata', `artist=${artist}`,
            '-metadata', `album=${album}`,
            '-y',
            finalFile
          ];
        }

        debugLog('hasThumb: ' + hasThumb);
        debugLog('FFmpeg args: ' + ffmpegArgs.join(' '));

        let ffmpegErr = '';
        const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'], env: spawnEnv });

        // Close stdin immediately so ffmpeg doesn't wait for input
        ffmpegProcess.stdin.end();

        ffmpegProcess.stderr.on('data', (data) => {
          ffmpegErr += data.toString();
        });

        ffmpegProcess.on('error', (err) => {
          debugLog('FFmpeg spawn error: ' + err.message);
          // Try to copy the raw file as fallback
          try {
            fs.copyFileSync(tempAudio, finalFile);
          } catch (e) {
            // Ignore
          }
          fs.rmSync(tempDir, { recursive: true, force: true });
          resolve({
            success: true,
            file: finalFile,
            title: title,
            artist: artist,
            album: album
          });
        });

        ffmpegProcess.on('close', (ffmpegCode) => {
          debugLog('FFmpeg closed with code: ' + ffmpegCode);
          debugLog('FFmpeg stderr: ' + ffmpegErr.substring(0, 500));

          // Check if output file was created AND has content
          let outputValid = false;
          try {
            const stats = fs.statSync(finalFile);
            outputValid = stats.size > 0;
            debugLog('Output file size: ' + stats.size);
          } catch (e) {
            debugLog('Output file does not exist');
          }

          if (!outputValid && fs.existsSync(tempAudio)) {
            // If ffmpeg failed to create valid output, copy the raw file
            debugLog('Copying raw audio file as fallback');
            try {
              fs.copyFileSync(tempAudio, finalFile);
            } catch (e) {
              fs.rmSync(tempDir, { recursive: true, force: true });
              reject(new Error('Failed to copy audio file'));
              return;
            }
          }

          // Clean up temp files
          fs.rmSync(tempDir, { recursive: true, force: true });

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
    ensureDownloadFolders(); // Create Audio/ and Videos/ subfolders
    return downloadPath;
  }
  return null;
});

// Get current download path
ipcMain.handle('get-download-path', () => {
  ensureDownloadFolders(); // Ensure folders exist on startup
  return downloadPath;
});

// Open folder in Finder (show specific file)
ipcMain.handle('open-folder', async (event, folderPath) => {
  shell.showItemInFolder(folderPath);
});

// Open root download folder
ipcMain.handle('open-root-folder', async () => {
  shell.openPath(downloadPath);
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

// Stop current download
let downloadCancelled = false;

ipcMain.handle('stop-download', async () => {
  debugLog('Stop download requested');
  downloadCancelled = true;

  try {
    // Kill all yt-dlp and ffmpeg processes started by this app
    const { execSync } = require('child_process');

    // Kill yt-dlp processes
    try {
      execSync('pkill -9 -f yt-dlp', { stdio: 'ignore' });
      debugLog('Killed yt-dlp processes');
    } catch (e) {
      // No processes to kill
    }

    // Kill ffmpeg processes
    try {
      execSync('pkill -9 -f ffmpeg', { stdio: 'ignore' });
      debugLog('Killed ffmpeg processes');
    } catch (e) {
      // No processes to kill
    }

    if (currentDownloadProcess) {
      try {
        currentDownloadProcess.kill('SIGKILL');
      } catch (e) {
        // Already dead
      }
      currentDownloadProcess = null;
    }
  } catch (e) {
    debugLog('Error stopping download: ' + e.message);
  }

  return { stopped: true };
});

// Download a video as MP4
ipcMain.handle('download-video', async (event, url, outputDir, ipodFormat = false) => {
  downloadCancelled = false;

  return new Promise((resolve, reject) => {
    const ytdlp = getYtDlpPath();
    const ffmpeg = getFfmpegPath();
    const tempDir = path.join(app.getPath('temp'), 'ytvideo-' + Date.now());

    // Use Videos subfolder
    const { videoPath } = ensureDownloadFolders();
    const finalOutputDir = videoPath;

    debugLog('=== DOWNLOAD VIDEO DEBUG ===');
    debugLog('iPod format: ' + ipodFormat);
    debugLog('output dir: ' + finalOutputDir);

    fs.mkdirSync(tempDir, { recursive: true });

    // First get full metadata
    const infoArgs = [
      '--dump-json',
      '--no-warnings',
      '--cookies-from-browser', 'chrome',
      url
    ];

    let infoOutput = '';
    const infoProcess = spawn(ytdlp, infoArgs, { env: spawnEnv });

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
      const thumbnail = info.thumbnail || (info.thumbnails && info.thumbnails.length > 0 ? info.thumbnails[info.thumbnails.length - 1].url : null);

      // Clean filename
      const safeTitle = title.replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
      const safeArtist = artist.replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);

      const tempFile = path.join(tempDir, 'video.%(ext)s');
      const tempThumb = path.join(tempDir, 'thumbnail.jpg');
      const finalFile = path.join(finalOutputDir, `${safeArtist} - ${safeTitle}.mp4`);

      // Download video with best quality, using ffmpeg for merging
      const downloadArgs = [
        '-f', 'bestvideo+bestaudio/best',
        '--merge-output-format', 'mp4',
        '--ffmpeg-location', path.dirname(ffmpeg),
        '-o', tempFile,
        '--no-playlist',
        '--progress',
        '--cookies-from-browser', 'chrome',
        '--no-check-certificates',
        '--extractor-retries', '3',
        url
      ];

      const downloadProcess = spawn(ytdlp, downloadArgs, { env: spawnEnv });
      currentDownloadProcess = downloadProcess;

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
        if (downloadCode !== 0 || downloadCancelled) {
          fs.rmSync(tempDir, { recursive: true, force: true });
          if (downloadCancelled) {
            reject(new Error('Download cancelled'));
          } else {
            reject(new Error('Failed to download video'));
          }
          return;
        }

        mainWindow.webContents.send('download-progress', {
          percent: 100,
          title: title,
          status: ipodFormat ? 'Converting for iPod...' : 'Processing...'
        });

        // Find the downloaded file in temp dir
        const files = fs.readdirSync(tempDir);
        const videoFile = files.find(f => f.endsWith('.mp4') || f.endsWith('.mkv') || f.endsWith('.webm'));

        if (videoFile) {
          const tempVideoPath = path.join(tempDir, videoFile);

          if (ipodFormat) {
            // Download thumbnail for iPod video
            let hasThumb = false;
            if (thumbnail) {
              try {
                await downloadThumbnail(thumbnail, tempThumb);
                hasThumb = fs.existsSync(tempThumb);
                debugLog('Thumbnail downloaded: ' + hasThumb);
              } catch (e) {
                debugLog('Thumbnail download failed: ' + e.message);
              }
            }

            // Convert to iPod-compatible format: H.264 Baseline, 640x480, AAC
            // Use .m4v extension which iTunes prefers for video
            const ipodFile = finalFile.replace(/\.mp4$/, '.m4v');

            // Build ffmpeg args - add thumbnail as attachment if available
            const ffmpegArgs = [
              '-i', tempVideoPath,
              ...(hasThumb ? ['-i', tempThumb] : []),
              '-map', '0:v',
              '-map', '0:a',
              ...(hasThumb ? ['-map', '1:v', '-disposition:v:1', 'attached_pic'] : []),
              '-vf', 'scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2,setsar=1',
              '-c:v:0', 'libx264',
              '-profile:v:0', 'baseline',
              '-level:v:0', '3.0',
              '-preset', 'medium',
              '-crf', '23',
              ...(hasThumb ? ['-c:v:1', 'mjpeg'] : []),
              '-c:a', 'aac_at',
              '-b:a', '128k',
              '-ar', '44100',
              '-ac', '2',
              '-metadata', `title=${title}`,
              '-metadata', `artist=${artist}`,
              '-movflags', '+faststart',
              '-y',
              ipodFile
            ];

            debugLog('iPod conversion args: ' + ffmpegArgs.join(' '));

            const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { env: spawnEnv });
            let ffmpegErr = '';
            ffmpegProcess.stderr.on('data', (data) => {
              ffmpegErr += data.toString();
              const timeMatch = data.toString().match(/time=(\d+):(\d+):(\d+)/);
              if (timeMatch) {
                mainWindow.webContents.send('download-progress', {
                  percent: 99,
                  title: title,
                  status: 'Converting for iPod...'
                });
              }
            });

            ffmpegProcess.on('close', (code) => {
              debugLog('iPod video ffmpeg exit code: ' + code);
              if (code !== 0) {
                debugLog('iPod video ffmpeg error: ' + ffmpegErr.substring(ffmpegErr.length - 2000));
              }
              fs.rmSync(tempDir, { recursive: true, force: true });

              if (code !== 0) {
                reject(new Error('Failed to convert video for iPod'));
                return;
              }

              resolve({
                success: true,
                file: ipodFile,
                title: title,
                artist: artist
              });
            });
            return;
          }

          // Re-encode audio to Apple AAC for all video formats
          const ffmpegArgs = [
            '-i', tempVideoPath,
            '-c:v', 'copy',
            '-c:a', 'aac_at',
            '-b:a', '256k',
            '-ar', '44100',
            '-y',
            finalFile
          ];

          debugLog('Regular video conversion args: ' + ffmpegArgs.join(' '));
          const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { env: spawnEnv });
          let ffmpegErr = '';
          ffmpegProcess.stderr.on('data', (data) => {
            ffmpegErr += data.toString();
          });
          ffmpegProcess.on('close', (code) => {
            debugLog('Regular video ffmpeg exit code: ' + code);
            if (code !== 0) {
              debugLog('Regular video ffmpeg error: ' + ffmpegErr.substring(ffmpegErr.length - 2000));
            }
            fs.rmSync(tempDir, { recursive: true, force: true });

            if (code !== 0) {
              reject(new Error('Failed to convert video'));
              return;
            }

            resolve({
              success: true,
              file: finalFile,
              title: title,
              artist: artist
            });
          });
          return;
        }

        // Clean up temp dir
        fs.rmSync(tempDir, { recursive: true, force: true });

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

// iPod functions

// Check if iPod is connected
ipcMain.handle('check-ipod', async () => {
  const ipodPaths = [
    '/Volumes/iPod',
    '/Volumes/IPOD',
    '/Volumes/iPod Classic'
  ];

  for (const ipodPath of ipodPaths) {
    if (fs.existsSync(ipodPath)) {
      // Check if it has Rockbox or iPod_Control (valid iPod)
      const hasRockbox = fs.existsSync(path.join(ipodPath, '.rockbox'));
      const hasIpodControl = fs.existsSync(path.join(ipodPath, 'iPod_Control'));

      if (hasRockbox || hasIpodControl) {
        // Get free space
        try {
          const stats = fs.statfsSync(ipodPath);
          const freeSpace = stats.bfree * stats.bsize;
          return {
            connected: true,
            path: ipodPath,
            hasRockbox: hasRockbox,
            freeSpace: freeSpace
          };
        } catch (e) {
          return {
            connected: true,
            path: ipodPath,
            hasRockbox: hasRockbox,
            freeSpace: 0
          };
        }
      }
    }
  }

  return { connected: false };
});

// Copy file to iPod
ipcMain.handle('copy-to-ipod', async (event, filePath, artist, title) => {
  // Find iPod
  const ipodPaths = ['/Volumes/iPod', '/Volumes/IPOD', '/Volumes/iPod Classic'];
  let ipodPath = null;

  for (const p of ipodPaths) {
    if (fs.existsSync(p)) {
      ipodPath = p;
      break;
    }
  }

  if (!ipodPath) {
    throw new Error('iPod not connected');
  }

  // Create Music folder structure: /Volumes/iPod/Music/Artist/
  const safeArtist = (artist || 'Unknown Artist').replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
  const musicDir = path.join(ipodPath, 'Music', safeArtist);

  fs.mkdirSync(musicDir, { recursive: true });

  // Get filename from source
  const fileName = path.basename(filePath);
  const destPath = path.join(musicDir, fileName);

  // Copy file
  fs.copyFileSync(filePath, destPath);

  return {
    success: true,
    destination: destPath
  };
});

// Convert and copy video to iPod (iPod-compatible format: H.264, 640x480 max)
ipcMain.handle('video-to-ipod', async (event, filePath, artist, title) => {
  const ffmpeg = getFfmpegPath();

  // Find iPod
  const ipodPaths = ['/Volumes/iPod', '/Volumes/IPOD', '/Volumes/iPod Classic'];
  let ipodPath = null;

  for (const p of ipodPaths) {
    if (fs.existsSync(p)) {
      ipodPath = p;
      break;
    }
  }

  if (!ipodPath) {
    throw new Error('iPod not connected');
  }

  // Create Videos folder structure: /Volumes/iPod/Videos/Artist/
  const safeArtist = (artist || 'Unknown Artist').replace(/[<>:"/\\|?*]/g, '_').substring(0, 50);
  const videosDir = path.join(ipodPath, 'Videos', safeArtist);
  fs.mkdirSync(videosDir, { recursive: true });

  // Get filename and create destination path
  const baseName = path.basename(filePath, path.extname(filePath));
  const destPath = path.join(videosDir, baseName + '.mp4');

  debugLog('Converting video for iPod: ' + filePath);
  debugLog('Destination: ' + destPath);

  return new Promise((resolve, reject) => {
    // Convert to iPod-compatible format: H.264, 640x480, AAC audio
    const ffmpegArgs = [
      '-i', filePath,
      '-vf', 'scale=640:480:force_original_aspect_ratio=decrease,pad=640:480:(ow-iw)/2:(oh-ih)/2',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '23',
      '-c:a', 'aac_at',
      '-b:a', '128k',
      '-ar', '44100',
      '-movflags', '+faststart',
      '-y',
      destPath
    ];

    debugLog('FFmpeg video args: ' + ffmpegArgs.join(' '));

    const ffmpegProcess = spawn(ffmpeg, ffmpegArgs, { stdio: ['pipe', 'pipe', 'pipe'], env: spawnEnv });
    ffmpegProcess.stdin.end();

    let ffmpegErr = '';
    let lastProgress = 0;

    ffmpegProcess.stderr.on('data', (data) => {
      ffmpegErr += data.toString();
      // Parse progress from ffmpeg output
      const timeMatch = data.toString().match(/time=(\d+):(\d+):(\d+)/);
      if (timeMatch) {
        const seconds = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
        if (seconds > lastProgress) {
          lastProgress = seconds;
          mainWindow.webContents.send('download-progress', {
            percent: Math.min(95, seconds),
            title: title,
            status: `Converting for iPod... ${seconds}s`
          });
        }
      }
    });

    ffmpegProcess.on('error', (err) => {
      debugLog('FFmpeg video error: ' + err.message);
      reject(new Error('Failed to start video conversion: ' + err.message));
    });

    ffmpegProcess.on('close', (code) => {
      debugLog('FFmpeg video closed with code: ' + code);

      if (code !== 0) {
        debugLog('FFmpeg stderr: ' + ffmpegErr.substring(0, 1000));
        reject(new Error('Video conversion failed'));
        return;
      }

      // Verify output exists and has content
      try {
        const stats = fs.statSync(destPath);
        if (stats.size > 0) {
          debugLog('Video converted successfully: ' + stats.size + ' bytes');
          resolve({
            success: true,
            destination: destPath
          });
        } else {
          reject(new Error('Converted video is empty'));
        }
      } catch (e) {
        reject(new Error('Converted video not found'));
      }
    });
  });
});
