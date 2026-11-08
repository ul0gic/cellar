import { CommandError } from '../src/exit.ts';
import { pack } from '../src/pack.ts';
import { type Problem, readDataset, readBytes } from '../src/read.ts';
import { buildRelease, writeRelease } from '../src/release.ts';
import { validateDataset } from '../src/validate.ts';

const SYNOPSIS = [
  'cellar-catalog build [--dataset <dir>] [--out <dir>] [--force]',
  'cellar-catalog pack <release-dir> --base-url <https-url> (--previous <release-dir> | --first) [--index <file>] [--out <dir>]',
].join('\n');

interface Parsed {
  values: Map<string, string>;
  switches: Set<string>;
  positionals: string[];
}

function parseFlags(args: string[], valueFlags: readonly string[], switchFlags: readonly string[]): Parsed {
  const parsed: Parsed = { values: new Map(), switches: new Set(), positionals: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      parsed.positionals.push(arg);
    } else if (switchFlags.includes(arg)) {
      parsed.switches.add(arg);
    } else if (valueFlags.includes(arg)) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new CommandError(2, [`${arg} needs a value`]);
      }
      parsed.values.set(arg, value);
      index += 1;
    } else {
      throw new CommandError(2, [`unknown flag ${arg}`]);
    }
  }
  return parsed;
}

function formatProblem(problem: Problem): string {
  const rule = problem.rule === null ? '' : ` (${problem.rule})`;
  if (problem.record !== null) {
    const where = problem.where === null ? '' : ` ${problem.where}`;
    return `${problem.file} "${problem.record}"${where}: ${problem.message}${rule}`;
  }
  if (problem.where !== null) {
    return `${problem.file} ${problem.where}: ${problem.message}${rule}`;
  }
  return `${problem.message}${rule}`;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function integer(n: number): string {
  return n.toLocaleString('en-US');
}

function build(args: string[]): string[] {
  const parsed = parseFlags(args, ['--dataset', '--out'], ['--force', '--help']);
  if (parsed.switches.has('--help')) {
    return [SYNOPSIS];
  }
  if (parsed.positionals.length > 0) {
    throw new CommandError(2, [`unexpected argument ${parsed.positionals[0]}`]);
  }
  const dataset = parsed.values.get('--dataset') ?? 'catalog/dataset';
  const out = parsed.values.get('--out') ?? 'catalog/out';
  const read = readDataset(dataset);
  if (!read.ok) {
    throw new CommandError(4, read.problems.map(formatProblem));
  }
  const validated = validateDataset(read.files, (file) => readBytes(dataset, file));
  if (!validated.ok) {
    throw new CommandError(4, validated.problems.map(formatProblem));
  }
  const release = buildRelease(validated.catalog);
  const written = writeRelease(release, out, parsed.switches.has('--force'));
  const c = release.manifest.counts;
  return [
    `Catalog ${release.manifest.version} from ${dataset}`,
    `Read        ${integer(c.recipes)} recipes, ${integer(c.ingredients)} ingredients, ${integer(c.images)} images, ${integer(c.glasses)} glasses, ${integer(c.methods)} methods, ${integer(c.utensils)} utensils, ${integer(c.calculators)} calculators, ${integer(c.tasteDescriptors)} taste descriptors`,
    `Notices     ${integer(release.report.notices.length)} (see report)`,
    `Release     ${written.releaseDir}  (${megabytes(written.totalBytes)})`,
    `Report      ${written.reportPath}`,
  ];
}

function run(argv: string[]): string[] {
  const [command, ...args] = argv;
  if (command === undefined) {
    throw new CommandError(2, ['pass a command; commands are build, pack', SYNOPSIS]);
  }
  if (command === '--help' || command === 'help') {
    return [SYNOPSIS];
  }
  if (command === 'build') {
    return build(args);
  }
  if (command === 'pack') {
    const parsed = parseFlags(args, ['--base-url', '--previous', '--index', '--out'], ['--first', '--help']);
    if (parsed.switches.has('--help')) {
      return [SYNOPSIS];
    }
    const [releaseDir, ...extra] = parsed.positionals;
    if (releaseDir === undefined) {
      throw new CommandError(2, ['pass the release folder to pack']);
    }
    if (extra.length > 0) {
      throw new CommandError(2, [`unexpected argument ${extra[0]}`]);
    }
    const baseUrl = parsed.values.get('--base-url');
    if (baseUrl === undefined || !baseUrl.startsWith('https://') || !URL.canParse(baseUrl)) {
      throw new CommandError(2, ['--base-url must start with https://']);
    }
    const previous = parsed.values.get('--previous') ?? null;
    if ((previous === null) === !parsed.switches.has('--first')) {
      throw new CommandError(2, ['pass --previous or --first']);
    }
    return pack({
      releaseDir,
      baseUrl,
      previous,
      index: parsed.values.get('--index') ?? null,
      out: parsed.values.get('--out') ?? 'catalog/out',
    });
  }
  throw new CommandError(2, [`unknown command ${JSON.stringify(command)}; commands are build, pack`]);
}

try {
  process.stdout.write(`${run(process.argv.slice(2)).join('\n')}\n`);
} catch (error) {
  if (error instanceof CommandError) {
    process.stderr.write(error.lines.map((line) => `cellar-catalog: ${line}\n`).join(''));
    process.exitCode = error.exitCode;
  } else {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error && error.stack !== undefined ? `\n${error.stack}` : '';
    process.stderr.write(`cellar-catalog: internal error: ${message}${stack}\n`);
    process.exitCode = 1;
  }
}
