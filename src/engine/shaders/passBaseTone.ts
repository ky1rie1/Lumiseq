// src/engine/shaders/passBaseTone.ts
//! Pass 1: Decode & Base Photographic Toning
//! Photographic EV exposure in linear space, soft-knee highlights/shadows, whites/blacks, and guarded white balance.

export const BASE_TONE_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

export const BASE_TONE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform int u_input_linear;           // 1: native RGBA16 working data, 0: display sRGB
uniform int u_rendering_version;
uniform float u_exposure;              // EV: linearRGB * 2^EV
uniform float u_contrast;              // -100 to +100
uniform float u_highlights;            // -100 to +100 (soft-knee shoulder)
uniform float u_shadows;               // -100 to +100 (soft-knee toe)
uniform float u_whites;                // -100 to +100 (highlight endpoint dynamic range)
uniform float u_blacks;                // -100 to +100 (shadow endpoint dynamic range)
uniform vec3 u_camera_wb;              // [r/g, 1.0, b/g] camera multipliers
uniform int u_wb_mode;                 // 0: as-shot, 1: custom, 2: auto
uniform int u_white_balance_applied;   // 1 if input image already has camera WB, 0 if native sensor linear
uniform mat3 u_wb_matrix;             // Relative Bradford adaptation in linear sRGB

// Accurate sRGB to Linear EOTF
vec3 sRGBToLinear(vec3 srgb) {
    vec3 c = max(srgb, vec3(0.0));
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
// GLSL has no log1p/expm1; series avoid cancelling sub-display working values.
float logOnePlus(float x) {
    return x < .01 ? x*(1.0-x*.5+x*x/3.0-x*x*x*.25) : log(1.0+x);
}
float expMinusOne(float x) {
    return x < .01 ? x*(1.0+x*.5+x*x/6.0+x*x*x/24.0) : exp(x)-1.0;
}

void main() {
    // DOM images and ImageBitmap upload top-down; normalize once before FBO passes.
    vec4 tex = texture(u_image, vec2(v_texCoord.x, 1.0 - v_texCoord.y));
    vec3 linear = u_input_linear == 1 ? tex.rgb : sRGBToLinear(tex.rgb);

    // 1. RAW White Balance (Guarded against double multiplication)
    if (u_white_balance_applied == 0) {
        // Native sensor linear: apply camera As-Shot sensor multipliers exactly once
        linear *= u_camera_wb;
    }
    if (u_wb_mode == 1 || u_wb_mode == 2) {
        // Custom Kelvin/tint adaptation or persisted postdecode automatic correction
        float beforeY = dot(linear, vec3(0.2126, 0.7152, 0.0722));
        linear = u_wb_matrix * linear;
        float afterY = dot(linear, vec3(0.2126, 0.7152, 0.0722));
        if (afterY > 1e-8) linear *= beforeY / afterY;
    }

    // 2. Photographic EV Exposure: strictly linear * 2^(EV)
    linear *= pow(2.0, u_exposure);

    // 3. Luminance calculation (Rec.709 coefficients)
    float luma = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    if (u_rendering_version == 2) {
        float y = abs(luma);
        float sourceY = y;
        y *= exp(u_blacks / 100.0 * log(2.0) / (1.0 + y / 0.18));
        y *= exp(u_whites / 100.0 * log(2.0) * y / (y + 0.5));
        if (u_contrast != 0.0) y = 0.18 * expMinusOne(logOnePlus(y / 0.18) * exp2(u_contrast / 100.0));
        y *= exp(u_shadows / 100.0 * 0.75 / (1.0 + y / 0.18));
        if (u_highlights < 0.0) {
            float d = max(0.0, y - 0.35);
            y = min(y, 0.35) + d / (1.0 - u_highlights / 100.0 * 1.5 * d);
        } else if (u_highlights > 0.0) y *= 1.0 + u_highlights / 100.0 * 0.75 * y / (y + 0.55);
        float gain = sourceY > 1e-12 ? y / sourceY : exp2(u_contrast / 100.0) * exp(u_blacks / 100.0 * log(2.0) + u_shadows / 100.0 * 0.75);
        fragColor = vec4(linear * gain, tex.a);
        return;
    }

    // 4. Continuous Soft-Knee Highlights & Shadows (No hard threshold, continuous C1)
    if (u_shadows != 0.0) {
        // Soft-knee shadow mask: smoothly decays from 1.0 at black to 0.0 near midtones
        float shadowWeight = 1.0 / (1.0 + exp((luma - 0.25) * 12.0));
        linear += linear * (u_shadows / 100.0) * shadowWeight * 0.75;
    }
    if (u_highlights != 0.0) {
        // Soft-knee highlight mask: smoothly rises from midtones to shoulder
        float highlightWeight = 1.0 / (1.0 + exp(-(luma - 0.55) * 10.0));
        linear += linear * (u_highlights / 100.0) * highlightWeight * 0.75;
    }

    // 5. Whites & Blacks (Upper shoulder & lower toe endpoint dynamic range expansion)
    if (u_whites != 0.0) {
        float whiteWeight = pow(clamp(luma, 0.0, 1.0), 2.0);
        linear += linear * (u_whites / 100.0) * whiteWeight * 0.6;
    }
    if (u_blacks != 0.0) {
        float blackWeight = pow(1.0 - clamp(luma, 0.0, 1.0), 2.0);
        linear *= pow(2.0, (u_blacks / 100.0) * blackWeight);
    }

    // 6. Contrast centered around middle gray (0.18 in linear)
    if (u_contrast != 0.0) {
        float toneY = dot(linear, vec3(0.2126, 0.7152, 0.0722));
        if (toneY > 1e-8) {
            float targetY = 0.18 * pow(toneY / 0.18, pow(2.0, u_contrast / 100.0));
            linear *= targetY / toneY;
        }
    }

    fragColor = vec4(linear, tex.a);
}
`;
