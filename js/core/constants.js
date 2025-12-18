// ============================================================================
// SOLAR DESIGNER - CONSTANTS AND PRESETS
// ============================================================================

// Panel presets - merged from reference simulator
const PANEL_PRESETS = [
    // Existing presets
    { name: "Rich Solar 200W Mono", wmp: 200, vmp: 20.5, voc: 24.6, isc: 10.8, imp: 9.76, width: 1150, height: 770, cost: 150 },
    { name: "HQST 100W Poly", wmp: 100, vmp: 18.9, voc: 22.4, isc: 5.95, imp: 5.29, width: 1050, height: 540, cost: 80 },
    { name: "Renogy 175W Mono", wmp: 175, vmp: 19.3, voc: 23.0, isc: 10.2, imp: 9.07, width: 1580, height: 700, cost: 170 },
    { name: "Rich Solar 400W Bifacial", wmp: 400, vmp: 40.0, voc: 48.0, isc: 11.5, imp: 10.0, width: 1722, height: 1134, cost: 250 },
    { name: "LONGi 550W Hi-Mo 5", wmp: 550, vmp: 41.3, voc: 49.1, isc: 14.1, imp: 13.32, width: 2256, height: 1133, cost: 200 },
    { name: "SunPower M Series 420W", wmp: 420, vmp: 66.8, voc: 79.0, isc: 6.58, imp: 6.29, width: 1690, height: 1046, cost: 400 },
    // Additional presets from reference simulator
    { name: "Generic 250W", wmp: 250, vmp: 30.5, voc: 37.5, isc: 8.80, imp: 8.20, width: 1650, height: 992, cost: 120 },
    { name: "Alrska Flexible 100W", wmp: 100, vmp: 18.0, voc: 21.6, isc: 6.10, imp: 5.56, width: 1050, height: 540, cost: 80 },
    { name: "EcoFlow 400W Rigid", wmp: 400, vmp: 41.0, voc: 48.0, isc: 11.00, imp: 9.76, width: 1723, height: 1134, cost: 300 },
    { name: "Trina Vertex 260W", wmp: 260, vmp: 31.1, voc: 37.7, isc: 9.05, imp: 8.36, width: 1754, height: 1096, cost: 130 },
    { name: "REC Alpha Pure 410W", wmp: 410, vmp: 34.2, voc: 40.5, isc: 12.70, imp: 12.00, width: 1821, height: 1016, cost: 350 },
    { name: "EcoFlow 400W Portable", wmp: 400, vmp: 41.0, voc: 48.0, isc: 11.00, imp: 9.76, width: 2365, height: 1068, cost: 350 },
    { name: "Solaria PowerXT 400", wmp: 400, vmp: 40.5, voc: 48.2, isc: 10.42, imp: 9.88, width: 1740, height: 1038, cost: 350 },
    { name: "SunPower Maxeon 430W", wmp: 430, vmp: 39.8, voc: 47.6, isc: 11.50, imp: 10.81, width: 1872, height: 1032, cost: 450 },
    { name: "Alrska 120W Rigid", wmp: 120, vmp: 20.0, voc: 24.0, isc: 6.50, imp: 6.00, width: 1200, height: 600, cost: 90 },
    { name: "EcoFlow 100W Portable", wmp: 100, vmp: 18.0, voc: 21.6, isc: 6.10, imp: 5.56, width: 1050, height: 540, cost: 85 },
    { name: "BougeRV CIGS 200W", wmp: 200, vmp: 28.0, voc: 34.0, isc: 7.50, imp: 7.14, width: 1420, height: 1060, cost: 280 }
];

// Battery presets - merged from reference simulator
const BATTERY_PRESETS = [
    // Existing presets
    { name: "12V 100Ah LiFePO4", voltage: 12.8, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 330, height: 175, cost: 400 },
    { name: "12V 200Ah LiFePO4", voltage: 12.8, ah: 200, maxDischargeRate: 1, maxDischarge: 200, width: 520, height: 225, cost: 700 },
    { name: "24V 100Ah LiFePO4", voltage: 25.6, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 480, height: 220, cost: 800 },
    { name: "48V 100Ah Server Rack", voltage: 51.2, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 440, height: 175, cost: 1500 },
    { name: "Battleborn 100Ah", voltage: 12.8, ah: 100, maxDischargeRate: 0.5, maxDischarge: 50, width: 330, height: 175, cost: 950 },
    { name: "SOK 206Ah 12V", voltage: 12.8, ah: 206, maxDischargeRate: 1, maxDischarge: 206, width: 520, height: 220, cost: 900 },
    // Additional presets from reference simulator
    { name: "12V 100Ah AGM", voltage: 12, ah: 100, maxDischargeRate: 0.5, maxDischarge: 50, width: 200, height: 300, cost: 200 },
    { name: "EG4 48V 100Ah LiFePO4", voltage: 51.2, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 200, height: 300, cost: 1400 },
    { name: "EG4 48V 200Ah LiFePO4", voltage: 51.2, ah: 200, maxDischargeRate: 1, maxDischarge: 200, width: 250, height: 350, cost: 2600 },
    { name: "EG4 48V 280Ah LiFePO4", voltage: 51.2, ah: 280, maxDischargeRate: 1, maxDischarge: 280, width: 280, height: 400, cost: 3200 },
    { name: "Zoom 48V 100Ah LiFePO4", voltage: 51.2, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 200, height: 300, cost: 1350 },
    { name: "Zoom 48V 200Ah LiFePO4", voltage: 51.2, ah: 200, maxDischargeRate: 1, maxDischarge: 200, width: 250, height: 350, cost: 2500 },
    { name: "Ruixu 48V 100Ah LiFePO4", voltage: 51.2, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 200, height: 300, cost: 1300 },
    { name: "Ruixu 48V 200Ah LiFePO4", voltage: 51.2, ah: 200, maxDischargeRate: 1, maxDischarge: 200, width: 250, height: 350, cost: 2400 },
    { name: "Server Rack 48V 100Ah", voltage: 51.2, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 200, height: 300, cost: 1200 },
    { name: "Server Rack 48V 200Ah", voltage: 51.2, ah: 200, maxDischargeRate: 1, maxDischarge: 200, width: 250, height: 350, cost: 2200 },
    { name: "Big Battery 48V 100Ah LiFePO4", voltage: 51.2, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 200, height: 300, cost: 1450 },
    { name: "Big Battery 48V 200Ah LiFePO4", voltage: 51.2, ah: 200, maxDischargeRate: 1, maxDischarge: 200, width: 250, height: 350, cost: 2700 },
    { name: "EcoWorthy 12V 100Ah LiFePO4", voltage: 12.8, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 200, height: 300, cost: 380 },
    { name: "EcoWorthy 12V 200Ah LiFePO4", voltage: 12.8, ah: 200, maxDischargeRate: 1, maxDischarge: 200, width: 250, height: 350, cost: 680 },
    { name: "EcoWorthy 48V 100Ah LiFePO4", voltage: 51.2, ah: 100, maxDischargeRate: 1, maxDischarge: 100, width: 200, height: 300, cost: 1380 },
    { name: "EcoFlow DELTA Pro Smart Battery", voltage: 48, ah: 75, maxDischargeRate: 1, maxDischarge: 75, width: 200, height: 300, smartBattery: true, ecosystemType: 'ecoflow', cost: 1800 },
    { name: "EcoFlow DELTA 2 Smart Battery", voltage: 48, ah: 20.8, maxDischargeRate: 1, maxDischarge: 20.8, width: 200, height: 300, smartBattery: true, ecosystemType: 'ecoflow', cost: 800 },
    { name: "EcoFlow DELTA 2 Max Smart Battery", voltage: 48, ah: 41.7, maxDischargeRate: 1, maxDischarge: 41.7, width: 200, height: 300, smartBattery: true, ecosystemType: 'ecoflow', cost: 1100 },
    { name: "EcoFlow RIVER 2 Max Smart Battery", voltage: 48, ah: 10.7, maxDischargeRate: 1, maxDischarge: 10.7, width: 200, height: 300, smartBattery: true, ecosystemType: 'ecoflow', cost: 400 },
    { name: "EcoFlow RIVER 2 Pro Smart Battery", voltage: 48, ah: 16, maxDischargeRate: 1, maxDischarge: 16, width: 200, height: 300, smartBattery: true, ecosystemType: 'ecoflow', cost: 500 }
];

// Controller presets - merged from reference simulator
const CONTROLLER_PRESETS = [
    // Existing presets
    { name: "Generic MPPT 100/20", type: 'charge_controller', maxVoc: 100, maxIsc: 20, maxWmp: 520, ratedChargeCurrent: 20, supportedVoltages: [12,24], width: 300, height: 500, cost: 80 },
    { name: "Victron SmartSolar 150/35", type: 'charge_controller', maxVoc: 150, maxIsc: 35, maxWmp: 2000, ratedChargeCurrent: 35, supportedVoltages: [12,24,36,48], width: 350, height: 550, cost: 400 },
    { name: "Victron SmartSolar 250/100", type: 'charge_controller', maxVoc: 250, maxIsc: 100, maxWmp: 5800, ratedChargeCurrent: 100, supportedVoltages: [12,24,36,48], width: 400, height: 650, cost: 800 },
    { name: "PowMR 5000W Hybrid", type: 'hybrid_inverter', maxVoc: 145, maxIsc: 80, maxWmp: 5000, ratedChargeCurrent: 80, supportedVoltages: [48], maxACOutputW: 5000, width: 450, height: 700, cost: 600 },
    { name: "EcoFlow DELTA Pro", type: 'all_in_one', maxVoc: 150, maxIsc: 15, maxWmp: 1600, ratedChargeCurrent: 30, supportedVoltages: [48], internalBatteryKWh: 3.6, maxACOutputW: 3600, width: 500, height: 800, cost: 3500 },
    { name: "Renogy 3000W Inverter", type: 'hybrid_inverter', maxVoc: 145, maxIsc: 50, maxWmp: 4000, ratedChargeCurrent: 50, supportedVoltages: [12,24], maxACOutputW: 3000, width: 420, height: 650, cost: 600 },
    // Additional presets from reference simulator
    { name: "Generic MPPT 150/50", type: 'charge_controller', maxVoc: 150, maxIsc: 50, maxWmp: 2400, mppVoltageMin: 18, mppVoltageMax: 145, ratedChargeCurrent: 50, supportedVoltages: [12,24,48], width: 400, height: 600, cost: 250 },
    { name: "Victron SmartSolar 100/20", type: 'charge_controller', maxVoc: 100, maxIsc: 20, maxWmp: 580, mppVoltageMin: 18, mppVoltageMax: 80, ratedChargeCurrent: 20, supportedVoltages: [12,24], width: 130, height: 186, cost: 150 },
    { name: "Renogy Rover 40A MPPT", type: 'charge_controller', maxVoc: 100, maxIsc: 25, maxWmp: 1040, mppVoltageMin: 18, mppVoltageMax: 92, ratedChargeCurrent: 40, supportedVoltages: [12,24], width: 190, height: 340, cost: 160 },
    { name: "Renogy Rover 60A MPPT", type: 'charge_controller', maxVoc: 150, maxIsc: 35, maxWmp: 1560, mppVoltageMin: 18, mppVoltageMax: 140, ratedChargeCurrent: 60, supportedVoltages: [12,24], width: 190, height: 340, cost: 250 },
    { name: "EPever Tracer 40A MPPT", type: 'charge_controller', maxVoc: 150, maxIsc: 25, maxWmp: 1040, mppVoltageMin: 18, mppVoltageMax: 140, ratedChargeCurrent: 40, supportedVoltages: [12,24], width: 200, height: 300, cost: 120 },
    { name: "Victron MultiPlus-II 48/5000", type: 'hybrid_inverter', maxVoc: 150, maxIsc: 35, maxWmp: 4500, minVmp: 38, mppVoltageMin: 38, mppVoltageMax: 145, ratedChargeCurrent: 70, supportedVoltages: [48], maxACOutputW: 5000, width: 328, height: 520, cost: 2200 },
    { name: "Growatt SPF 5000ES", type: 'hybrid_inverter', maxVoc: 145, maxIsc: 18, maxWmp: 5500, minVmp: 60, mppVoltageMin: 60, mppVoltageMax: 115, ratedChargeCurrent: 80, supportedVoltages: [48], maxACOutputW: 5000, width: 460, height: 540, cost: 700 },
    { name: "PowMR 3000W Hybrid", type: 'hybrid_inverter', maxVoc: 145, maxIsc: 18, maxWmp: 3000, minVmp: 60, mppVoltageMin: 60, mppVoltageMax: 115, ratedChargeCurrent: 60, supportedVoltages: [24,48], maxACOutputW: 3000, width: 410, height: 480, cost: 450 },
    { name: "LuxPower SNA 6000", type: 'hybrid_inverter', mpptCount: 2, maxVoc: 500, maxIsc: 15, maxWmp: 9000, minVmp: 125, mppVoltageMin: 125, mppVoltageMax: 425, ratedChargeCurrent: 120, supportedVoltages: [48], maxACOutputW: 6000, width: 530, height: 545, cost: 1600 },
    { name: "EG4 6000XP", type: 'hybrid_inverter', mpptCount: 2, maxVoc: 500, maxIsc: 14, maxWmp: 8000, minVmp: 125, mppVoltageMin: 125, mppVoltageMax: 425, ratedChargeCurrent: 120, supportedVoltages: [48], maxACOutputW: 6000, width: 530, height: 545, cost: 1450 },
    { name: "Sol-Ark 12K", type: 'hybrid_inverter', mpptCount: 2, maxVoc: 500, maxIsc: 25, maxWmp: 12000, minVmp: 150, mppVoltageMin: 150, mppVoltageMax: 450, ratedChargeCurrent: 180, supportedVoltages: [48], maxACOutputW: 12000, width: 584, height: 711, cost: 4500 },
    { name: "EcoFlow DELTA Pro Ultra", type: 'all_in_one', maxVoc: 150, maxIsc: 30, maxWmp: 5600, minVmp: 11, mppVoltageMin: 11, mppVoltageMax: 145, ratedChargeCurrent: 30, supportedVoltages: [48], internalBatteryKWh: 6, maxACOutputW: 7200, smartBatteryPorts: 5, smartBatteryKWh: 6, parallelCapable: true, ecosystemType: 'ecoflow', width: 693, height: 442, cost: 5800 },
    { name: "EcoFlow DELTA 2", type: 'all_in_one', maxVoc: 60, maxIsc: 15, maxWmp: 500, minVmp: 11, mppVoltageMin: 11, mppVoltageMax: 55, ratedChargeCurrent: 15, supportedVoltages: [48], internalBatteryKWh: 1.024, maxACOutputW: 1800, smartBatteryPorts: 1, smartBatteryKWh: 1.024, ecosystemType: 'ecoflow', width: 400, height: 281, cost: 1000 },
    { name: "EcoFlow DELTA 2 Max", type: 'all_in_one', maxVoc: 60, maxIsc: 15, maxWmp: 500, minVmp: 11, mppVoltageMin: 11, mppVoltageMax: 55, ratedChargeCurrent: 15, supportedVoltages: [48], internalBatteryKWh: 2.048, maxACOutputW: 2400, smartBatteryPorts: 2, smartBatteryKWh: 2.048, ecosystemType: 'ecoflow', width: 497, height: 305, cost: 2100 },
    { name: "EcoFlow RIVER 2", type: 'all_in_one', maxVoc: 50, maxIsc: 8, maxWmp: 110, minVmp: 11, mppVoltageMin: 11, mppVoltageMax: 45, ratedChargeCurrent: 8, supportedVoltages: [48], internalBatteryKWh: 0.256, maxACOutputW: 300, ecosystemType: 'ecoflow', width: 245, height: 215, cost: 250 },
    { name: "EcoFlow RIVER 2 Max", type: 'all_in_one', maxVoc: 60, maxIsc: 13, maxWmp: 220, minVmp: 11, mppVoltageMin: 11, mppVoltageMax: 55, ratedChargeCurrent: 13, supportedVoltages: [48], internalBatteryKWh: 0.512, maxACOutputW: 500, smartBatteryPorts: 1, smartBatteryKWh: 0.512, ecosystemType: 'ecoflow', width: 269, height: 259, cost: 450 },
    { name: "EcoFlow RIVER 2 Pro", type: 'all_in_one', maxVoc: 60, maxIsc: 13, maxWmp: 220, minVmp: 11, mppVoltageMin: 11, mppVoltageMax: 55, ratedChargeCurrent: 13, supportedVoltages: [48], internalBatteryKWh: 0.768, maxACOutputW: 800, smartBatteryPorts: 1, smartBatteryKWh: 0.768, ecosystemType: 'ecoflow', width: 269, height: 226, cost: 600 },
    { name: "Anker Solix F3800", type: 'all_in_one', maxVoc: 150, maxIsc: 15, maxWmp: 2400, minVmp: 30, mppVoltageMin: 30, mppVoltageMax: 145, ratedChargeCurrent: 30, supportedVoltages: [48], internalBatteryKWh: 3.84, maxACOutputW: 6000, parallelCapable: true, width: 443, height: 515, cost: 3500 },
    { name: "Bluetti AC300", type: 'all_in_one', maxVoc: 150, maxIsc: 12, maxWmp: 2400, minVmp: 12, mppVoltageMin: 12, mppVoltageMax: 145, ratedChargeCurrent: 24, supportedVoltages: [48], internalBatteryKWh: 0, maxACOutputW: 3000, smartBatteryPorts: 2, smartBatteryKWh: 3.072, parallelCapable: true, width: 520, height: 320, cost: 2800 }
];

const BREAKER_PRESETS = [10, 20, 30, 40, 50].map((r, i) => ({ name: `DC Breaker ${r}A`, rating: r, maxVoltage: 150, cost: 15 + i * 4 }));

const APPLIANCE_PRESETS = [
    { name: "Custom Load", voltage: 120, watts: 100, icon: "⚙️" },
    { name: "LED Light (10W)", voltage: 120, watts: 10, icon: "💡" },
    { name: "CFL Light (23W)", voltage: 120, watts: 23, icon: "💡" },
    { name: "Laptop (65W)", voltage: 120, watts: 65, icon: "💻" },
    { name: "Desktop PC (200W)", voltage: 120, watts: 200, icon: "🖥️" },
    { name: "TV 55\" LED (80W)", voltage: 120, watts: 80, icon: "📺" },
    { name: "Refrigerator (150W)", voltage: 120, watts: 150, icon: "🧊" },
    { name: "Microwave (1200W)", voltage: 120, watts: 1200, icon: "📡" },
    { name: "Space Heater (1500W)", voltage: 120, watts: 1500, icon: "🔥" },
    { name: "Window AC (1000W)", voltage: 120, watts: 1000, icon: "❄️" },
    { name: "Phone Charger (20W)", voltage: 120, watts: 20, icon: "📱" },
    { name: "Router/Modem (30W)", voltage: 120, watts: 30, icon: "📶" },
    { name: "Coffee Maker (900W)", voltage: 120, watts: 900, icon: "☕" },
    { name: "Toaster (850W)", voltage: 120, watts: 850, icon: "🍞" },
    { name: "Hair Dryer (1800W)", voltage: 120, watts: 1800, icon: "💨" },
    { name: "Well Pump (1000W)", voltage: 240, watts: 1000, icon: "💧" },
    { name: "EV Charger L2 (7200W)", voltage: 240, watts: 7200, icon: "🚗" },
    { name: "Central AC (3500W)", voltage: 240, watts: 3500, icon: "🏠" },
    { name: "Electric Dryer (5000W)", voltage: 240, watts: 5000, icon: "👕" },
    { name: "Hot Tub (4000W)", voltage: 240, watts: 4000, icon: "🛁" }
];

// Production appliance presets - these consume power to produce resources
const PRODUCER_PRESETS = [
    { name: "Water Heater", icon: "🚿", watts: 1500, voltage: 120, recipe: { output: "hot_water", rate: 10, unit: "gal/hr" }, tankSize: 50, cost: 400 },
    { name: "Ice Maker", icon: "🧊", watts: 200, voltage: 120, recipe: { output: "ice", rate: 2, unit: "lb/hr" }, tankSize: 20, cost: 250 },
    { name: "Dehumidifier", icon: "💧", watts: 500, voltage: 120, recipe: { output: "water", rate: 1.5, unit: "gal/hr" }, tankSize: 10, cost: 200 },
    { name: "Air Compressor", icon: "💨", watts: 1800, voltage: 120, recipe: { output: "compressed_air", rate: 5, unit: "CFM" }, tankSize: 30, cost: 350 },
    { name: "Well Pump", icon: "🔵", watts: 750, voltage: 240, recipe: { output: "water", rate: 8, unit: "gal/min" }, tankSize: 100, cost: 500 },
    { name: "Water Purifier", icon: "🔬", watts: 50, voltage: 120, recipe: { output: "pure_water", rate: 0.5, unit: "gal/hr", input: "water" }, tankSize: 5, cost: 300 },
    { name: "Freezer", icon: "❄️", watts: 100, voltage: 120, recipe: { output: "frozen_storage", rate: 0, unit: "cu ft", isStorage: true }, tankSize: 15, cost: 600 },
    { name: "Battery Charger", icon: "🔋", watts: 300, voltage: 120, recipe: { output: "charged_batteries", rate: 4, unit: "AA/hr" }, tankSize: 50, cost: 80 }
];

// Resource container presets - store produced resources
const CONTAINER_PRESETS = [
    { name: "Water Tank (50 gal)", resource: "water", capacity: 50, unit: "gal", icon: "🛢️", cost: 150 },
    { name: "Water Tank (100 gal)", resource: "water", capacity: 100, unit: "gal", icon: "🛢️", cost: 250 },
    { name: "Hot Water Tank (40 gal)", resource: "hot_water", capacity: 40, unit: "gal", icon: "🔥", cost: 200 },
    { name: "Ice Chest (30 lb)", resource: "ice", capacity: 30, unit: "lb", icon: "📦", cost: 50 },
    { name: "Air Tank (10 gal)", resource: "compressed_air", capacity: 10, unit: "gal", icon: "⚪", cost: 100 },
    { name: "Pure Water Jug (5 gal)", resource: "pure_water", capacity: 5, unit: "gal", icon: "💎", cost: 30 },
    { name: "Propane Tank (20 lb)", resource: "propane", capacity: 20, unit: "lb", icon: "🔴", cost: 40 }
];

// Resource types and their properties
const RESOURCE_TYPES = {
    water: { name: "Water", color: "#3498db", icon: "💧" },
    hot_water: { name: "Hot Water", color: "#e74c3c", icon: "🔥" },
    ice: { name: "Ice", color: "#ecf0f1", icon: "🧊" },
    compressed_air: { name: "Compressed Air", color: "#95a5a6", icon: "💨" },
    pure_water: { name: "Pure Water", color: "#00d4ff", icon: "💎" },
    frozen_storage: { name: "Frozen Storage", color: "#9b59b6", icon: "❄️" },
    charged_batteries: { name: "Charged Batteries", color: "#f39c12", icon: "🔋" },
    propane: { name: "Propane", color: "#e67e22", icon: "🔴" }
};

// Wire gauge ratings
const AWG_RATINGS = {
    // AWG: { maxAmps@120V, ohmsPerFoot, cost per foot }
    14: { amps: 15, ohms: 0.00253, cost: 0.50 },
    12: { amps: 20, ohms: 0.00159, cost: 0.75 },
    10: { amps: 30, ohms: 0.00100, cost: 1.20 },
    8: { amps: 40, ohms: 0.000628, cost: 2.00 },
    6: { amps: 55, ohms: 0.000395, cost: 3.50 },
    4: { amps: 70, ohms: 0.000249, cost: 5.00 },
    2: { amps: 95, ohms: 0.000157, cost: 7.50 },
    1: { amps: 110, ohms: 0.000124, cost: 10.00 },
    '1/0': { amps: 125, ohms: 0.000098, cost: 12.50 },
    '2/0': { amps: 145, ohms: 0.000078, cost: 15.00 }
};

// System review default settings
const SYSTEM_REVIEW_SETTINGS = {
    electricityRate: 0.12,  // $/kWh
    solarIncentive: 0.26,   // 26% federal tax credit
    avgDailySunHours: 5.5,  // hours of peak sun equivalent
    systemLifeYears: 25,    // typical solar panel lifespan
    degradationRate: 0.005  // 0.5% per year
};




