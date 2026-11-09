import { actionFailed } from '../../../app/problems.ts';

export async function attempt<T>(run: () => Promise<T>, onFail: () => void = () => undefined): Promise<T | null> {
  try {
    return await run();
  } catch (error) {
    onFail();
    actionFailed(error, () => void attempt(run, onFail));
    return null;
  }
}
