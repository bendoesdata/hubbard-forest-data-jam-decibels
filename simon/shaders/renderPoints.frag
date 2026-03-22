precision highp float;
in float discardables;
in float life;
in float idHash;

out vec4 fragColor;

void main() {

    if(discardables < 0.5) {
        discard;
    }

    float lifeFade = sin(life * 3.14159);
    vec3 col = mix(vec3(1), vec3(0.1, 0.2, 1.0), idHash);
    col *= lifeFade;
    fragColor = clamp(vec4(col, 0.2), vec4(0.0), vec4(1));// * sqrt(sin(life * 3.14159)));

}