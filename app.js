/**
 * app.js — Main application: data loading, playback, audio, orchestration
 *
 * This is the entry point that ties together:
 *  - Configuration from vars.json (all text and settings)
 *  - CSV data loading and parsing (via Papa Parse)
 *  - Shader rendering (via shader.js)
 *  - Timeline bar (via timeline.js)
 *  - Storm marker dots (DOM elements above timeline)
 *  - Audio playback (via Web Audio API)
 *  - Info dialog
 *  - Accessibility (ARIA updates, screen reader announcements)
 */

const App = (() => {

    // ========================================================================
    // STATE
    // ========================================================================

    // Configuration loaded from vars.json
    let config = null;

    // Data arrays (one entry per hour, 8760 expected)
    let unnormData = [];        // Parsed rows from unnormalized CSV
    let normData = [];          // Parsed rows from normalized CSV
    let dates = [];             // Date objects for each hour
    let stormIndices = [];      // Indices where precipitation > threshold

    // Playback state
    let isPlaying = false;
    let currentIndex = 0;       // Current hour index (0–8759)
    let lastFrameTime = 0;      // Timestamp of last animation frame
    let fractionalIndex = 0;    // Smooth sub-hour position for fluid playback

    // Audio
    let audioCtx = null;        // Web Audio API context
    let audioBuffer = null;     // Decoded audio buffer
    let audioSource = null;     // Currently playing buffer source node
    let audioStartTime = 0;     // AudioContext time when playback started
    let audioOffset = 0;        // Offset into the audio buffer (seconds)

    // DOM elements (cached on init)
    let els = {};

    // Track the last announced day (to throttle screen reader announcements)
    let lastAnnouncedDay = '';

    // ========================================================================
    // CONFIG LOADING
    // ========================================================================

    /**
     * Load vars.json and return the parsed config object.
     */
    async function loadConfig() {
        const response = await fetch('vars.json');
        if (!response.ok) throw new Error('Failed to load vars.json');
        return response.json();
    }

    /**
     * Populate all DOM text from the config object.
     */
    function applyConfig() {
        // Splash screen
        els.splashDesc.textContent = config.splash.description;
        els.splashNote.textContent = config.splash.audioNote;
        els.splashEnter.textContent = config.splash.enterButton;

        // Site title
        els.siteTitle.textContent = config.ui.siteTitle;

        // Info dialog
        els.infoTitle.textContent = config.info.title;
        els.infoSonification.textContent = config.info.sonification;

        // Credits list
        els.infoCredits.innerHTML = '';
        for (const name of config.info.credits) {
            const li = document.createElement('li');
            li.textContent = name;
            els.infoCredits.appendChild(li);
        }

        // Timeline ARIA label
        els.timelineCanvas.setAttribute('aria-label', config.ui.timelineLabel);
    }

    // ========================================================================
    // DATA LOADING
    // ========================================================================

    /**
     * Load and parse both CSV files. Returns a promise that resolves
     * when both are ready.
     */
    async function loadData() {
        const [unnorm, norm] = await Promise.all([
            parseCSV(config.data.unnormalizedPath),
            parseCSV(config.data.normalizedPath),
        ]);

        unnormData = unnorm;
        normData = norm;

        // Extract dates from the unnormalized data (first column is the date)
        dates = unnormData.map(row => new Date(row.Date));

        // Identify storm events based on precipitation threshold
        const threshold = config.playback.stormThreshold;
        stormIndices = [];
        for (let i = 0; i < unnormData.length; i++) {
            const precip = parseFloat(unnormData[i].Precipitation_mm_hr) || 0;
            if (precip >= threshold) {
                stormIndices.push(i);
            }
        }
    }

    /**
     * Parse a CSV file using Papa Parse.
     * Returns a promise resolving to an array of row objects.
     */
    function parseCSV(url) {
        return new Promise((resolve, reject) => {
            Papa.parse(url, {
                download: true,
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true,
                complete: (results) => resolve(results.data),
                error: (err) => reject(err),
            });
        });
    }

    // ========================================================================
    // STORM MARKERS (DOM circles above timeline)
    // ========================================================================

    /**
     * Create clickable yellow dot elements for each storm event.
     * Positioned as percentage offsets within #storm-markers.
     */
    function createStormMarkers() {
        const container = els.stormMarkers;
        container.innerHTML = '';

        const total = unnormData.length;

        // Group consecutive storm hours into events to avoid overlapping dots.
        // Each "event" is the first hour of a consecutive storm run.
        const events = [];
        for (let i = 0; i < stormIndices.length; i++) {
            const idx = stormIndices[i];
            // Only create a dot for the start of a storm run
            if (i === 0 || stormIndices[i - 1] < idx - 1) {
                events.push(idx);
            }
        }

        for (const idx of events) {
            const dot = document.createElement('button');
            dot.className = 'storm-dot';
            dot.setAttribute('aria-label', `Storm event on ${formatDate(dates[idx])}`);
            dot.setAttribute('tabindex', '-1'); // navigable but not in main tab order
            dot.style.left = `${(idx / total) * 100}%`;

            // Click to jump to this storm event
            dot.addEventListener('click', () => {
                handleScrub(idx);
            });

            container.appendChild(dot);
        }
    }

    // ========================================================================
    // AUDIO
    // ========================================================================

    /**
     * Initialise the Web Audio API context. Must be called from a user gesture.
     */
    function initAudio() {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    /**
     * Load the sonification audio file. Fails silently if the file
     * isn't available yet (placeholder).
     */
    async function loadAudio() {
        try {
            const response = await fetch(config.playback.audioPath);
            if (!response.ok) {
                console.warn(`Audio file not found at ${config.playback.audioPath} — running without audio.`);
                return;
            }
            const arrayBuffer = await response.arrayBuffer();
            audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch (e) {
            console.warn('Could not load audio:', e.message);
        }
    }

    /**
     * Start or resume audio playback from a given offset (in seconds).
     */
    function playAudio(offsetSeconds) {
        stopAudio(); // stop any currently playing source

        if (!audioBuffer || !audioCtx) return;

        audioSource = audioCtx.createBufferSource();
        audioSource.buffer = audioBuffer;
        audioSource.connect(audioCtx.destination);

        audioOffset = offsetSeconds;
        audioStartTime = audioCtx.currentTime;
        audioSource.start(0, offsetSeconds);
    }

    /**
     * Stop audio playback.
     */
    function stopAudio() {
        if (audioSource) {
            try { audioSource.stop(); } catch (e) { /* already stopped */ }
            audioSource = null;
        }
    }

    /**
     * Calculate the audio offset (seconds) for a given data index.
     * Maps the timeline position linearly to the audio duration.
     */
    function indexToAudioOffset(index) {
        if (!audioBuffer) return 0;
        const fraction = index / (unnormData.length - 1);
        return fraction * audioBuffer.duration;
    }

    // ========================================================================
    // PLAYBACK
    // ========================================================================

    /**
     * Start playback: advance through the timeline and sync audio.
     */
    function play() {
        if (isPlaying) return;
        isPlaying = true;
        fractionalIndex = currentIndex;
        lastFrameTime = performance.now();

        // Update button
        els.playBtn.setAttribute('aria-label', 'Stop');
        els.playIcon.classList.add('hidden');
        els.stopIcon.classList.remove('hidden');

        // Start audio from current position
        playAudio(indexToAudioOffset(currentIndex));

        // Start the animation loop
        requestAnimationFrame(tick);
    }

    /**
     * Stop playback.
     */
    function stop() {
        if (!isPlaying) return;
        isPlaying = false;

        // Update button
        els.playBtn.setAttribute('aria-label', 'Play');
        els.playIcon.classList.remove('hidden');
        els.stopIcon.classList.add('hidden');

        stopAudio();
    }

    /**
     * Toggle play/stop.
     */
    function togglePlayback() {
        if (isPlaying) {
            stop();
        } else {
            play();
        }
    }

    /**
     * Animation loop tick. Advances the timeline based on elapsed real time.
     */
    function tick(timestamp) {
        if (!isPlaying) return;

        // Calculate how many data-hours have passed since last frame
        const deltaMs = timestamp - lastFrameTime;
        lastFrameTime = timestamp;
        const hoursPerSecond = config.playback.hoursPerSecond;
        const deltaHours = (deltaMs / 1000) * hoursPerSecond;

        fractionalIndex += deltaHours;

        // Clamp to data range
        if (fractionalIndex >= unnormData.length - 1) {
            fractionalIndex = unnormData.length - 1;
            setIndex(Math.floor(fractionalIndex));
            stop();
            return;
        }

        setIndex(Math.floor(fractionalIndex));

        requestAnimationFrame(tick);
    }

    // ========================================================================
    // INDEX / POSITION MANAGEMENT
    // ========================================================================

    /**
     * Set the current data index (hour). Updates all displays.
     *
     * @param {number} index — hour index (0-based)
     */
    function setIndex(index) {
        currentIndex = Math.max(0, Math.min(unnormData.length - 1, index));

        // Update timeline playhead
        Timeline.setPosition(currentIndex);

        // Update ARIA slider attributes
        els.timelineCanvas.setAttribute('aria-valuenow', currentIndex);
        els.timelineCanvas.setAttribute('aria-valuetext', formatDate(dates[currentIndex]));

        // Update date display
        updateDateDisplay();

        // Announce storms to screen readers
        announceIfStorm();
    }

    /**
     * Handle scrub from the timeline or storm dot click.
     */
    function handleScrub(index) {
        fractionalIndex = index;
        setIndex(index);

        // If playing, re-sync audio to new position
        if (isPlaying) {
            playAudio(indexToAudioOffset(index));
        }
    }

    // ========================================================================
    // DATE DISPLAY
    // ========================================================================

    /**
     * Format a Date object as "23 March 2024" (date only, no time).
     */
    function formatDate(date) {
        if (!date || isNaN(date.getTime())) return '—';
        return date.toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
        });
    }

    /**
     * Update the on-screen date display. Only updates the aria-live region
     * when the day changes (to avoid spamming screen readers).
     */
    function updateDateDisplay() {
        const date = dates[currentIndex];
        const formatted = formatDate(date);

        // Always update the visual display
        els.dateDisplay.textContent = formatted;

        // Only announce to screen readers when the day changes
        const dayKey = date ? date.toDateString() : '';
        if (dayKey !== lastAnnouncedDay) {
            lastAnnouncedDay = dayKey;
            // The aria-live="polite" on #date-display will pick this up
        }
    }

    // ========================================================================
    // ACCESSIBILITY — STORM ANNOUNCEMENTS
    // ========================================================================

    /**
     * If the current hour is a storm event, announce it to screen readers
     * via the assertive live region.
     */
    function announceIfStorm() {
        if (stormIndices.includes(currentIndex)) {
            const precip = parseFloat(unnormData[currentIndex].Precipitation_mm_hr) || 0;
            els.stormAnnounce.textContent =
                `Storm event: ${precip.toFixed(1)} millimetres per hour precipitation on ${formatDate(dates[currentIndex])}`;
        }
    }

    // ========================================================================
    // INFO DIALOG
    // ========================================================================

    /**
     * Open the info dialog and trap focus inside it.
     */
    function openInfoDialog() {
        els.infoDialog.classList.remove('hidden');
        els.infoClose.focus();
    }

    /**
     * Close the info dialog and return focus to the info button.
     */
    function closeInfoDialog() {
        els.infoDialog.classList.add('hidden');
        els.infoBtn.focus();
    }

    // ========================================================================
    // SHADER RENDER LOOP
    // ========================================================================

    /** Elapsed time tracker for the shader */
    let startTime = 0;

    /**
     * Main render loop — runs every frame, updates shader uniforms with
     * the current data values, then renders.
     */
    function renderLoop(timestamp) {
        if (!startTime) startTime = timestamp;
        const elapsed = (timestamp - startTime) / 1000;

        // Get current normalized data values for shader uniforms
        const row = normData[currentIndex] || {};

        ShaderManager.render({
            time: elapsed,
            precipitation: parseFloat(row.Precipitation_mm_hr) || 0,
            streamflow: parseFloat(row.Stream_Discharge_mm_hr) || 0,
            evapotranspiration: parseFloat(row.Evapotranspiration_mm_hr) || 0,
            soilMoisture: parseFloat(row.Soil_mm) || 0,
            snow: parseFloat(row.Snow_mm) || 0,
            temperature: parseFloat(row.Air_Temperature_celsius) || 0,
            progress: currentIndex / (unnormData.length - 1),
        });

        requestAnimationFrame(renderLoop);
    }

    // ========================================================================
    // SPLASH SCREEN
    // ========================================================================

    /**
     * Dismiss the splash screen: fade it out, reveal main content,
     * initialise audio, and move focus.
     */
    function dismissSplash() {
        // Init audio context (requires user gesture)
        initAudio();

        // Fade out splash
        els.splash.classList.add('hidden');

        // Reveal main content
        els.mainContent.removeAttribute('aria-hidden');

        // Move focus to the play button after transition
        setTimeout(() => {
            els.playBtn.focus();
        }, 600); // matches CSS transition duration

        // Load audio in background (non-blocking)
        loadAudio();
    }

    // ========================================================================
    // INITIALISATION
    // ========================================================================

    /**
     * Boot the application. Called on DOMContentLoaded.
     */
    async function init() {
        // Cache DOM elements
        els = {
            splash: document.getElementById('splash'),
            splashDesc: document.getElementById('splash-desc'),
            splashNote: document.querySelector('.splash-note'),
            splashEnter: document.getElementById('splash-enter'),
            mainContent: document.getElementById('main-content'),
            siteTitle: document.getElementById('site-title'),
            shaderCanvas: document.getElementById('shader-canvas'),
            timelineCanvas: document.getElementById('timeline-canvas'),
            stormMarkers: document.getElementById('storm-markers'),
            playBtn: document.getElementById('play-btn'),
            playIcon: document.querySelector('.play-icon'),
            stopIcon: document.querySelector('.stop-icon'),
            dateDisplay: document.getElementById('date-display'),
            stormAnnounce: document.getElementById('storm-announce'),
            infoBtn: document.getElementById('info-btn'),
            infoDialog: document.getElementById('info-dialog'),
            infoTitle: document.getElementById('info-title'),
            infoSonification: document.getElementById('info-sonification'),
            infoCredits: document.getElementById('info-credits'),
            infoClose: document.getElementById('info-close'),
        };

        // Load configuration
        try {
            config = await loadConfig();
        } catch (e) {
            console.error('Failed to load vars.json:', e);
            return;
        }

        // Apply text from config to DOM
        applyConfig();

        // Splash screen interaction
        els.splashEnter.addEventListener('click', dismissSplash);

        // Play/Stop button
        els.playBtn.addEventListener('click', togglePlayback);

        // Keyboard shortcut: Space on play button toggles playback
        els.playBtn.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                togglePlayback();
            }
        });

        // Info dialog open/close
        els.infoBtn.addEventListener('click', openInfoDialog);
        els.infoClose.addEventListener('click', closeInfoDialog);

        // Close info dialog on Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !els.infoDialog.classList.contains('hidden')) {
                closeInfoDialog();
            }
        });

        // Close info dialog on backdrop click
        els.infoDialog.addEventListener('click', (e) => {
            if (e.target === els.infoDialog) {
                closeInfoDialog();
            }
        });

        // Window resize handler
        window.addEventListener('resize', () => {
            ShaderManager.resize();
            Timeline.resize();
        });

        // Initialise WebGL shader
        try {
            await ShaderManager.init(els.shaderCanvas);
        } catch (e) {
            console.error('Shader initialisation failed:', e.message);
        }

        // Load CSV data
        try {
            await loadData();
        } catch (e) {
            console.error('Data loading failed:', e);
            els.dateDisplay.textContent = 'Failed to load data.';
            return;
        }

        // Extract precipitation values for the timeline
        const precipitation = unnormData.map(
            row => parseFloat(row.Precipitation_mm_hr) || 0
        );

        // Initialise the timeline bar
        Timeline.init(els.timelineCanvas, {
            precipitation,
            onScrub: handleScrub,
        });

        // Create clickable storm marker dots above the timeline
        createStormMarkers();

        // Set initial date display
        setIndex(0);

        // Start the shader render loop
        requestAnimationFrame(renderLoop);
    }

    // --- Boot on page load ---
    document.addEventListener('DOMContentLoaded', init);

    // Expose for debugging (optional, remove in production)
    return { setIndex, play, stop };

})();
