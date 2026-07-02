# Research — UI/UX perception, scale literacy, and visual polish

**Date:** 2026-07-01 · **Status:** research / proposal (no production code changed)
**Revised:** 2026-07-02 after review — jump-story surfaces merged into one Jump HUD (W2),
repetition dampening added, S2 threshold-gated, D7/D8 promoted to Phase 1, ×c honesty
decision (§3.3), D4 scoped to letterbox+copy (integrated-GPU floor), C3 scoped to card-only
v1, D3 segment mapping pinned, open questions 1–2 resolved. Tasks: TASK-066…068.
**Trigger:** post–M4a review. The simulation stack (multi-scale nav, packs, overlays,
tours) is solid, but the HUD layer undersells it: generic glass panels, opaque units,
and no visual language for the three distinct movement modes the engine already runs.
Users cannot *feel* scale changes or interpret speed/distance — the UI reads like a
debug overlay on a remarkable engine.

**Scope boundary (non-negotiable for this lane):** improve **perception and
presentation**. Do **not** change `@cosmos/nav` motion laws, `goTo` durations, context
switch hysteresis, or streaming/render architecture unless a UI-only affordance truly
cannot work without a one-line hook (e.g. exposing `goToActive` to the HUD — already
available). The engine's "wormhole" `goTo` flights stay; we **name, frame, and
illustrate** them instead of pretending they are physical travel.

**Related docs:**
- `docs/research/navigation-ux.md` — enter/exit opacity, host-star data gaps (orthogonal;
  some InfoPanel copy proposals overlap).
- `docs/research/telescope-effect-magnitude-reveal.md` — depth/zoom in galaxy view (complements
  scale perception §4).
- `docs/research/goto-galaxy-transit-black.md` / `galaxy-transit-procgen-floor-design.md` —
  spiral fade during breadcrumb flights (render; already landed).
- `docs/agent-tasks/TASK-012-ui.md`, `TASK-026-ui-v2.md`, `TASK-050-ui-overlays-tours.md` —
  prior HUD specs.

---

## 0. Project charter alignment

Cosmos is defined in [`docs/architecture.md`](../architecture.md) as a **browser-based
universe explorer** with real catalogs (HYG, Gaia, NASA Exoplanet Archive), procedural
fill, seamless multi-scale navigation, and **educational overlays** (§5.12). Milestone
M4 explicitly targets a *"wow"* build with guided tours **for education use**.

This research lane **does not contradict** that charter — it closes the gap between what
the engine already does and what the user understands:

| Charter principle | How this doc aligns |
|-------------------|---------------------|
| Real data for **credibility and education** (§2.2) | Human units (ly, light-travel time, ×c) translate real pack fields into insight — they do not replace accurate positions. |
| Seamless zoom galaxy → planet (M3/M4) | Scale ruler, jump framing, and arrival cards help users **feel** the zoom the sim already performs. |
| HUD shows **educational data** (§5.12) | Card redesign (§6) and `@ c` ETAs (§5) fulfil the InfoPanel mandate; today's jargon-heavy `<dl>` under-delivers it. |
| Nav is **perceived-speed** by design (`@cosmos/nav` README) | Labeling scale jumps as wormhole / scale-link is **honest** about `goTo`; pretending `pc/s` is physical flight would be the betrayal. |

**Realism of data ≠ realism of interface.** Internal coordinates stay ICRS/parsecs
(ADR-001); the HUD is a translation layer, like an atlas showing "500 km" instead of
raw UTM coordinates.

### 0.1 Intentional sequencing (base first, UI now)

The project deliberately built the simulation stack before polishing perception: scale
contexts, packs, streaming, context switch, overlays, and tours (M0–M4a) had to be
correct and test-gated first. A perception/UI lane on a broken engine would be lipstick
on a broken model.

**Now** the base is solid; this doc is the next layer — presentation and literacy — not
a pivot away from the original goals.

---

## 1. Executive summary

Cosmos today has **three movement modes** that the UI presents as one:

| Mode | Mechanism (frozen) | What the user experiences |
|------|--------------------|---------------------------|
| **Scale jump** | `goTo` with fixed `durationMs` (breadcrumb Milky Way ↔ Galaxy, double-click fly, bookmarks) | Teleport-with-easing across enormous distances in ~5–6 s |
| **Free exploration** | WASD + log-scaled speed law (`speed ∝ distance to nearest surface`) | Slow at galactic scales; units shown as `pc/s` or `AU/s` |
| **Guided tour** | Cinematic splines + optional letterbox | Polished, but isolated to the tour path |

The gap is **not simulation fidelity** — it is **literacy and affordance**. Parsecs,
kiloparsecs, and context-unit speeds are meaningless to most users. Scale jumps at
~10¹²× the speed of light feel like a gentle dolly because there is no jump framing,
no human-unit readout, and no persistent scale ruler. Info cards show correct
astronomy in jargon, not insight.

**Proposal:** treat UI work as a dedicated "perception lane" — human units, movement-mode
labeling, scale transitions, card redesign, and a distinctive visual identity — without
rewriting nav.

---

## 2. Current UI assessment

### 2.1 What works

- **Flight-instrument design tokens** (`packages/ui/src/ui.css`) — coherent dark glass,
  cool accent; HUD correctly stays out of the Canvas (§5.12).
- **Breadcrumb** (`apps/web/src/App.tsx`) — correct semantic model for scale context.
- **Dock consolidation** (`packages/ui/src/Dock.tsx`) — time, exposure, search, bookmarks
  in one bar.
- **Search palette** — keyboard-first, ARIA roles, debounced fuzzy catalog.
- **Tour + letterbox** — the only place scale flight feels "cinematic" today.

### 2.2 What holds the product back

1. **Generic chrome** — system-ui font, standard glass morphism, floating rectangles;
   indistinguishable from a generic R3F demo.
2. **Permanent dev panel** — top-left `cosmos` block mixes branding, control help, build
   stats (`M4a — N stars`), and tour CTA; competes with InfoPanel and overlays.
3. **Split settings** — exposure (dock), overlays (top-right), cinematic (overlays), time
   (dock); no unified "view" surface.
4. **Auto-hide chrome** (4 s idle) hides the very hints new users need.
5. **Layout override debt** — bookmarks bottom-right via app CSS override (`styles.css`
   TASK-029); package vs. app placement split.

These are polish issues; §3–§6 are the **core perception** problems.

### 2.3 Sibling findings (linked research — partial overlap)

[`navigation-ux.md`](navigation-ux.md) covers **navigation affordance** and **data gaps**
that intersect the HUD but are not the focus of this doc. Track them separately; some
InfoPanel copy proposals below absorb the UX-only items.

| Topic | Doc | UI-only item here | Non-UI / other lane |
|-------|-----|-------------------|---------------------|
| Exo host star invisible (planets orbit empty space) | navigation-ux §1 | — | Data fix in `pack-exoplanets` |
| Sol host sub-pixel / no locator at distance | navigation-ux §2 | Optional host locator icon in system HUD | Render FX (bloom) Phase 4 |
| Enter/exit system implicit (hysteresis) | navigation-ux §3 | C3 system badge; clearer action labels | Nav thresholds frozen |
| "Go to" on stars without systems misleads | navigation-ux §3 | C3 *"No known planetary system"* copy | — |
| Long fly times in playtesting | navigation-ux §4 | W4 `@ c` ETA; jump vs. explore labeling | Dev `?jump=` tooling |

Do **not** duplicate the host-star pack fix or context-switch tuning in UI tasks — link
to the sibling doc when those land.

---

## 3. Finding — speed is uninterpretable

### 3.1 What the code shows

**Free flight** (`packages/nav/src/controller.ts`): `speed = clamp(speedScale ×
distanceToNearestSurface, min, max)` with Shift/Ctrl modifiers. Purpose: traverse
~26 orders of magnitude without getting stuck. Not a physical model.

**Speed readout** (`apps/web/src/App.tsx`, `SpeedReadout`):

```ts
const txt = `${fmtSpeed(v)} ${c.contextId === 'system' ? 'AU/s' : 'pc/s'}`;
```

- Hidden when stationary (`v < 1e-6`).
- `aria-hidden="true"` — invisible to assistive tech.
- In universe context (if ever surfaced), the readout still labels `pc/s` because only
  `system` vs. everything else is distinguished.

**Scale jumps** (`apps/web/src/glue/goto.ts`): exponential approach
(`packages/nav/src/goto.ts`, `d(t) = d₀ × e^(−kt)` with `k = ln(d₀/d_arrival)/durationMs`).
Duration is **fixed in wall-clock time**, not derived from distance or c.

### 3.2 User impact

- `847 pc/s` — no intuition. Is that fast? Real? A game multiplier?
- During a breadcrumb flight the readout may show a large `pc/s`, but nothing explains
  that this is a **scale jump**, not exploration speed.
- After an unlabeled scale jump, free flight at galactic vantages **correctly** moves
  almost nothing on screen — but without context it reads as "broken" rather than
  "wrong tool for this scale."

### 3.3 UI proposals (no nav law changes)

| ID | Proposal | Implementation sketch |
|----|----------|----------------------|
| S1 | **Always show physical speed alongside context units** | HUD adapter: `speedUnitsPerS × CONTEXT_UNIT_METERS[ctx]` → `km/s`. Read from `controllerHolder` on the existing rAF loop. **×c honesty decision (2026-07-02):** free-flight speed is the log-scaled law, not physics — showing *"0.003× c"* while exploring would imply a physicality this doc elsewhere disclaims. `km/s` is the physical readout in free flight; **×c appears only on the Jump HUD (W2) and in the glossary (S3)**, where the wormhole framing is explicit. |
| S2 | **Movement mode badge** | When `flight.goToActive` **and jump distance ≥ the D4 threshold** (snapshot target distance at `goTo` start): show *"Scale jump"*. Below threshold (double-click fly to a nearby star, enter/exit system): *"Flying"* or no badge — labeling a short hop "scale jump" would be exactly the dishonesty this doc argues against. When idle + WASD moving: *"Exploring"*. **During tours the badge yields to tour chrome/letterbox** — never both. |
| S3 | **Reference speed glossary** | Tooltip or `?` panel: walk, jet, Earth orbit, **c** — not as nav presets (that would be nav), but as **comparison labels** (*"at c, light crosses this field in N years"*). |
| S4 | ~~Jump summary on arrival~~ **Merged into W2 (unified Jump HUD)** | S4, D5, and W2 narrated the same event on three surfaces. One component now owns the jump story: progress while `goToActive`, arrival summary on `onGoToEnd`. See §5.3. |
| S5 | **Readout accessibility** | §3.1 flags `aria-hidden="true"` on the speed readout; Phase 1 rebuilds it anyway, so fix it there: a throttled `aria-live="polite"` mirror (~1 update / few s — never per rAF frame). Cheap, and otherwise the known defect gets rebuilt into the new component. |

---

## 4. Finding — distance and scale are numerically correct but perceptually absent

### 4.1 Milky Way ↔ Galaxy breadcrumb flights

Constants (`apps/web/src/glue/goto.ts`):

| Constant | Value | Role |
|----------|-------|------|
| `GALAXY_VIEW_VANTAGE_PC` | 55,000 pc | `viewGalaxy` target |
| `GALAXY_VIEW_ARRIVAL_M` | 6,000 pc tolerance | parks ~49 kpc out |
| `GALAXY_VIEW_DURATION_MS` | 5,000 | wall-clock duration |
| `GALAXY_FIELD_VANTAGE_PC` | 0.06 pc | `enterGalaxy` target (Sol neighbourhood) |
| `GALAXY_FIELD_DURATION_MS` | 5,000 | wall-clock duration |

**Order-of-magnitude physics (educational copy, not simulation):**

- Δdistance ≈ 49,000 pc ≈ **160,000 ly**.
- At **c**: ~160,000 **years**.
- In app: **5 seconds** → effective speed ~**10¹² × c**.

`viewGalaxy` and `enterGalaxy` are symmetric wormhole pairs. The nav team intentionally
fixed duration for snappy UX (`goto.ts` comments, TASK-040). **Keep it.**

### 4.2 Why the scale change is not felt

The gap is **perception of the jump**, not a flaw in free flight at galactic distances.

**What is working as designed (do not "fix" with nav changes):**

At the Milky Way vantage (~49 kpc out, ~100,000 ly field of view), WASD + Shift moves
the camera in `pc/s` — a tiny fraction of the visible scene. Shift+W changing almost
nothing on screen is **physically correct**: you are viewing a structure 160,000 ly
across; drifting a few parsecs is invisible. The log-scaled speed law exists so
exploration works across contexts, not so you can cross a galaxy with thrusters.

**What is actually missing (UI-only):**

1. **The jump does not communicate distance traveled.** The user completes a ~160,000 ly
   scale link in 5 s but receives no summary — so the enormity of the transition is lost.
2. **FOV fixed at 60°** (`packages/scene-host`) — no optical zoom cue on scale change.
3. **Scale jumps lack jump framing** — letterbox is tour/spline-only (`Hud.tsx` polls
   `letterboxActive`; breadcrumb `goTo` does not set it).
4. **Spiral fade is subtle** — `GalaxyScene` distance-driven procgen opacity ramps during
   `goToActive` (post BUG/fix in `galaxy-transit-procgen-floor-design.md`), but it reads as
   layer cross-fade, not "you are now 100,000 ly wide."
5. **No persistent "where am I?" at MW scale** — breadcrumb says *Milky Way* but not
   field width or vantage distance; the user has no frame before trying WASD.
6. **WASD reads as broken when it is the wrong tool.** After an unlabeled jump, barely
   moving feels like *"the galaxy is frozen"* instead of *"I am at galactic survey
   scale — local flight is not how you navigate here; use the breadcrumb to descend."*

**"Changed mode"** (used elsewhere in this doc) means switching from **scale jump**
(`goTo` wormhole) to **local exploration** (WASD). It does **not** mean WASD should
become fast at kpc scales. The UI must **name both modes** and **set expectations**
for which tool applies at the current vantage.

### 4.3 InfoPanel distance copy

Stars (`packages/ui/src/InfoPanel.tsx`):

```
{distPcStr} pc / {distLyStr} ly
```

Parsecs are expert jargon. Light-years are better but still lack **travel-time framing**
(*"light from here reaches Sol in 8.6 years"*).

### 4.4 UI proposals (no nav law changes)

| ID | Proposal | Implementation sketch |
|----|----------|----------------------|
| D1 | **Human-primary distance** | Cards: lead with **ly** + *"light travel time: N years"*. Demote pc to expert/detail row. |
| D2 | **Comparative distance** | *"≈ 270,000 × Earth–Sun"*, *"≈ 4.2 × nearest star"* where cheap. |
| D3 | **Persistent scale ruler** | HUD log bar with marker for current scale. **Segment mapping pinned (2026-07-02):** segments must map 1:1 to what the engine can report — `contextId` (`system` / `galaxy` / `universe`) subdivided by a documented `\|cameraLocal\|` distance rule (e.g. galaxy context splits into *star field* vs. *galactic survey* at a named constant). The earlier sketch (`Planet — System — Star — Galaxy — Milky Way`) mixed contexts with vantage positions and had no queryable source of truth; the e2e test asserts the highlighted segment from `__cosmos.contextId` + camera distance, so the mapping must be a pure function of those two inputs (unit-tested in `packages/ui`). |
| D4 | **Scale-jump visual kit → letterbox + copy only (v1)** | On `goToActive` when target distance > threshold (e.g. > 100 pc): letterbox + full-screen scale label. **Radial streak post-pass dropped (2026-07-02):** the hardware floor is integrated GPU (Iris Xe / M1) and fill-rate cliffs are invisible on the dev machine's discrete card — no new post-pass in this lane. Trigger on `goToActive` + target distance computed once at start. |
| D5 | ~~Arrival scale card~~ **Merged into W2 (unified Jump HUD)** | See §5.3. |
| D6 | **Telescope effect** (sibling research) | Dynamic exposure + FOV narrowing when "looking deeper" — gives zoom *sensation* without changing nav (see `telescope-effect-magnitude-reveal.md`). |
| D7 | **Scale-aware movement readout** | When moving at galactic vantage: append context, e.g. *"At this scale, crossing the galactic disk at your current speed would take ~X years"* — explains why Shift+W looks static without boosting speed. **Promoted to Phase 1 (2026-07-02):** by this doc's own analysis, "WASD reads as broken" is the worst confusion, and D7/D8 are copy + a formatter — cheaper than anything in the visual kit. |
| D8 | **MW-view exploration hint** | Persistent dim line or dock tooltip while far out: *"Local flight (WASD) applies at star-field scale — use ◂ Galaxy to descend."* Copy only; no nav soften/disable. **Promoted to Phase 1** (with D7). |

---

## 5. Finding — `goTo` is a wormhole; the UI never says so

### 5.1 Conceptual model (for copy and visuals)

```
Scale jump (goTo)     : fixed wall-clock time, distance irrelevant → "wormhole / enlace"
Free exploration      : log speed law, context units              → "thrusters / coast"
Educational transit   : (future UI mode) show ETA @ c               → "light-speed transit"
```

The third mode is **presentation-only** at first: show *"at c: 4.2 years"* on InfoPanel
and search results without requiring the camera to actually fly that slow. Optional later:
a "simulate @ c" playback that stretches wall-clock time but still uses the existing
`goTo` spline — a **duration override for education**, not a new physics integrator.

### 5.2 Why naming matters

Users currently reconcile signals that are **both correct and unexplained**:

- Breadcrumb: crossed ~160,000 ly in 5 s (scale jump) — **not labeled as such**.
- WASD at MW vantage: barely moves — **correct at this scale**, but reads as broken.
- Readout: `pc/s` with no mode label or scale context.

Explicit **wormhole / scale-jump** language on arrival (§D5) plus **scale-aware readout**
(§D7) and **MW hint** (§D8) resolve the confusion without changing a single line of
`controller.ts` and **without** increasing free-flight speed at galactic vantages.

### 5.3 UI proposals

| ID | Proposal | Notes |
|----|----------|-------|
| W1 | Rename affordances in breadcrumb tooltips | *"Jump to Milky Way view (scale link)"* vs. *"Return to star field"*. |
| W2 | **Unified Jump HUD** (absorbs S4 + D5) | **One component, one lifecycle** — S4 (arrival toast), D5 (arrival scale card), and the original W2 (progress HUD) narrated the same event on three surfaces. Merged (2026-07-02): while `goToActive` above the D4 threshold, show distance remaining in ly + equivalent @ c; on `onGoToEnd` the same component morphs into the arrival summary (*"Jumped ~160,000 ly in 5 s — at c: ~160,000 years"*, field-of-view line). Distances from a d₀ snapshot at `goTo` start. |
| W2a | **Repetition dampening** (policy for W2 + D4 letterbox) | The arrival story is magical once and wallpaper by the fifth Milky Way ⇄ Galaxy bounce. Full arrival card the **first 2–3 large jumps** (`localStorage` counter, same mechanism as V1), then a one-line readout. **Letterbox: first large jump only by default** — this also resolves open question 2. |
| W3 | Different SFX / mute thrusters during jump | Audio lane; optional. |
| W4 | `@ c` ETA on all fly targets | InfoPanel, SearchPalette result rows, post-selection banner. Data: `distanceLy / c`. |

---

## 6. Finding — body cards under-deliver insight

### 6.1 Current content

**Stars:** distance (pc/ly), absolute magnitude, B−V + spectral class, HIP, action button
(Go to / Enter system / Exit system).

**Planets:** radius km, semi-major axis AU, eccentricity, period (days/years), parent name.

Correct for astronomers; opaque for everyone else. Much of the semantic layer can be
**derived at display time** from existing pack fields — no new data pipeline required
for v1.

### 6.2 UI proposals

| ID | Proposal | Example |
|----|----------|---------|
| C1 | **Spectral plain language** | *"Yellow dwarf — similar to the Sun"* from B−V. |
| C2 | **Naked-eye visibility** | Apparent mag vs. ~6.5 limit (when mag available). |
| C3 | **System badge** | *"7 known planets"* / *"No known planetary system"*. **Scoped to the InfoPanel card for v1 (2026-07-02):** the card resolves the system on selection, so the count is already available. Showing it *before click in search results* needs system-membership counts in the search corpus — exactly the unwired Gaia/search data lane (`gaia-visibility-and-realness-problem.md`); search-row badges wait for that lane. |
| C4 | **Planet size bar** | Radius relative to Earth (visual bar, not just km). |
| C5 | **Orbit in human terms** | *"88-day year — like Mercury"*; habitable-zone hint from semi-major axis + stellar type. |
| C6 | **Card layout redesign** | Museum-style: hero metric (ly or light-minutes), supporting grid, one comparison line. |
| C7 | **Spectral-tinted panel** | Accent color from B−V → panel border glow matches star color (cosmetic, distinctive). |

---

## 7. Visual identity — escaping generic HUD

The token system is sound; the **composition and typography** are not yet "Cosmos."

### 7.1 Direction (open for design pass)

- **Typography:** one display face for titles (body names), one mono/tabular for
  numbers (distances, speeds). Drop bare `Segoe UI` as the only voice.
- **Color:** keep dark glass base; let **selected body tint** the accent (§C7).
- **Density:** fewer permanent panels; dock + breadcrumb + contextual card.
- **Infographics over `<dl>` dumps** — mini orbit diagrams, size dots, scale icons.
- **Remove build stats from production HUD** (`M4a — N stars`) → dev flag or about dialog.

### 7.2 Chrome lifecycle

| ID | Proposal |
|----|----------|
| V1 | First-run overlay (once, `localStorage`) → collapses to `?` in dock. **Content = the §5.1 three-mode taxonomy** (jump / explore / tour, one line each) — this doc's whole thesis is that users don't know three movement modes exist, so the first-run moment should teach exactly that, not just relocate the WASD hints. |
| V2 | User preference: auto-hide on/off (default on for returning users). |
| V3 | Unified **View** drawer: exposure, overlays, labels, cinematic, auto-hide. |

---

## 8. Proposed phasing

Prioritized by **perception impact / nav-touch surface**. All phases assume the nav
API is frozen; hooks are read-only unless noted.

### Phase 1 — Literacy (small, high impact) → TASK-066

- Strings module: tiny centralized `strings.ts` in `packages/ui` (English-only for now) so
  the copy-heavy phases don't scatter literals — makes the wormhole-metaphor wording
  swappable later (resolves open question 1).
- S1 physical speed readout (km/s; ×c reserved for Jump HUD + glossary per §3.3)
- S2 movement mode badge (threshold-gated; yields to tour chrome)
- S5 readout a11y (`aria-live` mirror, throttled)
- D1 human-primary distance + light-travel copy on InfoPanel
- D7 scale-aware movement readout; D8 MW-view hint (promoted — worst confusion, cheapest fix)
- W4 `@ c` ETA on InfoPanel + search results
- V1 retire permanent help wall → first-run teaching the three-mode taxonomy + `?`

**Packages:** `packages/ui`, `apps/web/src/styles.css`, `apps/web/src/App.tsx` (readout only).

### Phase 2 — Scale perception → TASK-067

- D3 scale ruler (segment mapping = pure function of `contextId` + camera distance)
- D4 letterbox + scale label on large `goTo` (no post-pass; threshold shared with S2)
- W2 unified Jump HUD (progress → arrival summary; absorbs S4 + D5)
- W2a repetition dampening (full card first 2–3 jumps; letterbox first jump only)
- Breadcrumb copy (W1)

**Packages:** `apps/web` HUD, `packages/ui` new components. No `scene-host` FOV change,
no post-process — letterbox + copy is the v1 kit.

### Phase 3 — Cards and identity → TASK-068

- C1–C7 card redesign (C3 card-only per §6.2)
- V3 View drawer
- Typography + spectral tint (§7)

**Packages:** `packages/ui`, `ui.css` token extensions.

### Phase 4 — Educational transit (optional)

- "Simulate @ c" playback — **only** adjusts displayed duration and clock UI while
  reusing existing `goTo`; requires a `durationMs` override from app glue (already
  supported on `GoToOptions`) — not a new integrator.
- Cosmic clock during long `@ c` educational flights.

---

## 9. Testing strategy

Per [`docs/testing-conventions.md`](../testing-conventions.md): perception UI must be
**triagable from CI logs** and must not re-derive production math in tests.

| Change type | Test approach |
|-------------|---------------|
| Copy / labels (ly, light-travel, mode badge) | Playwright `getByRole` / visible text assertions on InfoPanel, search results, jump toast. |
| Movement mode badge (`goToActive`) | Drive a known `goTo` (breadcrumb or test-hook fly); assert label switches *"Scale jump"* → *"Exploring"*. Query `window.__cosmos` for `goToActive` — do not infer from timing alone. |
| Speed readout (km/s, ×c) | After scripted movement, read displayed string OR ask `__cosmos` for controller speed and assert the HUD formatted value matches a thin formatter unit test (Vitest on pure format helpers in `packages/ui`). |
| Scale ruler position | Assert DOM presence + context segment highlighted from store/`__cosmos.contextId` — **no hard-coded pixel positions** for the marker. |
| Jump summary (@ c equivalent) | Log chosen start/end distance + displayed copy in the spec; assert order-of-magnitude string (e.g. contains `ly` and `years` or `× c`), not an exact float. |
| No Canvas re-render regression | Existing §5.12 discipline; optional Playwright React profiler hook if a test already exists — not a new gate unless flaky. |
| Visual jump kit (letterbox, streaks) | Reference-machine screenshot (`!process.env.CI`) or assert CSS class toggles on `goToActive` in CI — not pixel diffs of the streak pass. |

New format helpers (`formatLightTravelYears`, `formatSpeedAsC`, etc.) belong in
`packages/ui` with Vitest table tests; E2E only checks that the app wires them.

---

## 10. Non-goals (this research lane)

- Replacing log-scaled free flight with physically accurate thrust.
- Boosting WASD / Shift speed at Milky Way vantages so galactic crossing "feels faster"
  — imperceptible motion at ~100,000 ly FOV is correct; use copy (§D7–D8), not nav.
- Forcing all travel to literal c (would make the app unusable for exploration).
- Changing `GALAXY_VIEW_DURATION_MS`, context-switch hysteresis, or `HOST_ARRIVAL_M`.
- New post-processing passes (radial streaks etc.) — integrated-GPU floor; letterbox + copy only.
- Search-result system badges before the Gaia/search data lane lands (C3 is card-only v1).
- Light mode / theme switcher (unless trivially via tokens later).
- Full keyboard picking (valuable, but separate a11y lane — TASK-012).

---

## 11. Acceptance criteria (when implemented)

1. A first-time user can answer **"what scale am I at?"** without reading `pc/s`.
2. After a Milky Way breadcrumb jump, a user can state **that it was a scale link**,
   not physical flight, and cite an **order-of-magnitude @ c equivalent** from on-screen copy.
3. Star distance is shown in **ly with light-travel time** before pc.
4. Movement mode is **labeled** during `goToActive` vs. free flight.
5. Info cards include **at least one human comparison** per body type (star/planet).
6. Production HUD does not show **build/pack stats** without a dev flag.
7. At Milky Way vantage, UI explains **why local flight is nearly invisible** (D7/D8)
   — without increasing nav speed.
8. No regression in §5.12 perf rules: scale ruler and jump HUD use rAF/imperative DOM or
   ≤10 Hz store-driven updates; no per-frame React re-renders of `SceneHost`.

---

## 12. Open questions

1. ~~Wormhole metaphor in UI copy — English vs. Spanish product voice?~~ **Resolved
   2026-07-02:** English, but all perception copy lives in a centralized strings module in
   `packages/ui` from Phase 1 — voice/metaphor swappable later without a hunt.
2. ~~Letterbox on every large `goTo`?~~ **Resolved 2026-07-02:** first large jump only by
   default (W2a dampening); threshold distance shared with S2/D4, TBD in TASK-067.
3. **`@ c` simulation** — Phase 4 only, or static ETA enough for v1?
4. **Expert mode toggle** — show pc, abs mag, eccentricity for power users?
5. **Design pass** — one Figma/sketch iteration before Phase 3 card rebuild?

---

## 13. Code anchors (quick reference)

| Concern | Location |
|---------|----------|
| Scale jump constants | `apps/web/src/glue/goto.ts` |
| `goTo` motion law | `packages/nav/src/goto.ts`, `controller.ts` `updateGoToFrame` |
| Speed readout | `apps/web/src/App.tsx` `SpeedReadout`, `fmtSpeed` |
| Context units | `packages/core-types/src/coords.ts` `CONTEXT_UNIT_METERS` |
| InfoPanel copy | `packages/ui/src/InfoPanel.tsx` |
| Galaxy fade during jump | `apps/web/src/scene/GalaxyScene.tsx` (`goToActive`, distance fade) |
| Letterbox | `apps/web/src/hud/Hud.tsx`, `styles.css` `.hud-letterbox` |
| Design tokens | `packages/ui/src/ui.css` |
| Breadcrumb wiring | `apps/web/src/App.tsx` `Breadcrumb` |

---

*End of research doc. Tasks authored 2026-07-02: TASK-066 (Phase 1 — literacy),
TASK-067 (Phase 2 — scale perception), TASK-068 (Phase 3 — cards & identity) in
`docs/agent-tasks/`. Phase 4 (educational transit) intentionally unauthored — revisit
after Phase 2 ships (open question 3).*
