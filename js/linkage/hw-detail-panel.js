// ============================================================================
// LINKAGE LAB - Part view editor panel (ES module)
//
// The right-hand panel of the hardware part view: one section per stack axis
// (Auto/Manual badge, fit summary, "Tighten axis") and one card per part
// (dimensions, preset, gap or hand-placed position, cross offset, head side,
// qty/cost). Cards commit through hwNoteEdit so every edit is one undo step.
// ============================================================================

import { bridgeGlobals } from './global-bridge.js';
import { classifyPart, HW_KIND } from './hw-stack-layout.js';
import { bindNumericInput } from './numeric-input.js';
import { hwTightenAxis, hwRefreshFocusInstance } from './hw-detail-interaction.js';
import {
    HW_HBEAM_GAP_WASHER_SHARED_KEY,
    HW_TYPE_LABELS,
    buildHardwareAssemblyScene,
    getActiveHardwareAssembly,
    hwAppendPresetRow,
    hwApplyPartGap,
    hwAxisPositions,
    hwComputeAxisLayout,
    hwDetail,
    hwDuplicatePart,
    hwGetAssemblyMirrorPairs,
    hwIsAxisManual,
    hwIsMirrorClonePart,
    hwIsSandwichBeamPart,
    hwPersistHardwareConfig,
    hwRebuildDetailView,
    hwRefreshAll,
    hwRemovePart,
    hwRenumberAxis,
    hwSetPartPosition,
    hwSyncMirrorClonesFromPart,
    hwSyncSharedPartFrom,
} from './hardware-detail.js';

function hwBindNumberScrub(input, onChange) {
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation());
    let scrub = null;
    input.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        scrub = { x: e.clientX, val: parseFloat(input.value) || 0, step: parseFloat(input.step) || 0.01, changed: false };
        input.setPointerCapture(e.pointerId);
    });
    input.addEventListener('pointermove', (e) => {
        if (!scrub || !input.hasPointerCapture(e.pointerId)) return;
        const steps = Math.round((e.clientX - scrub.x) / 3);
        if (steps === 0) return;
        e.preventDefault();
        scrub.val += steps * scrub.step;
        scrub.x = e.clientX;
        const decimals = input.dataset.decimals != null
            ? parseInt(input.dataset.decimals, 10)
            : ((input.step && String(input.step).includes('.')) ? String(input.step).split('.')[1].length : 2);
        input.value = scrub.val.toFixed(decimals);
        scrub.changed = true;
        onChange(parseFloat(input.value) || 0);
    });
    input.addEventListener('pointerup', (e) => {
        if (input.hasPointerCapture(e.pointerId)) input.releasePointerCapture(e.pointerId);
        if (scrub && scrub.changed) hwNoteEdit();
        scrub = null;
    });
}

const HW_PARAM_FIELDS = {
    bolt: [
        { key: 'diameter', label: 'Dia (in)' },
        { key: 'length', label: 'Length (in)' },
        { key: 'threadLength', label: 'Thread (in)' },
        { key: 'headDia', label: 'Head Dia (in)' },
        { key: 'headHeight', label: 'Head H (in)' }
    ],
    bushing: [
        { key: 'id', label: 'ID (in)' },
        { key: 'od', label: 'OD (in)' },
        { key: 'length', label: 'Length (in)' },
        { key: 'flangeOd', label: 'Flange OD (in)' },
        { key: 'flangeThickness', label: 'Flange T (in)' }
    ],
    washer: [
        { key: 'id', label: 'ID (in)' },
        { key: 'od', label: 'OD (in)' },
        { key: 'thickness', label: 'Thick (in)' }
    ],
    lockWasher: [
        { key: 'id', label: 'ID (in)' },
        { key: 'od', label: 'OD (in)' },
        { key: 'thickness', label: 'Thick (in)' }
    ],
    nut: [
        { key: 'id', label: 'ID (in)' },
        { key: 'od', label: 'OD (in)' },
        { key: 'length', label: 'Length (in)' },
        { key: 'flangeOd', label: 'Flange OD (in)' },
        { key: 'flangeThickness', label: 'Flange T (in)' }
    ],
    bracket: [
        { key: 'height', label: 'Height (in)' },
        { key: 'sideHoleFromTop', label: 'Side Hole (in)' },
        { key: 'cutoffHeight', label: 'Cutoff Top (in)' },
        { key: 'glbScaleMul', label: 'Scale x' },
        { key: 'glbRotX', label: 'Rot X (deg)' },
        { key: 'glbRotY', label: 'Rot Y (deg)' },
        { key: 'glbRotZ', label: 'Rot Z (deg)' },
        { key: 'posX', label: 'Pos X (in)' },
        { key: 'posY', label: 'Pos Y (in)' },
        { key: 'posZ', label: 'Pos Z (in)' }
    ],
    beam: [
        { key: 'width', label: 'Width (in)' },
        { key: 'thickness', label: 'Thick (in)' },
        { key: 'length', label: 'Length (in)' },
        { key: 'holeOffset', label: 'Hole Ext (in)' },
        { key: 'holeDiameter', label: 'Hole Dia (in)' },
        { key: 'rotDeg', label: 'Rot (deg)', step: 1, decimals: 2 }
    ]
};

function renderHardwareEditPanel() {
    const panel = document.getElementById('hw-detail-parts');
    if (!panel) return;
    const assembly = getActiveHardwareAssembly();
    panel.innerHTML = '';
    if (!assembly) return;

    // Group by axis for display
    const byAxis = {};
    assembly.parts.forEach((part, idx) => {
        const ax = part.axis || 'right';
        (byAxis[ax] = byAxis[ax] || []).push({ part, idx });
    });

    // List stacks top-to-bottom around the center slot so the panel mirrors the
    // physical layout: UP parts above the center washer, DOWN parts below it.
    const plane = assembly.sandwichPlane || (assembly.id === 'vCenter' ? 'horizontal' : 'vertical');
    const axisOrder = plane === 'horizontal'
        ? ['left', 'center', 'right', 'up', 'down', 'front', 'back']
        : ['up', 'center', 'down', 'right', 'left', 'front', 'back'];
    const axisLabels = {
        center: 'Center (between beams · sets stack gap)',
        right: 'Right (+ from center)',
        left: 'Left (− from center)',
        up: 'Up (above center)',
        down: 'Down (below center)',
        front: 'Front Axis',
        back: 'Back Axis',
    };
    hwGetAssemblyMirrorPairs(assembly).forEach(pair => {
        if (pair.from === 'right' && pair.to === 'left') axisLabels.right = 'Right (+ from center, mirrored to Left)';
        if (pair.from === 'up' && pair.to === 'down') axisLabels.up = 'Up (above center, mirrored to Down)';
    });

    // Fit check per axis (feeds the section summary and the per-part badges)
    hwDetail.fitByPart = new Map();
    const axisLayouts = {};
    Object.keys(byAxis).forEach(axisKey => {
        const layout = hwComputeAxisLayout(assembly, axisKey);
        axisLayouts[axisKey] = layout;
        (layout.fit || []).forEach(f => {
            if (!hwDetail.fitByPart.has(f.partId)) hwDetail.fitByPart.set(f.partId, []);
            hwDetail.fitByPart.get(f.partId).push(f);
        });
    });

    axisOrder.forEach(axisKey => {
        if (!byAxis[axisKey]) return;
        const section = document.createElement('div');
        section.className = 'hw-axis-section';
        const title = document.createElement('div');
        title.className = 'hw-axis-title';
        const titleText = document.createElement('span');
        titleText.textContent = axisLabels[axisKey] || axisKey;
        title.appendChild(titleText);
        const manual = hwIsAxisManual(assembly, axisKey);
        const mode = document.createElement('span');
        mode.className = 'hw-axis-mode' + (manual ? ' hw-axis-mode-manual' : '');
        mode.textContent = manual ? 'Manual' : 'Auto';
        mode.title = manual
            ? 'Parts on this axis are placed by hand (drag, arrow keys or Position). Tighten returns them to the flush layout.'
            : 'Parts sit flush automatically. Dragging a part switches this axis to manual placement.';
        title.appendChild(mode);
        if (manual) {
            const tb = document.createElement('button');
            tb.type = 'button';
            tb.className = 'hw-mini-btn hw-axis-tighten';
            tb.textContent = 'Tighten axis';
            tb.title = 'Return this axis to the flush automatic layout';
            tb.onclick = (e) => { e.stopPropagation(); hwTightenAxis(axisKey); };
            title.appendChild(tb);
        }
        section.appendChild(title);
        const summary = hwAxisFitSummary(axisLayouts[axisKey]);
        if (summary) {
            const sum = document.createElement('div');
            sum.className = 'hw-axis-summary' + (summary.warn ? ' hw-axis-summary-warn' : '');
            sum.textContent = summary.text;
            section.appendChild(sum);
        }

        // Manual axes list parts in the order they sit; auto axes in stack (seq) order
        const posOrder = manual ? hwAxisPositions(assembly, axisKey) : null;
        const orderKey = (p) => (posOrder && posOrder.has(p.id) ? posOrder.get(p.id) : (p.seq || 0));
        byAxis[axisKey].sort((a, b) => orderKey(a.part) - orderKey(b.part)).forEach(({ part }) => {
            section.appendChild(buildHardwarePartCard(part));
        });
        panel.appendChild(section);
    });
}

/** One-line stack summary for an axis: grip, bolt reach, warnings. */
function hwAxisFitSummary(layout) {
    if (!layout || !layout.stack) return null;
    const st = layout.stack;
    const parts = [];
    const solid = st.items.filter(it => it.kind !== HW_KIND.BOLT);
    if (!solid.length && !st.bolt) return null;
    if (solid.length) parts.push(`stack ${st.span.toFixed(2)} in`);
    if (st.bolt) {
        const grip = (st.membersEnd - st.origin) + (st.datumWall || 0);
        parts.push(`grip ${grip.toFixed(2)} in`);
        parts.push(`bolt ${st.bolt.shankL.toFixed(2)} in ${st.bolt.headOutside ? 'head outside' : 'head inside'}`);
    }
    const warns = (st.fit || []).filter(f => f.level === 'warn');
    if (warns.length) parts.push(`${warns.length} fit warning${warns.length > 1 ? 's' : ''}`);
    return { text: parts.join(' · '), warn: warns.length > 0 };
}

function hwBindNumberInput(inp, onChange) {
    // Commit on blur / Enter / step (never mid-typing); scrub-drag applies live.
    // Every commit (and the end of a scrub) is one undo step.
    bindNumericInput(inp, { commit: (v) => { onChange(v); hwNoteEdit(); } });
    hwBindNumberScrub(inp, onChange);
}

/** A panel edit finished: persist and record an undo step (history is debounced). */
function hwNoteEdit() {
    hwPersistHardwareConfig();
    if (typeof saveStateToHistory === 'function') saveStateToHistory();
}

function buildHardwarePartCard(part) {
    const card = document.createElement('div');
    card.className = 'hw-part-card' + (part.id === hwDetail.selectedPartId ? ' selected' : '');
    card.onclick = (e) => {
        if (e.target.closest('input, select, button, label, .hw-part-grip, a')) return;
        hwDetail.selectedPartId = (hwDetail.selectedPartId === part.id) ? null : part.id;
        renderHardwareEditPanel();
        hwRefreshFocusInstance();
    };

    // Drag-and-drop reordering via grip handle (brackets are fixed at center).
    const isBracket = part.type === 'bracket';
    const isMirrorClone = hwIsMirrorClonePart(part);
    if (!isBracket && !isMirrorClone) {
        card.addEventListener('dragover', (e) => {
            if (!hwDrag.id || hwDrag.id === part.id) return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            const rect = card.getBoundingClientRect();
            const after = (e.clientY - rect.top) > rect.height / 2;
            card.classList.toggle('hw-drop-after', after);
            card.classList.toggle('hw-drop-before', !after);
        });
        card.addEventListener('dragleave', () => card.classList.remove('hw-drop-before', 'hw-drop-after'));
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            const rect = card.getBoundingClientRect();
            const after = (e.clientY - rect.top) > rect.height / 2;
            const draggedId = hwDrag.id;
            card.classList.remove('hw-drop-before', 'hw-drop-after');
            hwHandleDrop(draggedId, part.id, after);
        });
    }

    const head = document.createElement('div');
    head.className = 'hw-part-head';
    if (!isBracket && !isMirrorClone) {
        const grip = document.createElement('span');
        grip.className = 'hw-part-grip';
        grip.textContent = '⠿';
        grip.title = 'Drag to reorder';
        grip.draggable = true;
        grip.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            hwDrag.id = part.id;
            if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', part.id); } catch (err) {} }
            card.classList.add('hw-dragging');
        });
        grip.addEventListener('dragend', () => {
            hwDrag.id = null;
            document.querySelectorAll('.hw-drop-before, .hw-drop-after').forEach(el => el.classList.remove('hw-drop-before', 'hw-drop-after'));
            card.classList.remove('hw-dragging');
        });
        head.appendChild(grip);
    }
    const typeSpan = document.createElement('span');
    typeSpan.className = 'hw-part-type';
    typeSpan.textContent = (part.type === 'nut' && part.params && part.params.style === 'rivet')
        ? 'Rivet Nut'
        : (HW_TYPE_LABELS[part.type] || part.type);
    head.appendChild(typeSpan);
    if (part.sharedKey === HW_HBEAM_GAP_WASHER_SHARED_KEY) {
        const sharedTag = document.createElement('span');
        sharedTag.className = 'hw-part-shared-tag';
        sharedTag.title = 'Synced across Outer V, Inner V, and H-Center assemblies';
        sharedTag.textContent = 'shared';
        head.appendChild(sharedTag);
    }
    if (hwIsMirrorClonePart(part)) {
        const mirrorTag = document.createElement('span');
        mirrorTag.className = 'hw-part-mirror-tag';
        mirrorTag.title = 'Mirrored copy — edits track the source part on the opposite stack';
        mirrorTag.textContent = 'mirrored';
        head.appendChild(mirrorTag);
    }
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'hw-part-label';
    labelInput.value = part.label || '';
    labelInput.oninput = () => { part.label = labelInput.value; };
    labelInput.onchange = () => { hwSyncMirrorClonesFromPart(part); hwNoteEdit(); };
    head.appendChild(labelInput);
    if (!isBracket) {
        const dup = document.createElement('button');
        dup.className = 'hw-mini-btn hw-dup';
        dup.textContent = '⧉';
        dup.title = 'Duplicate part (same BOM item, independent placement)';
        dup.onclick = (e) => { e.stopPropagation(); hwDuplicatePart(part.id); };
        head.appendChild(dup);
    }
    const del = document.createElement('button');
    del.className = 'hw-mini-btn hw-del';
    del.textContent = '✕';
    del.title = 'Remove part';
    del.onclick = () => { hwRemovePart(part.id); };
    head.appendChild(del);
    card.appendChild(head);

    hwAppendPresetRow(card, part);

    // Param grid
    const grid = document.createElement('div');
    grid.className = 'hw-param-grid';
    let paramFields = HW_PARAM_FIELDS[part.type] || [];
    if (part.type === 'nut' && part.params.style !== 'rivet') {
        paramFields = [
            { key: 'id', label: 'ID (in)' },
            { key: 'widthAcrossFlats', label: 'Width A/F (in)' },
            { key: 'height', label: 'Height (in)' }
        ];
    }
    paramFields.forEach(f => {
        const cell = document.createElement('label');
        cell.className = 'hw-param';
        cell.innerHTML = `<span>${f.label}</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = String(f.step != null ? f.step : 0.01);
        const rawVal = part.params[f.key] != null ? part.params[f.key] : 0;
        const decimals = f.decimals != null ? f.decimals : null;
        if (decimals != null) inp.dataset.decimals = String(decimals);
        inp.value = decimals != null ? Number(rawVal).toFixed(decimals) : rawVal;
        hwBindNumberInput(inp, (val) => {
            part.params[f.key] = val;
            if (part.type === 'beam') part.params.syncStructure = false;
            if (decimals != null) inp.value = Number(val).toFixed(decimals);
            hwSyncSharedPartFrom(part);
            hwSyncMirrorClonesFromPart(part);
            buildHardwareAssemblyScene();
            if (part.sharedKey) {
                if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
                hwPersistHardwareConfig();
            }
        });
        cell.appendChild(inp);
        grid.appendChild(cell);
    });
    card.appendChild(grid);

    if (part.type === 'beam') {
        const isHBeam = part.params.syncStructure === 'hBeam' || /hbeam/i.test(part.id);
        const alignRow = document.createElement('label');
        alignRow.className = 'hw-param';
        alignRow.style.gridColumn = '1 / -1';
        alignRow.innerHTML = '<span>Bolt axis hole</span>';
        const alignSel = document.createElement('select');
        alignSel.innerHTML = [
            ['near', 'Near end (End Offset)'],
            ['center', 'Center'],
            ['far', 'Far end']
        ].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
        alignSel.value = part.params.holeAlign || 'near';
        alignSel.onchange = () => {
            part.params.holeAlign = alignSel.value;
            buildHardwareAssemblyScene();
            hwNoteEdit();
        };
        alignRow.appendChild(alignSel);
        card.appendChild(alignRow);

        const syncRow = document.createElement('label');
        syncRow.className = 'hw-param hw-check-row';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isHBeam ? part.params.syncStructure === 'hBeam' : part.params.syncStructure !== false;
        chk.onchange = () => {
            part.params.syncStructure = isHBeam ? (chk.checked ? 'hBeam' : false) : chk.checked;
            hwRefreshAll();
        };
        syncRow.appendChild(chk);
        const lbl = document.createElement('span');
        lbl.className = 'hw-check-label';
        lbl.textContent = isHBeam
            ? 'Sync dims from structure (H-beam W×T, pivot hole)'
            : 'Sync dims from structure (V-beam W×T, length, End Offset holes)';
        syncRow.appendChild(lbl);
        card.appendChild(syncRow);
    }

    // Position along the stack axis (non-bracket parts). Auto axes: flush
    // layout plus an optional gap. Manual axes (after a hand placement): an
    // absolute position from the axis datum. Beams always use the gap/standoff.
    if (!isBracket) {
        const assembly = getActiveHardwareAssembly();
        const axisKey = part.axis || 'right';
        const kind = classifyPart(part);
        const posGrid = document.createElement('div');
        posGrid.className = 'hw-param-grid';
        const isInsert = kind === HW_KIND.INSERT;
        const isSandwichBeam = hwIsSandwichBeamPart(part);
        const manualAxis = hwIsAxisManual(assembly, axisKey) && part.type !== 'beam';
        if (manualAxis) {
            const cell = document.createElement('label');
            cell.className = 'hw-param';
            cell.innerHTML = '<span>Position (in)</span>';
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.step = '0.0625';
            inp.dataset.decimals = '4';
            const cur = hwAxisPositions(assembly, axisKey).get(part.id);
            inp.value = Number.isFinite(cur) ? cur.toFixed(4) : '0';
            inp.title = 'Start of this part measured from the axis datum (bracket wall or pivot). Drag it in the view, use the arrow keys, or type a value. Overlaps are allowed.';
            hwBindNumberInput(inp, (val) => {
                const asm = getActiveHardwareAssembly();
                if (!hwIsAxisManual(asm, axisKey)) { hwSetPartPosition(part, asm, val); return; }
                part.pos = +Number(val).toFixed(4);
                hwSyncMirrorClonesFromPart(part);
                if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
                hwRebuildDetailView();
                hwPersistHardwareConfig();
            });
            inp.addEventListener('change', () => renderHardwareEditPanel());
            cell.appendChild(inp);
            posGrid.appendChild(cell);
        } else if (!isInsert) {
            const gapLabel = isSandwichBeam ? 'Standoff from center (in)' : 'Gap before (in)';
            const gapTitle = isSandwichBeam
                ? 'Extra space between the center stack and this beam; the opposite beam moves with it'
                : (part.type === 'bolt'
                    ? 'Space between the bolt head and the face it seats on (0 = tight). Drag the part to place it freely.'
                    : 'Space before this part along the stack (0 = flush against the previous part). Everything after it moves too. Drag the part to place it freely.');
            const cell = document.createElement('label');
            cell.className = 'hw-param';
            cell.innerHTML = `<span>${gapLabel}</span>`;
            const inp = document.createElement('input');
            inp.type = 'number';
            inp.step = '0.01';
            inp.min = '0';
            inp.value = (part.gapBefore != null ? part.gapBefore : 0);
            inp.title = gapTitle;
            hwBindNumberInput(inp, (val) => {
                const asm = getActiveHardwareAssembly();
                hwApplyPartGap(part, asm, val);
                inp.value = String(part.gapBefore);
                hwSyncMirrorClonesFromPart(part);
                hwRebuildDetailView();
                if (typeof hwUpdateStructureSpacingUI === 'function') hwUpdateStructureSpacingUI();
                if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
                hwPersistHardwareConfig();
            });
            cell.appendChild(inp);
            posGrid.appendChild(cell);
        } else {
            const note = document.createElement('div');
            note.className = 'hw-param hw-param-note';
            note.textContent = (part.type === 'bushing'
                ? 'Sits inside the bore of the part before it, flush with its outer face.'
                : 'Rivet nut: body sits inside the part before it, flange on its face.')
                + ' Drag it (or select it and use the arrow keys) to place it by hand.';
            posGrid.appendChild(note);
        }
        const crossCell = document.createElement('label');
        crossCell.className = 'hw-param';
        crossCell.innerHTML = '<span>Cross offset (in)</span>';
        const crossInp = document.createElement('input');
        crossInp.type = 'number';
        crossInp.step = '0.01';
        crossInp.value = (part.crossOffset != null ? part.crossOffset : 0);
        crossInp.title = 'Offset perpendicular to the stack axis (added to the automatic hole alignment on horizontal axes)';
        hwBindNumberInput(crossInp, (val) => {
            part.crossOffset = val;
            hwSyncMirrorClonesFromPart(part);
            if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
            hwRebuildDetailView();
            hwPersistHardwareConfig();
        });
        crossCell.appendChild(crossInp);
        posGrid.appendChild(crossCell);

        if (part.type === 'bolt') {
            const headCell = document.createElement('label');
            headCell.className = 'hw-param';
            headCell.innerHTML = '<span>Head side</span>';
            const sel = document.createElement('select');
            sel.innerHTML = '<option value="inside">Inside (at datum)</option><option value="outside">Outside (on stack)</option>';
            sel.value = part.flipAxis ? 'outside' : 'inside';
            sel.title = 'Inside: head seats on the datum (bracket wall / center), shank runs out through the parts. Outside: head seats on the outermost part, shank runs back through the stack.';
            sel.addEventListener('mousedown', (e) => e.stopPropagation());
            sel.onchange = () => {
                part.flipAxis = sel.value === 'outside';
                hwSyncMirrorClonesFromPart(part);
                if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
                hwRebuildDetailView();
                renderHardwareEditPanel();
                hwNoteEdit();
            };
            headCell.appendChild(sel);
            posGrid.appendChild(headCell);
        } else if (!isInsert) {
            const flipRow = document.createElement('label');
            flipRow.className = 'hw-param hw-check-row';
            const flipChk = document.createElement('input');
            flipChk.type = 'checkbox';
            flipChk.checked = !!part.flipAxis;
            flipChk.onchange = () => {
                part.flipAxis = flipChk.checked;
                hwSyncMirrorClonesFromPart(part);
                if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
                hwRebuildDetailView();
                hwNoteEdit();
            };
            flipRow.appendChild(flipChk);
            const flipLbl = document.createElement('span');
            flipLbl.className = 'hw-check-label';
            flipLbl.textContent = 'Flip orientation along the stack axis';
            flipRow.appendChild(flipLbl);
            posGrid.appendChild(flipRow);
        }
        card.appendChild(posGrid);

        // Fit findings for this part
        const findings = (hwDetail.fitByPart && hwDetail.fitByPart.get(part.id)) || [];
        if (findings.length) {
            const badges = document.createElement('div');
            badges.className = 'hw-fit-badges';
            findings.forEach(f => {
                const b = document.createElement('span');
                b.className = 'hw-fit-badge hw-fit-' + f.level;
                b.textContent = f.message;
                badges.appendChild(b);
            });
            card.appendChild(badges);
        }
    }

    // Meta row: qty, perModule, cost
    const meta = document.createElement('div');
    meta.className = 'hw-param-grid';
    const mk = (labelTxt, key, step) => {
        const cell = document.createElement('label');
        cell.className = 'hw-param';
        cell.innerHTML = `<span>${labelTxt}</span>`;
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.step = step;
        if (key === 'qty') {
            inp.min = '1';
            inp.step = '1';
        }
        inp.value = (part[key] != null ? part[key] : 0);
        hwBindNumberInput(inp, (val) => {
            const nextVal = key === 'qty'
                ? Math.max(1, Math.round(Number(val) || 1))
                : val;
            part[key] = nextVal;
            if (key === 'qty') {
                inp.value = String(nextVal);
                if (part.sharedKey) hwSyncSharedPartFrom(part);
                hwSyncMirrorClonesFromPart(part);
                if (typeof invalidateGeometryCache === 'function') invalidateGeometryCache();
                hwRebuildDetailView();
                if (typeof hwUpdateStructureSpacingUI === 'function') hwUpdateStructureSpacingUI();
                if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
                hwPersistHardwareConfig();
            } else if (typeof updateHUD === 'function') { try { updateHUD(); } catch (e) {} }
        });
        cell.appendChild(inp);
        return cell;
    };
    meta.appendChild(mk('Qty (stack)', 'qty', '1'));
    meta.appendChild(mk('Per Module', 'perModule', '1'));
    meta.appendChild(mk('Cost $', 'cost', '0.01'));
    card.appendChild(meta);

    return card;
}

// Drag-and-drop reorder state + helpers
const hwDrag = { id: null };

function hwHandleDrop(draggedId, targetId, after) {
    if (!draggedId || draggedId === targetId) return;
    const assembly = getActiveHardwareAssembly();
    if (!assembly) return;
    const dragged = assembly.parts.find(p => p.id === draggedId);
    const target = assembly.parts.find(p => p.id === targetId);
    if (!dragged || !target || dragged.type === 'bracket' || target.type === 'bracket') return;
    const fromAxis = dragged.axis;
    dragged.axis = target.axis;
    dragged.seq = (target.seq || 0) + (after ? 0.5 : -0.5);
    hwRenumberAxis(assembly, dragged.axis);
    if (fromAxis !== dragged.axis) hwRenumberAxis(assembly, fromAxis);
    hwRefreshAll();
}

const _moduleExports = {
    renderHardwareEditPanel,
    buildHardwarePartCard,
    hwBindNumberInput,
    hwBindNumberScrub,
    hwNoteEdit,
    hwHandleDrop,
    hwAxisFitSummary,
};

bridgeGlobals(_moduleExports, 'hwDetailPanel');

export { renderHardwareEditPanel, buildHardwarePartCard, hwBindNumberInput, hwBindNumberScrub, hwNoteEdit, hwHandleDrop, hwAxisFitSummary };
