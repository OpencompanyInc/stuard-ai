import 'dotenv/config';

import { startCloudAiServer } from './server/index';
import { writeLog } from './utils/logger';

// Last-resort safety net: a single fire-and-forget Promise rejection
// anywhere in the codebase would otherwise terminate the process under
// Node's default --unhandled-rejections=throw policy. That's far too fragile
// for a long-lived server — one bad chat request shouldn't take down every
// other connected client. Log loudly so the rejection is still visible.
process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  try {
    console.error('[cloud-ai] unhandledRejection:', message);
    if (stack) console.error(stack);
  } catch { }
  try {
    writeLog('unhandled_rejection', { message, stack: stack?.slice(0, 4000) });
  } catch { }
});

process.on('uncaughtException', (err: Error) => {
  try {
    console.error('[cloud-ai] uncaughtException:', err.message);
    if (err.stack) console.error(err.stack);
  } catch { }
  try {
    writeLog('uncaught_exception', { message: err.message, stack: err.stack?.slice(0, 4000) });
  } catch { }
});

startCloudAiServer();
