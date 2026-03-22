precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D heightMap_tex;
uniform sampler2D part_tex;
uniform float u_decay;

vec4 over(vec4 fg, vec4 bg) {
    return fg + bg * (1.0 - fg.a);
}

void main() {

    vec4 hmCol = texture(heightMap_tex, vUV.xy).rgba;
    vec4 partCol = texture(part_tex, vUV.xy).rgba;

    vec4 color = partCol + hmCol;

    color.rgb = pow(color.rgb, vec3(0.454545));
    color.rgb = tanh(color.rgb * 1.0);
    fragColor = color;
}
