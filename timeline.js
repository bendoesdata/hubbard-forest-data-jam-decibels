/**
 * timeline.js — Timeline bar rendering and interaction
 *
 * Draws a horizontal bar showing precipitation intensity across the year.
 * The playhead shows the current position and can be scrubbed via mouse
 * or keyboard. Storm events are shown as clickable yellow circles above
 * the bar (managed as DOM elements in #storm-markers).
 *
 * Accessibility:
 *  - role="slider" with ARIA attributes (set in HTML)
 *  - Keyboard: Left/Right = ±1 hour, Shift+Left/Right = ±24 hours
 *  - Arrow key interaction updates ARIA valuetext with current date
 */

const Timeline = (() => {
    // --- Private state ---
    let canvas = null;
    let ctx = null;

    let precipData = [];        // Data values for bar colour (precipitation or streamflow)
    let totalHours = 0;         // Total data points (8760 expected)

    let currentIndex = 0;       // Current playhead position (0-based hour index)
    let isDragging = false;     // Whether the user is currently scrubbing

    // Callbacks
    let onScrub = null;         // Called with (index) when user scrubs to a position

    // Colour tokens (match CSS variables)
    const PLAYHEAD = '#ffffff';

    /**
     * Convert a mouse/touch X position to a data index.
     */
    function xToIndex(clientX) {
        const rect = canvas.getBoundingClientRect();
        const fraction = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return Math.round(fraction * (totalHours - 1));
    }

    /**
     * Draw the timeline: precipitation bars and playhead (no background).
     */
    function draw() {
        if (!ctx || totalHours === 0) return;

        const w = canvas.width;
        const h = canvas.height;
        const dpr = window.devicePixelRatio || 1;

        ctx.clearRect(0, 0, w, h);

        // Find max precipitation for scaling colour intensity
        let maxPrecip = 0;
        for (let i = 0; i < precipData.length; i++) {
            if (precipData[i] > maxPrecip) maxPrecip = precipData[i];
        }
        if (maxPrecip === 0) maxPrecip = 1; // avoid division by zero

        // Draw precipitation intensity bars
        // Each hour gets a thin vertical strip
        const barWidth = w / totalHours;

        for (let i = 0; i < totalHours; i++) {
            const intensity = precipData[i] / maxPrecip;
            if (intensity > 0.01) {
                const alpha = 0.15 + intensity * 0.85; // min 15% opacity for visible rain
                ctx.fillStyle = `rgba(74, 144, 217, ${alpha})`;
                const x = (i / totalHours) * w;
                ctx.fillRect(x, 0, Math.max(barWidth, 1), h);
            }
        }

        // Draw playhead (white vertical line)
        const playX = (currentIndex / totalHours) * w;
        ctx.fillStyle = PLAYHEAD;
        ctx.fillRect(playX - dpr, 0, 2 * dpr, h);
    }

    /**
     * Handle pointer down (mouse or touch start).
     */
    function handlePointerDown(e) {
        isDragging = true;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const idx = xToIndex(clientX);
        if (onScrub) onScrub(idx);
        e.preventDefault();
    }

    /**
     * Handle pointer move (mouse drag or touch move).
     */
    function handlePointerMove(e) {
        if (!isDragging) return;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const idx = xToIndex(clientX);
        if (onScrub) onScrub(idx);
        e.preventDefault();
    }

    /**
     * Handle pointer up (end of scrub).
     */
    function handlePointerUp() {
        isDragging = false;
    }

    /**
     * Handle keyboard navigation on the timeline slider.
     * Left/Right: ±1 hour, Shift+Left/Right: ±24 hours (1 day)
     */
    function handleKeyDown(e) {
        let step = 0;

        switch (e.key) {
            case 'ArrowLeft':
                step = e.shiftKey ? -24 : -1;
                break;
            case 'ArrowRight':
                step = e.shiftKey ? 24 : 1;
                break;
            case 'PageUp':
                step = -24;
                break;
            case 'PageDown':
                step = 24;
                break;
            case 'Home':
                if (onScrub) onScrub(0);
                e.preventDefault();
                return;
            case 'End':
                if (onScrub) onScrub(totalHours - 1);
                e.preventDefault();
                return;
            default:
                return; // don't prevent default for unhandled keys
        }

        const newIndex = Math.max(0, Math.min(totalHours - 1, currentIndex + step));
        if (onScrub) onScrub(newIndex);
        e.preventDefault();
    }

    // --- Public API ---

    return {
        /**
         * Initialise the timeline.
         *
         * @param {HTMLCanvasElement} canvasEl — the timeline canvas element
         * @param {Object} options
         * @param {number[]} options.data    — array of values for bar display (unnormalized)
         * @param {Function} options.onScrub — callback(index) when user scrubs
         */
        init(canvasEl, { data, onScrub: scrubCallback }) {
            canvas = canvasEl;
            ctx = canvas.getContext('2d');
            precipData = data;
            totalHours = data.length;
            onScrub = scrubCallback;

            // Set canvas resolution to match display size
            this.resize();

            // Mouse events
            canvas.addEventListener('mousedown', handlePointerDown);
            window.addEventListener('mousemove', handlePointerMove);
            window.addEventListener('mouseup', handlePointerUp);

            // Touch events
            canvas.addEventListener('touchstart', handlePointerDown, { passive: false });
            window.addEventListener('touchmove', handlePointerMove, { passive: false });
            window.addEventListener('touchend', handlePointerUp);

            // Keyboard events (slider role)
            canvas.addEventListener('keydown', handleKeyDown);

            // Initial draw
            draw();
        },

        /**
         * Update the playhead position and redraw.
         *
         * @param {number} index — current hour index (0-based)
         */
        setPosition(index) {
            currentIndex = Math.max(0, Math.min(totalHours - 1, index));
            draw();
        },

        /**
         * Resize canvas to match display size. Call on window resize.
         */
        resize() {
            if (!canvas) return;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.clientWidth * dpr;
            canvas.height = canvas.clientHeight * dpr;
            ctx.setTransform(1, 0, 0, 1, 0, 0); // reset any transforms
            draw();
        },

        /**
         * Get the current playhead index.
         */
        getPosition() {
            return currentIndex;
        },
    };
})();
