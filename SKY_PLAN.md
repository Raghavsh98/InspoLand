# Sky System Plan — `feature/sky`

## The visual target

The reference photo nails it: a deep indigo zenith bleeding into warm amber at the horizon, that specific twilight quality that feels like the world just exhaled. The key ingredient that produces this — and that a plain gradient can never replicate — is **ozone absorption**. Ozone kills red/green wavelengths at high angles, leaving that saturated deep blue. It's the single biggest difference between a "nice gradient" and something that actually feels like sky.

Inspiration: Maxime Heckel's approach — **volumetric raymarching + Rayleigh + Mie + ozone + lightmarching**. That's what we're building.

### Day/night states

- **Day:** sun at `normalize(1.0, 0.6, 0.3)` — matches existing directional light at `(100, 100, 100)`
- **Night:** sun at `normalize(0.5, -0.14, 0.85)` — just below the western horizon (~-8°), warm westerly glow
- **Transition:** ~2s animated arc via quaternion slerp, easeInOutCubic

No moon. No separate night shader. One model handles the full range.

---

## Architecture — current build

```
src/
├── SkyAtmosphere.ts     ← GLSL shader + cubemap render target
├── SkySystem.ts         ← orchestrator: sun direction, bake pipeline, IBL
└── SkyToggle.ts         ← tween engine: animates sun arc + all scene properties
```

---

## 1. `SkyAtmosphere.ts` — the shader

A cube camera renders a fullscreen sphere via a single GLSL fragment shader. Per pixel:

- **Ray setup** — reconstruct view direction from cube face UV
- **Rayleigh scattering** — 8 atmosphere samples along the view ray (exponential density profile). Gives blue sky, red/orange horizon.
- **Mie scattering** — same samples, Henyey-Greenstein phase function (g ≈ 0.76). Gives the sun corona/halo and milky haze near the horizon.
- **Ozone absorption** — wavelength-dependent attenuation per sample. Produces deep indigo zenith at twilight and correct color during the animation arc. The ingredient a gradient can never fake.
- **Lightmarching** — for each view sample, trace a secondary ray toward the sun (4 samples) to compute optical depth. Makes sunsets accurate — light travels through more atmosphere at low angles.

The shader is valid at sun elevation ±90°. Below the horizon, view rays that miss the ground still receive scattered light from the illuminated atmosphere above — this produces the lingering glow at -8° sun elevation. No mode switch, no discontinuity.

**Output:** 256×256×6 cubemap render target. Sky has no high-frequency detail — 256 is plenty.

---

## 2. Stars — deferred

Stars are intentionally removed from the current build. We can add them later with a more tasteful treatment, likely as a separate authored layer or a subtler shader pass after the atmosphere is tuned.

---

## 3. `SkySystem.ts` — the orchestrator

```ts
class SkySystem {
  sunDirection: THREE.Vector3       // single source of truth for everything
  directionalLight: THREE.DirectionalLight
  ambientLight: THREE.AmbientLight

  update(sunDir: THREE.Vector3): void   // called during toggle animation
  bake(): void                           // rebuilds cubemap + PMREM
  getHorizonColor(): THREE.Color         // sampled from cubemap for fog sync
}
```

Key decisions:

- `scene.background` = atmosphere sky cubemap
- `scene.environment` = PMREM-convolved atmosphere cubemap
- `directionalLight.position` is always `sunDirection × large scalar` — stays coherent automatically
- `fog.color` sampled from sky cubemap at the horizon on each bake — always in sync, no manual parameter
- **Bake cost:** raw cubemap render ~0.3ms, `PMREMGenerator` convolution ~2–4ms. Bake both every frame during animation (2s ≈ 120 rebakes total), stop when settled. Zero cost at rest.

---

## 4. `SkyToggle.ts` — the sun arc animation

```ts
toggle(target: 'day' | 'night', duration = 2000): void
```

Everything tweens on the same `easeInOutCubic` curve so nothing feels disconnected:


| Property                       | Day                        | Night                         |
| ------------------------------ | -------------------------- | ----------------------------- |
| `sunDirection`                 | `normalize(1.0, 0.6, 0.3)` | `normalize(0.5, -0.14, 0.85)` |
| `directionalLight.intensity`   | `2.0`                      | `0.05`                        |
| `directionalLight.color`       | `#ffffff`                  | `#b8c8ff`                     |
| `ambientLight.intensity`       | `0.5`                      | `0.12`                        |
| `ambientLight.color`           | `#ffffff`                  | `#1a2a4a`                     |
| `fog.density`                  | `0.0239`                   | `0.028`                       |
| `renderer.toneMappingExposure` | `0.8`                      | `0.35`                        |


`sunDirection` interpolates via **quaternion slerp** — the sun traces a natural arc, not a straight line through the scene.

Stars are currently omitted from the transition.

---

## 5. Integration with `main.ts`


| Before                | After                                                               |
| --------------------- | ------------------------------------------------------------------- |
| `createGradientSky()` | deleted — `SkySystem` init replaces it                              |
| `addLights()`         | moved into `SkySystem` (owns lights to keep them coherent with sun) |
| `render()` loop       | add `skySystem.updateIfAnimating()` — zero cost when idle           |
| Toggle trigger        | `'N'` keypress (or future UI button)                                |


Grass colors at night shift naturally from warm green to cool blue-green via IBL tint + ambient color — no changes needed to `GrassMaterial`.

---

## Implementation order

1. `**SkyAtmosphere` shader** — write + validate GLSL, tune atmospheric constants until day sky looks right and twilight looks like the reference photo
2. `**SkySystem`** — cubemap pipeline, PMREM, `scene.background`/`scene.environment`, fog color sampling
3. `**SkyToggle`** — tween engine, wire to `'N'` key
4. `**main.ts` integration** — swap old sky + lights, expose toggle
5. **Tune** — Mie `g` factor, ozone strength, exposure curve, fog density delta. This is where "correct" becomes "beautiful."

---

## Context & prior decisions

- **Why not `THREE.Sky` (Preetham)?** Daytime-only. Goes black below the horizon. Unusable for a smooth day→night arc.
- **Why not Hillaire 2020?** Beautiful but requires precomputed LUT pipeline. Overkill for a 2-state toggle — the visual difference during a 2s transition is not meaningful.
- **Why analytical Rayleigh+Mie+ozone?** Handles full elevation range naturally, ~80 lines of GLSL, you own and can tune every parameter, and it produces the exact look of the reference photo (Maxime Heckel uses this exact approach).
- **Why cubemap bake?** Sky evaluated once per bake, not per pixel per frame. Also gives free IBL for grass/terrain — the warm horizon actually tints the scene geometry.
- **Why quaternion slerp for sun arc?** Lerp on Cartesian coordinates moves the sun through the scene interior. Slerp keeps it on the unit sphere — a proper arc across the sky.
- **Why ozone specifically?** It's the ingredient that produces the deep indigo-blue overhead at twilight (the "blue hour"). Rayleigh alone gives a dull grey-blue. Ozone + Rayleigh together produce the saturated navy that makes that photo feel so rich.

