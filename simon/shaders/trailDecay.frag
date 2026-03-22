precision highp float;
in vec2 vUV;
out vec4 fragColor;

vec4 over(vec4 fg, vec4 bg) {
    return fg + bg * (1.0 - fg.a);
}

uniform sampler2D col_tex;
uniform sampler2D fb_tex;
uniform float u_decay;
void main() {
    vec4 prev = texture(fb_tex, vUV.xy) * u_decay;
    vec4 cur = texture(col_tex, vUV.xy);
    fragColor = cur;
}
