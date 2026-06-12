import { z } from 'zod';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Coerce a CSV string to number; empty string or whitespace-only → null. */
const csvNum = (positive = false) =>
  z.preprocess((v) => {
    if (typeof v !== 'string' || v.trim() === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }, positive ? z.number().positive().nullable() : z.number().nullable());

const csvNumPos = () => csvNum(true);

// ---------------------------------------------------------------------------
// CSV row schema — degrees may exist ONLY here (§5.5)
// ---------------------------------------------------------------------------

export const CsvRowSchema = z
  .object({
    pl_name: z.string().min(1),
    hostname: z.string().min(1),
    /** sy_dist in parsecs; must be finite and in (0, 50]. */
    sy_dist: z.preprocess((v) => {
      const n = Number(v);
      return isFinite(n) ? n : null;
    }, z.number().positive().lte(50)),
    /** Right ascension, DEGREES (0–360). */
    ra: z.preprocess((v) => {
      const n = Number(v);
      return isFinite(n) ? n : null;
    }, z.number().gte(0).lt(360)),
    /** Declination, DEGREES (−90–90). */
    dec: z.preprocess((v) => {
      const n = Number(v);
      return isFinite(n) ? n : null;
    }, z.number().gte(-90).lte(90)),
    sy_vmag: csvNum(),
    st_teff: csvNumPos(),
    st_mass: csvNumPos(),
    st_rad: csvNumPos(),
    pl_orbsmax: csvNumPos(),
    pl_orbper: csvNumPos(),
    /** Eccentricity [0, 0.95] after clamping — validate pre-clamp range. */
    pl_orbeccen: z.preprocess((v) => {
      if (typeof v !== 'string' || v.trim() === '') return null;
      const n = Number(v);
      return isFinite(n) ? n : null;
    }, z.number().gte(0).lt(1).nullable()),
    /** Argument of periapsis, DEGREES (archive convention). */
    pl_orblper: csvNum(),
    pl_rade: csvNumPos(),
    pl_bmasse: csvNumPos(),
  })
  .refine(
    (r) => r.pl_orbsmax !== null || r.pl_orbper !== null,
    'Each row must supply pl_orbsmax or pl_orbper (query filter should guarantee this)',
  );

export type CsvRow = z.infer<typeof CsvRowSchema>;

// ---------------------------------------------------------------------------
// Output pack schema — radians everywhere (validates SystemsPackManifest)
// ---------------------------------------------------------------------------

const finiteAngle = () => z.number().finite();

export const KeplerElementsSchema = z.object({
  semiMajorAxisAu: z.number().positive(),
  eccentricity: z.number().gte(0).lte(0.95),
  inclinationRad: finiteAngle(),
  ascendingNodeLongitudeRad: finiteAngle(),
  argumentOfPeriapsisRad: finiteAngle(),
  meanAnomalyAtEpochRad: finiteAngle(),
  epochJD: z.number(),
  muKm3S2: z.number().positive(),
});

export const PlanetRecordSchema = z.object({
  id: z.string(),
  kind: z.literal('planet'),
  name: z.string().optional(),
  parentId: z.string(),
  radiusKm: z.number().positive(),
  massKg: z.number().optional(),
  elements: KeplerElementsSchema.optional(),
  seed: z.number().optional(),
  rotationPeriodH: z.number().optional(),
  axialTiltRad: z.number().optional(),
  textures: z.object({ albedoUrl: z.string().optional(), ringUrl: z.string().optional() }).optional(),
  ring: z.object({ innerRadiusKm: z.number().positive(), outerRadiusKm: z.number().positive() }).optional(),
  surfaceColorLinear: z.tuple([z.number(), z.number(), z.number()]).optional(),
  unlit: z.boolean().optional(),
});

export const StarRecordSchema = z.object({
  id: z.string(),
  kind: z.literal('star'),
  name: z.string().optional(),
  positionPc: z.tuple([z.number(), z.number(), z.number()]),
  absMag: z.number(),
  colorIndexBV: z.number(),
});

export const StarSystemRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  star: StarRecordSchema,
  bodies: z.array(PlanetRecordSchema),
});

export const SystemsPackManifestSchema = z.object({
  packFormatVersion: z.literal(1),
  source: z.string(),
  generatedAtIso: z.string(),
  systems: z.array(StarSystemRecordSchema),
});
