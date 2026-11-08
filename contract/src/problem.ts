import { z } from 'zod';
import { ERROR_CODES, FIELD_ERROR_CODES } from './errors.ts';
import { CsvImportReportSchema, RecipeImportReportSchema } from './import.ts';
import { MemberRefSchema } from './primitives.ts';

export const FieldErrorSchema = z
  .object({
    path: z.string(),
    code: z.enum(FIELD_ERROR_CODES),
    message: z.string(),
  })
  .meta({ id: 'FieldError' });
export type FieldError = z.infer<typeof FieldErrorSchema>;

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int().min(400).max(599),
    code: z.enum(ERROR_CODES),
    detail: z.string(),
    requestId: z.string(),
    fields: z.array(FieldErrorSchema).optional(),
    report: z.union([CsvImportReportSchema, RecipeImportReportSchema]).optional(),
    retryAfterSeconds: z.int().min(0).optional(),
    limitBytes: z.int().min(0).optional(),
    usage: z
      .object({
        recipes: z.int().min(0),
        bottles: z.int().min(0),
        children: z.int().min(0),
        menus: z.int().min(0),
      })
      .optional(),
    providerMessage: z.string().optional(),
    upstreamStatus: z.int().optional(),
    versions: z.object({ backup: z.int(), app: z.int() }).optional(),
    membersWithoutPassword: z.array(MemberRefSchema).optional(),
  })
  .meta({ id: 'Problem' });
export type Problem = z.infer<typeof ProblemSchema>;
