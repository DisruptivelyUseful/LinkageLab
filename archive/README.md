# Archived legacy files

These files were moved here during Unified App Polish (Phase 4 cleanup).
They are no longer loaded by the unified app shell.

| File | Replaced by |
|------|-------------|
| `solar-designer.js` | `js/simulator/solar-simulator.runtime.js` + `js/solar/solar-designer-shim.js` |
| `js/solar/designer-app.js` | `js/solar/simulator-app.js` |
| `partials/app-topbar-solar-design.html` | `partials/app-topbar-solar-unified.html` |
| `partials/app-topbar-simulate.html` | `partials/app-topbar-solar-unified.html` |
| `partials/linkage-workspace-solar.html` | `partials/simulator-workspace.html` |
| `config/solar-designer-manifest.json` | Unified solar bootstrap in `js/simulator/bootstrap.js` |

Safe to delete after confirming no external bookmarks depend on removed paths.
