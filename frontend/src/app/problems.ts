import { toast } from '../design-system/toast.ts';
import { text } from '../text/index.ts';
import { AUTH_CODES, ApiError } from './api.ts';

const SECONDS_PER_MINUTE = 60;

export function problemText(error: ApiError): string {
  const problem = error.problem;
  const vars: Record<string, string | number> = { requestId: error.requestId };
  if (problem?.retryAfterSeconds !== undefined) {
    vars.minutes = Math.max(1, Math.ceil(problem.retryAfterSeconds / SECONDS_PER_MINUTE));
  }
  if (problem?.versions !== undefined) {
    vars.backup = problem.versions.backup;
    vars.app = problem.versions.app;
  }
  if (problem?.membersWithoutPassword !== undefined) {
    vars.names = problem.membersWithoutPassword.map((member) => member.name).join(', ');
  }
  if (problem?.providerMessage !== undefined) {
    vars.providerMessage = problem.providerMessage;
  }
  const message = text(`error.${error.code}`, vars);
  return /\{\w+\}/.test(message) ? error.detail : message;
}

export function fieldError(error: ApiError, path: string): string {
  return error.fields.find((field) => field.path === path)?.message ?? '';
}

export function isAuthProblem(error: ApiError): boolean {
  return AUTH_CODES.some((code) => code === error.code);
}

export function actionFailed(error: unknown, retry: () => void): void {
  if (!(error instanceof ApiError)) {
    throw error;
  }
  if (isAuthProblem(error)) {
    return;
  }
  if (error.code === 'network_error') {
    toast({
      title: text('saveFailed.title'),
      variant: 'error',
      action: { label: text('saveFailed.retry'), run: retry },
    });
    return;
  }
  toast({ title: problemText(error), variant: 'error' });
}
