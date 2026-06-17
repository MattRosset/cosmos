// B-V color index → linear RGB LUT — shared from render-stars (no duplication).
// Color parity is guaranteed by construction; the acceptance test verifies it.
export {
  buildBlackbodyLutData,
  bvToLinearRgb,
  bvToTemperature,
  LUT_SIZE,
} from '@cosmos/render-stars';
