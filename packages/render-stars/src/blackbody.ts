// B-V color index → linear RGB via Ballesteros (2012) temperature and
// Tanner Helland piecewise blackbody approximation.
// Source: https://tannerhelland.com/2012/09/18/convert-temperature-rgb-algorithm-code.html

export const LUT_SIZE = 256;

/**
 * Ballesteros (2012): B-V color index → effective temperature in Kelvin.
 * Valid for B-V ∈ [-0.4, 2.0].
 */
export function bvToTemperature(bv: number): number {
  return 4600 * (1 / (0.92 * bv + 1.7) + 1 / (0.92 * bv + 0.62));
}

/**
 * Tanner Helland piecewise approximation: temperature (K) → sRGB [0, 1].
 * The original formula outputs 0-255 integers; we normalise to [0, 1] here.
 */
function temperatureToSrgb(kelvin: number): readonly [number, number, number] {
  const t = kelvin / 100;

  const r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);

  const g =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * Math.pow(t - 60, -0.0755148492);

  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;

  return [
    Math.max(0, Math.min(1, r / 255)),
    Math.max(0, Math.min(1, g / 255)),
    Math.max(0, Math.min(1, b / 255)),
  ];
}

/** sRGB component [0, 1] → linear light [0, 1] (IEC 61966-2-1). */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Sample the blackbody LUT at a given B-V value.
 * Returns linear RGB in [0, 1] — no gamma, no tone mapping.
 */
export function bvToLinearRgb(bv: number): readonly [number, number, number] {
  const temp = bvToTemperature(bv);
  const [sr, sg, sb] = temperatureToSrgb(temp);
  return [srgbToLinear(sr), srgbToLinear(sg), srgbToLinear(sb)];
}

/**
 * Build the 256×1 RGBA Uint8Array for a DataTexture.
 * LUT domain: B-V ∈ [-0.4, 2.0]; texel i maps to bv = i/255 * 2.4 - 0.4.
 * Values are linearised sRGB — set the Three.js texture colorSpace to
 * NoColorSpace so no further conversion is applied on the GPU.
 */
export function buildBlackbodyLutData(size: number = LUT_SIZE): Uint8Array {
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const bv = (i / (size - 1)) * 2.4 - 0.4;
    const [r, g, b] = bvToLinearRgb(bv);
    data[i * 4] = Math.round(r * 255);
    data[i * 4 + 1] = Math.round(g * 255);
    data[i * 4 + 2] = Math.round(b * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}
