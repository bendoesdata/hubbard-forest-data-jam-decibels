precision highp float;
in vec2 vUV;

uniform sampler2D normal_tex;
uniform float u_renderAspect, u_imgAspect, u_zHeight, u_time, u_flood, u_ambientLight, u_lightIntensity;
uniform vec3 u_sunPos;

vec4 textureFitBest(sampler2D tex, inout vec2 uv, float inputAspect, float targetAspect, inout float alpha) {
    float scale = 1.0;
    uv = (uv - 0.5) * scale + 0.5;
    if(inputAspect > targetAspect) {
        float scaledHeight = targetAspect / inputAspect;
        float centeredV = (uv.y - 0.5) / scaledHeight + 0.5;

        vec2 newUV = vec2(uv.x, centeredV);

        if(centeredV < 0.0 || centeredV > 1.0) {
            alpha = 0.0;
        }
        return texture(tex, newUV);
        uv = newUV;
    } else {
        float scaledWidth = inputAspect / targetAspect;
        float centeredU = (uv.x - 0.5) / scaledWidth + 0.5;
        if(centeredU < 0.0 || centeredU > 1.0) {
            alpha = 0.0;
        }
        return texture(tex, vec2(centeredU, uv.y));
        uv = vec2(centeredU, uv.y);
    }
}

vec4 textureFitBestHack(sampler2D tex, in vec2 uv, float inputAspect, float targetAspect) {
    float scale = 1.0;
    float alpha = 1.0;
    uv = (uv - 0.5) * scale + 0.5;
    if(inputAspect > targetAspect) {
        float scaledHeight = targetAspect / inputAspect;
        float centeredV = (uv.y - 0.5) / scaledHeight + 0.5;

        vec2 newUV = vec2(uv.x, centeredV);

        if(centeredV < 0.0 || centeredV > 1.0) {
            alpha = 0.0;
        }
        return texture(tex, newUV);
        uv = newUV;
    } else {
        float scaledWidth = inputAspect / targetAspect;
        float centeredU = (uv.x - 0.5) / scaledWidth + 0.5;
        if(centeredU < 0.0 || centeredU > 1.0) {
            alpha = 0.0;
        }
        return texture(tex, vec2(centeredU, uv.y));
        uv = vec2(centeredU, uv.y);
    }
}

vec2 screenToWorld(vec2 mouseNDC, float renderAspect, float imgAspect) {
    vec2 p = mouseNDC;

    if(imgAspect > renderAspect) {
        float scaledHeight = renderAspect * imgAspect;
        p.y *= scaledHeight;
    } else {
        float scaledWidth = imgAspect / renderAspect;
        p.x *= scaledWidth * renderAspect;
    }

    p *= vec2(renderAspect, 1.0);

    return p;
}

float sq(vec2 p, vec2 s) {
    float d = max(abs(p.x) - s.x, abs(p.y) - s.y);

    return smoothstep(0.0, fwidth(d), d);

}

vec2 slope(sampler2D tex, vec2 uv) {
    const float texel = 0.01;
    float alpha = 0.0;
    vec2 e = vec2(texel, 0.0);

    float r = textureFitBestHack(tex, uv + e.xy, u_imgAspect, u_renderAspect).x;
    float l = textureFitBestHack(tex, uv - e.xy, u_imgAspect, u_renderAspect).x;
    float t = textureFitBestHack(tex, uv + e.yx, u_imgAspect, u_renderAspect).x;
    float b = textureFitBestHack(tex, uv - e.yx, u_imgAspect, u_renderAspect).x;

    return vec2(r - l, t - b);
}

out vec4 fragColor;
void main() {

    vec2 mouseP = (screenToWorld(u_sunPos.xy, u_renderAspect, u_imgAspect)) * 1.0;

    vec2 uv = vUV.xy;

    float alpha = 1.0;
    vec4 infos = textureFitBest(normal_tex, uv, u_imgAspect, u_renderAspect, alpha);
    infos *= smoothstep(0.1, 0.15, infos.w);
    if(infos.w < 1.0 / 256.0) {
        alpha = 0.0;
    }

    vec3 normal = infos.xyz * 2.0 - 1.0;
    float height = infos.w;

    float isBodyOfWater = smoothstep(0.55, 0.5, height + vUV.x * 0.3);

    float flood = abs(sin((height) * 3.14159 * 0.5 + u_time));
    flood = clamp(flood + u_flood * 2.0 - 1.0, 0.0, 1.0);

    vec3 worldPos = vec3((uv.xy * 2.0 - 1.0) * vec2(u_renderAspect, 1.0), height * u_zHeight);

    vec3 viewVec = normalize(vec3(0, 0, 1) + vec3(uv * 2.0 - 1.0, 0) * 1.0);
    vec3 lp = vec3(mouseP, u_sunPos.z);
    vec3 lDir = normalize(lp - worldPos);

    float NoL = max(dot(lDir, normalize(normal)), u_ambientLight) * 0.5;
    vec3 halfVec = normalize(lDir + viewVec);
    float NoH = pow(max(dot(halfVec, normal), 0.0), 32.0);

    float lightAtten = exp(-max(distance(worldPos, lp) - 0.4, 0.001) * 3.0);

    vec3 col = vec3(0);
    col += 1.0;
    col *= mix(vec3(1), vec3(0.0, 0.0, 0.0), smoothstep(0.9, 1.0, sin(height * 50.0) * 1.0 - height));

    //float gradMag = length(slope(normal_tex, vUV.xy));
   // gradMag = smoothstep(0.1, 0.5, gradMag);
   // col = mix(col, vec3(0.102, 0.1373, 0.2824), gradMag * 0.5);

    col = mix(col, vec3(0.05, 0.1, 0.5), flood);
    float lightContritb = NoL * 0.75 + NoH * 0.25;

    col *= lightContritb * lightAtten * u_lightIntensity;
    //col *= infos.w * (1.0 - flood);
    


  

    fragColor = vec4(col * alpha, alpha);

   
}
