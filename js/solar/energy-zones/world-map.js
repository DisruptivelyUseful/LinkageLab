import { ZONES } from './constants.js';
import { ghiKwhPerM2Day, getZone } from './energy.js';

const TOPO_LOCAL = 'data/countries-110m.json';
const TOPO_CDN = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json';
const GRID_STEP_DEG = 2;
const MAX_DPR = 1.5;
const ZONE_UNFOCUSED_ALPHA_FACTOR = 0.07;

function gridDimensions(step) {
    const nLat = Math.ceil(180 / step);
    const nLng = Math.ceil(360 / step);
    return { nLat, nLng };
}

function buildLandMask(land, nLat, nLng, d3) {
    const w = nLng;
    const h = nLat;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return new Uint8Array(w * h);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const projection = d3.geoEquirectangular().scale(w / (2 * Math.PI)).translate([w / 2, h / 2]);
    const path = d3.geoPath().projection(projection).context(ctx);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    path(land);
    ctx.fill();
    const img = ctx.getImageData(0, 0, w, h);
    const mask = new Uint8Array(w * h);
    for (let iy = 0; iy < h; iy++) {
        for (let ix = 0; ix < w; ix++) {
            const j = (iy * w + ix) * 4;
            mask[iy * w + ix] = img.data[j] > 96 ? 1 : 0;
        }
    }
    return mask;
}

function buildZoneCellCache(land, ghiGrid, step, d3) {
    const { nLat, nLng } = gridDimensions(step);
    const landMask = buildLandMask(land, nLat, nLng, d3);
    const zoneId = new Uint8Array(nLat * nLng);
    let i = 0;
    for (let lat = -90; lat < 90; lat += step) {
        for (let lng = -180; lng < 180; lng += step) {
            const latIdxS = Math.floor((lat + 90) / step);
            const lngIdx = Math.floor((lng + 180) / step);
            const iy = nLat - 1 - latIdxS;
            const onLand = landMask[iy * nLng + lngIdx] === 1;
            if (onLand) {
                const cx = lng + step / 2;
                const cy = lat + step / 2;
                zoneId[i] = getZone(ghiKwhPerM2Day(cy, cx, ghiGrid)).id;
            } else {
                zoneId[i] = 0;
            }
            i++;
        }
    }
    return { step, nLat, nLng, zoneId };
}

function zoneFillAlpha(cellZoneId, focusZoneId, baseAlpha) {
    if (focusZoneId == null) return baseAlpha;
    return cellZoneId === focusZoneId ? baseAlpha : baseAlpha * ZONE_UNFOCUSED_ALPHA_FACTOR;
}

async function loadWorldTopology() {
    const res = await fetch(TOPO_LOCAL, { cache: 'force-cache' });
    if (res.ok) return res.json();
    const fallback = await fetch(TOPO_CDN);
    if (!fallback.ok) throw new Error('Failed to load world topology');
    return fallback.json();
}

async function loadTopojsonClient() {
    if (globalThis.topojson?.feature) return globalThis.topojson;
    await new Promise((resolve, reject) => {
        const existing = document.querySelector('script[data-topojson-client]');
        if (existing?.dataset.loaded === 'true') {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/topojson-client@3/dist/topojson-client.min.js';
        script.dataset.topojsonClient = 'true';
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => reject(new Error('Failed to load topojson-client'));
        document.head.appendChild(script);
    });
    return globalThis.topojson;
}

/**
 * Interactive world map with GHI energy zones (vanilla port of Energy Zones picker).
 */
export class EnergyZoneWorldMap {
    /**
     * @param {HTMLElement} container
     * @param {{ ghiGrid?: import('./ghi-grid.js').GhiGrid | null, onLocationSelect?: (lat: number, lng: number) => void, onZoneLegendSelect?: (zoneId: number) => void }} options
     */
    constructor(container, options = {}) {
        this.container = container;
        this.ghiGrid = options.ghiGrid ?? null;
        this.onLocationSelect = options.onLocationSelect ?? (() => {});
        this.onZoneLegendSelect = options.onZoneLegendSelect ?? (() => {});
        this.selectedLocation = null;
        this.selectedZoneId = null;
        this.hoveredZoneId = null;
        this.worldData = null;
        this.zoneCache = null;
        this.d3 = null;
        this.topojson = null;
        this._resizeObserver = null;
        this._disposed = false;

        container.innerHTML = `
            <div class="ez-map-frame">
                <div class="ez-map-loading">Loading map…</div>
                <canvas class="ez-map-base" aria-label="World energy zone map"></canvas>
                <canvas class="ez-map-overlay" aria-hidden="true"></canvas>
                <div class="ez-map-coords" hidden></div>
            </div>
            <div class="ez-zone-legend" aria-label="Solar energy potential zones"></div>
        `;

        this.frameEl = container.querySelector('.ez-map-frame');
        this.loadingEl = container.querySelector('.ez-map-loading');
        this.baseCanvas = container.querySelector('.ez-map-base');
        this.overlayCanvas = container.querySelector('.ez-map-overlay');
        this.coordsEl = container.querySelector('.ez-map-coords');
        this.legendEl = container.querySelector('.ez-zone-legend');
        this._buildLegend();
    }

    _buildLegend() {
        this.legendEl.innerHTML = `
            <div class="ez-zone-legend-title">Solar Energy Potential (GHI)</div>
            <div class="ez-zone-legend-grid"></div>
        `;
        const grid = this.legendEl.querySelector('.ez-zone-legend-grid');
        ZONES.forEach((zone) => {
            const rangeLabel = zone.id === 6 ? `${zone.range[0]}+` : `${zone.range[0]}–${zone.range[1]}`;
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'ez-zone-chip';
            btn.dataset.zoneId = String(zone.id);
            btn.innerHTML = `
                <span class="ez-zone-chip-swatch" style="background:${zone.color}"></span>
                <span class="ez-zone-chip-label">Zone ${zone.id}</span>
                <span class="ez-zone-chip-range">${rangeLabel} kWh/m²/d</span>
            `;
            btn.addEventListener('mouseenter', () => {
                this.hoveredZoneId = zone.id;
                this._paintBase();
            });
            btn.addEventListener('mouseleave', () => {
                this.hoveredZoneId = null;
                this._paintBase();
            });
            btn.addEventListener('click', () => {
                this.selectedZoneId = zone.id;
                this._syncLegendActive();
                this.onZoneLegendSelect(zone.id);
            });
            grid.appendChild(btn);
        });
        this.legendEl.addEventListener('mouseleave', () => {
            this.hoveredZoneId = null;
            this._paintBase();
        });
    }

    async init() {
        if (typeof globalThis.d3 === 'undefined') {
            throw new Error('D3 is required for the energy zone map');
        }
        this.d3 = globalThis.d3;
        this.topojson = await loadTopojsonClient();
        this.worldData = await loadWorldTopology();
        if (this._disposed) return;

        const land = this.topojson.feature(this.worldData, this.worldData.objects.land);
        this.zoneCache = buildZoneCellCache(land, this.ghiGrid, GRID_STEP_DEG, this.d3);

        this.loadingEl.hidden = true;
        this.loadingEl.style.pointerEvents = 'none';
        this.frameEl.style.cursor = 'crosshair';
        this.frameEl.addEventListener('click', this._onMapClick);
        this.frameEl.addEventListener('pointerdown', this._onMapPointerDown);
        this._resizeObserver = new ResizeObserver(() => {
            this._paintBase();
            this._paintOverlay();
        });
        this._resizeObserver.observe(this.frameEl);
        requestAnimationFrame(() => {
            this._paintBase();
            this._paintOverlay();
        });
    }

    setGhiGrid(grid) {
        this.ghiGrid = grid;
        if (this.worldData && this.d3 && this.topojson) {
            const land = this.topojson.feature(this.worldData, this.worldData.objects.land);
            this.zoneCache = buildZoneCellCache(land, this.ghiGrid, GRID_STEP_DEG, this.d3);
            this._paintBase();
        }
    }

    setSelectedLocation(lat, lng) {
        if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
            this.selectedLocation = null;
            if (this.coordsEl) this.coordsEl.hidden = true;
            this._paintOverlay();
            return;
        }
        this.selectedLocation = { lat, lng };
        if (this.coordsEl) {
            this.coordsEl.hidden = false;
            this.coordsEl.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(4)}°${lng >= 0 ? 'E' : 'W'}`;
        }
        this._paintOverlay();
    }

    setSelectedZoneId(zoneId) {
        this.selectedZoneId = zoneId;
        this._syncLegendActive();
        this._paintBase();
    }

    _syncLegendActive() {
        this.legendEl.querySelectorAll('.ez-zone-chip').forEach((btn) => {
            btn.classList.toggle('active', Number(btn.dataset.zoneId) === this.selectedZoneId);
        });
    }

    _mapPointFromEvent(ev) {
        const rect = this.frameEl.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0 || !this.d3) return null;

        const cssW = rect.width;
        const cssH = rect.height;
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        const projection = this.d3.geoEquirectangular()
            .scale(cssW / (2 * Math.PI))
            .translate([cssW / 2, cssH / 2]);
        const inv = projection.invert?.([x, y]);
        if (!inv || !Number.isFinite(inv[0]) || !Number.isFinite(inv[1])) return null;
        return { lat: inv[1], lng: inv[0] };
    }

    _applyMapPick(lat, lng) {
        this.setSelectedLocation(lat, lng);
        this.selectedZoneId = null;
        this._syncLegendActive();
        this._paintBase();
        this.onLocationSelect(lat, lng);
    }

    _onMapPointerDown = (ev) => {
        if (ev.button !== 0) return;
        this.frameEl.setPointerCapture?.(ev.pointerId);
    };

    _onMapClick = (ev) => {
        if (ev.target.closest('.ez-zone-chip')) return;
        const point = this._mapPointFromEvent(ev);
        if (!point) return;
        ev.preventDefault();
        ev.stopPropagation();
        this._applyMapPick(point.lat, point.lng);
    };

    _paintBase() {
        const canvas = this.baseCanvas;
        const container = this.frameEl;
        if (!canvas || !container || !this.worldData || !this.d3 || !this.topojson) return;

        const cssW = container.clientWidth || 640;
        const cssH = cssW * 0.5;
        const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, cssW, cssH);

        const projection = this.d3.geoEquirectangular()
            .scale(cssW / (2 * Math.PI))
            .translate([cssW / 2, cssH / 2]);
        const pathToCanvas = this.d3.geoPath().projection(projection).context(ctx);
        const land = this.topojson.feature(this.worldData, this.worldData.objects.land);
        const focusZoneId = this.hoveredZoneId ?? this.selectedZoneId ?? null;
        const cache = this.zoneCache;

        if (cache) {
            const { step, zoneId } = cache;
            let i = 0;
            for (let lat = -90; lat < 90; lat += step) {
                for (let lng = -180; lng < 180; lng += step) {
                    const zid = zoneId[i++];
                    if (!zid) continue;
                    const zone = ZONES.find((z) => z.id === zid);
                    if (!zone) continue;
                    const ring = [
                        [lng, lat],
                        [lng + step, lat],
                        [lng + step, lat + step],
                        [lng, lat + step],
                        [lng, lat],
                    ];
                    ctx.beginPath();
                    for (let k = 0; k < ring.length; k++) {
                        const p = projection(ring[k]);
                        if (!p) continue;
                        if (k === 0) ctx.moveTo(p[0], p[1]);
                        else ctx.lineTo(p[0], p[1]);
                    }
                    ctx.closePath();
                    const focused = focusZoneId != null && zid === focusZoneId;
                    ctx.fillStyle = zone.color;
                    ctx.globalAlpha = zoneFillAlpha(zid, focusZoneId, 1);
                    ctx.save();
                    if (focused) {
                        ctx.shadowColor = 'rgba(251, 191, 36, 0.45)';
                        ctx.shadowBlur = 6;
                    }
                    ctx.fill();
                    ctx.restore();
                    ctx.globalAlpha = 1;
                }
            }
        }

        ctx.beginPath();
        pathToCanvas(land);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
    }

    _paintOverlay() {
        const base = this.baseCanvas;
        const overlay = this.overlayCanvas;
        const container = this.frameEl;
        if (!base || !overlay || !container || !this.d3) return;

        const cssW = container.clientWidth || 640;
        const cssH = cssW * 0.5;
        const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);

        overlay.style.width = `${cssW}px`;
        overlay.style.height = `${cssH}px`;
        overlay.width = Math.round(cssW * dpr);
        overlay.height = Math.round(cssH * dpr);

        const ctx = overlay.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        if (!this.selectedLocation) return;

        const projection = this.d3.geoEquirectangular()
            .scale(cssW / (2 * Math.PI))
            .translate([cssW / 2, cssH / 2]);
        const p = projection([this.selectedLocation.lng, this.selectedLocation.lat]);
        if (!p) return;
        const [x, y] = p;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }

    dispose() {
        this._disposed = true;
        this.frameEl?.removeEventListener('click', this._onMapClick);
        this.frameEl?.removeEventListener('pointerdown', this._onMapPointerDown);
        this._resizeObserver?.disconnect();
    }
}

export default EnergyZoneWorldMap;
