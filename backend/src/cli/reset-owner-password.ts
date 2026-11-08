import { stdout } from 'node:process';
import type { CommandArgs } from '../../bin/cellar.ts';
import { CommandExit, openCommandContext, readCommandSettings, runCommand } from '../backup/command.ts';
import { withTransaction } from '../core/db.ts';
import { hashPassword, oneTimePassword } from '../core/passwords.ts';

export function run(_args: CommandArgs): Promise<number> {
  return runCommand(async () => {
    const opened = openCommandContext(readCommandSettings(), false);
    try {
      const { db } = opened.ctx;
      const owner = db.prepare("SELECT id, name FROM members WHERE role = 'owner' LIMIT 1").get();
      if (owner === undefined || typeof owner.id !== 'number' || typeof owner.name !== 'string') {
        throw new CommandExit(
          30,
          "Cellar isn't set up yet, so there's no owner. Open Cellar in a browser to set it up.",
        );
      }
      const password = oneTimePassword();
      try {
        const hash = await hashPassword(password);
        const now = new Date().toISOString();
        withTransaction(db, () => {
          db.prepare('UPDATE members SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?').run(
            hash,
            now,
            owner.id,
          );
          db.prepare('DELETE FROM sessions WHERE member_id = ?').run(owner.id);
        });
      } catch (error) {
        throw new CommandExit(
          1,
          `Couldn't reset the password: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      stdout.write(
        `Owner: ${owner.name}\nOne-time password: ${password}\nSign in with it; Cellar will ask for a new password.\n`,
      );
      return 0;
    } finally {
      opened.close();
    }
  });
}
