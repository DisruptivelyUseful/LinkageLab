// ============================================================================ (ES module)

import { bridgeGlobals } from './global-bridge.js';
import { INCHES_PER_FOOT, WOOD_COLOR } from './constants.js';
import {
    degToRad,
    radToDeg,
    v3,
    vAdd,
    vSub,
    vScale,
    vMag,
    vNorm,
    vCross,
    vDot,
} from './math.js';
import { Beam3D } from './geometry-classes.js';
import { solveLinkage } from './solver.js';
import { getLinkageData, invalidateGeometryCache, invalidateRcpCrossings } from './cache.js';
import { getOptimalClosedAngleForAnimation } from './animation.js';
import { requestRender } from './render-app.js';
import { showToast } from '../core/feedback.js';

    // ============================================================================
    // SOLAR PANEL SYSTEM
    // ============================================================================
    
    /**
     * Calculates the canopy area from the structure geometry
     * For horizontal mode: polygon formed by top ring outer edges
     * For vertical/arch mode: rectangular sections between beams
     * @param {Object} data - Linkage data with beams array
     * @returns {Object} Canopy information including bounds, center, vertices, area
     */
    function calculateCanopyArea(data) {
        if (!data || !data.beams || data.beams.length === 0) {
            return { bounds: null, center: null, vertices: [], area: 0, sections: [], topHeight: 0 };
        }
        
        const isVertical = state.orientation === 'vertical';
        
        if (isVertical) {
            // Arch mode: find rectangular sections between vertical beams on each module
            return calculateArchCanopySections(data);
        }
        
        // Horizontal mode: find the top ring and calculate bounded polygon
        const topBeams = data.beams.filter(b => b.stackType === 'horizontal-top');
        
        if (topBeams.length === 0) {
            return { bounds: null, center: null, vertices: [], area: 0, sections: [], topHeight: 0 };
        }
        
        // Find the height of the top ring (Y coordinate)
        let topHeight = 0;
        topBeams.forEach(beam => {
            const avgY = (beam.p1.y + beam.p2.y) / 2;
            topHeight = Math.max(topHeight, avgY);
        });
        
        // Collect ALL corners from top ring beams to find bounds
        let allCorners = [];
        let maxRadius = 0;
        let sumX = 0, sumZ = 0;
        
        topBeams.forEach(beam => {
            // Get all 8 corners of the beam and find those near the top surface
            beam.corners.forEach(corner => {
                if (Math.abs(corner.y - topHeight) < 5) {
                    const rad = Math.sqrt(corner.x * corner.x + corner.z * corner.z);
                    allCorners.push({x: corner.x, y: topHeight, z: corner.z, rad: rad});
                    sumX += corner.x;
                    sumZ += corner.z;
                    if (rad > maxRadius) maxRadius = rad;
                }
            });
        });
        
        // For a closed ring structure, the center is at the geometric center of all corners
        // This should be very close to (0, topHeight, 0) for a symmetric closed ring
        let centerX = 0, centerZ = 0;
        if (allCorners.length > 0) {
            centerX = sumX / allCorners.length;
            centerZ = sumZ / allCorners.length;
        }
        
        // If the calculated center is very close to origin, use origin
        // This handles closed ring structures where small numerical errors might offset the center
        if (Math.abs(centerX) < maxRadius * 0.1 && Math.abs(centerZ) < maxRadius * 0.1) {
            centerX = 0;
            centerZ = 0;
        }
        
        // Get unique outer vertices (at max radius, within tolerance) for polygon boundary
        const outerVertices = [];
        const radiusThreshold = maxRadius * 0.85;
        
        allCorners.forEach(corner => {
            if (corner.rad > radiusThreshold) {
                // Check if we already have a vertex close to this one
                const exists = outerVertices.some(v => 
                    Math.abs(v.x - corner.x) < 2 && Math.abs(v.z - corner.z) < 2
                );
                if (!exists) {
                    outerVertices.push({x: corner.x, y: topHeight, z: corner.z});
                }
            }
        });
        
        // Sort vertices by angle around the center for proper polygon ordering
        outerVertices.sort((a, b) => {
            const angleA = Math.atan2(a.z - centerZ, a.x - centerX);
            const angleB = Math.atan2(b.z - centerZ, b.x - centerX);
            return angleA - angleB;
        });
        
        // Calculate bounds
        let minX = Infinity, maxX = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        outerVertices.forEach(v => {
            minX = Math.min(minX, v.x);
            maxX = Math.max(maxX, v.x);
            minZ = Math.min(minZ, v.z);
            maxZ = Math.max(maxZ, v.z);
        });
        
        // Calculate polygon area using shoelace formula
        let area = 0;
        for (let i = 0; i < outerVertices.length; i++) {
            const j = (i + 1) % outerVertices.length;
            area += outerVertices[i].x * outerVertices[j].z - outerVertices[j].x * outerVertices[i].z;
        }
        area = Math.abs(area) / 2;
        
        return {
            bounds: { minX, maxX, minZ, maxZ },
            center: { x: centerX, y: topHeight, z: centerZ },
            vertices: outerVertices,
            area: area,
            maxRadius: maxRadius,
            sections: [],
            topHeight: topHeight
        };
    }
    
    /**
     * Calculates canopy sections for arch/vertical mode
     * Each section is a rectangular area between vertical beams
     * @param {Object} data - Linkage data
     * @returns {Object} Canopy sections for arch mode
     */
    function calculateArchCanopySections(data) {
        const sections = [];
        
        // In arch mode, we want to find the accordion faces - the angled surfaces
        // between horizontal beams that form the "roof" of the arch
        // These are the top-facing surfaces of the horizontal rings
        
        const topHBeams = data.beams.filter(b => b.stackType === 'horizontal-top');
        const botHBeams = data.beams.filter(b => b.stackType === 'horizontal-bottom');
        
        if (topHBeams.length === 0 && botHBeams.length === 0) {
            return { bounds: null, center: null, vertices: [], area: 0, sections: [], topHeight: 0 };
        }
        
        // Use the horizontal beams to find accordion faces
        // Each module has a top and bottom horizontal ring
        // The accordion face is the outer surface facing up/outward from the arch
        
        // Group beams by module index
        const moduleTopBeams = {};
        const moduleBotBeams = {};
        
        topHBeams.forEach(beam => {
            const idx = beam.moduleIndex;
            if (!moduleTopBeams[idx]) moduleTopBeams[idx] = [];
            moduleTopBeams[idx].push(beam);
        });
        
        botHBeams.forEach(beam => {
            const idx = beam.moduleIndex;
            if (!moduleBotBeams[idx]) moduleBotBeams[idx] = [];
            moduleBotBeams[idx].push(beam);
        });
        
        let totalArea = 0;
        let overallCenter = {x: 0, y: 0, z: 0};
        let sectionCount = 0;
        
        // For each module, calculate the accordion face (the upward-facing surface)
        const moduleIndices = [...new Set([...Object.keys(moduleTopBeams), ...Object.keys(moduleBotBeams)])];
        
        moduleIndices.forEach(moduleIdx => {
            const topBeams = moduleTopBeams[moduleIdx] || [];
            const botBeams = moduleBotBeams[moduleIdx] || [];
            const allBeams = [...topBeams, ...botBeams];
            
            if (allBeams.length === 0) return;
            
            // Find all corners of horizontal beams in this module
            // The accordion face is defined by the outer corners
            let corners = [];
            let maxZ = -Infinity; // In arch mode, Z is depth (front-back)
            
            allBeams.forEach(beam => {
                beam.corners.forEach(c => {
                    corners.push({...c});
                    if (c.z > maxZ) maxZ = c.z;
                });
            });
            
            // Find the front-facing (max Z) corners - these define the accordion face
            const frontCorners = corners.filter(c => Math.abs(c.z - maxZ) < 5);
            
            if (frontCorners.length < 3) return;
            
            // Calculate bounds and center of this face
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            
            frontCorners.forEach(c => {
                minX = Math.min(minX, c.x);
                maxX = Math.max(maxX, c.x);
                minY = Math.min(minY, c.y);
                maxY = Math.max(maxY, c.y);
            });
            
            const center = {
                x: (minX + maxX) / 2,
                y: (minY + maxY) / 2,
                z: maxZ
            };
            
            // Calculate section dimensions
            const width = maxX - minX;
            const height = maxY - minY;
            const sectionArea = width * height;
            
            // Calculate the normal for this accordion face
            // It points outward from the arch (in Z direction for front faces)
            // But also slightly upward based on the arch angle
            const normal = {x: 0, y: 0, z: 1}; // Will be refined per-panel
            
            sections.push({
                moduleIndex: parseInt(moduleIdx),
                bounds: { minX, maxX, minY, maxY, minZ: maxZ, maxZ: maxZ },
                center: center,
                width: width,
                height: height,
                area: sectionArea,
                normal: normal,
                corners: frontCorners
            });
            
            totalArea += sectionArea;
            overallCenter.x += center.x;
            overallCenter.y += center.y;
            overallCenter.z += center.z;
            sectionCount++;
        });
        
        if (sectionCount > 0) {
            overallCenter.x /= sectionCount;
            overallCenter.y /= sectionCount;
            overallCenter.z /= sectionCount;
        }
        
        return {
            bounds: null,
            center: overallCenter,
            vertices: [],
            area: totalArea,
            sections: sections,
            topHeight: 0
        };
    }
    
    /**
     * Calculates roof faces for arch mode solar panels.
     * 
     * Creates 2 faces per module (for A and B beam patterns), following
     * the zig-zag accordion shape. Faces are defined by matching top and
     * bottom horizontal beams, with normals pointing outward from the arch.
     * 
     * @param {Object} data - Linkage data with beams array
     * @returns {Array} Array of face objects {corners, center, normal, widthAxis, heightAxis, width, height}
     */
    function calculateArchWallFaces(data) {
        const roofFaces = [];
        
        if (!data || !data.beams || data.beams.length === 0) {
            return roofFaces;
        }
        
        // Calculate structure center from all horizontal beams
        // This is used as the "interior" reference point for determining outward direction
        // Using actual beam centers is more accurate than assuming origin, especially after ground tracking
        let structureCenter = {x: 0, y: 0, z: 0};
        let beamCount = 0;
        data.beams.forEach(beam => {
            if (beam.stackType && beam.stackType.startsWith('horizontal') && beam.center) {
                structureCenter.x += beam.center.x;
                structureCenter.y += beam.center.y;
                structureCenter.z += beam.center.z;
                beamCount++;
            }
        });
        if (beamCount > 0) {
            structureCenter = {
                x: structureCenter.x / beamCount,
                y: structureCenter.y / beamCount,
                z: structureCenter.z / beamCount
            };
        }
        
        // Get horizontal beams - these define the roof surfaces
        const topHBeams = data.beams.filter(b => b.stackType === 'horizontal-top');
        const botHBeams = data.beams.filter(b => b.stackType === 'horizontal-bottom');
        
        if (topHBeams.length === 0 || botHBeams.length === 0) {
            return roofFaces;
        }
        
        // Group beams by arrayIndex to handle array mode
        // Each array copy has beams with the same arrayIndex
        const groupByArrayIndex = (beams) => {
            const groups = {};
            beams.forEach(beam => {
                const idx = beam.arrayIndex !== undefined ? beam.arrayIndex : 0;
                if (!groups[idx]) groups[idx] = [];
                groups[idx].push(beam);
            });
            return groups;
        };
        
        const topArrayGroups = groupByArrayIndex(topHBeams);
        const botArrayGroups = groupByArrayIndex(botHBeams);
        
        // Match array groups - top and bottom beams with same arrayIndex belong together
        const matchedGroups = [];
        Object.keys(topArrayGroups).forEach(idx => {
            const topBeams = topArrayGroups[idx];
            const botBeams = botArrayGroups[idx] || [];
            if (topBeams.length > 0 && botBeams.length > 0) {
                matchedGroups.push({ top: topBeams, bot: botBeams });
            }
        });
        
        // For each array group, group beams by module index
        const processArrayGroup = (topBeams, botBeams) => {
            const moduleTopBeams = {};
            const moduleBotBeams = {};
            
            topBeams.forEach(beam => {
                const idx = beam.moduleIndex;
                if (!moduleTopBeams[idx]) moduleTopBeams[idx] = [];
                moduleTopBeams[idx].push(beam);
            });
            
            botBeams.forEach(beam => {
                const idx = beam.moduleIndex;
                if (!moduleBotBeams[idx]) moduleBotBeams[idx] = [];
                moduleBotBeams[idx].push(beam);
            });
            
            return { moduleTopBeams, moduleBotBeams };
        };
        
        // If no groups matched, fall back to treating all beams as one group
        if (matchedGroups.length === 0) {
            matchedGroups.push({ top: topHBeams, bot: botHBeams });
        }
        
        let faceIndex = 0;
        
        // For each array group, process modules
        matchedGroups.forEach(arrayGroup => {
            const { moduleTopBeams, moduleBotBeams } = processArrayGroup(arrayGroup.top, arrayGroup.bot);
            
            // Get sorted module indices for this Z group
            const moduleIndices = [...new Set([...Object.keys(moduleTopBeams), ...Object.keys(moduleBotBeams)])]
                .map(i => parseInt(i))
                .sort((a, b) => a - b);
            
            // For each module, create TWO roof faces (one for each beam pattern A and B)
            moduleIndices.forEach((moduleIdx) => {
                const topBeams = moduleTopBeams[moduleIdx] || [];
                const botBeams = moduleBotBeams[moduleIdx] || [];
            
            if (topBeams.length === 0 || botBeams.length === 0) return;
            
            // Match top beams with bottom beams
            // Beams are created in alternating A/B pattern within each ring
            // We match by comparing the beam's axisX direction - beams of same pattern have parallel axisX
            const matchBeams = (topList, botList) => {
                const pairs = [];
                const usedBot = new Set();
                
                // Sort beams by their position to get consistent ordering
                const sortedTop = [...topList].sort((a, b) => {
                    const aAngle = Math.atan2(a.center.z, a.center.x);
                    const bAngle = Math.atan2(b.center.z, b.center.x);
                    return aAngle - bAngle;
                });
                const sortedBot = [...botList].sort((a, b) => {
                    const aAngle = Math.atan2(a.center.z, a.center.x);
                    const bAngle = Math.atan2(b.center.z, b.center.x);
                    return aAngle - bAngle;
                });
                
                // Match beams by their axisX direction (crossing direction)
                // Beams of same pattern have parallel axisX, opposite patterns have ~perpendicular axisX
                sortedTop.forEach(topBeam => {
                    if (!topBeam.axisX) return;
                    
                    let bestMatch = null;
                    let bestScore = -Infinity;
                    
                    sortedBot.forEach((botBeam, idx) => {
                        if (usedBot.has(idx) || !botBeam.axisX) return;
                        
                        // Score based on how parallel the axisX directions are (same pattern)
                        const crossScore = Math.abs(vDot(topBeam.axisX, botBeam.axisX));
                        
                        // Also score by axisZ alignment (both should point similar direction around ring)
                        const dirScore = Math.abs(vDot(topBeam.axisZ, botBeam.axisZ));
                        
                        // Proximity score
                        const dx = topBeam.center.x - botBeam.center.x;
                        const dz = topBeam.center.z - botBeam.center.z;
                        const dist = Math.sqrt(dx*dx + dz*dz);
                        const proxScore = 1 / (1 + dist * 0.02);
                        
                        const score = crossScore * 0.5 + dirScore * 0.3 + proxScore * 0.2;
                        
                        if (score > bestScore) {
                            bestScore = score;
                            bestMatch = {beam: botBeam, idx: idx};
                        }
                    });
                    
                    if (bestMatch && bestScore > 0.3) {
                        pairs.push({top: topBeam, bot: bestMatch.beam});
                        usedBot.add(bestMatch.idx);
                    }
                });
                
                return pairs;
            };
            
            const beamPairs = matchBeams(topBeams, botBeams);
            
            // Calculate TRUE module center from ALL beams in this module
            // This is the center of the X-crossing and should be the SAME for all faces in the module
            let trueModuleCenter = {x: 0, y: 0, z: 0};
            let beamCountForCenter = 0;
            [...topBeams, ...botBeams].forEach(beam => {
                if (beam.center) {
                    trueModuleCenter.x += beam.center.x;
                    trueModuleCenter.y += beam.center.y;
                    trueModuleCenter.z += beam.center.z;
                    beamCountForCenter++;
                }
            });
            if (beamCountForCenter > 0) {
                trueModuleCenter.x /= beamCountForCenter;
                trueModuleCenter.y /= beamCountForCenter;
                trueModuleCenter.z /= beamCountForCenter;
            }
            
            // Calculate a MODULE-WIDE slide axis from the two crossing beams
            // This axis is perpendicular to the line connecting the two beam centers (in XY plane)
            // This ensures A and B faces use the SAME axis (just flipped) for consistent opposite movement
            let moduleSlideAxis = {x: 0, y: 1, z: 0};  // Default fallback
            if (topBeams.length >= 2) {
                const beam1Center = topBeams[0].center;
                const beam2Center = topBeams[1].center;
                // Direction from beam1 to beam2 in XY plane
                const dx = beam2Center.x - beam1Center.x;
                const dy = beam2Center.y - beam1Center.y;
                const mag = Math.sqrt(dx * dx + dy * dy);
                if (mag > 0.01) {
                    // Perpendicular direction (rotate 90° in XY plane): (-dy, dx)
                    moduleSlideAxis = {x: -dy / mag, y: dx / mag, z: 0};
                }
            }
            
            // Create a face for each beam pair
            // Track which face is A (even index) vs B (odd index) for consistent slide direction
            beamPairs.forEach((pair, pairIndex) => {
                const topBeam = pair.top;
                const botBeam = pair.bot;
                const isAFace = (pairIndex % 2) === 0;  // A faces are even, B faces are odd
                
                if (!topBeam.p1 || !topBeam.p2 || !botBeam.p1 || !botBeam.p2) return;
                
                // The roof face is a quadrilateral spanning from the top beam to the bottom beam
                // We use the beam centerlines (p1, p2) to define the face
                
                // The face lies in a plane defined by:
                // - Width direction: along the beams (p1 to p2)
                // - Height direction: from top beam to bottom beam
                // - Normal: perpendicular to both, pointing outward
                
                // Calculate the four corners by using the beam endpoints
                // Corner mapping for a roof face:
                // tl (top-left) = topBeam.p1
                // tr (top-right) = topBeam.p2
                // bl (bottom-left) = botBeam.p1
                // br (bottom-right) = botBeam.p2
                
                // But we need to ensure consistent orientation
                // Check if bottom beam is oriented the same way as top beam
                const topDir = vNorm(vSub(topBeam.p2, topBeam.p1));
                const botDir = vNorm(vSub(botBeam.p2, botBeam.p1));
                const sameDirection = vDot(topDir, botDir) > 0;
                
                // Calculate face center FIRST (before offsetting corners)
                // This gives us a stable reference for determining "outward"
                const rawCenter = {
                    x: (topBeam.p1.x + topBeam.p2.x + (sameDirection ? botBeam.p1.x : botBeam.p2.x) + (sameDirection ? botBeam.p2.x : botBeam.p1.x)) / 4,
                    y: (topBeam.p1.y + topBeam.p2.y + (sameDirection ? botBeam.p1.y : botBeam.p2.y) + (sameDirection ? botBeam.p2.y : botBeam.p1.y)) / 4,
                    z: (topBeam.p1.z + topBeam.p2.z + (sameDirection ? botBeam.p1.z : botBeam.p2.z) + (sameDirection ? botBeam.p2.z : botBeam.p1.z)) / 4
                };
                
                // Calculate outward direction from structure center to face center
                // IMPORTANT: For vertical arch mode, use XY coordinates only (ignore Z)
                // This ensures "outward" is radial from the arch axis, not influenced by vertical position
                // The arch axis runs along Z, so faces are arrayed around it in the XY plane
                // Using full 3D can cause the dot product to hover near zero and flip at certain angles
                const toFaceFromCenterXY = {
                    x: rawCenter.x - structureCenter.x,
                    y: rawCenter.y - structureCenter.y,
                    z: 0  // Ignore Z for outward direction calculation
                };
                const toFaceMagXY = Math.sqrt(toFaceFromCenterXY.x * toFaceFromCenterXY.x + toFaceFromCenterXY.y * toFaceFromCenterXY.y);
                const outwardDir = toFaceMagXY > 0.01 ? {x: toFaceFromCenterXY.x / toFaceMagXY, y: toFaceFromCenterXY.y / toFaceMagXY, z: 0} : {x: 0, y: 1, z: 0};
                
                // Use the outward direction for corner offset instead of beam.axisY
                // This ensures corners are always offset to the EXTERIOR of the structure
                // regardless of how the beam's local coordinate system is oriented
                const halfThick = (topBeam.t || 1.5) / 2;
                
                let tl = vAdd({...topBeam.p1}, vScale(outwardDir, halfThick));
                let tr = vAdd({...topBeam.p2}, vScale(outwardDir, halfThick));
                let bl, br;
                
                if (sameDirection) {
                    bl = vAdd({...botBeam.p1}, vScale(outwardDir, halfThick));
                    br = vAdd({...botBeam.p2}, vScale(outwardDir, halfThick));
                } else {
                    // Flip bottom beam endpoints
                    bl = vAdd({...botBeam.p2}, vScale(outwardDir, halfThick));
                    br = vAdd({...botBeam.p1}, vScale(outwardDir, halfThick));
                }
                
                // Calculate face geometry
                const topEdge = vSub(tr, tl);  // Width direction (along beam)
                const botEdge = vSub(br, bl);
                const leftEdge = vSub(bl, tl); // Height direction (top to bottom beam)
                const rightEdge = vSub(br, tr);
                
                const width = (vMag(topEdge) + vMag(botEdge)) / 2;
                const height = (vMag(leftEdge) + vMag(rightEdge)) / 2;
                
                if (width < 2 || height < 2) return;
                
                // Face center
                const center = {
                    x: (tl.x + tr.x + bl.x + br.x) / 4,
                    y: (tl.y + tr.y + bl.y + br.y) / 4,
                    z: (tl.z + tr.z + bl.z + br.z) / 4
                };
                
                // Calculate the face axes:
                // widthAxis: along the beams (horizontal direction on the roof)
                // heightAxis: from top to bottom beam (slope direction on the roof)
                let widthAxis = vNorm(vScale(vAdd(topEdge, botEdge), 0.5));
                let heightAxis = vNorm(vScale(vAdd(leftEdge, rightEdge), 0.5));
                
                // Calculate normal from cross product
                let normal = vNorm(vCross(widthAxis, heightAxis));
                
                // CRITICAL: Determine "outward" direction for this face
                // For arch mode, "outward" means away from the interior of the arch
                // Use the outwardDir we already calculated (from structureCenter to rawCenter)
                // This is more stable than recalculating from offset center which can cause flipping
                // at certain fold angles when the face is near the structure center
                
                // If normal points toward the arch interior (negative dot with outwardDir), flip it
                if (vDot(normal, outwardDir) < 0) {
                    normal = vScale(normal, -1);
                    heightAxis = vScale(heightAxis, -1);
                }
                
                // Re-orthogonalize axes to ensure they're perfectly perpendicular
                // IMPORTANT: Preserve heightAxis (slope direction) and recalculate widthAxis
                heightAxis = vNorm(vSub(heightAxis, vScale(normal, vDot(heightAxis, normal))));
                widthAxis = vNorm(vCross(heightAxis, normal));
                
                // Calculate the beam direction (along the horizontal beam's length)
                // Use the top beam's axisZ which is the beam's length direction
                // This direction follows the beam's 3D orientation which changes with fold angle
                const beamDirection = topBeam.axisZ || topDir;
                
                // Calculate direction towards outer pivot (top pivot in arch terminology)
                // The outer pivot is the beam endpoint that's away from the module center
                // We use the TRUE MODULE center (calculated from ALL beams in the module)
                // This ensures A and B faces in the same module select OPPOSITE outer pivots
                // (since they're on opposite sides of the X-crossing)
                
                // Direction from true module center to face center - this is OPPOSITE for A vs B faces
                const faceOutwardFromModule = vSub(rawCenter, trueModuleCenter);
                const faceOutwardMag = vMag(faceOutwardFromModule);
                const faceOutwardDir = faceOutwardMag > 0.01 ? vScale(faceOutwardFromModule, 1 / faceOutwardMag) : outwardDir;
                
                // The outer pivot is the endpoint more aligned with faceOutwardDir
                const p1FromCenter = vSub(topBeam.p1, rawCenter);
                const p2FromCenter = vSub(topBeam.p2, rawCenter);
                const p1OutwardDot = vDot(p1FromCenter, faceOutwardDir);
                const p2OutwardDot = vDot(p2FromCenter, faceOutwardDir);
                const outerPivot = p1OutwardDot > p2OutwardDot ? topBeam.p1 : topBeam.p2;
                
                // For slide direction, use the MODULE-WIDE slide axis calculated above
                // This axis is perpendicular to the line connecting beam centers
                // Using the SAME axis for all faces in the module (just flipped for A vs B)
                // ensures consistent opposite directions at ALL fold angles
                // A faces (even index) slide in +moduleSlideAxis direction
                // B faces (odd index) slide in -moduleSlideAxis direction
                // Project moduleSlideAxis onto the face plane to keep movement on the face
                const slideAxisOnPlane = vSub(moduleSlideAxis, vScale(normal, vDot(moduleSlideAxis, normal)));
                const slideAxisMag = vMag(slideAxisOnPlane);
                const projectedSlideAxis = slideAxisMag > 0.01 ? vScale(slideAxisOnPlane, 1 / slideAxisMag) : widthAxis;
                const slideDirection = isAFace ? projectedSlideAxis : vScale(projectedSlideAxis, -1);
                
                roofFaces.push({
                    moduleIndex: moduleIdx,
                    faceType: 'roof',
                    faceIndex: faceIndex++,
                    isAFace: isAFace,  // Track A vs B pattern for consistent slide direction
                    corners: [tl, tr, br, bl],
                    center: center,
                    normal: normal,
                    widthAxis: widthAxis,
                    heightAxis: heightAxis,
                    beamDirection: beamDirection,  // The actual beam's 3D direction
                    slideDirection: slideDirection,  // Direction to slide panels (A and B in opposite directions)
                    width: width,
                    height: height,
                    area: width * height
                });
            });
        });
        }); // End matchedGroups.forEach
        
        return roofFaces;
    }
    
    /**
     * Gets the active panel config based on current mode
     * @returns {Object} Active panel config (topPanels or sidePanels)
     */
    function getActivePanelConfig() {
        const isArchMode = state.orientation === 'vertical';
        if (isArchMode) {
            return state.solarPanels.sidePanels;
        } else {
            // Cylinder mode: prefer topPanels if enabled, otherwise sidePanels
            if (state.solarPanels.topPanels.enabled) {
                return state.solarPanels.topPanels;
            } else {
                return state.solarPanels.sidePanels;
            }
        }
    }
    
    // ---------------------------------------------------------------------------
    // Solar panel preset library (solar-panels/registry.json + localStorage)
    // ---------------------------------------------------------------------------
    
    const spPresetCatalog = { loaded: false, loading: null, builtins: [] };
    const SP_PRESET_STORAGE_KEY = 'linkageLab_spPresetLibrary';
    
    function spSlugifyId(name) {
        return String(name || 'panel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'panel';
    }
    
    function spPresetFromRaw(raw, source) {
        if (!raw) return null;
        const id = raw.id || spSlugifyId(raw.name);
        const widthMm = raw.widthMm != null ? raw.widthMm : raw.width;
        const heightMm = raw.heightMm != null ? raw.heightMm : raw.height;
        return {
            id,
            name: raw.name || raw.label || id,
            label: raw.label || raw.name || id,
            wmp: raw.wmp,
            vmp: raw.vmp,
            voc: raw.voc,
            isc: raw.isc,
            imp: raw.imp,
            widthMm,
            heightMm,
            panelWidthIn: raw.panelWidthIn != null ? raw.panelWidthIn : (heightMm != null ? +(heightMm / 25.4).toFixed(3) : null),
            panelLengthIn: raw.panelLengthIn != null ? raw.panelLengthIn : (widthMm != null ? +(widthMm / 25.4).toFixed(3) : null),
            formFactor: raw.formFactor || 'framed',
            foldCount: raw.foldCount || 4,
            foldedLengthIn: raw.foldedLengthIn,
            foldedWidthIn: raw.foldedWidthIn,
            foldedThicknessIn: raw.foldedThicknessIn,
            panelThicknessIn: raw.panelThicknessIn != null ? raw.panelThicknessIn : 1.5,
            cost: raw.cost != null ? raw.cost : 0,
            weight: raw.weight != null ? raw.weight : Math.round((raw.wmp || 250) * 0.18),
            link: raw.link || '',
            source: source || raw.source || 'builtin'
        };
    }
    
    function spLoadUserPresetsMap() {
        try {
            const raw = localStorage.getItem(SP_PRESET_STORAGE_KEY);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return (parsed && parsed.presets && typeof parsed.presets === 'object') ? parsed.presets : {};
        } catch (e) {
            return {};
        }
    }
    
    function spSaveUserPreset(preset) {
        const map = spLoadUserPresetsMap();
        map[preset.id] = preset;
        localStorage.setItem(SP_PRESET_STORAGE_KEY, JSON.stringify({ presets: map }));
    }
    
    function spSeedPresetsFromConstants() {
        if (typeof PANEL_PRESETS === 'undefined' || !Array.isArray(PANEL_PRESETS)) return [];
        return PANEL_PRESETS.map(p => spPresetFromRaw(p, 'builtin')).filter(Boolean);
    }
    
    async function spLoadPresetCatalog() {
        if (spPresetCatalog.loaded) return spPresetCatalog;
        if (spPresetCatalog.loading) return spPresetCatalog.loading;
    
        spPresetCatalog.loading = (async () => {
            const builtins = [];
            try {
                const regResp = await fetch('solar-panels/registry.json');
                if (regResp.ok) {
                    const registry = await regResp.json();
                    if (Array.isArray(registry)) {
                        for (const entry of registry) {
                            if (!entry || !entry.file || !entry.id) continue;
                            try {
                                const fileResp = await fetch('solar-panels/' + entry.file);
                                if (!fileResp.ok) continue;
                                const data = await fileResp.json();
                                builtins.push(spPresetFromRaw(Object.assign({}, data, entry), 'builtin'));
                            } catch (e) { /* skip broken preset */ }
                        }
                    }
                }
            } catch (e) {
                console.warn('[SP] Could not load solar-panels/registry.json', e);
            }
            if (!builtins.length) builtins.push(...spSeedPresetsFromConstants());
            spPresetCatalog.builtins = builtins;
            spPresetCatalog.loaded = true;
            spPresetCatalog.loading = null;
            return spPresetCatalog;
        })();
    
        return spPresetCatalog.loading;
    }
    
    function spGetAllPresets() {
        const byId = new Map();
        const add = (preset) => {
            if (!preset || !preset.id) return;
            if (!byId.has(preset.id)) byId.set(preset.id, preset);
        };
        spPresetCatalog.builtins.forEach(add);
        Object.values(spLoadUserPresetsMap()).forEach(p => add(spPresetFromRaw(p, 'user')));
        return Array.from(byId.values()).sort((a, b) => {
            const order = { builtin: 0, user: 1 };
            const sa = order[a.source] != null ? order[a.source] : 1;
            const sb = order[b.source] != null ? order[b.source] : 1;
            if (sa !== sb) return sa - sb;
            return (a.name || '').localeCompare(b.name || '');
        });
    }
    
    function spFindPresetById(id) {
        if (!id) return null;
        const user = spLoadUserPresetsMap()[id];
        if (user) return spPresetFromRaw(user, 'user');
        const builtin = spPresetCatalog.builtins.find(p => p.id === id);
        return builtin || null;
    }
    
    function spPanelConfigSignature(cfg) {
        if (!cfg) return '';
        return [
            cfg.panelLength || 0,
            cfg.panelWidth || 0,
            cfg.panelThickness || 0,
            cfg.ratedWatts || 0,
            cfg.voc || 0,
            cfg.vmp || 0,
            cfg.isc || 0,
            cfg.imp || 0
        ].join('|');
    }
    
    function spPresetSignature(preset) {
        const fake = {
            panelLength: preset.panelLengthIn,
            panelWidth: preset.panelWidthIn,
            panelThickness: preset.panelThicknessIn,
            ratedWatts: preset.wmp,
            voc: preset.voc,
            vmp: preset.vmp,
            isc: preset.isc,
            imp: preset.imp
        };
        return spPanelConfigSignature(fake);
    }
    
    function spLinkConfigsToKnownPresets() {
        const sigMap = new Map();
        spGetAllPresets().forEach(preset => sigMap.set(spPresetSignature(preset), preset));
        ['topPanels', 'sidePanels'].forEach(key => {
            const cfg = state.solarPanels[key];
            if (!cfg || cfg.presetId || cfg.presetManual) return;
            const match = sigMap.get(spPanelConfigSignature(cfg));
            if (match) cfg.presetId = match.id;
        });
    }
    
    function spGetPanelConfig(section) {
        return section === 'side' ? state.solarPanels.sidePanels : state.solarPanels.topPanels;
    }
    
    function spApplyPresetToPanelConfig(panelConfig, preset) {
        if (!panelConfig || !preset) return;
        panelConfig.presetId = preset.id;
        panelConfig.presetManual = false;
        if (preset.panelLengthIn != null) panelConfig.panelLength = +preset.panelLengthIn.toFixed(2);
        if (preset.panelWidthIn != null) panelConfig.panelWidth = +preset.panelWidthIn.toFixed(2);
        if (preset.panelThicknessIn != null) panelConfig.panelThickness = preset.panelThicknessIn;
        panelConfig.ratedWatts = preset.wmp;
        panelConfig.voc = preset.voc;
        panelConfig.vmp = preset.vmp;
        panelConfig.isc = preset.isc;
        panelConfig.imp = preset.imp;
        if (preset.weight != null) panelConfig.weight = preset.weight;
        if (preset.formFactor) panelConfig.formFactor = preset.formFactor;
        if (preset.foldCount != null) panelConfig.foldCount = preset.foldCount;
        if (preset.foldedLengthIn != null) panelConfig.foldedLength = preset.foldedLengthIn;
        if (preset.foldedWidthIn != null) panelConfig.foldedWidth = preset.foldedWidthIn;
        if (preset.foldedThicknessIn != null) panelConfig.foldedThickness = preset.foldedThicknessIn;
        if (preset.formFactor === 'folding' && panelConfig.foldDeploy == null) panelConfig.foldDeploy = 1;
        if (preset.formFactor === 'folding') panelConfig.foldDeploy = 1;
        if (preset.cost != null) {
            state.costSolarPanel = preset.cost;
            const costInput = document.getElementById('nb-cost-solar');
            if (costInput) costInput.value = preset.cost.toFixed(2);
        }
    }
    
    function spSyncPanelSectionUI(section) {
        const cfg = spGetPanelConfig(section);
        const suffix = section === 'side' ? 'side' : 'top';
        const setPair = (slId, nbId, val) => {
            const sl = document.getElementById(slId);
            const nb = document.getElementById(nbId);
            if (sl && val != null) sl.value = val;
            if (nb && val != null) nb.value = val;
        };
        setPair('sl-panel-length-' + suffix, 'nb-panel-length-' + suffix, cfg.panelLength);
        setPair('sl-panel-width-' + suffix, 'nb-panel-width-' + suffix, cfg.panelWidth);
        setPair('sl-panel-thick-' + suffix, 'nb-panel-thick-' + suffix, cfg.panelThickness);
        setPair('sl-panel-watts-' + suffix, 'nb-panel-watts-' + suffix, cfg.ratedWatts);
        setPair('sl-panel-weight-' + suffix, 'nb-panel-weight-' + suffix, cfg.weight != null ? cfg.weight : 45);
        const nbVoc = document.getElementById('nb-panel-voc-' + suffix);
        const nbVmp = document.getElementById('nb-panel-vmp-' + suffix);
        const nbIsc = document.getElementById('nb-panel-isc-' + suffix);
        const nbImp = document.getElementById('nb-panel-imp-' + suffix);
        if (nbVoc) nbVoc.value = cfg.voc;
        if (nbVmp) nbVmp.value = cfg.vmp;
        if (nbIsc) nbIsc.value = cfg.isc;
        if (nbImp) nbImp.value = cfg.imp;
        spUpdatePresetLink(section);
        spSyncFormFactorControlsFromState(section);
    }
    
    function spUpdatePresetLink(section) {
        const suffix = section === 'side' ? 'side' : 'top';
        const linkEl = document.getElementById('link-panel-preset-' + suffix);
        const cfg = spGetPanelConfig(section);
        if (!linkEl) return;
        const preset = cfg.presetId ? spFindPresetById(cfg.presetId) : null;
        const href = (preset && preset.link) || cfg.link || '';
        if (href) {
            linkEl.href = href;
            linkEl.style.display = '';
        } else {
            linkEl.style.display = 'none';
        }
    }
    
    function spSuffix(section) {
        return section === 'side' ? 'side' : 'top';
    }
    
    function spUpdateFormFactorUI(section) {
        const suffix = spSuffix(section);
        const cfg = spGetPanelConfig(section);
        const foldingEl = document.getElementById('sp-folding-controls-' + suffix);
        const dimLabel = document.getElementById('sp-dim-label-' + suffix);
        const isFolding = cfg.formFactor === 'folding';
        if (foldingEl) foldingEl.style.display = isFolding ? 'block' : 'none';
        if (dimLabel) dimLabel.textContent = isFolding ? 'Unfolded Dimensions' : 'Dimensions';
    }
    
    function spSyncFormFactorControlsFromState(section) {
        const suffix = spSuffix(section);
        const cfg = spGetPanelConfig(section);
        const selForm = document.getElementById('sel-panel-form-' + suffix);
        if (selForm) selForm.value = cfg.formFactor || 'framed';
        const slDeploy = document.getElementById('sl-fold-deploy-' + suffix);
        const nbDeploy = document.getElementById('nb-fold-deploy-' + suffix);
        const deployPct = Math.round((cfg.foldDeploy != null ? cfg.foldDeploy : 1) * 100);
        if (slDeploy) slDeploy.value = deployPct;
        if (nbDeploy) nbDeploy.value = deployPct;
        const selFold = document.getElementById('sel-fold-count-' + suffix);
        if (selFold) selFold.value = String(cfg.foldCount || 4);
        const nbFL = document.getElementById('nb-folded-length-' + suffix);
        const nbFW = document.getElementById('nb-folded-width-' + suffix);
        const nbFT = document.getElementById('nb-folded-thick-' + suffix);
        if (nbFL) nbFL.value = cfg.foldedLength != null ? cfg.foldedLength : 25.25;
        if (nbFW) nbFW.value = cfg.foldedWidth != null ? cfg.foldedWidth : 21.25;
        if (nbFT) nbFT.value = cfg.foldedThickness != null ? cfg.foldedThickness : 2.5;
        spUpdateFormFactorUI(section);
    }
    
    function spRefreshSolarPanelScene() {
        invalidateGeometryCache();
        requestRender();
        debouncedPanelSync();
    }
    
    function spBindFormFactorUI(section) {
        const suffix = spSuffix(section);
        const cfg = () => spGetPanelConfig(section);
    
        const selForm = document.getElementById('sel-panel-form-' + suffix);
        if (selForm && !selForm.dataset.spBound) {
            selForm.dataset.spBound = '1';
            selForm.onchange = () => {
                cfg().formFactor = selForm.value || 'framed';
                spUpdateFormFactorUI(section);
                spRefreshSolarPanelScene();
            };
        }
    
        const bindDeploy = (slId, nbId) => {
            const sl = document.getElementById(slId);
            const nb = document.getElementById(nbId);
            if (sl && !sl.dataset.spBound) {
                sl.dataset.spBound = '1';
                sl.oninput = () => {
                    const v = parseFloat(sl.value) || 0;
                    cfg().foldDeploy = Math.max(0, Math.min(1, v / 100));
                    if (nb) nb.value = v;
                    spRefreshSolarPanelScene();
                };
            }
            if (nb && !nb.dataset.spBound) {
                nb.dataset.spBound = '1';
                nb.onchange = () => {
                    let v = parseFloat(nb.value) || 0;
                    v = Math.max(0, Math.min(100, v));
                    cfg().foldDeploy = v / 100;
                    if (sl) sl.value = v;
                    nb.value = v;
                    spRefreshSolarPanelScene();
                };
            }
        };
        bindDeploy('sl-fold-deploy-' + suffix, 'nb-fold-deploy-' + suffix);
    
        const selFold = document.getElementById('sel-fold-count-' + suffix);
        if (selFold && !selFold.dataset.spBound) {
            selFold.dataset.spBound = '1';
            selFold.onchange = () => {
                cfg().foldCount = parseInt(selFold.value, 10) || 4;
                spRefreshSolarPanelScene();
            };
        }
    
        const bindFolded = (id, key) => {
            const el = document.getElementById(id);
            if (el && !el.dataset.spBound) {
                el.dataset.spBound = '1';
                el.onchange = () => {
                    cfg()[key] = parseFloat(el.value) || 0;
                };
            }
        };
        bindFolded('nb-folded-length-' + suffix, 'foldedLength');
        bindFolded('nb-folded-width-' + suffix, 'foldedWidth');
        bindFolded('nb-folded-thick-' + suffix, 'foldedThickness');
    }
    
    function spRefreshPresetDropdown(section) {
        const suffix = section === 'side' ? 'side' : 'top';
        const sel = document.getElementById('sel-panel-preset-' + suffix);
        if (!sel) return;
        const cfg = spGetPanelConfig(section);
        const presets = spGetAllPresets();
        sel.innerHTML = '';
        const customOpt = document.createElement('option');
        customOpt.value = '';
        customOpt.textContent = presets.length ? 'Custom / manual…' : 'No presets yet';
        sel.appendChild(customOpt);
    
        const addGroup = (label, items) => {
            if (!items.length) return;
            const group = document.createElement('optgroup');
            group.label = label;
            items.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = (p.name || p.id) + (p.wmp ? ' (' + p.wmp + 'W)' : '');
                if (cfg.presetId === p.id) opt.selected = true;
                group.appendChild(opt);
            });
            sel.appendChild(group);
        };
    
        addGroup('Built-in Library', presets.filter(p => p.source === 'builtin'));
        addGroup('My Presets', presets.filter(p => p.source === 'user'));
    
        if (cfg.presetId && !presets.some(p => p.id === cfg.presetId)) {
            const missing = document.createElement('option');
            missing.value = cfg.presetId;
            missing.textContent = cfg.presetId + ' (missing)';
            missing.selected = true;
            sel.appendChild(missing);
        }
        spUpdatePresetLink(section);
    }
    
    function spRefreshPresetDropdowns() {
        spRefreshPresetDropdown('top');
        spRefreshPresetDropdown('side');
    }
    
    function spMarkPanelConfigManual(section) {
        const cfg = spGetPanelConfig(section);
        if (!cfg.presetId && !cfg.presetManual) return;
        cfg.presetId = null;
        cfg.presetManual = true;
        spRefreshPresetDropdown(section);
    }
    
    function spOnPresetSelect(section) {
        const suffix = section === 'side' ? 'side' : 'top';
        const sel = document.getElementById('sel-panel-preset-' + suffix);
        const cfg = spGetPanelConfig(section);
        if (!sel) return;
        if (!sel.value) {
            cfg.presetId = null;
            cfg.presetManual = true;
            spUpdatePresetLink(section);
            return;
        }
        const preset = spFindPresetById(sel.value);
        if (!preset) return;
        spApplyPresetToPanelConfig(cfg, preset);
        spSyncPanelSectionUI(section);
        spRefreshSolarPanelScene();
    }
    
    function spSavePanelConfigAsPreset(section) {
        const cfg = spGetPanelConfig(section);
        const defaultName = cfg.presetId ? (spFindPresetById(cfg.presetId)?.name || 'Custom Panel') : ('Custom ' + (cfg.ratedWatts || 250) + 'W Panel');
        const name = prompt('Panel preset name:', defaultName);
        if (!name) return;
        const link = prompt('Product link (optional):', '') || '';
    
        let id = spSlugifyId(name);
        const userMap = spLoadUserPresetsMap();
        if (userMap[id]) id = id + '-' + Date.now().toString(36).slice(-4);
    
        const preset = spPresetFromRaw({
            id,
            name,
            label: name,
            wmp: cfg.ratedWatts,
            vmp: cfg.vmp,
            voc: cfg.voc,
            isc: cfg.isc,
            imp: cfg.imp,
            panelLengthIn: cfg.panelLength,
            panelWidthIn: cfg.panelWidth,
            panelThicknessIn: cfg.panelThickness,
            formFactor: cfg.formFactor || 'framed',
            foldCount: cfg.foldCount || 4,
            foldedLengthIn: cfg.foldedLength,
            foldedWidthIn: cfg.foldedWidth,
            foldedThicknessIn: cfg.foldedThickness,
            cost: state.costSolarPanel,
            weight: cfg.weight,
            link
        }, 'user');
    
        spSaveUserPreset(preset);
        spApplyPresetToPanelConfig(cfg, preset);
        hwDownloadJsonFile(id + '.json', preset);
        console.log('[SP] Add this entry to solar-panels/registry.json:', JSON.stringify({ id, name, file: id + '.json', link }, null, 2));
        if (typeof showToast === 'function') {
            showToast('Panel preset saved locally and downloaded. Add registry entry from console to ship via GitHub.', 'info');
        }
        spRefreshPresetDropdowns();
        spSyncPanelSectionUI(section);
        spSyncFormFactorControlsFromState(section);
    }
    
    function spInitPanelPresetUI() {
        const bindSection = (section) => {
            const suffix = section === 'side' ? 'side' : 'top';
            const sel = document.getElementById('sel-panel-preset-' + suffix);
            const saveBtn = document.getElementById('btn-save-panel-preset-' + suffix);
            const accordion = section === 'side' ? document.getElementById('side-panels-accordion') : document.getElementById('top-panels-accordion');
            if (sel && !sel.dataset.spBound) {
                sel.dataset.spBound = '1';
                sel.onchange = () => spOnPresetSelect(section);
            }
            if (saveBtn && !saveBtn.dataset.spBound) {
                saveBtn.dataset.spBound = '1';
                saveBtn.onclick = (e) => { e.preventDefault(); spSavePanelConfigAsPreset(section); };
            }
            if (accordion && !accordion.dataset.spManualBound) {
                accordion.dataset.spManualBound = '1';
                accordion.addEventListener('input', (e) => {
                    if (e.target.closest('.sp-preset-row, .hw-preset-row')) return;
                    if (e.target.matches('input, select') && !String(e.target.id || '').startsWith('sel-panel-preset')) {
                        spMarkPanelConfigManual(section);
                    }
                });
                accordion.addEventListener('change', (e) => {
                    if (e.target.closest('.sp-preset-row, .hw-preset-row')) return;
                    if (e.target.matches('input, select') && !String(e.target.id || '').startsWith('sel-panel-preset')) {
                        spMarkPanelConfigManual(section);
                    }
                });
            }
        };
        bindSection('top');
        bindSection('side');
        spBindFormFactorUI('top');
        spBindFormFactorUI('side');
        spSyncFormFactorControlsFromState('top');
        spSyncFormFactorControlsFromState('side');
        spRefreshPresetDropdowns();
    }
    
    /**
     * Updates the UI for wall face selection buttons in arch mode
     */
    function updateArchWallFacesUI() {
        // Get accordion elements
        const topPanelsAccordion = document.getElementById('top-panels-accordion');
        const sidePanelsAccordion = document.getElementById('side-panels-accordion');
        const cylinderPanelOptions = document.getElementById('cylinder-panel-options');
        const archControls = document.getElementById('arch-wall-controls');
        
        // Layout mode controls (inside top panels accordion)
        const rectControls = document.getElementById('rect-mode-controls');
        const radialControls = document.getElementById('radial-mode-controls');
        const spiralControls = document.getElementById('spiral-mode-controls');
        
        const isArchMode = state.orientation === 'vertical';
        const solarEnabled = state.solarPanels.enabled;
        const sideWallEnabled = !isArchMode && state.solarPanels.sidePanels.enabled;
        const topPanelsEnabled = !isArchMode && state.solarPanels.topPanels.enabled;
        const showSideControls = isArchMode || sideWallEnabled;
        
        // Show/hide cylinder panel location options (cylinder mode only, when solar enabled)
        if (cylinderPanelOptions) {
            cylinderPanelOptions.style.display = (!isArchMode && solarEnabled) ? 'block' : 'none';
        }
        
        // Top Panels Accordion - Hide in Arch mode, show in Cylinder mode
        if (topPanelsAccordion) {
            topPanelsAccordion.style.display = (!isArchMode && solarEnabled) ? 'block' : 'none';
        }
        
        // Side/Arch Panels Accordion - Show in Arch mode, OR in Cylinder mode when side walls enabled
        if (sidePanelsAccordion) {
            sidePanelsAccordion.style.display = (showSideControls && solarEnabled) ? 'block' : 'none';
        }
        
        // Roof sections controls (visible for arch mode and cylinder side walls)
        if (archControls) {
            archControls.style.display = (showSideControls && solarEnabled) ? 'block' : 'none';
        }
        
        // Layout mode controls (inside top panels accordion)
        const layoutMode = state.solarPanels.layoutMode;
        if (rectControls) {
            rectControls.style.display = layoutMode === 'rectangular' ? 'block' : 'none';
        }
        if (radialControls) {
            radialControls.style.display = layoutMode === 'radial' ? 'block' : 'none';
        }
        if (spiralControls) {
            spiralControls.style.display = layoutMode === 'spiral' ? 'block' : 'none';
        }
        
        // Generate wall face buttons if showing side/arch controls
        if (showSideControls && solarEnabled) {
            generateWallFaceButtons();
        }
    }
    
    /**
     * Generates the roof face toggle buttons based on current module count
     * Each module has 2 roof faces (one for each beam pattern A and B)
     */
    function generateWallFaceButtons() {
        const container = document.getElementById('wall-face-buttons');
        if (!container) return;
        
        const numModules = state.modules;
        const numFaces = numModules * 2;  // 2 faces per module
        
        // Initialize archWallFaces array if needed (2 faces per module for roof)
        if (!state.solarPanels.archWallFaces || state.solarPanels.archWallFaces.length !== numFaces) {
            state.solarPanels.archWallFaces = new Array(numFaces).fill(true);
        }
        
        container.innerHTML = '';
        
        for (let i = 0; i < numFaces; i++) {
            // Label faces as 1A, 1B, 2A, 2B, etc.
            const moduleNum = Math.floor(i / 2) + 1;
            const faceLabel = (i % 2 === 0) ? 'A' : 'B';
            
            const btn = document.createElement('button');
            btn.textContent = `${moduleNum}${faceLabel}`;
            btn.title = `Module ${moduleNum} face ${faceLabel}`;
            btn.className = 'face-toggle-btn' + (state.solarPanels.archWallFaces[i] ? ' active' : '');
            btn.onclick = () => {
                state.solarPanels.archWallFaces[i] = !state.solarPanels.archWallFaces[i];
                btn.classList.toggle('active', state.solarPanels.archWallFaces[i]);
                requestRender();
            };
            
            container.appendChild(btn);
        }
    }
    
    /**
     * Calculates rectangular grid layout of solar panels
     * @param {Object} canopy - Canopy area information
     * @param {Object} config - Solar panel configuration from state
     * @returns {Panel3D[]} Array of Panel3D objects
     */
    function calculateRectangularLayout(canopy, config) {
        const panels = [];
        
        if (!canopy || !canopy.center) return panels;
        
        const { panelLength, panelWidth, panelThickness, paddingX, paddingY, gridRows, gridCols, gridRotation, panelLift } = config;
        
        // Convert rotation to radians
        const rotationRad = degToRad(gridRotation || 0);
        const cosR = Math.cos(rotationRad);
        const sinR = Math.sin(rotationRad);
        
        // Panel height is slightly above top surface, plus any lift
        const liftAmount = panelLift || 0;
        const panelY = canopy.topHeight + panelThickness / 2 + 0.5 + liftAmount;
        
        // Create a simple grid of panels centered on canopy center
        // No boundary checking - just create the exact grid requested
        for (let row = 0; row < gridRows; row++) {
            for (let col = 0; col < gridCols; col++) {
                // Calculate position relative to grid center (before rotation)
                // Center the grid: for 2 columns, offsets are -0.5 and +0.5 of spacing
                const localX = (col - (gridCols - 1) / 2) * (panelWidth + paddingX);
                const localZ = (row - (gridRows - 1) / 2) * (panelLength + paddingY);
                
                // Apply rotation around grid center
                const rotatedX = localX * cosR - localZ * sinR;
                const rotatedZ = localX * sinR + localZ * cosR;
                
                // Translate to canopy center
                const x = canopy.center.x + rotatedX;
                const z = canopy.center.z + rotatedZ;
                
                const center = { x, y: panelY, z };
                
                // Create panel with grid rotation applied to both position and rotation
                // Position is rotated around grid center, and panel rotation matches so it aligns with rotated structure
                panels.push(makeSolarPanel(center, panelWidth, panelLength, panelThickness, rotationRad, { x: 0, y: 1, z: 0 }, spPanelSpecForGridCell(config, row)));
            }
        }
        
        return panels;
    }
    
    /**
     * Calculates radial/pinwheel layout of solar panels
     * @param {Object} canopy - Canopy area information
     * @param {Object} config - Solar panel configuration from state
     * @returns {Panel3D[]} Array of Panel3D objects
     */
    function calculateRadialLayout(canopy, config) {
        const panels = [];
        
        if (!canopy || !canopy.center) return panels;
        
        const { panelLength, panelWidth, panelThickness, radialCount, radialOffset, radialRotation, radialLateralOffset, pinwheelAngle, panelLift } = config;
        
        // Panel height is slightly above top surface, plus any lift
        const liftAmount = panelLift || 0;
        const panelY = canopy.topHeight + panelThickness / 2 + 0.5 + liftAmount;
        
        // Calculate radius for panel placement
        const angleStep = (2 * Math.PI) / radialCount;
        const pinwheelRad = degToRad(pinwheelAngle || 0);
        const patternRotationRad = degToRad(radialRotation || 0); // Rotation of entire pattern
        const lateralOffset = radialLateralOffset || 0; // Lateral offset perpendicular to radial
        
        // Use radialOffset directly to control distance from center
        // If radialOffset is 0, default to placing panels at 60% of max radius
        const defaultRadius = canopy.maxRadius ? canopy.maxRadius * 0.6 : 50;
        const effectiveRadius = radialOffset > 0 ? radialOffset : defaultRadius;
        
        for (let i = 0; i < radialCount; i++) {
            // Base angle for this panel position, plus pattern rotation
            const baseAngle = i * angleStep + patternRotationRad;
            
            // Calculate radial direction (outward from center)
            const radialX = Math.cos(baseAngle);
            const radialZ = Math.sin(baseAngle);
            
            // Calculate lateral direction (perpendicular to radial, counterclockwise)
            const lateralX = -Math.sin(baseAngle);
            const lateralZ = Math.cos(baseAngle);
            
            // Panel center position with radial offset and lateral offset
            const x = canopy.center.x + effectiveRadius * radialX + lateralOffset * lateralX;
            const z = canopy.center.z + effectiveRadius * radialZ + lateralOffset * lateralZ;
            
            const center = { x, y: panelY, z };
            
            // Panel rotation: radial direction plus pinwheel offset
            // Radial direction points outward from center, panel length aligned with it
            const rotation = baseAngle + Math.PI / 2 + pinwheelRad;
            
            panels.push(makeSolarPanel(center, panelWidth, panelLength, panelThickness, rotation, { x: 0, y: 1, z: 0 }, spPanelSpecFromConfig(config)));
        }
        
        return panels;
    }
    
    /**
     * Calculates spiral layout of solar panels using Archimedean spiral
     * @param {Object} canopy - Canopy area information
     * @param {Object} config - Solar panel configuration from state
     * @returns {Panel3D[]} Array of Panel3D objects
     */
    function calculateSpiralLayout(canopy, config) {
        const panels = [];
        if (!canopy || !canopy.center) return panels;
        
        const {
            panelLength,
            panelWidth,
            panelThickness,
            panelLift,
            radialCount,
            radialOffset,
            radialRotation,
            radialLateralOffset,
            pinwheelAngle,
            spiralSecondaryEnabled,
            spiralSecondaryRadialOffset,
            spiralSecondaryLateralOffset,
            spiralSecondaryPinwheel,
            spiralSecondaryRotation,
            spiralArmCount,
            spiralArmRadialStep,
            spiralArmLateralStep,
            spiralArmPinwheelStep,
            spiralArmRotationStep
        } = config;
        
        const liftAmount = panelLift || 0;
        const panelY = canopy.topHeight + panelThickness / 2 + 0.5 + liftAmount;
        
        const count = Math.max(1, radialCount || 1);
        const angleStep = (2 * Math.PI) / count;
        const patternRot = degToRad(radialRotation || 0);
        const pinwheelRad = degToRad(pinwheelAngle || 0);
        const defaultRadius = canopy.maxRadius ? canopy.maxRadius * 0.6 : 50;
        const primaryRadius = radialOffset > 0 ? radialOffset : defaultRadius;
        const primaryLateral = radialLateralOffset || 0;
        
        const secEnabled = spiralSecondaryEnabled !== false;
        const secRadial = spiralSecondaryRadialOffset || 0;
        const secLateral = spiralSecondaryLateralOffset || 0;
        const secPinwheelRad = degToRad(spiralSecondaryPinwheel || 0);
        const secRotationRad = degToRad(spiralSecondaryRotation || 0);
        const armCount = Math.max(2, spiralArmCount || 2);
        const radialStep = spiralArmRadialStep || 0;
        const lateralStep = spiralArmLateralStep || 0;
        const pinwheelStep = degToRad(spiralArmPinwheelStep || 0);
        const rotationStep = degToRad(spiralArmRotationStep || 0);
        
        for (let i = 0; i < count; i++) {
            const baseAngle = i * angleStep + patternRot;
            const radialDir = { x: Math.cos(baseAngle), z: Math.sin(baseAngle) };
            const lateralDir = { x: -radialDir.z, z: radialDir.x }; // perpendicular in XZ
            
            // Primary panel center
            const px = canopy.center.x + radialDir.x * primaryRadius + lateralDir.x * primaryLateral;
            const pz = canopy.center.z + radialDir.z * primaryRadius + lateralDir.z * primaryLateral;
            const primaryCenter = { x: px, y: panelY, z: pz };
            const primaryRotation = baseAngle + pinwheelRad + Math.PI / 2;
            panels.push(makeSolarPanel(primaryCenter, panelWidth, panelLength, panelThickness, primaryRotation, { x: 0, y: 1, z: 0 }, spPanelSpecFromConfig(config)));
            
            if (secEnabled) {
                for (let j = 1; j < armCount; j++) {
                    const rOffset = secRadial + (j - 1) * radialStep;
                    const lOffset = secLateral + (j - 1) * lateralStep;
                    const pinwheelJ = secPinwheelRad + (j - 1) * pinwheelStep;
                    const rotJ = secRotationRad + (j - 1) * rotationStep;
                    
                    const sx = px + radialDir.x * rOffset + lateralDir.x * lOffset;
                    const sz = pz + radialDir.z * rOffset + lateralDir.z * lOffset;
                    const secondaryCenter = { x: sx, y: panelY, z: sz };
                    const secondaryRotation = baseAngle + pinwheelRad + pinwheelJ + Math.PI / 2 + rotJ;
                    panels.push(makeSolarPanel(secondaryCenter, panelWidth, panelLength, panelThickness, secondaryRotation, { x: 0, y: 1, z: 0 }, spPanelSpecFromConfig(config)));
                }
            }
        }
        
        return panels;
    }
    
    /**
     * Calculates arch mode panel layout on roof faces.
     * Uses the refactored RoofFace objects with pre-computed slideAxis for stable orientation.
     * 
     * REFACTORED: Now uses StructureGeometry.faces (RoofFace objects) when available,
     * falling back to calculateArchWallFaces for backwards compatibility.
     * 
     * Key improvement: RoofFace.slideAxis is pre-computed based on isAFace,
     * eliminating the fragile runtime slide direction calculations.
     * 
     * @param {Object} canopy - Canopy area information (unused)
     * @param {Object} config - Solar panel configuration from state
     * @param {Object} data - Linkage data with beams and structureGeometry
     * @returns {Panel3D[]} Array of Panel3D objects
     */
    function calculateArchLayout(canopy, config, data) {
        const panels = [];
        
        if (!data || !data.beams) return panels;
        
        // REFACTORED: Use StructureGeometry.faces (RoofFace objects) if available
        // These have pre-computed slideAxis for stable slide direction
        let wallFaces;
        const hasStructGeom = data.structureGeometry && data.structureGeometry.faces;
        const faceCount = hasStructGeom ? data.structureGeometry.faces.length : 0;
        console.log('calculateArchLayout: structureGeometry available:', !!data.structureGeometry, 'faces:', faceCount);
        
        if (hasStructGeom && faceCount > 0) {
            // Use the new RoofFace objects from StructureGeometry
            wallFaces = data.structureGeometry.faces;
            console.log('Using NEW RoofFace system, face[0] slideAxis:', wallFaces[0]?.slideAxis);
        } else {
            // Fallback to old method for backwards compatibility
            wallFaces = calculateArchWallFaces(data);
            console.log('Using OLD calculateArchWallFaces fallback');
        }
        
        if (wallFaces.length === 0) return panels;
        
        // Create PanelPlacer with configuration
        const placer = new PanelPlacer({
            panelWidth: config.panelWidth,
            panelLength: config.panelLength,
            panelThickness: config.panelThickness,
            paddingX: config.paddingX,
            paddingY: config.paddingY,
            gridRows: config.gridRows,
            gridCols: config.gridCols,
            archPanelOffset: config.archPanelOffset,
            archPanelSlide: config.archPanelSlide,
            archPanelSeparation: config.archPanelSeparation,
            formFactor: config.formFactor,
            foldCount: config.foldCount,
            foldDeploy: config.foldDeploy,
            foldedLength: config.foldedLength,
            foldedWidth: config.foldedWidth,
            foldedThickness: config.foldedThickness,
            weight: config.weight
        });
        
        // Match enabled faces to actual faces found
        const numFaces = state.modules * 2;
        let enabledFaces = config.archWallFaces;
        if (!enabledFaces || enabledFaces.length !== numFaces) {
            enabledFaces = new Array(numFaces).fill(true);
        }
        
        // Place panels on each enabled face
        console.log(`calculateArchLayout: Processing ${wallFaces.length} faces, slide=${placer.slide}`);
        wallFaces.forEach((face, i) => {
            const faceIdx = face.faceIndex;
            if (faceIdx !== undefined && faceIdx < enabledFaces.length && !enabledFaces[faceIdx]) {
                return;
            }
            
            // Log slide axis for debugging
            if (i < 2) {
                console.log(`  Face ${i} (isA=${face.isAFace}): slideAxis=${JSON.stringify(face.slideAxis)}`);
            }
            
            // Use PanelPlacer for consistent panel placement
            const facePanels = placer.placeOnFace(face);
            panels.push(...facePanels);
        });
        
        return panels;
    }
    
    /** Default support / reciprocal beam parameters (StarShade 8m 4-27-26 reference; `reset` restores these). */
    const DEFAULT_SUPPORT_BEAMS = {
        enabled: true,
        showRadial: true,
        length: 120,
        width: 1.5,
        thickness: 3.5,
        rotation: 0,
        offsetH: -46.5,
        offsetV: -6.8,
        foldAngle: 0,
        parallelEnabled: true,
        parallelLength: 96,
        parallelWidth: 2.5,
        parallelThickness: 1.5,
        parallelFoldAngle: 0,
        parallelSwingAngle: 0,
        parallelOverlap: 64,
        parallelInset: -9.5,
        parallelVOffset: -1.66,
        parallelOffsetV: 4.5,
        anchorDist: 20,
        rcpKinematicMode: true,
        rcpPivotHole: 0,
        rcpPivotT: 0.5,
        rcpEndOffset: 0,
        rcpActiveHole: 1,
        rcpMaxHoleCount: 1,
        rcpCrossings: null,
        rcpFinalTopology: null,
        rcpHoleTsByBeam: null,
        rcpDiagnostics: null,
        _lastPhi: null
    };
    
    function resetSupportBeamsToDefaults() {
        Object.assign(state.supportBeams, DEFAULT_SUPPORT_BEAMS);
        invalidateRcpCrossings();
    }
    
    function applySupportBeamsConfig(sb) {
        if (!sb || typeof sb !== 'object') return;
        if (sb.enabled !== undefined) state.supportBeams.enabled = sb.enabled;
        if (sb.showRadial !== undefined) state.supportBeams.showRadial = sb.showRadial;
        if (sb.length !== undefined) state.supportBeams.length = sb.length;
        if (sb.width !== undefined) state.supportBeams.width = sb.width;
        if (sb.thickness !== undefined) state.supportBeams.thickness = sb.thickness;
        if (sb.rotation !== undefined) state.supportBeams.rotation = sb.rotation;
        if (sb.offsetH !== undefined) state.supportBeams.offsetH = sb.offsetH;
        if (sb.offsetV !== undefined) state.supportBeams.offsetV = sb.offsetV;
        if (sb.foldAngle !== undefined) state.supportBeams.foldAngle = sb.foldAngle;
        if (sb.parallelEnabled !== undefined) state.supportBeams.parallelEnabled = sb.parallelEnabled;
        if (sb.parallelLength !== undefined) state.supportBeams.parallelLength = sb.parallelLength;
        if (sb.parallelWidth !== undefined) state.supportBeams.parallelWidth = sb.parallelWidth;
        if (sb.parallelThickness !== undefined) state.supportBeams.parallelThickness = sb.parallelThickness;
        if (sb.parallelFoldAngle !== undefined) state.supportBeams.parallelFoldAngle = sb.parallelFoldAngle;
        if (sb.parallelSwingAngle !== undefined) state.supportBeams.parallelSwingAngle = sb.parallelSwingAngle;
        if (sb.parallelOverlap !== undefined) state.supportBeams.parallelOverlap = sb.parallelOverlap;
        if (sb.parallelInset !== undefined) state.supportBeams.parallelInset = sb.parallelInset;
        if (sb.parallelVOffset !== undefined) state.supportBeams.parallelVOffset = sb.parallelVOffset;
        if (sb.parallelOffsetV !== undefined) state.supportBeams.parallelOffsetV = sb.parallelOffsetV;
        if (sb.anchorDist !== undefined) state.supportBeams.anchorDist = sb.anchorDist;
        if (sb.rcpKinematicMode !== undefined) state.supportBeams.rcpKinematicMode = sb.rcpKinematicMode;
        if (sb.rcpPivotHole !== undefined) state.supportBeams.rcpPivotHole = sb.rcpPivotHole;
        if (sb.rcpPivotT !== undefined) state.supportBeams.rcpPivotT = sb.rcpPivotT;
        if (sb.rcpEndOffset !== undefined) state.supportBeams.rcpEndOffset = sb.rcpEndOffset;
        if (sb.rcpActiveHole !== undefined) state.supportBeams.rcpActiveHole = sb.rcpActiveHole;
        // rcpCrossings/topology are not loaded from file — re-seeded on next render after config load
        invalidateRcpCrossings();
    }
    
    /** Legacy `panels.support` (pre–top-level `supportBeams`). */
    function applyLegacyPanelsSupport(ps) {
        if (!ps || typeof ps !== 'object') return;
        if (ps.show !== undefined) state.supportBeams.enabled = ps.show;
        if (ps.rotation !== undefined) state.supportBeams.rotation = ps.rotation;
        if (ps.length !== undefined) state.supportBeams.length = ps.length;
        if (ps.foldAngle !== undefined) state.supportBeams.foldAngle = ps.foldAngle;
        if (ps.offsetH !== undefined) state.supportBeams.offsetH = ps.offsetH;
        if (ps.offsetV !== undefined) state.supportBeams.offsetV = ps.offsetV;
    }
    
    /**
     * BOM cost/weight for radial + optional reciprocal support (matches {@link generateSupportBeams}).
     * @param {number} moduleCount
     * @param {number} costBoltVInner
     * @returns {{ structureItems: Array<{qty:number,item:string,unit:number,total:number}>, supportBeamCost: number, supportBeamWeight: number, radialQty: number, reciprocalQty: number, sbBolts: number, sbThrough: number, sbWashers: number }}
     */
    function computeSupportBomContribution(moduleCount, costBoltVInner) {
        const structureItems = [];
        const cfg = state.supportBeams;
        const n = moduleCount;
        const costWasherV = state.costWasherV || 0.10;
    
        if (!cfg || !cfg.enabled || state.orientation === 'vertical') {
            return {
                structureItems,
                supportBeamCost: 0,
                supportBeamWeight: 0,
                radialQty: 0,
                reciprocalQty: 0,
                sbBolts: 0,
                sbThrough: 0,
                sbWashers: 0
            };
        }
    
        const radialCount = n;
        const lenIn = cfg.length || 96;
        const radFt = lenIn / INCHES_PER_FOOT;
        const rw = cfg.width || 1.5;
        const rt = cfg.thickness || 3.5;
        const radialVolPerFt = rw * rt * INCHES_PER_FOOT;
        const radialWeightOne = radFt * radialVolPerFt * state.woodDensity;
        const radialLumberCost = radialCount * state.costHBeam;
        const radialLumberWeight = radialCount * radialWeightOne;
    
        structureItems.push({
            qty: radialCount,
            item: `Radial Support Beams (${unitConverter.formatBeamSpecForCost(radFt, rw, rt)})`,
            unit: state.costHBeam,
            total: radialLumberCost
        });
    
        let reciprocalCount = 0;
        let reciprocalLumberCost = 0;
        let reciprocalLumberWeight = 0;
        if (cfg.parallelEnabled) {
            reciprocalCount = n * 2;
            const rcpLen = cfg.parallelLength || 96;
            const rcpW = cfg.parallelWidth || 1.5;
            const rcpT = cfg.parallelThickness || 3.5;
            const rcpFt = rcpLen / INCHES_PER_FOOT;
            const rcpWtOne = rcpFt * (rcpW * rcpT * INCHES_PER_FOOT) * state.woodDensity;
            reciprocalLumberCost = reciprocalCount * state.costVBeam;
            reciprocalLumberWeight = reciprocalCount * rcpWtOne;
            structureItems.push({
                qty: reciprocalCount,
                item: `Reciprocal Support Beams (${unitConverter.formatBeamSpecForCost(rcpFt, rcpW, rcpT)})`,
                unit: state.costVBeam,
                total: reciprocalLumberCost
            });
        }
    
        const sbBolts = n * 4;
        const sbThrough = n * 2;
        const sbWashers = n * 6;
        const sbBoltCost = sbBolts * costBoltVInner;
        const sbThroughCost = sbThrough * costBoltVInner;
        const sbWasherCost = sbWashers * costWasherV;
    
        structureItems.push({
            qty: sbBolts,
            item: 'Radial Support Bolts (to top ring / outer pivot)',
            unit: costBoltVInner,
            total: sbBoltCost
        });
        structureItems.push({
            qty: sbThrough,
            item: 'Radial Through-Bolts (through-beam tie)',
            unit: costBoltVInner,
            total: sbThroughCost
        });
        structureItems.push({
            qty: sbWashers,
            item: 'Radial Support Washers (same stack as V-bolts)',
            unit: costWasherV,
            total: sbWasherCost
        });
    
        const supportBeamCost = radialLumberCost + reciprocalLumberCost + sbBoltCost + sbThroughCost + sbWasherCost;
        const supportBeamWeight = radialLumberWeight + reciprocalLumberWeight + (sbBolts + sbThrough) * state.weightBolt;
    
        return {
            structureItems,
            supportBeamCost,
            supportBeamWeight,
            radialQty: radialCount,
            reciprocalQty: reciprocalCount,
            sbBolts,
            sbThrough,
            sbWashers
        };
    }
    
    /* =============================================================================
     * SUPPORT / RECIPROCAL KINEMATICS LAYER
     * Derives module frames from solved linkage geometry, places radial support beams
     * via hinge+slider constraints, and solves reciprocal beams from moving anchors.
     * ============================================================================= */
    
    const RCP_ACTIVE_PIVOT_TOL = 2.0;   // inches — active bolted pivot considered fully engaged below this
    const RCP_FINAL_ALIGN_TOL = 2.5;    // inches — all holes must align at deployment below this
    const RCP_STRESS_TOL = 12.0;        // inches — selected bolt holes separated past this = stressed (red)
    const RCP_IMPOSSIBLE_TOL = 84.0;    // inches — separation past this = physically impossible (hidden)
    /** Deploy swing applies only within this many degrees of the closed/deploy angle. */
    const RCP_DEPLOY_ANGLE_TOL_DEG = 0.15;
    
    /** True when fold angle is at (or within tolerance of) the fully deployed closed angle. */
    function isRcpAtDeployedAngle(foldAngleRad) {
        const closedAngle = (typeof getOptimalClosedAngleForAnimation === 'function')
            ? getOptimalClosedAngleForAnimation()
            : foldAngleRad;
        return Math.abs(foldAngleRad - closedAngle) < degToRad(RCP_DEPLOY_ANGLE_TOL_DEG);
    }
    
    /** Beams that belong to the main Hoberman linkage (excludes secondary support/reciprocal). */
    function isMainStructureBeam(beam) {
        const t = beam && beam.stackType ? beam.stackType : '';
        return !t.startsWith('support-beam');
    }
    
    /** Y elevation for radial support beams: top H-stack surface + beam half-thickness + offsetV. */
    function getSupportBeamPlaneY(frame, cfg) {
        const hT = state.hBeamT || 1.5;
        const hStackCount = state.hStackCount || 1;
        const hStackGap = state.hStackGap || 0;
        const hStackThick = hStackCount * hT + Math.max(0, hStackCount - 1) * hStackGap;
        const beamY = (frame.topBeam.p1.y + frame.topBeam.p2.y) * 0.5;
        const beamThick = cfg.thickness || 3.5;
        const offsetV = cfg.offsetV || 0;
        return beamY + hStackThick + beamThick / 2 + offsetV;
    }
    
    /** Point on a beam segment at a target Y (clamped to segment ends). */
    function pointOnBeamAtY(beam, targetY) {
        const p1 = beam.p1, p2 = beam.p2;
        if (!p1 || !p2) return null;
        if (Math.abs(p2.y - p1.y) < 1e-6) {
            return closestPointOnSegment3D(
                { x: (p1.x + p2.x) * 0.5, y: targetY, z: (p1.z + p2.z) * 0.5 },
                p1, p2
            ).point;
        }
        const t = Math.max(0, Math.min(1, (targetY - p1.y) / (p2.y - p1.y)));
        return {
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y),
            z: p1.z + t * (p2.z - p1.z)
        };
    }
    
    /** Outermost vertical cross beam for a module (farthest from structure centroid in XZ). */
    function pickOuterVerticalBeam(vertBeams, cx, cz) {
        let best = null, bestR = -Infinity;
        for (const vb of vertBeams) {
            if (!vb.p1 || !vb.p2) continue;
            const mx = (vb.p1.x + vb.p2.x) * 0.5;
            const mz = (vb.p1.z + vb.p2.z) * 0.5;
            const r = Math.hypot(mx - cx, mz - cz);
            if (r > bestR) { bestR = r; best = vb; }
        }
        return best;
    }
    
    /**
     * Extract per-module kinematic frame from solved linkage geometry.
     * @returns {Object[]} ModuleFrame[]
     */
    function extractModuleFrames(data) {
        const frames = [];
        const beams = data.beams || [];
        const brackets = data.brackets || [];
        const topBeams = beams.filter(b => b.stackType === 'horizontal-top');
        const numModules = state.modules;
    
        let cx = 0, cz = 0, n = 0;
        topBeams.forEach(b => {
            if (!b.p1 || !b.p2) return;
            cx += (b.p1.x + b.p2.x) * 0.5;
            cz += (b.p1.z + b.p2.z) * 0.5;
            n++;
        });
        if (n > 0) { cx /= n; cz /= n; }
    
        for (let i = 0; i < numModules; i++) {
            const topBeam = getModuleTopBeam(topBeams, i);
            if (!topBeam || !topBeam.p1 || !topBeam.p2) continue;
    
            const midX = (topBeam.p1.x + topBeam.p2.x) * 0.5;
            const midZ = (topBeam.p1.z + topBeam.p2.z) * 0.5;
            let tangX = topBeam.p2.x - topBeam.p1.x;
            let tangZ = topBeam.p2.z - topBeam.p1.z;
            const tangLen = Math.hypot(tangX, tangZ) || 1;
            tangX /= tangLen;
            tangZ /= tangLen;
            let outRadX = -tangZ, outRadZ = tangX;
    
            const modBrackets = brackets.filter(b => b.moduleIndex === i && !b.isBottom);
            const vertBeams = beams.filter(b =>
                (b.stackType === 'vertical' || b.stackType === 'fixed-beam') && b.moduleIndex === i);
    
            let innerBracket = null, outerBracket = null;
            let innerR = Infinity, outerR = -Infinity;
            for (const br of modBrackets) {
                if (!br.pos) continue;
                const r = Math.hypot(br.pos.x - cx, br.pos.z - cz);
                if (r < innerR) { innerR = r; innerBracket = br; }
                if (r > outerR) { outerR = r; outerBracket = br; }
            }
            if (!innerBracket && modBrackets.length) innerBracket = modBrackets[0];
            if (!outerBracket && modBrackets.length > 1) outerBracket = modBrackets[modBrackets.length - 1];
    
            const supportY = getSupportBeamPlaneY({ topBeam }, state.supportBeams);
    
            // Hinge = OUTER-top pivot of this module. Among the module's vertical cross beams,
            // take each beam's upper endpoint and keep the one farthest from the structure
            // center. This reliably lands on the outer vertical leg's top joint regardless of
            // which scissor pattern (A/B) the beam belongs to, so every module hinges at its
            // outer ring joint (never the inner one) even on an open/spiral partial fold.
            let hingePoint = null;
            let hingeBeam = null;
            let hingeR = -Infinity;
            for (const vb of vertBeams) {
                if (!vb.p1 || !vb.p2) continue;
                const top = (vb.p1.y >= vb.p2.y) ? vb.p1 : vb.p2;
                const r = Math.hypot(top.x - cx, top.z - cz);
                if (r > hingeR) { hingeR = r; hingeBeam = vb; hingePoint = { x: top.x, y: supportY, z: top.z }; }
            }
            if (!hingePoint) {
                // No vertical beams (fixed-beam edge cases): use the outer end of the top beam.
                const e1 = Math.hypot(topBeam.p1.x - cx, topBeam.p1.z - cz);
                const e2 = Math.hypot(topBeam.p2.x - cx, topBeam.p2.z - cz);
                const outerEnd = e1 >= e2 ? topBeam.p1 : topBeam.p2;
                hingePoint = outerBracket
                    ? { x: outerBracket.pos.x, y: supportY, z: outerBracket.pos.z }
                    : { x: outerEnd.x, y: supportY, z: outerEnd.z };
            }
    
            // Inward radial direction. The hinge sits on the OUTER vertical leg; that leg's
            // own XZ axis (outer-top → inner-bottom) is the module's true local radial, so the
            // beam follows its V-module inward even when the ring is an open/spiral partial fold.
            // Fall back to "toward structure center" if the leg is too vertical to give a radial.
            let inX = 0, inZ = 0;
            if (hingeBeam && hingeBeam.p1 && hingeBeam.p2) {
                const top = (hingeBeam.p1.y >= hingeBeam.p2.y) ? hingeBeam.p1 : hingeBeam.p2;
                const bot = (hingeBeam.p1.y >= hingeBeam.p2.y) ? hingeBeam.p2 : hingeBeam.p1;
                inX = bot.x - top.x;
                inZ = bot.z - top.z;
            }
            if (Math.hypot(inX, inZ) < 1e-3) {
                inX = cx - hingePoint.x;
                inZ = cz - hingePoint.z;
            }
            const inLen = Math.hypot(inX, inZ) || 1;
            inX /= inLen;
            inZ /= inLen;
            const guideOrigin = { x: hingePoint.x, y: supportY, z: hingePoint.z };
            const guideDir = { x: inX, y: 0, z: inZ };
    
            // --- Top-ring scissor beams (Pattern A / B) and their crossing (H-center) ---
            // Reciprocal anchors slide along these two beams, measured from the H-center crossing
            // toward each beam's inner (toward-structure-center) end joint.
            const modTopBeams = topBeams.filter(b => b.moduleIndex === i);
            const pickHighest = (pat) => {
                let best = null;
                for (const b of modTopBeams) {
                    if (b.patternId !== pat || !b.p1 || !b.p2) continue;
                    if (!best || b.center.y > best.center.y) best = b;
                }
                return best;
            };
            const beamA = pickHighest('A') || topBeam;
            const beamB = pickHighest('B') || topBeam;
            const innerEndOf = (b) => {
                const d1 = Math.hypot(b.p1.x - cx, b.p1.z - cz);
                const d2 = Math.hypot(b.p2.x - cx, b.p2.z - cz);
                return d1 <= d2 ? b.p1 : b.p2;
            };
            const innerA = innerEndOf(beamA);
            const innerB = innerEndOf(beamB);
            // H-center = XZ crossing of the two scissor beams (fallback to shared inner-end midpoint).
            let hCenter;
            const isect = segSegIntersectParamsXZ(beamA.p1, beamA.p2, beamB.p1, beamB.p2);
            if (isect && isect.t > -0.2 && isect.t < 1.2 && isect.s > -0.2 && isect.s < 1.2) {
                hCenter = {
                    x: beamA.p1.x + isect.t * (beamA.p2.x - beamA.p1.x),
                    y: (beamA.center.y + beamB.center.y) * 0.5,
                    z: beamA.p1.z + isect.t * (beamA.p2.z - beamA.p1.z)
                };
            } else {
                hCenter = {
                    x: (innerA.x + innerB.x) * 0.5,
                    y: (beamA.center.y + beamB.center.y) * 0.5,
                    z: (innerA.z + innerB.z) * 0.5
                };
            }
            const scissorEnd = (innerEnd) => {
                const dx = innerEnd.x - hCenter.x;
                const dz = innerEnd.z - hCenter.z;
                const len = Math.hypot(dx, dz) || 1;
                return { innerEnd, dirX: dx / len, dirZ: dz / len, maxDist: len };
            };
    
            frames.push({
                moduleIndex: i,
                topBeam,
                midX, midZ,
                tangX, tangZ,
                outRadX, outRadZ,
                inX, inZ,
                supportY,
                hingePoint,
                innerGuide: { origin: guideOrigin, dir: guideDir },
                outerVert: { point: hingePoint },
                innerBracket,
                outerBracket,
                structureCx: cx,
                structureCz: cz,
                hCenter,
                scissorA: scissorEnd(innerA),
                scissorB: scissorEnd(innerB)
            });
        }
        return frames;
    }
    
    /**
     * Place one radial support beam via hinge (outer vertical at support plane) + slider
     * (inward radial through inner bracket). Beam tilt uses cfg.foldAngle like the legacy model.
     */
    function solveRadialSupportBeamPlacement(frame, cfg) {
        const L = cfg.length || 96;
        const offsetH = cfg.offsetH || 0;
        const supportY = frame.supportY;
        const hinge = { ...frame.hingePoint, y: supportY };
        // Fixed inward radial axis (horizontal). Radial offset slides the beam in/out
        // ALONG this axis relative to its hinge — it never changes the beam's angle.
        const dir = frame.innerGuide.dir;
        const start = {
            x: hinge.x + dir.x * offsetH,
            y: supportY,
            z: hinge.z + dir.z * offsetH
        };
        const end = {
            x: start.x + dir.x * L,
            y: supportY,
            z: start.z + dir.z * L
        };
        return {
            start,
            end,
            slideT: offsetH,
            slideError: 0,
            hinge
        };
    }
    
    /**
     * Build a reciprocal anchor for one beam side at a module.
     * side 0 → scissor beam A, side 1 → scissor beam B. The anchor sits along that scissor
     * beam at `anchorDist` inches from the H-center crossing toward the beam's inner end,
     * clamped to the H-center→inner-end segment. Swing rotates the beam about this anchor;
     * the active bolted pair adjusts swing during fold so fixed drill holes stay coincident.
     */
    function buildRcpAnchorFromFrame(frame, cfg, side, numModules) {
        const abOffset = cfg.parallelVOffset || 0;
        const vertSign = side === 0 ? 1 : -1;
        const swingSign = side === 0 ? 1 : -1;
        const stackId = numModules + frame.moduleIndex * 2 + side;
    
        const scissor = side === 0 ? frame.scissorA : frame.scissorB;
        const hC = frame.hCenter;
        const dist = Math.max(0, Math.min(cfg.anchorDist || 0, scissor.maxDist));
        const anchorX = hC.x + scissor.dirX * dist;
        const anchorZ = hC.z + scissor.dirZ * dist;
        const anchorPos = computeRcpAnchorPosition(frame.topBeam, anchorX, anchorZ, cfg, vertSign);
    
        // Each reciprocal beam rides its own top scissor leg (A or B): direction from the
        // H-center toward that leg's inner end. Side A vs B legs form the mirrored X, so
        // top-crossing and bottom-crossing beams stay distinct even with zero swing.
        let radInX = scissor.dirX;
        let radInZ = scissor.dirZ;
        if (Math.hypot(radInX, radInZ) < 1e-6) {
            radInX = frame.inX;
            radInZ = frame.inZ;
        }
        if (Math.hypot(radInX, radInZ) < 1e-6) {
            radInX = frame.structureCx - anchorX;
            radInZ = frame.structureCz - anchorZ;
        }
        const rLen = Math.hypot(radInX, radInZ) || 1;
        radInX /= rLen;
        radInZ /= rLen;
    
        return {
            stackId,
            moduleIndex: frame.moduleIndex,
            side,
            x: anchorPos.x, y: anchorPos.y, z: anchorPos.z,
            radInX, radInZ,
            swingSign
        };
    }
    
    /** Assign hole index 1..3 from sorted crossing t per beam. */
    function buildRcpHoleTsByBeam(crossings) {
        const raw = {};
        for (const c of crossings) {
            (raw[c.beamAStackId] = raw[c.beamAStackId] || []).push(c.tA);
            (raw[c.beamBStackId] = raw[c.beamBStackId] || []).push(c.tB);
        }
        const out = {};
        for (const id of Object.keys(raw)) {
            const sorted = raw[id].slice().sort((a, b) => a - b);
            const uniq = [];
            for (const t of sorted) {
                if (!uniq.length || Math.abs(t - uniq[uniq.length - 1]) > 0.02) uniq.push(t);
            }
            out[id] = uniq.slice(0, 3);
        }
        return out;
    }
    
    /** World-space midpoint of a topology crossing's fixed holes on two rendered beams. */
    function holeMidpointForCrossing(beamA, beamB, crossing) {
        const tOn = (beam, stackId) => {
            if (crossing.beamAStackId === stackId) return crossing.tA;
            if (crossing.beamBStackId === stackId) return crossing.tB;
            return 0.5;
        };
        const pivotA = vAdd(beamA.p1, vScale(vSub(beamA.p2, beamA.p1), tOn(beamA, beamA.stackId)));
        const pivotB = vAdd(beamB.p1, vScale(vSub(beamB.p2, beamB.p1), tOn(beamB, beamB.stackId)));
        return vScale(vAdd(pivotA, pivotB), 0.5);
    }
    
    /** Pick the single topology crossing whose average hole position is nearest pivotT. */
    function selectActiveRcpCrossing(topology, pivotT) {
        if (!topology || topology.length === 0) return null;
        let best = topology[0];
        let bestDist = Infinity;
        for (const c of topology) {
            const avgT = (c.tA + c.tB) / 2;
            const d = Math.abs(avgT - pivotT);
            if (d < bestDist) {
                bestDist = d;
                best = c;
            }
        }
        return best;
    }
    
    /** Enrich crossings with holeIndexA/B from per-beam sorted hole lists. */
    function enrichCrossingsWithHoleIndex(crossings, holeTsByBeam) {
        return crossings.map(c => {
            const holesA = holeTsByBeam[c.beamAStackId] || [];
            const holesB = holeTsByBeam[c.beamBStackId] || [];
            let holeIndexA = 0, holeIndexB = 0;
            for (let i = 0; i < holesA.length; i++) {
                if (Math.abs(holesA[i] - c.tA) < 1e-4) { holeIndexA = i + 1; break; }
            }
            for (let i = 0; i < holesB.length; i++) {
                if (Math.abs(holesB[i] - c.tB) < 1e-4) { holeIndexB = i + 1; break; }
            }
            return Object.assign({}, c, { holeIndexA, holeIndexB });
        });
    }
    
    /**
     * Seed deployed reciprocal topology at closed fold angle (all three crossing holes).
     */
    function seedFinalReciprocalTopology() {
        const cfg = state.supportBeams;
        if (!cfg || !cfg.enabled || !cfg.parallelEnabled || state.orientation === 'vertical') return null;
    
        const closedAngle = (typeof getOptimalClosedAngleForAnimation === 'function')
            ? getOptimalClosedAngleForAnimation()
            : state.foldAngle;
    
        const savedSwing = cfg.parallelSwingAngle;
        const savedFold = state.foldAngle;
        state.foldAngle = closedAngle;
    
        let base;
        try {
            base = solveLinkage(closedAngle);
        } catch (e) {
            state.foldAngle = savedFold;
            return null;
        }
        base = Object.assign({}, base, { beams: base.beams ? base.beams.slice() : [] });
    
        const frames = extractModuleFrames(base);
        const numModules = state.modules;
        const rcpLen = cfg.parallelLength || 96;
        const rcpFold = 0;
    
        const buildRefsAtSwing = (swingDeg) => {
            const swingRad = degToRad(swingDeg);
            const rcpBeams = [];
            for (const frame of frames) {
                for (let side = 0; side < 2; side++) {
                    const anc = buildRcpAnchorFromFrame(frame, cfg, side, numModules);
                    const p1 = computeRcpPoint(anc, 0, swingRad, rcpFold, rcpLen);
                    const p2 = computeRcpPoint(anc, 1, swingRad, rcpFold, rcpLen);
                    rcpBeams.push({
                        stackType: 'support-beam-reciprocal',
                        stackId: anc.stackId,
                        p1, p2,
                        center: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 }
                    });
                }
            }
            return computeRcpCrossingRefsFromBeams(rcpBeams);
        };
    
        let bestSwing = savedSwing ?? 0;
        let bestRefs = buildRefsAtSwing(bestSwing);
        if (bestRefs.length === 0) {
            for (let sw = 0; sw <= 40; sw += 2) {
                const refs = buildRefsAtSwing(sw);
                if (refs.length > bestRefs.length) {
                    bestRefs = refs;
                    bestSwing = sw;
                }
            }
        }
    
        const holeTsByBeam = buildRcpHoleTsByBeam(bestRefs);
        const topology = enrichCrossingsWithHoleIndex(bestRefs, holeTsByBeam);
    
        // Number of bolt holes available per beam = max hole index across the baked topology.
        let maxHoles = 1;
        for (const c of topology) {
            maxHoles = Math.max(maxHoles, c.holeIndexA || 0, c.holeIndexB || 0);
        }
    
        cfg._seedSwingDeg = bestSwing;
        cfg.rcpHoleTsByBeam = holeTsByBeam;
        cfg.rcpFinalTopology = topology;
        cfg.rcpCrossings = bestRefs;
        cfg.rcpMaxHoleCount = maxHoles;
        cfg.rcpActiveHole = Math.max(1, Math.min(cfg.rcpActiveHole || 1, maxHoles));
        state.foldAngle = savedFold;
    
        return { topology, holeTsByBeam, seedSwing: bestSwing, maxHoles };
    }
    
    /**
     * Select the active bolt-hole ring: every baked crossing that sits at the chosen hole
     * index on either of its two beams. By module symmetry this is a ring of equivalent
     * pivots — the bolts the user has chosen to keep engaged while folding.
     */
    function selectActiveRcpRing(topology, activeHole) {
        return topology.filter(c => c.holeIndexA === activeHole || c.holeIndexB === activeHole);
    }
    
    /**
     * Gauss-Seidel solve of beam swing angles so the active bolted holes stay coincident.
     * Only beams that participate in an active crossing rotate; the rest keep baseSwing
     * (preserving the deployed spiral). Returns solved phi, the per-crossing world pivots
     * and the worst residual gap (used to flag stress / impossible states).
     */
    function solveReciprocalActiveRing(rcpAnchors, activeCrossings, baseSwing, foldRad, L, prevPhi) {
        const phi = {};
        for (const id in rcpAnchors) phi[id] = baseSwing;
        if (!activeCrossings.length) return { phi, pivots: [], maxGap: 0 };
    
        const beamCross = {};
        const involved = new Set();
        for (const c of activeCrossings) {
            involved.add(c.beamAStackId);
            involved.add(c.beamBStackId);
            (beamCross[c.beamAStackId] = beamCross[c.beamAStackId] || []).push({ tHole: c.tA, partnerId: c.beamBStackId, partnerT: c.tB });
            (beamCross[c.beamBStackId] = beamCross[c.beamBStackId] || []).push({ tHole: c.tB, partnerId: c.beamAStackId, partnerT: c.tA });
        }
        for (const id of involved) {
            if (prevPhi && prevPhi[id] !== undefined) phi[id] = prevPhi[id];
        }
    
        const energy = (anc, list, swing) => {
            let e = 0;
            for (const c of list) {
                const PA = computeRcpPoint(anc, c.tHole, swing, foldRad, L);
                const partnerAnc = rcpAnchors[c.partnerId];
                if (!partnerAnc) continue;
                const Q = computeRcpPoint(partnerAnc, c.partnerT, phi[c.partnerId], foldRad, L);
                e += (PA.x - Q.x) ** 2 + (PA.y - Q.y) ** 2 + (PA.z - Q.z) ** 2;
            }
            return e;
        };
        const solveOne = (id) => {
            const anc = rcpAnchors[id];
            const list = beamCross[id];
            if (!anc || !list || !list.length) return;
            const lo0 = -Math.PI / 2, hi0 = Math.PI / 2, n = 90;
            let best = phi[id], bestd = Infinity;
            for (let k = 0; k <= n; k++) {
                const x = lo0 + (hi0 - lo0) * (k / n);
                const d = energy(anc, list, x);
                if (d < bestd) { bestd = d; best = x; }
            }
            const h = (hi0 - lo0) / n;
            let a = best - h, b = best + h;
            for (let r = 0; r < 30; r++) {
                const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
                if (energy(anc, list, m1) < energy(anc, list, m2)) b = m2; else a = m1;
            }
            phi[id] = (a + b) / 2;
        };
    
        const ids = [...involved];
        for (let sweep = 0; sweep < 20; sweep++) {
            for (const id of ids) solveOne(id);
        }
    
        let maxGap = 0;
        const pivots = [];
        for (const c of activeCrossings) {
            const A = rcpAnchors[c.beamAStackId];
            const B = rcpAnchors[c.beamBStackId];
            if (!A || !B) continue;
            const PA = computeRcpPoint(A, c.tA, phi[c.beamAStackId], foldRad, L);
            const PB = computeRcpPoint(B, c.tB, phi[c.beamBStackId], foldRad, L);
            const g = Math.hypot(PA.x - PB.x, PA.y - PB.y, PA.z - PB.z);
            if (g > maxGap) maxGap = g;
            pivots.push({
                beamAStackId: c.beamAStackId,
                beamBStackId: c.beamBStackId,
                pivot: { x: (PA.x + PB.x) / 2, y: (PA.y + PB.y) / 2, z: (PA.z + PB.z) / 2 },
                gap: g
            });
        }
        return { phi, pivots, maxGap };
    }
    
    /**
     * Single pipeline for reciprocal beam placement:
     *   1. Anchors follow the top H-ring (caller supplies rcpAnchors).
     *   2. Every beam sits at parallelSwingAngle — the accurate deployed/spiral shape, in both
     *      manual and kinematic mode (kinematics no longer distorts the geometry).
     *   3. Kinematic mode measures how far the SELECTED bolt-hole pair separates as the ring
     *      folds (the holes are fixed fractions on each beam). That separation classifies:
     *        normal  → bolt still effectively engaged (folds cleanly)
     *        stress  → fold pulling the bolted holes apart (beams rendered red)
     *        impossible → holes hopelessly apart (beams hidden, like the V-modules)
     *      The active bolt is pinned to its hole on beam A, so it rides the beam (no drift).
     */
    function buildReciprocalBeamKinematics(cfg, rcpAnchors, crossings, foldAngleRad) {
        const L = cfg.parallelLength || 96;
        const foldRad = 0;
        const holeTsByBeam = cfg.rcpHoleTsByBeam || buildRcpHoleTsByBeam(crossings);
        const topology = cfg.rcpFinalTopology || enrichCrossingsWithHoleIndex(crossings, holeTsByBeam);
        const atDeployed = isRcpAtDeployedAngle(foldAngleRad);
        const baseSwing = degToRad(cfg.parallelSwingAngle || 0);
    
        const activeHole = Math.max(1, Math.min(cfg.rcpActiveHole || 1, cfg.rcpMaxHoleCount || 1));
        const activeCrossings = cfg.rcpKinematicMode ? selectActiveRcpRing(topology, activeHole) : [];
    
        // Beams keep the deployed swing at every fold angle (accurate spiral, matches manual mode).
        const phi = {};
        for (const id in rcpAnchors) phi[id] = baseSwing;
    
        // Gaps at all baked holes (diagnostics) and the active bolt pivots (pinned to beam A's hole).
        const activeSet = new Set(activeCrossings);
        const gaps = { active: [], inactive: [], all: [] };
        const pivots = [];
        let maxActiveGap = 0;
        let worstGap = 0, worstRef = null;
        for (const ref of topology) {
            const A = rcpAnchors[ref.beamAStackId];
            const B = rcpAnchors[ref.beamBStackId];
            if (!A || !B) continue;
            const PA = computeRcpPoint(A, ref.tA, phi[ref.beamAStackId], foldRad, L);
            const PB = computeRcpPoint(B, ref.tB, phi[ref.beamBStackId], foldRad, L);
            const g = Math.hypot(PA.x - PB.x, PA.y - PB.y, PA.z - PB.z);
            gaps.all.push(g);
            if (activeSet.has(ref)) {
                gaps.active.push(g);
                if (g > maxActiveGap) maxActiveGap = g;
                pivots.push({ beamAStackId: ref.beamAStackId, beamBStackId: ref.beamBStackId, pivot: PA, gap: g });
            } else {
                gaps.inactive.push(g);
            }
            if (g > worstGap) {
                worstGap = g;
                worstRef = { beamA: ref.beamAStackId, beamB: ref.beamBStackId, holeA: ref.holeIndexA, holeB: ref.holeIndexB, gap: +g.toFixed(2) };
            }
        }
    
        // Visual state from how far the selected bolt holes have separated.
        let visualState = 'normal';
        if (cfg.rcpKinematicMode && !atDeployed && activeCrossings.length) {
            if (maxActiveGap > RCP_IMPOSSIBLE_TOL) visualState = 'impossible';
            else if (maxActiveGap > RCP_STRESS_TOL) visualState = 'stress';
        }
        cfg._rcpVisualState = visualState;
        cfg._rcpActivePivots = (cfg.rcpKinematicMode && !atDeployed) ? pivots : [];
        const avg = arr => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
        const max = arr => arr.length ? Math.max(...arr) : 0;
    
        let diagnostics = null;
        if (cfg.rcpKinematicMode) {
            let status;
            if (atDeployed) {
                status = max(gaps.all) <= RCP_FINAL_ALIGN_TOL ? 'finalBoltUpAligned' : 'finalBoltUpFailed';
            } else if (!activeCrossings.length) {
                status = 'anchorTracking';
            } else if (visualState === 'impossible') {
                status = 'foldImpossible';
            } else if (visualState === 'stress') {
                status = 'pivotStressed';
            } else {
                status = 'activePivotSolved';
            }
            diagnostics = {
                status,
                activeHole,
                activePivotErrorAvg: +avg(gaps.active).toFixed(2),
                activePivotErrorMax: +max(gaps.active).toFixed(2),
                inactiveGapAvg: +avg(gaps.inactive).toFixed(2),
                inactiveGapMax: +max(gaps.inactive).toFixed(2),
                finalAlignErrorAvg: atDeployed ? +avg(gaps.all).toFixed(2) : null,
                finalAlignErrorMax: atDeployed ? +max(gaps.all).toFixed(2) : null,
                crossingCount: topology.length,
                activeCrossingCount: activeCrossings.length,
                worstPair: worstRef
            };
        }
        cfg.rcpDiagnostics = diagnostics;
        cfg._lastPhi = Object.assign({}, phi);
        return { phi, diagnostics, activeCrossings, pivots, visualState, atDeployed };
    }
    
    /** @deprecated Alias for buildReciprocalBeamKinematics */
    function solveReciprocalLinkage(cfg, rcpAnchors, crossings, foldAngleRad) {
        return buildReciprocalBeamKinematics(cfg, rcpAnchors, crossings, foldAngleRad);
    }
    
    function updateRcpDiagnosticsUI() {
        const panel = document.getElementById('rcp-diagnostics-panel');
        const cfg = state.supportBeams;
        if (!panel || !cfg) return;
        if (typeof refreshRcpPivotHoleOptions === 'function') refreshRcpPivotHoleOptions();
        const show = cfg.rcpKinematicMode && cfg.parallelEnabled;
        panel.style.display = show ? 'block' : 'none';
        if (!show) return;
        const d = cfg.rcpDiagnostics;
        const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
        if (!d) {
            set('rcp-diag-status', 'Status: not solved yet');
            return;
        }
        const statusLabels = {
            manual: 'Manual swing',
            anchorTracking: 'Anchor tracking (no active pivot)',
            activePivotSolved: 'Pivot engaged — folding cleanly',
            pivotStressed: 'Pivot stressed — fold resisting bolt',
            foldImpossible: 'Fold impossible at this angle',
            finalBoltUpAligned: 'Final bolt-up aligned',
            finalBoltUpFailed: 'Final bolt-up failed'
        };
        set('rcp-diag-status', 'Status: ' + (statusLabels[d.status] || d.status) + ' (hole ' + (d.activeHole ?? '—') + ')');
        set('rcp-diag-active', 'Active pivot error: avg ' + (d.activePivotErrorAvg ?? '—') + '", max ' + (d.activePivotErrorMax ?? '—') + '"');
        set('rcp-diag-inactive', 'Other hole gaps: avg ' + (d.inactiveGapAvg ?? '—') + '", max ' + (d.inactiveGapMax ?? '—') + '"');
        if (d.finalAlignErrorMax != null) {
            set('rcp-diag-final', 'Final bolt-up: avg ' + d.finalAlignErrorAvg + '", max ' + d.finalAlignErrorMax + '"');
        } else {
            set('rcp-diag-final', 'Final bolt-up: check at deployed angle');
        }
        if (d.worstPair) {
            const w = d.worstPair;
            set('rcp-diag-worst', 'Worst gap: ' + w.gap + '" (beams ' + w.beamA + '/' + w.beamB + ', holes ' + w.holeA + '/' + w.holeB + ')');
        } else {
            set('rcp-diag-worst', 'Worst gap: —');
        }
    }
    
    /**
     * Regression sweep for reciprocal/support kinematics. Call from the browser console after
     * loading a fixture config: `validateReciprocalKinematicsSweep({ pivotHole: 1 })`.
     * @param {Object} [options]
     * @returns {Object} report
     */
    function validateReciprocalKinematicsSweep(options = {}) {
        const anglesDeg = options.angles || [];
        if (!anglesDeg.length) {
            for (let d = 5; d <= 175; d += 5) anglesDeg.push(d);
            if (!anglesDeg.includes(134.9)) anglesDeg.push(134.9);
            if (!anglesDeg.includes(74.2)) anglesDeg.push(74.2);
            anglesDeg.sort((a, b) => a - b);
        }
        const savedFold = state.foldAngle;
        const savedPivot = state.supportBeams.rcpPivotT;
        if (options.pivotT !== undefined) state.supportBeams.rcpPivotT = options.pivotT;
        invalidateRcpCrossings();
    
        const report = {
            angles: [],
            failures: [],
            discontinuities: [],
            supportHingeOk: 0,
            supportHingeFail: 0,
            reciprocalSeeded: false,
            deployedFinalAlign: null
        };
    
        let prevPhi = null;
        for (const deg of anglesDeg) {
            const rad = degToRad(deg);
            state.foldAngle = rad;
            invalidateGeometryCache();
            let data;
            try {
                data = buildLinkageGeometry({ includeSupportBeams: true, includePanels: false, useCache: false, foldAngle: rad });
            } catch (err) {
                report.failures.push({ deg, error: String(err) });
                continue;
            }
    
            const cfg = state.supportBeams;
            if (!report.reciprocalSeeded && cfg.rcpCrossings && cfg.rcpCrossings.length > 0) {
                report.reciprocalSeeded = true;
            }
    
            const frames = extractModuleFrames(data);
            const supportBeams = (data.beams || []).filter(b => b.stackType === 'support-beam');
            for (const sb of supportBeams) {
                const frame = frames.find(f => f.moduleIndex === sb.moduleIndex);
                if (!frame || !frame.outerVert || !frame.outerVert.point) continue;
                // The beam slides in/out along its radial axis, so its hinge joint should lie
                // on the beam's line. Measure how far the outer hinge point is from the beam segment.
                const cp = closestPointOnSegment3D(frame.outerVert.point, sb.p1, sb.p2);
                const hingeErr = Math.hypot(cp.point.x - frame.outerVert.point.x, cp.point.y - frame.outerVert.point.y, cp.point.z - frame.outerVert.point.z);
                if (hingeErr < 2) report.supportHingeOk++;
                else report.supportHingeFail++;
            }
    
            const phi = cfg._lastPhi || {};
            const phiVals = Object.values(phi).map(v => v * 180 / Math.PI);
            const entry = {
                deg,
                status: cfg.rcpDiagnostics ? cfg.rcpDiagnostics.status : 'n/a',
                activeMax: cfg.rcpDiagnostics ? cfg.rcpDiagnostics.activePivotErrorMax : null,
                inactiveMax: cfg.rcpDiagnostics ? cfg.rcpDiagnostics.inactiveGapMax : null,
                swingRange: phiVals.length ? Math.max(...phiVals) - Math.min(...phiVals) : 0,
                hasNaN: phiVals.some(v => !Number.isFinite(v))
            };
            report.angles.push(entry);
            if (entry.hasNaN) report.failures.push({ deg, error: 'NaN swing' });
    
            if (prevPhi) {
                for (const id in phi) {
                    if (prevPhi[id] !== undefined && Math.abs(phi[id] - prevPhi[id]) > degToRad(45)) {
                        report.discontinuities.push({ deg, stackId: id, deltaDeg: (phi[id] - prevPhi[id]) * 180 / Math.PI });
                    }
                }
            }
            prevPhi = Object.assign({}, phi);
    
            if (isRcpAtDeployedAngle(rad) && cfg.rcpDiagnostics) {
                report.deployedFinalAlign = {
                    status: cfg.rcpDiagnostics.status,
                    max: cfg.rcpDiagnostics.finalAlignErrorMax
                };
            }
        }
    
        state.foldAngle = savedFold;
        state.supportBeams.rcpPivotT = savedPivot;
        invalidateRcpCrossings();
        invalidateGeometryCache();
        console.table(report.angles);
        console.log('[rcp-validate]', report);
        return report;
    }
    window.validateReciprocalKinematicsSweep = validateReciprocalKinematicsSweep;
    
    /**
     * Generates support beams independently of solar panels.
     * Beams sit on top of the top ring beams, radiating inward.
     * Supports a reciprocal parallel mode where two mirrored beams per module
     * overlap with neighbors to form a self-supporting reciprocal roof.
     * @param {Object} data - Linkage data with beams array
     * @returns {Beam3D[]} Array of support beams
     */
    /** Top horizontal-top beam for a module (highest Y in the H-stack). */
    function getModuleTopBeam(topBeams, moduleIndex) {
        let best = null;
        for (const beam of topBeams) {
            if (beam.moduleIndex !== moduleIndex || !beam.p1 || !beam.p2) continue;
            if (!best || beam.center.y > best.center.y) best = beam;
        }
        return best;
    }
    
    /** Structure center in XZ from top ring beam midpoints (tracks fold shrinkage). */
    function computeRcpStructureCenter(topBeams) {
        let sumX = 0, sumZ = 0, count = 0;
        for (const beam of topBeams) {
            if (!beam.p1 || !beam.p2) continue;
            sumX += (beam.p1.x + beam.p2.x) * 0.5;
            sumZ += (beam.p1.z + beam.p2.z) * 0.5;
            count++;
        }
        if (count === 0) return { x: 0, z: 0 };
        return { x: sumX / count, z: sumZ / count };
    }
    
    /** Outward radial + tangential frame at an anchor (XZ plane). */
    function buildRcpHorizontalFrame(anchorX, anchorZ, centerX, centerZ) {
        let dx = anchorX - centerX;
        let dz = anchorZ - centerZ;
        let len = Math.sqrt(dx * dx + dz * dz);
        if (len < 1e-6) {
            dx = 1;
            dz = 0;
            len = 1;
        }
        return {
            outRadX: dx / len,
            outRadZ: dz / len,
            tangentX: -dz / len,
            tangentZ: dx / len
        };
    }
    
    /**
     * Pin a reciprocal anchor to the top H-ring. The nominal XZ (already derived from the
     * real beam midpoint + radial inset + tangential shift) is kept as-is so the radial
     * inset is preserved; only the height is taken from the beam's top surface so the
     * anchor rides the ring vertically as the structure folds and shortens.
     */
    function computeRcpAnchorPosition(topBeam, targetX, targetZ, cfg, vertSign) {
        const hT = state.hBeamT || 1.5;
        const hStackCount = state.hStackCount || 1;
        const hStackGap = state.hStackGap || 0;
        const hStackThick = hStackCount * hT + Math.max(0, hStackCount - 1) * hStackGap;
        const rcpT = cfg.parallelThickness || 1.5;
        const rcpOffsetV = cfg.parallelOffsetV || 0;
        const abOffset = cfg.parallelVOffset || 0;
    
        const beamY = (topBeam.p1.y + topBeam.p2.y) * 0.5;
        const topSurfaceY = beamY + hStackThick / 2;
        const anchorY = topSurfaceY + rcpT / 2 + rcpOffsetV + vertSign * (abOffset / 2);
    
        return { x: targetX, y: anchorY, z: targetZ };
    }
    
    /**
     * Unit direction of a reciprocal beam: the radially-inward reference rotated by the
     * (mirrored) swing angle about the vertical axis. Beams stay horizontal (fold removed).
     * `foldRad` is accepted for signature compatibility but ignored.
     */
    function computeRcpBeamUnitDir(anc, swingRad, foldRad) {
        const eff = swingRad * (anc.swingSign || 1);
        const c = Math.cos(eff);
        const s = Math.sin(eff);
        const rx = anc.radInX !== undefined ? anc.radInX : -(anc.outRadX || 0);
        const rz = anc.radInZ !== undefined ? anc.radInZ : -(anc.outRadZ || 0);
        return {
            x: rx * c - rz * s,
            y: 0,
            z: rx * s + rz * c
        };
    }
    
    /**
     * Per-beam sorted parametric positions (t along the beam, 0=anchor end) of every
     * crossing hole, derived from the seeded crossing references. Used to locate the
     * hole the user selects as the active swing pivot.
     * @param {Array} rcpCrossings - [{beamAStackId, beamBStackId, tA, tB}]
     * @returns {Object} stackId → number[] (ascending crossing-hole t values)
     */
    function buildRcpBeamCrossingTs(rcpCrossings) {
        const map = {};
        if (!Array.isArray(rcpCrossings)) return map;
        for (const c of rcpCrossings) {
            (map[c.beamAStackId] = map[c.beamAStackId] || []).push(c.tA);
            (map[c.beamBStackId] = map[c.beamBStackId] || []).push(c.tB);
        }
        for (const id of Object.keys(map)) {
            map[id] = map[id].slice().sort((a, b) => a - b);
        }
        return map;
    }
    
    /**
     * Resolve the parametric pivot position for a beam.
     * pivotHole 0 → anchor end (t=0). pivotHole 1..N → the Nth crossing hole along the
     * beam. Falls back gracefully to the outermost available crossing hole, or the
     * anchor when the beam has no recorded crossings.
     */
    function getRcpPivotT(stackId, crossingTsMap, pivotHole) {
        if (!pivotHole || pivotHole <= 0) return 0;
        const ts = crossingTsMap[stackId];
        if (!ts || ts.length === 0) return 0;
        const idx = Math.min(pivotHole - 1, ts.length - 1);
        return ts[idx];
    }
    
    /**
     * Position of a point at parameter t along a reciprocal beam, swung by `swingRad`.
     * The anchor end (p1, t=0) stays pinned to the ring; the beam swings about it.
     */
    function computeRcpPoint(anc, t, swingRad, foldRad, L) {
        const d = computeRcpBeamUnitDir(anc, swingRad, foldRad);
        const s = t * L;
        return { x: anc.x + s * d.x, y: anc.y + s * d.y, z: anc.z + s * d.z };
    }
    
    /**
     * Weight a crossing constraint by whether it lands on a beam's currently selected
     * active pivot hole. The pivot hole's crossing is prioritised so the solved swing
     * keeps that hole aligned, while the anchor remains pinned to the ring.
     * Returns 1 when no pivot hole is active (uniform least-squares = original behaviour).
     */
    function rcpCrossingWeight(tA, tB, pivotTA, pivotTB, pivotHole) {
        if (!pivotHole || pivotHole <= 0) return 1;
        const HEAVY = 50;
        const onA = pivotTA > 0 && Math.abs(tA - pivotTA) < 1e-6;
        const onB = pivotTB > 0 && Math.abs(tB - pivotTB) < 1e-6;
        return (onA || onB) ? HEAVY : 1;
    }
    
    /**
     * Given current anchor positions and stored reference crossing parameters (tA, tB per pair),
     * find the swing angle φ (radians) that minimises the total squared 3D gap between the
     * crossing bolt positions predicted by each beam. Uses a ternary search over [-π/2, π/2].
     * @param {Object} cfg - state.supportBeams
     * @param {Object} rcpAnchors - map of stackId → {x, z, y, outRadX, outRadZ, tangentX, tangentZ, sideSign}
     * @param {Array}  rcpCrossings - [{beamAStackId, beamBStackId, tA, tB}]
     * @returns {number} solved φ in radians
     */
    function solveReciprocalSwingAngle(cfg, rcpAnchors, rcpCrossings) {
        const L = cfg.parallelLength || 96;
        const foldRad = degToRad(cfg.parallelFoldAngle || 0);
        const pivotHole = cfg.rcpPivotHole || 0;
        const crossingTsMap = buildRcpBeamCrossingTs(rcpCrossings);
    
        function residual(phi) {
            let r = 0;
            for (const { beamAStackId, beamBStackId, tA, tB } of rcpCrossings) {
                const A = rcpAnchors[beamAStackId];
                const B = rcpAnchors[beamBStackId];
                if (!A || !B) continue;
                const PA = computeRcpPoint(A, tA, phi, foldRad, L);
                const PB = computeRcpPoint(B, tB, phi, foldRad, L);
                const pivotTA = getRcpPivotT(beamAStackId, crossingTsMap, pivotHole);
                const pivotTB = getRcpPivotT(beamBStackId, crossingTsMap, pivotHole);
                const w = rcpCrossingWeight(tA, tB, pivotTA, pivotTB, pivotHole);
                r += w * ((PA.x - PB.x) ** 2 + (PA.y - PB.y) ** 2 + (PA.z - PB.z) ** 2);
            }
            return r;
        }
    
        // The weighted multi-crossing residual is multi-modal, so a plain ternary search
        // can settle in a poor local minimum. Do a coarse global scan first, then refine
        // locally around the best sample with a few ternary passes.
        const scanLo = -Math.PI / 2, scanHi = Math.PI / 2;
        const steps = 120;
        let bestPhi = 0, bestR = Infinity;
        for (let k = 0; k <= steps; k++) {
            const phi = scanLo + (scanHi - scanLo) * (k / steps);
            const r = residual(phi);
            if (r < bestR) { bestR = r; bestPhi = phi; }
        }
    
        const halfStep = (scanHi - scanLo) / steps;
        let lo = bestPhi - halfStep, hi = bestPhi + halfStep;
        for (let iter = 0; iter < 60; iter++) {
            const m1 = lo + (hi - lo) / 3;
            const m2 = hi - (hi - lo) / 3;
            if (residual(m1) < residual(m2)) hi = m2;
            else lo = m1;
        }
        return (lo + hi) / 2;
    }
    
    /**
     * Solve a PER-BEAM swing angle for each reciprocal beam.
     *
     * A reciprocal frame, once bolted at every crossing, is rigid/over-constrained: it
     * cannot fold while keeping all bolts engaged (verified empirically — even free
     * per-beam rotation cannot close the crossings away from the assembled ring). The
     * physically meaningful question during folding therefore becomes "which bolt stays
     * pinned?". That is what the active pivot hole selects:
     *
     *   - pivotHole 0 (anchor): every beam shares the single global least-squares swing
     *     (the whole frame fans uniformly; no individual bolt is privileged).
     *   - pivotHole 1..N: each beam rotates about its pinned anchor so that ITS selected
     *     crossing hole stays coincident with its partner (that bolt remains engaged),
     *     letting the other bolts separate. Because partners also move, the system is
     *     relaxed with a few Gauss-Seidel sweeps.
     *
     * @returns {Object} stackId → swing angle φ (radians)
     */
    function solveReciprocalPerBeamSwing(cfg, rcpAnchors, rcpCrossings) {
        const L = cfg.parallelLength || 96;
        const foldRad = degToRad(cfg.parallelFoldAngle || 0);
        const pivotHole = cfg.rcpPivotHole || 0;
    
        const globalSwing = solveReciprocalSwingAngle(cfg, rcpAnchors, rcpCrossings);
        const phi = {};
        for (const id in rcpAnchors) phi[id] = globalSwing;
        if (!pivotHole) return phi;
    
        const crossingTsMap = buildRcpBeamCrossingTs(rcpCrossings);
        const HEAVY = 40;
    
        // Per-beam list of {tHole, partnerId, partnerT, weight}. A crossing is weighted
        // heavily when it lands on the selected pivot hole of EITHER participating beam, so
        // both beams pull toward keeping that bolt engaged while the rest can separate.
        const beamCrossings = {};
        for (const id in rcpAnchors) beamCrossings[id] = [];
        for (const ref of rcpCrossings) {
            const { beamAStackId: a, beamBStackId: b, tA, tB } = ref;
            const pivA = getRcpPivotT(a, crossingTsMap, pivotHole);
            const pivB = getRcpPivotT(b, crossingTsMap, pivotHole);
            const heavy = (pivA > 0 && Math.abs(tA - pivA) < 1e-6) ||
                          (pivB > 0 && Math.abs(tB - pivB) < 1e-6);
            const w = heavy ? HEAVY : 1;
            if (beamCrossings[a]) beamCrossings[a].push({ tHole: tA, partnerId: b, partnerT: tB, weight: w });
            if (beamCrossings[b]) beamCrossings[b].push({ tHole: tB, partnerId: a, partnerT: tA, weight: w });
        }
    
        // Minimise beam id's total weighted crossing energy in φ, holding partners fixed.
        function solveOne(id) {
            const A = rcpAnchors[id];
            const list = beamCrossings[id];
            if (!A || !list || list.length === 0) return;
            const targets = list.map(c => ({
                tHole: c.tHole,
                weight: c.weight,
                Q: computeRcpPoint(rcpAnchors[c.partnerId], c.partnerT, phi[c.partnerId], foldRad, L)
            }));
            const f = (x) => {
                let e = 0;
                for (const t of targets) {
                    const PA = computeRcpPoint(A, t.tHole, x, foldRad, L);
                    e += t.weight * ((PA.x - t.Q.x) ** 2 + (PA.y - t.Q.y) ** 2 + (PA.z - t.Q.z) ** 2);
                }
                return e;
            };
            const lo0 = -Math.PI / 2, hi0 = Math.PI / 2, n = 90;
            let best = phi[id], bestd = Infinity;
            for (let k = 0; k <= n; k++) {
                const x = lo0 + (hi0 - lo0) * (k / n);
                const d = f(x);
                if (d < bestd) { bestd = d; best = x; }
            }
            const h = (hi0 - lo0) / n;
            let a = best - h, b = best + h;
            for (let r = 0; r < 40; r++) {
                const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
                if (f(m1) < f(m2)) b = m2; else a = m1;
            }
            phi[id] = (a + b) / 2;
        }
    
        const ids = Object.keys(rcpAnchors);
        for (let sweep = 0; sweep < 16; sweep++) {
            for (const id of ids) solveOne(id);
        }
        return phi;
    }
    
    /**
     * After reciprocal beams and their crossing bolts have been placed at the reference fold
     * angle, walk the rcp-cross bolts and record, for each crossing pair, the fractional
     * positions tA and tB along the two beams. These are stored in state.supportBeams.rcpCrossings
     * and used as the kinematic constraint for subsequent fold angles.
     * @param {Object} data - assembled geometry (beams + bolts)
     * @returns {Array} [{beamAStackId, beamBStackId, tA, tB}]
     */
    function buildRcpCrossingRefs(data) {
        const refs = [];
        const rcpBeams = (data.beams || []).filter(b => b.stackType === 'support-beam-reciprocal');
        const crossBolts = (data.bolts || []).filter(b => b && b.boltType === 'rcp-cross');
        if (rcpBeams.length < 2 || crossBolts.length === 0) return refs;
    
        const L = state.supportBeams.parallelLength || 96;
    
        for (const bolt of crossBolts) {
            const P = bolt.center;
            if (!P) continue;
    
            // Find the two beams that own this crossing (closest by segment distance)
            let bestA = null, bestB = null;
            let bestDA = Infinity, bestDB = Infinity;
            for (const beam of rcpBeams) {
                if (!beam.p1 || !beam.p2) continue;
                const { point, t } = closestPointOnSegment3D(P, beam.p1, beam.p2);
                const dx = point.x - P.x, dy = point.y - P.y, dz = point.z - P.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < bestDA) {
                    bestDB = bestDA; bestB = bestA;
                    bestDA = d2; bestA = { beam, t };
                } else if (d2 < bestDB) {
                    bestDB = d2; bestB = { beam, t };
                }
            }
            if (!bestA || !bestB) continue;
            if (bestA.beam.stackId === bestB.beam.stackId) continue;
            // Avoid duplicate pairs (A,B) == (B,A)
            const idA = Math.min(bestA.beam.stackId, bestB.beam.stackId);
            const idB = Math.max(bestA.beam.stackId, bestB.beam.stackId);
            if (refs.some(r => r.beamAStackId === idA && r.beamBStackId === idB)) continue;
            const tA = idA === bestA.beam.stackId ? bestA.t : bestB.t;
            const tB = idA === bestA.beam.stackId ? bestB.t : bestA.t;
            if (tA <= 0.001 || tA >= 0.999 || tB <= 0.001 || tB >= 0.999) continue;
            refs.push({ beamAStackId: idA, beamBStackId: idB, tA, tB });
        }
        return refs;
    }
    
    /**
     * Robustly derive crossing references directly from reciprocal beam centrelines
     * (independent of bolt generation/dedup). For every beam pair that intersects in the
     * XZ plane at interior parameters and whose 3D vertical separation is small (i.e. the
     * two layers actually meet at a bolt), record {beamA, beamB, tA, tB}. This is used to
     * seed the kinematic crossing constraints at the closed configuration.
     * @param {Beam3D[]} rcpBeams
     * @param {number} vGapTol - max vertical separation (in) to count as a real crossing
     * @returns {Array} [{beamAStackId, beamBStackId, tA, tB}]
     */
    function computeRcpCrossingRefsFromBeams(rcpBeams, vGapTol = 8) {
        const refs = [];
        const epsI = 0.02, epsE = 0.98;
        for (let i = 0; i < rcpBeams.length; i++) {
            for (let j = i + 1; j < rcpBeams.length; j++) {
                const A = rcpBeams[i], B = rcpBeams[j];
                if (!A.p1 || !A.p2 || !B.p1 || !B.p2) continue;
                const isect = segSegIntersectParamsXZ(
                    { x: A.p1.x, z: A.p1.z }, { x: A.p2.x, z: A.p2.z },
                    { x: B.p1.x, z: B.p1.z }, { x: B.p2.x, z: B.p2.z }
                );
                if (!isect) continue;
                const { t, s } = isect;
                if (t <= epsI || t >= epsE || s <= epsI || s >= epsE) continue;
                const yA = A.p1.y + t * (A.p2.y - A.p1.y);
                const yB = B.p1.y + s * (B.p2.y - B.p1.y);
                if (Math.abs(yA - yB) > vGapTol) continue;
                const idA = Math.min(A.stackId, B.stackId);
                const idB = Math.max(A.stackId, B.stackId);
                const tA = idA === A.stackId ? t : s;
                const tB = idA === A.stackId ? s : t;
                refs.push({ beamAStackId: idA, beamBStackId: idB, tA, tB });
            }
        }
        return refs;
    }
    
    /**
     * Seed the reciprocal crossing constraints at the structure's CLOSED fold angle.
     * The folded structure is only a symmetric ring near closure; seeding there gives every
     * beam its full, regular set of crossing holes. A swing sweep picks the angle that
     * yields the most uniform "each beam crosses ~3 neighbours" pattern. The user's swing
     * setting is preserved (restored afterwards); kinematic mode measures constraint gaps at that swing.
     * @returns {Array} crossing references, or [] when unavailable
     */
    /** @deprecated Use seedFinalReciprocalTopology — kept for legacy call sites. */
    function seedRcpCrossings() {
        const result = seedFinalReciprocalTopology();
        return result ? (state.supportBeams.rcpCrossings || []) : [];
    }
    
    function generateSupportBeams(data) {
        const beams = [];
        const cfg = state.supportBeams;
        if (!cfg.enabled) return beams;
        if (state.orientation === 'vertical') return beams;
    
        const topBeams = data.beams.filter(b => b.stackType === 'horizontal-top');
        if (topBeams.length === 0) return beams;
    
        const numModules = state.modules;
        const beamWidth = cfg.width || 1.5;
        const beamThick = cfg.thickness || 3.5;
        const woodColor = WOOD_COLOR;
        const moduleFrames = extractModuleFrames(data);
    
        const structureFoldDeg = radToDeg(data._structureFoldAngleRad !== undefined ? data._structureFoldAngleRad : state.foldAngle);
        const radialMinDeg = state.animation.radialVisibleAngle ?? 90;
        const showRadialAtAngle = structureFoldDeg >= radialMinDeg;
    
        if (cfg.showRadial !== false && showRadialAtAngle) {
            for (const frame of moduleFrames) {
                const placement = solveRadialSupportBeamPlacement(frame, cfg);
                beams.push(new Beam3D(
                    placement.start, placement.end,
                    beamWidth, beamThick, woodColor,
                    { moduleIndex: frame.moduleIndex, stackType: 'support-beam', stackId: frame.moduleIndex }
                ));
            }
        }
    
        if (cfg.parallelEnabled) {
            const rcpLen = cfg.parallelLength || 96;
            const rcpW = cfg.parallelWidth || 1.5;
            const rcpT = cfg.parallelThickness || 3.5;
            const rcpFold = 0; // fold-angle removed: reciprocal beams stay locked horizontally
            const fallbackSwing = degToRad(cfg.parallelSwingAngle || 0);
    
            const rcpAnchors = {};
            for (const frame of moduleFrames) {
                for (let side = 0; side < 2; side++) {
                    const anc = buildRcpAnchorFromFrame(frame, cfg, side, numModules);
                    rcpAnchors[anc.stackId] = anc;
                }
            }
    
            let swingByStack = null;
            const crossings = cfg.rcpCrossings || [];
            const structureFoldRad = data._structureFoldAngleRad !== undefined ? data._structureFoldAngleRad : state.foldAngle;
            let visualState = 'normal';
            if (crossings.length > 0) {
                const kin = buildReciprocalBeamKinematics(cfg, rcpAnchors, crossings, structureFoldRad);
                swingByStack = kin.phi;
                visualState = kin.visualState;
                cfg._solvedSwingDeg = cfg.parallelSwingAngle ?? cfg._seedSwingDeg ?? 0;
                if (cfg.rcpKinematicMode) {
                    if (!window.__rcpSolverLogCount) window.__rcpSolverLogCount = 0;
                    if (window.__rcpSolverLogCount < 8) {
                        const d = cfg.rcpDiagnostics || {};
                        console.log(`[rcp-kin] fold=${radToDeg(structureFoldRad).toFixed(1)}° hole=${cfg.rcpActiveHole} state=${visualState} status=${d.status} activeMax=${d.activePivotErrorMax ?? '—'}`);
                        window.__rcpSolverLogCount++;
                    }
                }
            } else {
                cfg._rcpActivePivots = [];
                cfg._rcpVisualState = 'normal';
                cfg._solvedSwingDeg = cfg.rcpKinematicMode ? (cfg.parallelSwingAngle || 0) : null;
                if (!cfg.rcpKinematicMode) cfg.rcpDiagnostics = null;
            }
    
            // Hide reciprocal beams below the user-configured minimum fold angle (always, regardless
            // of kinematic mode), and when the kinematic solver declares the linkage impossible.
            const rcpMinDeg = state.animation.rcpVisibleAngle ?? 90;
            const belowMinAngle = radToDeg(structureFoldRad) < rcpMinDeg;
            const hideReciprocal = belowMinAngle || (cfg.rcpKinematicMode && visualState === 'impossible');
            if (!hideReciprocal) {
                // Stressed pivot → render every reciprocal beam red to signal conflicting forces.
                const stressed = cfg.rcpKinematicMode && visualState === 'stress';
                for (const frame of moduleFrames) {
                    for (let side = 0; side < 2; side++) {
                        const stackId = numModules + frame.moduleIndex * 2 + side;
                        const anc = rcpAnchors[stackId];
                        if (!anc) continue;
                        const swing = swingByStack && (stackId in swingByStack) ? swingByStack[stackId] : fallbackSwing;
                        const endOffset = cfg.rcpEndOffset || 0;
                        const p1 = computeRcpPoint(anc, -endOffset / rcpLen, swing, rcpFold, rcpLen);
                        const p2 = computeRcpPoint(anc, 1, swing, rcpFold, rcpLen);
                        beams.push(new Beam3D(
                            p1, p2,
                            rcpW, rcpT, woodColor,
                            {
                                moduleIndex: frame.moduleIndex,
                                stackType: 'support-beam-reciprocal',
                                stackId,
                                patternId: side === 0 ? 'A' : 'B',
                                kinematicState: stressed ? 'error' : null
                            }
                        ));
                    }
                }
            }
        }
    
        updateRcpDiagnosticsUI();
        return beams;
    }
    
    /**
     * Main function to calculate all solar panels based on current configuration
     * @param {Object} data - Linkage data
     * @returns {{panels: Panel3D[], canopy: Object}} Solar panel data
     */
    function calculateSolarPanels(data) {
        const config = state.solarPanels;
        
        if (!config.enabled) {
            return { panels: [], canopy: null };
        }
        
        // Calculate canopy area
        const canopy = calculateCanopyArea(data);
        
        if (!canopy) {
            return { panels: [], canopy: null };
        }
        
        // Calculate panels based on layout mode
        let panels = [];
        const isVertical = state.orientation === 'vertical';
        
        if (isVertical) {
            // Arch mode uses side panel configuration
            const sideConfig = config.sidePanels;
            
            // In arch mode with scissor uprights (not fixed beams), hide panels if structure is too compressed
            if (!state.useFixedBeams) {
                const panelArrayHeight = sideConfig.gridRows * sideConfig.panelLength + (sideConfig.gridRows - 1) * sideConfig.paddingY;
                const ringSpacing = data.maxHeight || 0;
                
                if (ringSpacing < panelArrayHeight * 0.8) {
                    return { panels: [], canopy: canopy };
                }
            }
            
            // Create config object for arch layout
            const archConfig = {
                panelLength: sideConfig.panelLength,
                panelWidth: sideConfig.panelWidth,
                panelThickness: sideConfig.panelThickness,
                paddingX: sideConfig.paddingX,
                paddingY: sideConfig.paddingY,
                gridRows: sideConfig.gridRows,
                gridCols: sideConfig.gridCols,
                archPanelOffset: config.archPanelOffset,
                archPanelSlide: config.archPanelSlide,
                archPanelSeparation: config.archPanelSeparation,
                archWallFaces: config.archWallFaces,
                formFactor: sideConfig.formFactor,
                foldCount: sideConfig.foldCount,
                foldDeploy: sideConfig.foldDeploy,
                foldedLength: sideConfig.foldedLength,
                foldedWidth: sideConfig.foldedWidth,
                foldedThickness: sideConfig.foldedThickness,
                weight: sideConfig.weight
            };
            
            panels = calculateArchLayout(canopy, archConfig, data);
        } else {
            // Horizontal/Cylinder mode - can have both top and side panels independently
            const showTopPanels = config.topPanels.enabled;
            const showSideWallPanels = config.sidePanels.enabled;
            
            // Collect top surface panels if enabled
            if (showTopPanels) {
                const topCfg = config.topPanels;
                const topConfig = {
                    panelLength: topCfg.panelLength,
                    panelWidth: topCfg.panelWidth,
                    panelThickness: topCfg.panelThickness,
                    paddingX: topCfg.paddingX,
                    paddingY: topCfg.paddingY,
                    gridRows: topCfg.gridRows,
                    gridCols: topCfg.gridCols,
                    gridRotation: config.gridRotation,
                    radialCount: config.radialCount,
                    radialOffset: config.radialOffset,
                    radialRotation: config.radialRotation,
                    radialLateralOffset: config.radialLateralOffset,
                    pinwheelAngle: config.pinwheelAngle,
                    spiralArmCount: config.spiralArmCount,
                    spiralSecondaryEnabled: config.spiralSecondaryEnabled,
                    spiralSecondaryRadialOffset: config.spiralSecondaryRadialOffset,
                    spiralSecondaryLateralOffset: config.spiralSecondaryLateralOffset,
                    spiralSecondaryPinwheel: config.spiralSecondaryPinwheel,
                    spiralSecondaryRotation: config.spiralSecondaryRotation,
                    spiralArmRadialStep: config.spiralArmRadialStep,
                    spiralArmLateralStep: config.spiralArmLateralStep,
                    spiralArmPinwheelStep: config.spiralArmPinwheelStep,
                    spiralArmRotationStep: config.spiralArmRotationStep,
                    panelLift: topCfg.panelLift,
                    layoutMode: config.layoutMode,
                    formFactor: topCfg.formFactor,
                    foldCount: topCfg.foldCount,
                    foldDeploy: topCfg.foldDeploy,
                    foldedLength: topCfg.foldedLength,
                    foldedWidth: topCfg.foldedWidth,
                    foldedThickness: topCfg.foldedThickness,
                    weight: topCfg.weight
                };
                
                let topPanels = [];
                switch (config.layoutMode) {
                    case 'rectangular':
                        topPanels = calculateRectangularLayout(canopy, topConfig);
                        break;
                    case 'radial':
                        topPanels = calculateRadialLayout(canopy, topConfig);
                        break;
                    case 'spiral':
                        topPanels = calculateSpiralLayout(canopy, topConfig);
                        break;
                    default:
                        topPanels = calculateRectangularLayout(canopy, topConfig);
                }
                panels.push(...topPanels);
            }
            
            // Collect side wall panels if enabled
            if (showSideWallPanels) {
                const sideCfg = config.sidePanels;
                const sideConfig = {
                    panelLength: sideCfg.panelLength,
                    panelWidth: sideCfg.panelWidth,
                    panelThickness: sideCfg.panelThickness,
                    paddingX: sideCfg.paddingX,
                    paddingY: sideCfg.paddingY,
                    gridRows: sideCfg.gridRows,
                    gridCols: sideCfg.gridCols,
                    archPanelOffset: config.archPanelOffset,
                    archPanelSlide: config.archPanelSlide,
                    archPanelSeparation: config.archPanelSeparation,
                    archWallFaces: config.archWallFaces,
                    formFactor: sideCfg.formFactor,
                    foldCount: sideCfg.foldCount,
                    foldDeploy: sideCfg.foldDeploy,
                    foldedLength: sideCfg.foldedLength,
                    foldedWidth: sideCfg.foldedWidth,
                    foldedThickness: sideCfg.foldedThickness,
                    weight: sideCfg.weight
                };
                
                const sidePanels = calculateArchLayout(canopy, sideConfig, data);
                panels.push(...sidePanels);
            }
        }
        
        return { panels, canopy };
    }
    
    /**
     * Calculates bounds and center from beam corner geometry.
     * Internal geometry uses inches and a Y-up coordinate system unless transformed for export.
     * @param {Beam3D[]} beams
     * @param {{ mainStructureOnly?: boolean }} [options] - When true, exclude support/reciprocal beams from center
     */
    function calculateBeamBounds(beams, options = {}) {
        const bounds = {
            min: { x: 0, y: 0, z: 0 },
            max: { x: 0, y: 0, z: 0 },
            center: { x: 0, y: 0, z: 0 },
            maxRadius: 0,
            maxHeight: 0
        };
        if (!beams || beams.length === 0) return bounds;
    
        const beamList = options.mainStructureOnly ? beams.filter(isMainStructureBeam) : beams;
        if (beamList.length === 0) return bounds;
        
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        let minZ = Infinity, maxZ = -Infinity;
        let maxRadius = 0;
        
        beamList.forEach(beam => {
            const points = beam.corners && beam.corners.length > 0
                ? beam.corners
                : [beam.p1, beam.p2].filter(Boolean);
            points.forEach(p => {
                if (!p) return;
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
                minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
                maxRadius = Math.max(maxRadius, Math.sqrt(p.x * p.x + p.z * p.z));
            });
        });
        
        if (!Number.isFinite(minX)) return bounds;
        
        bounds.min = { x: minX, y: minY, z: minZ };
        bounds.max = { x: maxX, y: maxY, z: maxZ };
        bounds.center = {
            x: (minX + maxX) / 2,
            y: (minY + maxY) / 2,
            z: (minZ + maxZ) / 2
        };
        bounds.maxRadius = maxRadius;
        bounds.maxHeight = maxY;
        return bounds;
    }
    
    /** Round a 3D vector for JSON export (null-safe). */
    function roundVec3ForExport(v, places = 2) {
        if (!v) return null;
        const f = Math.pow(10, places);
        return {
            x: Math.round(v.x * f) / f,
            y: Math.round(v.y * f) / f,
            z: Math.round(v.z * f) / f
        };
    }
    
    /**
     * Build a complete geometry snapshot of what the 3D viewer is showing.
     * Includes beam identity (moduleIndex, stackId, stackType), structure center,
     * and resolved support/reciprocal beam placement data for debugging.
     * @param {Object} data - Output of buildLinkageGeometry()
     * @returns {Object}
     */
    function buildGeometrySnapshot(data) {
        const cfg = state.supportBeams || {};
        const moduleFrames = extractModuleFrames(data);
    
        const snapshotBeam = (b) => {
            const stackType = b.stackType || 'unknown';
            const entry = {
                // `type` kept for legacy importers; `stackType` is canonical.
                type: stackType,
                stackType,
                moduleIndex: b.moduleIndex,
                stackId: b.stackId,
                patternId: b.patternId || null,
                kinematicState: b.kinematicState || null,
                center: roundVec3ForExport(b.center),
                p1: b.p1 ? roundVec3ForExport(b.p1) : null,
                p2: b.p2 ? roundVec3ForExport(b.p2) : null,
                axisX: b.axisX ? roundVec3ForExport(b.axisX, 3) : null,
                axisY: b.axisY ? roundVec3ForExport(b.axisY, 3) : null,
                axisZ: b.axisZ ? roundVec3ForExport(b.axisZ, 3) : null,
                w: b.w,
                t: b.t
            };
            if (b.p1 && b.p2) {
                entry.length = +Math.hypot(
                    b.p2.x - b.p1.x, b.p2.y - b.p1.y, b.p2.z - b.p1.z
                ).toFixed(2);
            }
            return entry;
        };
    
        const supportBeamPlacements = [];
        if (cfg.enabled && cfg.showRadial !== false) {
            for (const frame of moduleFrames) {
                const placement = solveRadialSupportBeamPlacement(frame, cfg);
                supportBeamPlacements.push({
                    moduleIndex: frame.moduleIndex,
                    hinge: roundVec3ForExport(frame.hingePoint),
                    inwardDir: roundVec3ForExport(frame.innerGuide.dir, 3),
                    start: roundVec3ForExport(placement.start),
                    end: roundVec3ForExport(placement.end),
                    slideT: +placement.slideT.toFixed(2),
                    hCenter: roundVec3ForExport(frame.hCenter)
                });
            }
        }
    
        let reciprocalBeams = null;
        if (cfg.enabled && cfg.parallelEnabled) {
            const numModules = state.modules;
            const anchors = [];
            for (const frame of moduleFrames) {
                for (let side = 0; side < 2; side++) {
                    const anc = buildRcpAnchorFromFrame(frame, cfg, side, numModules);
                    anchors.push({
                        stackId: anc.stackId,
                        moduleIndex: frame.moduleIndex,
                        side: anc.side,
                        position: roundVec3ForExport({ x: anc.x, y: anc.y, z: anc.z }),
                        radInDir: roundVec3ForExport({ x: anc.radInX, y: 0, z: anc.radInZ }, 3)
                    });
                }
            }
            reciprocalBeams = {
                anchors,
                swingAngleDeg: cfg._solvedSwingDeg != null ? +cfg._solvedSwingDeg.toFixed(2) : (cfg.parallelSwingAngle || 0),
                activeHole: cfg.rcpActiveHole ?? 1,
                maxHoleCount: cfg.rcpMaxHoleCount ?? 1,
                visualState: cfg._rcpVisualState || 'normal',
                anchorDist: cfg.anchorDist ?? 0,
                kinematicMode: !!cfg.rcpKinematicMode,
                diagnostics: cfg.rcpDiagnostics || null,
                crossingCount: (cfg.rcpCrossings || []).length
            };
        }
    
        const allBeams = data.beams || [];
        const supportOnly = allBeams.filter(b => b.stackType && b.stackType.startsWith('support-beam'));
    
        return {
            schemaVersion: 2,
            coordinateSystem: 'y-up-inches',
            structureCenter: roundVec3ForExport(data.structureCenter || data.structureBounds?.center),
            structureBounds: data.structureBounds ? {
                min: roundVec3ForExport(data.structureBounds.min),
                max: roundVec3ForExport(data.structureBounds.max),
                center: roundVec3ForExport(data.structureBounds.center),
                maxRadius: +(data.structureBounds.maxRadius || 0).toFixed(2),
                maxHeight: +(data.structureBounds.maxHeight || 0).toFixed(2)
            } : null,
            fullBounds: data.fullBounds ? {
                min: roundVec3ForExport(data.fullBounds.min),
                max: roundVec3ForExport(data.fullBounds.max),
                center: roundVec3ForExport(data.fullBounds.center)
            } : null,
            debugConfig: {
                foldAngle: state.foldAngle ? +radToDeg(state.foldAngle).toFixed(1) : null,
                archPanelSlide: state.solarPanels.archPanelSlide,
                archPanelSeparation: state.solarPanels.archPanelSeparation,
                archPanelOffset: state.solarPanels.archPanelOffset,
                useFixedBeams: state.useFixedBeams,
                archCapUprights: state.archCapUprights,
                gridRotation: state.solarPanels.gridRotation || 0,
                supportBeamCount: supportOnly.length,
                radialSupportCount: supportOnly.filter(b => b.stackType === 'support-beam').length,
                reciprocalSupportCount: supportOnly.filter(b => b.stackType === 'support-beam-reciprocal').length,
                supportBeamsUnsupported: !!data.supportBeamsUnsupported
            },
            beams: allBeams.map(snapshotBeam),
            supportBeams: supportOnly.map(snapshotBeam),
            supportBeamPlacements,
            reciprocalBeams,
            panels: data.panels ? data.panels.map((p, i) => ({
                index: i,
                center: roundVec3ForExport(p.center),
                normal: p.axisY ? roundVec3ForExport(p.axisY, 3) : null,
                axisX: p.axisX ? roundVec3ForExport(p.axisX, 3) : null,
                width: p.width,
                length: p.length,
                thickness: p.thickness
            })) : [],
            maxRadius: +((data.structureBounds?.maxRadius ?? data.maxRad) || 0).toFixed(2),
            maxHeight: +((data.structureBounds?.maxHeight ?? data.maxHeight) || 0).toFixed(2),
            fixedBeams: state.useFixedBeams ? allBeams
                .filter(b => b.stackType === 'fixed-beam' || b.stackType === 'fixed-beam-cap')
                .map(b => ({
                    stackType: b.stackType,
                    moduleIndex: b.moduleIndex,
                    stackId: b.stackId,
                    center: roundVec3ForExport(b.center),
                    p1: b.p1 ? roundVec3ForExport(b.p1) : null,
                    p2: b.p2 ? roundVec3ForExport(b.p2) : null,
                    length: (b.p1 && b.p2)
                        ? +Math.hypot(b.p2.x - b.p1.x, b.p2.y - b.p1.y, b.p2.z - b.p1.z).toFixed(2)
                        : null
                })) : null
        };
    }
    
    /**
     * Closest point on 3D segment A–B to point P. Returns { point, t } with t in [0,1].
     */
    function closestPointOnSegment3D(p, a, b) {
        const ab = vSub(b, a);
        const ab2 = vDot(ab, ab);
        if (ab2 < 1e-20) {
            return { point: { ...a }, t: 0 };
        }
        const t = Math.max(0, Math.min(1, vDot(vSub(p, a), ab) / ab2));
        return { point: vAdd(a, vScale(ab, t)), t };
    }
    
    /**
     * Parametric intersection of two segments in the XZ plane (y ignored for crossing test).
     * a0 + t (a1−a0) = b0 + s (b1−b0) at intersection, w = b0 − a0, t = (w×db) / (da×db), s = (w×da) / (da×db).
     * Returns { t, s } on each segment or null if lines parallel in XZ.
     */
    function segSegIntersectParamsXZ(a0, a1, b0, b1) {
        const dax = a1.x - a0.x, daz = a1.z - a0.z;
        const dbx = b1.x - b0.x, dbz = b1.z - b0.z;
        const cross = dax * dbz - daz * dbx;
        if (Math.abs(cross) < 1e-12) return null;
        const wx = b0.x - a0.x, wz = b0.z - a0.z;
        const t = (wx * dbz - wz * dbx) / cross;
        const s = (wx * daz - wz * dax) / cross;
        return { t, s };
    }
    
    /**
     * Bolts for reciprocal support: (1) vertical through the top H-stack at the outer anchor
     * (closest point on a horizontal-top beam to the outer end of each reciprocal beam);
     * (2) crossing bolts at interior intersections of reciprocal centerlines (XZ segment crossing
     * with interior parameters, or closest approach when nearly skew).
     * @param {Object} data - Assembled geometry with beams (includes support/reciprocal beams)
     * @returns {Object[]}
     */
    function generateReciprocalSupportBolts(data) {
        const out = [];
        const cfg = state.supportBeams;
        if (!cfg || !cfg.enabled || !cfg.parallelEnabled || state.orientation === 'vertical') {
            return out;
        }
        const rcpBeams = (data.beams || []).filter(b => b.stackType === 'support-beam-reciprocal');
        if (rcpBeams.length < 1) return out;
    
        const topHBeams = (data.beams || []).filter(b => b.stackType === 'horizontal-top');
        if (topHBeams.length < 1) return out;
    
        const boltRadius = getBoltRadius();
        const hT = state.hBeamT || 1.5;
        const hStackCount = state.hStackCount || 1;
        const hStackGap = state.hStackGap || 0;
        const hStackThick = hStackCount * hT + Math.max(0, hStackCount - 1) * hStackGap;
        const hBoltLen = state.hPivotBoltLength || (typeof calculateHPivotBoltLength === 'function' ? calculateHPivotBoltLength() : 3);
    
        const rcpW = cfg.parallelWidth || 1.5;
        const rcpT = cfg.parallelThickness || 3.5;
        const crossBoltLen = Math.max(rcpW, rcpT) * 2 + 0.5;
    
        const vUp = { x: 0, y: 1, z: 0 };
        for (let bi = 0; bi < rcpBeams.length; bi++) {
            const rcp = rcpBeams[bi];
            const outer = rcp.p1;
            if (!outer) continue;
    
            let best = null;
            let bestD2 = Infinity;
            for (let k = 0; k < topHBeams.length; k++) {
                const h = topHBeams[k];
                const a = h.p1;
                const c = h.p2;
                if (!a || !c) continue;
                const { point, t: _t } = closestPointOnSegment3D(outer, a, c);
                const dx = point.x - outer.x, dy = point.y - outer.y, dz = point.z - outer.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 < bestD2) {
                    bestD2 = d2;
                    best = { point, h, a, c };
                }
            }
            if (best) {
                const c = best.point;
                out.push({
                    start: vAdd(c, vScale(vUp, -hBoltLen / 2)),
                    end: vAdd(c, vScale(vUp, hBoltLen / 2)),
                    center: c,
                    dir: { ...vUp },
                    length: hBoltLen,
                    radius: boltRadius,
                    headRadius: boltRadius * 1.8,
                    headHeight: boltRadius * 1.2,
                    boltType: 'rcp-ring',
                    boltSubType: 'top-ring',
                    stackThickness: hStackThick,
                    headSide: 1,
                    headExtraThickness: 0,
                    z: c.y,
                    moduleIndex: -1,
                    rcpStackId: rcp.stackId
                });
            }
        }
    
        const epsI = 0.001;
        const epsE = 0.999;
        const addDedup = [];
        const topology = cfg.rcpFinalTopology || cfg.rcpCrossings || [];
        const structureFoldRad = data._structureFoldAngleRad !== undefined ? data._structureFoldAngleRad : state.foldAngle;
        if (radToDeg(structureFoldRad) < (state.animation.rcpVisibleAngle ?? 90)) return out;
        const atDeployed = isRcpAtDeployedAngle(structureFoldRad);
        const kinematic = cfg.rcpKinematicMode;
        const activePivots = (kinematic && Array.isArray(cfg._rcpActivePivots)) ? cfg._rcpActivePivots : [];
        const stressed = kinematic && cfg._rcpVisualState === 'stress';
    
        const isActivePair = (stackA, stackB) => activePivots.some(p =>
            (p.beamAStackId === stackA && p.beamBStackId === stackB)
            || (p.beamAStackId === stackB && p.beamBStackId === stackA)
        );
    
        const pushCrossBolt = (useCenter, cDir, beamI, beamJ, diagnosticState, boltSubType) => {
            if (vMag(cDir) < 0.08) return;
            for (const q of addDedup) {
                if (vMag(vSub(q, useCenter)) < 1.2) return;
            }
            addDedup.push(useCenter);
            out.push({
                start: vAdd(useCenter, vScale(cDir, -crossBoltLen / 2)),
                end: vAdd(useCenter, vScale(cDir, crossBoltLen / 2)),
                center: { ...useCenter },
                dir: cDir,
                length: crossBoltLen,
                radius: boltRadius,
                headRadius: boltRadius * 1.8,
                headHeight: boltRadius * 1.2,
                boltType: 'rcp-cross',
                boltSubType,
                stackThickness: crossBoltLen * 0.4,
                headSide: 1,
                headExtraThickness: 0,
                z: useCenter.y,
                moduleIndex: -1,
                diagnosticState,
                rcpStackA: rcpBeams[beamI].stackId,
                rcpStackB: rcpBeams[beamJ].stackId
            });
        };
    
        const crossDirForBeams = (beamA, beamB) => {
            const dA3 = vNorm(vSub(beamA.p2, beamA.p1));
            const dB3 = vNorm(vSub(beamB.p2, beamB.p1));
            let cDir = vNorm(vCross(dA3, dB3));
            if (vMag(cDir) < 0.08) {
                const aH = { x: dA3.x, y: 0, z: dA3.z };
                const bH = { x: dB3.x, y: 0, z: dB3.z };
                if (vMag(aH) > 1e-4 && vMag(bH) > 1e-4) {
                    cDir = vNorm(vCross(vNorm(aH), vNorm(bH)));
                }
            }
            return cDir;
        };
    
        // While folding (kinematic): only the bolted-pivot ring is engaged. Each active bolt sits
        // at its solved world-space point (fixed as if drilled + bolted), red when stressed.
        if (kinematic && !atDeployed) {
            for (const p of activePivots) {
                const beamA = rcpBeams.find(b => b.stackId === p.beamAStackId);
                const beamB = rcpBeams.find(b => b.stackId === p.beamBStackId);
                if (!beamA || !beamB || !beamA.p1 || !beamA.p2 || !beamB.p1 || !beamB.p2) continue;
                const cDir = crossDirForBeams(beamA, beamB);
                const idxA = rcpBeams.indexOf(beamA);
                const idxB = rcpBeams.indexOf(beamB);
                pushCrossBolt(p.pivot, cDir, idxA, idxB, stressed ? 'error' : 'active', 'pivot');
            }
            return out;
        }
    
        // Deployed (or manual): show every baked crossing as a potential bolt hole.
        for (let i = 0; i < rcpBeams.length; i++) {
            for (let j = i + 1; j < rcpBeams.length; j++) {
                const A0 = rcpBeams[i].p1, A1 = rcpBeams[i].p2;
                const B0 = rcpBeams[j].p1, B1 = rcpBeams[j].p2;
                if (!A0 || !A1 || !B0 || !B1) continue;
                const a0x = { x: A0.x, z: A0.z }, a1x = { x: A1.x, z: A1.z };
                const b0x = { x: B0.x, z: B0.z }, b1x = { x: B1.x, z: B1.z };
    
                const da3 = vSub(A1, A0);
                const db3 = vSub(B1, B0);
                const dA3 = vNorm(da3);
                const dB3 = vNorm(db3);
                if (vMag(dA3) < 1e-6 || vMag(dB3) < 1e-6) continue;
    
                const isect = segSegIntersectParamsXZ(a0x, a1x, b0x, b1x);
                if (!isect) continue;
                if (isect.t <= epsI || isect.t >= epsE || isect.s <= epsI || isect.s >= epsE) continue;
                const t = isect.t, s = isect.s;
                const pA = vAdd(A0, vScale(vSub(A1, A0), t));
                const pB = vAdd(B0, vScale(vSub(B1, B0), s));
                const useCenter = vScale(vAdd(pA, pB), 0.5);
                const active = isActivePair(rcpBeams[i].stackId, rcpBeams[j].stackId);
                const cDir = crossDirForBeams(rcpBeams[i], rcpBeams[j]);
                if (vMag(cDir) < 0.08) continue;
    
                let diagnosticState = null;
                if (active) {
                    diagnosticState = stressed ? 'error' : 'active';
                } else if (kinematic && topology.length > 0) {
                    diagnosticState = 'inactive';
                }
    
                pushCrossBolt(useCenter, cDir, i, j, diagnosticState, 'intersection');
            }
        }
        return out;
    }
    
    /**
     * Translates all position-bearing fields in a geometry data object by (-dx, 0, -dz).
     * Creates new spread-cloned objects so the solver cache is never mutated.
     * Used to re-center the ring at world origin after every solve, keeping the IBC
     * at a fixed position while the structure expands symmetrically from both sides.
     *
     * @param {Object} data  - Geometry data (mutates arrays in-place, but each element is a new object)
     * @param {number} dx    - X shift to subtract
     * @param {number} dz    - Z shift to subtract
     */
    function shiftGeometryXZ(data, dx, dz) {
        if (!dx && !dz) return;
    
        // Shift a single {x,y,z} point (returns a new object, Y is unchanged)
        const sp = (p) => p ? { ...p, x: p.x - dx, z: p.z - dz } : p;
    
        // Beams (includes support beams merged in via data.beams.concat)
        data.beams = (data.beams || []).map(b => !b ? b : {
            ...b,
            corners: b.corners ? b.corners.map(sp) : b.corners,
            center:  sp(b.center),
            p1:      sp(b.p1),
            p2:      sp(b.p2),
        });
    
        // Brackets
        data.brackets = (data.brackets || []).map(br => !br ? br : {
            ...br,
            pos:       sp(br.pos),
            bottomPos: br.bottomPos ? sp(br.bottomPos) : br.bottomPos,
        });
    
        // Bolts
        data.bolts = (data.bolts || []).map(bolt => !bolt ? bolt : {
            ...bolt,
            center: sp(bolt.center),
            start:  bolt.start ? sp(bolt.start) : bolt.start,
            end:    bolt.end   ? sp(bolt.end)   : bolt.end,
        });
    
        // Washers
        data.washers = (data.washers || []).map(w => !w ? w : {
            ...w,
            center: sp(w.center),
        });
    
        // Support beams sub-array (elements are the same objects now in data.beams, but keep
        // the array reference consistent so callers iterating data.supportBeams also get shifted data)
        if (data.supportBeams) {
            data.supportBeams = data.supportBeams.map(b => !b ? b : {
                ...b,
                corners: b.corners ? b.corners.map(sp) : b.corners,
                center:  sp(b.center),
                p1:      sp(b.p1),
                p2:      sp(b.p2),
            });
        }
    
        // Solar panels
        data.panels = (data.panels || []).map(panel => !panel ? panel : {
            ...panel,
            corners: panel.corners ? panel.corners.map(sp) : panel.corners,
            center:  sp(panel.center),
        });
    
        // Canopy metadata (center used for stats/display)
        if (data.canopy && data.canopy.center) {
            data.canopy = { ...data.canopy, center: sp(data.canopy.center) };
        }
    }
    
    /**
     * Builds the observed LinkageLab geometry component set.
     * This keeps display, JSON snapshots, simulator export, and GLB export from drifting apart.
     */
    function buildLinkageGeometry(options = {}) {
        const includeSupportBeams = options.includeSupportBeams !== false;
        const includePanels = options.includePanels !== false;
        const foldAngle = options.foldAngle !== undefined ? options.foldAngle : state.foldAngle;
        const base = options.useCache ? getLinkageData() : solveLinkage(foldAngle);
        
        // Copy top-level arrays before appending generated pieces so cached solver output is never mutated.
        const data = Object.assign({}, base, {
            beams: base.beams ? base.beams.slice() : [],
            brackets: base.brackets ? base.brackets.slice() : [],
            bolts: base.bolts ? base.bolts.slice() : [],
            washers: base.washers ? base.washers.slice() : [],
            hardwareAssemblyPlacements: base.hardwareAssemblyPlacements ? base.hardwareAssemblyPlacements.slice() : [],
            panels: [],
            canopy: null,
            supportBeams: [],
            _structureFoldAngleRad: foldAngle
        });
        
        if (includeSupportBeams) {
            data.supportBeams = generateSupportBeams(data);
            if (data.supportBeams.length > 0) {
                data.beams = data.beams.concat(data.supportBeams);
            }
            const rcpBolts = generateReciprocalSupportBolts(data);
            if (rcpBolts.length > 0) {
                data.bolts = (data.bolts || []).concat(rcpBolts);
            }
            // Seed deployed reciprocal topology at closed angle on first render (or after layout reset).
            if (state.supportBeams && state.supportBeams.rcpKinematicMode && !state.supportBeams.rcpCrossings) {
                const seeded = seedFinalReciprocalTopology();
                if (seeded && state.supportBeams.rcpCrossings && state.supportBeams.rcpCrossings.length > 0) {
                    const cnt = {};
                    state.supportBeams.rcpCrossings.forEach(c => {
                        cnt[c.beamAStackId] = (cnt[c.beamAStackId] || 0) + 1;
                        cnt[c.beamBStackId] = (cnt[c.beamBStackId] || 0) + 1;
                    });
                    const perBeam = Object.values(cnt);
                    console.log(`[rcp-kin] Seeded ${state.supportBeams.rcpCrossings.length} crossings at closed config (seedSwing=${(state.supportBeams._seedSwingDeg ?? 0).toFixed(1)}°), holes/beam: min=${perBeam.length ? Math.min(...perBeam) : 0} max=${perBeam.length ? Math.max(...perBeam) : 0}`);
                    window.__rcpSolverLogCount = 0;
                    const newSupportBeams = generateSupportBeams(data);
                    data.supportBeams = newSupportBeams;
                    data.beams = data.beams.filter(b => b.stackType !== 'support-beam-reciprocal')
                        .concat(newSupportBeams.filter(b => b.stackType === 'support-beam-reciprocal'));
                    data.bolts = (data.bolts || []).filter(b => !(b && (b.boltType === 'rcp-cross' || b.boltType === 'rcp-ring')))
                        .concat(generateReciprocalSupportBolts(data));
                }
            }
            updateRcpDiagnosticsUI();
            data.supportBeamsUnsupported = !!(state.supportBeams && state.supportBeams.enabled && state.orientation === 'vertical');
        }
        
        if (includePanels && state.solarPanels && state.solarPanels.enabled) {
            const foldingMode = hasFoldingSolarPanels();
            const autoAnim = foldingMode && useFoldingPanelAutoAnim();
            let panelsVisible;
            if (autoAnim) {
                panelsVisible = getFoldingPanelsVisibleAtAngle(foldAngle);
            } else if (foldingMode) {
                panelsVisible = true;
            } else {
                const panelMinRad = (() => {
                    const userDeg = state.animation.panelsVisibleAngle;
                    if (userDeg !== null && userDeg !== undefined) return degToRad(userDeg);
                    return (typeof getOptimalClosedAngleForAnimation === 'function')
                        ? getOptimalClosedAngleForAnimation() - degToRad(2)
                        : foldAngle;
                })();
                panelsVisible = foldAngle >= panelMinRad;
            }
            if (panelsVisible) {
                try {
                    const solarData = calculateSolarPanels(data);
                    data.panels = solarData.panels || [];
                    applyFoldingPanelAnimationState(data.panels, foldAngle, autoAnim);
                    data.canopy = solarData.canopy || null;
                } catch (e) {
                    console.warn('[Geometry] Could not calculate solar panels:', e);
                    data.panels = [];
                    data.canopy = null;
                }
            }
        }
        
        data.structureBounds = calculateBeamBounds(data.beams, { mainStructureOnly: true });
        data.structureCenter = data.structureBounds.center;
        data.fullBounds = calculateBeamBounds(data.beams);
    
        // Anchor the IBC at the ring center of the fully-deployed configuration.
        // By using a CONSTANT shift (the deployed ring center, not the current frame's center),
        // the IBC stays fixed at world origin while the folded structure sits off to one side,
        // then sweeps around and wraps around the IBC as it deploys.
        if (!state._deployedRingCenter) {
            // Compute the bbox center of the ring at the fully-closed (deployed) fold angle.
            // getOptimalClosedAngleForAnimation uses only calculateJointPositions, no recursion risk.
            const deployedAngle = (typeof getOptimalClosedAngleForAnimation === 'function')
                ? getOptimalClosedAngleForAnimation()
                : foldAngle;
            const deployedBase = solveLinkage(deployedAngle);
            const deployedBounds = calculateBeamBounds(deployedBase.beams, { mainStructureOnly: true });
            state._deployedRingCenter = deployedBounds.center;
        }
        const _shiftX = state._deployedRingCenter.x;
        const _shiftZ = state._deployedRingCenter.z;
        if (_shiftX !== 0 || _shiftZ !== 0) {
            shiftGeometryXZ(data, _shiftX, _shiftZ);
            // Recompute bounds after the constant shift
            data.structureBounds = calculateBeamBounds(data.beams, { mainStructureOnly: true });
            data.structureCenter = data.structureBounds.center;
            data.fullBounds = calculateBeamBounds(data.beams);
        }
    
        return data;
    }


const _moduleExports = {
    buildLinkageGeometry,
    applyLegacyPanelsSupport,
    applySupportBeamsConfig,
    buildGeometrySnapshot,
    buildRcpAnchorFromFrame,
    buildRcpBeamCrossingTs,
    buildRcpCrossingRefs,
    buildRcpHoleTsByBeam,
    buildRcpHorizontalFrame,
    buildReciprocalBeamKinematics,
    calculateArchCanopySections,
    calculateArchLayout,
    calculateArchWallFaces,
    calculateBeamBounds,
    calculateCanopyArea,
    calculateRadialLayout,
    calculateRectangularLayout,
    calculateSolarPanels,
    calculateSpiralLayout,
    closestPointOnSegment3D,
    computeRcpAnchorPosition,
    computeRcpBeamUnitDir,
    computeRcpCrossingRefsFromBeams,
    computeRcpPoint,
    computeRcpStructureCenter,
    computeSupportBomContribution,
    enrichCrossingsWithHoleIndex,
    extractModuleFrames,
    generateReciprocalSupportBolts,
    generateSupportBeams,
    generateWallFaceButtons,
    getActivePanelConfig,
    getModuleTopBeam,
    getRcpPivotT,
    getSupportBeamPlaneY,
    holeMidpointForCrossing,
    isMainStructureBeam,
    isRcpAtDeployedAngle,
    pickOuterVerticalBeam,
    pointOnBeamAtY,
    rcpCrossingWeight,
    resetSupportBeamsToDefaults,
    roundVec3ForExport,
    seedFinalReciprocalTopology,
    seedRcpCrossings,
    segSegIntersectParamsXZ,
    selectActiveRcpCrossing,
    selectActiveRcpRing,
    shiftGeometryXZ,
    solveRadialSupportBeamPlacement,
    solveReciprocalActiveRing,
    solveReciprocalLinkage,
    solveReciprocalPerBeamSwing,
    solveReciprocalSwingAngle,
    spApplyPresetToPanelConfig,
    spBindFormFactorUI,
    spFindPresetById,
    spGetAllPresets,
    spGetPanelConfig,
    spInitPanelPresetUI,
    spLinkConfigsToKnownPresets,
    spLoadPresetCatalog,
    spLoadUserPresetsMap,
    spMarkPanelConfigManual,
    spOnPresetSelect,
    spPanelConfigSignature,
    spPresetFromRaw,
    spPresetSignature,
    spRefreshPresetDropdown,
    spRefreshPresetDropdowns,
    spRefreshSolarPanelScene,
    spSavePanelConfigAsPreset,
    spSaveUserPreset,
    spSeedPresetsFromConstants,
    spSlugifyId,
    spSuffix,
    spSyncFormFactorControlsFromState,
    spSyncPanelSectionUI,
    spUpdateFormFactorUI,
    spUpdatePresetLink,
    updateArchWallFacesUI,
    updateRcpDiagnosticsUI,
    validateReciprocalKinematicsSweep,
};

bridgeGlobals(_moduleExports, 'linkageGeometry');

export { buildLinkageGeometry, applyLegacyPanelsSupport, applySupportBeamsConfig, buildGeometrySnapshot, buildRcpAnchorFromFrame, buildRcpBeamCrossingTs, buildRcpCrossingRefs, buildRcpHoleTsByBeam, buildRcpHorizontalFrame, buildReciprocalBeamKinematics, calculateArchCanopySections, calculateArchLayout, calculateArchWallFaces, calculateBeamBounds, calculateCanopyArea, calculateRadialLayout, calculateRectangularLayout, calculateSolarPanels, calculateSpiralLayout, closestPointOnSegment3D, computeRcpAnchorPosition, computeRcpBeamUnitDir, computeRcpCrossingRefsFromBeams, computeRcpPoint, computeRcpStructureCenter, computeSupportBomContribution, enrichCrossingsWithHoleIndex, extractModuleFrames, generateReciprocalSupportBolts, generateSupportBeams, generateWallFaceButtons, getActivePanelConfig, getModuleTopBeam, getRcpPivotT, getSupportBeamPlaneY, holeMidpointForCrossing, isMainStructureBeam, isRcpAtDeployedAngle, pickOuterVerticalBeam, pointOnBeamAtY, rcpCrossingWeight, resetSupportBeamsToDefaults, roundVec3ForExport, seedFinalReciprocalTopology, seedRcpCrossings, segSegIntersectParamsXZ, selectActiveRcpCrossing, selectActiveRcpRing, shiftGeometryXZ, solveRadialSupportBeamPlacement, solveReciprocalActiveRing, solveReciprocalLinkage, solveReciprocalPerBeamSwing, solveReciprocalSwingAngle, spApplyPresetToPanelConfig, spBindFormFactorUI, spFindPresetById, spGetAllPresets, spGetPanelConfig, spInitPanelPresetUI, spLinkConfigsToKnownPresets, spLoadPresetCatalog, spLoadUserPresetsMap, spMarkPanelConfigManual, spOnPresetSelect, spPanelConfigSignature, spPresetFromRaw, spPresetSignature, spRefreshPresetDropdown, spRefreshPresetDropdowns, spRefreshSolarPanelScene, spSavePanelConfigAsPreset, spSaveUserPreset, spSeedPresetsFromConstants, spSlugifyId, spSuffix, spSyncFormFactorControlsFromState, spSyncPanelSectionUI, spUpdateFormFactorUI, spUpdatePresetLink, updateArchWallFacesUI, updateRcpDiagnosticsUI, validateReciprocalKinematicsSweep };
