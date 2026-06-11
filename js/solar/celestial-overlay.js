// ============================================================================
// Day/night sky background + sun / moon / stars overlay (2D canvas views)
// ============================================================================

(function (global) {
    function ensureTwinkleStyle() {
        if (document.getElementById('star-twinkle-style')) return;
        const style = document.createElement('style');
        style.id = 'star-twinkle-style';
        style.textContent = `
            @keyframes celestial-twinkle {
                0%, 100% { opacity: 0.3; }
                50% { opacity: 1; }
            }
        `;
        document.head.appendChild(style);
    }

    function skyColorsForHour(hours) {
        let bgColor;
        let gridColor;

        if (hours < 5 || hours > 21) {
            bgColor = '#0a1520';
            gridColor = 'rgba(100, 150, 200, 0.03)';
        } else if (hours < 6) {
            const t = hours - 5;
            bgColor = `rgb(${10 + t * 20}, ${21 + t * 20}, ${32 + t * 30})`;
            gridColor = 'rgba(150, 180, 200, 0.04)';
        } else if (hours < 7) {
            const t = hours - 6;
            bgColor = `rgb(${30 + t * 30}, ${41 + t * 30}, ${62 + t * 20})`;
            gridColor = 'rgba(200, 180, 150, 0.05)';
        } else if (hours < 18) {
            const noon = Math.abs(hours - 12) / 5;
            const brightness = 1 - noon * 0.2;
            bgColor = `rgb(${Math.round(26 * brightness + 20)}, ${Math.round(43 * brightness + 20)}, ${Math.round(60 * brightness + 20)})`;
            gridColor = 'rgba(240, 173, 78, 0.04)';
        } else if (hours < 19) {
            const t = hours - 18;
            bgColor = `rgb(${60 - t * 30}, ${63 - t * 22}, ${80 - t * 18})`;
            gridColor = 'rgba(240, 173, 78, 0.05)';
        } else if (hours < 20) {
            const t = hours - 19;
            bgColor = `rgb(${30 - t * 15}, ${41 - t * 15}, ${62 - t * 25})`;
            gridColor = 'rgba(150, 150, 200, 0.04)';
        } else {
            const t = hours - 20;
            bgColor = `rgb(${15 - t * 5}, ${26 - t * 5}, ${37 - t * 17})`;
            gridColor = 'rgba(100, 150, 200, 0.03)';
        }

        return { bgColor, gridColor };
    }

    function paintCelestialOverlay(overlay, hours) {
        while (overlay.firstChild) {
            overlay.removeChild(overlay.firstChild);
        }

        const isNight = hours < 6 || hours > 19;
        const isDawn = hours >= 5 && hours < 7;
        const isDusk = hours >= 18 && hours < 20;
        const isDay = hours >= 7 && hours < 18;

        if (isDay || isDawn) {
            const sunProgress = (hours - 6) / 12;
            const sunX = 10 + sunProgress * 80;
            const sunY = 10 + Math.sin(sunProgress * Math.PI) * -40 + 40;
            const sunSize = isDawn ? 40 + (hours - 5) * 10 : 60;
            const sunOpacity = isDawn ? 0.3 + (hours - 5) * 0.4 : 1;

            const sun = document.createElement('div');
            sun.style.cssText = `
                position: absolute;
                left: ${sunX}%;
                top: ${sunY}%;
                width: ${sunSize}px;
                height: ${sunSize}px;
                background: radial-gradient(circle, #FFD700 0%, #FFA500 40%, transparent 70%);
                border-radius: 50%;
                opacity: ${sunOpacity};
                box-shadow: 0 0 ${sunSize}px ${sunSize / 2}px rgba(255, 215, 0, 0.3);
                transition: all 1s ease;
            `;
            overlay.appendChild(sun);
        }

        if (isNight || isDusk) {
            const moonProgress = hours < 12 ? (hours + 6) / 12 : (hours - 18) / 12;
            const moonX = 10 + moonProgress * 80;
            const moonY = 10 + Math.sin(moonProgress * Math.PI) * -30 + 30;
            const moonSize = isDusk ? 30 + (20 - hours) * 5 : 40;
            const moonOpacity = isDusk ? 0.3 + (20 - hours) * 0.35 : 0.8;

            const moon = document.createElement('div');
            moon.style.cssText = `
                position: absolute;
                left: ${moonX}%;
                top: ${moonY}%;
                width: ${moonSize}px;
                height: ${moonSize}px;
                background: radial-gradient(circle at 30% 30%, #FFF 0%, #E0E0E0 50%, #A0A0A0 100%);
                border-radius: 50%;
                opacity: ${moonOpacity};
                box-shadow: 0 0 ${moonSize}px ${moonSize / 3}px rgba(255, 255, 255, 0.2);
                transition: all 1s ease;
            `;
            overlay.appendChild(moon);
        }

        if (isNight) {
            ensureTwinkleStyle();
            const starsContainer = document.createElement('div');
            starsContainer.style.cssText = 'position:absolute;inset:0;';

            for (let i = 0; i < 50; i++) {
                const star = document.createElement('div');
                const x = Math.random() * 100;
                const y = Math.random() * 60;
                const size = 1 + Math.random() * 2;
                const opacity = 0.3 + Math.random() * 0.7;
                const twinkleDelay = Math.random() * 3;

                star.style.cssText = `
                    position: absolute;
                    left: ${x}%;
                    top: ${y}%;
                    width: ${size}px;
                    height: ${size}px;
                    background: white;
                    border-radius: 50%;
                    opacity: ${opacity};
                    box-shadow: 0 0 ${size * 2}px ${size}px rgba(255, 255, 255, 0.5);
                    animation: celestial-twinkle ${2 + Math.random() * 2}s ease-in-out ${twinkleDelay}s infinite;
                `;
                starsContainer.appendChild(star);
            }

            overlay.appendChild(starsContainer);
        }
    }

    function formatClockFromHours(hours) {
        const h = ((hours % 24) + 24) % 24;
        const wholeHours = Math.floor(h);
        const mins = Math.round((h - wholeHours) * 60);
        const ampm = wholeHours >= 12 ? 'PM' : 'AM';
        const displayHours = wholeHours % 12 || 12;
        return `${displayHours}:${String(mins).padStart(2, '0')} ${ampm}`;
    }

    function updateSunTrackIndicator(hours, sunIndicatorEl) {
        if (!sunIndicatorEl) return;
        const h = ((hours % 24) + 24) % 24;
        const sunrise = 6;
        const sunset = 18;
        let progress = 0.5;
        if (h >= sunrise && h <= sunset) {
            progress = (h - sunrise) / (sunset - sunrise);
        } else if (h > sunset) {
            progress = 1;
        } else {
            progress = 0;
        }
        sunIndicatorEl.style.left = `${10 + progress * 80}%`;
        sunIndicatorEl.style.opacity = h >= sunrise && h <= sunset ? '1' : '0.35';
    }

    /**
     * Apply sky gradient + celestial overlay to a canvas container.
     * @param {HTMLElement} container
     * @param {number} hours - hour of day (0-24, fractional OK)
     * @param {{ overlayId?: string, skipBackground?: boolean }} [options]
     */
    function updateContainer(container, hours, options = {}) {
        if (!container) return;

        const h = ((hours % 24) + 24) % 24;
        const overlayId = options.overlayId || 'celestial-overlay';

        if (!options.skipBackground) {
            const { bgColor, gridColor } = skyColorsForHour(h);
            container.style.backgroundColor = bgColor;
            container.style.backgroundImage = `
                linear-gradient(${gridColor} 1px, transparent 1px),
                linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
            `;
        }

        const hourKey = Math.floor(h * 2);
        if (container.dataset.celestialHourKey === String(hourKey)) return;
        container.dataset.celestialHourKey = String(hourKey);

        let overlay = container.querySelector(`#${overlayId}`);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.style.cssText = `
                position: absolute;
                inset: 0;
                pointer-events: none;
                overflow: hidden;
                z-index: 1;
            `;
            container.appendChild(overlay);
        }

        paintCelestialOverlay(overlay, h);
    }

    function clearOverlay(container, overlayId = 'celestial-overlay') {
        if (!container) return;
        delete container.dataset.celestialHourKey;
        container.querySelector(`#${overlayId}`)?.remove();
    }

    global.CelestialSky = {
        updateContainer,
        clearOverlay,
        formatClockFromHours,
        updateSunTrackIndicator,
        skyColorsForHour,
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
