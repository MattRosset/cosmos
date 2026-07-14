# Research — el jitter de aproximación persiste en M1/celulares (el fix hi/lo solo verificado en Windows)

> Reporte (2026-07-14): «en esta PC el jitter no existe casi, con el fix que
> hicimos anda perfecto; el problema es que en celulares y en mi Mac M1 hay
> jitter».

Doc previo: [star-approach-jitter.md](star-approach-jitter.md) — el diagnóstico
original (cancelación catastrófica f32 en la GPU) y el fix elegido (offset
emulated-double hi/lo: `(position + offHi) + offLo`).

## Estado: pre-investigación (preguntas + kill conditions, escritas antes de abrir el código)

## Preguntas falsificables

- **Q1** — ¿La suma hi/lo del vertex shader de estrellas está protegida contra
  la reasociación del compilador (`precise`, `invariant`, o una construcción que
  el optimizador no pueda reordenar)? Los paréntesis solos **no** son garantía
  bajo fast-math. Se responde leyendo
  `packages/render-stars/src/shaders/stars.vert.glsl.ts` y
  `star-points.ts` en su estado actual.
- **Q2** — ¿Todos los términos de esa suma son `highp` efectivo en el vertex
  shader (atributo, uniforms, temporales)? En GPUs móviles `mediump` puede ser
  f16 real; en desktop siempre es f32, lo que también explicaría el split
  Windows-bien/móvil-mal. Se responde leyendo los qualifiers del shader.
- **Q3** — ¿La verificación del fix se hizo alguna vez en un dispositivo
  Apple/móvil, o solo en esta PC (ANGLE→D3D11)? Se responde buscando la probe o
  el gate del fix y dónde corrió.
- **Q4** *(requiere el dispositivo)* — ¿El jitter observado en la M1 tiene la
  misma firma que el bug original — amplitud ~ULP de la magnitud del tile
  (~0.4–0.8 UA), solo en estrellas sin host, crece al acercarse — o es otro modo
  de fallo (pacing de frames, DPR, half-float render target)? Se responde con
  una sonda de consola en la Mac, no acá.

## Kill conditions (escritas antes de investigar)

- **KC1** — Si Q1 da «no está protegida»: muere la premisa «el fix funciona»;
  funciona *donde el compilador no reasocia*. El trabajo deja de ser «research
  del jitter en la Mac» y pasa a ser «endurecer la suma hi/lo contra fast-math +
  sonda on-device de 10 minutos para confirmar». La Mac queda como banco de
  medición, no de investigación.
- **KC2** — Si Q1/Q2 dan «protegida y todo highp»: muere la hipótesis
  compilador/precisión desde el escritorio, y la investigación **sí** tiene que
  hacerse en el dispositivo (Q4 pasa a ser el centro).
- **KC3** — Si la sonda on-device (Q4) muestra amplitud que **no** escala con la
  magnitud del tile ni con la cercanía: muere la premisa «es el mismo bug de
  precisión» → reframe (es otro bug con el mismo síntoma).

## Claims

```
CLAIM:    La suma hi/lo del vertex shader de estrellas depende únicamente del
          orden de paréntesis del fuente; no hay ninguna construcción
          anti-reasociación en el shader ni en ningún shader del repo.
EVIDENCE: packages/render-stars/src/shaders/stars.vert.glsl.ts:31 —
          `mat3(viewMatrix) * ((position + uRenderOffsetHi) + uRenderOffsetLo)`;
          grep `precise|invariant|#pragma` en packages/**/*glsl* → 0 matches.
VERIFIED: 2026-07-14
RECHECK:  rg "precise|invariant|#pragma" packages -g "*glsl*" ; leer
          stars.vert.glsl.ts línea 31.
```

```
CLAIM:    El qualifier `precise` NO existe en WebGL2 (GLSL ES 3.00): un vertex
          shader `#version 300 es` con `precise vec3 r = (pos + uHi) + uLo;`
          falla la compilación con «'precise' : undeclared identifier», mientras
          el mismo shader sin `precise` compila. La mitigación no puede ser un
          qualifier — tiene que ser estructural.
EVIDENCE: compilación en vivo vía gl.compileShader en Chrome (win32),
          2026-07-14; output: plain ok=true, withPrecise ok=false con ese error.
VERIFIED: 2026-07-14
RECHECK:  en consola de cualquier página: crear canvas → getContext('webgl2') →
          compilar ambos vertex shaders y comparar COMPILE_STATUS.
```

```
CLAIM:    La PC donde «no hay jitter» compila los shaders vía ANGLE→Direct3D11
          (AMD RX 9070 XT). Es decir, el único entorno donde el fix se validó
          usa un backend distinto al de todos los entornos que fallan
          (M1 y celulares = Metal / GPUs móviles).
EVIDENCE: WEBGL_debug_renderer_info en esta máquina, 2026-07-14: «ANGLE (AMD,
          AMD Radeon RX 9070 XT ... Direct3D11 vs_5_0 ps_5_0, D3D11)».
VERIFIED: 2026-07-14
RECHECK:  gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) en cada dispositivo; en
          la M1 se espera un renderer «... Metal ...» (anotarlo al medir).
```

```
CLAIM:    El split CPU del offset es correcto: hi = Math.fround(componente f64),
          lo = residuo f64 exacto guardado en su propio slot. El error, si lo
          hay, no está del lado CPU.
EVIDENCE: packages/render-stars/src/star-points.ts:77-92.
VERIFIED: 2026-07-14
RECHECK:  leer setRenderOffset en star-points.ts.
```

```
CLAIM:    Todos los términos de la suma son f32 highp: three@0.184.0 inyecta
          `precision highp float;` en los programas de ShaderMaterial y el repo
          no declara overrides de precisión. mediump/f16 no es el mecanismo.
EVIDENCE: node_modules/.pnpm/three@0.184.0/.../build/three.module.js:3410
          (`precision highp float;`); grep `precision|highp|mediump` en
          packages/render-stars/src → 0 matches.
VERIFIED: 2026-07-14
RECHECK:  ambos greps.
```

```
CLAIM:    La única guarda de regresión del fix es un test de TEXTO — verifica
          que el string del shader contenga la suma con ese paréntesis
          (`expect(VERT).toContain(...)`). Ningún gate ejercita el shader
          COMPILADO por un driver real; JitterProbe sigue midiendo el path
          f64→fround de un resultado pequeño (el punto ciego documentado en
          star-approach-jitter.md §5 sigue abierto).
EVIDENCE: packages/render-stars/test/star-points.test.ts:76-81;
          apps/web/src/scene/JitterProbe.tsx:122-124; fix = commit 6bd7d24
          (2026-06-28), sin probe on-device asociada.
VERIFIED: 2026-07-14
RECHECK:  leer star-points.test.ts:76-81 y JitterProbe.tsx:109-126.
```

## Beliefs (segunda clase — sin RECHECK mecánico local; NO citar como Step 0)

- **La causa propuesta:** los compiladores Metal (Safari macOS/iOS, y Chrome
  macOS vía ANGLE→Metal) compilan con fast-math por defecto, que permite
  reasociar sumas flotantes: `(position + Hi) + Lo → position + (Hi + Lo)`
  colapsa Lo dentro de Hi y reproduce exactamente el bug original de
  star-approach-jitter.md. Es el modo de fallo clásico de los trucos
  emulated-double en shaders (documentado en deck.gl/luma.gl fp64 y en issues
  del backend Metal de ANGLE). Consistente con el split observado
  (D3D11 bien / Metal+móvil mal), pero solo lo confirma el A/B on-device (Q4).
- ANGLE→D3D11 preserva el orden IEEE de la expresión (por eso esta PC no
  jitterea) — inferencia, no medición.
- En GLSL ES 3.00 el vertex shader soporta highp f32 obligatoriamente; la vía
  f16 queda descartada por spec, no por medición en dispositivo.

## Lo que busqué y no encontré

- **Ninguna protección anti-fast-math en ningún shader**: grep
  `precise|invariant|#pragma` sobre `packages/**/*glsl*` → 0 resultados.
- **Ningún override de precisión** en render-stars: grep
  `precision|highp|mediump` en `packages/render-stars/src` → 0 resultados.
- **Ningún gate que ejercite el shader compilado** (ni local ni CI): la búsqueda
  de «jitter» en apps/web da solo JitterProbe (path f64 por objeto, punto ciego
  conocido) y probes no relacionadas. El fix nunca tuvo verificación en un
  backend que no sea D3D11.
- **`precise` como salida fácil**: no existe en WebGL2 (medido, ver claim 2).

## Veredicto — REFRAME

La pregunta de entrada era «¿hago el research en la Mac?». **No**: la premisa
implícita — «el fix funciona y en móvil hay un bug nuevo que investigar allá» —
murió en el escritorio. Lo que muestran los claims 1, 3 y 6 es que el fix
**nunca estuvo garantizado**: su corrección depende del orden textual de una
suma que ningún estándar obliga a respetar, se validó en un solo backend
(ANGLE→D3D11), y su única guarda es un test de string. Los entornos que fallan
son exactamente los backends fast-math (Metal/móvil). KC1 disparada.

**Qué sigue** (para spec-task, no para más research):

1. Endurecer la suma hi/lo contra reasociación en
   `stars.vert.glsl.ts` — `precise` no existe en WebGL2 (claim 2), así que la
   opción es estructural (p. ej. el truco de deck.gl fp64: interponer un
   uniform ≡ 1.0 que el compilador no puede plegar, u otra forma opaca de
   forzar el orden). Elegir la variante es trabajo del spec.
2. La Mac M1 entra como **banco de medición de 10 minutos**, no de
   investigación: A/B del build con y sin el guard, volando a una estrella
   sin host. Anotar el UNMASKED_RENDERER (claim 3 RECHECK) y si el jitter
   desaparece. Ese A/B es el RECHECK definitivo de la Belief causal.
3. Cerrar el punto ciego §5 de star-approach-jitter.md: una probe que ejercite
   el shader real compilado (no un string match) — es la única forma de que un
   futuro cambio de driver/compilador no reintroduzca esto en silencio.
4. **Solo si** el A/B on-device NO elimina el jitter → KC3: es otro bug con el
   mismo síntoma, y ahí sí toca root-cause en el dispositivo (sonda de firma:
   ¿amplitud ~ULP del tile? ¿solo estrellas sin host? ¿crece al acercarse?).
