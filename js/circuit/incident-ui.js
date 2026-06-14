// ============================================================================
// Incident report UI (Phase 11 — shared modal + sound)
// ============================================================================

let audioContext = null;

function initAudioContext() {
    if (!audioContext) {
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (err) {
            console.log('Web Audio API not supported');
        }
    }
    return audioContext;
}

export function playIncidentSound(type) {
    const ctx = initAudioContext();
    if (!ctx) return;

    try {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        if (type === 'critical' || type === 'error') {
            oscillator.type = 'sawtooth';
            oscillator.frequency.setValueAtTime(100, ctx.currentTime);
            oscillator.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.3);
            gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.4);
        } else if (type === 'warning') {
            oscillator.type = 'square';
            oscillator.frequency.setValueAtTime(440, ctx.currentTime);
            gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.2);
        }
    } catch (err) {
        // Silently fail if audio doesn't work
    }
}

/**
 * @param {object} options
 * @param {() => boolean} [options.areIncidentReportsEnabled]
 * @param {() => void} [options.onDismiss]
 * @param {(message: string, type?: string, duration?: number) => void} [options.showToast]
 */
export function createIncidentUI(options = {}) {
    const areIncidentReportsEnabled = options.areIncidentReportsEnabled || (() => true);
    const onDismiss = options.onDismiss || (() => {});
    const showToast = options.showToast || (() => {});

    function showIncidentReport(config) {
        if (!areIncidentReportsEnabled()) return;

        const overlay = document.getElementById('incidentReportOverlay');
        const modal = document.getElementById('incidentReportModal');
        if (!overlay || !modal) return;

        modal.className = 'incident-report';
        modal.classList.remove('warning-level', 'info-level', 'success-level', 'explanation-level');

        if (config.type === 'warning') {
            modal.classList.add('warning-level');
        } else if (config.type === 'info') {
            modal.classList.add('info-level');
        } else if (config.type === 'success') {
            modal.classList.add('success-level');
        } else if (config.type === 'explanation') {
            modal.classList.add('explanation-level');
        }

        document.getElementById('incidentIcon').textContent = config.icon || '💥';
        document.getElementById('incidentType').textContent = config.category || 'INCIDENT';
        document.getElementById('incidentTitle').textContent = config.title || 'Something Went Wrong';
        document.getElementById('incidentDescription').textContent = config.description || '';

        const mathSection = document.getElementById('incidentMathSection');
        const mathContainer = document.getElementById('incidentMath');
        const mathRows = Array.isArray(config.math) ? config.math : [];
        if (mathRows.length) {
            mathSection.style.display = 'block';
            mathContainer.innerHTML = mathRows.map((item) => `
                <div class="incident-math-row">
                    <span class="incident-math-label">${item.label}</span>
                    <span class="incident-math-value ${item.status || ''}">${item.value}</span>
                </div>
            `).join('');
        } else {
            mathSection.style.display = 'none';
        }

        const realworldSection = document.getElementById('incidentRealworldSection');
        if (config.realworld) {
            realworldSection.style.display = 'block';
            document.getElementById('incidentRealworld').textContent = config.realworld;
        } else {
            realworldSection.style.display = 'none';
        }

        const solutions = (config.solutions?.length
            ? config.solutions
            : ['Review your system design and try again']).slice(0, 2);
        const solutionsList = document.getElementById('incidentSolutions');
        solutionsList.innerHTML = solutions.map((s) => `<li>${s}</li>`).join('');

        const learnMoreBtn = document.getElementById('incidentLearnMore');
        if (config.learnMoreTopic) {
            learnMoreBtn.style.display = 'block';
            learnMoreBtn.dataset.topic = config.learnMoreTopic;
        } else {
            learnMoreBtn.style.display = 'none';
        }

        overlay.classList.add('visible');
        playIncidentSound(config.type);
    }

    function hideIncidentReport() {
        const overlay = document.getElementById('incidentReportOverlay');
        if (overlay) overlay.classList.remove('visible');
        onDismiss();
    }

    function initIncidentReportListeners() {
        const overlay = document.getElementById('incidentReportOverlay');
        const dismissBtn = document.getElementById('incidentDismiss');
        const learnMoreBtn = document.getElementById('incidentLearnMore');

        if (dismissBtn) {
            dismissBtn.addEventListener('click', hideIncidentReport);
        }

        if (learnMoreBtn) {
            learnMoreBtn.addEventListener('click', () => {
                const topic = learnMoreBtn.dataset.topic;
                hideIncidentReport();
                showToast(`📚 Learn more about "${topic}" coming soon!`, 'info', 3000);
            });
        }

        if (overlay) {
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) hideIncidentReport();
            });
        }

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && overlay?.classList.contains('visible')) {
                hideIncidentReport();
            }
        });
    }

    return {
        showIncidentReport,
        hideIncidentReport,
        initIncidentReportListeners,
        playIncidentSound,
    };
}

export default createIncidentUI;
