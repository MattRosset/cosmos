import { z } from 'zod';

export const ConstellationLineSetSchema = z
  .object({
    code: z.string().regex(/^[A-Za-z]{3}$/),
    name: z.string().min(1),
    hipPairs: z.array(z.number().int().positive()),
  })
  .refine((c) => c.hipPairs.length % 2 === 0, 'hipPairs must have even length');

export const ConstellationPackSchema = z.object({
  packFormatVersion: z.literal(1),
  source: z.string().min(1),
  constellations: z.array(ConstellationLineSetSchema),
});
