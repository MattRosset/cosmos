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

*(Investigación pendiente al momento de este commit — Steps 3–6 se completan
después.)*
