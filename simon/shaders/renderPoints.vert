precision highp float;
in vec3 position;
out float discardables;
out float life;
out float idHash;

uniform sampler2D pos_tex;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform vec3 cameraPosition;
uniform float u_imgAspect;

uint murmurHash11(uint src) {
    const uint M = 0x5bd1e995u;
    uint h = 1190494759u;
    src *= M;
    src ^= src >> 24u;
    src *= M;
    h *= M;
    h ^= src;
    h ^= h >> 13u;
    h *= M;
    h ^= h >> 15u;
    return h;
}

// 1 output, 1 input
float hash11(float src) {
    uint h = murmurHash11(floatBitsToUint(src));
    return uintBitsToFloat(h & 0x007fffffu | 0x3f800000u) - 1.0;
}

void main() {
    int id = gl_InstanceID;
    idHash = hash11(float(id)) * 1.0;
    gl_PointSize = 1.0 + idHash;

    ivec2 tex_res = textureSize(pos_tex, 0);
    ivec2 texelID = ivec2(id % tex_res.x, id / tex_res.x);
    vec4 infos = texelFetch(pos_tex, texelID, 0);

    discardables = infos.z;
    discardables = abs(infos.y * 2.0 - 1.0) > 1.0 || abs(infos.x * 2.0 - 1.0) > 1.0 ? 0.0 : discardables;
    life = infos.w;

    vec2 pos = infos.xy * 2.0 - 1.0;
    pos.x *= u_imgAspect;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 0.0, 1.0);
}