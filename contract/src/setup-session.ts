import { z } from 'zod';
import { LIMITS } from './limits.ts';
import {
  IdSchema,
  ImageRefSchema,
  IsoDateTimeSchema,
  MemberRefSchema,
  PreferredUnitSchema,
  RoleSchema,
  VisibilitySchema,
} from './primitives.ts';
import type { RouteSchema } from './routes.ts';
import { JobSchema } from './jobs.ts';
import type { setupSessionEndpoints } from './setup-session-endpoints.ts';

export const ProfileSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    role: RoleSchema,
    avatar: ImageRefSchema.nullable(),
    unit: PreferredUnitSchema,
    defaultVisibility: VisibilitySchema,
    showPrices: z.boolean(),
    mustChangePassword: z.boolean(),
  })
  .meta({ id: 'Profile' });
export type Profile = z.infer<typeof ProfileSchema>;

export const HouseholdBriefSchema = z
  .object({
    currency: z.string(),
    displayUnit: PreferredUnitSchema,
    aiEnabled: z.boolean(),
    catalogLoaded: z.boolean(),
  })
  .meta({ id: 'HouseholdBrief' });
export type HouseholdBrief = z.infer<typeof HouseholdBriefSchema>;

export const SessionSchema = z
  .object({
    person: ProfileSchema,
    via: z.enum(['password', 'profile', 'token']),
    requireLogin: z.boolean(),
    expiresAt: IsoDateTimeSchema.nullable(),
    household: HouseholdBriefSchema,
  })
  .meta({ id: 'Session' });
export type Session = z.infer<typeof SessionSchema>;

export const SetupInputSchema = z
  .strictObject({
    ownerName: z.string().trim().min(1).max(LIMITS.memberName.max),
    password: z.string().min(LIMITS.password.min).max(LIMITS.password.max),
    requireLogin: z.boolean(),
    loadCatalog: z.boolean(),
  })
  .meta({ id: 'SetupInput' });
export type SetupInput = z.infer<typeof SetupInputSchema>;

export const SetupResultSchema = z
  .object({ session: SessionSchema, catalogJob: JobSchema.nullable() })
  .meta({ id: 'SetupResult' });
export type SetupResult = z.infer<typeof SetupResultSchema>;

export const LoginInputSchema = z
  .strictObject({
    name: z.string().min(1).max(LIMITS.memberName.max),
    password: z.string().min(1).max(LIMITS.password.max),
  })
  .meta({ id: 'LoginInput' });
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const ProfileChoiceInputSchema = z.strictObject({ memberId: IdSchema }).meta({ id: 'ProfileChoiceInput' });
export type ProfileChoiceInput = z.infer<typeof ProfileChoiceInputSchema>;

export const ProfileCardSchema = MemberRefSchema;
export type ProfileCard = z.infer<typeof ProfileCardSchema>;

export const ProfileListSchema = z.object({ profiles: z.array(ProfileCardSchema) }).meta({ id: 'ProfileList' });
export type ProfileList = z.infer<typeof ProfileListSchema>;

export const setupSessionRoutes = {
  runSetup: {
    body: SetupInputSchema,
    responses: { 201: SetupResultSchema },
    errors: ['validation_failed'],
    summary: 'Create the owner and finish first-run setup',
    tag: 'session',
  },
  getSession: {
    responses: { 200: SessionSchema },
    errors: [],
    summary: 'Get the current session',
    tag: 'session',
  },
  login: {
    body: LoginInputSchema,
    responses: { 200: SessionSchema },
    errors: ['invalid_credentials', 'rate_limited'],
    summary: 'Sign in with a name and password',
    tag: 'session',
  },
  chooseProfile: {
    body: ProfileChoiceInputSchema,
    responses: { 200: SessionSchema },
    errors: ['not_found'],
    summary: 'Start a session by choosing a profile',
    tag: 'session',
  },
  logout: {
    responses: { 204: 'empty' },
    errors: [],
    summary: 'End the current session',
    tag: 'session',
  },
  listProfiles: {
    responses: { 200: ProfileListSchema },
    errors: [],
    summary: 'List the profiles to choose from',
    tag: 'session',
  },
} as const satisfies Record<keyof typeof setupSessionEndpoints, RouteSchema>;
