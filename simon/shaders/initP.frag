precision highp float;
in vec2 vUV;

uvec4 murmurHash42(uvec2 src) {
    const uint M = 0x5bd1e995u;
    uvec4 h = uvec4(1190494759u, 2147483647u, 3559788179u, 179424673u);
    src *= M;
    src ^= src >> 24u;
    src *= M;
    h *= M;
    h ^= src.x;
    h *= M;
    h ^= src.y;
    h ^= h >> 13u;
    h *= M;
    h ^= h >> 15u;
    return h;
}

// 4 outputs, 2 inputs
vec4 hash42(vec2 src) {
    uvec4 h = murmurHash42(floatBitsToUint(src));
    return uintBitsToFloat(h & 0x007fffffu | 0x3f800000u) - 1.0;
}
uniform vec2 u_mouse;
uniform float u_partAmt;

out vec4 fragColor;
void main() {
    vec2 uv = vUV.xy;
    vec4 r = hash42(vUV.xy);
    vec4 color = r;

    //uv = color.rg * 2.0 - 1.0;
   // float l = smoothstep(0.1, 0.0, distance(uv, u_mouse));
    color.b = step(r.b, u_partAmt);

    fragColor = (color);
}
