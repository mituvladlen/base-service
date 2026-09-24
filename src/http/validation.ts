import { z } from 'zod';
import { DECORATION_TYPES, FACILITY_TYPES } from '../domain/types';

const id = z.string().trim().min(1).max(100);
const name = z.string().trim().min(1).max(60);

export const createBaseSchema = z.object({ playerId: id, name: name.optional() });
export const renameSchema = z.object({ name });
export const actionOnly = z.object({ actionId: id });
export const barricadeSchema = z.object({ actionId: id, roomId: id });
export const facilitySchema = z.object({ actionId: id, type: z.enum(FACILITY_TYPES) });
export const facilityTypeParam = z.enum(FACILITY_TYPES);
export const decorationSchema = z.object({ actionId: id, type: z.enum(DECORATION_TYPES) });
export const kikiSchema = z.object({ actionId: id, action: z.enum(['PET', 'FEED']).default('PET') });
