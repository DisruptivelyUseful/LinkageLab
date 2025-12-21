// ============================================================================
// SHARED EXPORT FORMAT
// Standardized data exchange format between LinkageLab, Solar Designer, 
// and Solar Simulator
// ============================================================================

/**
 * ExportFormat - Defines and handles data exchange between systems
 * 
 * Three main export types:
 * 1. LinkageLab → Solar Simulator: Structure geometry, panel positions, costs
 * 2. Solar Designer → Solar Simulator: Schematic, wiring, automation rules
 * 3. Combined export: All data for comprehensive simulation
 */

const ExportFormat = (function() {
    'use strict';
    
    // Current format version - increment when making breaking changes
    const VERSION = 2;
    
    // Export source identifiers
    const SOURCES = {
        LINKAGE_LAB: 'linkageLab',
        SOLAR_DESIGNER: 'solarDesigner',
        SOLAR_SIMULATOR: 'solarSimulator',
        COMBINED: 'combined'
    };
    
    // localStorage keys for data exchange
    const STORAGE_KEYS = {
        LINKAGE_EXPORT: 'linkageLabExport',
        DESIGNER_EXPORT: 'solarDesignerExport',
        COMBINED_EXPORT: 'linkageLabCombinedExport',
        AUTOMATION_RULES: 'sharedAutomationRules'
    };
    
    // ========================================
    // LINKAGE LAB EXPORT (Structure Data)
    // ========================================
    
    /**
     * Create export data from LinkageLab
     * @param {Object} config - Export configuration
     * @returns {Object} Formatted export data
     */
    function createLinkageExport(config) {
        return {
            version: VERSION,
            source: SOURCES.LINKAGE_LAB,
            timestamp: Date.now(),
            
            // Solar panel information
            solarPanels: {
                count: config.panelCount || 0,
                specs: {
                    name: config.panelName || 'Solar Panel',
                    wmp: config.ratedWatts || 0,
                    vmp: config.vmp || 0,
                    voc: config.voc || 0,
                    isc: config.isc || 0,
                    imp: config.imp || 0,
                    cost: config.panelCost || 0,
                    width: config.panelWidth || 0,   // mm
                    height: config.panelHeight || 0  // mm
                },
                configuration: {
                    layoutMode: config.layoutMode || 'rectangular',
                    gridRows: config.gridRows || 1,
                    gridCols: config.gridCols || 1
                }
            },
            
            // Structure cost breakdown
            structureCost: {
                beams: config.beamsCost || 0,
                brackets: config.bracketCost || 0,
                bolts: config.boltCost || 0,
                subtotal: config.structureSubtotal || 0
            },
            
            // Total BOM cost
            totalBomCost: config.totalCost || 0,
            
            // 3D geometry for visualization
            structureGeometry: config.geometry || null,
            
            // Camera state for matching view
            cameraState: {
                yaw: config.camYaw || 0,
                pitch: config.camPitch || 0,
                dist: config.camDist || 450
            }
        };
    }
    
    // ========================================
    // SOLAR DESIGNER EXPORT (Schematic Data)
    // ========================================
    
    /**
     * Create export data from Solar Designer
     * @param {Object} config - Export configuration
     * @returns {Object} Formatted export data
     */
    function createDesignerExport(config) {
        const exportData = {
            version: VERSION,
            source: SOURCES.SOLAR_DESIGNER,
            timestamp: Date.now(),
            
            // Schematic components
            schematic: {
                components: config.components || [],   // Array of component objects
                connections: config.connections || [], // Array of wire connections
                layout: {
                    canvasWidth: config.canvasWidth || 2000,
                    canvasHeight: config.canvasHeight || 1500,
                    zoom: config.zoom || 1,
                    panX: config.panX || 0,
                    panY: config.panY || 0
                }
            },
            
            // Automation rules (from shared AutomationEngine)
            automation: config.automationRules || { rules: [], ruleIdCounter: 0 },
            
            // Simulation state
            simulation: {
                timeOfDay: config.timeOfDay || 720,  // Minutes since midnight (default noon)
                isLiveMode: config.isLiveMode || false,
                loadStates: config.loadStates || {},
                breakerStates: config.breakerStates || {}
            },
            
            // System summary
            summary: {
                totalPanelWatts: config.totalPanelWatts || 0,
                totalBatteryKwh: config.totalBatteryKwh || 0,
                totalLoadWatts: config.totalLoadWatts || 0,
                componentCount: config.componentCount || 0
            }
        };
        
        // Include structure geometry if provided or from localStorage (passed through from LinkageLab)
        if (config.structureGeometry) {
            exportData.structureGeometry = config.structureGeometry;
        } else {
            // Try to load from localStorage (set by LinkageLab export)
            try {
                const linkageExport = localStorage.getItem('linkageLabExport');
                if (linkageExport) {
                    const linkageData = JSON.parse(linkageExport);
                    if (linkageData.structureGeometry) {
                        exportData.structureGeometry = linkageData.structureGeometry;
                    }
                }
                // Also try standalone geometry storage
                const geometryData = localStorage.getItem('linkageLabGeometry');
                if (geometryData && !exportData.structureGeometry) {
                    exportData.structureGeometry = JSON.parse(geometryData);
                }
            } catch (e) {
                console.warn('ExportFormat: Could not load structure geometry', e);
            }
        }
        
        // Include camera state if provided or from localStorage
        if (config.cameraState) {
            exportData.cameraState = config.cameraState;
        } else {
            try {
                const cameraState = localStorage.getItem('linkageLabCameraState');
                if (cameraState) {
                    exportData.cameraState = JSON.parse(cameraState);
                }
            } catch (e) {
                console.warn('ExportFormat: Could not load camera state', e);
            }
        }
        
        return exportData;
    }
    
    // ========================================
    // COMBINED EXPORT
    // ========================================
    
    /**
     * Create combined export from both LinkageLab and Solar Designer
     * @param {Object} linkageData - Data from LinkageLab
     * @param {Object} designerData - Data from Solar Designer
     * @returns {Object} Combined export data
     */
    function createCombinedExport(linkageData, designerData) {
        return {
            version: VERSION,
            source: SOURCES.COMBINED,
            timestamp: Date.now(),
            
            // Include both data sets
            linkage: linkageData,
            designer: designerData,
            
            // Merged automation (Designer takes precedence)
            automation: designerData?.automation || linkageData?.automation || null
        };
    }
    
    // ========================================
    // STORAGE HELPERS
    // ========================================
    
    /**
     * Save export data to localStorage
     * @param {string} key - Storage key (use STORAGE_KEYS constants)
     * @param {Object} data - Data to save
     * @returns {boolean} Success
     */
    function saveToStorage(key, data) {
        try {
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('ExportFormat: Failed to save to storage', e);
            return false;
        }
    }
    
    /**
     * Load export data from localStorage
     * @param {string} key - Storage key
     * @returns {Object|null} Loaded data or null
     */
    function loadFromStorage(key) {
        try {
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('ExportFormat: Failed to load from storage', e);
            return null;
        }
    }
    
    /**
     * Clear export data from localStorage
     * @param {string} key - Storage key (optional, clears all if not provided)
     */
    function clearStorage(key) {
        if (key) {
            localStorage.removeItem(key);
        } else {
            Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
        }
    }
    
    // ========================================
    // VALIDATION
    // ========================================
    
    /**
     * Validate export data structure
     * @param {Object} data - Data to validate
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    function validate(data) {
        const errors = [];
        
        if (!data) {
            errors.push('No data provided');
            return { valid: false, errors };
        }
        
        if (!data.version) {
            errors.push('Missing version field');
        } else if (data.version > VERSION) {
            errors.push(`Data version ${data.version} is newer than supported version ${VERSION}`);
        }
        
        if (!data.source) {
            errors.push('Missing source field');
        } else if (!Object.values(SOURCES).includes(data.source)) {
            errors.push(`Unknown source: ${data.source}`);
        }
        
        if (!data.timestamp) {
            errors.push('Missing timestamp field');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }
    
    /**
     * Check if data is from a specific source
     * @param {Object} data - Export data
     * @param {string} source - Expected source
     * @returns {boolean}
     */
    function isFromSource(data, source) {
        return data && data.source === source;
    }
    
    // ========================================
    // MIGRATION (for version upgrades)
    // ========================================
    
    /**
     * Migrate data from older versions to current version
     * @param {Object} data - Data to migrate
     * @returns {Object} Migrated data
     */
    function migrate(data) {
        if (!data || !data.version) return data;
        
        let migrated = { ...data };
        
        // Version 1 → 2 migration
        if (migrated.version === 1) {
            // Add any necessary transformations here
            migrated.version = 2;
            
            // Example: ensure automation structure exists
            if (!migrated.automation) {
                migrated.automation = { rules: [], ruleIdCounter: 0 };
            }
        }
        
        return migrated;
    }
    
    // ========================================
    // URL PARAMETER HELPERS
    // ========================================
    
    /**
     * Get import source from URL parameters
     * @returns {string|null} Import source or null
     */
    function getImportSourceFromURL() {
        const params = new URLSearchParams(window.location.search);
        return params.get('import');
    }
    
    /**
     * Build URL with import parameter
     * @param {string} baseUrl - Base URL
     * @param {string} source - Import source
     * @returns {string} URL with import parameter
     */
    function buildImportURL(baseUrl, source) {
        const url = new URL(baseUrl, window.location.origin);
        url.searchParams.set('import', source);
        return url.toString();
    }
    
    // ========================================
    // COMPONENT SERIALIZATION HELPERS
    // ========================================
    
    /**
     * Serialize a component for export
     * @param {Object} component - Component object
     * @returns {Object} Serialized component
     */
    function serializeComponent(component) {
        return {
            id: component.id,
            type: component.type,
            subtype: component.subtype || null,
            x: component.x,
            y: component.y,
            width: component.width,
            height: component.height,
            rotation: component.rotation || 0,
            specs: { ...component.specs },
            handles: serializeHandles(component.handles),
            // Exclude runtime state
        };
    }
    
    /**
     * Serialize handles/connections
     * @param {Object} handles - Handles object
     * @returns {Object} Serialized handles
     */
    function serializeHandles(handles) {
        if (!handles) return {};
        
        const serialized = {};
        for (const [key, handle] of Object.entries(handles)) {
            serialized[key] = {
                type: handle.type,
                polarity: handle.polarity,
                connectedTo: handle.connectedTo ? handle.connectedTo.map(c => ({
                    connectionId: c.connectionId,
                    targetItemId: c.targetItemId,
                    targetHandle: c.targetHandle
                })) : []
            };
        }
        return serialized;
    }
    
    /**
     * Serialize a wire connection for export
     * @param {Object} connection - Connection object
     * @returns {Object} Serialized connection
     */
    function serializeConnection(connection) {
        return {
            id: connection.id,
            sourceItemId: connection.sourceItemId,
            sourceHandle: connection.sourceHandle,
            targetItemId: connection.targetItemId,
            targetHandle: connection.targetHandle,
            wireType: connection.wireType || 'dc',
            points: connection.points || []
        };
    }
    
    // ========================================
    // PUBLIC API
    // ========================================
    
    return {
        // Constants
        VERSION,
        SOURCES,
        STORAGE_KEYS,
        
        // Export creators
        createLinkageExport,
        createDesignerExport,
        createCombinedExport,
        
        // Storage
        saveToStorage,
        loadFromStorage,
        clearStorage,
        
        // Validation
        validate,
        isFromSource,
        migrate,
        
        // URL helpers
        getImportSourceFromURL,
        buildImportURL,
        
        // Serialization helpers
        serializeComponent,
        serializeConnection,
        serializeHandles
    };
})();

// Export for module systems (if used)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ExportFormat;
}
