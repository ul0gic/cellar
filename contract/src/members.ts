import { z } from 'zod';
import { LIMITS } from './limits.ts';
import type { membersEndpoints } from './members-endpoints.ts';
import {
  IdSchema,
  ImageRefSchema,
  IsoDateTimeSchema,
  idParams,
  PreferredUnitSchema,
  RoleSchema,
  ThemeChoiceSchema,
  VisibilitySchema,
} from './primitives.ts';
import type { RouteSchema } from './routes.ts';
import { ProfileSchema } from './setup-session.ts';

const memberName = z.string().trim().min(1).max(LIMITS.memberName.max);
const password = z.string().min(LIMITS.password.min).max(LIMITS.password.max);

export const MemberSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    role: RoleSchema,
    avatar: ImageRefSchema.nullable(),
    hasPassword: z.boolean(),
    createdAt: IsoDateTimeSchema,
    lastSeenAt: IsoDateTimeSchema.nullable(),
  })
  .meta({ id: 'Member' });
export type Member = z.infer<typeof MemberSchema>;

export const MemberListSchema = z.object({ members: z.array(MemberSchema) }).meta({ id: 'MemberList' });
export type MemberList = z.infer<typeof MemberListSchema>;

export const MemberInputSchema = z
  .strictObject({ name: memberName, password: password.nullable() })
  .meta({ id: 'MemberInput' });
export type MemberInput = z.infer<typeof MemberInputSchema>;

export const MemberPatchSchema = z.strictObject({ name: memberName.optional() }).meta({ id: 'MemberPatch' });
export type MemberPatch = z.infer<typeof MemberPatchSchema>;

export const PasswordResetSchema = z.object({ temporaryPassword: z.string() }).meta({ id: 'PasswordReset' });
export type PasswordReset = z.infer<typeof PasswordResetSchema>;

export const ProfilePatchSchema = z
  .strictObject({
    name: memberName.optional(),
    avatarImageId: IdSchema.nullable().optional(),
    unit: PreferredUnitSchema.optional(),
    theme: ThemeChoiceSchema.optional(),
    defaultVisibility: VisibilitySchema.optional(),
    showPrices: z.boolean().optional(),
  })
  .meta({ id: 'ProfilePatch' });
export type ProfilePatch = z.infer<typeof ProfilePatchSchema>;

export const PasswordChangeInputSchema = z
  .strictObject({ currentPassword: z.string().min(1).max(LIMITS.password.max), newPassword: password })
  .meta({ id: 'PasswordChangeInput' });
export type PasswordChangeInput = z.infer<typeof PasswordChangeInputSchema>;

export const ApiTokenSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    prefix: z.string(),
    createdAt: IsoDateTimeSchema,
    lastUsedAt: IsoDateTimeSchema.nullable(),
  })
  .meta({ id: 'ApiToken' });
export type ApiToken = z.infer<typeof ApiTokenSchema>;

export const ApiTokenListSchema = z.object({ tokens: z.array(ApiTokenSchema) }).meta({ id: 'ApiTokenList' });
export type ApiTokenList = z.infer<typeof ApiTokenListSchema>;

export const ApiTokenInputSchema = z
  .strictObject({ name: z.string().trim().min(1).max(LIMITS.apiTokenName.max) })
  .meta({ id: 'ApiTokenInput' });
export type ApiTokenInput = z.infer<typeof ApiTokenInputSchema>;

export const CreatedApiTokenSchema = ApiTokenSchema.extend({ token: z.string() }).meta({ id: 'CreatedApiToken' });
export type CreatedApiToken = z.infer<typeof CreatedApiTokenSchema>;

export const membersRoutes = {
  listMembers: {
    responses: { 200: MemberListSchema },
    errors: [],
    summary: 'List the household members',
    tag: 'members',
  },
  createMember: {
    body: MemberInputSchema,
    responses: { 201: MemberSchema },
    errors: ['duplicate_name'],
    summary: 'Add a member',
    tag: 'members',
  },
  updateMember: {
    params: idParams,
    body: MemberPatchSchema,
    responses: { 200: MemberSchema },
    errors: ['not_found', 'duplicate_name'],
    summary: 'Rename a member',
    tag: 'members',
  },
  resetMemberPassword: {
    params: idParams,
    responses: { 200: PasswordResetSchema },
    errors: ['not_found'],
    summary: "Reset a member's password to a one-time password",
    tag: 'members',
  },
  removeMember: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found', 'cannot_remove_owner'],
    summary: 'Remove a member and their personal records',
    tag: 'members',
  },
  getMe: {
    responses: { 200: ProfileSchema },
    errors: [],
    summary: 'Get my profile',
    tag: 'members',
  },
  updateMe: {
    body: ProfilePatchSchema,
    responses: { 200: ProfileSchema },
    errors: ['duplicate_name'],
    summary: 'Change my profile and preferences',
    tag: 'members',
  },
  changeMyPassword: {
    body: PasswordChangeInputSchema,
    responses: { 204: 'empty' },
    errors: ['validation_failed'],
    summary: 'Change my password and end my other sessions',
    tag: 'members',
  },
  listMyTokens: {
    responses: { 200: ApiTokenListSchema },
    errors: [],
    summary: 'List my API tokens',
    tag: 'members',
  },
  createMyToken: {
    body: ApiTokenInputSchema,
    responses: { 201: CreatedApiTokenSchema },
    errors: ['token_limit'],
    summary: 'Create an API token, shown once',
    tag: 'members',
  },
  revokeMyToken: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found'],
    summary: 'Revoke one of my API tokens',
    tag: 'members',
  },
} as const satisfies Record<keyof typeof membersEndpoints, RouteSchema>;
