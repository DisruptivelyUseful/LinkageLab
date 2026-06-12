# Solar Module Boundaries

Shared circuit code lives under three namespaces. Do not duplicate logic in
`solar-designer.js` or `solar_simulator.html` — import or bridge from here.

## `js/circuit/` — data model, electrical, 2D helpers

| Module | Responsibility |
|--------|----------------|
| `component-library.js` | Preset lookup, library sections, spec normalization |
| `node-factory.js` | Create panel/battery/controller/load nodes |
| `wire-renderer.js` | Wire path geometry (bezier, waypoints) |
| `wire-styles.js` | Wire color, gauge stroke width |
| `wire-gauge.js` | AWG sizing from amperage + distance |
| `power-flow.js` | Power-flow calculation (design + simulate) |
| `electrical.js` | Breaker tripping, voltage mismatch checks |
| `simulation.js` | Time tick, solar position, battery SOC |
| `circuit-core.js` | Single import surface + `globalThis.CircuitCore` bridge |

## `js/solar/` — solar-domain features

| Module | Responsibility |
|--------|----------------|
| `designer-app.js` | Designer shell boot, partials, layout |
| `simulator-app.js` | Simulator shell boot (native mount) |
| `circuit-export.js` | Designer → simulator handoff |
| `celestial-overlay.js` | Day/night sky, sun/moon/stars |
| `wires.js`, `bom.js`, `review.js`, `resources.js` | Legacy factories (migrate to circuit/) |

## `js/core/` — app infrastructure

| Module | Responsibility |
|--------|----------------|
| `constants.js` | Preset arrays, AWG ratings, resource types |
| `automation.js` | Shared automation rule engine |
| `export-format.js`, `project-export.js` | Cross-mode save/load |
| `app-router.js` | Mode switching, state bus |

## `js/simulator/` — simulator orchestration only

| Module | Responsibility |
|--------|----------------|
| `bootstrap.js` | Mount partials, load runtime, init DOM |
| `solar-simulator.runtime.js` | Simulator-specific UI + sim loop (being split incrementally) |
| `config-io.js` | Unified config import/export helpers |

Views keep their own: D3 selection state, mode flags, 3D scene handles.
