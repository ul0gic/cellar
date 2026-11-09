import { ApiError } from '../../../app/api.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';

export function actionFailed(error: unknown, retry: () => void): void {
  if (!(error instanceof ApiError)) {
    throw error;
  }
  if (error.code === 'network_error' || error.code === 'internal_error') {
    toast({
      title: text('saveFailed.title'),
      variant: 'error',
      action: { label: text('saveFailed.retry'), run: retry },
    });
    return;
  }
  toast({ title: error.detail, variant: 'error' });
}

export async function attempt<T>(run: () => Promise<T>, onFail: () => void = () => undefined): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    onFail();
    actionFailed(error, () => void attempt(run, onFail));
    return null;
  }
}
