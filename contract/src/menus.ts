import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { MENU_TOKEN_PATTERN, type menusEndpoints } from './menus-endpoints.ts';
import {
  IdSchema,
  ImageRefSchema,
  IngredientRefSchema,
  IsoDateSchema,
  IsoDateTimeSchema,
  MemberRefSchema,
  pageQueryShape,
  pageSchema,
  queryId,
  RecipeRefSchema,
  idParams,
} from './primitives.ts';
import type { RouteSchema } from './routes.ts';

export const MenuTokenSchema = z.string().regex(MENU_TOKEN_PATTERN).brand<'MenuToken'>().meta({ id: 'MenuToken' });

const hostNoteSchema = z.string().max(LIMITS.hostNote.max);

export const MenuItemInputSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('recipe'),
      recipeId: IdSchema,
      hostNote: hostNoteSchema,
      hideWhenUnavailable: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal('ingredient'),
      ingredientId: IdSchema,
      hostNote: hostNoteSchema,
      hideWhenUnavailable: z.boolean(),
    }),
  ])
  .meta({ id: 'MenuItemInput' });
export type MenuItemInput = z.infer<typeof MenuItemInputSchema>;

export const MenuSectionInputSchema = z
  .strictObject({
    name: z.string().min(1).max(LIMITS.sectionName.max),
    items: z.array(MenuItemInputSchema).max(LIMITS.menuItems.max),
  })
  .meta({ id: 'MenuSectionInput' });
export type MenuSectionInput = z.infer<typeof MenuSectionInputSchema>;

export const MenuInputSchema = z
  .strictObject({
    name: z.string().min(1).max(LIMITS.shortName.max),
    date: IsoDateSchema,
    sections: z.array(MenuSectionInputSchema).max(LIMITS.menuSections.max),
  })
  .meta({ id: 'MenuInput' });
export type MenuInput = z.infer<typeof MenuInputSchema>;

export const MenuItemSchema = z
  .discriminatedUnion('kind', [
    z.object({
      id: IdSchema,
      kind: z.literal('recipe'),
      recipe: RecipeRefSchema,
      hostNote: z.string(),
      hideWhenUnavailable: z.boolean(),
      available: z.boolean(),
    }),
    z.object({
      id: IdSchema,
      kind: z.literal('ingredient'),
      ingredient: IngredientRefSchema.extend({ image: ImageRefSchema.nullable() }),
      hostNote: z.string(),
      hideWhenUnavailable: z.boolean(),
      available: z.boolean(),
    }),
  ])
  .meta({ id: 'MenuItem' });
export type MenuItem = z.infer<typeof MenuItemSchema>;

export const MenuSectionSchema = z
  .object({ id: IdSchema, name: z.string(), items: z.array(MenuItemSchema) })
  .meta({ id: 'MenuSection' });
export type MenuSection = z.infer<typeof MenuSectionSchema>;

export const MenuLinkSchema = z.object({ path: z.string(), liveSince: IsoDateTimeSchema }).meta({ id: 'MenuLink' });
export type MenuLink = z.infer<typeof MenuLinkSchema>;

export const MenuSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    date: IsoDateSchema,
    live: z.boolean(),
    link: MenuLinkSchema.nullable(),
    sections: z.array(MenuSectionSchema),
    createdBy: MemberRefSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'Menu' });
export type Menu = z.infer<typeof MenuSchema>;

export const MenuSummarySchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    date: IsoDateSchema,
    live: z.boolean(),
    itemCount: z.int().min(0),
    updatedAt: IsoDateTimeSchema,
  })
  .meta({ id: 'MenuSummary' });
export type MenuSummary = z.infer<typeof MenuSummarySchema>;

export const MenuSummaryPageSchema = pageSchema(MenuSummarySchema);

export const MenuListQuerySchema = z.object(pageQueryShape);
export type MenuListQuery = z.infer<typeof MenuListQuerySchema>;

export const MenuCopyInputSchema = z
  .strictObject({ name: z.string().min(1).max(LIMITS.shortName.max), date: IsoDateSchema })
  .meta({ id: 'MenuCopyInput' });
export type MenuCopyInput = z.infer<typeof MenuCopyInputSchema>;

export const AddMakeableInputSchema = z
  .strictObject({
    sectionIndex: z
      .int()
      .min(0)
      .max(LIMITS.menuSections.max - 1),
  })
  .meta({ id: 'AddMakeableInput' });
export type AddMakeableInput = z.infer<typeof AddMakeableInputSchema>;

export const AddMakeableResultSchema = z
  .object({ menu: MenuSchema, added: z.int().min(0), skippedForLimit: z.int().min(0) })
  .meta({ id: 'AddMakeableResult' });
export type AddMakeableResult = z.infer<typeof AddMakeableResultSchema>;

export const DisplayStateSchema = z.object({ version: z.string() }).meta({ id: 'DisplayState' });
export type DisplayState = z.infer<typeof DisplayStateSchema>;

const TokenParamsSchema = z.object({ token: z.string() });

export const menusRoutes = {
  listMenus: {
    query: MenuListQuerySchema,
    responses: { 200: MenuSummaryPageSchema },
    errors: [],
    summary: 'List event menus, the live one first',
    tag: 'menus',
  },
  createMenu: {
    body: MenuInputSchema,
    responses: { 201: MenuSchema },
    errors: ['validation_failed'],
    summary: 'Create an event menu',
    tag: 'menus',
  },
  getMenu: {
    params: idParams,
    responses: { 200: MenuSchema },
    errors: ['not_found'],
    summary: 'Get an event menu',
    tag: 'menus',
  },
  replaceMenu: {
    params: idParams,
    body: MenuInputSchema,
    responses: { 200: MenuSchema },
    errors: ['not_found', 'validation_failed'],
    summary: 'Replace an event menu',
    tag: 'menus',
  },
  deleteMenu: {
    params: idParams,
    responses: { 204: 'empty' },
    errors: ['not_found'],
    summary: 'Delete an event menu',
    tag: 'menus',
  },
  copyMenu: {
    params: idParams,
    body: MenuCopyInputSchema,
    responses: { 201: MenuSchema },
    errors: ['not_found'],
    summary: 'Copy an event menu',
    tag: 'menus',
  },
  makeMenuLive: {
    params: idParams,
    responses: { 200: MenuSchema },
    errors: ['not_found'],
    summary: 'Put a menu on the TV link',
    tag: 'menus',
  },
  endMenu: {
    params: idParams,
    responses: { 200: MenuSchema },
    errors: ['not_found'],
    summary: 'Take a menu off the TV link',
    tag: 'menus',
  },
  rotateMenuLink: {
    params: idParams,
    responses: { 200: MenuSchema },
    errors: ['not_found', 'menu_not_live'],
    summary: "Replace a live menu's link",
    tag: 'menus',
  },
  addMakeableToMenu: {
    params: idParams,
    body: AddMakeableInputSchema,
    responses: { 200: AddMakeableResultSchema },
    errors: ['not_found', 'validation_failed'],
    summary: 'Add every recipe the shelf can make to a menu',
    tag: 'menus',
  },
  showMenuDisplay: {
    params: TokenParamsSchema,
    responses: { 200: 'html' },
    errors: [],
    summary: 'Show the live menu on a TV',
    tag: 'menus',
  },
  showMenuRecipe: {
    params: TokenParamsSchema.extend({ recipeId: queryId }),
    responses: { 200: 'html' },
    errors: [],
    summary: 'Show one recipe from the live menu',
    tag: 'menus',
  },
  getMenuDisplayState: {
    params: TokenParamsSchema,
    responses: { 200: DisplayStateSchema },
    errors: ['not_found'],
    summary: "Get the live menu's display version",
    tag: 'menus',
  },
} as const satisfies Record<keyof typeof menusEndpoints, RouteSchema>;
