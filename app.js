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

    // Audio (HTML audio element for streaming large files)
    let audioEl = null;         // <audio> element
    let audioDuration = 0;      // Duration in seconds (set when metadata loads)
    let audioReady = false;     // Whether audio metadata has loaded

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
        els.splashDesc.innerHTML = config.splash.description;
        els.splashNote.innerHTML = config.splash.audioNote;
        els.splashEnter.textContent = config.splash.enterButton;

        // Site title
        els.siteTitle.textContent = config.ui.siteTitle;

        // Info dialog
        els.infoTitle.textContent = config.info.title;
        els.infoSonification.innerHTML = config.info.sonification;

        // Credits list
        els.infoCredits.innerHTML = '';
        for (const name of config.info.credits) {
            const li = document.createElement('li');
            li.innerHTML = name;
            els.infoCredits.appendChild(li);
        }

        // Audio legend on splash screen
        const legendEl = document.getElementById('audio-legend');
        if (legendEl && config.splash.legend) {
            legendEl.innerHTML = '';
            for (const item of config.splash.legend) {
                const row = document.createElement('div');
                row.className = 'legend-row';

                const btn = document.createElement('button');
                btn.className = 'legend-play-btn';
                btn.type = 'button';
                btn.setAttribute('aria-label', `Play ${item.label} sample`);
                btn.innerHTML = '<span class="legend-icon-play">&#9654;</span>';

                let audio = null;
                btn.addEventListener('click', () => {
                    if (audio && !audio.paused) {
                        audio.pause();
                        audio.currentTime = 0;
                        btn.innerHTML = '<span class="legend-icon-play">&#9654;</span>';
                    } else {
                        // Create new Audio each time so multiple can play at once
                        audio = new Audio(item.audioPath);
                        audio.addEventListener('ended', () => {
                            btn.innerHTML = '<span class="legend-icon-play">&#9654;</span>';
                        });
                        audio.play().catch(() => {});
                        btn.innerHTML = '<span class="legend-icon-stop"></span>';
                    }
                });

                const text = document.createElement('span');
                text.className = 'legend-text';
                text.innerHTML = `<strong>${item.label}</strong> — ${item.description}`;

                row.appendChild(btn);
                row.appendChild(text);
                legendEl.appendChild(row);
            }
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

        // Identify storm events for dots (uses normalized data)
        const dotVar = config.playback.dotVariable || 'precipitation';
        const dotIsStreamflow = dotVar === 'streamflow';
        const dotColumn = dotIsStreamflow ? 'streamflow_cfs' : 'Precipitation_mm_hr';
        const dotThreshold = config.playback.streamflowThreshold;

        stormIndices = [];
        for (let i = 0; i < normData.length; i++) {
            const val = parseFloat(normData[i][dotColumn]) || 0;
            if (val >= dotThreshold) {
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

            // Click to jump to this storm event (with configurable offset)
            const offset = config.playback.dotOffset || 0;
            const jumpIdx = Math.max(0, idx - offset);
            dot.addEventListener('click', () => {
                handleScrub(jumpIdx);
            });

            container.appendChild(dot);
        }
    }

    // ========================================================================
    // AUDIO
    // ========================================================================

    /**
     * Create the audio element and start loading. Streams from disk
     * rather than decoding the entire file into memory.
     */
    function initAudio() {
        audioEl = new Audio(config.playback.audioPath);
        audioEl.preload = 'auto';
        audioEl.addEventListener('loadedmetadata', () => {
            audioDuration = audioEl.duration;
            audioReady = true;
        });
        audioEl.addEventListener('error', () => {
            console.warn(`Could not load audio from ${config.playback.audioPath}`);
        });
    }

    /**
     * Start or resume audio playback from a given offset (in seconds).
     */
    function playAudio(offsetSeconds) {
        if (!audioEl || !audioReady) return;
        audioEl.currentTime = offsetSeconds;
        audioEl.play().catch(() => {}); // ignore autoplay rejections
    }

    /**
     * Stop audio playback.
     */
    function stopAudio() {
        if (audioEl) {
            audioEl.pause();
        }
    }

    /**
     * Calculate the audio offset (seconds) for a given data index.
     * Maps the timeline position linearly to the audio duration.
     */
    function indexToAudioOffset(index) {
        if (!audioReady) return 0;
        const fraction = index / (unnormData.length - 1);
        return fraction * audioDuration;
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
            const dotIsStreamflow = (config.playback.dotVariable || 'precipitation') === 'streamflow';
            const colName = dotIsStreamflow ? 'streamflow_cfs' : 'Precipitation_mm_hr';
            const val = parseFloat(unnormData[currentIndex][colName]) || 0;
            const label = dotIsStreamflow ? 'streamflow' : 'precipitation';
            const unit = dotIsStreamflow ? 'cubic feet per second' : 'millimetres per hour';
            els.stormAnnounce.textContent =
                `Storm event: ${val.toFixed(1)} ${unit} ${label} on ${formatDate(dates[currentIndex])}`;
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

        window.ShaderManager.render({
            time: elapsed,
            precipitation: parseFloat(row.Precipitation_mm_hr) || 0,
            streamflow: parseFloat(row.streamflow_cfs) || 0,
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
        // Init audio (requires user gesture to create element in gesture context)
        initAudio();

        // Fade out splash
        els.splash.classList.add('hidden');

        // Reveal main content
        els.mainContent.removeAttribute('aria-hidden');

        // Move focus to the play button after transition
        setTimeout(() => {
            els.playBtn.focus();
        }, 600); // matches CSS transition duration

        // Show tutorial annotations after splash fades
        const annotations = document.getElementById('annotations');
        if (annotations) {
            setTimeout(() => {
                annotations.classList.remove('hidden');
            }, 1000); // slight delay after splash fades

            function hideAnnotations() {
                annotations.classList.add('hidden');
            }

            // Dismiss when play button or a storm dot is clicked
            els.playBtn.addEventListener('click', hideAnnotations, { once: true });
            els.stormMarkers.addEventListener('click', hideAnnotations, { once: true });
        }
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
            shaderContainer: document.getElementById('shader-container'),
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
            window.ShaderManager.resize();
            Timeline.resize();
        });

        // Wait for ShaderManager to be available (loaded as ES module)
        while (!window.ShaderManager) {
            await new Promise(r => setTimeout(r, 50));
        }

        // Initialise Three.js terrain renderer
        try {
            await window.ShaderManager.init(els.shaderContainer);
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

        // Extract values for the timeline (configurable variable)
        const timelineColName = (config.playback.timelineVariable === 'streamflow')
            ? 'streamflow_cfs' : 'Precipitation_mm_hr';
        const timelineValues = unnormData.map(
            row => parseFloat(row[timelineColName]) || 0
        );

        // Initialise the timeline bar
        Timeline.init(els.timelineCanvas, {
            data: timelineValues,
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
