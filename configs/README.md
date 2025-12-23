# Default Configuration Files

This directory contains default configuration JSON files that are automatically loaded when users first visit the LinkageLab tools (when no localStorage configuration exists).

## Files

### `starshade-default.json`
Default configuration for the LinkageLab Designer (`index.html`). This should include:
- Complete structure configuration (modules, beam lengths, etc.)
- Solar panel configuration (enabled with proper settings)
- Any other default settings you want new users to see

**To create this file:**
1. Open LinkageLab Designer and configure it with your desired default settings
2. Enable solar panels and configure them properly
3. Click the Export button to save the configuration
4. Save the exported JSON file as `starshade-default.json` in this directory

### `simulator-default.json`
Default configuration for the Solar Simulator (`solar_simulator.html`). This should include:
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

- **LinkageLab Designer**: On first load (no localStorage), it will attempt to load `configs/starshade-default.json`
- **Solar Simulator**: On first load (no localStorage), it will attempt to load `configs/simulator-default.json`

If the files don't exist, the tools will fall back to their hardcoded defaults.

## Notes

- These files are loaded via `fetch()`, so they must be served from a web server (not file:// protocol)
- The files should be valid JSON matching the export format from each tool
- Users can still override these defaults by saving their own configurations to localStorage

