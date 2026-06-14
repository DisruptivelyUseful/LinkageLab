# Legacy / Dead Files Inventory

Confirmed safe to remove after Phase 13 verification. **Do not delete until e2e passes.**

## Redirect stubs (keep for bookmark compatibility)

| File | Status |
|------|--------|
| `solar_designer.html` | Redirect → `index.html#/solar/design` (e2e tested) |
| `solar_simulator.html` | Redirect → `index.html#/solar/simulate` (e2e tested, Phase 13) |

## Deleted (Phase 8)

| File | Status |
|------|--------|
| `solar-builder.html` | **Deleted** |
| `solar_viewer.html` | **Deleted** |
| `cleanup-simulator-css.js` | **Deleted** |
| `partials/linkage-solar-sidebar-palette.html` | Already absent |
| `partials/linkage-solar-sidebar-simulation.html` | Already absent |
| `partials/linkage-solar-sidebar-properties.html` | **Deleted** |

## Simulator workspace (Phase 13)

| Location | Replaced by |
|----------|-------------|
| Standalone `solar_simulator.html` DOM shell (~1100 lines) | `partials/simulator-workspace.html` (fetched by `js/simulator/bootstrap.js`) |
| Inline `PANEL_PRESETS` / `BATTERY_PRESETS` in old simulator shell | `js/core/constants.js` |

## Duplication removed by refactor

| Location | Replaced by |
|----------|-------------|
| Inline `createPanel` etc. in `solar-designer.js` | `js/circuit/node-factory.js` |
| Inline wire path math in both files | `js/circuit/wire-renderer.js` |
| Inline `calculatePowerFlow` in designer | `js/circuit/power-flow.js` |
