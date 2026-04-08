/**
 * shader.js — Three.js terrain renderer (based on Simon Rydén's shader pipeline)
 *
 * Wraps Simon's multi-pass DEM terrain renderer with particle flow into
 * a ShaderManager API that app.js can call each frame with data values.
 *
 * Pipeline (10 passes):
 *   1. boxBlurPass        — blur the DEM heightmap
 *   2. normalPass         — compute surface normals from blurred DEM
 *   3. boxBlurFlowFieldPass — smoother blur for particle flow guidance
 *   4. initPPass          — generate initial particle positions
 *   5. posSolver          — simulate particle movement (feedback loop)
 *   6. renderHeightmap    — shade the terrain with lighting + flood effect
 *   7. scene render       — render instanced particles to offscreen target
 *   8. (trailDecayPass)   — particle trails (commented out, ready to enable)
 *   9. postProcess        — composite particles + terrain to screen
 *
 * Data mapping:
 *   - precipitation  → particle count (u_partAmt)
 *   - soilMoisture   → flood amount (u_flood)
 *   - streamflow     → flood animation speed
 *   - light position → mouse-controlled
 */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js";
import { GLSLPass } from "./glslUtils/GLSLPass.js";
import { FeedbackLoop } from "./glslUtils/FeedbackLoop.js";
import { ImagePass } from "./glslUtils/ImagePass.js";

// Make ShaderManager available globally for app.js
window.ShaderManager = (() => {

    //little attenuators
    const particleAmtAtten = 4.0;
    const floodSpeedAtten = 5.0;
    const floodSpeedMax = 0.5;
    const floodAmtAtten = 0.75;

    // --- Baked parameters (set at init, not changeable at runtime) ---
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const mapHeight = 0.65;
    const blurRadius = 1;
    const blurPreshrink = 1;
    const smallDetail = 0.5;
    const maxParticlesSqrt = isMobile ? 256 : 512;  // fewer particles on mobile
    const blurPreshrinkFF = 0;
    const blurRadiusFF = 9;

    // --- Runtime parameters ---
    const ambientLight = 0.1;
    const lightIntensity = 2.0;
    const lightHeight = 0.55;
    const lerpFactor = 0.05;

    // --- State ---
    let container = null;
    let renderer = null;
    let scene = null;
    let camera = null;
    let imgAspect = 1;
    let width = 0;
    let height = 0;
    let aspect = 1;

    // Light position (mouse-controlled)
    let lightPos = new THREE.Vector3(0.15, 0.25, lightHeight);
    let targetLightPos = new THREE.Vector3(0.15, 0.25, lightHeight);

    // Render passes
    let boxBlurPass, normalPass, renderHeightmap, boxBlurFlowFieldPass;
    let initPPass, posFeedback, posSolver;
    let instancedMaterial, particleRT;
    let trailFeedback, trailDecayPass, postProcess;

    // Animation state
    let initialized = true;
    let floodTime = 0.0;
    let lastRenderTime = 0;

    /**
     * Load a shader source file as text.
     */
    async function loadShader(path) {
        const response = await fetch(path);
        return await response.text();
    }

    /**
     * Compute orthographic camera bounds to cover the DEM aspect ratio.
     * (Copied from Simon's script.js)
     */
    function getOrthoBounds(renderAspect, imgAspect) {
        if (imgAspect > renderAspect) {
            const h = imgAspect / renderAspect;
            return { left: -imgAspect, right: imgAspect, top: h, bottom: -h };
        } else {
            const w = renderAspect;
            return { left: -w, right: w, top: 1, bottom: -1 };
        }
    }

    /**
     * Update camera projection to match current aspect ratio.
     */
    function updateCamera() {
        const b = getOrthoBounds(aspect, imgAspect);
        camera.left = b.left;
        camera.right = b.right;
        camera.top = b.top;
        camera.bottom = b.bottom;
        camera.updateProjectionMatrix();
    }

    // --- Public API ---

    return {
        /**
         * Initialise the Three.js renderer and full shader pipeline.
         * @param {HTMLElement} containerEl — div to render into
         */
        async init(containerEl) {
            container = containerEl;

            // Load all shader sources
            const [
                boxBlurPath, normalPassPath, renderHeightmapPath,
                posSolverPath, instancingVert, instancingFrag,
                trailDecayShaderSrc, postProcessShaderSrc, initPPath
            ] = await Promise.all([
                loadShader("./shaders/boxBlur.frag"),
                loadShader("./shaders/normalPass.frag"),
                loadShader("./shaders/renderHeightmap.frag"),
                loadShader("./shaders/posSolver.frag"),
                loadShader("./shaders/renderPoints.vert"),
                loadShader("./shaders/renderPoints.frag"),
                loadShader("./shaders/trailDecay.frag"),
                loadShader("./shaders/postProcess.frag"),
                loadShader("./shaders/initP.frag"),
            ]);

            // Load DEM heightmap image
            // iOS limits textures to 4096px — use UnsignedByte on mobile
            const DEM_IMG = new ImagePass("./assets/dem.png", {
                wrapMode: "repeat",
                filterMode: "mipmap",
                generateMipmaps: true,
                format: THREE.RGBAFormat,
                type: isMobile ? THREE.UnsignedByteType : THREE.HalfFloatType,
            });
            await DEM_IMG.ready;

            // On mobile, halve DEM resolution to stay within GPU limits
            const demScale = isMobile ? 0.5 : 1.0;
            const imgRes = new THREE.Vector2(DEM_IMG.width * demScale, DEM_IMG.height * demScale);
            imgAspect = DEM_IMG.width / DEM_IMG.height;  // aspect from original, not scaled
            const halfRes = new THREE.Vector2(imgRes.x / 2.0, imgRes.y / 2.0);
            const quarterRes = new THREE.Vector2(imgRes.x / 4.0, imgRes.y / 4.0);
            const zHeight = 1 / mapHeight / quarterRes.y;

            // Create Three.js renderer (prefer WebGL2, fall back to WebGL1)
            renderer = new THREE.WebGLRenderer({ powerPreference: 'default' });
            scene = new THREE.Scene();
            container.appendChild(renderer.domElement);

            width = container.clientWidth;
            height = container.clientHeight;
            aspect = width / height;
            renderer.setSize(width, height);

            // Camera
            camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
            camera.position.set(0, 0, 1);
            camera.lookAt(0, 0, 0);
            scene.add(camera);
            updateCamera();

            // --- RENDER PASSES (from Simon's script.js) ---

            // 1. Box blur on DEM
            boxBlurPass = new GLSLPass(renderer, {
                fragmentShader: boxBlurPath,
                uniforms: {
                    u_radius: { value: blurRadius },
                    u_resolution: { value: [halfRes.x, halfRes.y] },
                    u_preshrink: { value: blurPreshrink },
                    image_tex: { value: DEM_IMG.texture },
                    u_smallDetail: { value: smallDetail },
                    u_amp: { value: 1.0 },
                },
                width: imgRes.x,
                height: imgRes.y,
            });
            boxBlurPass.render();

            // 2. Normal pass
            normalPass = new GLSLPass(renderer, {
                fragmentShader: normalPassPath,
                uniforms: {
                    u_zHeight: { value: zHeight },
                    heightMap_tex: { value: boxBlurPass.texture },
                },
                width: imgRes.x,
                height: imgRes.y,
                generateMipmaps: true,
                filterMode: "mipmap",
            });
            normalPass.render();

            // 3. Render heightmap (shaded terrain + flood)
            renderHeightmap = new GLSLPass(renderer, {
                fragmentShader: renderHeightmapPath,
                uniforms: {
                    u_renderAspect: { value: aspect },
                    u_imgAspect: { value: imgAspect },
                    normal_tex: { value: normalPass.texture },
                    u_sunPos: { value: lightPos },
                    u_zHeight: { value: zHeight },
                    u_time: { value: 0.0 },
                    u_flood: { value: 0.2 },
                    u_ambientLight: { value: ambientLight },
                    u_lightIntensity: { value: lightIntensity },
                },
                width: width,
                height: height,
            });

            // 4. Flow field blur (lower resolution, for particle guidance)
            boxBlurFlowFieldPass = new GLSLPass(renderer, {
                fragmentShader: boxBlurPath,
                uniforms: {
                    u_radius: { value: blurRadiusFF },
                    u_resolution: { value: [halfRes.x, halfRes.y] },
                    u_preshrink: { value: blurPreshrinkFF },
                    image_tex: { value: DEM_IMG.texture },
                    u_smallDetail: { value: 0 },
                    u_amp: { value: 0.5 },
                },
                width: quarterRes.x,
                height: quarterRes.y,
                format: THREE.RGBAFormat,
                type: isMobile ? THREE.UnsignedByteType : THREE.HalfFloatType,
                generateMipmaps: true,
            });
            boxBlurFlowFieldPass.render();

            // 5. Particle init
            const particleCount = 0.3 ** 2;
            initPPass = new GLSLPass(renderer, {
                fragmentShader: initPPath,
                uniforms: {
                    u_partAmt: { value: particleCount },
                    u_mouse: { value: [lightPos.x, lightPos.y] },
                },
                width: maxParticlesSqrt,
                height: maxParticlesSqrt,
            });
            initPPass.render();

            // 6. Particle position solver (feedback loop)
            posFeedback = new FeedbackLoop(renderer, null, {
                width: maxParticlesSqrt,
                height: maxParticlesSqrt,
            });

            posSolver = new GLSLPass(renderer, {
                fragmentShader: posSolverPath,
                uniforms: {
                    initP_tex: { value: initPPass.texture },
                    heightMap_tex: { value: boxBlurFlowFieldPass.texture },
                    fb_tex: { value: posFeedback.texture },
                    u_aspect: { value: imgAspect },
                    u_time: { value: 0.0 },
                },
                width: maxParticlesSqrt,
                height: maxParticlesSqrt,
            });
            posFeedback.sourcePass = posSolver;
            posSolver.render();

            // 7. Instanced particle geometry
            const pointCount = maxParticlesSqrt * maxParticlesSqrt;
            const geometry = new THREE.BufferGeometry();
            const positions = new Float32Array([0, 0, 0]);
            geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

            const instancedGeometry = new THREE.InstancedBufferGeometry();
            instancedGeometry.index = geometry.index;
            instancedGeometry.attributes.position = geometry.attributes.position;
            instancedGeometry.instanceCount = pointCount;

            instancedMaterial = new THREE.RawShaderMaterial({
                vertexShader: instancingVert,
                fragmentShader: instancingFrag,
                glslVersion: THREE.GLSL3,
                transparent: true,
                depthWrite: true,
                blending: THREE.NormalBlending,
                uniforms: {
                    pos_tex: { value: posSolver.texture },
                    u_imgAspect: { value: imgAspect },
                },
                fog: false,
            });

            const points = new THREE.Points(instancedGeometry, instancedMaterial);
            scene.add(points);

            // 8. Post-process targets
            const rtType = isMobile ? THREE.UnsignedByteType : THREE.HalfFloatType;
            particleRT = new THREE.WebGLRenderTarget(width, height, {
                format: THREE.RGBAFormat,
                type: rtType,
            });

            trailFeedback = new FeedbackLoop(renderer, null, {
                width: width,
                height: height,
                format: THREE.RGBAFormat,
                type: rtType,
            });

            trailDecayPass = new GLSLPass(renderer, {
                fragmentShader: trailDecayShaderSrc,
                uniforms: {
                    col_tex: { value: null },
                    fb_tex: { value: trailFeedback.texture },
                    u_resolution: { value: [width, height] },
                    u_decay: { value: 0.99 },
                },
                width: width,
                height: height,
            });
            trailFeedback.sourcePass = trailDecayPass;

            // 9. Final composite
            postProcess = new GLSLPass(renderer, {
                fragmentShader: postProcessShaderSrc,
                uniforms: {
                    part_tex: { value: trailDecayPass.texture },
                    heightMap_tex: { value: renderHeightmap.texture },
                },
                width: width,
                height: height,
            });

            // Mouse interaction for light position
            container.addEventListener("mousemove", (e) => {
                const rect = renderer.domElement.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
                const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
                targetLightPos.x = x;
                targetLightPos.y = -y;
            });
        },

        /**
         * Handle window resize. Updates renderer, camera, and render targets.
         */
        resize() {
            if (!renderer || !container) return;

            width = container.clientWidth;
            height = container.clientHeight;
            aspect = width / height;

            renderer.setSize(width, height);
            updateCamera();

            // Update render targets
            renderHeightmap.setSize(width, height);
            particleRT.setSize(width, height);
            trailFeedback.setSize(width, height);
            trailDecayPass.setSize(width, height);
            postProcess.setSize(width, height);

            // Update uniforms that depend on size
            renderHeightmap.setUniform("u_renderAspect", aspect);
            trailDecayPass.setUniform("u_resolution", [width, height]);
        },

        /**
         * Render one frame. Called every animation frame by app.js.
         *
         * @param {Object} data — current data values
         * @param {number} data.time           — elapsed time in seconds
         * @param {number} data.precipitation  — normalized 0-1 → particle count
         * @param {number} data.streamflow     — normalized 0-1 → flood speed
         * @param {number} data.soilMoisture   — normalized 0-1 → flood amount
         */
        render(data) {
            if (!renderer) return;

            // Calculate delta time for flood animation
            const now = data.time || 0;
            const deltaTime = lastRenderTime ? (now - lastRenderTime) : (1 / 60);
            lastRenderTime = now;

            // --- Data-driven parameters ---

            // Precipitation → particle count (squared, as Simon does)
            const precipValue = data.precipitation || 0;
            const particleCount = precipValue * particleAmtAtten; //tweak

            // Soil moisture → flood amount
            const floodAmt = Math.min(data.soilMoisture * floodAmtAtten, 1) ** 1.0 || 0;

            // Streamflow → flood animation speed
            const floodSpeed = Math.min(data.streamflow * floodSpeedAtten, floodSpeedMax) || 0;
            floodTime += floodSpeed * Math.max(deltaTime, 0);

            // --- Animate (from Simon's animate function) ---

            // Smooth mouse-driven light position
            lightPos.lerp(targetLightPos, lerpFactor);

            // Update particle init
            initPPass.setUniform("u_mouse", [lightPos.x, lightPos.y]);
            initPPass.setUniform("u_partAmt", particleCount);
            initPPass.render();

            // Particle position solver with feedback
            if (initialized) {
                posSolver.setUniform("fb_tex", initPPass.texture);
                initialized = false;
            } else {
                posSolver.setUniform("fb_tex", posFeedback.texture);
            }

            posSolver.setUniform("u_time", now);
            posSolver.render();
            posFeedback.capture();
            instancedMaterial.uniforms.pos_tex.value = posSolver.texture;

            // Render heightmap with data-driven flood
            renderHeightmap.setUniform("u_time", floodTime);
            renderHeightmap.setUniform("u_flood", floodAmt);
            renderHeightmap.setUniform("u_sunPos", lightPos);
            renderHeightmap.render();

            // Render particles to offscreen target
            renderer.setRenderTarget(particleRT);
            renderer.clear();
            renderer.render(scene, camera);

            // Trail effect (commented out, ready to enable)
            // trailDecayPass.setUniform("col_tex", particleRT.texture);
            // trailDecayPass.setUniform("fb_tex", trailFeedback.texture);
            // trailDecayPass.render();
            // trailFeedback.capture();

            // Final composite to screen
            renderer.setRenderTarget(null);
            renderer.clear();

            postProcess.setUniform("part_tex", particleRT.texture);
            postProcess.setUniform("heightMap_tex", renderHeightmap.texture);
            renderer.render(postProcess.scene, postProcess.camera);
        },
    };
})();
