# Default Configuration Files

This directory contains default configuration JSON files that are automatically loaded when users first visit the LinkageLab tools (when no localStorage configuration exists).

## Files

### `presets.json`
Manifest for the **Presets** dropdown in the LinkageLab Designer sidebar. Lists built-in presets that appear under the "Built-in Presets" optgroup in the dropdown. Each entry has two fields:
- `name` — display label shown in the dropdown
- `file` — filename of the JSON config in this directory

To add a new built-in preset: export a config from the designer, save it here, and add an entry to `presets.json`.

### Built-in linkage presets
| Dropdown name | File |
|---|---|
| StarShade V1 - SOAK 2026 (**default on first load**) | `StarShade V1 SOAK 2026.json` |
| StarShade 2x3 - Folding Panels | `StarShade 2x3 Folding Panels.json` |
| StarShade Hex | `StarShade Hex.json` |
| Stellarator | `Stellarator.json` |
| Constellation | `Constellation.json` |

The first-load default is set by `DEFAULT_LINKAGE_CONFIG_FILE` in `js/linkage/config-persistence.js`. It is loaded automatically when no saved project or `linkageLab_config` exists.

### `simulator-default.json`
Default configuration for the Solar Simulator (unified app `#/solar/simulate`). This should include:
- Complete circuit design with nodes (panels, batteries, controllers, etc.)
- All connections between components
- Structure geometry (if applicable)

**To create this file:**
1. Open Solar Simulator and design your default circuit
2. Add all the nodes/components you want to appear by default
3. Make all necessary connections
4. Click the Save button to save the configuration
5. Copy the saved config from localStorage or export it
6. Save it as `simulator-default.json` in this directory

## How It Works

- **LinkageLab Designer**: On first load (no localStorage), it loads `configs/StarShade V1 SOAK 2026.json` (SOAK 2026 preset)
- **Solar Simulator**: On first load (no localStorage), it will attempt to load `configs/simulator-default.json`
- **Presets dropdown**: On every load, the designer fetches `configs/presets.json` and populates the "Built-in Presets" optgroup. User-saved presets appear below in a separate "My Presets" optgroup.

If the files don't exist, the tools will fall back to their hardcoded defaults.

## Notes

- These files are loaded via `fetch()`, so they must be served from a web server (not file:// protocol)
- The files should be valid JSON matching the export format from each tool
- Users can still override these defaults by saving their own configurations to localStorage

