import { startStudio } from 'openfilm/studio';

/**
 * OpenFilm Studio 的 utility process 入口。
 * 与 OpenFilm 桌面端一致：advertise 会把 run.json 写给 CLI / agent，
 * stays 让别的进程不能在我们不知情时把它关掉。
 */
const parent = process.parentPort;
const send = (message) => parent.postMessage(message);

const openBrowser = (url) => send({ type: 'open', url });

let studio = null;
let stopping = false;

async function boot() {
  const desired = Number(process.env.OPENFILM_STUDIO_PORT);
  const options = {
    port: Number.isInteger(desired) && desired >= 0 ? desired : 4747,
    advertise: true,
    stays: true,
    openBrowser,
  };
  try {
    return await startStudio(options);
  } catch (error) {
    if (error?.code !== 'EADDRINUSE' && error?.code !== 'EACCES') throw error;
    return startStudio({ ...options, port: 0 });
  }
}

parent.on('message', (event) => {
  const message = event?.data;
  if (message?.type !== 'quit' || stopping) return;
  stopping = true;
  Promise.resolve(studio?.close?.())
    .catch(() => {})
    .finally(() => process.exit(0));
});

try {
  studio = await boot();
  send({
    type: 'ready',
    origin: studio.origin,
    filmOrigin: studio.filmOrigin,
    key: studio.key,
  });
} catch (error) {
  send({
    type: 'failed',
    code: error?.code ?? null,
    message: error?.message ?? String(error),
  });
  process.exit(1);
}
