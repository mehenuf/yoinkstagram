import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const localPython = process.platform === 'win32'
  ? join('.venv', 'Scripts', 'python.exe')
  : join('.venv', 'bin', 'python');
const python = process.env.ARCHIVIST_PYTHON || (existsSync(localPython) ? localPython : 'python');
mkdirSync('.build', { recursive: true });
const result = spawnSync(python, [
  '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir',
  '--name', 'archivist-engine',
  '--paths', '.',
  '--distpath', '.build/engine',
  '--workpath', '.build/pyinstaller',
  '--specpath', '.build',
  '--recursive-copy-metadata', 'instaloader',
  'engine/__main__.py',
], { stdio: 'inherit' });

if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;

if (result.status === 0) {
  const packages = {
    react: 'LICENSE',
    'react-dom': 'LICENSE',
    scheduler: 'LICENSE',
    'lucide-react': 'LICENSE',
    '@fontsource-variable/dm-sans': 'LICENSE',
  };
  const notices = Object.entries(packages).map(([name, file]) =>
    `--- ${name} ---\n\n${readFileSync(join('node_modules', name, file), 'utf8').trim()}`);
  writeFileSync(join('.build', 'Renderer-Licenses.txt'), notices.join('\n\n'));
}
