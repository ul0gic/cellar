import { get } from 'node:http';
import { stderr } from 'node:process';
import type { CommandArgs } from '../../bin/cellar.ts';
import { StartupExit } from '../core/problems.ts';
import { loadSettings, type Settings } from '../core/settings.ts';

const TIMEOUT_MS = 4000;

function probe(settings: Settings): Promise<string | null> {
  return new Promise((resolve) => {
    const request = get(
      { host: '127.0.0.1', port: settings.port, path: `${settings.basePath}/healthcheck`, timeout: TIMEOUT_MS },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200 ? null : `it answered ${response.statusCode ?? 'without a status'}`);
      },
    );
    request.on('timeout', () => {
      request.destroy();
      resolve(`no answer within ${TIMEOUT_MS / 1000} s`);
    });
    request.on('error', (error) => resolve(error.message));
  });
}

export async function run(_args: CommandArgs): Promise<number> {
  let settings: Settings;
  try {
    settings = loadSettings(process.env);
  } catch (error) {
    if (error instanceof StartupExit) {
      stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
  const failure = await probe(settings);
  if (failure === null) {
    return 0;
  }
  stderr.write(`Cellar isn't answering on port ${settings.port}: ${failure}\n`);
  return 1;
}
