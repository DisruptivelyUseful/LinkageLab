import { ZONES } from './constants.js';

const CHART_H = 200;
const Y_TICKS = 5;

function axisTicks(yMax) {
    const ticks = [];
    for (let i = 0; i < Y_TICKS; i++) {
        ticks.push(Math.round(yMax * (1 - i / (Y_TICKS - 1))));
    }
    return ticks;
}

/**
 * Render population-by-zone bar chart into container.
 * @param {HTMLElement} container
 * @param {{ byZone: Record<string, number>, worldTotal: number, activeZoneId: number, year: number }} data
 */
export function renderZonePopulationChart(container, data) {
    const { byZone, worldTotal, activeZoneId, year } = data;
    if (!container || worldTotal <= 0) {
        if (container) container.innerHTML = '';
        return;
    }

    const pcts = ZONES.map((z) => (100 * (byZone[String(z.id)] ?? 0)) / worldTotal);
    const maxPct = Math.max(...pcts, 0.5);
    const yMax = Math.max(15, Math.ceil((maxPct * 1.12) / 5) * 5);
    const ticksDesc = axisTicks(yMax);

    let sumZX = 0;
    for (const z of ZONES) {
        sumZX += z.id * (byZone[String(z.id)] ?? 0);
    }
    const meanZoneIndex = worldTotal > 0 ? sumZX / worldTotal : 3.5;
    const meanZoneX = ((meanZoneIndex - 1) / 5) * 100;

    const pctLabels = ZONES.map((z, i) => {
        const pct = pcts[i] ?? 0;
        const isActive = z.id === activeZoneId;
        return `<div class="ez-pop-pct-cell"><span class="ez-pop-pct${isActive ? ' active' : ''}">${Math.round(pct)}%</span></div>`;
    }).join('');

    const gridLines = ticksDesc.map(() => '<div class="ez-pop-grid-line"></div>').join('');

    const bars = ZONES.map((z, i) => {
        const pct = pcts[i] ?? 0;
        const hPct = yMax > 0 ? Math.min(100, (pct / yMax) * 100) : 0;
        const isActive = z.id === activeZoneId;
        return `
            <div class="ez-pop-bar-cell">
                <div class="ez-pop-bar${isActive ? ' active' : ''}" style="height:${hPct}%;min-height:${pct > 0 ? 3 : 0}px;background-color:${z.color}"></div>
            </div>
        `;
    }).join('');

    const xLabels = ZONES.map((z) => {
        const isActive = z.id === activeZoneId;
        return `
            <div class="ez-pop-x-cell${isActive ? ' active' : ''}">
                <span class="ez-pop-x-label">Zone</span>
                <span class="ez-pop-x-num" style="${isActive ? '' : `color:${z.color}`}">${z.id}</span>
            </div>
        `;
    }).join('');

    const yAxis = ticksDesc.map((t) => `<span>${t}%</span>`).join('');

    container.innerHTML = `
        <div class="ez-pop-chart-wrap">
            <div class="ez-pop-chart-title">How population splits across zones (${year})</div>
            <div class="ez-pop-chart">
                <div class="ez-pop-y-axis" style="height:${CHART_H}px">${yAxis}</div>
                <div class="ez-pop-plot">
                    <div class="ez-pop-pct-row">${pctLabels}</div>
                    <div class="ez-pop-bars-area" style="height:${CHART_H - 32}px">
                        <div class="ez-pop-grid">${gridLines}</div>
                        <div class="ez-pop-mean" style="left:${Math.min(100, Math.max(0, meanZoneX))}%">
                            <span>μ</span>
                            <div class="ez-pop-mean-line"></div>
                        </div>
                        <div class="ez-pop-bars">${bars}</div>
                    </div>
                    <div class="ez-pop-x-row">${xLabels}</div>
                </div>
            </div>
            <div class="ez-pop-footnote">
                <span>μ ≈ ${meanZoneIndex.toFixed(2)} (mean zone index)</span>
                <span>Vertical axis: % of world population</span>
            </div>
            <p class="ez-pop-caption">Column height shows each zone's share of estimated world population. μ marks where humanity centers on the 1–6 zone scale. Your zone is outlined.</p>
        </div>
    `;
}

let populationPromise = null;

export function loadZonePopulation() {
    if (!populationPromise) {
        populationPromise = fetch('data/zone-population.json', { cache: 'force-cache' })
            .then((res) => (res.ok ? res.json() : null))
            .catch(() => null);
    }
    return populationPromise;
}
