import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js";

export class FeedbackLoop {
  constructor(
    renderer,
    sourcePass,
    {
      width = window.innerWidth,
      height = window.innerHeight,
      format = THREE.RGBAFormat,
      type = THREE.HalfFloatType,
    } = {}
  ) {
    this.renderer = renderer;
    this.sourcePass = sourcePass;
    this.width = width;
    this.height = height;

    // Create two render targets for ping-pong buffering
    const rtOptions = {
      format: format,
      type: type,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };

    this.readBuffer = new THREE.WebGLRenderTarget(width, height, rtOptions);
    this.writeBuffer = new THREE.WebGLRenderTarget(width, height, rtOptions);

    const fragmentShader = `
    precision highp float;
      uniform sampler2D u_texture;
      in vec2 vUV;
      out vec4 fragColor;
      void main() {
        fragColor = texture(u_texture, vUV);
      }
    `;

    const vertexShader = `
    in vec3 position;
    out vec2 vUV;

    void main() {
    vUV = position.xy * 0.5 + 0.5; // Convert from [-1,1] to [0,1]
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      uniforms: {
        u_texture: { value: null },
      },
    });

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.quad);
  }

  // Capture the current frame from source
  capture() {
    this.material.uniforms.u_texture.value = this.sourcePass.texture;

    this.renderer.setRenderTarget(this.writeBuffer);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    // this.renderer.getContext().flush(); //THIS IS NEW DOES IT HELP?

    this.swap();
  }

  // Swap read and write buffers
  swap() {
    const temp = this.readBuffer;
    this.readBuffer = this.writeBuffer;
    this.writeBuffer = temp;

    // this.readBuffer.texture.needsUpdate = true;
  }

  // Get the previous frame's texture
  get texture() {
    return this.readBuffer.texture;
  }

  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.readBuffer.setSize(width, height);
    this.writeBuffer.setSize(width, height);
  }

  // Clear feedback (reset to black)
  clear() {
    this.renderer.setRenderTarget(this.readBuffer);
    this.renderer.clear();
    this.renderer.setRenderTarget(this.writeBuffer);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);
  }

  dispose() {
    this.readBuffer.dispose();
    this.writeBuffer.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
