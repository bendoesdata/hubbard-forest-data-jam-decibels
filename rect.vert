// Vertex shader — simple passthrough
// Positions a fullscreen quad and passes UV coordinates to the fragment shader

attribute vec3 aPosition;
attribute vec2 aTexCoord;

varying vec2 vUV;

void main() {
    // Pass texture coordinates to fragment shader (0-1 range)
    vUV = aTexCoord;

    // Position the vertex (clip space: -1 to 1)
    gl_Position = vec4(aPosition * 2.0 - 1.0, 1.0);
}
