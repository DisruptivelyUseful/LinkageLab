// ============================================================================
// MAIN INITIALIZATION
// ============================================================================

// Initialize the application when DOM is ready
function initApp() {
    // Setup mode switching button handlers
    const linkageBtn = document.getElementById('btn-mode-linkage');
    const solarBtn = document.getElementById('btn-mode-solar');
    
    if (linkageBtn) {
        linkageBtn.onclick = () => switchToLinkageMode();
    }
    
    if (solarBtn) {
        solarBtn.onclick = () => switchToSolarMode();
    }
    
    // Load saved configuration from localStorage
    const savedConfig = localStorage.getItem('linkageLab_config');
    if (savedConfig) {
        try {
            const config = JSON.parse(savedConfig);
            if (config && typeof applyConfig === 'function') {
                applyConfig(config);
            }
        } catch (e) {
            console.error('Error loading saved configuration:', e);
        }
    }
    
    // Initialize UI updates
    if (typeof updateUI === 'function') {
        updateUI();
    }
    
    // Initial render
    if (typeof requestRender === 'function') {
        requestRender();
    }
    
    // Setup window resize handler
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (typeof requestRender === 'function') {
                requestRender();
            }
        }, 250);
    });
    
    // Setup auto-save (save state to localStorage on changes)
    if (typeof saveStateToHistory === 'function') {
        // Auto-save will be triggered by state change handlers
        // This is just a placeholder for any additional auto-save setup
    }
    
    console.log('LinkageLab initialized');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    // DOM is already ready
    initApp();
}
