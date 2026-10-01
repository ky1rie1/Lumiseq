// src/engine/shaders/passColorCurve.ts
//! Pass 3: Color, HSL 8-Channel Mixer, Vibrance, and Tone Curve 1D LUT

export const COLOR_CURVE_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

export const COLOR_CURVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform bool u_curve_enabled;
uniform bool u_hsl_enabled;
uniform sampler2D u_curve_lut;         // 256x1 1D LUT texture (RGBA)
uniform float u_vibrance;              // -100 to +100
uniform float u_saturation;            // -100 to +100

// 8 HSL Channel deltas: [hue_shift, sat_factor, lum_shift]
// Red (0°), Orange (30°), Yellow (60°), Green (120°), Aqua (180°), Blue (240°), Purple (285°), Magenta (325°)
uniform vec3 u_hsl_red;
uniform vec3 u_hsl_orange;
uniform vec3 u_hsl_yellow;
uniform vec3 u_hsl_green;
uniform vec3 u_hsl_aqua;
uniform vec3 u_hsl_blue;
uniform vec3 u_hsl_purple;
uniform vec3 u_hsl_magenta;

// RGB to HSV conversion
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

// HSV to RGB conversion
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Circular shortest angular difference in degrees
float circDist(float a, float b) {
    float d = abs(a - b);
    return min(d, 360.0 - d);
}

// Cosine bell weight around channel center
float channelWeight(float hueDeg, float centerDeg, float widthDeg) {
    float dist = circDist(hueDeg, centerDeg);
    if (dist >= widthDeg) return 0.0;
    return 0.5 * (1.0 + cos((3.14159265359 * dist) / widthDeg));
}

vec3 linearToDisplay(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308,c));
}
vec3 displayToLinear(vec3 c) {
    c = max(c, vec3(0.0));
    return mix(c / 12.92, pow((c + 0.055)/1.055,vec3(2.4)),step(0.04045,c));
}

void main() {
    vec4 tex = texture(u_image, v_texCoord);
    vec3 color = tex.rgb;

    // 1. Tone Curve 1D LUT sampling (Master + R, G, B channels combined)
    // Lookup input color in [0.0, 1.0] across curve LUT texture
    if (u_curve_enabled) {
        vec3 display = linearToDisplay(color);
        vec3 uv = (clamp(display,0.0,1.0) * 1023.0 + 0.5) / 1024.0;
        vec3 mapped = vec3(texture(u_curve_lut,vec2(uv.r,0.5)).r,texture(u_curve_lut,vec2(uv.g,0.5)).g,texture(u_curve_lut,vec2(uv.b,0.5)).b) + max(display - 1.0, vec3(0.0));
        color = displayToLinear(mapped);
    }

    // 2. 8-Channel Circular HSL Mixer
    // Hue and value controls use extended display RGB; working storage stays linear.
    vec3 hsv = rgb2hsv(linearToDisplay(color));
    float hueDeg = hsv.x * 360.0;

    // Compute circular smooth weights for all 8 color channels
    float wRed     = channelWeight(hueDeg, 0.0, 45.0);
    float wOrange  = channelWeight(hueDeg, 30.0, 35.0);
    float wYellow  = channelWeight(hueDeg, 60.0, 40.0);
    float wGreen   = channelWeight(hueDeg, 120.0, 60.0);
    float wAqua    = channelWeight(hueDeg, 180.0, 50.0);
    float wBlue    = channelWeight(hueDeg, 240.0, 50.0);
    float wPurple  = channelWeight(hueDeg, 285.0, 45.0);
    float wMagenta = channelWeight(hueDeg, 325.0, 45.0);

    float totalW = wRed + wOrange + wYellow + wGreen + wAqua + wBlue + wPurple + wMagenta;
    if (u_hsl_enabled && totalW > 1e-4) {
        float hueShift = (
            wRed * u_hsl_red.x +
            wOrange * u_hsl_orange.x +
            wYellow * u_hsl_yellow.x +
            wGreen * u_hsl_green.x +
            wAqua * u_hsl_aqua.x +
            wBlue * u_hsl_blue.x +
            wPurple * u_hsl_purple.x +
            wMagenta * u_hsl_magenta.x
        ) / totalW;

        float satMultiplier = (
            wRed * u_hsl_red.y +
            wOrange * u_hsl_orange.y +
            wYellow * u_hsl_yellow.y +
            wGreen * u_hsl_green.y +
            wAqua * u_hsl_aqua.y +
            wBlue * u_hsl_blue.y +
            wPurple * u_hsl_purple.y +
            wMagenta * u_hsl_magenta.y
        ) / totalW;

        float lumShift = (
            wRed * u_hsl_red.z +
            wOrange * u_hsl_orange.z +
            wYellow * u_hsl_yellow.z +
            wGreen * u_hsl_green.z +
            wAqua * u_hsl_aqua.z +
            wBlue * u_hsl_blue.z +
            wPurple * u_hsl_purple.z +
            wMagenta * u_hsl_magenta.z
        ) / totalW;

        hsv.x = fract(hsv.x + (hueShift / 360.0));
        hsv.y = clamp(hsv.y * satMultiplier, 0.0, 1.0);
        hsv.z = max(0.0, hsv.z * (1.0 + lumShift));
        color = displayToLinear(hsv2rgb(hsv));
    }

    // 3. Vibrance (Skin-Aware Low-Saturation Protection)
    if (u_vibrance != 0.0) {
        float maxC = max(color.r, max(color.g, color.b));
        float minC = min(color.r, min(color.g, color.b));
        float currentSat = (maxC - minC) / max(1e-4, maxC);

        // Low saturation areas get boosted more; high saturation areas boosted less
        float boostFactor = (1.0 - currentSat) * (u_vibrance / 100.0);

        // Skin-aware hue detection: warm tones (orange/red) get reduced vibrance boost
        float isSkin = step(0.02, hsv.x) * (1.0 - step(0.12, hsv.x)); // Hue between 7° and 43°
        boostFactor *= mix(1.0, 0.45, isSkin);

        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        color = mix(vec3(luma), color, clamp(1.0 + boostFactor, 0.0, 2.5));
    }

    // 4. Global Saturation
    if (u_saturation != 0.0) {
        float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
        float satFactor = 1.0 + (u_saturation / 100.0);
        color = mix(vec3(luma), color, max(0.0, satFactor));
    }

    fragColor = vec4(max(vec3(0.0), color), tex.a);
}
`;
