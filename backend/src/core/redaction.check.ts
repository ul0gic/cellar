import { stdout } from 'node:process';
import { createLogger } from './logger.ts';

const secrets = {
  password: 'hunter2-correct-horse',
  newPassword: 'new-battery-staple-9',
  apiToken: 'clr_Q2VsbGFyVG9rZW5FeGFtcGxlVmFsdWVGb3JUZXN0MTIz',
  sessionCookie: 'cellar_session=k7Jx2mQ9vT4pL8nR3sW6yB1dF5gH0jK2',
  aiKey: 'sk-proj-ExampleAiKeyValue0123456789',
  menuToken: '7m3kq9x2vb8np4rt6wy1hc5dfg',
};

const lines: string[] = [];
const log = createLogger('debug', (line) => lines.push(line));

log.info('request', { method: 'POST', path: `/m/${secrets.menuToken}/state`, status: 200 });
log.info('login attempt', { name: 'Dana', password: secrets.password });
log.info('change password', { body: { currentPassword: secrets.password, newPassword: secrets.newPassword } });
log.debug('headers', {
  headers: { authorization: `Bearer ${secrets.apiToken}`, cookie: secrets.sessionCookie, 'user-agent': 'curl' },
});
log.info('settings saved', { key: secrets.aiKey });
log.error('Request failed', { err: new Error(`token ${secrets.apiToken} rejected at /m/${secrets.menuToken}`) });
log.warn(`bearer ${secrets.apiToken} seen`);

const output = lines.join('');
let hits = 0;
for (const [name, value] of Object.entries(secrets)) {
  const found = output.split(value).length - 1;
  hits += found;
  stdout.write(`${name}: ${found} hit(s)\n`);
}
stdout.write(output);
stdout.write(`secret hits: ${hits}\n`);
process.exitCode = hits === 0 ? 0 : 1;
