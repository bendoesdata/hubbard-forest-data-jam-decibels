precision highp float;
in vec2 vUV;

uniform sampler2D image_tex;
uniform vec2 u_resolution;
uniform int u_radius;
uniform float u_preshrink, u_smallDetail, u_amp;

out vec4 fragColor;
void main() {
    vec2 texelSize = 1.0 / u_resolution;
    float cleanTex = texture(image_tex, vUV.xy).x;
    vec2 u = abs(vUV.xy * 2.0 - 1.0);
    float s = smoothstep(0.9999, 0.1, max(u.x, u.y));
    if(cleanTex * s < 1. / 256.) {
        discard;
    }
    float color = (0.0);
    int diameter = 2 * u_radius + 1;
    float weight = 1.0 / float(diameter * diameter);

    for(int y = -10; y <= 10; y++) {
        if(y < -u_radius || y > u_radius)
            continue;
        for(int x = -10; x <= 10; x++) {
            if(x < -u_radius || x > u_radius)
                continue;
            vec2 offset = vec2(float(x), float(y)) * texelSize;
            color += textureLod(image_tex, vUV.xy + offset, u_preshrink).x * weight;
        }
    }

    color += (cleanTex - color) * u_smallDetail;
    color *= u_amp;
	//color *= step(0.0001, color * s);

    fragColor = vec4(color, color, color, 1);
}