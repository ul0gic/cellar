import { argv, stderr, stdout } from 'node:process';
// biome-ignore lint/correctness/noUnresolvedImports: Biome 2.6.6's Node built-in module list lacks node:sqlite
import { DatabaseSync } from 'node:sqlite';
import { copyDatabase } from './migrate.ts';

const [source, target] = argv.slice(2);
if (source === undefined || target === undefined) {
  stderr.write('Usage: node backend/src/core/migrate.bench.ts <source.db> <target.db>\n');
  process.exitCode = 2;
} else {
  const db = new DatabaseSync(source, { readOnly: true });
  const copy = await copyDatabase(db, target);
  db.close();
  stdout.write(`pre-migration copy of ${source}: ${copy.durationMs} ms, ${copy.bytes} bytes\n`);
}
