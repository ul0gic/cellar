import type { Database } from '../db.ts';
import { SCHEMA_V1_SQL } from '../schema.ts';

export const initial = {
  version: 1,
  up(db: Database): void {
    db.exec(SCHEMA_V1_SQL);
  },
};
