# TASK-077 — Blindar la suma hi/lo del shader de estrellas contra fast-math + gate de shader compilado

**ID:** TASK-077
**Target package:** `packages/render-stars` + `apps/web` (probe) + `e2e` (gate)
**Size:** M
**Phase:** polish
**Depends on:** TASK-076 mergeada (branch `task-076-star-twinkle-floor` toca el mismo
vertex shader; esta task se implementa SOBRE ese estado, no sobre main pre-076).
Research: `docs/research/jitter-apple-mobile.md` (claims 1–6) +
`docs/research/star-approach-jitter.md`.

## Goal

El fix de jitter de aproximación (commit `6bd7d24`, offset emulated-double hi/lo) deja
de depender de la cortesía del compilador. Hoy la corrección exige que la GPU ejecute
`(position + uRenderOffsetHi) + uRenderOffsetLo` en ese orden exacto, y nada lo
garantiza: los backends fast-math (Metal en Mac M1/iPhone, GPUs móviles) pueden
reasociarla y reintroducir el bug original — que es exactamente el jitter que hoy se ve
en la M1 y en celulares mientras esta PC (ANGLE→D3D11) se ve perfecta. Al terminar:
(a) la suma lleva una guarda estructural que un compilador fast-math no puede plegar,
(b) existe un gate e2e que ejercita el shader COMPILADO por el driver real (hoy la única
guarda es un test de string), y (c) la misma página de probe sirve como banco A/B de
10 minutos en la M1/celulares, con resultado legible en pantalla sin consola.

## Step 0 — hechos a re-verificar antes de escribir código

Verificados 2026-07-14 **sobre main (`4630f3f`)** — TASK-076 mueve líneas del shader:
re-confirmar números de línea sobre el árbol ya mergeado antes de tocar nada.

1. `packages/render-stars/src/shaders/stars.vert.glsl.ts` — la suma vive en
   `vec3 viewPos = mat3(viewMatrix) * ((position + uRenderOffsetHi) + uRenderOffsetLo);`
   (línea 31 en main) y NO tiene `precise`, `invariant` ni `#pragma`
   (grep `precise|invariant|#pragma` en `packages/**/*glsl*` → 0 matches).
2. `packages/render-stars/src/star-points.ts:77-92` — `setRenderOffset` hace el split
   CPU correcto (`Math.fround` + residuo f64). No se toca.
3. `packages/render-stars/test/star-points.test.ts:81` — el único guard actual es
   `expect(VERT).toContain('mat3(viewMatrix) * ((position + uRenderOffsetHi) + uRenderOffsetLo)')`.
   TASK-076 agrega asserts vecinos en el mismo archivo.
4. `precise` NO compila en WebGL2 («'precise' : undeclared identifier», medido
   2026-07-14, ver claim 2 del research doc con el snippet de re-chequeo). Por eso la
   guarda es estructural, no un qualifier.
5. Precedente de probe+gate: `apps/web/src/app/flags.ts` (flags `?debug=`),
   `apps/web/src/App.tsx:19` (branch temprano a `JitterApp`),
   `apps/web/src/app/JitterApp.tsx` (SceneHost pelado, sin packs ni HUD),
   `apps/web/src/scene/JitterProbe.tsx` (constantes de escenario, publicación en
   `window.__jitterResult`), `e2e/tests/jitter.spec.ts` (forma del spec Playwright).
6. Patrón de readback probado: `tools/research/twinkle-live-probe.js` — un rAF
   registrado fuera del loop de three corre DESPUÉS del render del mismo turno y el
   drawing buffer sigue válido ahí pese a `preserveDrawingBuffer:false` (medido
   2026-07-14).
7. `createStarPoints` monta `THREE.Points` con AdditiveBlending, fondo de JitterApp
   `#02030a` (casi negro) — un punto brillante es localizable por luminancia.

## Context files

- `docs/research/jitter-apple-mobile.md` — el porqué completo; claims 1–6.
- `docs/research/star-approach-jitter.md` — el bug original y por qué el orden de la
  suma es sagrado (§3, §6-A).
- `packages/render-stars/src/shaders/stars.vert.glsl.ts` — donde entra la guarda.
- `packages/render-stars/src/star-points.ts` — donde entra el uniform `uGuardOne`.
- `apps/web/src/scene/JitterProbe.tsx` + `apps/web/src/app/JitterApp.tsx` +
  `e2e/tests/jitter.spec.ts` — el molde exacto de probe + app + gate.
- `tools/research/twinkle-live-probe.js` — el molde del readback de píxeles.

## Frozen — no tocar / no cambiar

- **La expresión guardada, textual:**
  ```glsl
  vec3 rel = (position + uRenderOffsetHi) * uGuardOne + uRenderOffsetLo;
  vec3 viewPos = mat3(viewMatrix) * rel;
  ```
  y la declaración `invariant gl_Position;` a nivel top del vertex shader. Ni una
  variante "equivalente": el `* uGuardOne` sobre el paréntesis es la guarda (fuerza a
  materializar la suma intermedia redondeada; el compilador no puede plegarla porque no
  sabe que vale 1.0), e `invariant` es el cinturón extra (en backends ANGLE→Metal
  desactiva optimizaciones de reordenamiento sobre la cadena de `gl_Position`).
- `uGuardOne` **vale 1.0 siempre**: se inicializa en 1.0 y NO tiene setter en la API.
  Multiplicar por 1.0 exacto no introduce redondeo; cualquier otro valor sí.
- La API pública de `StarPoints`/`StarPointsOptions` — sin opciones ni métodos nuevos.
- El split CPU de `setRenderOffset` (Step 0 fact 2) — intacto.
- Todo lo que TASK-076 congeló (ley de tamaño, `vSizeDim`, falloff del fragment, floor
  de 3 px, blending) — esta task solo toca la línea de la suma y agrega declaraciones.
- Constantes del escenario de la probe (elegidas, no ajustables por el implementador):
  origen del tile en `{ context: 'galaxy', local: [8000, 0, 0] }`; estrella tile-local
  `[30, 0, 0]` pc (30 es exactamente representable en f32 → error estático nulo, y ~30 pc
  es la magnitud de la hoja más profunda del octree real, el caso peor del research);
  cámara orbitando la estrella a 1 AU (`AU_PC = 4.84813681e-6`, misma constante que
  JitterProbe); `aAbsMag = 31.6` (a 1 AU da magnitud aparente ≈ 0 → punto de ~8 px sin
  clamp, centroide nítido); 10 frames de warmup + 300 medidos (como JitterProbe).
- **Umbral del gate: `maxDeviationPx < 1.5`.** El modo de fallo que detecta no es fino:
  sin la suma hi/lo efectiva, el salto es ~0.4–0.8 AU vistos a 1 AU ≈ decenas-cientos de
  px (research §3). 1.5 px absorbe ruido de centroide con margen enorme en ambas
  direcciones.
- El gate existente `?debug=jitter` y su umbral 0.5 px — no se toca.

## Out of scope

- Los paths single-f32 `position + uRenderOffset` de `render-galaxy`
  (galaxy-points/dust-lanes/impostor) y `render-fx` (nebula/line-set): hoy escapan al
  jitter porque se ocultan/fade de cerca. Si alguno se vuelve visible de cerca, es otra
  task con su propia medición.
- Empaquetar el atributo `position` como par hi/lo (6 f32) — el research original lo
  descartó como innecesario para matar el jitter.
- Extender el descenso a contexto `system` a estrellas sin host (opción D del research
  original) — decisión de producto, no fix del bug.
- Cualquier retune de perf/exposición; cualquier post-processing.
- Si el A/B en la M1 (Verification) NO elimina el jitter: eso dispara la KC3 del
  research doc (otro bug, mismo síntoma) → root-cause on-device en task nueva, jamás
  parches adicionales dentro de este diff.

*Standing rule: findings during this task go to `docs/research/`; scope creep goes to a
new task file, not into this diff.*

## Deliverables / Steps

1. **Guarda en el shader** (`stars.vert.glsl.ts`): declarar
   `uniform float uGuardOne;` e `invariant gl_Position;`, y reemplazar la suma por la
   forma congelada (ver Frozen). Actualizar el comentario de cabecera del shader: el
   porqué del guard en 2–3 líneas citando `docs/research/jitter-apple-mobile.md`, y que
   `* uGuardOne` es load-bearing — quien lo "simplifique" reintroduce el jitter en
   Metal/móvil sin que ningún test local lo vea.
2. **Uniform** (`star-points.ts`): `uGuardOne: { value: 1.0 }` junto a los
   `uRenderOffsetHi/Lo`, con comentario de una línea (siempre 1.0; opaco al compilador;
   sin setter).
3. **Tests unit** (`star-points.test.ts`): actualizar el string-assert a la nueva
   expresión textual; agregar asserts de que `VERT` contiene `invariant gl_Position;`
   y que `uniforms.uGuardOne.value === 1`.
4. **Probe** (`apps/web/src/scene/ShaderJitterProbe.tsx` +
   `apps/web/src/app/ShaderJitterApp.tsx` + flag `DEBUG_SHADER_JITTER`
   (`?debug=shaderjitter`) en `flags.ts` + branch en `App.tsx` junto a `DEBUG_JITTER`):
   - Monta el `createStarPoints` REAL con un batch sintético de 1 estrella
     (posición tile-local `[30, 0, 0]`, `aAbsMag = 31.6`, B–V cualquiera fijo), sin
     packs ni HUD (molde: JitterApp).
   - Por frame (en `useFrameContext`, `PRIORITY_RENDER`, molde JitterProbe): mover la
     cámara un paso de la órbita de 1 AU alrededor de la posición absoluta de la
     estrella (`[8030, 0, 0]` galaxy), `origin.setCameraPosition(...)`, alimentar
     `setRenderOffset(origin.toRenderSpace(TILE_ORIGIN, scratch))` (el f64 de
     producción), `lookAt` a la verdad f64 de la estrella, `setViewportHeight` una vez.
   - Medición en un loop rAF propio registrado en el mount (patrón probado de
     `twinkle-live-probe.js`, Step 0 fact 6 — corre tras el render del mismo turno):
     `gl.readPixels` de una región de 96×96 centrada en pantalla, centroide ponderado
     por luminancia, una muestra por frame medido. Si en un frame medido ningún píxel
     supera luminancia 40, registrar el frame como `lostFrames` y la desviación como
     999 (fallo ruidoso y triagable, nunca silencioso).
   - Al frame 300: publicar
     `window.__shaderJitterResult = { maxDeviationPx, frames, lostFrames, renderer }`
     (`renderer` = `UNMASKED_RENDERER_WEBGL`, para que cada corrida quede atribuida a
     su backend — claim 3 del research) **y** renderizar un overlay DOM fijo con
     PASS/FAIL, `maxDeviationPx`, y el string del renderer — legible en un celular sin
     DevTools.
5. **Gate e2e** (`e2e/tests/shader-jitter.spec.ts`, molde `jitter.spec.ts`): abrir
   `/?debug=shaderjitter`, esperar `window.__shaderJitterResult`, afirmar
   `frames === 300`, `lostFrames === 0`, `maxDeviationPx < 1.5`, cero pageerrors.
   El mensaje del expect incluye el valor medido Y el string del renderer (regla 6 del
   repo: triagable desde logs).

Task mecánica: exactamente estos archivos. No refactorizar JitterProbe, no extraer
helpers compartidos entre probes, no tocar call sites de `createStarPoints`.

## Failure modes to watch

- **"Simplificar" la guarda.** `* uGuardOne` parece código muerto (multiplica por 1) y
  el molde mental de un linter/reviewer es borrarlo. Es EL fix. El comentario del paso 1
  y el string-assert del paso 3 existen para eso — no los suavices.
- **Pisar TASK-076.** El vertex shader post-076 computa `sNat`/`sRen`/`vSizeDim` en las
  líneas vecinas; esta task reemplaza SOLO la línea de la suma. Si tu diff toca la ley
  de tamaño o el dimming, parate y releé el spec de TASK-076.
- **Colapsar hi+lo en CPU.** Cualquier "optimización" que sume `hi + lo` antes de subir
  los uniforms deshace todo (el research original, §6-A: el split debe llegar entero a
  la GPU).
- **Readback en el momento equivocado.** Con `preserveDrawingBuffer:false`, leer píxeles
  fuera del turno del render devuelve basura/negro. Usar exactamente el patrón del
  Step 0 fact 6; si `lostFrames > 0` en CI, el log ya dice qué mirar (timing del rAF),
  no aflojes el umbral.
- **El gate nuevo falla en CI al aterrizar (con la guarda puesta).** Significaría que el
  compilador del backend de CI también reasocia pese a la guarda — hallazgo de primera:
  va a `docs/research/jitter-apple-mobile.md` como addendum y se investiga; NO se sube
  el umbral para poner verde (doctrina del repo: root causes, no coping).
- **Medir con la estrella clampeada a 64 px.** Si cambiás `aAbsMag` o el radio de
  órbita, el punto puede saturar al max clamp y el centroide pierde sentido — las
  constantes están congeladas por esto.
- **Screenshots/wall-clock en el gate.** Regla 4 del repo: el gate es el número
  determinista publicado por la probe; nada de screenshot-diff ni FPS.
- **Olvidar el smoke local.** Cambio de comportamiento + spec e2e nuevo ⇒ correr
  `pnpm test:smoke` sobre `shader-jitter.spec.ts` antes de pushear (carve-out validado
  del repo); la suite completa queda en CI.

## Acceptance gate (determinista — todo en CI)

1. `pnpm verify` verde (incluye los unit tests del paso 3: expresión guardada textual,
   `invariant gl_Position;`, `uGuardOne === 1`).
2. `e2e/tests/shader-jitter.spec.ts` verde en chromium CI: `frames === 300`,
   `lostFrames === 0`, `maxDeviationPx < 1.5`, sin pageerrors; el log de cada corrida
   contiene el valor medido y el renderer string.
3. `e2e/tests/jitter.spec.ts` (gate viejo) sigue verde sin modificaciones.
4. Los gates de work-budget existentes no se mueven (la guarda no cambia
   `renderedPoints` ni draw calls; si alguno falla, investigar, no re-tunear).

## Verification beyond the gate (reference-device, no bloqueante — el A/B del research)

En la M1 y en al menos un celular, con un deploy/preview de CADA lado del diff:

1. **Pre-guard** (main o el deploy actual): abrir `/?debug=shaderjitter`. Esperado:
   FAIL en pantalla con desviación grande — esto confirma la Belief causal del research
   (reasociación fast-math) con medición, no inferencia. Anotar `maxDeviationPx` y el
   renderer string.
2. **Post-guard** (este diff): mismo URL. Esperado: PASS, sub-2 px.
3. Vuelo manual en la M1 a una estrella sin host (el síntoma original): jitter ausente.
4. Registrar los cuatro números (pre/post × M1/celular) + renderer strings como
   addendum en `docs/research/jitter-apple-mobile.md`, y actualizar el memory del
   jitter. Si el paso 1 da PASS (el pre-guard NO jitterea en la probe pero el vuelo
   manual sí), la probe no reproduce el modo de fallo real → parar y volver a research
   (KC3), no ajustar la probe a ciegas.
