// ============================================================================
// BOM SYSTEM - Bill of Materials generation
// ============================================================================

function createBOMSystem(getAllItems, getConnections, getWireSystem) {
    'use strict';
    
    return {
        // Calculate complete bill of materials
        generateBOM() {
            const allItems = getAllItems();
            const connections = getConnections();
            const WireSystem = getWireSystem();
            
            const bom = {
                panels: [],
                batteries: [],
                controllers: [],
                distribution: [],
                loads: [],
                producers: [],
                containers: [],
                wiring: [],
                totalCost: 0
            };
            
            // Group items by type and specs
            allItems.forEach(item => {
                let bomItem = {
                    name: item.specs.name || item.type,
                    quantity: 1,
                    unitCost: item.specs.cost || 0,
                    totalCost: item.specs.cost || 0,
                    specs: {}
                };
                
                if (item.type === 'panel') {
                    bomItem.specs = {
                        power: `${item.specs.wmp}W`,
                        voltage: `${item.specs.vmp}V`,
                        current: `${item.specs.imp}A`
                    };
                    bom.panels.push(bomItem);
                } else if (item.type === 'battery' || item.type === 'smartbattery') {
                    bomItem.specs = {
                        voltage: `${item.specs.voltage}V`,
                        capacity: item.type === 'battery' ? `${item.specs.ah}Ah` : `${item.specs.kWh}kWh`
                    };
                    bom.batteries.push(bomItem);
                } else if (item.type === 'controller') {
                    bomItem.specs = {
                        type: item.subtype || 'MPPT',
                        maxPV: `${item.specs.maxWmp}W`,
                        maxVoc: `${item.specs.maxVoc}V`
                    };
                    bom.controllers.push(bomItem);
                } else if (item.type === 'breakerpanel' || item.type === 'spiderbox' || item.type === 'solarcombiner' || 
                          item.type === 'doublevoltagehub' || item.type === 'acbreaker' || item.type === 'dcbreaker' ||
                          item.type === 'combiner' || item.type === 'acoutlet') {
                    if (item.type === 'acbreaker' || item.type === 'dcbreaker') {
                        bomItem.specs = { rating: `${item.specs.rating}A` };
                    }
                    bom.distribution.push(bomItem);
                } else if (item.type === 'acload') {
                    bomItem.specs = {
                        power: `${item.specs.watts}W`,
                        voltage: `${item.specs.voltage}V`
                    };
                    bom.loads.push(bomItem);
                } else if (item.type === 'producer') {
                    bomItem.specs = {
                        power: `${item.specs.watts}W`,
                        output: item.specs.recipe.output
                    };
                    bom.producers.push(bomItem);
                } else if (item.type === 'container') {
                    bomItem.specs = {
                        capacity: `${item.specs.capacity} ${item.specs.unit}`,
                        resource: item.specs.resource
                    };
                    bom.containers.push(bomItem);
                }
            });
            
            // Calculate wiring requirements
            const wiringCosts = {};
            connections.forEach(conn => {
                const wireInfo = WireSystem.calculateGauge(conn, allItems);
                if (wireInfo) {
                    const key = `${wireInfo.gauge} AWG`;
                    if (!wiringCosts[key]) {
                        wiringCosts[key] = {
                            gauge: wireInfo.gauge,
                            totalFeet: 0,
                            unitCost: wireInfo.rating.cost,
                            connections: 0
                        };
                    }
                    wiringCosts[key].totalFeet += wireInfo.distance;
                    wiringCosts[key].connections++;
                }
            });
            
            // Add wiring to BOM
            Object.values(wiringCosts).forEach(wire => {
                bom.wiring.push({
                    name: `${wire.gauge} AWG Wire`,
                    quantity: Math.ceil(wire.totalFeet),
                    unitCost: wire.unitCost,
                    totalCost: Math.ceil(wire.totalFeet) * wire.unitCost,
                    specs: {
                        unit: 'feet',
                        connections: wire.connections
                    }
                });
            });
            
            // Consolidate duplicate items
            const consolidate = (items) => {
                const consolidated = {};
                items.forEach(item => {
                    const key = item.name;
                    if (consolidated[key]) {
                        consolidated[key].quantity++;
                        consolidated[key].totalCost += item.unitCost;
                    } else {
                        consolidated[key] = { ...item };
                    }
                });
                return Object.values(consolidated);
            };
            
            bom.panels = consolidate(bom.panels);
            bom.batteries = consolidate(bom.batteries);
            bom.controllers = consolidate(bom.controllers);
            bom.distribution = consolidate(bom.distribution);
            bom.loads = consolidate(bom.loads);
            bom.producers = consolidate(bom.producers);
            bom.containers = consolidate(bom.containers);
            
            // Calculate total cost
            const categories = [bom.panels, bom.batteries, bom.controllers, bom.distribution, 
                              bom.loads, bom.producers, bom.containers, bom.wiring];
            categories.forEach(cat => {
                cat.forEach(item => {
                    bom.totalCost += item.totalCost || 0;
                });
            });
            
            return bom;
        },
        
        // Export BOM as formatted text
        exportBOMText(bom) {
            let text = '=== BILL OF MATERIALS ===\n\n';
            
            const addSection = (title, items) => {
                if (items.length === 0) return;
                text += `${title}:\n`;
                items.forEach(item => {
                    text += `  ${item.quantity}× ${item.name} @ $${item.unitCost.toFixed(2)} = $${item.totalCost.toFixed(2)}\n`;
                    if (item.specs && Object.keys(item.specs).length > 0) {
                        const specsStr = Object.entries(item.specs).map(([k,v]) => `${k}: ${v}`).join(', ');
                        text += `      (${specsStr})\n`;
                    }
                });
                text += '\n';
            };
            
            addSection('SOLAR PANELS', bom.panels);
            addSection('BATTERIES & STORAGE', bom.batteries);
            addSection('CONTROLLERS & INVERTERS', bom.controllers);
            addSection('DISTRIBUTION & BREAKERS', bom.distribution);
            addSection('WIRING', bom.wiring);
            addSection('LOADS & APPLIANCES', bom.loads);
            addSection('PRODUCERS', bom.producers);
            addSection('RESOURCE CONTAINERS', bom.containers);
            
            text += `TOTAL COST: $${bom.totalCost.toFixed(2)}\n`;
            text += `\nGenerated: ${new Date().toLocaleString()}\n`;
            
            return text;
        }
    };
}

