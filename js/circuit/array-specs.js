// ============================================================================
// Connected PV array specs — series/parallel Voc, Vmp, Isc, Imp (shared)
// ============================================================================

function normalizePolarity(p) {
    if (p === 'pv-positive') return 'positive';
    if (p === 'pv-negative') return 'negative';
    return p;
}

function emptyArraySpecs() {
    return {
        wmp: 0, voc: 0, vmp: 0, isc: 0, imp: 0, panelCount: 0, seriesCount: 0, parallelCount: 0, config: '0P0S',
    };
}

/**
 * @param {object} ctx
 * @param {() => object[]} ctx.getItems
 * @param {() => object[]} ctx.getConnections
 * @param {() => Map} [ctx.getCache]
 */
export function createArraySpecsCalculator(ctx) {
    function getItems() {
        return ctx.getItems() || [];
    }

    function findItem(id) {
        return getItems().find((i) => i.id === id);
    }

    function calculatePartialStringVoltage(startPanel, startHandle) {
        if (!startPanel || startPanel.type !== 'panel') {
            return { voltage: 0, panelCount: 0 };
        }

        const visited = new Set();
        const panels = [];

        function traceSeries(currentPanel, currentHandle) {
            if (visited.has(currentPanel.id)) return;
            visited.add(currentPanel.id);
            panels.push(currentPanel);

            const otherHandle = currentHandle.polarity === 'positive'
                ? currentPanel.handles.negative
                : currentPanel.handles.positive;

            if (otherHandle?.connectedTo) {
                for (const conn of otherHandle.connectedTo) {
                    const item = findItem(conn.itemId);
                    if (item?.type === 'panel' && !visited.has(item.id)) {
                        const connectedHandle = Object.values(item.handles).find((h) => h.id === conn.handleId);
                        if (connectedHandle && connectedHandle.polarity !== otherHandle.polarity) {
                            traceSeries(item, connectedHandle);
                        }
                    }
                }
            }
        }

        traceSeries(startPanel, startHandle);

        const totalVoc = panels.reduce((sum, p) => sum + (p.specs.voc || 0), 0);
        return { voltage: totalVoc, panelCount: panels.length };
    }

    function calculateConnectedArraySpecs(controller) {
        const cache = ctx.getCache?.();
        const cacheKey = controller.id;
        if (cache?.has(cacheKey)) return cache.get(cacheKey);

        const allItems = getItems();
        const completeStrings = [];

        function traceToPanels(startItem, startHandle, visited = new Set(), depth = 0) {
            if (depth > 50) return [];
            const key = `${startItem.id}-${startHandle.id}`;
            if (visited.has(key)) return [];
            visited.add(key);

            const panels = [];

            if (startItem.type === 'panel') {
                panels.push(startItem);

                const entryPolarity = normalizePolarity(startHandle.polarity);
                const otherHandle = entryPolarity === 'positive'
                    ? startItem.handles.negative
                    : startItem.handles.positive;

                otherHandle?.connectedTo?.forEach((conn) => {
                    const item = findItem(conn.itemId);
                    if (item?.type === 'panel') {
                        const handle = Object.values(item.handles).find((hh) => hh.id === conn.handleId);
                        if (handle && handle.polarity !== otherHandle.polarity) {
                            panels.push(...traceToPanels(item, handle, visited, depth + 1));
                        }
                    }
                });

                return panels;
            }

            if (startItem.type === 'combiner' || startItem.type === 'solarcombiner') {
                const isOutputHandle = startHandle.id.includes('-out-');
                if (isOutputHandle) {
                    const outputPolarity = normalizePolarity(startHandle.polarity);

                    Object.values(startItem.handles).forEach((h) => {
                        if (h.inputIndex === undefined) return;
                        if (normalizePolarity(h.polarity) !== outputPolarity) return;
                        if (startItem.type === 'solarcombiner' && !startItem.breakerStates?.[h.inputIndex]) return;

                        h.connectedTo?.forEach((conn) => {
                            const item = findItem(conn.itemId);
                            if (!item) return;
                            const handle = Object.values(item.handles).find((hh) => hh.id === conn.handleId);
                            if (handle) {
                                panels.push(...traceToPanels(item, handle, visited, depth + 1));
                            }
                        });
                    });
                }
                return panels;
            }

            if (startItem.type === 'breaker') {
                if (!startItem.isClosed) return [];

                const handlePolarity = normalizePolarity(startHandle.polarity);
                const isLoadSide = startHandle.id.includes('-load-');
                const isLineSide = startHandle.id.includes('-line-');

                let targetHandle;
                if (isLoadSide) {
                    targetHandle = handlePolarity === 'positive'
                        ? startItem.handles.linePositive
                        : startItem.handles.lineNegative;
                } else if (isLineSide) {
                    targetHandle = handlePolarity === 'positive'
                        ? startItem.handles.loadPositive
                        : startItem.handles.loadNegative;
                }

                targetHandle?.connectedTo?.forEach((conn) => {
                    const item = findItem(conn.itemId);
                    if (!item) return;
                    const handle = Object.values(item.handles).find((hh) => hh.id === conn.handleId);
                    if (handle) {
                        panels.push(...traceToPanels(item, handle, visited, depth + 1));
                    }
                });
                return panels;
            }

            startHandle.connectedTo?.forEach((conn) => {
                const item = findItem(conn.itemId);
                if (!item) return;
                const handle = Object.values(item.handles).find((hh) => hh.id === conn.handleId);
                if (handle) {
                    panels.push(...traceToPanels(item, handle, visited, depth + 1));
                }
            });

            return panels;
        }

        const panelsFromPositive = new Set();
        const panelsFromNegative = new Set();
        const mpptCount = controller.specs?.mpptCount || 1;

        const pvPositiveHandles = [];
        if (controller.handles?.pvPositive) pvPositiveHandles.push(controller.handles.pvPositive);
        for (let i = 1; i <= mpptCount; i += 1) {
            const handleKey = `pvPositive${i}`;
            if (controller.handles?.[handleKey]) pvPositiveHandles.push(controller.handles[handleKey]);
        }

        pvPositiveHandles.forEach((pvPosHandle) => {
            pvPosHandle?.connectedTo?.forEach((conn) => {
                const item = findItem(conn.itemId);
                if (!item) return;
                const handle = Object.values(item.handles).find((h) => h.id === conn.handleId);
                if (handle) {
                    traceToPanels(item, handle, new Set()).forEach((p) => panelsFromPositive.add(p.id));
                }
            });
        });

        const pvNegativeHandles = [];
        if (controller.handles?.pvNegative) pvNegativeHandles.push(controller.handles.pvNegative);
        for (let i = 1; i <= mpptCount; i += 1) {
            const handleKey = `pvNegative${i}`;
            if (controller.handles?.[handleKey]) pvNegativeHandles.push(controller.handles[handleKey]);
        }

        pvNegativeHandles.forEach((pvNegHandle) => {
            pvNegHandle?.connectedTo?.forEach((conn) => {
                const item = findItem(conn.itemId);
                if (!item) return;
                const handle = Object.values(item.handles).find((h) => h.id === conn.handleId);
                if (handle) {
                    traceToPanels(item, handle, new Set()).forEach((p) => panelsFromNegative.add(p.id));
                }
            });
        });

        const completePanelIds = new Set([...panelsFromPositive].filter((id) => panelsFromNegative.has(id)));
        if (completePanelIds.size === 0) {
            const empty = emptyArraySpecs();
            cache?.set(cacheKey, empty);
            return empty;
        }

        const visitedPanels = new Set();

        function traceSeriesString(startPanel, startHandle) {
            const string = [];
            let currentPanel = startPanel;
            let currentHandle = startHandle;

            while (currentPanel && !visitedPanels.has(currentPanel.id)) {
                if (!completePanelIds.has(currentPanel.id)) break;

                visitedPanels.add(currentPanel.id);
                string.push(currentPanel);

                const otherHandle = currentHandle.polarity === 'positive'
                    ? currentPanel.handles.negative
                    : currentPanel.handles.positive;

                let nextPanel = null;
                let nextHandle = null;

                for (const conn of otherHandle.connectedTo || []) {
                    const item = findItem(conn.itemId);
                    if (item?.type === 'panel' && !visitedPanels.has(item.id) && completePanelIds.has(item.id)) {
                        const connectedHandle = Object.values(item.handles).find((h) => h.id === conn.handleId);
                        if (connectedHandle && connectedHandle.polarity !== otherHandle.polarity) {
                            nextPanel = item;
                            nextHandle = connectedHandle;
                            break;
                        }
                    }
                }

                currentPanel = nextPanel;
                currentHandle = nextHandle;
            }

            return string;
        }

        const stringStartPanels = [];
        for (const panelId of completePanelIds) {
            const panel = findItem(panelId);
            if (!panel) continue;

            const isConnectedToPanelNegative = panel.handles.positive.connectedTo.some((conn) => {
                const connItem = findItem(conn.itemId);
                if (connItem?.type !== 'panel') return false;
                const connHandle = Object.values(connItem.handles).find((h) => h.id === conn.handleId);
                return connHandle?.polarity === 'negative';
            });

            if (!isConnectedToPanelNegative) {
                stringStartPanels.push(panel);
            }
        }

        for (const panel of stringStartPanels) {
            if (visitedPanels.has(panel.id)) continue;
            const string = traceSeriesString(panel, panel.handles.positive);
            if (string.length > 0) completeStrings.push(string);
        }

        if (completeStrings.length === 0) {
            const empty = emptyArraySpecs();
            cache?.set(cacheKey, empty);
            return empty;
        }

        const parallelCount = completeStrings.length;
        const seriesCount = Math.max(...completeStrings.map((s) => s.length));
        const totalPanels = completeStrings.reduce((sum, s) => sum + s.length, 0);

        const stringVocs = completeStrings.map((s) => s.reduce((sum, p) => sum + (p.specs.voc || 0), 0));
        const stringVmps = completeStrings.map((s) => s.reduce((sum, p) => sum + (p.specs.vmp || 0), 0));
        const voc = Math.max(...stringVocs);
        const vmp = Math.max(...stringVmps);

        const stringIscs = completeStrings.map((s) => Math.min(...s.map((p) => p.specs.isc || 0)));
        const stringImps = completeStrings.map((s) => {
            const panelImps = s.map((p) => {
                if (p.specs.imp) return p.specs.imp;
                if (p.specs.wmp && p.specs.vmp) return p.specs.wmp / p.specs.vmp;
                if (p.specs.isc) return p.specs.isc * 0.9;
                return 0;
            });
            return Math.min(...panelImps);
        });

        const isc = stringIscs.reduce((sum, i) => sum + i, 0);
        const imp = stringImps.reduce((sum, i) => sum + i, 0);
        const wmp = completeStrings.reduce(
            (sum, s) => sum + s.reduce((sum2, p) => sum2 + (p.specs.wmp || 0), 0),
            0,
        );

        const result = {
            wmp,
            voc,
            vmp,
            isc,
            imp,
            panelCount: totalPanels,
            seriesCount,
            parallelCount,
            config: `${parallelCount}P${seriesCount}S`,
        };

        cache?.set(cacheKey, result);
        return result;
    }

    return { calculateConnectedArraySpecs, calculatePartialStringVoltage };
}

export default createArraySpecsCalculator;
