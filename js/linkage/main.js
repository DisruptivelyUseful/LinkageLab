// ============================================================================
// LINKAGE LAB - Application bootstrap (init orchestration, config load, autosave)
// Depends on all linkage modules loaded before this script.
// ============================================================================
(function (g) {
    'use strict';

    async function initLinkageLab() {
        initViewportInput();
        initSolarPanelHandlers();
        initBuildGuideHandlers();
        initReferenceInputHandlers();
        initUIBindings();
        initHardwareUI();
        
        // Add ARIA labels for accessibility
        document.getElementById('canvas').setAttribute('role', 'img');
        document.getElementById('canvas').setAttribute('aria-label', '3D linkage structure visualization');
        document.getElementById('hud-panel').setAttribute('role', 'region');
        document.getElementById('hud-panel').setAttribute('aria-label', 'Structure statistics and bill of materials');
        
        // Add tooltips to inputs
        Object.keys(idMap).forEach(k => {
            const key = idMap[k];
            const rule = VALIDATION_RULES[key];
            if (rule && inputs[k].nb) {
                inputs[k].nb.title = `${key}: Range ${rule.min} to ${rule.max}`;
            }
            if (inputs[k].sl) {
                inputs[k].sl.setAttribute('aria-label', key);
            }
        });
        
        // Initialize UI
        Object.keys(idMap).forEach(k => syncUI(idMap[k]));
        
        // Initialize solar panel arch mode UI
        updateArchWallFacesUI();
        
        // Load configuration: localStorage first, then default JSON fallback
        const saved = localStorage.getItem('linkageLab_config');
        if (saved) {
            try {
                const config = JSON.parse(saved);
                // Validate config before applying - check for obviously bad values
                if (config && typeof config === 'object') {
                    applyConfig(config);
                } else {
                    console.warn('Invalid config format, skipping load');
                    localStorage.removeItem('linkageLab_config');
                }
            } catch (e) {
                console.error('Error loading saved config:', e);
                // Clear corrupted config
                localStorage.removeItem('linkageLab_config');
            }
        } else {
            // No localStorage - load default config from JSON file
            fetch('configs/starshade-default.json')
                .then(response => {
                    if (!response.ok) throw new Error('Default config not found');
                    return response.json();
                })
                .then(config => {
                    console.log('Loading default configuration from configs/starshade-default.json...');
                    applyConfig(config);
                    requestRender();
                })
                .catch(e => {
                    console.log('No default config found at configs/starshade-default.json, using hardcoded defaults');
                });
        }
        
        // Preload preset libraries (hardware + solar panels)
        hwLoadPresetCatalog().then(() => hwLinkPartsToKnownPresets());
        spLoadPresetCatalog().then(() => {
            spLinkConfigsToKnownPresets();
            spInitPanelPresetUI();
        });
        
        // Emergency localStorage clear: Press Ctrl+Shift+Delete while focused on page
        document.addEventListener('keydown', e => {
            if (e.ctrlKey && e.shiftKey && e.key === 'Delete') {
                if (confirm('Clear all LinkageLab saved data? This will reset to defaults.')) {
                    // Clear all linkageLab keys
                    Object.keys(localStorage).forEach(key => {
                        if (key.startsWith('linkageLab')) {
                            localStorage.removeItem(key);
                        }
                    });
                    showToast('Saved data cleared. Refreshing...', 'info');
                    setTimeout(() => location.reload(), 1000);
                }
            }
        });
        
        // Initialize animation stop angle to closed angle if not set
        if (state.animation.stopAngle === null || state.animation.stopAngle === undefined) {
            const closedAngle = getOptimalClosedAngleForAnimation();
            state.animation.stopAngle = radToDeg(closedAngle);
            const stopSlider = document.getElementById('sl-anim-stop');
            const stopNumber = document.getElementById('nb-anim-stop');
            if (stopSlider) stopSlider.value = state.animation.stopAngle;
            if (stopNumber) stopNumber.value = state.animation.stopAngle;
        }
        
        // Initialize preset dropdown
        updatePresetSelect();
        
        // Save initial state to history
        saveStateToHistory();
        
        console.log('LinkageLab build:', typeof LINKAGE_BUILD_ID !== 'undefined' ? LINKAGE_BUILD_ID : 'inline');
        console.log('LinkageModules:', Object.keys(g.LinkageModules || {}));

        // Log Three.js availability and do initial render
        if (typeof THREE !== 'undefined') {
            console.log('Three.js loaded successfully:', THREE.REVISION);
            // Initialize Three.js immediately
            initThreeJS();
            if (typeof preloadIbcGlb === 'function') preloadIbcGlb();
        } else {
            console.error('Three.js failed to load - using 2D fallback');
        }
        
        // Initial render
        requestRender();
        
        // View labels are now in the right panel HTML
        
        // Auto-save on changes (heavily debounced to avoid lag during animations)
        // Only saves when user stops interacting for a while
        const autoSave = debounce(() => {
            // Save without showing toast to reduce overhead
            const config = getConfigSnapshot();
            localStorage.setItem('linkageLab_config', JSON.stringify(config));
            // No toast notification for autosave to reduce overhead
        }, 8000); // 8 seconds - only saves after user stops interacting
        
        // Add auto-save listener (only for number inputs, not sliders during drag)
        // Sliders are already handled by updateState which is debounced
        Object.keys(idMap).forEach(k => {
            const key = idMap[k];
            // Only autosave on number input changes, not slider drags
            // Sliders go through updateState which is already debounced
            if (inputs[k].nb) {
                inputs[k].nb.addEventListener('change', autoSave);
            }
        });
        
        // Handle window resize
        window.addEventListener('resize', debounce(() => {
            requestRender();
        }, 100));
        
        // Custom number input spin buttons
        (function() {
            function createSpinButtons(input) {
                // Skip if already has custom buttons
                if (input.parentElement.classList.contains('number-spin-wrapper')) {
                    return;
                }
                // Don't wrap guide BOM price inputs
                if (input.classList.contains('guide-price-input')) {
                    return;
                }
        
                // Preserve inline width if present
                const inlineWidth = input.style.width;
                
                // Determine button width based on input width
                // Smaller inputs get smaller buttons
                let buttonWidth = 50; // Default
                if (inlineWidth) {
                    const widthMatch = inlineWidth.match(/(\d+)px/);
                    if (widthMatch) {
                        const widthValue = parseInt(widthMatch[1]);
                        if (widthValue <= 60) {
                            buttonWidth = 24; // Very compact
                        } else if (widthValue <= 80) {
                            buttonWidth = 28; // Compact
                        } else {
                            buttonWidth = 50; // Normal
                        }
                    }
                }
                
                // Create wrapper
                const wrapper = document.createElement('div');
                wrapper.className = 'number-spin-wrapper';
                if (inlineWidth) {
                    wrapper.style.width = inlineWidth;
                    // Input should be full width, padding-right will prevent text from going under buttons
                    input.style.width = '100%';
                    input.style.paddingRight = buttonWidth + 'px';
                } else {
                    // For inputs without explicit width, just set padding
                    input.style.paddingRight = buttonWidth + 'px';
                }
                
                // Create buttons container
                const buttonsContainer = document.createElement('div');
                buttonsContainer.className = 'number-spin-buttons';
                
                // Create up button
                const upBtn = document.createElement('button');
                upBtn.type = 'button';
                upBtn.className = 'number-spin-btn up';
                upBtn.setAttribute('aria-label', 'Increase value');
                upBtn.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    input.stepUp();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };
                
                // Create down button
                const downBtn = document.createElement('button');
                downBtn.type = 'button';
                downBtn.className = 'number-spin-btn down';
                downBtn.setAttribute('aria-label', 'Decrease value');
                downBtn.onclick = function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    input.stepDown();
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                };
                
                // Assemble
                buttonsContainer.appendChild(upBtn);
                buttonsContainer.appendChild(downBtn);
                
                // Wrap the input
                input.parentNode.insertBefore(wrapper, input);
                wrapper.appendChild(input);
                wrapper.appendChild(buttonsContainer);
            }
            
            // Initialize all existing number inputs
            function initSpinButtons() {
                const numberInputs = document.querySelectorAll('input[type="number"]:not(.number-spin-wrapper input)');
                numberInputs.forEach(createSpinButtons);
            }
            
            // Run on DOM ready
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', initSpinButtons);
            } else {
                initSpinButtons();
            }
            
            // Also handle dynamically added inputs (MutationObserver)
            const observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    mutation.addedNodes.forEach(function(node) {
                        if (node.nodeType === 1) { // Element node
                            if (node.tagName === 'INPUT' && node.type === 'number') {
                                createSpinButtons(node);
                            } else {
                                const numberInputs = node.querySelectorAll && node.querySelectorAll('input[type="number"]:not(.number-spin-wrapper input)');
                                if (numberInputs) {
                                    numberInputs.forEach(createSpinButtons);
                                }
                            }
                        }
                    });
                });
            });
            
            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        })();
        
    }

    g.LinkageModules = g.LinkageModules || {};
    g.LinkageModules.main = { initLinkageLab };
    g.initLinkageLab = initLinkageLab;

    function boot() {
        initLinkageLab().catch(err => console.error('LinkageLab init failed:', err));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

})(window);

