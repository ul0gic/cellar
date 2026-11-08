import type { Id, ImagePurpose, ImageRef, IsoDateTime } from '@cellar/contract';
import type { Database } from './db.ts';
import type { JobRunner } from './jobs.ts';
import type { Logger } from './logger.ts';
import type { Outbound } from './outbound.ts';
import type { Settings } from './settings.ts';

export interface ImageRow {
  readonly id: Id;
  readonly fileName: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly thumbhash: string | null;
  readonly purpose: ImagePurpose;
  readonly uploadedBy: Id | null;
  readonly createdAt: IsoDateTime;
}

export interface MediaStore {
  storeUpload(
    bytes: Uint8Array,
    declared: {
      readonly purpose: ImagePurpose;
      readonly width: number;
      readonly height: number;
      readonly thumbhash?: string;
    },
    by: Id,
  ): Promise<ImageRow>;
  storeFetched(bytes: Uint8Array, purpose: ImagePurpose, by: Id): Promise<ImageRow>;
  remove(id: Id): Promise<void>;
  sweepOrphans(): Promise<number>;
  resolveServePath(file: string): string | null;
  imageRef(row: ImageRow, basePath: string): ImageRef;
}

export interface AppContext {
  readonly settings: Settings;
  readonly db: Database;
  readonly log: Logger;
  readonly jobs: JobRunner;
  readonly outbound: Outbound;
  readonly media: MediaStore;
  readonly version: string;
  readonly schemaVersion: number;
  readonly startedAt: IsoDateTime;
  now(): Date;
}
