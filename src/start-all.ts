import { fork, type ChildProcess } from 'node:child_process';
import { loadConfig } from './config/env.js';
import { createLogger } from './config/logger.js';

/*
 * Runs the API and the analytics worker in one container.
 *
 * Normally they are separate containers (see docker-compose.yml) so they can
 * be scaled and restarted independently. Some free hosting tiers (e.g.
 * Render's) allow only a single web service, so this launcher starts both as
 * child processes of one container.
 *
 * If either process exits on its own, the other is stopped too and the
 * container exits with an error, so the platform restarts it rather than
 * leaving the app half-running (e.g. redirects working but no analytics).
 */

// Validates the environment once up front, so a bad config fails here with one clear message.
const logger = createLogger(loadConfig());

const children: ChildProcess[] = [
  fork(new URL('./server.js', import.meta.url)),
  fork(new URL('./worker.js', import.meta.url)),
];

let shuttingDown = false;

function stopAll(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  // Each child runs its own graceful shutdown on SIGTERM/SIGINT.
  for (const child of children) {
    child.kill(signal);
  }
}

process.on('SIGTERM', () => stopAll('SIGTERM'));
process.on('SIGINT', () => stopAll('SIGINT'));

for (const child of children) {
  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      logger.error({ pid: child.pid, code, signal }, 'A child process exited unexpectedly; stopping the other');
      process.exitCode = 1;
      stopAll('SIGTERM');
    } else if (code !== 0) {
      process.exitCode = 1;
    }

    const allExited = children.every((c) => c.exitCode !== null || c.signalCode !== null);
    if (allExited) {
      process.exit();
    }
  });
}
