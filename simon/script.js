import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js";
import { GLSLPass } from "./glslUtils/GLSLPass.js";
import { FeedbackLoop } from "./glslUtils/FeedbackLoop.js";
import { ImagePass } from "./glslUtils/ImagePass.js";

//tweakable params TWEAK THESE PRIMARILLY AT RUNTIME
let floodAmt = 0.2;
let floodSpeed = 0.5;
let particleCount = 0.3;

const ambientLight = 0.1;
let lightIntensity = 2.2;
let lightHeight = 0.55; //the height of the mouse away from the surface

// ------PARAMETERS-----//
//values with a const are "baked" meaning they can't be controlled by a slider and are created on set-up and can't be changed at runtime
//this allows us to use a high res DEM and not worry about it impacting performance - only load-time
const mapHeight = 0.65;
const blurRadius = 2;
const blurPreshrink = 0;
const smallDetail = 0.5;
const monitorPerformance = true;
const maxParticlesSqrt = 512; //this value gets squared 256 - 1024
const blurPreshrinkFF = 0;
const blurRadiusFF = 9;

//LIGHT AND SHADING

let USE_MOUSE = true;
let lerpFactor = 0.05; // smooths out the mouse mmovement. lower val = smoohter
particleCount = particleCount ** 2;
//------------//
let lightPos = new THREE.Vector3(0.15, 0.25, lightHeight);
let targetLightPos = new THREE.Vector3(lightPos.x, lightPos.y, lightPos.z); //needed for lerp-smoothing don't touch
//---------------//

async function loadShader(path) {
  const response = await fetch(path);
  return await response.text();
}

const DEM_PATH = "./assets/dem.png";
const boxBlurPath = await loadShader("./shaders/boxBlur.frag");
const normalPassPath = await loadShader("./shaders/normalPass.frag");
const renderHeightmapPath = await loadShader("./shaders/renderHeightmap.frag");
const posSolverPass = await loadShader("./shaders/posSolver.frag");
const instancingVert = await loadShader("./shaders/renderPoints.vert");
const instancingFrag = await loadShader("./shaders/renderPoints.frag");
const trailDecayShader = await loadShader("./shaders/trailDecay.frag");
const postProcessShader = await loadShader("./shaders/postProcess.frag");

const initPPath = await loadShader("./shaders/initP.frag");

const DEM_IMG = new ImagePass(DEM_PATH, {
  wrapMode: "repeat",
  filterMode: "mipmap",
  generateMipmaps: true,
  format: THREE.RGBAFormat,
  type: THREE.HalfFloatType,
});
await DEM_IMG.ready;

const imgRes = new THREE.Vector2(DEM_IMG.width, DEM_IMG.height);
const imgAspect = imgRes.x / imgRes.y;
const halfRes = new THREE.Vector2(DEM_IMG.width / 2.0, DEM_IMG.height / 2.0);
const quarterRes = new THREE.Vector2(DEM_IMG.width / 4.0, DEM_IMG.height / 4.0);

let zHeight = 1 / mapHeight / quarterRes.y;

//--------------------------------------//

const canvas = document.getElementById("artwork");
const renderer = new THREE.WebGLRenderer();
const scene = new THREE.Scene();
document.getElementById("artwork").appendChild(renderer.domElement);
//---aspect stuff---// this might need to be changed dpd on use case etc

let width = canvas.clientWidth;
let height = canvas.clientHeight;
let aspect = width / height;
let renderAspect = aspect;

renderer.setSize(width, height);

//--------//-------//

//-------INSTANCING SETUP-----//
function getOrthoBounds(renderAspect, imgAspect) {
  if (imgAspect > renderAspect) {
    // image is wider — pillarbox: fit width, crop height
    const h = imgAspect / renderAspect;
    return { left: -imgAspect, right: imgAspect, top: h, bottom: -h };
  } else {
    // image is taller — letterbox: fit height, crop width
    const w = renderAspect;
    return { left: -w, right: w, top: 1, bottom: -1 };
  }
}

function updateCamera() {
  const b = getOrthoBounds(aspect, imgAspect);
  camera.left = b.left;
  camera.right = b.right;
  camera.top = b.top;
  camera.bottom = b.bottom;
  camera.updateProjectionMatrix();
}

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.set(0, 0, 1);
camera.lookAt(0, 0, 0);
scene.add(camera);
updateCamera(); // apply correct bounds immediately

//--------PASSES-----------//

const boxBlurPass = new GLSLPass(renderer, {
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

const normalPass = new GLSLPass(renderer, {
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

const renderHeightmap = new GLSLPass(renderer, {
  fragmentShader: renderHeightmapPath,
  uniforms: {
    u_renderAspect: { value: renderAspect },
    u_imgAspect: { value: imgAspect },
    normal_tex: { value: normalPass.texture },
    u_sunPos: { value: lightPos },
    u_zHeight: { value: zHeight },
    u_time: { value: 0.0 },
    u_flood: { value: floodAmt },
    u_ambientLight: { value: ambientLight },
    u_lightIntensity: { value: lightIntensity },
  },
  width: width,
  height: height,
});

const boxBlurFlowFieldPass = new GLSLPass(renderer, {
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
  type: THREE.HalfFloatType,
  generateMipmaps: true,
});
boxBlurFlowFieldPass.render();

const initPPass = new GLSLPass(renderer, {
  fragmentShader: initPPath,
  uniforms: {
    u_partAmt: { value: particleCount },
    u_mouse: { value: [lightPos.x, lightPos.y] },
  },
  width: maxParticlesSqrt,
  height: maxParticlesSqrt,
});

initPPass.render(); //create an updateInitP function that changes uniform and calls render()

const posFeedback = new FeedbackLoop(renderer, null, {
  width: maxParticlesSqrt,
  height: maxParticlesSqrt,
});

const posSolver = new GLSLPass(renderer, {
  fragmentShader: posSolverPass,
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

//-------INSTANACE MATERIAL-----//
const pointCount = maxParticlesSqrt * maxParticlesSqrt;

const geometry = new THREE.BufferGeometry();
const positions = new Float32Array([0, 0, 0]);
geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

const instancedGeometry = new THREE.InstancedBufferGeometry();
instancedGeometry.index = geometry.index;
instancedGeometry.attributes.position = geometry.attributes.position;
instancedGeometry.instanceCount = pointCount;

const instancedMaterial = new THREE.RawShaderMaterial({
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

//-----POSTPROCESS
const particleRT = new THREE.WebGLRenderTarget(width, height, {
  format: THREE.RGBAFormat,
  type: THREE.HalfFloatType,
});

const trailFeedback = new FeedbackLoop(renderer, null, {
  width: width,
  height: height,
  format: THREE.RGBAFormat,
  type: THREE.HalfFloatType,
});

const trailDecayPass = new GLSLPass(renderer, {
  fragmentShader: trailDecayShader,
  uniforms: {
    col_tex: { value: null },
    fb_tex: { value: trailFeedback.texture },
    u_resolution: { value: [width, height] },
    u_decay: { value: 0.99 }, // tweak: 0.85–0.97
  },
  width: width,
  height: height,
});

trailFeedback.sourcePass = trailDecayPass;

const postProcess = new GLSLPass(renderer, {
  fragmentShader: postProcessShader,
  uniforms: {
    part_tex: { value: trailDecayPass.texture },
    heightMap_tex: { value: renderHeightmap.texture },
  },
  width: width,
  height: height,
});

//------------ANIMATION LOOP-----------//
let deltaTime = 1.0 / 60.0;
let lastTime = 0;
let frameCount = 0;
let fpsInterval = 1000;
let lastFpsLog = performance.now();
let initialized = true;
let floodTime = 0.0;

function animate(time) {
  time *= 0.001;
  floodTime += floodSpeed * deltaTime;
  lightPos.lerp(targetLightPos, lerpFactor);

  initPPass.setUniform("u_mouse", [lightPos.x, lightPos.y]);
  initPPass.setUniform("u_partAmt", particleCount);
  initPPass.render();

  frameCount++;
  if (initialized) {
    posSolver.setUniform("fb_tex", initPPass.texture);
    initialized = false;
  } else {
    posSolver.setUniform("fb_tex", posFeedback.texture);
  }

  posSolver.setUniform("u_time", time);
  posSolver.render();
  posFeedback.capture();
  instancedMaterial.uniforms.pos_tex.value = posSolver.texture;
  if (monitorPerformance) {
    // FPS tracking

    const now = performance.now();
    const elapsed = now - lastFpsLog;
    if (elapsed >= fpsInterval) {
      const fps = Math.round((frameCount * 1000) / elapsed);
      console.log(`${fps}`);
      frameCount = 0;
      lastFpsLog = now;
    }
  }

  renderHeightmap.setUniform("u_time", floodTime);
  renderHeightmap.setUniform("u_sunPos", lightPos);
  renderHeightmap.render();

  renderer.setRenderTarget(particleRT);
  renderer.clear();
  renderer.render(scene, camera);

  // trailDecayPass.setUniform("col_tex", particleRT.texture);
  // trailDecayPass.setUniform("fb_tex", trailFeedback.texture);
  // trailDecayPass.render();

  // trailFeedback.capture();

  renderer.setRenderTarget(null);
  renderer.clear();

  postProcess.setUniform("part_tex", particleRT.texture);
  postProcess.setUniform("heightMap_tex", renderHeightmap.texture);

  // i only want to render this when u_partAmt is updated not every frame

  renderer.render(postProcess.scene, postProcess.camera);
  //renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

console.log(
  imgRes.x + " x " + imgRes.y,
  halfRes.x + " x " + halfRes.y,
  quarterRes.x + " x " + quarterRes.y,
);

console.log(imgAspect, renderAspect);

window.addEventListener("resize", () => {
  document.querySelector("#artwork").style.width = "100vw";
  document.querySelector("#artwork").style.height = "100vh";

  width = canvas.clientWidth;
  height = canvas.clientHeight;
  aspect = width / height;
  renderAspect = aspect;

  renderer.setSize(width, height);
  updateCamera();

  // Render targets
  renderHeightmap.setSize(width, height);
  particleRT.setSize(width, height);

  trailFeedback.setSize(width, height);
  trailDecayPass.setSize(width, height);
  postProcess.setSize(width, height);

  // Uniforms
  renderHeightmap.setUniform("u_renderAspect", aspect);
  trailDecayPass.setUniform("u_resolution", [width, height]);

  console.log(width, height);
});

canvas.addEventListener("mousemove", (e) => {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;

  if (USE_MOUSE) {
    targetLightPos.x = x;
    targetLightPos.y = -y;
  }
});
