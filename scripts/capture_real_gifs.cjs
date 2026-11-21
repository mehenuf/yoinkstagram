// Package the app, then run this with FFmpeg available.
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const executablePath = process.env.YOINKSTAGRAM_DEMO_EXE
  ? path.resolve(process.env.YOINKSTAGRAM_DEMO_EXE)
  : path.join(root, 'release', 'win-unpacked', 'Yoinkstagram.exe');
const build = path.join(root, '.build');
const assets = path.join(root, 'docs', 'assets');
const ffmpeg = process.argv[2] ? path.resolve(process.argv[2]) : 'ffmpeg';
const handle = '@nasa';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function encode(input, output) {
  const filter = 'fps=25,scale=1100:-2:flags=lanczos,split[frames][colors];'
    + '[colors]palettegen=stats_mode=full[palette];'
    + '[frames][palette]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle';
  const result = spawnSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', input,
    '-filter_complex_threads', '2', '-filter_complex', filter, '-loop', '0', output,
  ], { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('FFmpeg could not encode the recording.');
}

async function record(session, directory, name, operate) {
  const framesDirectory = path.join(directory, name);
  fs.mkdirSync(framesDirectory);
  const frames = [];
  const collect = ({ data, sessionId, metadata }) => {
    const filename = `${frames.length}.png`;
    fs.writeFileSync(path.join(framesDirectory, filename), data, 'base64');
    frames.push({ filename, timestamp: metadata.timestamp ?? Date.now() / 1000 });
    void session.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  };
  session.on('Page.screencastFrame', collect);
  await session.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 });
  try {
    await sleep(700);
    await operate();
    await sleep(1350);
  } finally {
    await session.send('Page.stopScreencast');
    session.off('Page.screencastFrame', collect);
  }

  assert.ok(frames.length >= 30, `Too few compositor frames for ${name}: ${frames.length}`);
  const end = Date.now() / 1000;
  const timeline = frames.flatMap(({ filename, timestamp }, index) => {
    const next = frames[index + 1]?.timestamp ?? end;
    return [`file '${filename}'`, `duration ${Math.max(0.001, next - timestamp).toFixed(4)}`];
  });
  // The concat demuxer needs a final entry to apply the last frame's hold.
  timeline.push(`file '${frames.at(-1).filename}'`);
  fs.writeFileSync(path.join(framesDirectory, 'timeline.txt'), timeline.join('\n') + '\n');
  console.log(`Recorded ${name}: ${frames.length} live frames in ${(end - frames[0].timestamp).toFixed(1)}s`);
}

async function installCursor(page) {
  // Chromium's screencast omits the OS pointer. This marker follows the real input events.
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.popover = 'manual';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.cssText = 'position:fixed;inset:0 auto auto 0;margin:0;padding:0;border:0;'
      + 'width:32px;height:36px;background:transparent;overflow:visible;pointer-events:none;'
      + 'transform:translate(-100px,-100px);';
    cursor.innerHTML = '<svg width="22" height="28" viewBox="0 0 22 28" style="overflow:visible">'
      + '<path d="M2 2v20l5.1-5.4L11 25l4-2-4-8h7Z" fill="#171522" stroke="#fff"'
      + ' stroke-width="2" stroke-linejoin="round"/></svg>';
    document.body.append(cursor);
    cursor.showPopover();
    document.addEventListener('pointermove', (event) => {
      cursor.style.transform = `translate(${event.clientX}px,${event.clientY}px)`;
    }, true);
    document.addEventListener('pointerdown', () => {
      cursor.firstElementChild.animate(
        [{ scale: 1 }, { scale: 0.78 }, { scale: 1 }],
        { duration: 190, easing: 'ease-out' },
      );
    }, true);
    // Raise the marker above native HTML dialogs when they open.
    new MutationObserver((changes) => {
      if (changes.some(({ target }) => target instanceof HTMLDialogElement && target.open)) {
        cursor.hidePopover();
        cursor.showPopover();
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  });
}

function drive(page) {
  let pointer = { x: 403, y: 180 };
  return {
    async click(locator) {
      await locator.waitFor();
      await locator.scrollIntoViewIfNeeded();
      const box = await locator.boundingBox();
      assert.ok(box, 'The next control must be visible.');
      const end = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 };
      const start = pointer;
      const distance = Math.hypot(end.x - start.x, end.y - start.y);
      const duration = Math.min(580, 180 + distance * 0.63);
      const started = performance.now();
      for (let progress = 0; progress < 1;) {
        progress = Math.min(1, (performance.now() - started) / duration);
        const ease = progress * progress * (3 - 2 * progress);
        await page.mouse.move(
          start.x + (end.x - start.x) * ease,
          start.y + (end.y - start.y) * ease - Math.min(30, distance * 0.08) * Math.sin(Math.PI * ease),
        );
        if (progress < 1) await sleep(12);
      }
      pointer = end;
      await sleep(105);
      await page.mouse.click(end.x, end.y, { delay: 58 });
    },
    async type(value) {
      const delays = [57, 81, 63, 103, 73, 62, 76];
      for (const [index, character] of [...value].entries()) {
        await page.keyboard.type(character);
        await sleep(delays[index % delays.length]);
      }
    },
    async start() { await page.mouse.move(pointer.x, pointer.y); },
  };
}

async function run() {
  fs.mkdirSync(build, { recursive: true });
  const directory = fs.mkdtempSync(path.join(build, 'demo-'));
  const profile = path.join(directory, 'profile');
  const destination = path.join(directory, 'Archive');
  fs.mkdirSync(profile);
  fs.writeFileSync(path.join(profile, 'queue.json'), JSON.stringify({ settings: { destination } }));
  assert.ok(fs.existsSync(executablePath), 'Build the unpacked Windows release first.');
  const netrc = path.join(directory, 'empty.netrc');
  fs.writeFileSync(netrc, '');
  const app = await electron.launch({
    executablePath,
    cwd: root,
    args: [`--user-data-dir=${profile}`, '--force-device-scale-factor=1'],
    env: { ...process.env, NETRC: netrc },
  });

  try {
    const page = await app.firstWindow();
    const packaged = await app.evaluate(({ app: electronApp }) => ({
      isPackaged: electronApp.isPackaged,
      version: electronApp.getVersion(),
    }));
    assert.deepEqual(packaged, { isPackaged: true, version });
    const window = await app.browserWindow(page);
    await window.evaluate((nativeWindow) => {
      nativeWindow.setContentSize(1160, 740);
      nativeWindow.webContents.setBackgroundThrottling(false);
    });
    await app.evaluate(({ nativeTheme }) => {
      nativeTheme.themeSource = 'light';
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => document.fonts.ready.then(() => null));
    const button = (name, scope = page) => scope.getByRole('button', { name, exact: true });
    const state = () => page.evaluate(() => window.archivist.getState());
    const initial = await state();
    assert.equal(initial.version, version);
    assert.equal(initial.account, null);
    assert.equal(initial.settings.destination, destination);
    assert.equal(initial.jobs.length, 0);

    const session = await page.context().newCDPSession(page);
    await installCursor(page);
    const input = drive(page);
    const dialog = page.getByRole('dialog', { name: 'Download options' });
    const nav = page.getByRole('navigation', { name: 'Navigation' });
    const queueLink = nav.getByRole('button', { name: /^Download queue/ });
    const theme = button('Toggle theme');
    await input.start();
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    await sleep(900);

    await record(session, directory, 'theme', async () => {
      await input.click(theme);
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
      await sleep(950);
      await input.click(theme);
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'gta6');
      await sleep(1300);
      await input.click(button('Options'));
      await dialog.waitFor();
      await sleep(1050);
      await input.click(button('Close dialog', dialog));
      await dialog.waitFor({ state: 'hidden' });
      await input.click(queueLink);
      await page.getByRole('heading', { name: 'Download queue', exact: true }).waitFor();
      await sleep(900);
      await input.click(button('Settings', nav));
      await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
      await sleep(1000);
      await input.click(button('Workspace', nav));
      await input.click(theme);
      await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
    });

    await queueLink.click();
    await button('Pause queue').click();
    await button('Resume queue').waitFor();
    await button('Dismiss notification').click();
    await button('Workspace', nav).click();
    await input.start();
    await sleep(950);

    await record(session, directory, 'queue', async () => {
      await input.click(page.getByRole('textbox', { name: 'Instagram profile', exact: true }));
      await input.type(handle);
      await sleep(300);
      await input.click(button('Profile photo'));
      await input.click(button('Options'));
      await dialog.waitFor();
      await input.click(button('Filters', dialog));
      await input.click(dialog.getByLabel('Maximum items per category'));
      await input.type('2');
      await sleep(950);
      await input.click(button('Apply options', dialog));
      await dialog.waitFor({ state: 'hidden' });
      await input.click(button('Queue download'));
      await page.getByText('Added to the download queue.', { exact: true }).waitFor();
      await sleep(800);
      await input.click(queueLink);
      await page.getByRole('heading', { name: 'Download queue', exact: true }).waitFor();
      await button(`View ${handle} download`).waitFor();
      const [job] = (await state()).jobs;
      assert.equal(job.status, 'queued');
      assert.equal(job.request.options.maxItems, 2);
      assert.equal(job.request.options.profilePicture, false);
      assert.equal(job.request.useSession, false);
    });

    await record(session, directory, 'download', async () => {
      await input.click(button('Resume queue'));
      await page.locator('.job-badge.state-running').waitFor();
      await input.click(button(`View ${handle} download`));
      const details = page.getByRole('dialog', { name: handle });
      const outcome = details.locator('.job-badge').filter({ hasText: /^(Completed|Partial|Failed|Cooling down|Canceled)$/ });
      await outcome.waitFor({ timeout: 90_000 });
      assert.equal(await outcome.innerText(), 'Completed');
      await details.getByRole('status').getByText('Download completed.', { exact: true }).waitFor();
      await sleep(1150);
      await input.click(button('Close job details', details));
      await input.click(button('Download history', nav));
      await button(`View ${handle} download`).waitFor();
      const [job] = (await state()).jobs;
      assert.equal(job.status, 'completed');
      assert.equal(job.items, 2);
      assert.ok(job.files >= 2, 'The engine must save files from the public profile.');
      assert.ok(fs.readdirSync(destination, { recursive: true }).some((file) => /\.(jpe?g|png|webp|mp4)$/i.test(file)));
      console.log(`Verified real download: ${job.items} items, ${job.files} files`);
    });
  } finally {
    await app.close();
  }

  const names = ['queue', 'theme', 'download'];
  for (const name of names) {
    const output = path.join(directory, `demo-${name}.gif`);
    encode(path.join(directory, name, 'timeline.txt'), output);
  }
  for (const name of names) {
    const filename = `demo-${name}.gif`;
    fs.copyFileSync(path.join(directory, filename), path.join(assets, filename));
  }
  console.log('Replaced all three README GIFs.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
