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

*(pendiente — se llena en la fase de investigación)*

## Lo que busqué y no encontré

*(pendiente)*

## Veredicto

*(pendiente)*
