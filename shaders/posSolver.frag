precision highp float;

in vec2 vUV;

uniform sampler2D fb_tex, initP_tex, heightMap_tex;

uniform float u_aspect;
uniform float u_time;

uvec2 murmurHash22(uvec2 src) {
    const uint M = 0x5bd1e995u;
    uvec2 h = uvec2(1190494759u, 2147483647u);
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

// 2 outputs, 2 inputs
vec2 hash22(vec2 src) {
    uvec2 h = murmurHash22(floatBitsToUint(src));
    return uintBitsToFloat(h & 0x007fffffu | 0x3f800000u) - 1.0;
}

vec2 slope(sampler2D tex, vec2 uv, float lod) {
    vec2 o = 1.0 / vec2(textureSize(tex, 0));
    float r = textureLod(tex, uv + vec2(o.x, 0.0), lod).x;
    float l = textureLod(tex, uv + vec2(-o.x, 0.0), lod).x;
    float t = textureLod(tex, uv + vec2(0.0, o.y), lod).x;
    float b = textureLod(tex, uv + vec2(0.0, -o.y), lod).x;
    return vec2(r - l, t - b);
}




out vec4 fragColor;
void main() {
    vec4 infos = texture(fb_tex, vUV.xy);
    vec2 p = infos.xy;
    float life = infos.w;
    vec4 initInfo = texture(initP_tex, vUV.xy);
    vec2 initP = initInfo.xy;
    float isactive = infos.b;

    float initActive = initInfo.b;
    float speed = 0.5 * hash22(vUV.xy * 5.0).x + 0.3;
    life += 0.005 * speed * (hash22(vUV.xy).x * 0.8 + 0.2);
    bool dead = life > 1.0;

    life = dead ? 0.0 : life;
    p = dead ? initP : p;
    isactive = dead ? initActive : isactive;

	//p += (hash22(vUV.xy + u_frame) * 2.0 - 1.0) * 0.001;
    vec2 grad = -slope(heightMap_tex, p, 0.0) * 0.5;

    vec2 vel = grad;
    float h = texture(heightMap_tex, p).x;

    float discardable;// = isactive;
    discardable = h > 0.001 ? 1.0 : 0.0;
    discardable = isactive * discardable * float(length(vel) > 0.0001);


    vel += 0.001 * (hash22(vUV.xy + 22.2221 + fract(u_time * 0.1)) * 2.0 - 1.0);

    p += vel * vec2(1.0 / u_aspect, 1) * speed * 0.7;
    vec4 color = vec4(p, discardable, life);

    fragColor = (color);
}
