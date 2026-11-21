import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, safeStorage, session, shell, net } from 'electron';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absolutePath } from './job-request.mjs';
import { ArchiveQueue } from './queue.mjs';
import { SessionVault } from './vault.mjs';
import { WorkerHost } from './worker.mjs';

const projectPath = dirname(dirname(fileURLToPath(import.meta.url)));
const distPath = join(projectPath, 'dist');
const prodOrigin = 'archivist://app/';
const allowedDevOrigins = new Set(['http://127.0.0.1:5173', 'http://127.0.0.1:4173']);
const devURL = !app.isPackaged && allowedDevOrigins.has(process.env.ARCHIVIST_DEV_URL) ? process.env.ARCHIVIST_DEV_URL : null;
const platformHosts = new Set(['instagram.com', 'www.instagram.com', 'help.instagram.com', 'accountscenter.instagram.com']);
const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/vnd.microsoft.icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.json': 'application/json', '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const csp = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
  "img-src 'self' data: blob:", "media-src 'self' data: blob:", "connect-src 'self'",
  "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "frame-ancestors 'none'", "object-src 'none'",
].join('; ');

let window = null;
let queue = null;
let shuttingDown = false;

protocol.registerSchemesAsPrivileged([{
  scheme: 'archivist', privileges: { standard: true, secure: true, supportFetchAPI: true },
}]);

async function serveAsset(request) {
  try {
    const url = new URL(request.url);
    if (url.host !== 'app' || request.method !== 'GET') return new Response(null, { status: 403 });
    const filename = resolve(distPath, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    const fromDist = relative(distPath, filename);
    if (!fromDist || fromDist === '..' || fromDist.startsWith(`..${sep}`) || isAbsolute(fromDist)) {
      return new Response(null, { status: 403 });
    }
    return new Response(await readFile(filename), {
      headers: {
        'Content-Type': contentTypes[extname(filename).toLowerCase()] ?? 'application/octet-stream',
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

function isTrustedURL(value) {
  try {
    const url = new URL(value);
    if (devURL) return url.origin === devURL;
    return url.protocol === 'archivist:' && url.host === 'app' && ['/', '/index.html'].includes(url.pathname);
  } catch {
    return false;
  }
}

function createWindow() {
  const icon = join(projectPath, 'build', 'app.ico');
  window = new BrowserWindow({
    title: 'Yoinkstagram',
    width: 1440,
    height: 960,
    minWidth: 780,
    minHeight: 650,
    show: false,
    backgroundColor: '#fbfafc',
    ...(existsSync(icon) ? { icon } : {}),
    ...(process.platform === 'win32' ? {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#fbfafc', symbolColor: '#27222c', height: 46 },
    } : {}),
    webPreferences: {
      preload: join(projectPath, 'desktop', 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: !app.isPackaged,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => {
    if (!isTrustedURL(event.url)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
  return window.loadURL(devURL ?? prodOrigin);
}

function handle(channel, handler) {
  ipcMain.handle(`archivist:${channel}`, (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame
      || !isTrustedURL(event.senderFrame?.url)) {
      throw new Error('This action is available only from the Yoinkstagram window.');
    }
    return handler(...args);
  });
}

function registerActions() {
  handle('get-state', () => queue.snapshot());
  handle('get-job-logs', (id) => queue.getJobLogs(id));
  handle('enqueue', (request) => queue.enqueue(request));
  handle('pause', (paused) => queue.pauseQueue(paused));
  handle('cancel', (id) => queue.cancelJob(id));
  handle('retry', (id) => queue.retryJob(id));
  handle('remove', (id) => queue.removeJob(id));
  handle('settings', (settings) => queue.setSettings(settings));

  handle('choose-directory', async () => {
    const destination = queue.destination;
    const selection = await dialog.showOpenDialog(window, {
      title: 'Choose the archive folder',
      defaultPath: existsSync(destination) ? destination : app.getPath('downloads'),
      properties: ['openDirectory', 'createDirectory'],
    });
    return selection.canceled ? null : selection.filePaths[0] ?? null;
  });
  handle('choose-metadata', async () => {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Select Instaloader metadata', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Instaloader metadata', extensions: ['json', 'xz'] }],
    });
    if (selection.canceled) return null;
    if (selection.filePaths.some((filename) => !/\.json(\.xz)?$/i.test(filename))) {
      throw new Error('Choose Instaloader JSON or JSON.XZ metadata files.');
    }
    return selection.filePaths;
  });
  handle('open-directory', async (value) => {
    const path = absolutePath(value);
    if (path === queue.destination && !existsSync(path)) mkdirSync(path, { recursive: true });
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) throw new Error('The folder could not be found.');
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });

  handle('login', (username, password) => {
    const normalized = typeof username === 'string' ? username.trim().replace(/^@/, '') : '';
    if (!/^[a-z0-9_.]{1,30}$/i.test(normalized) || typeof password !== 'string' || password.length < 1 || password.length > 4096) {
      return { status: 'failed', message: 'Enter your Instagram username and password.' };
    }
    return queue.authenticate('login', { username: normalized, password });
  });
  handle('two-factor', (value) => {
    const code = typeof value === 'string' ? value.replaceAll(' ', '') : '';
    if (!/^\d{6,8}$/.test(code)) return { status: 'failed', message: 'Enter your Instagram verification code.' };
    return queue.authenticate('two-factor', { code });
  });
  handle('cancel-auth', () => queue.cancelAuth());
  handle('logout', () => {
    session.fromPartition('persist:instagram-auth').clearStorageData().catch(() => {});
    return queue.logout();
  });
  handle('open-instagram', async (value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('The Instagram link is invalid.');
    }
    if (url.protocol !== 'https:' || !platformHosts.has(url.hostname) || url.port || url.username || url.password) {
      throw new Error('The Instagram link is invalid.');
    }
    await shell.openExternal(url.href);
  });

  handle('login-with-browser', () => loginWithBrowser());

  handle('login-with-google', () => loginWithGoogle());
}

function loginWithBrowser() {
  return new Promise((resolve, reject) => {
    const partition = 'persist:instagram-auth';
    const authSession = session.fromPartition(partition);

    const authWindow = new BrowserWindow({
      parent: window,
      modal: true,
      width: 480,
      height: 680,
      minWidth: 380,
      minHeight: 540,
      title: 'Sign in to Instagram',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    let resolved = false;
    let pollInterval = null;

    function cleanup() {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }

    async function extractSession() {
      try {
        const cookies = await authSession.cookies.get({});
        const sessionid = cookies.find((c) => c.name === 'sessionid')?.value;
        const csrftoken = cookies.find((c) => c.name === 'csrftoken')?.value;
        if (!sessionid || !csrftoken) return null;

        const sessionObj = {};
        for (const c of cookies) {
          if (c && typeof c.name === 'string' && typeof c.value === 'string') {
            sessionObj[c.name] = c.value;
          }
        }

        // Try extracting username from the open webContents
        let username = null;
        if (!authWindow.isDestroyed() && !authWindow.webContents.isDestroyed()) {
          try {
            username = await authWindow.webContents.executeJavaScript(`
              (() => {
                // 1. Check navigation profile link
                try {
                  const links = Array.from(document.querySelectorAll('a[href]'));
                  const ignore = new Set(['', '/', 'explore', 'reels', 'direct', 'stories', 'accounts', 'emails', 'graphql', 'api', 'legal', 'about', 'help', 'privacy']);
                  for (const a of links) {
                    const href = a.getAttribute('href') || '';
                    const match = href.match(/^\\/([a-zA-Z0-9._]{1,30})\\/?$/);
                    if (match) {
                      const candidate = match[1].toLowerCase();
                      if (!ignore.has(candidate)) {
                        if (a.querySelector('img') || a.querySelector('svg') || a.closest('nav') || a.closest('header') || a.closest('footer') || a.getAttribute('role') === 'link') {
                          return match[1];
                        }
                      }
                    }
                  }
                } catch (e) {}

                // 2. Check page HTML / scripts
                try {
                  const html = document.documentElement.innerHTML || '';
                  const m1 = html.match(/"username"\\s*:\\s*"([a-zA-Z0-9._]{1,30})"[^}]*?"is_supervised_user"/);
                  if (m1) return m1[1];
                  const m2 = html.match(/"viewer"\\s*:\\s*\\{[^}]*?"username"\\s*:\\s*"([a-zA-Z0-9._]{1,30})"/);
                  if (m2) return m2[1];
                  const m3 = html.match(/"username"\\s*:\\s*"([a-zA-Z0-9._]{1,30})"/);
                  if (m3 && !['instagram', 'about', 'legal', 'help'].includes(m3[1].toLowerCase())) return m3[1];
                } catch (e) {}

                // 3. Check window._sharedData
                try {
                  if (window._sharedData?.config?.viewer?.username) {
                    return window._sharedData.config.viewer.username;
                  }
                } catch (e) {}

                return null;
              })()
            `);
          } catch (e) {
            // executeJavaScript failed or page not ready
          }
        }

        // Fallback: If username is not yet in DOM, fetch the homepage with the cookies
        if (!username) {
          try {
            const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
            const resp = await fetch('https://www.instagram.com/', {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Cookie': cookieHeader,
                'X-IG-App-ID': '936619743392459',
                'Referer': 'https://www.instagram.com/',
              },
            });
            const text = await resp.text();
            const m = text.match(/"username"\s*:\s*"([a-zA-Z0-9._]{1,30})"/);
            if (m && !['instagram', 'about', 'legal', 'help'].includes(m[1].toLowerCase())) {
              username = m[1];
            }
          } catch (e) {}
        }

        // Fallback: If username is still not resolved, check ds_user_id
        const dsUserId = cookies.find((c) => c.name === 'ds_user_id')?.value;
        if (!username && dsUserId) {
          username = `user_${dsUserId}`;
        }

        if (!username) return null;
        return { username: username.toLowerCase(), session: sessionObj };
      } catch (err) {
        return null;
      }
    }

    async function saveAndFinish(data) {
      resolved = true;
      cleanup();
      try {
        if (!authWindow.isDestroyed()) {
          authWindow.removeAllListeners('closed');
          authWindow.close();
        }
      } catch (e) {}

      try {
        await queue.vault.replace(data);
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
          window.webContents.send('archivist:state', queue.snapshot());
        }
        resolve({
          status: 'authenticated',
          username: data.username,
          message: `Signed in as @${data.username}.`,
        });
      } catch (err) {
        resolve({ status: 'failed', message: err.message });
      }
    }

    async function checkLogin() {
      if (resolved) return;
      const data = await extractSession();
      // Only auto-finish if we have a real username (not just fallback user_id)
      if (data && data.username && !data.username.startsWith('user_')) {
        await saveAndFinish(data);
      }
    }

    authWindow.once('ready-to-show', () => {
      authWindow.show();
      // Immediately check if already logged in
      checkLogin().catch(() => {});
    });

    authWindow.on('closed', async () => {
      cleanup();
      if (resolved) return;
      const data = await extractSession();
      if (data) {
        await saveAndFinish(data);
      } else {
        resolve({ status: 'canceled' });
      }
    });

    // Check periodically every 750ms
    pollInterval = setInterval(() => {
      checkLogin().catch(() => {});
    }, 750);

    // Also check on navigation events
    authWindow.webContents.on('did-navigate', () => checkLogin().catch(() => {}));
    authWindow.webContents.on('did-navigate-in-page', () => checkLogin().catch(() => {}));
    authWindow.webContents.on('dom-ready', () => checkLogin().catch(() => {}));

    authWindow.loadURL('https://www.instagram.com/accounts/login/').catch((err) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        try {
          authWindow.removeAllListeners('closed');
          authWindow.close();
        } catch (e) {}
        reject(new Error('Could not load the Instagram login page. Check your internet connection.'));
      }
    });
  });
}

function loginWithGoogle() {
  return new Promise((resolve, reject) => {
    const partition = 'persist:google-auth';
    const authSession = session.fromPartition(partition);
    authSession.clearStorageData({ storages: ['cookies'] }).catch(() => {});

    const authWindow = new BrowserWindow({
      parent: window,
      modal: true,
      width: 480,
      height: 620,
      minWidth: 380,
      minHeight: 500,
      title: 'Sign in with Google',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    authWindow.once('ready-to-show', () => authWindow.show());
    authWindow.on('closed', () => resolve({ status: 'canceled' }));

    let resolved = false;
    authWindow.webContents.on('did-navigate', async (event, url) => {
      if (resolved) return;
      // After Google sign-in, the page returns to myaccount.google.com or similar
      try {
        const parsed = new URL(url);
        if (!parsed.hostname.endsWith('.google.com') && !parsed.hostname.endsWith('.googleapis.com')) return;
        const cookies = await authSession.cookies.get({ domain: '.google.com' });
        const hasAuth = cookies.some((c) => c.name === 'SAPISID' || c.name === 'SID');
        if (!hasAuth) return;
        // Try to get the user's email/name from the accounts page
        const apiReq = net.request({ method: 'GET', url: 'https://myaccount.google.com/', session: authSession });
        const body = await new Promise((res, rej) => {
          apiReq.on('response', (r) => {
            let d = '';
            r.on('data', (c) => { d += c; });
            r.on('end', () => res(d));
            r.on('error', rej);
          });
          apiReq.on('error', rej);
          apiReq.end();
        });
        const emailMatch = body.match(/"email"\s*:\s*"([^"]+)"/);
        const nameMatch = body.match(/"displayName"\s*:\s*"([^"]+)"/);
        const email = emailMatch?.[1] ?? null;
        const name = nameMatch?.[1] ?? null;
        resolved = true;
        authWindow.removeAllListeners('closed');
        authWindow.close();
        resolve({ status: 'authenticated', email, name });
      } catch {
        // not logged in yet
      }
    });

    authWindow.loadURL('https://accounts.google.com/ServiceLogin').catch((err) => {
      if (!resolved) {
        resolved = true;
        authWindow.removeAllListeners('closed');
        authWindow.close();
        reject(new Error('Could not load the Google sign-in page. Check your internet connection.'));
      }
    });
  });
}

async function initialize() {
  Menu.setApplicationMenu(null);
  protocol.handle('archivist', serveAsset);
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));

  const data = app.getPath('userData');
  const vault = new SessionVault(join(data, 'session.bin'), safeStorage);
  await vault.restore();
  queue = new ArchiveQueue({
    filename: join(data, 'queue.json'),
    destination: join(app.getPath('downloads'), 'Yoinkstagram'),
    worker: new WorkerHost({ packaged: app.isPackaged, projectPath, resourcesPath: process.resourcesPath }),
    vault,
    version: app.getVersion(),
    onUpdate: (state) => {
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('archivist:state', state);
      }
    },
  });
  registerActions();
  await createWindow();
  queue.start();
}

if (app.requestSingleInstanceLock()) {
  if (process.platform === 'win32') app.setAppUserModelId('local.yoinkstagram.desktop');
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.on('activate', () => {
    if (queue && !window) void createWindow();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('before-quit', (event) => {
    if (!queue) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    queue.close().catch(() => {
      // The last atomic queue snapshot remains available if storage cannot be written.
    }).finally(() => {
      queue = null;
      app.quit();
    });
  });
  app.whenReady().then(initialize).catch(() => {
    dialog.showErrorBox('Yoinkstagram', 'Yoinkstagram could not open. Confirm the desktop app has been built and try again.');
    app.quit();
  });
} else {
  app.quit();
}
