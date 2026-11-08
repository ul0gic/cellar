import { createServer } from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '8090', 10);
const MEGABYTE = 1024 * 1024;

const recipePage = `<!doctype html><html><head><title>Fixture Daiquiri</title>
<script type="application/ld+json">${JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Recipe',
  name: 'Fixture Daiquiri',
  recipeYield: '1 drink',
  recipeIngredient: ['2 oz white rum', '1 oz lime juice', '0.75 oz simple syrup'],
  recipeInstructions: [
    { '@type': 'HowToStep', text: 'Shake everything with ice.' },
    { '@type': 'HowToStep', text: 'Strain into a chilled coupe.' },
  ],
})}</script></head><body><h1>Fixture Daiquiri</h1></body></html>`;

function log(line: string): void {
  process.stdout.write(`${new Date().toISOString()} ${line}\n`);
}

function bigPage(bytes: number): string {
  const head = '<!doctype html><html><head><title>Big</title></head><body>';
  const tail = '</body></html>';
  return head + 'x'.repeat(Math.max(0, bytes - head.length - tail.length)) + tail;
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://fixtures');
  const host = request.headers['x-forwarded-host'] ?? request.headers.host ?? '';
  log(`${request.method} ${host}${url.pathname}${url.search}`);
  const path = url.pathname;

  if (path === '/recipe-ok') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(recipePage);
    return;
  }

  const hops = /^\/redirect\/([0-9]{1,2})$/.exec(path);
  if (hops?.[1] !== undefined) {
    const left = Number.parseInt(hops[1], 10);
    const next = left <= 1 ? '/recipe-ok' : `/redirect/${left - 1}`;
    response.writeHead(302, { location: next }).end();
    return;
  }

  if (path === '/redirect-private') {
    response.writeHead(302, { location: url.searchParams.get('to') ?? 'http://127.0.0.1/' }).end();
    return;
  }

  const size = /^\/body\/([0-9]{1,8})$/.exec(path);
  if (size?.[1] !== undefined) {
    const body = bigPage(Number.parseInt(size[1], 10));
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(body) });
    response.end(body);
    return;
  }

  if (path === '/big-6mb') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': 6 * MEGABYTE });
    response.end(bigPage(6 * MEGABYTE));
    return;
  }

  if (path === '/big-chunked') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    let sent = 0;
    const chunk = 'y'.repeat(64 * 1024);
    const push = (): void => {
      while (sent < 8 * MEGABYTE) {
        sent += chunk.length;
        if (!response.write(chunk)) {
          response.once('drain', push);
          return;
        }
      }
      response.end();
    };
    push();
    return;
  }

  if (path === '/stall-headers') {
    const timer = setTimeout(() => response.writeHead(200).end(recipePage), 30_000);
    response.on('close', () => clearTimeout(timer));
    return;
  }

  if (path === '/stall-body') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.write('<!doctype html><html><body>');
    const timer = setTimeout(() => response.end('</body></html>'), 30_000);
    response.on('close', () => clearTimeout(timer));
    return;
  }

  if (path === '/stall-20s') {
    const timer = setTimeout(() => response.writeHead(200, { 'content-type': 'text/html' }).end(recipePage), 20_000);
    response.on('close', () => clearTimeout(timer));
    return;
  }

  if (path.startsWith('/v1/')) {
    response.writeHead(501, { 'content-type': 'application/json' }).end('{"error":"ai fixture not implemented"}');
    return;
  }

  response.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
});

server.listen(port, '0.0.0.0', () => log(`fixtures listening on ${port}`));
