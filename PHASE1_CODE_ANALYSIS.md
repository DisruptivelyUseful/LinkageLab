# Phase 1: Code Boundary Analysis
## Solar Simulator Split - Build Mode vs Simulate Mode

This document identifies all code sections in `solar_simulator.html` and categorizes them for the split into `solar_designer.html` (Build mode) and `solar_simulator.html` (Simulate mode).

---

## File Structure Overview

**Total Lines**: 25,601
**Target Split**:
- `solar_designer.html`: ~15,000-18,000 lines (Build + Live View)
- `solar_simulator.html`: ~12,000-15,000 lines (Simulate only)

---

## 1. BUILD MODE CODE (→ solar_designer.html)

### 1.1 Component Creation Functions
**Lines**: ~7594-8600
- `createPanel()` - Create solar panel component
- `createPanelWithDimensions()` - Create panel with specific dimensions (for LinkageLab import)
- `createBattery()` - Create battery component
- `createSmartBattery()` - Create smart battery component
- `createController()` - Create charge controller
- `createBreaker()` - Create DC breaker
- `createCombiner()` - Create combiner box
- `createSolarCombinerBox()` - Create solar combiner box
- `createDoubleVoltageHub()` - Create voltage hub
- `createACBreaker()` - Create AC breaker
- `createACOutlet()` - Create AC outlet
- `createACLoad()` - Create AC load/appliance
- `createResourceContainer()` - Create resource container (water, heat, etc.)
- `createSpiderBox()` - Create spider box (CEP box)
- `createBreakerPanel()` - Create breaker panel

**Status**: ✅ Keep in designer (core functionality)

---

### 1.2 Connection/Wiring Functions
**Lines**: ~14702-14943
- `createConnection()` - Create wire connection between components
- `deleteConnection()` - Delete a connection
- `createLoadFromOutlet()` - Create load from outlet
- `createOutletFromCircuit()` - Create outlet from circuit
- `createACCircuit()` - Create AC circuit

**Status**: ✅ Keep in designer (core functionality)

---

### 1.3 Item Management
**Lines**: ~14815-14845
- `deleteItem()` - Delete a component
- Item selection/deselection logic
- Item duplication (`duplicateItem()`)

**Status**: ✅ Keep in designer (core functionality)

---

### 1.4 Rendering Functions (2D Canvas)
**Lines**: ~8622-13757
- `render()` - Main render function
- `renderItems()` - Render all items
- `renderPanel()` - Render solar panel
- `renderBattery()` - Render battery
- `renderController()` - Render controller
- `renderSmartBattery()` - Render smart battery
- `renderACBreaker()` - Render AC breaker
- `renderACOutlet()` - Render AC outlet
- `renderACLoad()` - Render AC load
- `renderResourceContainer()` - Render resource container
- `renderProcessor()` - Render processor
- `renderSpiderBox()` - Render spider box
- `renderBreakerPanel()` - Render breaker panel
- `renderBreaker()` - Render breaker
- `renderCombiner()` - Render combiner
- `renderSolarCombiner()` - Render solar combiner
- `renderHandles()` - Render connection handles
- `renderWires()` - Render wires/connections
- `renderWaypointHandles()` - Render wire waypoint handles
- `updateItemContent()` - Update item visual content

**Status**: ✅ Keep in designer (2D visualization)

**Note**: Some rendering functions have mode-specific logic (e.g., `currentMode === 'simulate'`). These conditionals should be removed or simplified in designer.

---

### 1.5 Inspector/Property Editing
**Lines**: ~14943-17322
- `openInspector()` - Open property inspector panel
- `closeInspector()` - Close inspector
- `openAutomationEditor()` - Open automation rule editor
- `openRecipeEditor()` - Open recipe editor for processors
- `openWireInspector()` - Open wire property inspector
- `updateAutomationFields()` - Update automation UI fields
- `updateRecipeDetails()` - Update recipe details
- `createRecipeIORow()` - Create recipe I/O row in editor

**Status**: ✅ Keep in designer (editing functionality)

---

### 1.6 Library Panel
**Lines**: ~4297-4456
- `switchRightPanelTab()` - Switch between library and inspector
- `toggleLibraryCategory()` - Toggle library category
- `filterLibraryComponents()` - Filter library search
- `updateSearchResultCount()` - Update search count
- `clearLibrarySearch()` - Clear search
- `populateLibraries()` - Populate component libraries

**Status**: ✅ Keep in designer (component selection)

---

### 1.7 Canvas Interaction
**Lines**: ~20939-21354
- `setupComponentDragFeedback()` - Setup drag feedback
- `setupCanvasDropHandling()` - Handle component drops
- Drag and drop handlers
- Click handlers for selection
- Zoom/pan controls

**Status**: ✅ Keep in designer (user interaction)

---

### 1.8 Save/Load Functions
**Lines**: ~23491-23506
- `saveSystem()` - Save circuit to JSON file
- `loadSystem()` - Load circuit from JSON file

**Status**: ✅ Keep in designer (data persistence)

---

### 1.9 Calculation Functions (Build-time)
**Lines**: ~17322-18368
- `calculateConnectedArraySpecs()` - Calculate array specs (voltage, current, power)
- `calculateConnectedBatterySpecs()` - Calculate battery specs (capacity, voltage)
- `calculateOptimizationScore()` - Calculate system optimization score
- `calculateTotalCost()` - Calculate total system cost
- `calculateHubCombinedOutput()` - Calculate hub output
- `updateScores()` - Update system scores/telemetry
- `updateArrayWmpDisplay()` - Update array power display
- `calculateWireResistance()` - Calculate wire resistance
- `calculateWirePowerLoss()` - Calculate wire power loss
- `calculateWireCurrent()` - Calculate wire current
- `updateWireGaugeForConnection()` - Auto-update wire gauge
- `updateAllWireGauges()` - Update all wire gauges

**Status**: ✅ Keep in designer (design-time calculations)

---

### 1.10 BOM and Review
**Lines**: ~17954-18274
- `generateBillOfMaterials()` - Generate BOM
- `showBillOfMaterials()` - Display BOM
- `hideBillOfMaterials()` - Hide BOM
- `showSystemReview()` - Show system review

**Status**: ✅ Keep in designer (design analysis)

---

### 1.11 Hints and Tutorials
**Lines**: ~18542-20723
- `showHint()` - Show hint popup
- `hideHint()` - Hide hint
- `showSeriesHint()` - Show series wiring hint
- `showOptimalArrayHint()` - Show array optimization hint
- `showBatteryUpgradeHint()` - Show battery upgrade hint
- `showCurrentClippingHint()` - Show clipping warning
- `showAchievement()` - Show achievement popup
- `hideAchievement()` - Hide achievement
- Tutorial system variables and steps

**Status**: ✅ Keep in designer (user guidance)

---

### 1.12 Validation and System Stats
**Lines**: ~20374-20520
- `calculateSystemStats()` - Calculate system statistics
- System validation logic
- `updateCategoryCounts()` - Update component category counts

**Status**: ✅ Keep in designer (design validation)

---

## 2. LIVE VIEW MODE CODE (Decision: Keep in Designer as "Test Mode")

### 2.1 LiveView Module
**Lines**: ~4773-6254
- `LiveView` object with state management
- `LiveView.PowerFlow` - Real-time power flow calculations
- `LiveView.BreakerManager` - Breaker trip detection
- `LiveView.Animation` - Animation system
- `LiveView.Display` - Display updates
- `LiveView.initialize()` - Initialize live view
- `updateLiveStats()` - Update live statistics

**Status**: ✅ Keep in designer (rename to "Test Mode" for circuit validation)

**Rationale**: Live View is useful for testing circuits during design, not just simulation.

---

## 3. SIMULATE MODE CODE (→ solar_simulator.html)

### 3.1 SimulateMode Module
**Lines**: ~6359-7220
- `SimulateMode` object
- `SimulateMode.calculatePowerFlow()` - Calculate power flow during simulation
- `SimulateMode.calculateResourceFlow()` - Calculate resource flow (water, heat, etc.)
- `SimulateMode.powerFlow` - Power flow state
- `SimulateMode.resourceFlow` - Resource flow state

**Status**: ✅ Move to simulator

---

### 3.2 Simulation Initialization
**Lines**: ~21354-21463
- `initializeSimulationFromBuild()` - Initialize simulation from circuit
- `showSimulationStartHint()` - Show simulation start hint

**Status**: ✅ Move to simulator

---

### 3.3 Time-based Simulation Logic
**Lines**: ~21463-23063
- `calculateTotalLoadPower()` - Calculate total load power
- `calculateLoadConsumption()` - Calculate load consumption over time
- Recipe processing logic (for processors)
- Time progression logic
- Battery SOC updates
- Solar irradiance calculations

**Status**: ✅ Move to simulator

---

### 3.4 Playback Controls
**Lines**: ~7353-7365
- `isPlaying` - Play/pause state
- `simulationSpeed` - Simulation speed multiplier
- `elapsedHours` - Elapsed simulation time
- `currentDayOfYear` - Current day tracking
- `animationFrameId` - Animation frame ID
- Play/pause button handlers
- Speed slider handlers
- Reset simulation handler

**Status**: ✅ Move to simulator

---

### 3.5 Time Display and Visual Updates
**Lines**: ~22294-23384
- `updateTimeDisplay()` - Update time display
- `updateBackgroundColor()` - Update background color (day/night cycle)
- `updateShadowAngle()` - Update shadow angles
- `updateSimulationDisplay()` - Update simulation stats display
- `updateBatteryVisuals()` - Update battery charge visualization
- `updateInspectorLoadToggle()` - Update load toggle in inspector

**Status**: ✅ Move to simulator

---

### 3.6 3D Structure Rendering (Three.js)
**Lines**: ~23792-24351
- `initStructureViewport()` - Initialize 3D viewport
- `initMinimapRenderer()` - Initialize minimap renderer
- `rebuildStructureMeshes()` - Rebuild 3D meshes
- `updateStructureLighting()` - Update lighting based on time
- `renderMainBackground()` - Render 3D background
- `renderMinimap()` - Render minimap
- `renderStructureScene()` - Render structure scene
- `toggleStructureViewport()` - Toggle 3D viewport
- `setupOrbitControls()` - Setup camera controls
- `setupBackgroundResizeHandler()` - Setup resize handler
- Three.js scene setup (cameras, lights, renderers)

**Status**: ✅ Move to simulator (3D visualization)

---

### 3.7 Simulation Statistics
**Lines**: ~23302-23384
- `simStats` object - Simulation statistics
- `updateSimulationDisplay()` - Update stats display
- Simulation stats sidebar sections

**Status**: ✅ Move to simulator

---

### 3.8 Challenge Mode and Weather
**Lines**: ~3006-3015 (UI), ~18687+ (logic)
- Challenge mode button and logic
- Weather difficulty controls
- Weather variation logic

**Status**: ✅ Move to simulator

---

## 4. SHARED CODE (Keep in Both Files)

### 4.1 Data Structures
**Lines**: ~7274-7280
- `allItems` - Array of all components
- `connections` - Array of all connections
- `selectedItem` - Currently selected item
- `selectedConnection` - Currently selected connection
- `itemIdCounter` - Item ID counter
- `connectionIdCounter` - Connection ID counter

**Status**: ✅ Keep in both (core data)

---

### 4.2 Preset Definitions
**Lines**: ~4178-4282
- `PANEL_PRESETS` - Solar panel presets
- `BATTERY_PRESETS` - Battery presets
- `CONTROLLER_PRESETS` - Controller presets
- `BREAKER_PRESETS` - Breaker presets
- `COMBINER_PRESETS` - Combiner presets
- `SOLAR_COMBINER_PRESETS` - Solar combiner presets
- `AC_BREAKER_PRESETS` - AC breaker presets
- `APPLIANCE_PRESETS` - Appliance/load presets
- `GENERATOR_PRESETS` - Generator presets
- `AC_DISTRIBUTION_PRESETS` - AC distribution presets

**Status**: ✅ Keep in both (shared definitions)

---

### 4.3 Constants and Utilities
**Lines**: ~4062-4117
- Component size constants (`PANEL_WIDTH`, `BATTERY_WIDTH`, etc.)
- `HANDLE_RADIUS` - Handle size
- `BREAKER_SIZES` - Breaker size options
- `WIRE_GAUGE_SPECS` - Wire gauge specifications
- `WIRE_COST_PER_FOOT` - Wire cost data
- `WIRE_SAFETY_MARGIN_AMPS` - Safety margin
- `getWireGaugeForAmps()` - Get wire gauge for amperage
- `autosizeBreaker()` - Auto-size breaker
- `updatePanelArrayArea()` - Update array area

**Status**: ✅ Keep in both (shared utilities)

---

### 4.4 Spec Calculation Helpers
**Lines**: ~17401-17949
- `calculateConnectedArraySpecs()` - Calculate array specs
- `calculateConnectedBatterySpecs()` - Calculate battery specs
- `calculatePartialStringVoltage()` - Calculate partial string voltage

**Status**: ✅ Keep in both (used by both modes)

**Note**: These are used by both Build mode (for validation) and Simulate mode (for calculations).

---

### 4.5 Resource System
**Lines**: ~7220-7258
- `RESOURCE_TYPES` - Resource type definitions
- `CORE_RESOURCE_TYPES` - Core resource types
- `getDefaultUnitForResource()` - Get default unit
- `getDefaultCapacityForResource()` - Get default capacity

**Status**: ✅ Keep in both (shared definitions)

---

### 4.6 Cache and Performance
**Lines**: ~7282-7316
- `_specsCache` - Specs calculation cache
- `_connectionIndex` - Connection index for fast lookup
- `invalidateSpecsCache()` - Invalidate cache
- `getConnectionIndex()` - Get connection index
- `getConnectionsForItem()` - Get connections for item
- `scheduleRender()` - Schedule render
- `renderImmediate()` - Immediate render

**Status**: ✅ Keep in both (performance optimization)

---

### 4.7 SVG Setup
**Lines**: ~7419-7584
- D3.js SVG setup
- Zoom behavior
- SVG filters (glow effects)
- SVG groups (wires, items, temp, preview)
- `updateSvgDimensions()` - Update SVG size

**Status**: ✅ Keep in both (canvas setup)

---

### 4.8 Import/Export Functions
**Lines**: ~23477-23791
- `importFromLinkageLab()` - Import from LinkageLab
- LinkageLab import data processing
- Panel grid calculation
- Auto-wiring logic

**Status**: 
- **Designer**: Keep full import logic
- **Simulator**: Keep import handler (but simpler, just load circuit)

---

## 5. UI ELEMENTS

### 5.1 Toolbar
**Lines**: ~2967-3017
- Mode toggle buttons (Build/Live/Simulate)
- Time display
- Simulate controls (play/pause, speed, reset)
- Live view controls
- Save/Load buttons
- Structure view button
- Challenge mode button
- Weather controls

**Status**:
- **Designer**: Keep Build mode, add "Test" mode (Live View), add "Simulate" export button
- **Simulator**: Remove mode toggle, keep simulation controls, add "Edit Circuit" button

---

### 5.2 Sidebars
**Lines**: ~3021-3200+
- Left sidebar: System telemetry
- Right sidebar: Library (designer) / Inspector (both)

**Status**:
- **Designer**: Keep both sidebars
- **Simulator**: Keep left sidebar (stats), simplify right sidebar (read-only inspector)

---

### 5.3 Canvas Container
**Lines**: ~3020
- Main canvas container
- SVG canvas (2D)
- Three.js canvas (3D background)

**Status**:
- **Designer**: SVG canvas only
- **Simulator**: Both SVG (overlay) and Three.js (background)

---

## 6. MODE-SPECIFIC CONDITIONALS

Throughout the code, there are conditionals like:
- `if (currentMode === 'build')` - Build mode logic
- `if (currentMode === 'live')` - Live view logic
- `if (currentMode === 'simulate')` - Simulate mode logic

**Action Required**: Remove or simplify these conditionals after split.

---

## 7. DATA EXCHANGE FORMAT

### Designer → Simulator Export
```javascript
{
    items: allItems,
    connections: connections,
    itemIdCounter: itemIdCounter,
    connectionIdCounter: connectionIdCounter,
    timestamp: Date.now(),
    source: 'solarDesigner'
}
```

**Storage Key**: `localStorage.solarDesignerExport`
**URL Parameter**: `?import=designer`

---

### Simulator → Designer Export (Round-trip)
Same format as above.

**Storage Key**: `localStorage.solarDesignerExport`
**URL Parameter**: `?import=designer`

---

### LinkageLab → Designer Export
**Storage Key**: `localStorage.linkageLabExport`
**URL Parameter**: `?import=linkageLab`

**Status**: Keep existing format, update `index.html` to point to designer.

---

## 8. SUMMARY

### Code Distribution

| Category | Lines (approx) | Designer | Simulator |
|----------|---------------|----------|-----------|
| Component Creation | ~1,000 | ✅ | ❌ |
| Connection/Wiring | ~500 | ✅ | ❌ |
| Rendering (2D) | ~5,000 | ✅ | ❌ (or simplified) |
| Inspector/Editing | ~2,500 | ✅ | ❌ (read-only) |
| Library Panel | ~200 | ✅ | ❌ |
| Canvas Interaction | ~400 | ✅ | ❌ |
| Save/Load | ~100 | ✅ | ❌ |
| Calculations (Build) | ~1,000 | ✅ | ❌ |
| BOM/Review | ~300 | ✅ | ❌ |
| Hints/Tutorials | ~2,000 | ✅ | ❌ |
| Live View | ~1,500 | ✅ (as Test) | ❌ |
| Simulate Mode | ~900 | ❌ | ✅ |
| Time Simulation | ~1,600 | ❌ | ✅ |
| Playback Controls | ~100 | ❌ | ✅ |
| Time Display/Visuals | ~1,100 | ❌ | ✅ |
| 3D Structure | ~600 | ❌ | ✅ |
| Simulation Stats | ~200 | ❌ | ✅ |
| Challenge/Weather | ~100 | ❌ | ✅ |
| Shared Code | ~3,000 | ✅ | ✅ |
| UI/HTML/CSS | ~2,000 | ✅ | ✅ (modified) |

**Estimated Totals**:
- Designer: ~18,000 lines
- Simulator: ~8,000 lines (plus shared ~3,000 = ~11,000 total)

---

## 9. NEXT STEPS (Phase 2)

1. Create `solar_designer.html` by copying `solar_simulator.html`
2. Remove all Simulate mode code sections
3. Remove mode toggle, add "Simulate" export button
4. Add `exportToSimulator()` function
5. Update import handlers
6. Test standalone operation

---

## 10. NOTES

- **Live View**: Decision to keep in designer as "Test Mode" for circuit validation
- **3D Structure**: Only needed in simulator for time-based visualization
- **Rendering**: Designer needs full 2D rendering, simulator can use simplified rendering for visualization
- **Inspector**: Designer needs full editing, simulator can use read-only inspector
- **Mode Conditionals**: Many functions have `currentMode` checks that need cleanup after split

---

**Analysis Complete**: Ready for Phase 2 implementation.


