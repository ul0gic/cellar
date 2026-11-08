import { createHash } from 'node:crypto';
import type { Id } from '@cellar/contract';

const VERSION_HEX = 16;

export function displayVersion(menuId: Id, updatedAt: string, token: string, shownItemIds: readonly Id[]): string {
  return createHash('sha256')
    .update(`${menuId}\n${updatedAt}\n${token}\n${shownItemIds.join(',')}`)
    .digest('hex')
    .slice(0, VERSION_HEX);
}
