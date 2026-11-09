import { call } from '../../../app/api.ts';
import { actionFailed } from '../../../app/problems.ts';
import { invalidate } from '../../../app/resources.ts';
import { toast } from '../../../design-system/toast.ts';
import { text } from '../../../text/index.ts';

export async function undoAdded(itemIds: readonly number[]): Promise<void> {
  try {
    for (const itemId of itemIds) {
      // biome-ignore lint/performance/noAwaitInLoops: each check-off answers with the list; order keeps the last answer current
      await call('checkOffShoppingItem', { params: { id: itemId } });
    }
    invalidate('shopping');
    toast({ title: text('toast.undone') });
  } catch (error) {
    actionFailed(error, () => void undoAdded(itemIds));
  }
}
