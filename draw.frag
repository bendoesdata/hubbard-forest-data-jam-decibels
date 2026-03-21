// Fragment shader — placeholder
// Replace this with the final generative shader later.
// Currently shows a gentle animated gradient that responds to data uniforms.

precision mediump float;

varying vec2 vUV;

// Resolution and time
uniform vec2 u_res;
uniform float u_time;

// Data uniforms (all normalized 0-1)
uniform float u_precipitation;
uniform float u_streamflow;
uniform float u_evapotranspiration;
uniform float u_soil_moisture;
uniform float u_snow;
uniform float u_temperature;

// Timeline progress (0-1 across the full year)
uniform float u_progress;

// --- Noise helpers ---

// Simple hash-based pseudo-random
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion (3 octaves)
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 3; i++) {
        value += amplitude * noise(p);
        p *= 2.0;
        amplitude *= 0.5;
    }
    return value;
}

// --- Main ---

void main() {
    vec2 uv = vUV;
    float aspect = u_res.x / u_res.y;
    vec2 pos = vec2(uv.x * aspect, uv.y);

    // Base colour: deep dark blue-black
    vec3 base = vec3(0.02, 0.02, 0.06);

    // Slow-moving noise field (represents terrain/topography)
    float terrain = fbm(pos * 3.0 + u_time * 0.02);

    // Precipitation creates ripple-like disturbance
    float rain = u_precipitation * fbm(pos * 8.0 + u_time * 0.5);

    // Streamflow adds flowing lines
    float flow = u_streamflow * noise(vec2(pos.x * 4.0 + u_time * 0.3, pos.y * 2.0));

    // Snow adds a white overlay
    float snow = u_snow * smoothstep(0.4, 0.6, noise(pos * 5.0 + u_time * 0.01));

    // Compose colours
    // Blue channel: water (precipitation + streamflow)
    vec3 water = vec3(0.29, 0.56, 0.85) * (rain * 0.6 + flow * 0.4);

    // Terrain tint (subtle green-brown)
    vec3 land = vec3(0.08, 0.12, 0.08) * terrain;

    // Snow (white)
    vec3 snowCol = vec3(0.7, 0.75, 0.8) * snow;

    // Temperature shifts the overall warmth (blue when cold, slightly warm when hot)
    float warmth = u_temperature * 0.1;
    vec3 tempTint = vec3(warmth, 0.0, -warmth * 0.5);

    // Combine everything
    vec3 colour = base + land + water + snowCol + tempTint;

    // Subtle vignette
    float vignette = 1.0 - 0.3 * length(uv - 0.5);
    colour *= vignette;

    // Clamp to valid range
    colour = clamp(colour, 0.0, 1.0);

    gl_FragColor = vec4(colour, 1.0);
}
