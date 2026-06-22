// Atmosphere shell fragment shader — O'Neil analytic single-scattering (ADR-005 §1–§3, §5).
//
// Reference: Sean O'Neil, "Accurate Atmospheric Scattering", GPU Gems 2, ch. 16
// (the "SkyFromSpace" path). Single-scattering only; no precomputed LUT and no
// ray-marching loop beyond the fixed `uSamples` in-scatter sample count (ADR-005 §1).
// All math is in LINEAR RGB (architecture §10); `uBetaRayleigh` is linear-RGB.
//
// O'Neil's per-channel `Kr * invWavelength^4` is folded into `uBetaRayleigh` directly
// (ADR-005 §3 stores the normalized 1/λ⁴ ratios), and `Km` into `uBetaMie`.
export const ATMOSPHERE_FRAG = /* glsl */ `
#define uSamples 5

uniform vec3 uStarDir;        // unit vector planet->star
uniform vec3 uRenderOffset;   // camera-relative shell-center offset, context units
uniform float uPlanetRadius;      // context units
uniform float uAtmosphereRadius;  // context units
uniform vec3 uBetaRayleigh;   // per-channel scattering coeff (Kr * 1/λ⁴), linear RGB
uniform float uBetaMie;       // grey Mie scattering coeff (Km)
uniform float uRayleighScaleHeight; // O'Neil fScaleDepth (fraction of thickness)
uniform float uMieG;          // Mie phase asymmetry g
uniform float uSunIntensity;  // O'Neil ESun
uniform float uCameraExposure;
uniform float uOpacity;       // cross-fade alpha [0,1]

varying vec3 vShellPos;

const float PI = 3.141592653589793;
const float PI4 = 12.566370614359172; // 4*PI

// O'Neil's optical-depth exp-polynomial fit (GPU Gems 2 ch.16). The constants assume
// fScaleDepth = 0.25 (ADR-005 §3 default); do not re-fit (ADR-005 §2).
float scale(float fCos, float fScaleDepth) {
  float x = 1.0 - fCos;
  return fScaleDepth * exp(-0.00287 + x * (0.459 + x * (3.83 + x * (-6.80 + x * 5.25))));
}

void main() {
  float fInner = uPlanetRadius;
  float fOuter = uAtmosphereRadius;
  float fScale = 1.0 / (fOuter - fInner);
  float fScaleDepth = uRayleighScaleHeight;
  float fScaleOverScaleDepth = fScale / fScaleDepth;

  // Camera position in shell space is -uRenderOffset (floating origin, ADR-001 §5).
  vec3 v3CameraPos = -uRenderOffset;

  // Ray from camera to this shell point (both shell-center-relative, context units).
  vec3 v3Ray = vShellPos - v3CameraPos;
  float fFar = length(v3Ray);
  v3Ray /= fFar;

  // Closest intersection of the ray with the outer atmosphere shell (SkyFromSpace).
  float fCameraHeight = length(v3CameraPos);
  float B = 2.0 * dot(v3CameraPos, v3Ray);
  float C = fCameraHeight * fCameraHeight - fOuter * fOuter;
  float fDet = max(0.0, B * B - 4.0 * C);
  float fNear = 0.5 * (-B - sqrt(fDet));

  vec3 v3Start = v3CameraPos + v3Ray * fNear;
  fFar -= fNear;

  float fStartAngle = dot(v3Ray, v3Start) / fOuter;
  float fStartDepth = exp(-1.0 / fScaleDepth);
  float fStartOffset = fStartDepth * scale(fStartAngle, fScaleDepth);

  // Fixed-count in-scatter integration (uSamples points; ADR-005 §2). No marching loop.
  float fSamples = float(uSamples);
  float fSampleLength = fFar / fSamples;
  float fScaledLength = fSampleLength * fScale;
  vec3 v3SampleRay = v3Ray * fSampleLength;
  vec3 v3SamplePoint = v3Start + v3SampleRay * 0.5;

  vec3 v3FrontColor = vec3(0.0);
  vec3 betaExt = (uBetaRayleigh + vec3(uBetaMie)) * PI4; // out-scatter extinction coeff
  for (int i = 0; i < uSamples; i++) {
    float fHeight = length(v3SamplePoint);
    float fDepth = exp(fScaleOverScaleDepth * (fInner - fHeight));
    float fLightAngle = dot(uStarDir, v3SamplePoint) / fHeight;
    float fCameraAngle = dot(v3Ray, v3SamplePoint) / fHeight;
    float fScatter = fStartOffset + fDepth * (scale(fLightAngle, fScaleDepth) - scale(fCameraAngle, fScaleDepth));
    vec3 v3Attenuate = exp(-fScatter * betaExt);
    v3FrontColor += v3Attenuate * (fDepth * fScaledLength);
    v3SamplePoint += v3SampleRay;
  }

  vec3 cRayleigh = v3FrontColor * (uBetaRayleigh * uSunIntensity);
  vec3 cMie = v3FrontColor * (uBetaMie * uSunIntensity);

  // Phase functions combined at the fragment (Rayleigh + Henyey-Greenstein Mie).
  float fCos = dot(uStarDir, -v3Ray);
  float fCos2 = fCos * fCos;
  float g = uMieG;
  float rayleighPhase = 0.75 * (1.0 + fCos2);
  float miePhase = 1.5 * ((1.0 - g * g) / (2.0 + g * g)) *
    (1.0 + fCos2) / pow(max(0.0, 1.0 + g * g - 2.0 * g * fCos), 1.5);

  vec3 hdr = rayleighPhase * cRayleigh + miePhase * cMie;
  // HDR -> LDR exposure tone curve (O'Neil), then additive over the lit planet.
  vec3 ldr = vec3(1.0) - exp(-uCameraExposure * hdr);

  gl_FragColor = vec4(ldr, uOpacity);
}
`;
