# Research: surge de velocidad con Shift+W dentro de la galaxia

**Fecha:** 2026-07-13
**Síntoma reportado:** al avanzar con Shift+W dentro de la galaxia, la velocidad
acelera y luego **baja sola**, generando un efecto raro de aceleración/freno
oscilante. Hipótesis del usuario: velocidad o streaming.

## Step 1 — Preguntas falsables

- **Q1:** ¿La velocidad de avance está escalada adaptativamente por alguna
  cantidad que cambia al moverse (distancia al objeto más cercano, escala,
  densidad local)? Es decir, ¿el "freno" es una reducción *intencional* del
  speed scale y no un bug?
- **Q2:** ¿El boost de Shift es una rampa de aceleración con decaimiento/clamp
  (accel + damping) en vez de un multiplicador constante, de modo que la
  velocidad puede sobrepasar y volver a caer por diseño de la integración?
- **Q3:** ¿El streaming (carga de octree / procgen) produce picos de frame-time
  que, combinados con integración dependiente de `dt`, alteran la velocidad
  efectiva percibida (surges al recuperar frames largos)?

## Step 2 — Condiciones de kill / redirect (escritas ANTES de investigar)

- **K1 (mata "es un bug de velocidad"):** si Q1 = sí — la velocidad se escala
  por distancia/escala y el usuario cruza regiones que cambian esa cantidad —
  entonces el efecto es *comportamiento diseñado mal calibrado*, no un bug de
  integración. El trabajo se reformula como tuning/suavizado del speed scale,
  no como fix de streaming.
- **K2 (mata "es streaming"):** si el cálculo de velocidad no usa `dt` crudo en
  ninguna rama sensible a hitches, o si puedo reproducir el surge con streaming
  ya completo (todo cargado, sin requests), streaming queda descartado como
  causa.
- **K3 (mata "es la rampa de Shift"):** si Shift es un multiplicador constante
  aplicado a una velocidad ya estable, la rampa no puede explicar oscilación
  sostenida.

## Step 3–4 — Claims

```
CLAIM:    En contexto galaxy, la velocidad objetivo de vuelo libre se recalcula
          CADA frame como clamp(1.0 × distancia-a-la-estrella-HYG-más-cercana,
          1e-7, 10 pc/s), y Shift la multiplica ×10 (constante, sin rampa).
          Ningún otro input entra en la ley.
EVIDENCE: packages/nav/src/controller.ts:1085-1088 (targetSpeed = clamp(speedScale
          × distanceToNearestSurface, ...); speedBoost → ×10);
          apps/web/src/scene/NavDriver.tsx:51 (cap 10), :98, :200-210 (el feed
          galaxy es nearestStarIndex de HYG).
VERIFIED: 2026-07-13
RECHECK:  leer controller.ts:1085-1088 y NavDriver.tsx:186-212
```

```
CLAIM:    La velocidad real persigue ese objetivo con un suavizado exponencial
          de semivida 90 ms — lo bastante rápido para que cada salto del
          objetivo se sienta como un acelerón o un frenazo en <0.3 s.
EVIDENCE: packages/nav/src/controller.ts:162 (DEFAULT_DAMPING_HALF_LIFE_MS=90),
          :1135-1139 (decay exponencial hacia targetVel).
VERIFIED: 2026-07-13
RECHECK:  leer controller.ts:162 y :1135-1139
```

```
CLAIM:    Medido en runtime: con Shift+adelante sostenido DENTRO del campo
          estelar, la velocidad osciló 9.3 ↔ 90.8 pc/s durante ~10 s (p.ej.
          12.8→18.6→10.2→27.0→9.3→46.4→33.0→90.8→33.0 pc/s); al salir del
          campo HYG (z ≳ 300 pc de Sol) quedó CLAVADA en 100 pc/s (cap 10 ×
          boost 10) sin una sola oscilación más. La oscilación existe solo
          donde hay estrellas cercanas cambiando la distancia-al-más-cercano.
EVIDENCE: muestreo 2026-07-13 vía eval en la app dev (keydown sintético
          ShiftLeft+KeyS sobre el canvas, lectura de .hud-speed-value cada
          250 ms + __cosmos.cameraPosition), 79 muestras.
VERIFIED: 2026-07-13
RECHECK:  pnpm --filter @cosmos/web dev; en consola: mantener Shift+W/S dentro
          del campo (|pos| < 300 pc) y muestrear
          document.querySelector('.hud-speed-value').textContent cada 250 ms;
          repetir con |pos| > 400 pc — dentro oscila, fuera queda fija en 100.
```

```
CLAIM:    El streaming NO alimenta la ley de velocidad en contexto galaxy: el
          escalar de streaming (nearestBodyDistanceM) solo se consume en la
          rama 'universe', con comentario explícito de que no debe conducir la
          ley galaxy.
EVIDENCE: apps/web/src/scene/NavDriver.tsx:173-184 ("it must NOT drive the
          galaxy speed law — §5.8 nearest is for universe").
VERIFIED: 2026-07-13
RECHECK:  leer NavDriver.tsx:173-184
```

```
CLAIM:    No hay hitches de frame distorsionando la integración: a velocidad
          de cap el desplazamiento medido fue constante (~24.85 pc por muestra
          de 250 ms ≈ 99.4 pc/s) durante 9 s seguidos.
EVIDENCE: mismas 79 muestras (columna z), tramo t=11.0s→19.9s.
VERIFIED: 2026-07-13
RECHECK:  mismo muestreo del claim anterior, mirando deltas de posición
```

## Step 5 — Qué busqué y NO encontré

- **Ninguna rampa de aceleración en Shift:** grep `speedBoost` en
  `packages/nav/src` — es un booleano que multiplica ×10 el objetivo del frame
  (controller.ts:1086-1088); no hay estado acumulativo. → K3 aplicada: la rampa
  no existe, no puede ser la causa.
- **Ningún input de streaming/procgen en la rama galaxy del feed de superficie:**
  leído NavDriver.tsx completo — la rama galaxy usa solo HYG
  (`nearestStarIndex`) o distancia-al-campo; `streaming` aparece únicamente en
  la rama universe. → K2 aplicada: streaming descartado.
- **Ningún suavizado sobre `distanceToNearestSurface`:** grep
  `setDistanceToNearestSurface` — se escribe crudo cada frame desde el feed;
  el único filtro del sistema es la semivida de 90 ms sobre la velocidad.

## Step 6 — Veredicto: REFRAME

**No es un bug de velocidad ni de streaming — es la ley de velocidad diseñada,
sin filtrar, sobre una señal ruidosa.** La premisa "algo anda mal en la
velocidad o el streaming" muere con los claims 1, 3 y 4: la velocidad es
*proporcional a la distancia a la estrella más cercana* por diseño (volás
rápido lejos de todo, frenás cerca de algo). Al cruzar el campo estelar con
Shift (hasta 100 pc/s) pasás cerca de una estrella cada fracción de segundo,
la distancia-al-más-cercano sube y baja constantemente, y la velocidad la
persigue con semivida de 90 ms → el efecto acelerón/frenazo que se percibe.
Fuera del campo la señal es lisa y el efecto desaparece por completo (medido).

**La pregunta real** no es "arreglar la velocidad" sino "¿la ley debe muestrear
la estrella más cercana cruda, o una versión suavizada?". Direcciones de tuning
(para un spec futuro, no decididas acá): suavizar/limitar la tasa de cambio de
`distanceToNearestSurface` en la rama galaxy; asimetría (frenado rápido al
acercarse, liberación lenta al alejarse — la mitad "frenazo" del efecto es la
que molesta); o una distancia efectiva menos puntual que el vecino más cercano
exacto (p. ej. soft-min sobre k vecinos).
