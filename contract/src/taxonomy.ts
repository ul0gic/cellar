import { z } from 'zod';
import { LIMITS } from './limits.ts';
import { IdSchema, idParams, ProvenanceSchema } from './primitives.ts';
import type { RouteSchema } from './routes.ts';
import type { taxonomyEndpoints } from './taxonomy-endpoints.ts';

const usageCountSchema = z.int().min(0);
const nameSchema = z.string().min(1).max(LIMITS.name.max);
const descriptionSchema = z.string().max(LIMITS.description.max);
const dilutionPercentSchema = z.number().min(0).max(100);

export const GlassSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    description: z.string(),
    volumeMl: z.number().nullable(),
    provenance: ProvenanceSchema,
    usageCount: usageCountSchema,
  })
  .meta({ id: 'Glass' });
export type Glass = z.infer<typeof GlassSchema>;

export const MethodSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    dilutionPercent: dilutionPercentSchema,
    provenance: ProvenanceSchema,
    usageCount: usageCountSchema,
  })
  .meta({ id: 'Method' });
export type Method = z.infer<typeof MethodSchema>;

export const UtensilSchema = z
  .object({
    id: IdSchema,
    name: z.string(),
    description: z.string(),
    provenance: ProvenanceSchema,
    usageCount: usageCountSchema,
  })
  .meta({ id: 'Utensil' });
export type Utensil = z.infer<typeof UtensilSchema>;

export const TagSchema = z.object({ id: IdSchema, name: z.string(), usageCount: usageCountSchema }).meta({ id: 'Tag' });
export type Tag = z.infer<typeof TagSchema>;

export const DescriptorSchema = z
  .object({ id: IdSchema, name: z.string(), provenance: ProvenanceSchema, usageCount: usageCountSchema })
  .meta({ id: 'Descriptor' });
export type Descriptor = z.infer<typeof DescriptorSchema>;

const glassFields = {
  name: nameSchema,
  description: descriptionSchema,
  volumeMl: z.number().positive().max(LIMITS.volumeMl.max).nullable(),
};
const methodFields = { name: nameSchema, dilutionPercent: dilutionPercentSchema };
const utensilFields = { name: nameSchema, description: descriptionSchema };
const tagFields = { name: z.string().min(1).max(LIMITS.tagName.max) };
const descriptorFields = { name: z.string().min(1).max(LIMITS.descriptorName.max) };

export const GlassInputSchema = z.strictObject(glassFields).meta({ id: 'GlassInput' });
export type GlassInput = z.infer<typeof GlassInputSchema>;
export const GlassPatchSchema = z.strictObject(glassFields).partial().meta({ id: 'GlassPatch' });
export type GlassPatch = z.infer<typeof GlassPatchSchema>;

export const MethodInputSchema = z.strictObject(methodFields).meta({ id: 'MethodInput' });
export type MethodInput = z.infer<typeof MethodInputSchema>;
export const MethodPatchSchema = z.strictObject(methodFields).partial().meta({ id: 'MethodPatch' });
export type MethodPatch = z.infer<typeof MethodPatchSchema>;

export const UtensilInputSchema = z.strictObject(utensilFields).meta({ id: 'UtensilInput' });
export type UtensilInput = z.infer<typeof UtensilInputSchema>;
export const UtensilPatchSchema = z.strictObject(utensilFields).partial().meta({ id: 'UtensilPatch' });
export type UtensilPatch = z.infer<typeof UtensilPatchSchema>;

export const TagInputSchema = z.strictObject(tagFields).meta({ id: 'TagInput' });
export type TagInput = z.infer<typeof TagInputSchema>;
export const TagPatchSchema = z.strictObject(tagFields).partial().meta({ id: 'TagPatch' });
export type TagPatch = z.infer<typeof TagPatchSchema>;

export const DescriptorInputSchema = z.strictObject(descriptorFields).meta({ id: 'DescriptorInput' });
export type DescriptorInput = z.infer<typeof DescriptorInputSchema>;
export const DescriptorPatchSchema = z.strictObject(descriptorFields).partial().meta({ id: 'DescriptorPatch' });
export type DescriptorPatch = z.infer<typeof DescriptorPatchSchema>;

export const TaxonDeleteResultSchema = z.object({ detached: z.int().min(0) }).meta({ id: 'TaxonDeleteResult' });
export type TaxonDeleteResult = z.infer<typeof TaxonDeleteResultSchema>;

export const ListGlassesResponseSchema = z.object({ items: z.array(GlassSchema) }).meta({ id: 'ListGlassesResponse' });
export type ListGlassesResponse = z.infer<typeof ListGlassesResponseSchema>;

export const ListMethodsResponseSchema = z.object({ items: z.array(MethodSchema) }).meta({ id: 'ListMethodsResponse' });
export type ListMethodsResponse = z.infer<typeof ListMethodsResponseSchema>;

export const ListUtensilsResponseSchema = z
  .object({ items: z.array(UtensilSchema) })
  .meta({ id: 'ListUtensilsResponse' });
export type ListUtensilsResponse = z.infer<typeof ListUtensilsResponseSchema>;

export const ListTagsResponseSchema = z.object({ items: z.array(TagSchema) }).meta({ id: 'ListTagsResponse' });
export type ListTagsResponse = z.infer<typeof ListTagsResponseSchema>;

export const ListDescriptorsResponseSchema = z
  .object({ items: z.array(DescriptorSchema) })
  .meta({ id: 'ListDescriptorsResponse' });
export type ListDescriptorsResponse = z.infer<typeof ListDescriptorsResponseSchema>;

export const taxonomyRoutes = {
  listGlasses: {
    responses: { 200: ListGlassesResponseSchema },
    errors: [],
    summary: 'List glasses',
    tag: 'taxonomy',
  },
  createGlass: {
    body: GlassInputSchema,
    responses: { 201: GlassSchema },
    errors: ['duplicate_name'],
    summary: 'Add a glass',
    tag: 'taxonomy',
  },
  updateGlass: {
    params: idParams,
    body: GlassPatchSchema,
    responses: { 200: GlassSchema },
    errors: ['not_found', 'duplicate_name'],
    summary: 'Change a glass',
    tag: 'taxonomy',
  },
  deleteGlass: {
    params: idParams,
    responses: { 200: TaxonDeleteResultSchema },
    errors: ['not_found'],
    summary: 'Delete a glass; its recipes keep everything else',
    tag: 'taxonomy',
  },
  listMethods: {
    responses: { 200: ListMethodsResponseSchema },
    errors: [],
    summary: 'List methods',
    tag: 'taxonomy',
  },
  createMethod: {
    body: MethodInputSchema,
    responses: { 201: MethodSchema },
    errors: ['duplicate_name'],
    summary: 'Add a method',
    tag: 'taxonomy',
  },
  updateMethod: {
    params: idParams,
    body: MethodPatchSchema,
    responses: { 200: MethodSchema },
    errors: ['not_found', 'duplicate_name'],
    summary: 'Change a method',
    tag: 'taxonomy',
  },
  deleteMethod: {
    params: idParams,
    responses: { 200: TaxonDeleteResultSchema },
    errors: ['not_found'],
    summary: 'Delete a method; its recipes keep everything else',
    tag: 'taxonomy',
  },
  listUtensils: {
    responses: { 200: ListUtensilsResponseSchema },
    errors: [],
    summary: 'List utensils',
    tag: 'taxonomy',
  },
  createUtensil: {
    body: UtensilInputSchema,
    responses: { 201: UtensilSchema },
    errors: ['duplicate_name'],
    summary: 'Add a utensil',
    tag: 'taxonomy',
  },
  updateUtensil: {
    params: idParams,
    body: UtensilPatchSchema,
    responses: { 200: UtensilSchema },
    errors: ['not_found', 'duplicate_name'],
    summary: 'Change a utensil',
    tag: 'taxonomy',
  },
  deleteUtensil: {
    params: idParams,
    responses: { 200: TaxonDeleteResultSchema },
    errors: ['not_found'],
    summary: 'Delete a utensil; its recipes keep everything else',
    tag: 'taxonomy',
  },
  listTags: {
    responses: { 200: ListTagsResponseSchema },
    errors: [],
    summary: 'List tags',
    tag: 'taxonomy',
  },
  createTag: {
    body: TagInputSchema,
    responses: { 201: TagSchema },
    errors: ['duplicate_name'],
    summary: 'Add a tag',
    tag: 'taxonomy',
  },
  updateTag: {
    params: idParams,
    body: TagPatchSchema,
    responses: { 200: TagSchema },
    errors: ['not_found', 'duplicate_name'],
    summary: 'Rename a tag',
    tag: 'taxonomy',
  },
  deleteTag: {
    params: idParams,
    responses: { 200: TaxonDeleteResultSchema },
    errors: ['not_found'],
    summary: 'Delete a tag; its recipes keep everything else',
    tag: 'taxonomy',
  },
  listDescriptors: {
    responses: { 200: ListDescriptorsResponseSchema },
    errors: [],
    summary: 'List tasting descriptors',
    tag: 'taxonomy',
  },
  createDescriptor: {
    body: DescriptorInputSchema,
    responses: { 201: DescriptorSchema },
    errors: ['duplicate_name'],
    summary: 'Add a tasting descriptor',
    tag: 'taxonomy',
  },
  updateDescriptor: {
    params: idParams,
    body: DescriptorPatchSchema,
    responses: { 200: DescriptorSchema },
    errors: ['not_found', 'duplicate_name'],
    summary: 'Rename a tasting descriptor',
    tag: 'taxonomy',
  },
  deleteDescriptor: {
    params: idParams,
    responses: { 200: TaxonDeleteResultSchema },
    errors: ['not_found'],
    summary: 'Delete a tasting descriptor; its notes keep everything else',
    tag: 'taxonomy',
  },
} as const satisfies Record<keyof typeof taxonomyEndpoints, RouteSchema>;
