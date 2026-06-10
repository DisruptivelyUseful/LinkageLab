#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js/core/constants.js'), 'utf8');
const m = src.match(/const PANEL_PRESETS = \[([\s\S]*?)\];/);
if (!m) throw new Error('PANEL_PRESETS not found in constants.js');

const presets = eval('[' + m[1] + ']');
const dir = path.join(root, 'solar-panels');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

function slug(s) {
    return String(s || 'panel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'panel';
}

const registry = [];
presets.forEach(p => {
    const id = slug(p.name);
    const file = id + '.json';
    const data = {
        id,
        name: p.name,
        label: p.name,
        wmp: p.wmp,
        vmp: p.vmp,
        voc: p.voc,
        isc: p.isc,
        imp: p.imp,
        widthMm: p.width,
        heightMm: p.height,
        panelLengthIn: +(p.width / 25.4).toFixed(3),
        panelWidthIn: +(p.height / 25.4).toFixed(3),
        panelThicknessIn: 1.5,
        formFactor: 'framed',
        cost: p.cost || 0,
        weight: Math.round((p.wmp || 250) * 0.18),
        link: p.link || ''
    };
    fs.writeFileSync(path.join(dir, file), JSON.stringify(data, null, 2));
    registry.push({ id, name: p.name, file, link: data.link });
});

fs.writeFileSync(path.join(dir, 'registry.json'), JSON.stringify(registry, null, 2));
console.log('Generated', registry.length, 'solar panel presets in solar-panels/');
