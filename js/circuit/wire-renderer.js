/**
 * Wire Renderer Module
 * Handles wire path generation and rendering logic
 */

/**
 * Get absolute position of a handle in world coordinates
 */
export function getHandlePosition(item, handle) {
    return {
        x: item.x + handle.x,
        y: item.y + handle.y
    };
}

/**
 * Generate bezier curve path string
 */
export function generateCurvePath(sx, sy, ex, ey, sourceSide, targetSide) {
    sourceSide = sourceSide || 'top';
    targetSide = targetSide || 'top';
    
    const dist = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
    const curveStrength = Math.min(80, Math.max(30, dist * 0.4));
    
    let sc1x = sx, sc1y = sy, sc2x = ex, sc2y = ey;
    
    switch (sourceSide) {
        case 'top': sc1y = sy - curveStrength; break;
        case 'bottom': sc1y = sy + curveStrength; break;
        case 'left': sc1x = sx - curveStrength; break;
        case 'right': sc1x = sx + curveStrength; break;
    }
    
    switch (targetSide) {
        case 'top': sc2y = ey - curveStrength; break;
        case 'bottom': sc2y = ey + curveStrength; break;
        case 'left': sc2x = ex - curveStrength; break;
        case 'right': sc2x = ex + curveStrength; break;
    }
    
    return `M ${sx} ${sy} C ${sc1x} ${sc1y}, ${sc2x} ${sc2y}, ${ex} ${ey}`;
}

/**
 * Generate smooth path through waypoints using Catmull-Rom to Bezier conversion
 */
export function generateWaypointPath(start, end, waypoints, sourceSide, targetSide) {
    const points = [
        { x: start.x, y: start.y },
        ...waypoints.map(w => ({ x: w.x, y: w.y })),
        { x: end.x, y: end.y }
    ];
    
    if (points.length < 2) return "";
    
    if (points.length === 2) {
        return generateCurvePath(start.x, start.y, end.x, end.y, sourceSide, targetSide);
    }
    
    const curveStrength = 40;
    let startControl = { x: start.x, y: start.y };
    let endControl = { x: end.x, y: end.y };
    
    switch (sourceSide) {
        case 'top': startControl.y = start.y - curveStrength; break;
        case 'bottom': startControl.y = start.y + curveStrength; break;
        case 'left': startControl.x = start.x - curveStrength; break;
        case 'right': startControl.x = start.x + curveStrength; break;
    }
    
    switch (targetSide) {
        case 'top': endControl.y = end.y - curveStrength; break;
        case 'bottom': endControl.y = end.y + curveStrength; break;
        case 'left': endControl.x = end.x - curveStrength; break;
        case 'right': endControl.x = end.x + curveStrength; break;
    }
    
    let path = `M ${start.x} ${start.y}`;
    
    if (waypoints.length === 1) {
        const wp = waypoints[0];
        path += ` Q ${startControl.x} ${startControl.y}, ${wp.x} ${wp.y}`;
        path += ` Q ${endControl.x} ${endControl.y}, ${end.x} ${end.y}`;
    } else {
        const firstWp = waypoints[0];
        path += ` Q ${startControl.x} ${startControl.y}, ${firstWp.x} ${firstWp.y}`;
        
        for (let i = 0; i < waypoints.length - 1; i++) {
            const current = waypoints[i];
            const next = waypoints[i + 1];
            const midX = (current.x + next.x) / 2;
            const midY = (current.y + next.y) / 2;
            path += ` Q ${current.x} ${current.y}, ${midX} ${midY}`;
        }
        
        const lastWp = waypoints[waypoints.length - 1];
        path += ` Q ${lastWp.x} ${lastWp.y}, ${end.x} ${end.y}`;
    }
    
    return path;
}

/**
 * Generate wire path for a connection
 * @param {Object} conn - Connection object
 * @param {Array} allItems - All items array
 * @returns {string} SVG path string
 */
export function generateWirePath(conn, allItems) {
    const sourceItem = allItems.find(i => i.id === conn.sourceItemId);
    const targetItem = allItems.find(i => i.id === conn.targetItemId);
    if (!sourceItem || !targetItem) return "";
    
    const sourceHandle = Object.values(sourceItem.handles).find(h => h.id === conn.sourceHandleId);
    const targetHandle = Object.values(targetItem.handles).find(h => h.id === conn.targetHandleId);
    if (!sourceHandle || !targetHandle) return "";
    
    const start = getHandlePosition(sourceItem, sourceHandle);
    const end = getHandlePosition(targetItem, targetHandle);
    
    if (!conn.waypoints || conn.waypoints.length === 0) {
        return generateCurvePath(start.x, start.y, end.x, end.y, sourceHandle.side, targetHandle.side);
    }
    
    return generateWaypointPath(start, end, conn.waypoints, sourceHandle.side, targetHandle.side);
}

/**
 * Wire path cache for performance optimization
 */
class WirePathCache {
    constructor() {
        this.cache = new Map();
        this.invalidatedConnections = new Set();
    }
    
    get(connId) {
        if (this.invalidatedConnections.has(connId)) {
            return null;
        }
        return this.cache.get(connId);
    }
    
    set(connId, path) {
        this.cache.set(connId, path);
        this.invalidatedConnections.delete(connId);
    }
    
    invalidate(connId) {
        this.invalidatedConnections.add(connId);
        this.cache.delete(connId);
    }
    
    invalidateAll() {
        this.cache.clear();
        this.invalidatedConnections.clear();
    }
    
    clear() {
        this.cache.clear();
        this.invalidatedConnections.clear();
    }
}

export const wirePathCache = new WirePathCache();

/**
 * Generate wire path with caching
 */
export function generateWirePathCached(conn, allItems) {
    const cached = wirePathCache.get(conn.id);
    if (cached !== null) {
        return cached;
    }
    
    const path = generateWirePath(conn, allItems);
    wirePathCache.set(conn.id, path);
    return path;
}

/**
 * Calculate distance from point to line segment
 */
export function pointToSegmentDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const lenSq = dx * dx + dy * dy;
    
    if (lenSq === 0) {
        return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
    }
    
    let t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    
    const projX = lineStart.x + t * dx;
    const projY = lineStart.y + t * dy;
    
    return Math.sqrt((point.x - projX) ** 2 + (point.y - projY) ** 2);
}
