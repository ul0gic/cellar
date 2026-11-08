import type { z } from 'zod';
import type { OperationId } from './endpoints.ts';
import type { ErrorCode } from './errors.ts';
import { setupSessionRoutes } from './setup-session.ts';
import { membersRoutes } from './members.ts';
import { settingsRoutes } from './settings.ts';
import { mediaRoutes } from './media.ts';
import { recipesRoutes } from './recipes.ts';
import { notesRoutes } from './notes.ts';
import { ingredientsRoutes } from './ingredients.ts';
import { bottlesRoutes } from './bottles.ts';
import { shoppingRoutes } from './shopping.ts';
import { searchRoutes } from './search.ts';
import { homeStatsRoutes } from './home-stats.ts';
import { menusRoutes } from './menus.ts';
import { wishlistsRoutes } from './wishlists.ts';
import { collectionsRoutes } from './collections.ts';
import { taxonomyRoutes } from './taxonomy.ts';
import { importRoutes } from './import.ts';
import { exportRoutes } from './export.ts';
import { backupRoutes } from './backup.ts';
import { catalogRoutes } from './catalog.ts';
import { aiRoutes } from './ai.ts';
import { systemRoutes } from './system.ts';

export type Schema = z.ZodType;
export type ResponseBody = Schema | 'csv' | 'zip' | 'html' | 'image' | 'empty';
export type SuccessStatus = 200 | 201 | 202 | 204;

export interface RouteSchema {
  readonly params?: Schema;
  readonly query?: Schema;
  readonly body?: Schema | { readonly multipart: Schema };
  readonly responses: Readonly<Partial<Record<SuccessStatus, ResponseBody>>>;
  readonly errors: readonly ErrorCode[];
  readonly summary: string;
  readonly tag: string;
}

export const routes = {
  ...setupSessionRoutes,
  ...membersRoutes,
  ...settingsRoutes,
  ...mediaRoutes,
  ...recipesRoutes,
  ...notesRoutes,
  ...ingredientsRoutes,
  ...bottlesRoutes,
  ...shoppingRoutes,
  ...searchRoutes,
  ...homeStatsRoutes,
  ...menusRoutes,
  ...wishlistsRoutes,
  ...collectionsRoutes,
  ...taxonomyRoutes,
  ...importRoutes,
  ...exportRoutes,
  ...backupRoutes,
  ...catalogRoutes,
  ...aiRoutes,
  ...systemRoutes,
} as const satisfies { readonly [K in OperationId]: RouteSchema };

type Routes = typeof routes;
type BodyInput<B> = B extends { readonly multipart: Schema } ? FormData : B extends Schema ? z.input<B> : never;
type BodyOutput<B> = B extends 'empty' ? undefined : B extends Schema ? z.output<B> : Blob;

export type OperationInput<Op extends OperationId> = (Routes[Op] extends { readonly params: infer P extends Schema }
  ? { readonly params: z.input<P> }
  : { readonly params?: never }) &
  (Routes[Op] extends { readonly query: infer Q extends Schema }
    ? { readonly query?: z.input<Q> }
    : { readonly query?: never }) &
  (Routes[Op] extends { readonly body: infer B } ? { readonly body: BodyInput<B> } : { readonly body?: never });

export type OperationOutput<Op extends OperationId> = {
  [S in keyof Routes[Op]['responses']]: BodyOutput<Routes[Op]['responses'][S]>;
}[keyof Routes[Op]['responses']];
