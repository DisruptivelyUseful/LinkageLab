// ============================================================================
// BUILD GUIDE FUNCTIONS
// ============================================================================

function showBuildGuide() {
    const data = solveLinkage(state.foldAngle);
    
    // Calculate solar panels if enabled
    if (state.solarPanels.enabled) {
        const solarData = calculateSolarPanels(data);
        data.panels = solarData.panels;
        data.supportBeams = solarData.supportBeams;
        data.canopy = solarData.canopy;
    } else {
        data.panels = [];
    }
    
    // Calculate BOM
    const moduleCount = state.modules;
    const hBeams = moduleCount * 2 * state.hStackCount;
    const vBeams = moduleCount * state.vStackCount;
    const uBrackets = moduleCount * 4;
    const nBolts = moduleCount * (4 + 2 + 2);
    const hBeamsCost = hBeams * state.costHBeam;
    const vBeamsCost = vBeams * state.costVBeam;
    const bracketCost = uBrackets * state.costBracket;
    const boltCost = nBolts * state.costBolt;
    
    // Solar panel calculations
    const solarEnabled = state.solarPanels.enabled;
    const solarPanelCount = solarEnabled && data.panels ? data.panels.length : 0;
    const solarPanelCost = solarPanelCount * state.costSolarPanel;
    const totalWatts = solarPanelCount * state.solarPanels.ratedWatts;
    const totalKw = totalWatts / 1000;
    
    const totalCost = hBeamsCost + vBeamsCost + boltCost + bracketCost + solarPanelCost;
    
    // Calculate dimensions
    const heightFt = data.maxHeight / INCHES_PER_FOOT;
    const diameterFt = (data.maxRad * 2) / INCHES_PER_FOOT;
    const actuatorInfo = calculateActuatorStroke();
    
    // Drill hole calculations
    const hTotIn = state.hLengthFt * INCHES_PER_FOOT;
    const hActiveIn = hTotIn - state.offsetTopIn - state.offsetBotIn;
    const pivotRatio = state.pivotPct / 100;
    const pivotDistFromBottom = state.offsetBotIn + (hActiveIn * pivotRatio);
    
    const vTotIn = state.vLengthFt * INCHES_PER_FOOT;
    const vBottomPivot = state.bracketOffset;
    const vTopPivot = vTotIn - state.bracketOffset;
    const vCenterPivot = vTotIn / 2;
    
    // Calculate proportional beam widths (scale to same reference)
    const maxBeamLength = Math.max(hTotIn, vTotIn);
    const hBeamWidthPct = (hTotIn / maxBeamLength) * 100;
    const vBeamWidthPct = (vTotIn / maxBeamLength) * 100;
    // Calculate margins to center the shorter beam
    const hBeamMargin = (100 - hBeamWidthPct) / 2;
    const vBeamMargin = (100 - vBeamWidthPct) / 2;
    
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
                <span class="guide-stat-value">${formatNumber(heightFt, 1)}'</span>
            </div>
            <div class="guide-stat">
                <span class="guide-stat-label">Diameter</span>
                <span class="guide-stat-value">${formatNumber(diameterFt, 1)}'</span>
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
                <span class="guide-stat-value">${formatNumber(actuatorInfo.stroke, 2)}"</span>
            </div>
            ${solarStatsHtml}
            <div class="guide-stat">
                <span class="guide-stat-label">Est. Total</span>
                <span class="guide-stat-value highlight">$${formatNumber(totalCost, 2)}</span>
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
                    <table class="guide-table">
                        <thead>
                            <tr>
                                <th style="width: 50px;">Qty</th>
                                <th style="min-width: 120px;">Item</th>
                        </thead>
                        <tbody>
                            <tr>
                                <td>${hBeams}</td>
                                <td>Horizontal Beams</td>
                            </tr>
                            <tr>
                                <td>${vBeams}</td>
                                <td>Vertical Beams</td>
                            </tr>
                            <tr>
                                <td>${uBrackets}</td>
                                <td>U-Brackets</td>
                            </tr>
                            <tr>
                                <td>${nBolts}</td>
                                <td>Bolts</td>
                            </tr>
                            ${solarEnabled ? `<tr>
                                <td>${solarPanelCount}</td>
                                <td>Solar Panels</td>
                            </tr>` : ''}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="guide-card">
                <div class="guide-card-header">Beam Specifications</div>
                <div class="guide-card-content">
                    <div style="margin-bottom: 15px;">
                        <div style="font-weight: 600; color: #2c3e50; margin-bottom: 8px;">Horizontal Beams</div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Dimensions</span>
                            <span class="guide-spec-value">${state.hBeamW}" × ${state.hBeamT}" × ${state.hLengthFt * 12}"</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Stack Count</span>
                            <span class="guide-spec-value">${state.hStackCount}</span>
                        </div>
                    </div>
                    <div>
                        <div style="font-weight: 600; color: #2c3e50; margin-bottom: 8px;">Vertical Beams</div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Dimensions</span>
                            <span class="guide-spec-value">${state.vBeamW}" ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${state.vBeamT}" ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${state.vLengthFt * 12}"</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Stack Count</span>
                            <span class="guide-spec-value">${state.vStackCount}</span>
                        </div>
                        <div class="guide-spec-row">
                            <span class="guide-spec-label">Stack Gap</span>
                            <span class="guide-spec-value">${formatNumber(state.stackGap, 2)}"</span>
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
                        <span class="guide-spec-value">${formatNumber(radToDeg(state.foldAngle), 1)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">Pivot Position</span>
                        <span class="guide-spec-value">${formatNumber(state.pivotPct, 1)}%</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">Hoberman Angle</span>
                        <span class="guide-spec-value">${formatNumber(state.hobermanAng, 1)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">Pivot Angle</span>
                        <span class="guide-spec-value">${formatNumber(state.pivotAng, 1)}ÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â°</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">Bracket Gap</span>
                        <span class="guide-spec-value">${formatNumber(state.bracketOffset, 2)}"</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">Top Extension</span>
                        <span class="guide-spec-value">${formatNumber(state.offsetTopIn, 2)}"</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">Bottom Extension</span>
                        <span class="guide-spec-value">${formatNumber(state.offsetBotIn, 2)}"</span>
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
                        <span class="guide-spec-value">${state.solarPanels.panelLength}" ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${state.solarPanels.panelWidth}" ÃƒÆ’Ã†â€™ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â ${state.solarPanels.panelThickness}"</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">Rated Power (Wmp)</span>
                        <span class="guide-spec-value">${state.solarPanels.ratedWatts} W</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">VOC</span>
                        <span class="guide-spec-value">${state.solarPanels.voc} V</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">VMP</span>
                        <span class="guide-spec-value">${state.solarPanels.vmp} V</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">ISC</span>
                        <span class="guide-spec-value">${state.solarPanels.isc} A</span>
                    </div>
                    <div class="guide-spec-row">
                        <span class="guide-spec-label">IMP</span>
                        <span class="guide-spec-value">${state.solarPanels.imp} A</span>
                    </div>
                    <div class="guide-spec-row" style="margin-top: 10px; padding-top: 10px; border-top: 2px solid #e0d8cc;">
                        <span class="guide-spec-label" style="font-weight: 600;">Total Array Capacity</span>
                        <span class="guide-spec-value" style="color: #f39c12; font-size: 1.1rem;">${formatNumber(totalKw, 2)} kW</span>
                    </div>
                </div>
            </div>` : ''}
        </div>
        
        <div class="guide-beam-diagram">
            <div class="guide-beam-title">Horizontal Beam Drill Template (${state.hLengthFt}')</div>
            <div class="guide-beam-visual">
                <div class="guide-beam-dimension" style="left: ${hBeamMargin}%; right: ${hBeamMargin}%;">
                    <span class="guide-beam-dimension-label">${formatNumber(hTotIn, 1)}" (${state.hLengthFt}')</span>
                </div>
                <div class="guide-beam-bar" style="left: ${hBeamMargin}%; right: ${hBeamMargin}%;">
                    <div class="guide-beam-hole" style="left: ${(state.offsetBotIn / hTotIn) * 100}%">
                        <div class="guide-beam-label">
                            <div class="guide-beam-label-name">BOT</div>
                            <div class="guide-beam-label-value">${formatNumber(state.offsetBotIn, 1)}"</div>
                        </div>
                    </div>
                    <div class="guide-beam-hole" style="left: ${(pivotDistFromBottom / hTotIn) * 100}%">
                        <div class="guide-beam-label">
                            <div class="guide-beam-label-name">CTR</div>
                            <div class="guide-beam-label-value">${formatNumber(pivotDistFromBottom, 1)}"</div>
                        </div>
                    </div>
                    <div class="guide-beam-hole" style="left: ${((hTotIn - state.offsetTopIn) / hTotIn) * 100}%">
                        <div class="guide-beam-label">
                            <div class="guide-beam-label-name">TOP</div>
                            <div class="guide-beam-label-value">${formatNumber(hTotIn - state.offsetTopIn, 1)}"</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="guide-beam-diagram">
            <div class="guide-beam-title">Vertical Beam Drill Template (${state.vLengthFt}')</div>
            <div class="guide-beam-visual">
                <div class="guide-beam-dimension" style="left: ${vBeamMargin}%; right: ${vBeamMargin}%;">
                    <span class="guide-beam-dimension-label">${formatNumber(vTotIn, 1)}" (${state.vLengthFt}')</span>
                </div>
                <div class="guide-beam-bar" style="left: ${vBeamMargin}%; right: ${vBeamMargin}%;">
                    <div class="guide-beam-hole" style="left: ${(vBottomPivot / vTotIn) * 100}%">
                        <div class="guide-beam-label">
                            <div class="guide-beam-label-name">BOT</div>
                            <div class="guide-beam-label-value">${formatNumber(vBottomPivot, 1)}"</div>
                        </div>
                    </div>
                    <div class="guide-beam-hole" style="left: ${(vCenterPivot / vTotIn) * 100}%">
                        <div class="guide-beam-label">
                            <div class="guide-beam-label-name">CTR</div>
                            <div class="guide-beam-label-value">${formatNumber(vCenterPivot, 1)}"</div>
                        </div>
                    </div>
                    <div class="guide-beam-hole" style="left: ${(vTopPivot / vTotIn) * 100}%">
                        <div class="guide-beam-label">
                            <div class="guide-beam-label-name">TOP</div>
                            <div class="guide-beam-label-value">${formatNumber(vTopPivot, 1)}"</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        
        <div style="background: #fff; border: 1px solid #e0d8cc; border-radius: 6px; padding: 15px; margin-top: 10px;">
            <div style="font-weight: 600; color: #2c3e50; margin-bottom: 8px;">ÃƒÆ’Ã‚Â°Ãƒâ€¦Ã‚Â¸ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œÃƒâ€šÃ‚Â Notes</div>
            <ul style="margin: 0; padding-left: 20px; color: #666; font-size: 0.9rem; line-height: 1.6;">
                <li>All measurements are from beam end</li>
                <li>Drill holes 3/8" diameter, centered on beam width</li>
                <li>Red circles indicate pivot hole locations</li>
                <li>BOT = Bottom bracket connection, CTR = Center pivot, TOP = Top bracket connection</li>
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
    }, 100);
}

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
    
    data.beams.forEach(beam => {
        beam.corners.forEach(updateBounds3D);
    
    // Include solar panels in bounding box
    if (data.panels && data.panels.length > 0) {
        data.panels.forEach(panel => {
            panel.corners.forEach(updateBounds3D);
    
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
        } else {
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

function closeBuildGuide() {
    document.getElementById('build-guide-modal').classList.remove('visible');
    document.body.style.overflow = '';
}

function exportGuideJSON() {
    exportToJSON();
}

// Close modal when clicking outside content
document.addEventListener('click', (e) => {
    if (e.target.id === 'build-guide-modal') {
        closeBuildGuide();

// Close modal with Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('build-guide-modal').classList.contains('visible')) {
        closeBuildGuide();

function exportBuildGuide() {
    showBuildGuide();

// ============================================================================
// SAVE/LOAD & PRESETS
// ============================================================================

