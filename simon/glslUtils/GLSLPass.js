import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js";

export class GLSLPass {
  constructor(
    renderer,
    {
      fragmentShader,
      vertexShader = null,
      uniforms = {},
      width = window.innerWidth,
      height = window.innerHeight,
      format = THREE.RGBAFormat,
      type = THREE.HalfFloatType, //if we target phones - otherwise float, could this be checked automatically?
      wrapMode = "mirror", // 'clamp', 'mirror', 'repeat', 'zero'
      filterMode = "linear", // 'linear', 'nearest', 'mipmap'
      generateMipmaps = false,
      // numBuffers = 1,
    }
  ) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;

    const wrapModes = {
      clamp: THREE.ClampToEdgeWrapping,
      mirror: THREE.MirroredRepeatWrapping,
      repeat: THREE.RepeatWrapping,
      loop: THREE.RepeatWrapping,
      zero: THREE.ClampToEdgeWrapping,
    };

    let minFilter, magFilter;
    if (filterMode === "mipmap") {
      minFilter = THREE.LinearMipmapLinearFilter;
      magFilter = THREE.LinearFilter;
      generateMipmaps = true;
    } else if (filterMode === "nearest") {
      minFilter = THREE.NearestFilter;
      magFilter = THREE.NearestFilter;
    } else {
      // 'linear'
      minFilter = THREE.LinearFilter;
      magFilter = THREE.LinearFilter;
    }

    this.renderTarget = new THREE.WebGLRenderTarget(width, height, {
      format: format,
      type: type,
      minFilter: minFilter,
      magFilter: magFilter,
      wrapS: wrapModes[wrapMode] || THREE.ClampToEdgeWrapping,
      wrapT: wrapModes[wrapMode] || THREE.ClampToEdgeWrapping,
      generateMipmaps: generateMipmaps,
    });

    this.wrapMode = wrapMode;
    this.filterMode = filterMode;

    const defaultVertexShader = `
    in vec3 position;
    out vec2 vUV;

    void main() {
    vUV = position.xy * 0.5 + 0.5; // Convert from [-1,1] to [0,1]
    gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

    // Create material
    this.material = new THREE.RawShaderMaterial({
      vertexShader: vertexShader || defaultVertexShader,
      fragmentShader: fragmentShader,
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...uniforms,
        resolution: { value: new THREE.Vector2(width, height) },
        time: { value: 0 },
      },
    });

    // this.material.glslVersion = THREE.GLSL3;

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    // console.log('GLSLPass geometry attributes:', this.quad.geometry.attributes);
    this.scene.add(this.quad);
  }

  render() {
    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);

    if (this.renderTarget.texture.generateMipmaps) {
      this.renderer.initTexture(this.renderTarget.texture);
    }
  }

  get texture() {
    return this.renderTarget.texture;
  }

  setWrapMode(mode) {
    const wrapModes = {
      clamp: THREE.ClampToEdgeWrapping,
      mirror: THREE.MirroredRepeatWrapping,
      repeat: THREE.RepeatWrapping,
      loop: THREE.RepeatWrapping,
      zero: THREE.ClampToEdgeWrapping,
    };

    const wrap = wrapModes[mode] || THREE.ClampToEdgeWrapping;
    this.renderTarget.texture.wrapS = wrap;
    this.renderTarget.texture.wrapT = wrap;
    this.renderTarget.texture.needsUpdate = true;
    this.wrapMode = mode;
  }

  setFilterMode(mode) {
    let minFilter,
      magFilter,
      generateMipmaps = false;

    if (mode === "mipmap") {
      minFilter = THREE.LinearMipmapLinearFilter;
      magFilter = THREE.LinearFilter;
      generateMipmaps = true;
    } else if (mode === "nearest") {
      minFilter = THREE.NearestFilter;
      magFilter = THREE.NearestFilter;
    } else {
      // 'linear'
      minFilter = THREE.LinearFilter;
      magFilter = THREE.LinearFilter;
    }

    this.renderTarget.texture.minFilter = minFilter;
    this.renderTarget.texture.magFilter = magFilter;
    this.renderTarget.texture.generateMipmaps = generateMipmaps;
    this.renderTarget.texture.needsUpdate = true;
    this.filterMode = mode;
  }

  // Update a uniform
  setUniform(name, value) {
    if (this.material.uniforms[name]) {
      this.material.uniforms[name].value = value;
    }
  }

  // Add a new uniform
  addUniform(name, value) {
    this.material.uniforms[name] = { value: value };
  }

  // Resize the render target
  setSize(width, height) {
    this.width = width;
    this.height = height;
    this.renderTarget.setSize(width, height);
    this.material.uniforms.resolution.value.set(width, height);
  }

  dispose() {
    this.renderTarget.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
