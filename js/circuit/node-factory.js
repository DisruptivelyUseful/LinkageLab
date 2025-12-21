/**
 * Node Factory Module
 * Factory functions for creating circuit nodes (panels, batteries, controllers, etc.)
 */

/**
 * Create a solar panel node
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {Object} specs - Panel specifications
 * @param {Function} getItemId - Function to get next item ID
 * @returns {Object} Panel node object
 */
export function createPanel(x, y, specs, getItemId) {
    const id = `panel-${getItemId()}`;
    let imp = specs.imp;
    if (!imp && specs.wmp && specs.vmp) {
        imp = specs.wmp / specs.vmp;
    } else if (!imp && specs.isc) {
        imp = specs.isc * 0.9;
    } else if (!imp) {
        imp = 0;
    }
    
    const panelWidthMm = specs.width || 1650;
    const panelHeightMm = specs.height || 992;
    const baseScale = 120; // pixels per meter
    const pixelsPerMm = baseScale / 1000;
    
    let panelHeightPx = panelHeightMm * pixelsPerMm;
    panelHeightPx = Math.max(80, Math.min(200, panelHeightPx));
    const panelWidthPx = (panelWidthMm / panelHeightMm) * panelHeightPx;
    
    return {
        id,
        type: 'panel',
        x, y,
        width: panelWidthPx,
        height: panelHeightPx,
        specs: { 
            ...specs, 
            imp: parseFloat(imp.toFixed(2)),
            scaleFactor: panelHeightPx / (panelHeightMm / 1000)
        },
        handles: {
            positive: { id: `${id}-pos`, polarity: 'positive', x: 0, y: panelHeightPx / 2, side: 'left', connectedTo: [] },
            negative: { id: `${id}-neg`, polarity: 'negative', x: panelWidthPx, y: panelHeightPx / 2, side: 'right', connectedTo: [] }
        }
    };
}

/**
 * Create panel with specific pixel dimensions (for LinkageLab import)
 */
export function createPanelWithDimensions(x, y, specs, widthPx, heightPx, getItemId) {
    const id = `panel-${getItemId()}`;
    let imp = specs.imp;
    if (!imp && specs.wmp && specs.vmp) {
        imp = specs.wmp / specs.vmp;
    } else if (!imp && specs.isc) {
        imp = specs.isc * 0.9;
    } else if (!imp) {
        imp = 0;
    }
    
    return {
        id,
        type: 'panel',
        x, y,
        width: widthPx,
        height: heightPx,
        specs: { 
            ...specs, 
            imp: parseFloat(imp.toFixed(2)),
            scaleFactor: heightPx / ((specs.height || 1650) / 1000)
        },
        handles: {
            positive: { id: `${id}-pos`, polarity: 'positive', x: 0, y: heightPx / 2, side: 'left', connectedTo: [] },
            negative: { id: `${id}-neg`, polarity: 'negative', x: widthPx, y: heightPx / 2, side: 'right', connectedTo: [] }
        }
    };
}

/**
 * Create a battery node
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {Object} specs - Battery specifications
 * @param {Function} getItemId - Function to get next item ID
 * @returns {Object} Battery node object
 */
export function createBattery(x, y, specs, getItemId) {
    const id = `battery-${getItemId()}`;
    const kWh = (specs.voltage * specs.ah) / 1000;
    
    const batteryHeightMm = specs.height || 300;
    const batteryWidthMm = specs.width || 200;
    const baseScale = 120;
    const pixelsPerMm = baseScale / 1000;
    
    let batteryHeightPx = batteryHeightMm * pixelsPerMm;
    batteryHeightPx = Math.max(60, Math.min(150, batteryHeightPx));
    
    const aspectRatio = batteryWidthMm / batteryHeightMm;
    let batteryWidthPx = batteryHeightPx * aspectRatio;
    batteryWidthPx = Math.max(80, Math.min(200, batteryWidthPx));
    
    const scaleFactor = batteryHeightPx / (batteryHeightMm / 1000);
    
    return {
        id,
        type: 'battery',
        x, y,
        width: batteryWidthPx,
        height: batteryHeightPx,
        specs: { 
            ...specs, 
            kWh,
            scaleFactor: scaleFactor
        },
        handles: {
            positive: { id: `${id}-pos`, polarity: 'positive', x: batteryWidthPx * 0.25, y: -5, side: 'top', connectedTo: [] },
            negative: { id: `${id}-neg`, polarity: 'negative', x: batteryWidthPx * 0.75, y: -5, side: 'top', connectedTo: [] }
        }
    };
}

/**
 * Create a smart battery node
 */
export function createSmartBattery(x, y, kWh = 3.6, parentControllerId = null, getItemId) {
    const id = `smartbattery-${getItemId()}`;
    const SMART_BATTERY_WIDTH = 100;
    const SMART_BATTERY_HEIGHT = 80;
    
    return {
        id,
        type: 'smartbattery',
        x, y,
        width: SMART_BATTERY_WIDTH,
        height: SMART_BATTERY_HEIGHT,
        parentControllerId,
        specs: { 
            name: 'Smart Battery',
            kWh,
            voltage: 48,
            cost: 2700
        },
        handles: {
            smartPort1: { id: `${id}-smart-1`, polarity: 'smart-battery', x: SMART_BATTERY_WIDTH + 5, y: SMART_BATTERY_HEIGHT * 0.5, side: 'right', connectedTo: [] },
            smartPort2: { id: `${id}-smart-2`, polarity: 'smart-battery', x: -5, y: SMART_BATTERY_HEIGHT * 0.5, side: 'left', connectedTo: [] }
        }
    };
}

/**
 * Create a controller node
 * @param {number} x - X position
 * @param {number} y - Y position
 * @param {Object} specs - Controller specifications
 * @param {Function} getItemId - Function to get next item ID
 * @returns {Object} Controller node object
 */
export function createController(x, y, specs, getItemId) {
    const id = `controller-${getItemId()}`;
    const isHybrid = specs.type === 'hybrid_inverter' || specs.type === 'all_in_one';
    const isAllInOne = specs.type === 'all_in_one';
    
    const controllerHeightMm = specs.height || 600;
    const controllerWidthMm = specs.width || 400;
    const baseScale = 120;
    const pixelsPerMm = baseScale / 1000;
    
    let controllerHeightPx = controllerHeightMm * pixelsPerMm;
    controllerHeightPx = Math.max(80, Math.min(200, controllerHeightPx));
    
    const aspectRatio = controllerWidthMm / controllerHeightMm;
    let controllerWidthPx = controllerHeightPx * aspectRatio;
    controllerWidthPx = Math.max(100, Math.min(300, controllerWidthPx));
    
    const scaleFactor = controllerHeightPx / (controllerHeightMm / 1000);
    const nodeHeight = controllerHeightPx;
    const mpptCount = specs.mpptCount || 1;
    
    const handles = {};
    
    // Create PV input ports based on MPPT count
    if (mpptCount === 1) {
        handles.pvPositive = { id: `${id}-pv-pos`, polarity: 'pv-positive', x: controllerWidthPx * 0.375, y: -5, side: 'top', connectedTo: [], mpptIndex: 0 };
        handles.pvNegative = { id: `${id}-pv-neg`, polarity: 'pv-negative', x: controllerWidthPx * 0.625, y: -5, side: 'top', connectedTo: [], mpptIndex: 0 };
    } else {
        const margin = 25;
        const availableWidth = controllerWidthPx - (2 * margin);
        const pairWidth = 35;
        
        for (let i = 0; i < mpptCount; i++) {
            const firstCenter = margin + pairWidth / 2;
            const lastCenter = controllerWidthPx - margin - pairWidth / 2;
            const xPos = firstCenter + ((lastCenter - firstCenter) / (mpptCount - 1)) * i;
            
            handles[`pvPositive${i + 1}`] = { 
                id: `${id}-pv-pos-${i + 1}`, 
                polarity: 'pv-positive', 
                x: xPos - pairWidth / 2, 
                y: -5, 
                side: 'top', 
                connectedTo: [], 
                mpptIndex: i 
            };
            handles[`pvNegative${i + 1}`] = { 
                id: `${id}-pv-neg-${i + 1}`, 
                polarity: 'pv-negative', 
                x: xPos + pairWidth / 2, 
                y: -5, 
                side: 'top', 
                connectedTo: [], 
                mpptIndex: i 
            };
        }
        handles.pvPositive = handles.pvPositive1;
        handles.pvNegative = handles.pvNegative1;
    }
    
    if (!isAllInOne) {
        handles.batteryPositive = { id: `${id}-batt-pos`, polarity: 'positive', x: controllerWidthPx * 0.375, y: nodeHeight + 5, side: 'bottom', connectedTo: [] };
        handles.batteryNegative = { id: `${id}-batt-neg`, polarity: 'negative', x: controllerWidthPx * 0.625, y: nodeHeight + 5, side: 'bottom', connectedTo: [] };
    }
    
    if (isHybrid) {
        handles.acOutput = { id: `${id}-ac-out`, polarity: 'ac', x: controllerWidthPx + 5, y: nodeHeight * 0.5, side: 'right', connectedTo: [] };
    }
    
    if (isAllInOne && specs.smartBatteryPorts) {
        for (let i = 0; i < specs.smartBatteryPorts; i++) {
            const portY = nodeHeight * 0.35 + (i * 35);
            handles[`smartBattery${i + 1}`] = { 
                id: `${id}-smart-batt-${i + 1}`, 
                polarity: 'smart-battery', 
                x: -5, 
                y: portY, 
                side: 'left', 
                connectedTo: [],
                portIndex: i + 1
            };
        }
    }
    
    if (specs.parallelCapable) {
        handles.parallelPort = { 
            id: `${id}-parallel`, 
            polarity: 'parallel', 
            x: controllerWidthPx + 5, 
            y: nodeHeight * 0.25, 
            side: 'right', 
            connectedTo: [] 
        };
    }
    
    return {
        id,
        type: 'controller',
        subtype: specs.type,
        x, y,
        width: controllerWidthPx,
        height: nodeHeight,
        specs: { 
            ...specs,
            topColor: specs.topColor || '#c0c0c0',
            bottomColor: specs.bottomColor || '#2a2a2a',
            dividerHeight: specs.dividerHeight !== undefined ? specs.dividerHeight : 50,
            imageUrl: specs.imageUrl || null,
            scaleFactor: scaleFactor
        },
        handles
    };
}
