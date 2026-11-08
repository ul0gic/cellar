import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { IdSchema, IsoDateTimeSchema, idParams, PreferredUnitSchema } from './primitives.ts';
import { JobSchema } from './jobs.ts';
import type { RouteSchema } from './routes.ts';
import type { settingsEndpoints } from './settings-endpoints.ts';

export const CatalogScheduleSchema = z.enum(['off', 'monthly']).meta({ id: 'CatalogSchedule' });
export type CatalogSchedule = z.infer<typeof CatalogScheduleSchema>;

const currency = z.string().regex(/^[A-Z]{3}$/);

export const HouseholdSettingsSchema = z
  .object({
    requireLogin: z.boolean(),
    currency,
    displayUnit: PreferredUnitSchema,
    catalogSchedule: CatalogScheduleSchema,
    ai: z.object({ keySet: z.boolean(), keyLast4: z.string().max(4).nullable() }),
  })
  .meta({ id: 'HouseholdSettings' });
export type HouseholdSettings = z.infer<typeof HouseholdSettingsSchema>;

export const SettingsPatchSchema = z
  .strictObject({
    currency: currency.optional(),
    displayUnit: PreferredUnitSchema.optional(),
    catalogSchedule: CatalogScheduleSchema.optional(),
  })
  .meta({ id: 'SettingsPatch' });
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const RequireLoginInputSchema = z
  .strictObject({ requireLogin: z.boolean(), ownerPassword: z.string().min(1).max(LIMITS.password.max) })
  .meta({ id: 'RequireLoginInput' });
export type RequireLoginInput = z.infer<typeof RequireLoginInputSchema>;

export const AiKeyInputSchema = z
  .strictObject({ key: z.string().min(LIMITS.aiKey.min).max(LIMITS.aiKey.max) })
  .meta({ id: 'AiKeyInput' });
export type AiKeyInput = z.infer<typeof AiKeyInputSchema>;

export const AboutSchema = z
  .object({
    version: z.string(),
    schemaVersion: z.int().min(1),
    catalogVersion: z.string().nullable(),
    runtime: z.object({ node: z.string(), sqlite: z.string() }),
    licenses: z.array(
      z.object({
        name: z.string(),
        version: z.string(),
        license: z.string().nullable(),
        url: z.string().nullable(),
        text: z.string().nullable(),
      }),
    ),
  })
  .meta({ id: 'About' });
export type About = z.infer<typeof AboutSchema>;

export const NotificationKindSchema = z
  .enum(['catalog_update_available', 'catalog_check_failed'])
  .meta({ id: 'NotificationKind' });
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

export const AppNotificationSchema = z
  .object({
    id: IdSchema,
    kind: NotificationKindSchema,
    createdAt: IsoDateTimeSchema,
    version: z.string().nullable(),
    message: z.string().nullable(),
  })
  .meta({ id: 'AppNotification' });
export type AppNotification = z.infer<typeof AppNotificationSchema>;

export const NotificationListSchema = z
  .object({ notifications: z.array(AppNotificationSchema) })
  .meta({ id: 'NotificationList' });
export type NotificationList = z.infer<typeof NotificationListSchema>;

export const settingsRoutes = {
  getSettings: {
    responses: { 200: HouseholdSettingsSchema },
    errors: [],
    summary: 'Get the household settings',
    tag: 'settings',
  },
  updateSettings: {
    body: SettingsPatchSchema,
    responses: { 200: HouseholdSettingsSchema },
    errors: [],
    summary: 'Change the household settings',
    tag: 'settings',
  },
  setRequireLogin: {
    body: RequireLoginInputSchema,
    responses: { 200: HouseholdSettingsSchema },
    errors: ['validation_failed', 'require_login_blocked'],
    summary: 'Turn require-login on or off',
    tag: 'settings',
  },
  saveAiKey: {
    body: AiKeyInputSchema,
    responses: { 200: HouseholdSettingsSchema },
    errors: [],
    summary: 'Save the AI provider key',
    tag: 'settings',
  },
  removeAiKey: {
    responses: { 200: HouseholdSettingsSchema },
    errors: [],
    summary: 'Remove the AI provider key',
    tag: 'settings',
  },
  getAbout: {
    responses: { 200: AboutSchema },
    errors: [],
    summary: 'Get the version, runtime and dependency licenses',
    tag: 'settings',
  },
  listNotifications: {
    responses: { 200: NotificationListSchema },
    errors: [],
    summary: "List the owner's notifications",
    tag: 'settings',
  },
  dismissNotification: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found'],
    summary: 'Dismiss a notification',
    tag: 'settings',
  },
  getJob: {
    params: z.object({ id: z.uuid({ version: 'v4' }) }),
    responses: { 200: JobSchema },
    errors: ['not_found'],
    summary: 'Get the progress or result of a job',
    tag: 'settings',
  },
} as const satisfies Record<keyof typeof settingsEndpoints, RouteSchema>;
