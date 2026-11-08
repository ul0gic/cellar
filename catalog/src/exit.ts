export class CommandError extends Error {
  readonly exitCode: number;
  readonly lines: string[];

  constructor(exitCode: number, lines: string[]) {
    super(lines.join('\n'));
    this.exitCode = exitCode;
    this.lines = lines;
  }
}

const OUTPUT_REASONS: Readonly<Record<string, string>> = {
  EACCES: 'permission denied',
  EPERM: 'permission denied',
  EROFS: 'read-only file system',
  ENOSPC: 'no space left on device',
  EDQUOT: 'disk quota exceeded',
  ENOTDIR: 'a path component is not a folder',
  ENOENT: 'no such file or directory',
};

export function outputError(path: string, error: unknown): CommandError | null {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    const reason = OUTPUT_REASONS[error.code];
    if (reason !== undefined) {
      return new CommandError(5, [`cannot write ${path}: ${reason}`]);
    }
  }
  return null;
}
