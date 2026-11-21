const { app, BrowserWindow } = require('electron');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  const file = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(__dirname, '..', 'dist', file.replace(/^\//, ''));
  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath);
    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.statusCode = 404;
    res.end();
  }
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const framesDir = path.join(__dirname, '..', '.temp_frames');
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(framesDir, 'queue'), { recursive: true });
  fs.mkdirSync(path.join(framesDir, 'theme'), { recursive: true });
  fs.mkdirSync(path.join(framesDir, 'download'), { recursive: true });

  const win = new BrowserWindow({
    width: 1060,
    height: 700,
    show: false,
    frame: true,
    webPreferences: {
      preload: path.join(__dirname, 'mock_preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log('[Renderer]', message);
  });

  await win.loadURL(`http://127.0.0.1:${port}`);
  await sleep(1800);

  async function evalSafe(code) {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (e) {
      console.error('[Eval error]', e.message, 'in code:', code.slice(0, 100));
    }
  }

  async function snap(dir, index) {
    const img = await win.webContents.capturePage();
    const filename = path.join(framesDir, dir, `frame_${String(index).padStart(3, '0')}.png`);
    fs.writeFileSync(filename, img.toPNG());
  }

  // =========================================================================
  // 1. SCENARIO 1: demo-queue.gif
  // =========================================================================
  console.log('Capturing real demo-queue frames...');
  // Ensure we are on workspace and in dark or light mode
  await evalSafe(`
    window.archivist.setSettings({ reduceMotion: true });
    document.querySelector('.brand')?.click();
  `);
  await sleep(500);

  let frameIdx = 0;
  // Initial empty state
  for (let i = 0; i < 4; i++) {
    await snap('queue', frameIdx++);
    await sleep(80);
  }

  // Type "@natgeo"
  const textToType = '@natgeo';
  for (let i = 1; i <= textToType.length; i++) {
    const sub = textToType.slice(0, i);
    await evalSafe(`(() => {
      const el = document.querySelector('.wb-entry input');
      if (el) {
        el.value = ${JSON.stringify(sub)};
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.focus();
      }
    })()`);
    await sleep(70);
    await snap('queue', frameIdx++);
  }

  // Hold typed text
  await snap('queue', frameIdx++);
  await snap('queue', frameIdx++);

  // Click chips (Reels, Stories)
  await evalSafe(`(() => {
    const allChips = Array.from(document.querySelectorAll('.wb-chip'));
    const rChip = allChips.find(c => c.textContent.includes('Reels'));
    if (rChip) rChip.click();
  })()`);
  await sleep(180);
  await snap('queue', frameIdx++);
  await snap('queue', frameIdx++);

  await evalSafe(`(() => {
    const allChips = Array.from(document.querySelectorAll('.wb-chip'));
    const sChip = allChips.find(c => c.textContent.includes('Stories'));
    if (sChip) sChip.click();
  })()`);
  await sleep(180);
  await snap('queue', frameIdx++);
  await snap('queue', frameIdx++);

  // Click "Queue download" button
  await evalSafe(`(() => {
    const qBtn = document.querySelector('.wb-btn-primary');
    if (qBtn) qBtn.click();
  })()`);
  await sleep(250);

  // Toast visible and job queued in activity
  for (let i = 0; i < 8; i++) {
    await snap('queue', frameIdx++);
    await sleep(120);
  }

  // =========================================================================
  // 2. SCENARIO 2: demo-theme.gif
  // =========================================================================
  console.log('Capturing real demo-theme frames (Light -> Dark -> GTA VI)...');
  // Start in Light mode
  await evalSafe(`
    localStorage.setItem('yoinkstagram_theme', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
    document.querySelector('.brand')?.click();
  `);
  await sleep(600);

  let themeFrame = 0;
  // Light mode view
  for (let i = 0; i < 6; i++) {
    await snap('theme', themeFrame++);
    await sleep(100);
  }

  // Switch to Obsidian Dark mode
  await evalSafe(`
    document.querySelector('.theme-toggle-btn')?.click();
  `);
  await sleep(500);

  // Dark mode view
  for (let i = 0; i < 7; i++) {
    await snap('theme', themeFrame++);
    await sleep(100);
  }

  // Switch to GTA VI Vice City theme!
  await evalSafe(`
    document.querySelector('.theme-toggle-btn')?.click();
  `);
  await sleep(500);

  // GTA VI theme view
  for (let i = 0; i < 8; i++) {
    await snap('theme', themeFrame++);
    await sleep(120);
  }

  // =========================================================================
  // 3. SCENARIO 3: demo-download.gif
  // =========================================================================
  console.log('Capturing real demo-download frames (Queue & Auto-Resume)...');
  // Navigate to Download queue
  await evalSafe(`(() => {
    const qL = Array.from(document.querySelectorAll('.rail-link')).find(l => l.textContent.includes('Download queue') || l.textContent.includes('queue'));
    if (qL) qL.click();
  })()`);
  await sleep(500);

  let dlFrame = 0;
  // State 1: Active download running
  await evalSafe(`
    window.archivist._setState({
      cooldownUntil: null,
      jobs: [
        {
          id: 'dl-active',
          request: { targetType: 'profile', targets: ['ghumabooooo'], destination: 'C:\\\\Users\\\\Mehenuf\\\\Downloads\\\\Yoinkstagram' },
          status: 'running',
          phase: 'Downloading posts',
          items: 28,
          files: 54,
          createdAt: Date.now() - 300000,
          updatedAt: Date.now(),
          logs: [{ message: 'Archiving @ghumabooooo media items...', level: 'info' }]
        }
      ]
    });
  `);
  await sleep(300);

  for (let i = 0; i < 5; i++) {
    await evalSafe(`
      window.archivist._setState({
        jobs: [
          {
            id: 'dl-active',
            request: { targetType: 'profile', targets: ['ghumabooooo'], destination: 'C:\\\\Users\\\\Mehenuf\\\\Downloads\\\\Yoinkstagram' },
            status: 'running',
            phase: 'Downloading posts (${54 + i * 8}/120 files)',
            items: ${28 + i * 4},
            files: ${54 + i * 8},
            createdAt: Date.now() - 300000,
            updatedAt: Date.now(),
            logs: [{ message: 'Saved post ${54 + i * 8}', level: 'info' }]
          }
        ]
      });
    `);
    await snap('download', dlFrame++);
    await sleep(150);
  }

  // State 2: Cooldown triggered (Instagram asks for pause)
  const cooldownDeadline = Date.now() + 15 * 60 * 1000;
  await evalSafe(`
    window.archivist._setState({
      cooldownUntil: ${cooldownDeadline},
      jobs: [
        {
          id: 'dl-active',
          request: { targetType: 'profile', targets: ['ghumabooooo'], destination: 'C:\\\\Users\\\\Mehenuf\\\\Downloads\\\\Yoinkstagram' },
          status: 'cooldown',
          phase: 'Cooling down (Attempt 1)',
          message: 'Instagram requested a pause. Yoinkstagram is cooling down (~15 min) and will automatically resume.',
          items: 45,
          files: 86,
          createdAt: Date.now() - 300000,
          updatedAt: Date.now(),
          logs: [{ message: 'Cooldown entered.', level: 'warn' }]
        }
      ]
    });
  `);
  await sleep(300);

  for (let i = 0; i < 6; i++) {
    await snap('download', dlFrame++);
    await sleep(150);
  }

  // State 3: Cooldown expires and auto-resumes to completion
  await evalSafe(`
    window.archivist._setState({
      cooldownUntil: null,
      jobs: [
        {
          id: 'dl-active',
          request: { targetType: 'profile', targets: ['ghumabooooo'], destination: 'C:\\\\Users\\\\Mehenuf\\\\Downloads\\\\Yoinkstagram' },
          status: 'completed',
          phase: 'Completed',
          message: 'Download completed successfully. 120 media items saved.',
          items: 65,
          files: 120,
          createdAt: Date.now() - 300000,
          updatedAt: Date.now(),
          logs: [{ message: 'Finished archiving @ghumabooooo.', level: 'info' }]
        }
      ]
    });
  `);
  await sleep(400);

  for (let i = 0; i < 6; i++) {
    await snap('download', dlFrame++);
    await sleep(150);
  }

  console.log('All real frames captured successfully!');
  app.quit();
  server.close();
  process.exit(0);
}

app.whenReady().then(run);
