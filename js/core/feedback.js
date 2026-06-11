// ============================================================================
// FEEDBACK - Toast notifications and loading states
// ============================================================================

const Feedback = (function() {
    'use strict';

    let hideTimer = null;
    let loadingDepth = 0;

    function getToastEl() {
        return document.getElementById('toast');
    }

    /**
     * @param {string} message
     * @param {'info'|'success'|'warning'|'error'} [type]
     * @param {number} [duration] ms; 0 = persist until next toast
     */
    function showToast(message, type = 'info', duration = 3000) {
        const toast = getToastEl();
        if (!toast) {
            console.warn('[Feedback]', message);
            return;
        }
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        loadingDepth = 0;
        toast.textContent = message;
        toast.className = `toast ${type} show`;
        toast.removeAttribute('aria-busy');
        if (duration > 0) {
            hideTimer = setTimeout(() => {
                toast.classList.remove('show');
                hideTimer = null;
            }, duration);
        }
    }

    function showLoading(message = 'Loading...') {
        loadingDepth++;
        const toast = getToastEl();
        if (!toast) return;
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
        toast.textContent = message;
        toast.className = 'toast info show loading';
        toast.setAttribute('aria-busy', 'true');
    }

    function hideLoading() {
        loadingDepth = Math.max(0, loadingDepth - 1);
        if (loadingDepth > 0) return;
        const toast = getToastEl();
        if (toast && toast.classList.contains('loading')) {
            toast.classList.remove('show', 'loading');
            toast.removeAttribute('aria-busy');
        }
    }

    return { showToast, showLoading, hideLoading };
})();

/** Global shim — existing code calls showToast() directly */
function showToast(message, type = 'info', duration = 3000) {
    return Feedback.showToast(message, type, duration);
}
