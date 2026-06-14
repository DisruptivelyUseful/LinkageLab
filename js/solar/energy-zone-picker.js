import { REFERENCE_GHI_KWH, ZONES } from './energy-zones/constants.js';
import { loadGhiGrid } from './energy-zones/ghi-grid.js';
import {
    formatLatLng,
    getZone,
    getZoneNarrative,
    ghiKwhPerM2Day,
    findSimilarCities,
    findCitiesInZone,
    findSisterCity,
    zoneGhiRangeLabel,
} from './energy-zones/energy.js';
import { searchAddress } from './energy-zones/geocode.js';
import { loadZonePopulation, renderZonePopulationChart } from './energy-zones/zone-population.js';
import { EnergyZoneWorldMap } from './energy-zones/world-map.js';
import { showToast } from '../core/feedback.js';

const MODAL_PARTIAL = 'partials/energy-zone-modal.html';
let modalMounted = false;
let mapInstance = null;
let ghiGrid = null;
let zonePopulation = null;
let pendingSelection = null;

function ensureStylesheet() {
    if (document.getElementById('energy-zone-css')) return;
    const link = document.createElement('link');
    link.id = 'energy-zone-css';
    link.rel = 'stylesheet';
    link.href = 'css/energy-zone.css';
    document.head.appendChild(link);
}

async function mountModal() {
    if (modalMounted && document.getElementById('energy-zone-modal')) return;
    ensureStylesheet();
    const res = await fetch(MODAL_PARTIAL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${MODAL_PARTIAL}`);
    document.getElementById('energy-zone-modal')?.remove();
    const wrapper = document.createElement('div');
    wrapper.innerHTML = await res.text();
    const modal = wrapper.firstElementChild;
    if (!modal) throw new Error('Energy zone modal partial was empty');
    document.body.appendChild(modal);
    modalMounted = true;
    wireModal(modal);
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && document.getElementById('energy-zone-modal')?.classList.contains('visible')) {
            closeEnergyZonePicker();
        }
    });
}

function clearGeocodeUi(modal) {
    const errEl = modal.querySelector('#energy-zone-geocode-error');
    const resultsEl = modal.querySelector('#energy-zone-geocode-results');
    if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
    }
    if (resultsEl) {
        resultsEl.hidden = true;
        resultsEl.innerHTML = '';
    }
}

function wireModal(modal) {
    modal.querySelector('.ez-close')?.addEventListener('click', closeEnergyZonePicker);
    modal.querySelector('#energy-zone-cancel')?.addEventListener('click', closeEnergyZonePicker);
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal) closeEnergyZonePicker();
    });
    modal.querySelector('#energy-zone-apply')?.addEventListener('click', () => {
        if (!pendingSelection || pendingSelection.lat == null) return;
        applySelection(pendingSelection);
        closeEnergyZonePicker();
    });

    modal.querySelector('#energy-zone-coords-form')?.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const lat = parseFloat(modal.querySelector('#energy-zone-lat')?.value);
        const lng = parseFloat(modal.querySelector('#energy-zone-lng')?.value);
        if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            showToast('Enter valid latitude (-90…90) and longitude (-180…180)', 'warning');
            return;
        }
        clearGeocodeUi(modal);
        selectLocation(lat, lng);
    });

    modal.querySelector('#energy-zone-address-form')?.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const input = modal.querySelector('#energy-zone-address');
        const btn = modal.querySelector('#energy-zone-address-btn');
        const q = input?.value?.trim() ?? '';
        const errEl = modal.querySelector('#energy-zone-geocode-error');
        const resultsEl = modal.querySelector('#energy-zone-geocode-results');

        if (!q) {
            if (errEl) {
                errEl.textContent = 'Enter a street address, city, or place name.';
                errEl.hidden = false;
            }
            if (resultsEl) resultsEl.hidden = true;
            return;
        }

        if (btn) btn.disabled = true;
        clearGeocodeUi(modal);

        try {
            const hits = await searchAddress(q);
            if (hits.length === 0) {
                if (errEl) {
                    errEl.textContent = 'No matching locations found. Try adding a country or postal code.';
                    errEl.hidden = false;
                }
            } else if (hits.length === 1) {
                applyGeocodeHit(hits[0]);
            } else if (resultsEl) {
                resultsEl.hidden = false;
                resultsEl.innerHTML = `
                    <ul>${hits.map((hit, idx) => `
                        <li><button type="button" data-geocode-idx="${idx}">${hit.label}</button></li>
                    `).join('')}</ul>
                `;
                resultsEl.querySelectorAll('[data-geocode-idx]').forEach((btnEl) => {
                    btnEl.addEventListener('click', () => {
                        const idx = Number(btnEl.dataset.geocodeIdx);
                        if (Number.isFinite(idx) && hits[idx]) applyGeocodeHit(hits[idx]);
                    });
                });
            }
        } catch (err) {
            if (errEl) {
                errEl.textContent = err instanceof Error ? err.message : 'Address lookup failed.';
                errEl.hidden = false;
            }
        } finally {
            if (btn) btn.disabled = false;
        }
    });
}

function applyGeocodeHit(hit) {
    const modal = document.getElementById('energy-zone-modal');
    if (!modal) return;
    modal.querySelector('#energy-zone-lat').value = hit.lat.toFixed(5);
    modal.querySelector('#energy-zone-lng').value = hit.lng.toFixed(5);
    clearGeocodeUi(modal);
    selectLocation(hit.lat, hit.lng);
}

function getCurrentSite() {
    if (typeof globalThis.getSimulatorSiteLocation === 'function') {
        return globalThis.getSimulatorSiteLocation();
    }
    const latInput = document.getElementById('simLatitudeInput');
    return {
        lat: latInput ? parseFloat(latInput.value) : 40,
        lng: null,
        ghi: null,
        zoneId: null,
    };
}

function sisterCityBlurb(lat) {
    if (lat > 0) {
        return 'A Southern Hemisphere reference city with the closest catalog GHI to your point—useful for contrasting seasons and sun paths with the north.';
    }
    if (lat < 0) {
        return 'A Northern Hemisphere reference city with the closest catalog GHI to your point—useful for contrasting seasons and sun paths with the south.';
    }
    return 'A city south of the equator with the closest catalog GHI (you are near the equator).';
}

function renderCityCard(city, badgeLabel) {
    const zone = getZone(city.ghi);
    return `
        <div class="ez-city-card${city.isClosestMatch ? ' match' : ''}">
            <div class="ez-city-swatch" style="background:${zone.color}"></div>
            <div class="ez-city-body">
                <div class="ez-city-name-row">
                    <span class="ez-city-name">${city.name}</span>
                    ${city.isClosestMatch ? `<span class="ez-city-badge">${badgeLabel}</span>` : ''}
                </div>
                <div class="ez-city-country">${city.country}</div>
                <div class="ez-city-ghi">${city.ghi.toFixed(1)} kWh/m²/d · ${zone.label}</div>
            </div>
        </div>
    `;
}

function renderPopulationBlock(zoneId, container) {
    if (!container || !zonePopulation?.worldTotal) {
        if (container) container.innerHTML = '';
        return;
    }

    const count = zonePopulation.byZone[String(zoneId)] ?? 0;
    const pct = Math.round((100 * count) / zonePopulation.worldTotal);
    const statsEl = container.querySelector('.ez-pop-stats');
    const chartHost = container.querySelector('.ez-pop-chart-host');

    if (statsEl) {
        statsEl.innerHTML = `About <strong>${new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(count)}</strong> people worldwide are estimated to live in this same energy zone—roughly <strong class="ez-pop-pct active">${pct}%</strong> of humanity (${zonePopulation.year} model).`;
    }

    if (chartHost) {
        renderZonePopulationChart(chartHost, {
            byZone: zonePopulation.byZone,
            worldTotal: zonePopulation.worldTotal,
            activeZoneId: zoneId,
            year: zonePopulation.year,
        });
    }
}

function renderCitiesPanel(modal, { lat, ghi, zoneId, fromLegendOnly }) {
    const panel = modal.querySelector('#energy-zone-cities');
    if (!panel) return;

    if (fromLegendOnly) {
        const cities = findCitiesInZone(zoneId, 5);
        panel.innerHTML = cities.length ? `
            <div class="ez-cities-section">
                <div class="ez-cities-section-title">Cities in this zone</div>
                <p class="ez-cities-section-desc">Sample cities from the reference list whose GHI falls in this zone only.</p>
                <div class="ez-cities-grid">${cities.map((c) => renderCityCard(c, 'Typical for band')).join('')}</div>
            </div>
        ` : '';
        return;
    }

    const sisterCity = lat != null ? findSisterCity(lat, ghi) : null;
    const similarCities = findSimilarCities(ghi, 5, sisterCity);

    let html = '';
    if (sisterCity) {
        const sZone = getZone(sisterCity.ghi);
        html += `
            <div class="ez-sister-card">
                <div class="ez-sister-title">Sister city</div>
                <p class="ez-sister-desc">${sisterCityBlurb(lat)}</p>
                <div>
                    <span class="ez-sister-name">${sisterCity.name}</span>
                    <span class="ez-sister-country">${sisterCity.country}</span>
                </div>
                <div class="ez-sister-ghi">${sisterCity.ghi.toFixed(1)} kWh/m²/d · ${sZone.label}</div>
            </div>
        `;
    }

    if (similarCities.length) {
        html += `
            <div class="ez-cities-section">
                <div class="ez-cities-section-title">Similar energy budgets</div>
                <p class="ez-cities-section-desc">Reference cities with annual GHI closest to your location. The highlighted card is the closest match${sisterCity ? '; the sister city above is the closest match in the opposite hemisphere' : ''}.</p>
                <div class="ez-cities-grid">${similarCities.map((c) => renderCityCard(c, 'Best match')).join('')}</div>
            </div>
        `;
    }

    panel.innerHTML = html;
}

function renderResults(modal, selection, { fromLegendOnly = false } = {}) {
    const panel = modal.querySelector('#energy-zone-results');
    if (!panel || !selection) return;

    const zone = ZONES.find((z) => z.id === selection.zoneId) || getZone(selection.ghi ?? 0);
    const ghi = selection.ghi;
    const potential = ghi == null
        ? null
        : ghi >= 6 ? 'EXCELLENT'
            : ghi >= 5 ? 'STRONG'
                : ghi >= 4 ? 'GOOD'
                    : ghi >= 3 ? 'MODERATE'
                        : ghi >= 2 ? 'LOW' : 'MINIMAL';

    panel.innerHTML = `
        <div class="ez-result-card">
            <div class="ez-result-zone-badge" style="--zone-color:${zone.color}">
                <span class="ez-result-zone-num">${zone.id}</span>
                <span class="ez-result-zone-name">${zone.label}</span>
            </div>
            <dl class="ez-result-stats">
                ${!fromLegendOnly && selection.lat != null ? `
                    <div><dt>Location</dt><dd>${formatLatLng(selection.lat, selection.lng)}</dd></div>
                    <div><dt>Latitude</dt><dd>${selection.lat.toFixed(2)}°</dd></div>
                ` : ''}
                <div><dt>GHI (annual avg)</dt><dd>${ghi != null ? `${ghi.toFixed(2)} kWh/m²/day` : 'Zone only (pick map point)'}</dd></div>
                <div><dt>Zone range</dt><dd>${zoneGhiRangeLabel(zone)} kWh/m²/day</dd></div>
                ${potential ? `<div><dt>Solar potential</dt><dd class="ez-potential ez-potential-${potential.toLowerCase()}">${potential}</dd></div>` : ''}
                ${ghi != null ? `<div><dt>Sim scale</dt><dd>${(ghi / REFERENCE_GHI_KWH * 100).toFixed(0)}% of reference site</dd></div>` : ''}
            </dl>
            <p class="ez-result-narrative">${fromLegendOnly
                ? getZoneNarrative(zone.id)
                : `You are in ${zone.label}, where typical annual sunshine on a horizontal surface falls in the ${zoneGhiRangeLabel(zone)} kWh/m²/day band. ${getZoneNarrative(zone.id)}`}
            </p>
            <div class="ez-pop-section">
                <p class="ez-pop-stats"></p>
                <div class="ez-pop-chart-host"></div>
            </div>
        </div>
    `;

    renderPopulationBlock(zone.id, panel);
    renderCitiesPanel(modal, {
        lat: selection.lat,
        ghi: ghi ?? 0,
        zoneId: zone.id,
        fromLegendOnly,
    });
}

function selectLocation(lat, lng) {
    const modal = document.getElementById('energy-zone-modal');
    if (!modal) return;

    const ghi = ghiKwhPerM2Day(lat, lng, ghiGrid);
    const zone = getZone(ghi);
    pendingSelection = { lat, lng, ghi, zoneId: zone.id, zoneLabel: zone.label, zoneColor: zone.color };

    modal.querySelector('#energy-zone-lat').value = lat.toFixed(4);
    modal.querySelector('#energy-zone-lng').value = lng.toFixed(4);
    mapInstance?.setSelectedLocation(lat, lng);
    mapInstance?.setSelectedZoneId(zone.id);
    renderResults(modal, pendingSelection);
    modal.querySelector('#energy-zone-apply').disabled = false;
}

function selectZoneLegend(zoneId) {
    const modal = document.getElementById('energy-zone-modal');
    if (!modal) return;

    const zone = ZONES.find((z) => z.id === zoneId);
    if (!zone) return;

    pendingSelection = null;
    modal.querySelector('#energy-zone-apply').disabled = true;
    modal.querySelector('#energy-zone-lat').value = '';
    modal.querySelector('#energy-zone-lng').value = '';
    modal.querySelector('#energy-zone-address').value = '';
    clearGeocodeUi(modal);
    mapInstance?.setSelectedLocation(null, null);
    mapInstance?.setSelectedZoneId(zoneId);

    renderResults(modal, { lat: null, lng: null, ghi: null, zoneId: zone.id, zoneLabel: zone.label, zoneColor: zone.color }, { fromLegendOnly: true });
    modal.querySelector('#energy-zone-results .ez-result-card')?.insertAdjacentHTML('beforeend', `
        <p class="ez-result-hint">Click the map, look up an address, or enter coordinates to set your project site.</p>
    `);
}

function applySelection(selection) {
    if (typeof globalThis.applySimulatorSiteLocation === 'function') {
        globalThis.applySimulatorSiteLocation(selection);
        showToast(`Site set: ${formatLatLng(selection.lat, selection.lng)} · ${selection.zoneLabel}`, 'success');
        return;
    }
    const latInput = document.getElementById('simLatitudeInput');
    if (latInput) {
        latInput.value = String(Math.round(selection.lat * 10) / 10);
        latInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    showToast(`Latitude set to ${selection.lat.toFixed(1)}° (${selection.zoneLabel})`, 'success');
}

function updateTopbarSiteBadge(selection) {
    const badge = document.getElementById('sim-site-zone-badge');
    if (!badge) return;
    if (!selection?.zoneId) {
        badge.hidden = true;
        badge.textContent = '';
        return;
    }
    badge.hidden = false;
    badge.textContent = `Zone ${selection.zoneId}`;
    badge.style.borderColor = selection.zoneColor || 'var(--clr-primary)';
}

export async function openEnergyZonePicker() {
    try {
        await mountModal();
        if (!ghiGrid) ghiGrid = await loadGhiGrid();
        if (!zonePopulation) zonePopulation = await loadZonePopulation();

        const modal = document.getElementById('energy-zone-modal');
        modal.classList.add('visible');
        document.body.style.overflow = 'hidden';

        const mapHost = modal.querySelector('#energy-zone-map-host');
        mapHost.innerHTML = '';

        mapInstance?.dispose();
        mapInstance = new EnergyZoneWorldMap(mapHost, {
            ghiGrid,
            onLocationSelect: (lat, lng) => selectLocation(lat, lng),
            onZoneLegendSelect: (zoneId) => selectZoneLegend(zoneId),
        });
        await mapInstance.init();
        mapInstance.setGhiGrid(ghiGrid);

        const current = getCurrentSite();
        pendingSelection = null;
        modal.querySelector('#energy-zone-apply').disabled = true;
        modal.querySelector('#energy-zone-lat').value = Number.isFinite(current.lat) ? current.lat.toFixed(4) : '';
        modal.querySelector('#energy-zone-lng').value = Number.isFinite(current.lng) ? current.lng.toFixed(4) : '';
        modal.querySelector('#energy-zone-address').value = '';
        clearGeocodeUi(modal);
        modal.querySelector('#energy-zone-cities').innerHTML = '';

        if (Number.isFinite(current.lat) && Number.isFinite(current.lng)) {
            selectLocation(current.lat, current.lng);
        } else if (Number.isFinite(current.lat)) {
            selectLocation(current.lat, current.lng ?? 0);
        } else {
            modal.querySelector('#energy-zone-results').innerHTML = `
                <div class="ez-result-card ez-result-card-muted">
                    <p class="ez-result-hint">Click anywhere on the map, look up an address, or enter coordinates to pick your project site. The energy zone and latitude will be applied to solar simulation.</p>
                </div>
            `;
        }

        const sourceLabel = modal.querySelector('#energy-zone-ghi-source');
        if (sourceLabel) {
            sourceLabel.textContent = ghiGrid
                ? 'NASA POWER GHI (2001–2020)'
                : 'GHI fallback model';
        }
    } catch (err) {
        console.error('[energy-zone-picker]', err);
        showToast(`Could not open energy zone picker: ${err.message}`, 'error');
    }
}

export function closeEnergyZonePicker() {
    const modal = document.getElementById('energy-zone-modal');
    if (!modal) return;
    modal.classList.remove('visible');
    document.body.style.overflow = '';
    mapInstance?.dispose();
    mapInstance = null;
}

export function bindEnergyZonePickerButton(root = document) {
    root.querySelectorAll('[data-energy-zone-picker]').forEach((btn) => {
        if (btn.dataset.ezBound === 'true') return;
        btn.dataset.ezBound = 'true';
        btn.addEventListener('click', () => openEnergyZonePicker());
    });
}

export function refreshEnergyZoneTopbarBadge(site) {
    updateTopbarSiteBadge(site);
}

globalThis.openEnergyZonePicker = openEnergyZonePicker;
globalThis.closeEnergyZonePicker = closeEnergyZonePicker;
globalThis.refreshEnergyZoneTopbarBadge = refreshEnergyZoneTopbarBadge;

export default {
    openEnergyZonePicker,
    closeEnergyZonePicker,
    bindEnergyZonePickerButton,
    refreshEnergyZoneTopbarBadge,
};
