import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { createServer } from 'vite';

const server = await createServer();
await server.listen();
const electron = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ARCHIVIST_DEV_URL: 'http://127.0.0.1:5173' },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => electron.kill());
}

electron.once('error', async (error) => {
  console.error(error.message);
  await server.close();
  process.exitCode = 1;
});

electron.once('exit', async (code) => {
  await server.close();
  process.exitCode = code ?? 0;
});
