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

    function normalizeHour(hours) {
        return ((hours % 24) + 24) % 24;
    }

    function resolveSunTimes(options = {}) {
        const sunrise = options.sunrise ?? 6;
        const sunset = options.sunset ?? 18;
        const twilight = options.twilight ?? 1;
        return { sunrise, sunset, twilight };
    }

    function skyColorsForHour(hours, options = {}) {
        const h = normalizeHour(hours);
        const { sunrise, sunset, twilight } = resolveSunTimes(options);

        const night = { r: 10, g: 21, b: 32 };       // #0a1520
        const dawn = { r: 30, g: 41, b: 62 };
        const day = { r: 42, g: 78, b: 118 };        // lighter blue daylight
        const dusk = { r: 30, g: 41, b: 62 };

        const lerp = (a, b, t) => ({
            r: Math.round(a.r + (b.r - a.r) * t),
            g: Math.round(a.g + (b.g - a.g) * t),
            b: Math.round(a.b + (b.b - a.b) * t),
        });
        const clamp01 = (t) => Math.max(0, Math.min(1, t));
        const toCss = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`;

        const dawnStart = Math.max(0, sunrise - twilight);
        const duskEnd = Math.min(24, sunset + twilight);

        let rgb;
        if (h < dawnStart || h >= duskEnd) {
            rgb = night;
        } else if (h < sunrise) {
            rgb = lerp(night, dawn, clamp01((h - dawnStart) / (sunrise - dawnStart || 1)));
        } else if (h < sunrise + twilight * 0.5) {
            rgb = lerp(dawn, day, clamp01((h - sunrise) / (twilight * 0.5 || 1)));
        } else if (h < sunset - twilight * 0.5) {
            const noon = Math.abs(h - (sunrise + sunset) / 2) / Math.max(1, (sunset - sunrise) / 2);
            const brightness = 1 + (1 - noon) * 0.12;
            rgb = {
                r: Math.min(255, Math.round(day.r * brightness)),
                g: Math.min(255, Math.round(day.g * brightness)),
                b: Math.min(255, Math.round(day.b * brightness)),
            };
        } else if (h < sunset) {
            rgb = lerp(day, dusk, clamp01((h - (sunset - twilight * 0.5)) / (twilight * 0.5 || 1)));
        } else {
            rgb = lerp(dusk, night, clamp01((h - sunset) / (duskEnd - sunset || 1)));
        }

        const gridAlpha = h >= sunrise && h < sunset ? 0.04 : 0.03;
        const gridColor = `rgba(150, 190, 230, ${gridAlpha})`;

        return { bgColor: toCss(rgb), gridColor };
    }

    function ensureStarsContainer(overlay) {
        let starsContainer = overlay.querySelector('.celestial-stars');
        if (starsContainer) return starsContainer;

        ensureTwinkleStyle();
        starsContainer = document.createElement('div');
        starsContainer.className = 'celestial-stars';
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
        return starsContainer;
    }

    function ensureCelestialElement(overlay, className) {
        let el = overlay.querySelector(`.${className}`);
        if (!el) {
            el = document.createElement('div');
            el.className = className;
            el.style.position = 'absolute';
            el.style.pointerEvents = 'none';
            el.style.transition = 'opacity 0.4s ease';
            overlay.appendChild(el);
        }
        return el;
    }

    function updateCelestialGraphics(overlay, hours, options = {}) {
        const h = normalizeHour(hours);
        const { sunrise, sunset, twilight } = resolveSunTimes(options);
        const dayLength = Math.max(0.5, sunset - sunrise);

        const dawnStart = Math.max(0, sunrise - twilight);
        const duskEnd = Math.min(24, sunset + twilight);
        const isNight = h < dawnStart || h >= duskEnd;
        const isDawn = h >= dawnStart && h < sunrise + twilight * 0.5;
        const isDusk = h >= sunset - twilight * 0.5 && h < duskEnd;
        const isDay = h >= sunrise && h < sunset;

        const sun = ensureCelestialElement(overlay, 'celestial-sun');
        const moon = ensureCelestialElement(overlay, 'celestial-moon');
        const starsContainer = ensureStarsContainer(overlay);

        if (isDay || isDawn) {
            const sunProgress = Math.max(0, Math.min(1, (h - sunrise) / dayLength));
            const sunX = 8 + sunProgress * 84;
            const sunY = 12 + Math.sin(sunProgress * Math.PI) * -38 + 38;
            const sunSize = isDawn ? 40 + Math.max(0, h - dawnStart) * 12 : 58;
            const sunOpacity = isDawn
                ? 0.25 + Math.max(0, (h - dawnStart) / (twilight || 1)) * 0.75
                : 1;

            sun.style.display = 'block';
            sun.style.left = `${sunX}%`;
            sun.style.top = `${sunY}%`;
            sun.style.width = `${sunSize}px`;
            sun.style.height = `${sunSize}px`;
            sun.style.borderRadius = '50%';
            sun.style.opacity = String(sunOpacity);
            sun.style.background = 'radial-gradient(circle, #FFD700 0%, #FFA500 40%, transparent 70%)';
            sun.style.boxShadow = `0 0 ${sunSize}px ${sunSize / 2}px rgba(255, 215, 0, 0.35)`;
        } else {
            sun.style.display = 'none';
        }

        if (isNight || isDusk) {
            const nightSpan = 24 - duskEnd + dawnStart;
            let moonProgress = 0.5;
            if (h >= duskEnd) {
                moonProgress = (h - duskEnd) / Math.max(0.5, nightSpan);
            } else if (h < dawnStart) {
                moonProgress = (h + (24 - duskEnd)) / Math.max(0.5, nightSpan);
            }
            moonProgress = Math.max(0, Math.min(1, moonProgress));

            const moonX = 8 + moonProgress * 84;
            const moonY = 12 + Math.sin(moonProgress * Math.PI) * -28 + 28;
            const moonSize = isDusk ? 34 + Math.max(0, duskEnd - h) * 6 : 40;
            const moonOpacity = isDusk
                ? 0.25 + Math.max(0, (duskEnd - h) / (twilight || 1)) * 0.55
                : 0.85;

            moon.style.display = 'block';
            moon.style.left = `${moonX}%`;
            moon.style.top = `${moonY}%`;
            moon.style.width = `${moonSize}px`;
            moon.style.height = `${moonSize}px`;
            moon.style.borderRadius = '50%';
            moon.style.opacity = String(moonOpacity);
            moon.style.background = 'radial-gradient(circle at 30% 30%, #FFF 0%, #E0E0E0 50%, #A0A0A0 100%)';
            moon.style.boxShadow = `0 0 ${moonSize}px ${moonSize / 3}px rgba(255, 255, 255, 0.2)`;
        } else {
            moon.style.display = 'none';
        }

        starsContainer.style.display = isNight ? 'block' : 'none';
        starsContainer.style.opacity = isDusk ? String(Math.max(0, (h - (sunset - twilight * 0.5)) / (twilight || 1))) : '1';
    }

    function formatClockFromHours(hours) {
        const h = normalizeHour(hours);
        const wholeHours = Math.floor(h);
        const mins = Math.round((h - wholeHours) * 60);
        const ampm = wholeHours >= 12 ? 'PM' : 'AM';
        const displayHours = wholeHours % 12 || 12;
        return `${displayHours}:${String(mins).padStart(2, '0')} ${ampm}`;
    }

    function updateSunTrackIndicator(hours, sunIndicatorEl, options = {}) {
        if (!sunIndicatorEl) return;
        const h = normalizeHour(hours);
        const { sunrise, sunset } = resolveSunTimes(options);

        let progress = 0.5;
        if (h >= sunrise && h <= sunset) {
            progress = (h - sunrise) / Math.max(0.5, sunset - sunrise);
        } else if (h > sunset) {
            progress = 1;
        } else {
            progress = 0;
        }

        sunIndicatorEl.style.left = `${8 + progress * 84}%`;
        sunIndicatorEl.style.opacity = h >= sunrise && h <= sunset ? '1' : '0.35';
    }

    /**
     * Apply sky gradient + celestial overlay to a canvas container.
     * @param {HTMLElement} container
     * @param {number} hours - hour of day (0-24, fractional OK)
     * @param {{ overlayId?: string, skipBackground?: boolean, sunrise?: number, sunset?: number, twilight?: number }} [options]
     */
    function updateContainer(container, hours, options = {}) {
        if (!container) return;

        const h = normalizeHour(hours);
        const overlayId = options.overlayId || 'celestial-overlay';

        if (!options.skipBackground) {
            const { bgColor, gridColor } = skyColorsForHour(h, options);
            container.style.backgroundColor = bgColor;
            container.style.backgroundImage = `
                linear-gradient(${gridColor} 1px, transparent 1px),
                linear-gradient(90deg, ${gridColor} 1px, transparent 1px)
            `;
            container.style.backgroundSize = '20px 20px';
        }

        let overlay = container.querySelector(`#${overlayId}`);
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = overlayId;
            overlay.style.cssText = `
                position: absolute;
                inset: 0;
                pointer-events: none;
                overflow: hidden;
                z-index: 0;
            `;
            container.appendChild(overlay);
        }

        updateCelestialGraphics(overlay, h, options);
    }

    function clearOverlay(container, overlayId = 'celestial-overlay') {
        if (!container) return;
        delete container.dataset.celestialHourKey;
        container.querySelector(`#${overlayId}`)?.remove();
        container.style.backgroundColor = '';
        container.style.backgroundImage = '';
        container.style.backgroundSize = '';
    }

    global.CelestialSky = {
        updateContainer,
        clearOverlay,
        formatClockFromHours,
        updateSunTrackIndicator,
        skyColorsForHour,
    };
})(typeof globalThis !== 'undefined' ? globalThis : window);
