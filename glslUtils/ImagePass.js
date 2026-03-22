import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.182.0/build/three.module.js";

export class ImagePass {
  constructor(
    path,
    {
      wrapMode = "clamp",
      filterMode = "linear",
      generateMipmaps = false,
      flipY = true,
    } = {},
  ) {
    this._texture = null;
    this._loaded = false;

    const wrapModes = {
      clamp: THREE.ClampToEdgeWrapping,
      mirror: THREE.MirroredRepeatWrapping,
      repeat: THREE.RepeatWrapping,
      loop: THREE.RepeatWrapping,
      zero: THREE.ClampToEdgeWrapping,
    };

    this.wrapMode = wrapMode;
    this.filterMode = filterMode;

    this.ready = new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(
        path,
        (tex) => {
          this._texture = tex;
          this._loaded = true;
          this._applyWrap(wrapMode, wrapModes);
          this._applyFilter(filterMode, generateMipmaps);
          tex.flipY = flipY;
          tex.needsUpdate = true;
          resolve(this);
        },
        undefined,
        reject,
      );
    });
  }

  get width() {
    return this._texture?.image.width ?? 0;
  }
  get height() {
    return this._texture?.image.height ?? 0;
  }

  _applyWrap(mode, wrapModes) {
    const wrap = wrapModes[mode] || THREE.ClampToEdgeWrapping;
    this._texture.wrapS = wrap;
    this._texture.wrapT = wrap;
  }

  _applyFilter(mode, generateMipmaps = false) {
    if (mode === "mipmap") {
      this._texture.minFilter = THREE.LinearMipmapLinearFilter;
      this._texture.magFilter = THREE.LinearFilter;
      this._texture.generateMipmaps = true;
    } else if (mode === "nearest") {
      this._texture.minFilter = THREE.NearestFilter;
      this._texture.magFilter = THREE.NearestFilter;
      this._texture.generateMipmaps = false;
    } else {
      this._texture.minFilter = THREE.LinearFilter;
      this._texture.magFilter = THREE.LinearFilter;
      this._texture.generateMipmaps = generateMipmaps;
    }
  }

  get texture() {
    return this._texture;
  }

  setWrapMode(mode) {
    if (!this._loaded) return;
    const wrapModes = {
      clamp: THREE.ClampToEdgeWrapping,
      mirror: THREE.MirroredRepeatWrapping,
      repeat: THREE.RepeatWrapping,
      loop: THREE.RepeatWrapping,
      zero: THREE.ClampToEdgeWrapping,
    };
    this._applyWrap(mode, wrapModes);
    this._texture.needsUpdate = true;
    this.wrapMode = mode;
  }

  setFilterMode(mode) {
    if (!this._loaded) return;
    this._applyFilter(mode);
    this._texture.needsUpdate = true;
    this.filterMode = mode;
  }

  dispose() {
    this._texture?.dispose();
  }
}

/*
const image = new ImagePass("./my-image.png", {
  wrapMode: "repeat",
  filterMode: "mipmap",
});

// Await loading before using the texture
await image.ready;

// Use exactly like a GLSLPass
someGLSLPass.setUniform("uTexture", image.texture);

// Adjust after the fact
image.setWrapMode("mirror");
image.setFilterMode("nearest");
*/
