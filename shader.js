/**
 * shader.js — WebGL setup and shader management
 *
 * Handles:
 *  - WebGL context creation
 *  - Shader compilation (vertex + fragment)
 *  - Fullscreen quad geometry
 *  - Uniform updates each frame
 *
 * The shader files (rect.vert, draw.frag) are loaded as text and compiled
 * at runtime. To swap the shader, replace draw.frag with a new file.
 */

const ShaderManager = (() => {
    // --- Private state ---
    let gl = null;            // WebGL rendering context
    let program = null;       // Compiled shader program
    let uniforms = {};        // Cached uniform locations

    // Names of all uniforms we send to the shader
    const UNIFORM_NAMES = [
        'u_res',
        'u_time',
        'u_precipitation',
        'u_streamflow',
        'u_evapotranspiration',
        'u_soil_moisture',
        'u_snow',
        'u_temperature',
        'u_progress',
    ];

    /**
     * Compile a single shader (vertex or fragment) from source text.
     * Throws an error with the shader log if compilation fails.
     */
    function compileShader(source, type) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compile error: ${log}`);
        }
        return shader;
    }

    /**
     * Link vertex and fragment shaders into a program.
     * Throws an error if linking fails.
     */
    function linkProgram(vertShader, fragShader) {
        const prog = gl.createProgram();
        gl.attachShader(prog, vertShader);
        gl.attachShader(prog, fragShader);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(prog);
            gl.deleteProgram(prog);
            throw new Error(`Program link error: ${log}`);
        }
        return prog;
    }

    /**
     * Create a fullscreen quad (two triangles covering the viewport).
     * Uses position and texcoord attributes.
     */
    function createFullscreenQuad() {
        // Positions: clip space (-1 to 1)
        const positions = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1,
        ]);

        // Texture coordinates (0 to 1)
        const texCoords = new Float32Array([
            0, 0,
            1, 0,
            0, 1,
            1, 1,
        ]);

        // Position buffer
        const posBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

        const aPosition = gl.getAttribLocation(program, 'aPosition');
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

        // Texcoord buffer
        const texBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        const aTexCoord = gl.getAttribLocation(program, 'aTexCoord');
        gl.enableVertexAttribArray(aTexCoord);
        gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);
    }

    /**
     * Cache all uniform locations for fast access during rendering.
     */
    function cacheUniforms() {
        uniforms = {};
        for (const name of UNIFORM_NAMES) {
            uniforms[name] = gl.getUniformLocation(program, name);
        }
    }

    /**
     * Fetch a text file (shader source) from the server.
     */
    async function fetchShaderSource(url) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to load shader: ${url}`);
        }
        return response.text();
    }

    // --- Public API ---

    return {
        /**
         * Initialise WebGL: get context, load & compile shaders, set up geometry.
         * Call this once on page load.
         *
         * @param {HTMLCanvasElement} canvas — the canvas element to render into
         */
        async init(canvas) {
            // Get WebGL context
            gl = canvas.getContext('webgl', { antialias: false, alpha: false });
            if (!gl) {
                throw new Error('WebGL not supported in this browser.');
            }

            // Load shader source files
            const [vertSrc, fragSrc] = await Promise.all([
                fetchShaderSource('rect.vert'),
                fetchShaderSource('draw.frag'),
            ]);

            // Compile and link
            const vertShader = compileShader(vertSrc, gl.VERTEX_SHADER);
            const fragShader = compileShader(fragSrc, gl.FRAGMENT_SHADER);
            program = linkProgram(vertShader, fragShader);

            // Clean up individual shaders (they're linked into the program now)
            gl.deleteShader(vertShader);
            gl.deleteShader(fragShader);

            // Use the program and set up geometry
            gl.useProgram(program);
            createFullscreenQuad();
            cacheUniforms();

            // Set initial viewport
            this.resize();
        },

        /**
         * Update canvas size to match the window. Call on window resize.
         */
        resize() {
            if (!gl) return;

            const canvas = gl.canvas;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = canvas.clientWidth * dpr;
            canvas.height = canvas.clientHeight * dpr;
            gl.viewport(0, 0, canvas.width, canvas.height);
        },

        /**
         * Render one frame. Called every animation frame.
         *
         * @param {Object} data — current data values to send as uniforms
         * @param {number} data.time        — elapsed time in seconds
         * @param {number} data.precipitation
         * @param {number} data.streamflow
         * @param {number} data.evapotranspiration
         * @param {number} data.soilMoisture
         * @param {number} data.snow
         * @param {number} data.temperature
         * @param {number} data.progress    — timeline progress 0-1
         */
        render(data) {
            if (!gl || !program) return;

            // Set uniforms
            gl.uniform2f(uniforms.u_res, gl.canvas.width, gl.canvas.height);
            gl.uniform1f(uniforms.u_time, data.time || 0);
            gl.uniform1f(uniforms.u_precipitation, data.precipitation || 0);
            gl.uniform1f(uniforms.u_streamflow, data.streamflow || 0);
            gl.uniform1f(uniforms.u_evapotranspiration, data.evapotranspiration || 0);
            gl.uniform1f(uniforms.u_soil_moisture, data.soilMoisture || 0);
            gl.uniform1f(uniforms.u_snow, data.snow || 0);
            gl.uniform1f(uniforms.u_temperature, data.temperature || 0);
            gl.uniform1f(uniforms.u_progress, data.progress || 0);

            // Draw the fullscreen quad (triangle strip, 4 vertices)
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        },
    };
})();
