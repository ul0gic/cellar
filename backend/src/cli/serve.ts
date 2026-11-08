import { stderr } from 'node:process';
import type { CommandArgs } from '../../bin/cellar.ts';
import { createLogger } from '../core/logger.ts';
import { StartupExit } from '../core/problems.ts';
import { loadSettings } from '../core/settings.ts';
import { startServer } from '../core/startup.ts';

function stopSignal(): Promise<NodeJS.Signals> {
  return new Promise((resolve) => {
    process.once('SIGTERM', () => resolve('SIGTERM'));
    process.once('SIGINT', () => resolve('SIGINT'));
  });
}

export async function run(_args: CommandArgs): Promise<number> {
  const bootLog = createLogger('info');
  try {
    const signal = stopSignal();
    const server = await startServer(loadSettings(process.env));
    server.ctx.log.info(`Received ${await signal}.`);
    await server.close();
    return 0;
  } catch (error) {
    if (error instanceof StartupExit) {
      bootLog.error(error.message, { exitCode: error.exitCode });
      stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    bootLog.error('Cellar stopped on an unexpected error.', { err: error });
    return 1;
  }
}
