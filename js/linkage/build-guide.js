// ============================================================================
// LINKAGE LAB - Build guide modal (BOM, PDF/CSV export, drill templates)
// Depends on global: state, buildLinkageGeometry, needsSplitVBolts, closestPointOnSegment3D, vMag, vSub, exportToJSON, showToast, unitConverter, formatNumber, jspdf
// ============================================================================
(function (g) {
    'use strict';

    function computeReciprocalDrillData(data) {
        const result = {
            hasReciprocal: false,
            topBeamLength: 0,
            rcpAnchorsOnH: [],
            rcpBeamLength: 0,
            rcpCrossPositions: [],
            rcpAnchorPos: 0
        };
        if (!data || !state.supportBeams || !state.supportBeams.enabled) return result;
        if (!state.supportBeams.parallelEnabled) return result;
        if (state.orientation === 'vertical') return result;
    
        const beams = data.beams || [];
        const bolts = data.bolts || [];
        const topBeams = beams.filter(b => b.stackType === 'horizontal-top');
        const rcpBeams = beams.filter(b => b.stackType === 'support-beam-reciprocal');
        const ringBolts = bolts.filter(b => b && b.boltType === 'rcp-ring');
        const crossBolts = bolts.filter(b => b && b.boltType === 'rcp-cross');
    
        if (topBeams.length === 0 || rcpBeams.length === 0) return result;
        result.hasReciprocal = true;
    
        // Tolerance for "this bolt is on this beam" — generous because the bolt
        // center sits at a crossing/closest-point on the H-beam, plus there's
        // some vertical offset between the H-beam center and the bolt depth.
        const ON_BEAM_TOL = 4.0; // inches
        const ON_BEAM_TOL_SQ = ON_BEAM_TOL * ON_BEAM_TOL;
    
        const dedupeNear = (positions, tol = 0.25) => {
            const sorted = positions.slice().sort((a, b) => a - b);
            const out = [];
            for (const p of sorted) {
                if (out.length === 0 || Math.abs(p - out[out.length - 1]) > tol) {
                    out.push(p);
                }
            }
            return out;
        };
    
        // ---- Top H-beam reciprocal anchor pattern ----
        // Each rcp-ring bolt is the closest point on a top H-beam to a reciprocal
        // beam's outer anchor. Assign every bolt within tolerance to the rep beam
        // (so beams that share rotational symmetry get the same drill pattern).
        const repTop = topBeams[0];
        const topLen = vMag(vSub(repTop.p2, repTop.p1));
        result.topBeamLength = topLen;
        if (topLen > 1e-3) {
            const anchorPositions = [];
            for (const rb of ringBolts) {
                if (!rb || !rb.center) continue;
                const { point, t } = closestPointOnSegment3D(rb.center, repTop.p1, repTop.p2);
                const dx = point.x - rb.center.x, dy = point.y - rb.center.y, dz = point.z - rb.center.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > ON_BEAM_TOL_SQ) continue;
                // Skip the segment-clamped end matches — those belong to neighboring beams
                if (t < 0.001 || t > 0.999) continue;
                anchorPositions.push(t * topLen);
            }
            result.rcpAnchorsOnH = dedupeNear(anchorPositions).map((pos, i) => ({
                pos, label: `R${i + 1}`
            }));
        }
    
        // ---- Reciprocal beam crossing-hole pattern ----
        // A cross bolt sits at the 3D intersection of two reciprocal beams, so it is
        // physically on BOTH of them. We list every cross bolt that is within
        // tolerance of the representative beam (with t ∈ (0,1) so we exclude bolts
        // clamped to the beam's endpoints, which belong to other beams).
        const repRcp = rcpBeams[0];
        const rcpLen = vMag(vSub(repRcp.p2, repRcp.p1));
        result.rcpBeamLength = rcpLen;
        if (rcpLen > 1e-3) {
            const crossPositions = [];
            for (const cb of crossBolts) {
                if (!cb || !cb.center) continue;
                const { point, t } = closestPointOnSegment3D(cb.center, repRcp.p1, repRcp.p2);
                const dx = point.x - cb.center.x, dy = point.y - cb.center.y, dz = point.z - cb.center.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 > ON_BEAM_TOL_SQ) continue;
                if (t < 0.001 || t > 0.999) continue;
                crossPositions.push(t * rcpLen);
            }
            result.rcpCrossPositions = dedupeNear(crossPositions).map((pos, i) => ({
                pos, label: `X${i + 1}`
            }));
    
            // Anchor (ring-bolt) hole on the reciprocal beam: rcp.p1 is the anchor
            // end. Find the ring bolt whose 3D position is closest to p1.
            let bestPos = 0, bestD2 = Infinity;
            for (const rb of ringBolts) {
                if (!rb || !rb.center) continue;
                const dx = rb.center.x - repRcp.p1.x;
                const dy = rb.center.y - repRcp.p1.y;
                const dz = rb.center.z - repRcp.p1.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    const { t } = closestPointOnSegment3D(rb.center, repRcp.p1, repRcp.p2);
                    bestPos = t * rcpLen;
                }
            }
            result.rcpAnchorPos = Math.max(0, bestPos);
        }
    
        return result;
    }
    
    /**
     * Shows the build guide as an HTML modal popup
     */
    function showBuildGuide() {
        const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
        
        // Calculate BOM
        const moduleCount = state.modules;
        const hBeams = moduleCount * 2 * state.hStackCount;
        const vBeams = moduleCount * state.vStackCount;
        const uBrackets = moduleCount * 4;
        
        // Calculate bolt counts by type
        const splitBolts = needsSplitVBolts();
        const vBoltsInner = moduleCount * 2;  // 2 inner bolts per module (bot-inner, top-inner)
        const vBoltsOuter = moduleCount * 2;  // 2 outer bolts per module (bot-outer, top-outer)
        const vBoltsCenter = moduleCount * 1; // 1 center bolt per module
        const hCenterBolts = moduleCount * 2; // 2 H-center bolts per module
        const hPivotBolts = moduleCount * 4;  // 4 H-pivot bolts per module
        const totalVBolts = vBoltsInner + vBoltsOuter + vBoltsCenter;
        const totalHBolts = hCenterBolts + hPivotBolts;
        const nBolts = totalVBolts + totalHBolts;
        
        // Get bolt costs based on mode
        let costBoltVInner, costBoltVOuter, costBoltH, costHPivot;
        if (splitBolts) {
            costBoltVInner = state.costBoltVInner || 0.75;
            costBoltVOuter = state.costBoltVOuter || 0.50;
            costBoltH = state.costBoltH || 0.75;
            costHPivot = state.costBoltHPivot || 0.75;
        } else {
            const vBoltPrice = parseFloat(document.getElementById('nb-cost-bolt-v')?.value) || 0.75;
            costBoltVInner = vBoltPrice;
            costBoltVOuter = vBoltPrice;
            costBoltH = parseFloat(document.getElementById('nb-cost-bolt-h')?.value) || 0.75;
            costHPivot = state.costBoltHPivot || 0.75;
        }
        
        const hBeamsCost = hBeams * state.costHBeam;
        const vBeamsCost = calculateVBeamsCost();
        const bracketCost = uBrackets * state.costBracket;
        
        // Calculate bolt costs by type
        const vBoltInnerCost = vBoltsInner * costBoltVInner;
        const vBoltOuterCost = vBoltsOuter * costBoltVOuter;
        const vBoltCenterCost = vBoltsCenter * costBoltVInner; // Center bolts use full/inner price
        const hCenterBoltCost = hCenterBolts * costBoltH;
        const hPivotBoltCost = hPivotBolts * costHPivot;
        const boltCost = vBoltInnerCost + vBoltOuterCost + vBoltCenterCost + hCenterBoltCost + hPivotBoltCost;
        
        // Calculate washer costs
        const vWashersPerBolt2 = state.vStackCount > 1 ? (state.vStackCount - 1) : 0;
        const vWasherCount2 = state.vWasherEnabled ? (totalVBolts * vWashersPerBolt2) : 0;
        const hWashersPerBolt2 = state.hStackCount > 1 ? (state.hStackCount - 1) : 0;
        const hWasherCount2 = state.hWasherEnabled ? (totalHBolts * hWashersPerBolt2) : 0;
        const costWasherV2 = state.costWasherV || 0.10;
        const costWasherH2 = state.costWasherH || 0.10;
        const vWasherCost2 = vWasherCount2 * costWasherV2;
        const hWasherCost2 = hWasherCount2 * costWasherH2;
        const washerCost2 = vWasherCost2 + hWasherCost2;
    
        const sbForGuide = computeSupportBomContribution(moduleCount, costBoltVInner);
        
        // Solar panel calculations - get active panel config first
        const solarEnabled = state.solarPanels.enabled;
        const panelConfig = getActivePanelConfig();
        const solarPanelCount = solarEnabled && data.panels ? data.panels.length : 0;
        const solarPanelCost = solarPanelCount * state.costSolarPanel;
        const totalWatts = solarPanelCount * (panelConfig.ratedWatts || 0);
        const totalKw = totalWatts / 1000;
        
        const structureCost = hBeamsCost + vBeamsCost + boltCost + bracketCost + washerCost2 + sbForGuide.supportBeamCost;
        const totalCost = structureCost + solarPanelCost;
        
        // Calculate weight (lbs) based on volume and density
        // Volume = width × thickness × length (all in inches)
        // Weight = volume × density
        const hBeamWeightPerFoot = (state.hBeamW * state.hBeamT * INCHES_PER_FOOT) * state.woodDensity; // cubic inches × lbs/in³
        const hBeamWeight = hBeams * state.hLengthFt * hBeamWeightPerFoot;
        const vBeamWeight = calculateVBeamTotalWeight();
        const bracketWeight = uBrackets * state.weightBracket;
        const boltWeight = nBolts * state.weightBolt;
        const structureWeight = hBeamWeight + vBeamWeight + bracketWeight + boltWeight + sbForGuide.supportBeamWeight;
        
        // Calculate solar panel weight
        const solarWeightSummary = getSolarPanelWeightSummary(data);
        const solarPanelWeight = solarEnabled && solarPanelCount > 0 ? solarWeightSummary.total : 0;
        const totalWeight = structureWeight + solarPanelWeight;
        
        // Calculate dimensions (used throughout build guide)
        const heightFt = unitConverter.inchesToFeet(data.maxHeight);
        const diameterFt = unitConverter.inchesToFeet(data.maxRad * 2);
        const guideIsMetric = unitConverter.getPreferredUnitSystem() === 'metric';
        const gDimFactor = guideIsMetric ? unitConverter.IN_TO_MM : 1;
        const gDimUnit = guideIsMetric ? 'mm' : '"';
        const gLenFactor = guideIsMetric ? unitConverter.FT_TO_M : 1;
        const gLenUnit = guideIsMetric ? 'm' : "'";
        const gWtUnit = guideIsMetric ? 'kg' : 'lbs';
        const gWtFactor = guideIsMetric ? unitConverter.LBS_TO_KG : 1;
        const gD = (v, d) => formatNumber(v * gDimFactor, d === undefined ? 2 : d) + gDimUnit;
        const gL = (v, d) => formatNumber(v * gLenFactor, d === undefined ? 2 : d) + gLenUnit;
        const gW = (v, d) => formatNumber(v * gWtFactor, d === undefined ? 1 : d) + ' ' + gWtUnit;
        const gBoltDia = (d) => guideIsMetric ? formatNumber(d * unitConverter.IN_TO_MM, 1) + 'mm' : formatBoltDiameter(d) + '"';
        const actuatorInfo = calculateActuatorStroke();
        
        // Drill hole calculations
        const hTotIn = state.hLengthFt * INCHES_PER_FOOT;
        const hActiveIn = hTotIn - state.offsetTopIn - state.offsetBotIn;
        const pivotRatio = state.pivotPct / 100;
        const pivotDistFromBottom = state.offsetBotIn + (hActiveIn * pivotRatio);
        
        const vTotIn = state.vLengthFt * INCHES_PER_FOOT;
        // Vertical beam hole positions based on end offset
        // The beams extend vertEndOffset beyond each pivot point, so:
        // - BOT pivot is vertEndOffset from the bottom of the beam
        // - TOP pivot is vertEndOffset from the top of the beam
        // - CTR pivot is at the center where the two scissor beams cross
        const vEndOffset = state.vertEndOffset || 1.5;
        // BOT hole: vertEndOffset from bottom end
        const vBottomPivot = vEndOffset;
        // TOP hole: vertEndOffset from top end  
        const vTopPivot = vTotIn - vEndOffset;
        // CTR hole: midpoint between BOT and TOP pivots (center of the active beam span)
        const vCenterPivot = (vBottomPivot + vTopPivot) / 2;
        
        // Reciprocal drill data (top-ring anchor positions + reciprocal beam crossings)
        const rcpDrill = computeReciprocalDrillData(data);
        const rcpBeamLenIn = rcpDrill.rcpBeamLength || 0;
    
        // Calculate proportional beam widths (scale to same reference)
        const maxBeamLength = Math.max(hTotIn, vTotIn, rcpBeamLenIn);
        const hBeamWidthPct = (hTotIn / maxBeamLength) * 100;
        const vBeamWidthPct = (vTotIn / maxBeamLength) * 100;
        const rcpBeamWidthPct = rcpBeamLenIn > 0 ? (rcpBeamLenIn / maxBeamLength) * 100 : 0;
        // Calculate margins to center the shorter beam
        const hBeamMargin = (100 - hBeamWidthPct) / 2;
        const vBeamMargin = (100 - vBeamWidthPct) / 2;
        const rcpBeamMargin = rcpBeamLenIn > 0 ? (100 - rcpBeamWidthPct) / 2 : 0;
    
        let supportBOMGuideRows = '';
        if (sbForGuide.supportBeamCost > 0) {
            const radialRow = sbForGuide.structureItems[0];
            const sidebarBolt = splitBolts ? 'nb-cost-bolt-vinner' : 'nb-cost-bolt-v';
            let idx = 1;
            let recipRow = null;
            if (sbForGuide.structureItems[idx] && sbForGuide.structureItems[idx].item.startsWith('Reciprocal')) {
                recipRow = sbForGuide.structureItems[idx];
                idx++;
            }
            const boltSb = sbForGuide.structureItems[idx++];
            const boltThru = sbForGuide.structureItems[idx++];
            const washRow = sbForGuide.structureItems[idx];
            const combBoltQty = boltSb.qty + boltThru.qty;
            const combBoltTotal = boltSb.total + boltThru.total;
    
            supportBOMGuideRows = `
                                <tr data-bom-section="structure">
                                    <td class="qty">${radialRow.qty}×</td>
                                    <td class="item">${radialRow.item}</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costHBeam" data-bom-qty="${radialRow.qty}" data-bom-sidebar="nb-cost-hbeam" value="${formatNumber(state.costHBeam, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(radialRow.total, 2)}</td>
                                </tr>`;
            if (recipRow) {
                supportBOMGuideRows += `
                                <tr data-bom-section="structure">
                                    <td class="qty">${recipRow.qty}×</td>
                                    <td class="item">${recipRow.item}</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costVBeam" data-bom-qty="${recipRow.qty}" data-bom-sidebar="nb-cost-vbeam" value="${formatNumber(state.costVBeam, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(recipRow.total, 2)}</td>
                                </tr>`;
            }
            supportBOMGuideRows += `
                                <tr data-bom-section="structure">
                                    <td class="qty">${combBoltQty}×</td>
                                    <td class="item">Radial support + through bolts</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costBoltVInner" data-bom-qty="${combBoltQty}" data-bom-sidebar="${sidebarBolt}" value="${formatNumber(costBoltVInner, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(combBoltTotal, 2)}</td>
                                </tr>
                                <tr data-bom-section="structure">
                                    <td class="qty">${washRow.qty}×</td>
                                    <td class="item">${washRow.item}</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costWasherV" data-bom-qty="${washRow.qty}" data-bom-sidebar="nb-cost-washer-v" value="${formatNumber(costWasherV2, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(washRow.total, 2)}</td>
                                </tr>`;
        }
        
        // Build the HTML content
        const solarStatsHtml = solarEnabled ? `
                <div class="guide-stat">
                    <span class="guide-stat-label">Solar Panels</span>
                    <span class="guide-stat-value">${solarPanelCount}</span>
                </div>
                <div class="guide-stat">
                    <span class="guide-stat-label">Array Capacity</span>
                    <span class="guide-stat-value" style="color: #f39c12;">${formatNumber(totalKw, 2)} kW</span>
                </div>` : '';
        
        const content = `
            <div class="guide-stats-bar">
                <div class="guide-stat">
                    <span class="guide-stat-label">Height</span>
                    <span class="guide-stat-value">${unitConverter.formatInchesAsLargeUnit(data.maxHeight, 1)}</span>
                </div>
                <div class="guide-stat">
                    <span class="guide-stat-label">Diameter</span>
                    <span class="guide-stat-value">${unitConverter.formatInchesAsLargeUnit(data.maxRad * 2, 1)}</span>
                </div>
                <div class="guide-stat">
                    <span class="guide-stat-label">Modules</span>
                    <span class="guide-stat-value">${moduleCount}</span>
                </div>
                <div class="guide-stat">
                    <span class="guide-stat-label">Fold Angle</span>
                    <span class="guide-stat-value">${formatNumber(radToDeg(state.foldAngle), 1)}°</span>
                </div>
                <div class="guide-stat">
                    <span class="guide-stat-label">Actuator Stroke</span>
                    <span class="guide-stat-value">${unitConverter.formatDimensionWithUnit(actuatorInfo.stroke, 2)}</span>
                </div>
                ${solarStatsHtml}
                <div class="guide-stat">
                    <span class="guide-stat-label">Est. Total</span>
                    <span class="guide-stat-value highlight" id="guide-stat-total">$${formatNumber(totalCost, 2)}</span>
                </div>
                <div class="guide-stat">
                    <span class="guide-stat-label">Total Weight</span>
                    <span class="guide-stat-value highlight" style="color: #3498db;">${unitConverter.formatWeightWithUnit(totalWeight)}</span>
                </div>
            </div>
            
            <div class="guide-views-row">
                <div class="guide-view-card">
                    <div class="guide-view-label">TOP VIEW</div>
                    <canvas id="guide-canvas-top" width="400" height="300"></canvas>
                </div>
                <div class="guide-view-card">
                    <div class="guide-view-label">SIDE VIEW</div>
                    <canvas id="guide-canvas-side" width="400" height="300"></canvas>
                </div>
                <div class="guide-view-card">
                    <div class="guide-view-label">3D PERSPECTIVE</div>
                    <canvas id="guide-canvas-3d" width="400" height="300"></canvas>
                </div>
            </div>
            
            <div class="guide-grid">
                <div class="guide-card">
                    <div class="guide-card-header">Bill of Materials</div>
                    <div class="guide-card-content">
                        <table class="guide-table" id="guide-bom-table">
                            <thead>
                                <tr>
                                    <th>Qty</th>
                                    <th>Item</th>
                                    <th>Unit Price</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr class="guide-bom-section-row"><td colspan="4">STRUCTURE</td></tr>
                                <tr data-bom-section="structure">
                                    <td class="qty">${hBeams}×</td>
                                    <td class="item">H-Beams (${unitConverter.formatBeamSpecForCost(state.hLengthFt, state.hBeamW, state.hBeamT)})</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costHBeam" data-bom-qty="${hBeams}" data-bom-sidebar="nb-cost-hbeam" value="${formatNumber(state.costHBeam, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(hBeamsCost, 2)}</td>
                                </tr>
                                <tr data-bom-section="structure">
                                    <td class="qty">${vBeams}×</td>
                                    <td class="item">V-Beams (${unitConverter.formatBeamSpecForCost(state.vLengthFt, state.vBeamW, state.vBeamT)})</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costVBeam" data-bom-qty="${vBeams}" data-bom-sidebar="nb-cost-vbeam" value="${formatNumber(state.costVBeam, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(vBeamsCost, 2)}</td>
                                </tr>
                                <tr data-bom-section="structure">
                                    <td class="qty">${uBrackets}×</td>
                                    <td class="item">U-Brackets</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costBracket" data-bom-qty="${uBrackets}" data-bom-sidebar="nb-cost-brack" value="${formatNumber(state.costBracket, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(bracketCost, 2)}</td>
                                </tr>
                                ${splitBolts ? `
                                <tr data-bom-section="structure">
                                    <td class="qty">${vBoltsInner}×</td>
                                    <td class="item">Inner Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltInnerLength)}</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costBoltVInner" data-bom-qty="${vBoltsInner}" data-bom-sidebar="nb-cost-bolt-vinner" value="${formatNumber(costBoltVInner, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(vBoltInnerCost, 2)}</td>
                                </tr>
                                <tr data-bom-section="structure">
                                    <td class="qty">${vBoltsOuter}×</td>
                                    <td class="item">Outer Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltOuterLength)}</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costBoltVOuter" data-bom-qty="${vBoltsOuter}" data-bom-sidebar="nb-cost-bolt-vouter" value="${formatNumber(costBoltVOuter, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(vBoltOuterCost, 2)}</td>
                                </tr>
                                <tr data-bom-section="structure" id="guide-bom-row-vcenter" data-bom-qty="${vBoltsCenter}">
                                    <td class="qty">${vBoltsCenter}×</td>
                                    <td class="item">Center Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltLength)}</td>
                                    <td class="price" style="text-align:right; color:#666; font-size:0.85rem; padding-right:10px;">$${formatNumber(costBoltVInner, 2)}</td>
                                    <td class="total">$${formatNumber(vBoltCenterCost, 2)}</td>
                                </tr>
                                ` : `
                                <tr data-bom-section="structure">
                                    <td class="qty">${totalVBolts}×</td>
                                    <td class="item">V-Stack Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltLength)}</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costBoltVInner" data-bom-qty="${totalVBolts}" data-bom-sidebar="nb-cost-bolt-v" value="${formatNumber(costBoltVInner, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(vBoltInnerCost + vBoltOuterCost + vBoltCenterCost, 2)}</td>
                                </tr>
                                `}
                                <tr data-bom-section="structure">
                                    <td class="qty">${hCenterBolts}×</td>
                                    <td class="item">H-Center Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.hBoltLength)}</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costBoltH" data-bom-qty="${hCenterBolts}" data-bom-sidebar="${splitBolts ? 'nb-cost-bolt-h2' : 'nb-cost-bolt-h'}" value="${formatNumber(costBoltH, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(hCenterBoltCost, 2)}</td>
                                </tr>
                                <tr data-bom-section="structure">
                                    <td class="qty">${hPivotBolts}×</td>
                                    <td class="item">H-Pivot Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.hPivotBoltLength)}</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costBoltHPivot" data-bom-qty="${hPivotBolts}" data-bom-sidebar="${splitBolts ? 'nb-cost-bolt-hpivot2' : 'nb-cost-bolt-hpivot'}" value="${formatNumber(costHPivot, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(hPivotBoltCost, 2)}</td>
                                </tr>
                                ${vWasherCount2 > 0 ? `
                                <tr data-bom-section="structure">
                                    <td class="qty">${vWasherCount2}×</td>
                                    <td class="item">V-Stack Washers (ID: ${gD(state.vWasherID)}, OD: ${gD(state.vWasherOD)}, T: ${gD(state.vWasherThickness)})</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costWasherV" data-bom-qty="${vWasherCount2}" data-bom-sidebar="nb-cost-washer-v" value="${formatNumber(costWasherV2, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(vWasherCost2, 2)}</td>
                                </tr>
                                ` : ''}
                                ${hWasherCount2 > 0 ? `
                                <tr data-bom-section="structure">
                                    <td class="qty">${hWasherCount2}×</td>
                                    <td class="item">H-Stack Washers (ID: ${formatNumber(state.hWasherID * gDimFactor, guideIsMetric ? 1 : 2)}${gDimUnit}, OD: ${formatNumber(state.hWasherOD * gDimFactor, guideIsMetric ? 1 : 2)}${gDimUnit}, T: ${formatNumber(state.hWasherThickness * gDimFactor, guideIsMetric ? 1 : 2)}${gDimUnit})</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costWasherH" data-bom-qty="${hWasherCount2}" data-bom-sidebar="nb-cost-washer-h" value="${formatNumber(costWasherH2, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(hWasherCost2, 2)}</td>
                                </tr>
                                ` : ''}
                                ${supportBOMGuideRows}
                                <tr class="guide-bom-subtotal-row"><td colspan="2"></td><td style="text-align:right; font-weight:600; font-size:0.8rem;">Subtotal</td><td class="total" id="guide-bom-subtotal-structure" style="font-weight:700;">$${formatNumber(structureCost, 2)}</td></tr>
                                ${solarEnabled ? `
                                <tr class="guide-bom-section-row"><td colspan="4">POWER</td></tr>
                                <tr data-bom-section="power">
                                    <td class="qty">${solarPanelCount}×</td>
                                    <td class="item">Solar Panels (${panelConfig.ratedWatts || 0}W)</td>
                                    <td class="price"><input type="number" class="guide-price-input" data-bom-state="costSolarPanel" data-bom-qty="${solarPanelCount}" data-bom-sidebar="nb-cost-solar" value="${formatNumber(state.costSolarPanel, 2)}" step="0.01" min="0" oninput="recalcGuideBOM()"></td>
                                    <td class="total">$${formatNumber(solarPanelCost, 2)}</td>
                                </tr>
                                <tr class="guide-bom-subtotal-row"><td colspan="2"></td><td style="text-align:right; font-weight:600; font-size:0.8rem;">Subtotal</td><td class="total" id="guide-bom-subtotal-power" style="font-weight:700;">$${formatNumber(solarPanelCost, 2)}</td></tr>
                                ` : ''}
                            </tbody>
                        </table>
                        <div class="guide-total-row">
                            <span class="guide-total-label">Estimated Total</span>
                            <span class="guide-total-value" id="guide-bom-grand-total">$${formatNumber(totalCost, 2)}</span>
                        </div>
                        <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e0e0e0;">
                            <div style="font-weight: 600; color: #2c3e50; margin-bottom: 8px; font-size: 0.9rem;">Weight Breakdown</div>
                            <div style="display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-size: 0.85rem; color: #555;">
                                <span>Horizontal Beams</span>
                                <span style="text-align: right;">${unitConverter.formatWeightWithUnit(hBeamWeight)}</span>
                                <span>Vertical Beams</span>
                                <span style="text-align: right;">${unitConverter.formatWeightWithUnit(vBeamWeight)}</span>
                                <span>Brackets</span>
                                <span style="text-align: right;">${unitConverter.formatWeightWithUnit(bracketWeight)}</span>
                                ${sbForGuide.supportBeamWeight > 0 ? `
                                <span>Support beams &amp; hardware</span>
                                <span style="text-align: right;">${unitConverter.formatWeightWithUnit(sbForGuide.supportBeamWeight)}</span>
                                ` : ''}
                                ${solarEnabled && solarPanelWeight > 0 ? `
                                <span>Solar Panels</span>
                                <span style="text-align: right;">${unitConverter.formatWeightWithUnit(solarPanelWeight)}</span>
                                ` : ''}
                                <div style="grid-column: span 2; margin-top: 8px; padding-top: 8px; border-top: 1px solid #ddd; display: flex; justify-content: space-between; font-weight: 600; color: #3498db;">
                                    <span>Total Weight</span>
                                    <span>${unitConverter.formatWeightWithUnit(totalWeight)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="guide-card">
                    <div class="guide-card-header">Beam Specifications</div>
                    <div class="guide-card-content">
                        <div class="guide-subsection">
                            <div class="guide-subsection-title">Horizontal Beams</div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Dimensions</span>
                                <span class="guide-spec-value">${gD(state.hBeamW)} × ${gD(state.hBeamT)} × ${gD(state.hLengthFt * 12)}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Stack Count</span>
                                <span class="guide-spec-value">${state.hStackCount}</span>
                            </div>
                        </div>
                        <div class="guide-subsection">
                            <div class="guide-subsection-title">Vertical Beams</div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Dimensions</span>
                                <span class="guide-spec-value">${!getVBeamCountsByType().linked
                                    ? `Inner ${gD(state.vBeamInnerW)} × ${gD(state.vBeamInnerT)} / Outer ${gD(state.vBeamOuterW)} × ${gD(state.vBeamOuterT)} × ${gD(state.vLengthFt * 12)}`
                                    : `${gD(state.vBeamW)} × ${gD(state.vBeamT)} × ${gD(state.vLengthFt * 12)}`}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Stack Count</span>
                                <span class="guide-spec-value">${state.vStackCount}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">H-Stack Gap</span>
                                <span class="guide-spec-value">${gD(state.hStackGap)}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">V-Stack Gap</span>
                                <span class="guide-spec-value">${gD(state.vStackGap)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="guide-card">
                    <div class="guide-card-header">Hardware</div>
                    <div class="guide-card-content">
                        <div class="guide-subsection">
                            <div class="guide-subsection-title">Bolts</div>
                            <table class="guide-table guide-hw-table">
                                <thead>
                                    <tr>
                                        <th style="width: 50px;">Qty</th>
                                        <th>Type</th>
                                        <th style="width: 70px;">Diameter</th>
                                        <th style="width: 70px;">Length</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${splitBolts ? `
                                    <tr><td class="qty">${vBoltsInner}×</td><td>Inner Bolts</td><td style="text-align:center">${gBoltDia(state.boltDiameter)}</td><td style="text-align:right; font-weight:600">${gD(state.vBoltInnerLength)}</td></tr>
                                    <tr><td class="qty">${vBoltsOuter}×</td><td>Outer Bolts</td><td style="text-align:center">${gBoltDia(state.boltDiameter)}</td><td style="text-align:right; font-weight:600">${gD(state.vBoltOuterLength)}</td></tr>
                                    <tr><td class="qty">${vBoltsCenter}×</td><td>Center Bolts</td><td style="text-align:center">${gBoltDia(state.boltDiameter)}</td><td style="text-align:right; font-weight:600">${gD(state.vBoltLength)}</td></tr>
                                    ` : `
                                    <tr><td class="qty">${totalVBolts}×</td><td>V-Stack Bolts</td><td style="text-align:center">${gBoltDia(state.boltDiameter)}</td><td style="text-align:right; font-weight:600">${gD(state.vBoltLength)}</td></tr>
                                    `}
                                    <tr><td class="qty">${hCenterBolts}×</td><td>H-Center Bolts</td><td style="text-align:center">${gBoltDia(state.boltDiameter)}</td><td style="text-align:right; font-weight:600">${gD(state.hBoltLength)}</td></tr>
                                    <tr><td class="qty">${hPivotBolts}×</td><td>H-Pivot Bolts</td><td style="text-align:center">${gBoltDia(state.boltDiameter)}</td><td style="text-align:right; font-weight:600">${gD(state.hPivotBoltLength)}</td></tr>
                                    <tr style="border-top: 2px solid #d4c4a8;"><td colspan="3" style="text-align:right; font-weight:700; padding-top:8px;">Total Bolts</td><td style="text-align:right; font-weight:700; padding-top:8px;">${nBolts}</td></tr>
                                </tbody>
                            </table>
                            ${vWasherCount2 > 0 || hWasherCount2 > 0 ? `
                            <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed #d4c4a8;">
                                <div class="guide-subsection-title" style="font-size: 0.75rem;">Washers</div>
                                ${vWasherCount2 > 0 ? `<div class="guide-spec-row"><span class="guide-spec-label">V-Stack Washers</span><span class="guide-spec-value">${vWasherCount2}× (ID: ${gD(state.vWasherID)}, OD: ${gD(state.vWasherOD)}, T: ${gD(state.vWasherThickness)})</span></div>` : ''}
                                ${hWasherCount2 > 0 ? `<div class="guide-spec-row"><span class="guide-spec-label">H-Stack Washers</span><span class="guide-spec-value">${hWasherCount2}× (ID: ${gD(state.hWasherID)}, OD: ${gD(state.hWasherOD)}, T: ${gD(state.hWasherThickness)})</span></div>` : ''}
                            </div>
                            ` : ''}
                        </div>
                        <div class="guide-subsection">
                            <div class="guide-subsection-title">Brackets (U-Shape)</div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Total Brackets</span>
                                <span class="guide-spec-value">${uBrackets}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Width</span>
                                <span class="guide-spec-value">${gD(state.bracketWidth || 2.0)}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Depth</span>
                                <span class="guide-spec-value">${gD(state.bracketDepth || 3.0)}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Height (Set)</span>
                                <span class="guide-spec-value">${gD(state.bracketHeight || 3.0)}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Wall Thickness</span>
                                <span class="guide-spec-value">${gD(state.bracketWallThickness || 0.25)}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Inner Width</span>
                                <span class="guide-spec-value">${gD(state.bracketInnerWidth || 1.5)}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Hole Diameter</span>
                                <span class="guide-spec-value">${gBoltDia(state.bracketHoleDiameter || 0.375)}</span>
                            </div>
                            <div class="guide-spec-row">
                                <span class="guide-spec-label">Hole Position (from base)</span>
                                <span class="guide-spec-value">${gD(state.bracketHoleDistance || 1.5)}</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="guide-card">
                    <div class="guide-card-header">Structure Parameters</div>
                    <div class="guide-card-content">
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Modules</span>
                            <span class="guide-spec-value">${state.modules}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Fold Angle</span>
                            <span class="guide-spec-value">${formatNumber(radToDeg(state.foldAngle), 1)}°</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Pivot Position</span>
                            <span class="guide-spec-value">${formatNumber(state.pivotPct, 1)}%</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Hoberman Angle</span>
                            <span class="guide-spec-value">${formatNumber(state.hobermanAng, 1)}°</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Pivot Angle</span>
                            <span class="guide-spec-value">${formatNumber(state.pivotAng, 1)}°</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Bracket Height</span>
                            <span class="guide-spec-value">${gD(state.bracketHeight)}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Top Extension</span>
                            <span class="guide-spec-value">${gD(state.offsetTopIn)}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Bottom Extension</span>
                            <span class="guide-spec-value">${gD(state.offsetBotIn)}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">V-Beam End Offset</span>
                            <span class="guide-spec-value">${gD(state.vertEndOffset)}</span>
                        </div>
                    </div>
                </div>
                
                ${solarEnabled ? `<div class="guide-card">
                    <div class="guide-card-header">Solar Panel Specifications</div>
                    <div class="guide-card-content">
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Panel Count</span>
                            <span class="guide-spec-value">${solarPanelCount}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Dimensions</span>
                            <span class="guide-spec-value">${gD(panelConfig.panelLength || 0, 1)} × ${gD(panelConfig.panelWidth || 0, 1)} × ${gD(panelConfig.panelThickness || 0, 2)}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Rated Power (Wmp)</span>
                            <span class="guide-spec-value">${panelConfig.ratedWatts || 0} W</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Weight (each)</span>
                            <span class="guide-spec-value">${gW(solarWeightSummary.perUnit, 1)}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Array Weight</span>
                            <span class="guide-spec-value">${gW(solarPanelWeight, 1)}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">VOC</span>
                            <span class="guide-spec-value">${formatNumber(panelConfig.voc || 0, 1)} V</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">VMP</span>
                            <span class="guide-spec-value">${formatNumber(panelConfig.vmp || 0, 1)} V</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">ISC</span>
                            <span class="guide-spec-value">${formatNumber(panelConfig.isc || 0, 2)} A</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">IMP</span>
                            <span class="guide-spec-value">${formatNumber(panelConfig.imp || 0, 2)} A</span>
                        </div>
                        <div class="guide-spec-row" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid #e0d8cc;">
                            <span class="guide-spec-label" style="font-weight: 600;">Total Array Capacity</span>
                            <span class="guide-spec-value" style="color: #f39c12; font-size: 1.1rem;">${formatNumber(totalKw, 2)} kW</span>
                        </div>
                    </div>
                </div>` : ''}
            </div>
            
            ${rcpDrill.hasReciprocal && rcpDrill.rcpAnchorsOnH.length > 0 ? `
            <div class="guide-beam-diagram">
                <div class="guide-beam-title">Top Ring H-Beam Drill Template — with Reciprocal Anchors (${gL(state.hLengthFt)})</div>
                <div class="guide-beam-visual">
                    <div class="guide-beam-dimension" style="left: ${hBeamMargin}%; right: ${hBeamMargin}%;">
                        <span class="guide-beam-dimension-label">${gD(hTotIn, 1)} (${gL(state.hLengthFt)})</span>
                    </div>
                    <div class="guide-beam-bar" style="left: ${hBeamMargin}%; right: ${hBeamMargin}%;">
                        <div class="guide-beam-hole" style="left: ${(state.offsetBotIn / hTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">BOT</div>
                                <div class="guide-beam-label-value">${gD(state.offsetBotIn, 1)}</div>
                            </div>
                        </div>
                        <div class="guide-beam-hole" style="left: ${(pivotDistFromBottom / hTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">CTR</div>
                                <div class="guide-beam-label-value">${gD(pivotDistFromBottom, 1)}</div>
                            </div>
                        </div>
                        <div class="guide-beam-hole" style="left: ${((hTotIn - state.offsetTopIn) / hTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">TOP</div>
                                <div class="guide-beam-label-value">${gD(hTotIn - state.offsetTopIn, 1)}</div>
                            </div>
                        </div>
                        ${rcpDrill.rcpAnchorsOnH.map(h => `
                        <div class="guide-beam-hole" style="left: ${(h.pos / hTotIn) * 100}%; background: radial-gradient(circle at 40% 40%, #4488ff 0%, #2255cc 50%, #113377 100%);">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name" style="color:#1a4ea0;">${h.label}</div>
                                <div class="guide-beam-label-value">${gD(h.pos, 1)}</div>
                            </div>
                        </div>`).join('')}
                    </div>
                </div>
                <div style="margin-top:8px; font-size:0.8rem; color:#555; padding:0 ${hBeamMargin}%;">
                    <strong style="color:#1a4ea0;">Blue holes (R1…R${rcpDrill.rcpAnchorsOnH.length}):</strong>
                    anchor bolts where reciprocal beams attach to the top ring (vertical bolts through the H-stack).
                    Drill these holes only on top ring H-beams.
                </div>
            </div>
            ` : ''}
    
            <div class="guide-beam-diagram">
                <div class="guide-beam-title">${rcpDrill.hasReciprocal && rcpDrill.rcpAnchorsOnH.length > 0 ? 'Bottom Ring H-Beam Drill Template' : 'Horizontal Beam Drill Template'} (${gL(state.hLengthFt)})</div>
                <div class="guide-beam-visual">
                    <div class="guide-beam-dimension" style="left: ${hBeamMargin}%; right: ${hBeamMargin}%;">
                        <span class="guide-beam-dimension-label">${gD(hTotIn, 1)} (${gL(state.hLengthFt)})</span>
                    </div>
                    <div class="guide-beam-bar" style="left: ${hBeamMargin}%; right: ${hBeamMargin}%;">
                        <div class="guide-beam-hole" style="left: ${(state.offsetBotIn / hTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">BOT</div>
                                <div class="guide-beam-label-value">${gD(state.offsetBotIn, 1)}</div>
                            </div>
                        </div>
                        <div class="guide-beam-hole" style="left: ${(pivotDistFromBottom / hTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">CTR</div>
                                <div class="guide-beam-label-value">${gD(pivotDistFromBottom, 1)}</div>
                            </div>
                        </div>
                        <div class="guide-beam-hole" style="left: ${((hTotIn - state.offsetTopIn) / hTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">TOP</div>
                                <div class="guide-beam-label-value">${gD(hTotIn - state.offsetTopIn, 1)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="guide-beam-diagram">
                <div class="guide-beam-title">Vertical Beam Drill Template (${gL(state.vLengthFt)})</div>
                <div class="guide-beam-visual">
                    <div class="guide-beam-dimension" style="left: ${vBeamMargin}%; right: ${vBeamMargin}%;">
                        <span class="guide-beam-dimension-label">${gD(vTotIn, 1)} (${gL(state.vLengthFt)})</span>
                    </div>
                    <div class="guide-beam-bar" style="left: ${vBeamMargin}%; right: ${vBeamMargin}%;">
                        <div class="guide-beam-hole" style="left: ${(vBottomPivot / vTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">BOT</div>
                                <div class="guide-beam-label-value">${gD(vBottomPivot, 1)}</div>
                            </div>
                        </div>
                        <div class="guide-beam-hole" style="left: ${(vCenterPivot / vTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">CTR</div>
                                <div class="guide-beam-label-value">${gD(vCenterPivot, 1)}</div>
                            </div>
                        </div>
                        <div class="guide-beam-hole" style="left: ${(vTopPivot / vTotIn) * 100}%">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name">TOP</div>
                                <div class="guide-beam-label-value">${gD(vTopPivot, 1)}</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
    
            ${rcpDrill.hasReciprocal && rcpDrill.rcpBeamLength > 0 ? `
            <div class="guide-beam-diagram">
                <div class="guide-beam-title">Reciprocal Beam Drill Template (${gL(rcpDrill.rcpBeamLength / INCHES_PER_FOOT)})</div>
                <div class="guide-beam-visual">
                    <div class="guide-beam-dimension" style="left: ${rcpBeamMargin}%; right: ${rcpBeamMargin}%;">
                        <span class="guide-beam-dimension-label">${gD(rcpDrill.rcpBeamLength, 1)} (${gL(rcpDrill.rcpBeamLength / INCHES_PER_FOOT)})</span>
                    </div>
                    <div class="guide-beam-bar" style="left: ${rcpBeamMargin}%; right: ${rcpBeamMargin}%;">
                        <div class="guide-beam-hole" style="left: ${(rcpDrill.rcpAnchorPos / rcpDrill.rcpBeamLength) * 100}%; background: radial-gradient(circle at 40% 40%, #4488ff 0%, #2255cc 50%, #113377 100%);">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name" style="color:#1a4ea0;">ANCH</div>
                                <div class="guide-beam-label-value">${gD(rcpDrill.rcpAnchorPos, 1)}</div>
                            </div>
                        </div>
                        ${rcpDrill.rcpCrossPositions.map(h => `
                        <div class="guide-beam-hole" style="left: ${(h.pos / rcpDrill.rcpBeamLength) * 100}%; background: radial-gradient(circle at 40% 40%, #b888ff 0%, #8a44cc 50%, #5a2280 100%);">
                            <div class="guide-beam-label">
                                <div class="guide-beam-label-name" style="color:#5a2280;">${h.label}</div>
                                <div class="guide-beam-label-value">${gD(h.pos, 1)}</div>
                            </div>
                        </div>`).join('')}
                    </div>
                </div>
                <div style="margin-top:8px; font-size:0.8rem; color:#555; padding:0 ${rcpBeamMargin}%;">
                    <strong style="color:#1a4ea0;">ANCH:</strong> anchor end (vertical bolt down through the top ring H-stack).
                    <strong style="color:#5a2280;"> X1…X${rcpDrill.rcpCrossPositions.length}:</strong>
                    crossing bolts where this reciprocal beam meets neighboring reciprocal beams.
                    All distances measured from the anchor (ANCH) end.
                </div>
            </div>
            ` : ''}
    
            <div class="guide-bracket-section">
                <div class="guide-card" style="max-width: 100%;">
                    <div class="guide-card-header">U-Bracket Detail Drawing</div>
                    <div class="guide-card-content">
                        <div class="guide-bracket-views">
                            <div class="guide-bracket-view">
                                <div class="guide-view-label">FRONT VIEW</div>
                                <canvas id="guide-bracket-front" width="300" height="280"></canvas>
                            </div>
                            <div class="guide-bracket-view">
                                <div class="guide-view-label">SIDE VIEW</div>
                                <canvas id="guide-bracket-side" width="200" height="280"></canvas>
                            </div>
                            <div class="guide-bracket-specs">
                                <div class="guide-subsection-title">Bracket Specifications</div>
                                <div class="guide-spec-row">
                                    <span class="guide-spec-label">Quantity</span>
                                    <span class="guide-spec-value">${uBrackets}×</span>
                                </div>
                                <div class="guide-spec-row">
                                    <span class="guide-spec-label">Width (W)</span>
                                    <span class="guide-spec-value">${gD(state.bracketWidth || 2.0, 3)}</span>
                                </div>
                                <div class="guide-spec-row">
                                    <span class="guide-spec-label">Depth (D)</span>
                                    <span class="guide-spec-value">${gD(state.bracketDepth || 3.0, 3)}</span>
                                </div>
                                <div class="guide-spec-row">
                                    <span class="guide-spec-label">Height (H)</span>
                                    <span class="guide-spec-value">${gD(state.bracketHeight || 3.0, 3)}</span>
                                </div>
                                <div class="guide-spec-row">
                                    <span class="guide-spec-label">Wall Thickness (T)</span>
                                    <span class="guide-spec-value">${gD(state.bracketWallThickness || 0.25, 3)}</span>
                                </div>
                                <div class="guide-spec-row">
                                    <span class="guide-spec-label">Inner Width</span>
                                    <span class="guide-spec-value">${gD(state.bracketInnerWidth || 1.5, 3)}</span>
                                </div>
                                <div class="guide-spec-row">
                                    <span class="guide-spec-label">Hole Diameter (⌀)</span>
                                    <span class="guide-spec-value">${gBoltDia(state.bracketHoleDiameter || 0.375)}</span>
                                </div>
                                <div class="guide-spec-row">
                                    <span class="guide-spec-label">Hole Position (from base)</span>
                                    <span class="guide-spec-value">${gD(state.bracketHoleDistance || 1.5, 3)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="guide-notes">
                <div class="guide-notes-title">📝 Notes</div>
                <ul class="guide-notes-list">
                    <li>All measurements are from beam end</li>
                    <li>Drill holes ${gBoltDia(state.boltDiameter)} diameter, centered on beam width</li>
                    <li>Red circles indicate end bracket holes, orange indicates center pivot</li>
                    <li>BOT = Bottom bracket connection, CTR = Center pivot, TOP = Top bracket connection</li>
                    ${rcpDrill.hasReciprocal && rcpDrill.rcpAnchorsOnH.length > 0 ? `
                    <li><span style="color:#1a4ea0; font-weight:600;">Blue R# holes</span> on top H-beams = reciprocal beam anchor bolts (top ring only)</li>` : ''}
                    ${rcpDrill.hasReciprocal && rcpDrill.rcpCrossPositions.length > 0 ? `
                    <li><span style="color:#5a2280; font-weight:600;">Purple X# holes</span> on reciprocal beams = crossing bolts where reciprocal beams overlap</li>
                    <li><span style="color:#1a4ea0; font-weight:600;">ANCH</span> on reciprocal beams = bolt down into the top ring H-stack at the anchor end</li>` : ''}
                </ul>
            </div>
        `;
        
        // Update modal content
        document.getElementById('guide-content').innerHTML = content;
        document.getElementById('guide-date').textContent = `Generated: ${new Date().toLocaleDateString()}`;
        
        // Show modal
        document.getElementById('build-guide-modal').classList.add('visible');
        
        // Prevent body scrolling
        document.body.style.overflow = 'hidden';
        
        // Render views on canvases after a short delay for DOM to update
        setTimeout(() => {
            renderGuideView('guide-canvas-top', data, 'top');
            renderGuideView('guide-canvas-side', data, 'side');
            renderGuideView('guide-canvas-3d', data, '3d');
            renderBracketDiagram();
        }, 50);
    }
    
    /**
     * Renders a view to a canvas in the build guide
     */
    function renderGuideView(canvasId, data, viewType) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        const w = canvas.width = canvas.clientWidth * 2; // Higher res
        const h = canvas.height = canvas.clientHeight * 2;
        
        // White background
        ctx.fillStyle = '#f8f8f8';
        ctx.fillRect(0, 0, w, h);
        
        if (!data.beams || data.beams.length === 0) return;
        
        const cx = w / 2;
        const cy = h / 2;
        
        // Camera settings for 3D view
        const yaw = 0.4;
        const pitch = -0.3;
        const camDist = Math.max(data.maxHeight || 100, (data.maxRad || 50) * 2) * 1.5; // Zoomed in more
        
        // Calculate full 3D bounding box for structure center
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        
        const updateBounds3D = (corner) => {
            minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
            minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
            minZ = Math.min(minZ, corner.z); maxZ = Math.max(maxZ, corner.z);
        };
        
        data.beams.forEach(beam => {
            beam.corners.forEach(updateBounds3D);
        });
        
        // Include solar panels in bounding box
        if (data.panels && data.panels.length > 0) {
            data.panels.forEach(panel => {
                panel.corners.forEach(updateBounds3D);
            });
        }
        
        // Structure center in 3D
        const sc = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
            z: (minZ + maxZ) / 2
        };
        
        // Calculate 2D bounds for ortho scaling based on view type
        let width, height, centerX2D, centerY2D;
        if (viewType === 'top') {
            width = maxX - minX;
            height = maxZ - minZ;
            centerX2D = sc.x;
            centerY2D = sc.z;
        } else if (viewType === 'side') {
            width = maxX - minX;
            height = maxY - minY;
            centerX2D = sc.x;
            centerY2D = sc.y;
        } else {
            width = maxX - minX;
            height = maxY - minY;
            centerX2D = sc.x;
            centerY2D = sc.y;
        }
        
        const padding = 40;
        const scaleX = (w - padding * 2) / Math.max(width, 1);
        const scaleY = (h - padding * 2) / Math.max(height, 1);
        const scale = Math.min(scaleX, scaleY);
        
        // Project function - centers on structure bounding box center
        const project = (p) => {
            if (viewType === 'top') {
                return {
                    x: cx + (p.x - sc.x) * scale,
                    y: cy + (p.z - sc.z) * scale,
                    z: p.y
                };
            } else if (viewType === 'side') {
                return {
                    x: cx + (p.x - sc.x) * scale,
                    y: cy - (p.y - sc.y) * scale,
                    z: p.z
                };
            } else { // 3D perspective - offset by structure center
                let px = p.x - sc.x, py = p.y - sc.y, pz = p.z - sc.z;
                let x1 = px * Math.cos(-yaw) - pz * Math.sin(-yaw);
                let z1 = px * Math.sin(-yaw) + pz * Math.cos(-yaw);
                let y2 = py * Math.cos(pitch) - z1 * Math.sin(pitch);
                let z2 = py * Math.sin(pitch) + z1 * Math.cos(pitch);
                let depth = z2 + camDist;
                if (depth < 50) depth = 50;
                let s = 800 / depth;
                return {
                    x: cx + x1 * s,
                    y: cy - y2 * s,
                    z: depth,
                    s: s
                };
            }
        };
        
        // Collect and sort faces
        const faces = [];
        
        // Add beam faces
        data.beams.forEach(beam => {
            const pts = beam.corners.map(p => project(p));
            
            beam.faces.forEach(f => {
                const p0 = pts[f.idx[0]], p1 = pts[f.idx[1]], p2 = pts[f.idx[2]], p3 = pts[f.idx[3]];
                
                // Back-face culling for 3D view
                if (viewType === '3d') {
                    const edge1 = {x: p1.x - p0.x, y: p1.y - p0.y};
                    const edge2 = {x: p2.x - p0.x, y: p2.y - p0.y};
                    const cross = edge1.x * edge2.y - edge1.y * edge2.x;
                    if (cross >= 0) return;
                }
                
                const minZ = Math.min(p0.z, p1.z, p2.z, p3.z);
                faces.push({
                    pts: [p0, p1, p2, p3],
                    z: minZ,
                    col: beam.colorBase,
                    type: 'beam'
                });
            });
        });
        
        // Add solar panel faces if enabled
        if (data.panels && data.panels.length > 0) {
            data.panels.forEach(panel => {
                const pts = panel.corners.map(p => project(p));
                
                panel.faces.forEach((f, fIdx) => {
                    const p0 = pts[f.idx[0]], p1 = pts[f.idx[1]], p2 = pts[f.idx[2]], p3 = pts[f.idx[3]];
                    
                    // Back-face culling for 3D view
                    if (viewType === '3d') {
                        const edge1 = {x: p1.x - p0.x, y: p1.y - p0.y};
                        const edge2 = {x: p2.x - p0.x, y: p2.y - p0.y};
                        const cross = edge1.x * edge2.y - edge1.y * edge2.x;
                        if (cross >= 0) return;
                    }
                    
                    const minZ = Math.min(p0.z, p1.z, p2.z, p3.z);
                    // Solar panel colors
                    const isTopFace = fIdx === 1;
                    const col = isTopFace ? {r: 30, g: 50, b: 100} : {r: 40, g: 40, b: 50};
                    
                    faces.push({
                        pts: [p0, p1, p2, p3],
                        z: minZ,
                        col: col,
                        type: 'panel'
                    });
                });
            });
        }
        
        // Sort by depth
        faces.sort((a, b) => b.z - a.z);
        
        // Draw faces
        faces.forEach(f => {
            ctx.fillStyle = `rgb(${f.col.r},${f.col.g},${f.col.b})`;
            ctx.strokeStyle = f.type === 'panel' ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.3)';
            ctx.lineWidth = 1;
            
            ctx.beginPath();
            ctx.moveTo(f.pts[0].x, f.pts[0].y);
            for (let i = 1; i < 4; i++) {
                ctx.lineTo(f.pts[i].x, f.pts[i].y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        });
    }
    
    /**
     * Renders the 2D bracket detail diagrams in the build guide
     */
    function renderBracketDiagram() {
        const frontCanvas = document.getElementById('guide-bracket-front');
        const sideCanvas = document.getElementById('guide-bracket-side');
        
        if (!frontCanvas || !sideCanvas) return;
        
        // Get bracket dimensions from state
        const W = state.bracketWidth || 2.0;        // Width (X direction)
        const D = state.bracketDepth || 3.0;        // Depth (Z direction)
        const H = state.bracketHeight || 3.0;       // Height (Y direction)
        const T = state.bracketWallThickness || 0.25; // Wall thickness
        const innerW = state.bracketInnerWidth || (W - 2 * T); // Inner width
        const holeDia = state.bracketHoleDiameter || 0.375;
        const holeY = state.bracketHoleDistance || (H / 2); // Hole position from base
        
        // Colors
        const bracketFill = '#b0b0b0';
        const bracketStroke = '#666';
        const holeFill = '#444';
        const dimColor = '#333';
        const dimLineColor = '#666';
        const labelBg = '#fff';
        
        // ===== FRONT VIEW (looking into the U-shape, showing width and height) =====
        {
            const ctx = frontCanvas.getContext('2d');
            const cw = frontCanvas.width;
            const ch = frontCanvas.height;
            
            ctx.clearRect(0, 0, cw, ch);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cw, ch);
            
            // Calculate scale to fit bracket with margins for dimension lines
            const margin = 60;
            const drawableW = cw - margin * 2;
            const drawableH = ch - margin * 2;
            const scale = Math.min(drawableW / W, drawableH / H) * 0.7;
            
            // Center the bracket
            const bracketDrawW = W * scale;
            const bracketDrawH = H * scale;
            const startX = (cw - bracketDrawW) / 2;
            const startY = margin + 20; // Top of bracket (open end)
            
            // Draw bracket cross-section (U-shape looking from front)
            ctx.fillStyle = bracketFill;
            ctx.strokeStyle = bracketStroke;
            ctx.lineWidth = 2;
            
            // U-shape path: left wall, bottom, right wall
            const wallThickDraw = T * scale;
            const innerWDraw = innerW * scale;
            
            ctx.beginPath();
            // Outer outline
            ctx.moveTo(startX, startY);
            ctx.lineTo(startX, startY + bracketDrawH); // Left outer down
            ctx.lineTo(startX + bracketDrawW, startY + bracketDrawH); // Bottom
            ctx.lineTo(startX + bracketDrawW, startY); // Right outer up
            ctx.lineTo(startX + bracketDrawW - wallThickDraw, startY); // Right wall inner top
            ctx.lineTo(startX + bracketDrawW - wallThickDraw, startY + bracketDrawH - wallThickDraw); // Right wall inner down
            ctx.lineTo(startX + wallThickDraw, startY + bracketDrawH - wallThickDraw); // Inner bottom
            ctx.lineTo(startX + wallThickDraw, startY); // Left wall inner up
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Draw hole (on the center of each side wall)
            const holeRadius = (holeDia * scale) / 2;
            const holeCenterY = startY + bracketDrawH - (holeY * scale); // Y position from bottom
            
            // Left hole
            ctx.fillStyle = holeFill;
            ctx.beginPath();
            ctx.arc(startX + wallThickDraw / 2, holeCenterY, holeRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Right hole
            ctx.beginPath();
            ctx.arc(startX + bracketDrawW - wallThickDraw / 2, holeCenterY, holeRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            
            // DIMENSION LINES
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Width dimension (top)
            const dimY1 = startY - 25;
            ctx.strokeStyle = dimLineColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(startX, dimY1);
            ctx.lineTo(startX + bracketDrawW, dimY1);
            ctx.stroke();
            // End arrows
            drawArrow(ctx, startX, dimY1, 'left');
            drawArrow(ctx, startX + bracketDrawW, dimY1, 'right');
            // Extension lines
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(startX, startY - 5);
            ctx.lineTo(startX, dimY1 - 5);
            ctx.moveTo(startX + bracketDrawW, startY - 5);
            ctx.lineTo(startX + bracketDrawW, dimY1 - 5);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label
            ctx.fillStyle = labelBg;
            ctx.fillRect(cw/2 - 25, dimY1 - 10, 50, 16);
            ctx.fillStyle = dimColor;
            ctx.fillText(`W: ${unitConverter.formatDimensionWithUnit(W, 3)}`, cw/2, dimY1);
            
            // Height dimension (left side)
            const dimX1 = startX - 30;
            ctx.beginPath();
            ctx.moveTo(dimX1, startY);
            ctx.lineTo(dimX1, startY + bracketDrawH);
            ctx.stroke();
            drawArrow(ctx, dimX1, startY, 'up');
            drawArrow(ctx, dimX1, startY + bracketDrawH, 'down');
            // Extension lines
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(startX - 5, startY);
            ctx.lineTo(dimX1 - 5, startY);
            ctx.moveTo(startX - 5, startY + bracketDrawH);
            ctx.lineTo(dimX1 - 5, startY + bracketDrawH);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label
            ctx.save();
            ctx.translate(dimX1 - 12, startY + bracketDrawH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = labelBg;
            ctx.fillRect(-25, -8, 50, 16);
            ctx.fillStyle = dimColor;
            ctx.fillText(`H: ${unitConverter.formatDimensionWithUnit(H, 3)}`, 0, 0);
            ctx.restore();
            
            // Inner width dimension (inside the U)
            const innerDimY = startY + bracketDrawH - wallThickDraw - 15;
            ctx.strokeStyle = '#888';
            ctx.beginPath();
            ctx.moveTo(startX + wallThickDraw, innerDimY);
            ctx.lineTo(startX + bracketDrawW - wallThickDraw, innerDimY);
            ctx.stroke();
            drawArrow(ctx, startX + wallThickDraw, innerDimY, 'left', '#888');
            drawArrow(ctx, startX + bracketDrawW - wallThickDraw, innerDimY, 'right', '#888');
            ctx.fillStyle = labelBg;
            ctx.fillRect(cw/2 - 30, innerDimY - 10, 60, 14);
            ctx.fillStyle = '#666';
            ctx.font = '10px sans-serif';
            ctx.fillText(`Inner: ${unitConverter.formatDimensionWithUnit(innerW, 3)}`, cw/2, innerDimY - 2);
            
            // Hole position dimension (right side, from bottom to hole center)
            const holeDimX = startX + bracketDrawW + 25;
            ctx.strokeStyle = '#c00';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(holeDimX, startY + bracketDrawH);
            ctx.lineTo(holeDimX, holeCenterY);
            ctx.stroke();
            drawArrow(ctx, holeDimX, startY + bracketDrawH, 'down', '#c00');
            drawArrow(ctx, holeDimX, holeCenterY, 'up', '#c00');
            // Extension lines
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = '#c00';
            ctx.beginPath();
            ctx.moveTo(startX + bracketDrawW + 5, startY + bracketDrawH);
            ctx.lineTo(holeDimX + 5, startY + bracketDrawH);
            ctx.moveTo(startX + bracketDrawW - wallThickDraw / 2 + holeRadius + 3, holeCenterY);
            ctx.lineTo(holeDimX + 5, holeCenterY);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label
            ctx.save();
            ctx.translate(holeDimX + 12, (startY + bracketDrawH + holeCenterY) / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = labelBg;
            ctx.fillRect(-30, -8, 60, 14);
            ctx.fillStyle = '#c00';
            ctx.font = 'bold 10px sans-serif';
            ctx.fillText(`Hole: ${gD(holeY, 3)}`, 0, 0);
            ctx.restore();
            
            // Wall thickness label
            ctx.fillStyle = '#666';
            ctx.font = '9px sans-serif';
            ctx.fillText(`T: ${gD(T, 3)}`, startX + wallThickDraw/2, startY + bracketDrawH/2);
        }
        
        // ===== SIDE VIEW (showing depth and height, cross-section of wall) =====
        {
            const ctx = sideCanvas.getContext('2d');
            const cw = sideCanvas.width;
            const ch = sideCanvas.height;
            
            ctx.clearRect(0, 0, cw, ch);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, cw, ch);
            
            // Calculate scale
            const margin = 50;
            const drawableW = cw - margin * 2;
            const drawableH = ch - margin * 2;
            const scale = Math.min(drawableW / D, drawableH / H) * 0.7;
            
            const bracketDrawD = D * scale;
            const bracketDrawH = H * scale;
            const wallThickDraw = T * scale;
            const startX = (cw - bracketDrawD) / 2;
            const startY = margin + 20;
            
            // Draw side view (rectangle with wall thickness shown)
            ctx.fillStyle = bracketFill;
            ctx.strokeStyle = bracketStroke;
            ctx.lineWidth = 2;
            
            // Side wall rectangle
            ctx.beginPath();
            ctx.rect(startX, startY, bracketDrawD, bracketDrawH);
            ctx.fill();
            ctx.stroke();
            
            // Draw the hole (circle in the center of the side wall)
            const holeRadius = (holeDia * scale) / 2;
            const holeCenterX = startX + bracketDrawD / 2;
            const holeCenterY = startY + bracketDrawH - (holeY * scale);
            
            ctx.fillStyle = holeFill;
            ctx.beginPath();
            ctx.arc(holeCenterX, holeCenterY, holeRadius, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Dimension lines
            ctx.font = 'bold 11px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            // Depth dimension (top)
            const dimY1 = startY - 20;
            ctx.strokeStyle = dimLineColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(startX, dimY1);
            ctx.lineTo(startX + bracketDrawD, dimY1);
            ctx.stroke();
            drawArrow(ctx, startX, dimY1, 'left');
            drawArrow(ctx, startX + bracketDrawD, dimY1, 'right');
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(startX, startY - 5);
            ctx.lineTo(startX, dimY1 - 5);
            ctx.moveTo(startX + bracketDrawD, startY - 5);
            ctx.lineTo(startX + bracketDrawD, dimY1 - 5);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = labelBg;
            ctx.fillRect(cw/2 - 25, dimY1 - 10, 50, 16);
            ctx.fillStyle = dimColor;
            ctx.fillText(`D: ${unitConverter.formatDimensionWithUnit(D, 3)}`, cw/2, dimY1);
            
            // Height dimension (left)
            const dimX1 = startX - 25;
            ctx.strokeStyle = dimLineColor;
            ctx.beginPath();
            ctx.moveTo(dimX1, startY);
            ctx.lineTo(dimX1, startY + bracketDrawH);
            ctx.stroke();
            drawArrow(ctx, dimX1, startY, 'up');
            drawArrow(ctx, dimX1, startY + bracketDrawH, 'down');
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(startX - 5, startY);
            ctx.lineTo(dimX1 - 5, startY);
            ctx.moveTo(startX - 5, startY + bracketDrawH);
            ctx.lineTo(dimX1 - 5, startY + bracketDrawH);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.save();
            ctx.translate(dimX1 - 12, startY + bracketDrawH / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = labelBg;
            ctx.fillRect(-25, -8, 50, 16);
            ctx.fillStyle = dimColor;
            ctx.fillText(`H: ${unitConverter.formatDimensionWithUnit(H, 3)}`, 0, 0);
            ctx.restore();
            
            // Hole diameter annotation
            ctx.fillStyle = '#c00';
            ctx.font = 'bold 10px sans-serif';
            const holeAnnotX = holeCenterX + holeRadius + 20;
            ctx.beginPath();
            ctx.moveTo(holeCenterX + holeRadius + 2, holeCenterY);
            ctx.lineTo(holeAnnotX - 5, holeCenterY);
            ctx.stroke();
            ctx.fillText(`⌀${unitConverter.formatDimensionWithUnit(holeDia, 3)}`, holeAnnotX + 15, holeCenterY);
        }
    }
    
    /**
     * Helper to draw dimension arrows
     */
    function drawArrow(ctx, x, y, dir, color = '#666') {
        ctx.fillStyle = color;
        ctx.beginPath();
        const size = 5;
        switch(dir) {
            case 'left':
                ctx.moveTo(x, y);
                ctx.lineTo(x + size, y - size/2);
                ctx.lineTo(x + size, y + size/2);
                break;
            case 'right':
                ctx.moveTo(x, y);
                ctx.lineTo(x - size, y - size/2);
                ctx.lineTo(x - size, y + size/2);
                break;
            case 'up':
                ctx.moveTo(x, y);
                ctx.lineTo(x - size/2, y + size);
                ctx.lineTo(x + size/2, y + size);
                break;
            case 'down':
                ctx.moveTo(x, y);
                ctx.lineTo(x - size/2, y - size);
                ctx.lineTo(x + size/2, y - size);
                break;
        }
        ctx.closePath();
        ctx.fill();
    }
    
    /**
     * Closes the build guide modal
     */
    function closeBuildGuide() {
        document.getElementById('build-guide-modal').classList.remove('visible');
        document.body.style.overflow = '';
    }
    
    /**
     * Exports the current configuration as JSON from the guide modal
     */
    function exportGuideJSON() {
        exportToJSON();
    }
    
    function initBuildGuideHandlers() {
        // Close modal when clicking outside content
        document.addEventListener('click', (e) => {
            if (e.target.id === 'build-guide-modal') {
                closeBuildGuide();
            }
        });

        // Close modal with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('build-guide-modal').classList.contains('visible')) {
                closeBuildGuide();
            }
        });
    }
    
    /**
     * Recalculates all BOM totals in the guide when a unit price is edited.
     * Updates line totals, section subtotals, grand total, state, sidebar inputs, and HUD.
     */
    function recalcGuideBOM() {
        let structureTotal = 0;
        let powerTotal = 0;
    
        document.querySelectorAll('#guide-bom-table .guide-price-input').forEach(input => {
            const price = parseFloat(input.value) || 0;
            const qty = parseFloat(input.dataset.bomQty) || 0;
            const stateKey = input.dataset.bomState;
            const sidebarId = input.dataset.bomSidebar;
            const section = input.closest('tr').dataset.bomSection;
            const lineTotal = qty * price;
    
            if (stateKey) state[stateKey] = price;
    
            const totalCell = input.closest('tr').querySelector('.total');
            if (totalCell) totalCell.textContent = '$' + formatNumber(lineTotal, 2);
    
            if (section === 'structure') structureTotal += lineTotal;
            else if (section === 'power') powerTotal += lineTotal;
    
            if (sidebarId) {
                const sidebarEl = document.getElementById(sidebarId);
                if (sidebarEl) sidebarEl.value = formatNumber(price, 2);
            }
        });
    
        // Center bolt row mirrors costBoltVInner, not directly editable
        const centerRow = document.getElementById('guide-bom-row-vcenter');
        if (centerRow) {
            const qty = parseFloat(centerRow.dataset.bomQty) || 0;
            const price = state.costBoltVInner;
            const lineTotal = qty * price;
            const priceCell = centerRow.querySelector('.price');
            const totalCell = centerRow.querySelector('.total');
            if (priceCell) priceCell.textContent = '$' + formatNumber(price, 2);
            if (totalCell) totalCell.textContent = '$' + formatNumber(lineTotal, 2);
            structureTotal += lineTotal;
        }
    
        // In non-split mode, keep costBoltVOuter in sync
        if (!needsSplitVBolts()) {
            state.costBoltVOuter = state.costBoltVInner;
        }
    
        const structSub = document.getElementById('guide-bom-subtotal-structure');
        if (structSub) structSub.textContent = '$' + formatNumber(structureTotal, 2);
        const powerSub = document.getElementById('guide-bom-subtotal-power');
        if (powerSub) powerSub.textContent = '$' + formatNumber(powerTotal, 2);
    
        const grandTotal = structureTotal + powerTotal;
        const gtEl = document.getElementById('guide-bom-grand-total');
        if (gtEl) gtEl.textContent = '$' + formatNumber(grandTotal, 2);
        const statEl = document.getElementById('guide-stat-total');
        if (statEl) statEl.textContent = '$' + formatNumber(grandTotal, 2);
    
        try {
            const freshData = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
            updateHUD(freshData);
        } catch (e) { /* guard against unrelated errors */ }
    }
    
    /**
     * Gathers all BOM data used by both PDF and CSV exporters.
     * Returns a structured object with line items, subtotals, and metadata.
     */
    function gatherBOMData() {
        const data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: true, useCache: false });
    
        const moduleCount = state.modules;
        const hBeams = moduleCount * 2 * state.hStackCount;
        const vBeams = moduleCount * state.vStackCount;
        const uBrackets = moduleCount * 4;
    
        const splitBolts = needsSplitVBolts();
        const vBoltsInner = moduleCount * 2;
        const vBoltsOuter = moduleCount * 2;
        const vBoltsCenter = moduleCount * 1;
        const hCenterBolts = moduleCount * 2;
        const hPivotBolts = moduleCount * 4;
        const totalVBolts = vBoltsInner + vBoltsOuter + vBoltsCenter;
        const totalHBolts = hCenterBolts + hPivotBolts;
        const nBolts = totalVBolts + totalHBolts;
    
        let costBoltVInner, costBoltVOuter, costBoltH, costHPivot;
        if (splitBolts) {
            costBoltVInner = state.costBoltVInner || 0.75;
            costBoltVOuter = state.costBoltVOuter || 0.50;
            costBoltH = state.costBoltH || 0.75;
            costHPivot = state.costBoltHPivot || 0.75;
        } else {
            const vBoltPrice = parseFloat(document.getElementById('nb-cost-bolt-v')?.value) || 0.75;
            costBoltVInner = vBoltPrice;
            costBoltVOuter = vBoltPrice;
            costBoltH = parseFloat(document.getElementById('nb-cost-bolt-h')?.value) || 0.75;
            costHPivot = state.costBoltHPivot || 0.75;
        }
    
        const hBeamsCost = hBeams * state.costHBeam;
        const vBeamsCost = calculateVBeamsCost();
        const bracketCost = uBrackets * state.costBracket;
    
        const vBoltInnerCost = vBoltsInner * costBoltVInner;
        const vBoltOuterCost = vBoltsOuter * costBoltVOuter;
        const vBoltCenterCost = vBoltsCenter * costBoltVInner;
        const hCenterBoltCost = hCenterBolts * costBoltH;
        const hPivotBoltCost = hPivotBolts * costHPivot;
        const boltCost = vBoltInnerCost + vBoltOuterCost + vBoltCenterCost + hCenterBoltCost + hPivotBoltCost;
    
        const vWashersPerBolt = state.vStackCount > 1 ? (state.vStackCount - 1) : 0;
        const vWasherCount = state.vWasherEnabled ? (totalVBolts * vWashersPerBolt) : 0;
        const hWashersPerBolt = state.hStackCount > 1 ? (state.hStackCount - 1) : 0;
        const hWasherCount = state.hWasherEnabled ? (totalHBolts * hWashersPerBolt) : 0;
        const costWasherV = state.costWasherV || 0.10;
        const costWasherH = state.costWasherH || 0.10;
        const vWasherCost = vWasherCount * costWasherV;
        const hWasherCost = hWasherCount * costWasherH;
        const washerCost = vWasherCost + hWasherCost;
    
        const sbBom = computeSupportBomContribution(moduleCount, costBoltVInner);
    
        const assemblyHardwareItems = (typeof getAssemblyHardwareItems === 'function') ? getAssemblyHardwareItems(moduleCount) : [];
        const assemblyHardwareCost = assemblyHardwareItems.reduce((sum, it) => sum + (it.total || 0), 0);
    
        const solarEnabled = state.solarPanels.enabled;
        const panelConfig = getActivePanelConfig();
        const solarPanelCount = solarEnabled && data.panels ? data.panels.length : 0;
        const solarPanelCost = solarPanelCount * state.costSolarPanel;
        const totalWatts = solarPanelCount * (panelConfig.ratedWatts || 0);
        const totalKw = totalWatts / 1000;
    
        const structureCost = hBeamsCost + vBeamsCost + bracketCost + boltCost + washerCost + sbBom.supportBeamCost + assemblyHardwareCost;
        const totalCost = structureCost + solarPanelCost;
    
        const hBeamWeightPerFoot = (state.hBeamW * state.hBeamT * INCHES_PER_FOOT) * state.woodDensity;
        const hBeamWeight = hBeams * state.hLengthFt * hBeamWeightPerFoot;
        const vBeamWeight = calculateVBeamTotalWeight();
        const bracketWeight = uBrackets * state.weightBracket;
        const boltWeight = nBolts * state.weightBolt;
        const structureWeight = hBeamWeight + vBeamWeight + bracketWeight + boltWeight + sbBom.supportBeamWeight;
        const solarWeightSummary = getSolarPanelWeightSummary(data);
        const solarPanelWeight = solarEnabled && solarPanelCount > 0 ? solarWeightSummary.total : 0;
        const totalWeight = structureWeight + solarPanelWeight;
    
        const heightFt = unitConverter.inchesToFeet(data.maxHeight);
        const diameterFt = unitConverter.inchesToFeet(data.maxRad * 2);
        const actuatorInfo = calculateActuatorStroke();
    
        const hTotIn = state.hLengthFt * INCHES_PER_FOOT;
        const hActiveIn = hTotIn - state.offsetTopIn - state.offsetBotIn;
        const pivotRatio = state.pivotPct / 100;
        const pivotDistFromBottom = state.offsetBotIn + (hActiveIn * pivotRatio);
        const vTotIn = state.vLengthFt * INCHES_PER_FOOT;
        const vEndOffset = state.vertEndOffset || 1.5;
        const vBottomPivot = vEndOffset;
        const vTopPivot = vTotIn - vEndOffset;
        const vCenterPivot = (vBottomPivot + vTopPivot) / 2;
    
        // Build structure line items
        const structureItems = [];
        structureItems.push({ qty: hBeams, item: `H-Beams (${unitConverter.formatBeamSpecForCost(state.hLengthFt, state.hBeamW, state.hBeamT)})`, unit: state.costHBeam, total: hBeamsCost });
        const vBeamCountsForBom = getVBeamCountsByType();
        if (!vBeamCountsForBom.linked) {
            const innerUnitCost = state.autoLumberPricing
                ? calculateBeamCostByVolume(state.vBeamInnerW, state.vBeamInnerT, state.vLengthFt)
                : state.costVBeam;
            const outerUnitCost = state.autoLumberPricing
                ? calculateBeamCostByVolume(state.vBeamOuterW, state.vBeamOuterT, state.vLengthFt)
                : state.costVBeam;
            structureItems.push({ qty: vBeamCountsForBom.inner, item: `V-Inner Beams (${unitConverter.formatBeamSpecForCost(state.vLengthFt, state.vBeamInnerW, state.vBeamInnerT)})`, unit: innerUnitCost, total: vBeamCountsForBom.inner * innerUnitCost });
            structureItems.push({ qty: vBeamCountsForBom.outer, item: `V-Outer Beams (${unitConverter.formatBeamSpecForCost(state.vLengthFt, state.vBeamOuterW, state.vBeamOuterT)})`, unit: outerUnitCost, total: vBeamCountsForBom.outer * outerUnitCost });
        } else {
            structureItems.push({ qty: vBeams, item: `V-Beams (${unitConverter.formatBeamSpecForCost(state.vLengthFt, state.vBeamW, state.vBeamT)})`, unit: state.costVBeam, total: vBeamsCost });
        }
        structureItems.push({ qty: uBrackets, item: 'U-Brackets', unit: state.costBracket, total: bracketCost });
    
        if (splitBolts) {
            structureItems.push({ qty: vBoltsInner, item: `Inner Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltInnerLength)}`, unit: costBoltVInner, total: vBoltInnerCost });
            structureItems.push({ qty: vBoltsOuter, item: `Outer Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltOuterLength)}`, unit: costBoltVOuter, total: vBoltOuterCost });
            structureItems.push({ qty: vBoltsCenter, item: `Center Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltLength)}`, unit: costBoltVInner, total: vBoltCenterCost });
        } else {
            structureItems.push({ qty: totalVBolts, item: `V-Stack Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.vBoltLength)}`, unit: costBoltVInner, total: vBoltInnerCost + vBoltOuterCost + vBoltCenterCost });
        }
        structureItems.push({ qty: hCenterBolts, item: `H-Center Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.hBoltLength)}`, unit: costBoltH, total: hCenterBoltCost });
        structureItems.push({ qty: hPivotBolts, item: `H-Pivot Bolts ${unitConverter.formatBoltSpec(state.boltDiameter, state.hPivotBoltLength)}`, unit: costHPivot, total: hPivotBoltCost });
    
        if (vWasherCount > 0) {
            structureItems.push({ qty: vWasherCount, item: `V-Stack Washers (ID:${unitConverter.formatDimensionWithUnit(state.vWasherID, 3)} OD:${unitConverter.formatDimensionWithUnit(state.vWasherOD, 2)} T:${unitConverter.formatDimensionWithUnit(state.vWasherThickness, 2)})`, unit: costWasherV, total: vWasherCost });
        }
        if (hWasherCount > 0) {
            structureItems.push({ qty: hWasherCount, item: `H-Stack Washers (ID:${unitConverter.formatDimensionWithUnit(state.hWasherID, 3)} OD:${unitConverter.formatDimensionWithUnit(state.hWasherOD, 2)} T:${unitConverter.formatDimensionWithUnit(state.hWasherThickness, 2)})`, unit: costWasherH, total: hWasherCost });
        }
    
        sbBom.structureItems.forEach(li => structureItems.push(li));
    
        // Detailed hardware assembly extras (bushings / lock washers / nuts)
        assemblyHardwareItems.forEach(li => structureItems.push(li));
    
        const powerItems = [];
        if (solarEnabled && solarPanelCount > 0) {
            powerItems.push({ qty: solarPanelCount, item: `Solar Panels (${panelConfig.ratedWatts || 0}W - ${unitConverter.formatDimensionWithUnit(panelConfig.panelLength || 0, 1)} x ${unitConverter.formatDimensionWithUnit(panelConfig.panelWidth || 0, 1)})`, unit: state.costSolarPanel, total: solarPanelCost });
        }
    
        const rcpDrill = computeReciprocalDrillData(data);
    
        return {
            data, moduleCount, splitBolts, nBolts,
            structureItems, structureCost,
            powerItems, powerCost: solarPanelCost,
            totalCost, totalWeight, structureWeight, solarPanelWeight,
            supportBeamCost: sbBom.supportBeamCost,
            supportBeamWeight: sbBom.supportBeamWeight,
            heightFt, diameterFt, actuatorInfo,
            solarEnabled, solarPanelCount, totalKw, panelConfig,
            hBeamWeight, vBeamWeight, bracketWeight, boltWeight,
            hTotIn, pivotDistFromBottom, vTotIn, vBottomPivot, vCenterPivot, vTopPivot,
            rcpDrill
        };
    }
    
    /**
     * Exports the Build Guide as a properly formatted multi-page PDF using jsPDF.
     */
    function exportGuidePDF() {
        if (typeof jspdf === 'undefined') {
            showToast('PDF library not loaded. Check your internet connection.', 'error');
            console.error('[PDF Export] jspdf global not found — CDN failed to load');
            return;
        }
    
        try {
    
        const bom = gatherBOMData();
        const { jsPDF } = jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
        const pageW = doc.internal.pageSize.getWidth();
        const pageH = doc.internal.pageSize.getHeight();
        const margin = 15;
        const contentW = pageW - margin * 2;
        let y = margin;
    
        const colors = {
            headerBg: [44, 62, 80],
            headerText: [255, 255, 255],
            accent: [0, 102, 0],
            text: [51, 51, 51],
            muted: [119, 119, 119],
            line: [200, 200, 200],
            lightBg: [248, 246, 242],
            sectionBg: [44, 62, 80],
            subtotalBg: [240, 240, 240],
        };
    
        function addFooter(pageNum) {
            doc.setFontSize(7.5);
            doc.setTextColor(...colors.muted);
            doc.text(`StarShade Linkage Lab  -  Generated ${new Date().toLocaleDateString()}`, margin, pageH - 8);
            doc.text(`Page ${pageNum}`, pageW - margin, pageH - 8, { align: 'right' });
        }
    
        function checkPageBreak(needed) {
            if (y + needed > pageH - 18) {
                addFooter(doc.getNumberOfPages());
                doc.addPage();
                y = margin;
                return true;
            }
            return false;
        }
    
        // ---- PAGE 1: TITLE HEADER ----
        doc.setFillColor(...colors.headerBg);
        doc.rect(0, 0, pageW, 32, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.setTextColor(...colors.headerText);
        doc.text('BUILD GUIDE', margin, 16);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(`Generated: ${new Date().toLocaleDateString()}`, margin, 24);
        doc.text('StarShade Linkage Lab', pageW - margin, 24, { align: 'right' });
        y = 40;
    
        // ---- STATS BAR ----
        const stats = [
            { label: 'Height', value: `${unitConverter.formatFeetWithUnit(bom.heightFt, 1)}` },
            { label: 'Diameter', value: `${unitConverter.formatFeetWithUnit(bom.diameterFt, 1)}` },
            { label: 'Modules', value: `${bom.moduleCount}` },
            { label: 'Fold Angle', value: `${formatNumber(radToDeg(state.foldAngle), 1)}°` },
            { label: 'Actuator', value: `${unitConverter.formatDimensionWithUnit(bom.actuatorInfo.stroke, 2)}` },
        ];
        if (bom.solarEnabled) {
            stats.push({ label: 'Panels', value: `${bom.solarPanelCount}` });
            stats.push({ label: 'Capacity', value: `${formatNumber(bom.totalKw, 2)} kW` });
        }
        stats.push({ label: 'Est. Total', value: `$${formatNumber(bom.totalCost, 2)}` });
        stats.push({ label: 'Weight', value: `${unitConverter.formatWeightWithUnit(bom.totalWeight, 1)}` });
    
        doc.setFillColor(...colors.lightBg);
        doc.roundedRect(margin, y, contentW, 18, 2, 2, 'F');
        doc.setDrawColor(...colors.line);
        doc.roundedRect(margin, y, contentW, 18, 2, 2, 'S');
    
        const statW = contentW / stats.length;
        stats.forEach((s, i) => {
            const sx = margin + statW * i + statW / 2;
            doc.setFontSize(6);
            doc.setTextColor(...colors.muted);
            doc.setFont('helvetica', 'normal');
            doc.text(s.label.toUpperCase(), sx, y + 6, { align: 'center' });
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            if (s.label === 'Est. Total') {
                doc.setTextColor(...colors.accent);
            } else if (s.label === 'Weight') {
                doc.setTextColor(52, 152, 219);
            } else {
                doc.setTextColor(...colors.text);
            }
            doc.text(s.value, sx, y + 14, { align: 'center' });
        });
        y += 24;
    
        // ---- 3-VIEW DRAWINGS ----
        const canvasIds = [
            { id: 'guide-canvas-top', label: 'TOP VIEW' },
            { id: 'guide-canvas-side', label: 'SIDE VIEW' },
            { id: 'guide-canvas-3d', label: '3D PERSPECTIVE' },
        ];
        const viewW = (contentW - 6) / 3;
        const labelH = 6;
        const refCanvas = document.getElementById(canvasIds[0].id);
        const canvasAR = refCanvas ? (refCanvas.height / refCanvas.width) : 0.75;
        const imgH = viewW * canvasAR;
        const viewH = labelH + imgH;
        canvasIds.forEach((cv, i) => {
            const canvas = document.getElementById(cv.id);
            const vx = margin + i * (viewW + 3);
            doc.setFillColor(...colors.sectionBg);
            doc.rect(vx, y, viewW, labelH, 'F');
            doc.setFontSize(6);
            doc.setTextColor(...colors.headerText);
            doc.setFont('helvetica', 'bold');
            doc.text(cv.label, vx + viewW / 2, y + 4.2, { align: 'center' });
            if (canvas) {
                try {
                    const imgData = canvas.toDataURL('image/png');
                    doc.addImage(imgData, 'PNG', vx, y + labelH, viewW, imgH);
                } catch (e) {
                    doc.setFillColor(240, 240, 240);
                    doc.rect(vx, y + labelH, viewW, imgH, 'F');
                    doc.setFontSize(8);
                    doc.setTextColor(...colors.muted);
                    doc.text('Canvas not available', vx + viewW / 2, y + labelH + imgH / 2, { align: 'center' });
                }
            }
            doc.setDrawColor(...colors.line);
            doc.rect(vx, y, viewW, viewH, 'S');
        });
        y += viewH + 6;
    
        // ---- BILL OF MATERIALS TABLE ----
        checkPageBreak(20);
        doc.setFillColor(...colors.sectionBg);
        doc.rect(margin, y, contentW, 7, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.headerText);
        doc.text('BILL OF MATERIALS', margin + 4, y + 5);
        y += 9;
    
        const bomRows = [];
        bomRows.push([{ content: 'STRUCTURE', colSpan: 4, styles: { fillColor: [230, 230, 235], fontStyle: 'bold', fontSize: 7.5, textColor: colors.sectionBg } }]);
        bom.structureItems.forEach(r => {
            bomRows.push([
                `${r.qty}x`,
                r.item,
                `$${formatNumber(r.unit, 2)}`,
                `$${formatNumber(r.total, 2)}`
            ]);
        });
        bomRows.push([
            { content: '', styles: { fillColor: colors.subtotalBg } },
            { content: 'Structure Subtotal', styles: { fontStyle: 'bold', fillColor: colors.subtotalBg } },
            { content: '', styles: { fillColor: colors.subtotalBg } },
            { content: `$${formatNumber(bom.structureCost, 2)}`, styles: { fontStyle: 'bold', fillColor: colors.subtotalBg } }
        ]);
    
        if (bom.solarEnabled && bom.powerItems.length > 0) {
            bomRows.push([{ content: 'POWER', colSpan: 4, styles: { fillColor: [230, 230, 235], fontStyle: 'bold', fontSize: 7.5, textColor: colors.sectionBg } }]);
            bom.powerItems.forEach(r => {
                bomRows.push([
                    `${r.qty}x`,
                    r.item,
                    `$${formatNumber(r.unit, 2)}`,
                    `$${formatNumber(r.total, 2)}`
                ]);
            });
            bomRows.push([
                { content: '', styles: { fillColor: colors.subtotalBg } },
                { content: 'Power Subtotal', styles: { fontStyle: 'bold', fillColor: colors.subtotalBg } },
                { content: '', styles: { fillColor: colors.subtotalBg } },
                { content: `$${formatNumber(bom.powerCost, 2)}`, styles: { fontStyle: 'bold', fillColor: colors.subtotalBg } }
            ]);
        }
    
        bomRows.push([
            { content: '', styles: { fillColor: colors.headerBg, textColor: colors.headerText } },
            { content: 'ESTIMATED TOTAL', styles: { fontStyle: 'bold', fillColor: colors.headerBg, textColor: colors.headerText, fontSize: 9 } },
            { content: '', styles: { fillColor: colors.headerBg, textColor: colors.headerText } },
            { content: `$${formatNumber(bom.totalCost, 2)}`, styles: { fontStyle: 'bold', fillColor: colors.headerBg, textColor: colors.headerText, fontSize: 10 } }
        ]);
    
        doc.autoTable({
            startY: y,
            margin: { left: margin, right: margin },
            head: [['Qty', 'Item', 'Unit Price', 'Total']],
            body: bomRows,
            theme: 'grid',
            headStyles: { fillColor: colors.headerBg, textColor: colors.headerText, fontStyle: 'bold', fontSize: 7.5, cellPadding: 2.5 },
            styles: { fontSize: 8, cellPadding: 2.2, textColor: colors.text, lineColor: [220, 220, 220], lineWidth: 0.25 },
            columnStyles: {
                0: { cellWidth: 16, halign: 'center', fontStyle: 'bold' },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 24, halign: 'right' },
                3: { cellWidth: 26, halign: 'right', fontStyle: 'bold' },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
        });
        y = doc.lastAutoTable.finalY + 4;
    
        // ---- WEIGHT BREAKDOWN ----
        checkPageBreak(30);
        doc.setFillColor(...colors.sectionBg);
        doc.rect(margin, y, contentW, 7, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.headerText);
        doc.text('WEIGHT BREAKDOWN', margin + 4, y + 5);
        y += 9;
    
        const weightRows = [
            ['Horizontal Beams', `${unitConverter.formatWeightWithUnit(bom.hBeamWeight, 1)}`],
            ['Vertical Beams', `${unitConverter.formatWeightWithUnit(bom.vBeamWeight, 1)}`],
            ['Brackets', `${unitConverter.formatWeightWithUnit(bom.bracketWeight, 1)}`],
            ['Bolts', `${unitConverter.formatWeightWithUnit(bom.boltWeight, 1)}`],
        ];
        if (bom.solarEnabled && bom.solarPanelWeight > 0) {
            weightRows.push(['Solar Panels', `${unitConverter.formatWeightWithUnit(bom.solarPanelWeight, 1)}`]);
        }
        weightRows.push([
            { content: 'TOTAL WEIGHT', styles: { fontStyle: 'bold', fillColor: colors.headerBg, textColor: colors.headerText } },
            { content: `${unitConverter.formatWeightWithUnit(bom.totalWeight, 1)}`, styles: { fontStyle: 'bold', fillColor: colors.headerBg, textColor: colors.headerText } }
        ]);
    
        doc.autoTable({
            startY: y,
            margin: { left: margin, right: margin + contentW * 0.5 },
            body: weightRows,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2.2, textColor: colors.text, lineColor: [220, 220, 220], lineWidth: 0.25 },
            columnStyles: {
                0: { cellWidth: 'auto' },
                1: { cellWidth: 30, halign: 'right', fontStyle: 'bold' },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
        });
        y = doc.lastAutoTable.finalY + 6;
    
        // ---- BEAM SPECIFICATIONS ----
        checkPageBreak(50);
        doc.setFillColor(...colors.sectionBg);
        doc.rect(margin, y, contentW, 7, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.headerText);
        doc.text('BEAM SPECIFICATIONS', margin + 4, y + 5);
        y += 9;
    
        const beamSpecRows = [
            [{ content: 'Horizontal Beams', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [230, 230, 235], textColor: colors.sectionBg } }],
            ['Dimensions', `${unitConverter.formatDimensionWithUnit(state.hBeamW, 2)} x ${unitConverter.formatDimensionWithUnit(state.hBeamT, 2)} x ${unitConverter.formatDimensionWithUnit(state.hLengthFt * 12, 1)}`],
            ['Stack Count', `${state.hStackCount}`],
            [{ content: 'Vertical Beams', colSpan: 2, styles: { fontStyle: 'bold', fillColor: [230, 230, 235], textColor: colors.sectionBg } }],
            ['Dimensions', !getVBeamCountsByType().linked
                ? `Inner ${unitConverter.formatDimensionWithUnit(state.vBeamInnerW, 2)} x ${unitConverter.formatDimensionWithUnit(state.vBeamInnerT, 2)} / Outer ${unitConverter.formatDimensionWithUnit(state.vBeamOuterW, 2)} x ${unitConverter.formatDimensionWithUnit(state.vBeamOuterT, 2)} x ${unitConverter.formatDimensionWithUnit(state.vLengthFt * 12, 1)}`
                : `${unitConverter.formatDimensionWithUnit(state.vBeamW, 2)} x ${unitConverter.formatDimensionWithUnit(state.vBeamT, 2)} x ${unitConverter.formatDimensionWithUnit(state.vLengthFt * 12, 1)}`],
            ['Stack Count', `${state.vStackCount}`],
            ['H-Stack Gap', `${unitConverter.formatDimensionWithUnit(state.hStackGap, 2)}`],
            ['V-Stack Gap', `${unitConverter.formatDimensionWithUnit(state.vStackGap, 2)}`],
        ];
    
        doc.autoTable({
            startY: y,
            margin: { left: margin, right: margin + contentW * 0.4 },
            body: beamSpecRows,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2.2, textColor: colors.text, lineColor: [220, 220, 220], lineWidth: 0.25 },
            columnStyles: {
                0: { cellWidth: 'auto', textColor: colors.muted },
                1: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
        });
        y = doc.lastAutoTable.finalY + 6;
    
        // ---- HARDWARE ----
        checkPageBreak(50);
        doc.setFillColor(...colors.sectionBg);
        doc.rect(margin, y, contentW, 7, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.headerText);
        doc.text('HARDWARE', margin + 4, y + 5);
        y += 9;
    
        const boltRows = [];
        if (bom.splitBolts) {
            boltRows.push([`${bom.moduleCount * 2}x`, 'Inner Bolts', `${unitConverter.formatDimensionWithUnit(state.boltDiameter, 3)}`, `${unitConverter.formatDimensionWithUnit(state.vBoltInnerLength, 2)}`]);
            boltRows.push([`${bom.moduleCount * 2}x`, 'Outer Bolts', `${unitConverter.formatDimensionWithUnit(state.boltDiameter, 3)}`, `${unitConverter.formatDimensionWithUnit(state.vBoltOuterLength, 2)}`]);
            boltRows.push([`${bom.moduleCount}x`, 'Center Bolts', `${unitConverter.formatDimensionWithUnit(state.boltDiameter, 3)}`, `${unitConverter.formatDimensionWithUnit(state.vBoltLength, 2)}`]);
        } else {
            boltRows.push([`${bom.moduleCount * 5}x`, 'V-Stack Bolts', `${unitConverter.formatDimensionWithUnit(state.boltDiameter, 3)}`, `${unitConverter.formatDimensionWithUnit(state.vBoltLength, 2)}`]);
        }
        boltRows.push([`${bom.moduleCount * 2}x`, 'H-Center Bolts', `${unitConverter.formatDimensionWithUnit(state.boltDiameter, 3)}`, `${unitConverter.formatDimensionWithUnit(state.hBoltLength, 2)}`]);
        boltRows.push([`${bom.moduleCount * 4}x`, 'H-Pivot Bolts', `${unitConverter.formatDimensionWithUnit(state.boltDiameter, 3)}`, `${unitConverter.formatDimensionWithUnit(state.hPivotBoltLength, 2)}`]);
        boltRows.push([
            { content: `${bom.nBolts} total`, colSpan: 4, styles: { fontStyle: 'bold', halign: 'right', fillColor: colors.subtotalBg } }
        ]);
    
        doc.autoTable({
            startY: y,
            margin: { left: margin, right: margin },
            head: [['Qty', 'Type', 'Diameter', 'Length']],
            body: boltRows,
            theme: 'grid',
            headStyles: { fillColor: colors.headerBg, textColor: colors.headerText, fontStyle: 'bold', fontSize: 7.5, cellPadding: 2.5 },
            styles: { fontSize: 8, cellPadding: 2.2, textColor: colors.text, lineColor: [220, 220, 220], lineWidth: 0.25 },
            columnStyles: {
                0: { cellWidth: 20, halign: 'center', fontStyle: 'bold' },
                1: { cellWidth: 'auto' },
                2: { cellWidth: 25, halign: 'center' },
                3: { cellWidth: 25, halign: 'right', fontStyle: 'bold' },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
        });
        y = doc.lastAutoTable.finalY + 4;
    
        const bracketRows = [
            ['Total Brackets', `${bom.moduleCount * 4}`],
            ['Width', `${unitConverter.formatDimensionWithUnit(state.bracketWidth || 2.0, 2)}`],
            ['Depth', `${unitConverter.formatDimensionWithUnit(state.bracketDepth || 3.0, 2)}`],
            ['Height', `${unitConverter.formatDimensionWithUnit(state.bracketHeight || 3.0, 2)}`],
            ['Wall Thickness', `${unitConverter.formatDimensionWithUnit(state.bracketWallThickness || 0.25, 2)}`],
            ['Hole Diameter', `${unitConverter.formatDimensionWithUnit(state.bracketHoleDiameter || 0.375, 3)}`],
        ];
    
        doc.autoTable({
            startY: y,
            margin: { left: margin, right: margin + contentW * 0.5 },
            head: [[{ content: 'Brackets (U-Shape)', colSpan: 2, styles: { fillColor: colors.headerBg, textColor: colors.headerText } }]],
            body: bracketRows,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2.2, textColor: colors.text, lineColor: [220, 220, 220], lineWidth: 0.25 },
            columnStyles: {
                0: { cellWidth: 'auto', textColor: colors.muted },
                1: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
        });
        y = doc.lastAutoTable.finalY + 6;
    
        // ---- STRUCTURE PARAMETERS ----
        checkPageBreak(50);
        doc.setFillColor(...colors.sectionBg);
        doc.rect(margin, y, contentW, 7, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.headerText);
        doc.text('STRUCTURE PARAMETERS', margin + 4, y + 5);
        y += 9;
    
        const paramRows = [
            ['Modules', `${state.modules}`],
            ['Fold Angle', `${formatNumber(radToDeg(state.foldAngle), 1)}°`],
            ['Pivot Position', `${formatNumber(state.pivotPct, 1)}%`],
            ['Hoberman Angle', `${formatNumber(state.hobermanAng, 1)}°`],
            ['Pivot Angle', `${formatNumber(state.pivotAng, 1)}°`],
            ['Bracket Height', `${unitConverter.formatDimensionWithUnit(state.bracketHeight, 2)}`],
            ['Top Extension', `${unitConverter.formatDimensionWithUnit(state.offsetTopIn, 2)}`],
            ['Bottom Extension', `${unitConverter.formatDimensionWithUnit(state.offsetBotIn, 2)}`],
            ['V-Beam End Offset', `${unitConverter.formatDimensionWithUnit(state.vertEndOffset, 2)}`],
        ];
    
        doc.autoTable({
            startY: y,
            margin: { left: margin, right: margin + contentW * 0.4 },
            body: paramRows,
            theme: 'grid',
            styles: { fontSize: 8, cellPadding: 2.2, textColor: colors.text, lineColor: [220, 220, 220], lineWidth: 0.25 },
            columnStyles: {
                0: { cellWidth: 'auto', textColor: colors.muted },
                1: { cellWidth: 40, halign: 'right', fontStyle: 'bold' },
            },
            alternateRowStyles: { fillColor: [252, 252, 252] },
        });
        y = doc.lastAutoTable.finalY + 6;
    
        // ---- SOLAR PANEL SPECS (if enabled) ----
        if (bom.solarEnabled && bom.solarPanelCount > 0) {
            checkPageBreak(50);
            doc.setFillColor(...colors.sectionBg);
            doc.rect(margin, y, contentW, 7, 'F');
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...colors.headerText);
            doc.text('SOLAR PANEL SPECIFICATIONS', margin + 4, y + 5);
            y += 9;
    
            const pc = bom.panelConfig;
            const solarRows = [
                ['Panel Count', `${bom.solarPanelCount}`],
                ['Dimensions', `${unitConverter.formatDimensionWithUnit(pc.panelLength || 0, 1)} x ${unitConverter.formatDimensionWithUnit(pc.panelWidth || 0, 1)} x ${unitConverter.formatDimensionWithUnit(pc.panelThickness || 0, 2)}`],
                ['Rated Power (Wmp)', `${pc.ratedWatts || 0} W`],
                ['Weight (each)', `${unitConverter.formatWeightWithUnit(bom.solarPanelCount > 0 ? bom.solarPanelWeight / bom.solarPanelCount : (pc.weight || 0), 1)}`],
                ['Array Weight', `${unitConverter.formatWeightWithUnit(bom.solarPanelWeight, 1)}`],
                ['VOC', `${formatNumber(pc.voc || 0, 1)} V`],
                ['VMP', `${formatNumber(pc.vmp || 0, 1)} V`],
                ['ISC', `${formatNumber(pc.isc || 0, 2)} A`],
                ['IMP', `${formatNumber(pc.imp || 0, 2)} A`],
                [{ content: 'Total Array Capacity', styles: { fontStyle: 'bold' } },
                 { content: `${formatNumber(bom.totalKw, 2)} kW`, styles: { fontStyle: 'bold', textColor: [243, 156, 18] } }],
            ];
    
            doc.autoTable({
                startY: y,
                margin: { left: margin, right: margin + contentW * 0.4 },
                body: solarRows,
                theme: 'grid',
                styles: { fontSize: 8, cellPadding: 2.2, textColor: colors.text, lineColor: [220, 220, 220], lineWidth: 0.25 },
                columnStyles: {
                    0: { cellWidth: 'auto', textColor: colors.muted },
                    1: { cellWidth: 50, halign: 'right', fontStyle: 'bold' },
                },
                alternateRowStyles: { fillColor: [252, 252, 252] },
            });
            y = doc.lastAutoTable.finalY + 6;
        }
    
        // ---- DRILL TEMPLATES ----
        checkPageBreak(40);
        doc.setFillColor(...colors.sectionBg);
        doc.rect(margin, y, contentW, 7, 'F');
        doc.setFontSize(9);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.headerText);
        doc.text('DRILL TEMPLATES', margin + 4, y + 5);
        y += 11;
    
        function drawDrillTemplate(label, totalIn, holes, yPos) {
            const barLeft = margin + 20;
            const barRight = pageW - margin - 10;
            const barW = barRight - barLeft;
            const barH = 8;
            const barY = yPos + 6;
    
            doc.setFontSize(8);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...colors.text);
            doc.text(label, margin, yPos + 3);
    
            doc.setFontSize(6.5);
            doc.setTextColor(...colors.muted);
            doc.text(`${unitConverter.formatDimensionWithUnit(totalIn, 1)}`, barLeft + barW / 2, yPos, { align: 'center' });
    
            doc.setFillColor(220, 200, 168);
            doc.setDrawColor(90, 70, 50);
            doc.roundedRect(barLeft, barY, barW, barH, 1, 1, 'FD');
    
            // Color hole based on its type:
            //   CTR=orange, R#=blue (rcp anchor on top H-beam),
            //   ANCH=blue (rcp anchor on rcp beam), X#=purple (rcp crossing),
            //   default (BOT/TOP/etc) = red
            const colorForHole = (name) => {
                if (name === 'CTR') return [255, 136, 0];
                if (name === 'ANCH' || /^R\d+$/.test(name)) return [34, 85, 204];
                if (/^X\d+$/.test(name)) return [138, 68, 204];
                return [204, 0, 0];
            };
    
            // Stagger labels above/below the bar when there are many holes so they
            // don't overlap. The default places them below; "above" labels go up.
            const sorted = holes.slice().sort((a, b) => a.pos - b.pos);
            const nameToSlot = new Map();
            let lastBelowX = -Infinity;
            sorted.forEach((h, i) => {
                const x = barLeft + (h.pos / totalIn) * barW;
                // If this hole is too close to the previous "below" label, push it above
                const tooClose = (x - lastBelowX) < 11;
                const slot = (holes.length > 4 && tooClose) ? 'above' : 'below';
                if (slot === 'below') lastBelowX = x;
                nameToSlot.set(h, slot);
            });
    
            holes.forEach(h => {
                const hx = barLeft + (h.pos / totalIn) * barW;
                const hy = barY + barH / 2;
                const [r, g, b] = colorForHole(h.name);
                doc.setFillColor(r, g, b);
                doc.setDrawColor(26, 26, 26);
                doc.circle(hx, hy, 2.5, 'FD');
                doc.setFontSize(5.5);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...colors.text);
                const slot = nameToSlot.get(h);
                if (slot === 'above') {
                    doc.text(h.name, hx, barY - 3, { align: 'center' });
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(...colors.muted);
                    doc.text(`${unitConverter.formatDimensionWithUnit(h.pos, 1)}`, hx, barY - 7, { align: 'center' });
                } else {
                    doc.text(h.name, hx, barY + barH + 5, { align: 'center' });
                    doc.setFont('helvetica', 'normal');
                    doc.setTextColor(...colors.muted);
                    doc.text(`${unitConverter.formatDimensionWithUnit(h.pos, 1)}`, hx, barY + barH + 9, { align: 'center' });
                }
            });
    
            return yPos + barH + 18;
        }
    
        const rcpDrill = bom.rcpDrill || { hasReciprocal: false, rcpAnchorsOnH: [], rcpCrossPositions: [], rcpBeamLength: 0, rcpAnchorPos: 0 };
    
        if (rcpDrill.hasReciprocal && rcpDrill.rcpAnchorsOnH.length > 0) {
            const topHoles = [
                { name: 'BOT', pos: state.offsetBotIn },
                { name: 'CTR', pos: bom.pivotDistFromBottom },
                { name: 'TOP', pos: bom.hTotIn - state.offsetTopIn },
                ...rcpDrill.rcpAnchorsOnH.map(h => ({ name: h.label, pos: h.pos }))
            ];
            y = drawDrillTemplate(
                `Top Ring H-Beam — w/ Reciprocal Anchors (${unitConverter.formatFeetWithUnit(state.hLengthFt)})`,
                bom.hTotIn,
                topHoles,
                y
            );
    
            y = drawDrillTemplate(
                `Bottom Ring H-Beam (${unitConverter.formatFeetWithUnit(state.hLengthFt)})`,
                bom.hTotIn,
                [
                    { name: 'BOT', pos: state.offsetBotIn },
                    { name: 'CTR', pos: bom.pivotDistFromBottom },
                    { name: 'TOP', pos: bom.hTotIn - state.offsetTopIn }
                ],
                y + 2
            );
        } else {
            y = drawDrillTemplate(
                `Horizontal Beam (${unitConverter.formatFeetWithUnit(state.hLengthFt)})`,
                bom.hTotIn,
                [
                    { name: 'BOT', pos: state.offsetBotIn },
                    { name: 'CTR', pos: bom.pivotDistFromBottom },
                    { name: 'TOP', pos: bom.hTotIn - state.offsetTopIn }
                ],
                y
            );
        }
    
        y = drawDrillTemplate(
            `Vertical Beam (${unitConverter.formatFeetWithUnit(state.vLengthFt)})`,
            bom.vTotIn,
            [
                { name: 'BOT', pos: bom.vBottomPivot },
                { name: 'CTR', pos: bom.vCenterPivot },
                { name: 'TOP', pos: bom.vTopPivot }
            ],
            y + 2
        );
    
        if (rcpDrill.hasReciprocal && rcpDrill.rcpBeamLength > 0) {
            const rcpHoles = [
                { name: 'ANCH', pos: rcpDrill.rcpAnchorPos },
                ...rcpDrill.rcpCrossPositions.map(h => ({ name: h.label, pos: h.pos }))
            ];
            const rcpFt = rcpDrill.rcpBeamLength / INCHES_PER_FOOT;
            y = drawDrillTemplate(
                `Reciprocal Beam (${unitConverter.formatFeetWithUnit(rcpFt)})`,
                rcpDrill.rcpBeamLength,
                rcpHoles,
                y + 2
            );
        }
    
        // ---- BRACKET DETAIL ----
        const bracketCanvas = document.getElementById('guide-bracket-front');
        const bracketSideCanvas = document.getElementById('guide-bracket-side');
        if (bracketCanvas || bracketSideCanvas) {
            checkPageBreak(60);
            doc.setFillColor(...colors.sectionBg);
            doc.rect(margin, y, contentW, 7, 'F');
            doc.setFontSize(9);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...colors.headerText);
            doc.text('U-BRACKET DETAIL', margin + 4, y + 5);
            y += 10;
    
            const bracketImgW = contentW * 0.35;
            const bracketImgH = bracketImgW * 0.9;
            if (bracketCanvas) {
                try {
                    doc.addImage(bracketCanvas.toDataURL('image/png'), 'PNG', margin, y, bracketImgW, bracketImgH);
                    doc.setDrawColor(...colors.line);
                    doc.rect(margin, y, bracketImgW, bracketImgH, 'S');
                } catch (e) { /* canvas tainted */ }
            }
            if (bracketSideCanvas) {
                try {
                    doc.addImage(bracketSideCanvas.toDataURL('image/png'), 'PNG', margin + bracketImgW + 4, y, bracketImgW * 0.7, bracketImgH);
                    doc.setDrawColor(...colors.line);
                    doc.rect(margin + bracketImgW + 4, y, bracketImgW * 0.7, bracketImgH, 'S');
                } catch (e) { /* canvas tainted */ }
            }
            y += bracketImgH + 6;
        }
    
        // ---- NOTES ----
        const notes = [
            'All measurements are from beam end',
            'Drill holes centered on beam width',
            'Red = end bracket holes, Orange = center pivot',
            'BOT = Bottom bracket, CTR = Center pivot, TOP = Top bracket',
        ];
        if (rcpDrill.hasReciprocal && rcpDrill.rcpAnchorsOnH.length > 0) {
            notes.push('Blue R# = reciprocal anchor bolts on top H-beams (top ring only)');
        }
        if (rcpDrill.hasReciprocal && rcpDrill.rcpCrossPositions.length > 0) {
            notes.push('Purple X# = crossing bolts on reciprocal beams; ANCH = vertical anchor at the top-ring end');
        }
        const notesBoxH = 10 + notes.length * 3.2 + 4;
        checkPageBreak(notesBoxH + 6);
        doc.setFillColor(52, 152, 219);
        doc.rect(margin, y, 1.5, notesBoxH, 'F');
        doc.setFillColor(...colors.lightBg);
        doc.rect(margin + 1.5, y, contentW - 1.5, notesBoxH, 'F');
        doc.setDrawColor(...colors.line);
        doc.rect(margin, y, contentW, notesBoxH, 'S');
    
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...colors.text);
        doc.text('NOTES', margin + 5, y + 5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...colors.muted);
        notes.forEach((n, i) => {
            doc.text(`•  ${n}`, margin + 5, y + 10 + i * 3.2);
        });
        y += notesBoxH;
    
        addFooter(doc.getNumberOfPages());
    
        // Add footers to all pages
        const totalPages = doc.getNumberOfPages();
        for (let p = 1; p <= totalPages; p++) {
            doc.setPage(p);
            addFooter(p);
        }
    
        doc.save(`LinkageLab_BuildGuide_${Date.now()}.pdf`);
        showToast('Build Guide PDF exported successfully', 'success');
    
        } catch (err) {
            console.error('[PDF Export] Failed:', err);
            showToast('PDF export failed: ' + err.message, 'error');
        }
    }
    
    /**
     * Exports an itemized BOM/budget as a CSV file with Structure and Power sections,
     * subtotals, and a grand total.
     */
    function exportBOMcsv() {
        const bom = gatherBOMData();
        const rows = [];
    
        rows.push(['LinkageLab Build Guide - Bill of Materials']);
        rows.push([`Generated: ${new Date().toLocaleDateString()}`]);
        rows.push([]);
        rows.push(['Section', 'Qty', 'Item', 'Unit Price', 'Line Total']);
    
        // ---- STRUCTURE ----
        rows.push([]);
        rows.push(['STRUCTURE', '', '', '', '']);
        bom.structureItems.forEach(r => {
            rows.push([
                '',
                r.qty,
                r.item,
                `$${formatNumber(r.unit, 2)}`,
                `$${formatNumber(r.total, 2)}`
            ]);
        });
        rows.push(['', '', '', 'Structure Subtotal:', `$${formatNumber(bom.structureCost, 2)}`]);
    
        // ---- POWER ----
        if (bom.solarEnabled && bom.powerItems.length > 0) {
            rows.push([]);
            rows.push(['POWER', '', '', '', '']);
            bom.powerItems.forEach(r => {
                rows.push([
                    '',
                    r.qty,
                    r.item,
                    `$${formatNumber(r.unit, 2)}`,
                    `$${formatNumber(r.total, 2)}`
                ]);
            });
            rows.push(['', '', '', 'Power Subtotal:', `$${formatNumber(bom.powerCost, 2)}`]);
        }
    
        // ---- GRAND TOTAL ----
        rows.push([]);
        rows.push(['', '', '', 'ESTIMATED TOTAL:', `$${formatNumber(bom.totalCost, 2)}`]);
    
        // ---- WEIGHT SUMMARY ----
        rows.push([]);
        rows.push(['WEIGHT BREAKDOWN', '', '', '', '']);
        rows.push(['', '', 'Horizontal Beams', '', `${unitConverter.formatWeightWithUnit(bom.hBeamWeight, 1)}`]);
        rows.push(['', '', 'Vertical Beams', '', `${unitConverter.formatWeightWithUnit(bom.vBeamWeight, 1)}`]);
        rows.push(['', '', 'Brackets', '', `${unitConverter.formatWeightWithUnit(bom.bracketWeight, 1)}`]);
        rows.push(['', '', 'Bolts', '', `${unitConverter.formatWeightWithUnit(bom.boltWeight, 1)}`]);
        if (bom.supportBeamWeight > 0) {
            rows.push(['', '', 'Support beams & hardware', '', `${unitConverter.formatWeightWithUnit(bom.supportBeamWeight, 1)}`]);
        }
        if (bom.solarEnabled && bom.solarPanelWeight > 0) {
            rows.push(['', '', 'Solar Panels', '', `${unitConverter.formatWeightWithUnit(bom.solarPanelWeight, 1)}`]);
        }
        rows.push(['', '', '', 'Total Weight:', `${unitConverter.formatWeightWithUnit(bom.totalWeight, 1)}`]);
    
        // Build CSV string with proper escaping
        const csvContent = rows.map(row =>
            row.map(cell => {
                const s = String(cell ?? '');
                if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                    return '"' + s.replace(/"/g, '""') + '"';
                }
                return s;
            }).join(',')
        ).join('\r\n');
    
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `LinkageLab_BOM_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('BOM spreadsheet exported as CSV', 'success');
    }
    
    /**
     * Legacy function - now shows popup instead of exporting JPEG
     * @deprecated Use showBuildGuide() instead
     */
    function exportBuildGuide() {
        showBuildGuide();
    }
    

    g.LinkageModules = g.LinkageModules || {};
    g.LinkageModules.buildGuide = { computeReciprocalDrillData, showBuildGuide, renderGuideView, renderBracketDiagram, drawArrow, closeBuildGuide, exportGuideJSON, recalcGuideBOM, gatherBOMData, exportGuidePDF, exportBOMcsv, exportBuildGuide, initBuildGuideHandlers };
    g.computeReciprocalDrillData = computeReciprocalDrillData;
    g.showBuildGuide = showBuildGuide;
    g.renderGuideView = renderGuideView;
    g.renderBracketDiagram = renderBracketDiagram;
    g.drawArrow = drawArrow;
    g.closeBuildGuide = closeBuildGuide;
    g.exportGuideJSON = exportGuideJSON;
    g.recalcGuideBOM = recalcGuideBOM;
    g.gatherBOMData = gatherBOMData;
    g.exportGuidePDF = exportGuidePDF;
    g.exportBOMcsv = exportBOMcsv;
    g.exportBuildGuide = exportBuildGuide;
    g.initBuildGuideHandlers = initBuildGuideHandlers;

})(window);

