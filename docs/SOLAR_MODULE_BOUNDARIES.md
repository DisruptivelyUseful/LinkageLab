# Solar Module Boundaries

Shared circuit code lives under three namespaces. The unified app uses **one physical canvas** (`#view-solar` → `svg#canvas`) for both Solar Design and Solar Simulate.

Simulator workspace markup lives in `partials/simulator-workspace.html` (mounted by `js/simulator/bootstrap.js`). Legacy `solar_simulator.html` and `solar-designer.js` are legacy; the live canvas is `js/simulator/solar-simulator.runtime.js`.

## Single canvas model (unified solar)

| Route | App mode | Canvas behavior |
|-------|----------|-----------------|
| `#/solar/design` | `solar-design` | `setSolarCanvasMode('build')` — edit, static wires, 2D only |
| `#/solar/simulate` | `solar-simulate` | `setSolarCanvasMode('simulate')` — power-flow animation, 3D, celestial, weather |

- **Host:** `#view-solar` in `index.html`
- **Boot:** `js/solar/simulator-app.js` → `bootstrapSimulator()` once per session
- **API shim:** `js/solar/solar-designer-shim.js` exposes `globalThis.SolarDesigner` for linkage/tests
- **No design↔simulate handoff:** same `allItems` / `connections` in memory; mode switch toggles simulation overlays only

## `js/circuit/` — data model, electrical, 2D helpers

| Module | Responsibility |
|--------|----------------|
| `component-library.js` | Preset lookup, library sections, spec normalization |
| `node-factory.js` | Create panel/battery/controller/load nodes |
| `wire-renderer.js` | Wire path geometry (bezier, waypoints) — used for 3D tubes |
| `wire-styles.js` | Wire color, gauge stroke width |
| `wire-gauge.js` | AWG sizing from amperage + distance |
| `power-flow.js` | Power-flow calculation (design + simulate) |
| `electrical.js` | Breaker tripping, voltage mismatch checks |
| `simulation.js` | Time tick, solar position, battery SOC |
| `circuit-core.js` | Single import surface + `globalThis.CircuitCore` bridge |
| `circuit-store.js` | Canonical `CircuitDocument` — persistence + publish/subscribe |
| `circuit-normalize.js` | Handle repair / `normalizeCircuitItems` on import |
| `array-specs.js` | Series/parallel PV array Voc, Vmp, Isc, Imp calculation |
| `controller-faults.js` | Voc fault suppression after RESET, controller preset matching |
| `fault-detection.js` | Shared fault/warning detection + processing factory |
| `incident-templates.js` | Education/incident card content templates |
| `incident-ui.js` | Incident report modal + sound effects |

## `js/solar/` — solar-domain features

| Module | Responsibility |
|--------|----------------|
| `simulator-app.js` | Unified solar canvas boot (design + simulate) |
| `solar-designer-shim.js` | `SolarDesigner` compatibility API over shared runtime |
| `designer-app.js` | Deprecated re-exports |
| `circuit-export.js` | Thin wrappers over `circuit-store.js` |
| `linkage-import.js` | Linkage export → panel sync config |
| `celestial-overlay.js` | Day/night sky, sun/moon/stars |

## `js/core/` — app infrastructure

| Module | Responsibility |
|--------|----------------|
| `constants.js` | Preset arrays, AWG ratings, resource types |
| `automation.js` | Shared automation rule engine |
| `export-format.js`, `project-export.js` | Cross-mode save/load |
| `project-store.js` | Canonical `UnifiedProjectDocument` — linkage + circuit + simulation |
| `app-router.js` | Mode switching, state bus |

## `js/simulator/` — canvas runtime + simulation

| Module | Responsibility |
|--------|----------------|
| `bootstrap.js` | Mount workspace DOM, load runtime |
| `solar-simulator.runtime.js` | **Single canvas** — 2D SVG, editing, simulation, 3D |
| `viewport-culling.js` | Viewport culling helpers |
| `runtime-loader.js` | ESM deps + classic runtime script |

## CircuitStore contract

- **Canonical key:** `linkageLab_circuitDocument`
- **Write path:** `saveSimulatorCircuitToStore()` / edits on canvas → `saveFromDesignerConfig()` → `publishCircuitDocument()`
- **Read path:** `resolveCircuitDocument()` on boot
- **Import:** `applySimulatorCircuitImport(data, { fitView })` — `fitView: false` on mode toggles and store subscriber updates

## ProjectStore contract

- **Canonical key:** `linkageLabProject` (schema v4)
- **Apply path:** `applyProjectImport()` → linkage `applyConfig`, `applySimulatorProjectImport`, circuit publish

## Verification

- **Golden:** `tests/project-export-golden.test.js`
- **E2e:** `e2e/project-roundtrip.spec.js`, `e2e/router.spec.js`, `e2e/modes.spec.js`
- **Normalize:** `tests/circuit-normalize.test.js`
