precision highp float;
in vec2 vUV;

uniform sampler2D heightMap_tex;
uniform float u_zHeight;

vec2 slope(sampler2D tex, vec2 uv) {
    float r = textureOffset(tex, uv, ivec2(1, 0)).x;
    float l = textureOffset(tex, uv, ivec2(-1, 0)).x;
    float t = textureOffset(tex, uv, ivec2(0, 1)).x;
    float b = textureOffset(tex, uv, ivec2(0, -1)).x;

    return vec2(r - l, t - b);
}

vec3 getNormal(sampler2D tex, vec2 uv, float zHeight) {

    return normalize(vec3(-slope(tex, uv), zHeight));
}

out vec4 fragColor;
void main() {
    vec2 hInfos = texture(heightMap_tex, vUV.st).xw;
    if(hInfos.y < 0.5) {
        discard;
    }

    vec4 color = vec4(getNormal(heightMap_tex, vUV.xy, u_zHeight) * 0.5 + 0.5, hInfos.x);
    fragColor = (color);
}
