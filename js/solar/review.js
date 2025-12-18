// ============================================================================
// SYSTEM REVIEW - Analysis and optimization scoring
// ============================================================================

function createSystemReview(getAllItems, getConnections, getBOMSystem, getAutomations) {
    'use strict';
    
    return {
        // Default utility rates (user can customize)
        // Settings loaded from js/core/constants.js as SYSTEM_REVIEW_SETTINGS
        get settings() { return SYSTEM_REVIEW_SETTINGS; },
        
        // Analyze the entire system
        analyzeSystem() {
            const analysis = {
                components: this.analyzeComponents(),
                energy: this.analyzeEnergy(),
                optimization: this.calculateOptimizationScore(),
                financial: this.calculateFinancials(),
                warnings: [],
                recommendations: []
            };
            
            // Generate warnings and recommendations
            this.generateInsights(analysis);
            
            return analysis;
        },
        
        // Analyze component counts and configurations
        analyzeComponents() {
            const allItems = getAllItems();
            const connections = getConnections();
            
            const items = allItems;
            const panels = items.filter(i => i.type === 'panel');
            const batteries = items.filter(i => i.type === 'battery' || i.type === 'smartbattery');
            const controllers = items.filter(i => i.type === 'controller');
            const inverters = items.filter(i => i.type === 'inverter');
            const loads = items.filter(i => i.type === 'acload');
            const producers = items.filter(i => i.type === 'producer');
            
            const totalPanelWatts = panels.reduce((sum, p) => sum + (p.specs.wmp || 0), 0);
            const totalBatteryWh = batteries.reduce((sum, b) => {
                if (b.type === 'smartbattery') {
                    return sum + (b.specs.capacityWh || 0);
                }
                return sum + (b.specs.voltage || 0) * (b.specs.ah || 0);
            }, 0);
            const totalLoadWatts = loads.reduce((sum, l) => sum + (l.specs.watts || 0), 0);
            const totalProducerWatts = producers.reduce((sum, p) => sum + (p.specs.watts || 0), 0);
            const totalConsumption = totalLoadWatts + totalProducerWatts;
            
            return {
                panelCount: panels.length,
                batteryCount: batteries.length,
                controllerCount: controllers.length,
                inverterCount: inverters.length,
                loadCount: loads.length,
                producerCount: producers.length,
                totalPanelWatts,
                totalBatteryWh,
                totalBatteryKwh: totalBatteryWh / 1000,
                totalLoadWatts,
                totalProducerWatts,
                totalConsumption,
                connectionCount: connections.length
            };
        },
        
        // Analyze energy production and consumption
        analyzeEnergy() {
            const comp = this.analyzeComponents();
            const avgDailyProduction = (comp.totalPanelWatts / 1000) * this.settings.avgDailySunHours; // kWh/day
            const avgDailyConsumption = (comp.totalConsumption / 1000) * 24; // kWh/day assuming always on
            const avgMonthlyProduction = avgDailyProduction * 30;
            const avgYearlyProduction = avgDailyProduction * 365;
            
            const batteryAutonomy = comp.totalConsumption > 0 
                ? (comp.totalBatteryWh / comp.totalConsumption) // hours of autonomy
                : 0;
            
            const energyBalance = avgDailyProduction - avgDailyConsumption;
            const selfSufficiency = avgDailyConsumption > 0 
                ? Math.min(1, avgDailyProduction / avgDailyConsumption) * 100
                : 0;
            
            return {
                avgDailyProduction,      // kWh
                avgDailyConsumption,     // kWh
                avgMonthlyProduction,    // kWh
                avgYearlyProduction,     // kWh
                energyBalance,           // kWh/day
                selfSufficiency,         // percentage
                batteryAutonomy,         // hours
                peakSolarOutput: comp.totalPanelWatts / 1000 // kW
            };
        },
        
        // Calculate optimization score (0-100)
        calculateOptimizationScore() {
            const allItems = getAllItems();
            const connections = getConnections();
            const Automations = getAutomations();
            
            const comp = this.analyzeComponents();
            const energy = this.analyzeEnergy();
            let score = 0;
            const factors = [];
            
            // Factor 1: System completeness (0-25 points)
            let completeness = 0;
            if (comp.panelCount > 0) completeness += 8;
            if (comp.batteryCount > 0) completeness += 6;
            if (comp.controllerCount > 0) completeness += 6;
            if (comp.inverterCount > 0) completeness += 5;
            factors.push({ name: 'System Completeness', score: completeness, max: 25 });
            score += completeness;
            
            // Factor 2: Energy balance (0-25 points)
            let balance = 0;
            if (energy.selfSufficiency >= 100) {
                balance = 25;
            } else if (energy.selfSufficiency >= 80) {
                balance = 20;
            } else if (energy.selfSufficiency >= 60) {
                balance = 15;
            } else if (energy.selfSufficiency >= 40) {
                balance = 10;
            } else if (energy.selfSufficiency >= 20) {
                balance = 5;
            }
            factors.push({ name: 'Energy Self-Sufficiency', score: balance, max: 25 });
            score += balance;
            
            // Factor 3: Battery capacity (0-20 points)
            let batteryScore = 0;
            if (energy.batteryAutonomy >= 48) {
                batteryScore = 20; // 2+ days
            } else if (energy.batteryAutonomy >= 24) {
                batteryScore = 18; // 1+ day
            } else if (energy.batteryAutonomy >= 12) {
                batteryScore = 14; // 12+ hours
            } else if (energy.batteryAutonomy >= 6) {
                batteryScore = 10; // 6+ hours
            } else if (energy.batteryAutonomy >= 3) {
                batteryScore = 5; // 3+ hours
            }
            factors.push({ name: 'Battery Capacity', score: batteryScore, max: 20 });
            score += batteryScore;
            
            // Factor 4: Component efficiency (0-15 points)
            let efficiency = 0;
            // Check if we have modern high-efficiency panels (>350W)
            const highEffPanels = allItems.filter(i => i.type === 'panel' && (i.specs.wmp || 0) > 350).length;
            if (comp.panelCount > 0 && highEffPanels / comp.panelCount > 0.8) {
                efficiency += 8;
            } else if (comp.panelCount > 0 && highEffPanels / comp.panelCount > 0.5) {
                efficiency += 5;
            } else if (comp.panelCount > 0) {
                efficiency += 2;
            }
            // Check for smart batteries
            const smartBatteries = allItems.filter(i => i.type === 'smartbattery').length;
            if (smartBatteries > 0) efficiency += 7;
            factors.push({ name: 'Component Quality', score: efficiency, max: 15 });
            score += efficiency;
            
            // Factor 5: System integration (0-15 points)
            let integration = 0;
            if (comp.connectionCount > 0) integration += 5;
            if (connections.length >= comp.panelCount + comp.batteryCount) integration += 5;
            // Bonus for automations
            if (Automations.rules.length > 0) integration += 5;
            factors.push({ name: 'System Integration', score: integration, max: 15 });
            score += integration;
            
            return {
                totalScore: Math.round(score),
                maxScore: 100,
                grade: this.getGrade(score),
                factors
            };
        },
        
        // Get letter grade from score
        getGrade(score) {
            if (score >= 90) return { letter: 'A', color: '#5cb85c', label: 'Excellent' };
            if (score >= 80) return { letter: 'B', color: '#5bc0de', label: 'Good' };
            if (score >= 70) return { letter: 'C', color: '#f0ad4e', label: 'Fair' };
            if (score >= 60) return { letter: 'D', color: '#f0ad4e', label: 'Needs Work' };
            return { letter: 'F', color: '#d9534f', label: 'Incomplete' };
        },
        
        // Calculate financial metrics
        calculateFinancials() {
            const BOMSystem = getBOMSystem();
            const bom = BOMSystem.generateBOM();
            const energy = this.analyzeEnergy();
            
            const systemCost = bom.totalCost;
            const incentive = systemCost * this.settings.solarIncentive;
            const netCost = systemCost - incentive;
            
            // Annual savings from solar production
            const annualProduction = energy.avgYearlyProduction;
            const annualSavings = annualProduction * this.settings.electricityRate;
            
            // Simple payback period
            const simplePayback = netCost > 0 && annualSavings > 0 
                ? netCost / annualSavings 
                : 0;
            
            // 25-year lifetime value (accounting for degradation)
            let lifetimeValue = 0;
            for (let year = 1; year <= this.settings.systemLifeYears; year++) {
                const degradation = Math.pow(1 - this.settings.degradationRate, year - 1);
                const yearlyProduction = annualProduction * degradation;
                const yearlySavings = yearlyProduction * this.settings.electricityRate;
                lifetimeValue += yearlySavings;
            }
            
            const netProfit = lifetimeValue - netCost;
            const roi = netCost > 0 ? (netProfit / netCost) * 100 : 0;
            
            return {
                systemCost,
                incentive,
                netCost,
                annualProduction,
                annualSavings,
                simplePayback,
                lifetimeValue,
                netProfit,
                roi,
                breakEvenYear: simplePayback
            };
        },
        
        // Generate warnings and recommendations
        generateInsights(analysis) {
            const Automations = getAutomations();
            const comp = analysis.components;
            const energy = analysis.energy;
            const financial = analysis.financial;
            
            // Warnings
            if (comp.panelCount === 0) {
                analysis.warnings.push('⚠️ No solar panels in system');
            }
            if (comp.batteryCount === 0) {
                analysis.warnings.push('⚠️ No battery storage - system cannot store excess energy');
            }
            if (comp.controllerCount === 0 && comp.panelCount > 0) {
                analysis.warnings.push('⚠️ Solar panels require a charge controller');
            }
            if (comp.inverterCount === 0 && comp.loadCount > 0) {
                analysis.warnings.push('⚠️ AC loads require an inverter');
            }
            if (energy.selfSufficiency < 50) {
                analysis.warnings.push('⚠️ Solar production covers less than 50% of consumption');
            }
            if (energy.batteryAutonomy < 3) {
                analysis.warnings.push('⚠️ Low battery autonomy - less than 3 hours backup');
            }
            if (comp.connectionCount < comp.panelCount) {
                analysis.warnings.push('⚠️ Some components may not be connected');
            }
            
            // Recommendations
            if (energy.selfSufficiency > 100 && energy.selfSufficiency < 150) {
                analysis.recommendations.push('✅ Good energy balance - consider adding more loads or battery storage');
            }
            if (energy.selfSufficiency > 150) {
                analysis.recommendations.push('💡 Significant excess production - consider reducing panel count or adding more consumption');
            }
            if (energy.batteryAutonomy >= 6 && energy.batteryAutonomy < 24) {
                analysis.recommendations.push('✅ Adequate battery backup for typical use');
            }
            if (energy.batteryAutonomy >= 24) {
                analysis.recommendations.push('✅ Excellent battery capacity - multi-day autonomy');
            }
            if (financial.simplePayback > 0 && financial.simplePayback < 7) {
                analysis.recommendations.push('💰 Great payback period - system will pay for itself quickly');
            }
            if (financial.simplePayback >= 7 && financial.simplePayback <= 15) {
                analysis.recommendations.push('💰 Reasonable payback period for solar investment');
            }
            if (financial.simplePayback > 15) {
                analysis.recommendations.push('💡 Consider optimizing system cost or increasing production');
            }
            if (Automations.rules.length === 0) {
                analysis.recommendations.push('💡 Add automation rules to optimize energy usage');
            }
            if (comp.producerCount > 0 && comp.totalProducerWatts > comp.totalLoadWatts) {
                analysis.recommendations.push('🏭 Production appliances use more power than standard loads');
            }
        }
    };
}

