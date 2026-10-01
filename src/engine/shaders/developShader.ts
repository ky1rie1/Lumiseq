// src/engine/shaders/developShader.ts

export const VERTEX_SHADER_SOURCE = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform float u_exposure;     // EV (-5.0 to +5.0) - linearRGB * 2^EV in working space
uniform float u_contrast;     // -100 to +100
uniform float u_temperature;  // Kelvin (2000 to 12000), 5500 is neutral
uniform float u_tint;         // -150 to +150 (green to magenta)
uniform float u_saturation;   // -100 to +100
uniform float u_highlights;   // -100 to +100
uniform float u_shadows;      // -100 to +100
uniform vec3 u_camera_wb;     // Camera sensor As-Shot multipliers [r/g, 1.0, b/g]
uniform int u_wb_mode;        // 0: as-shot, 1: custom, 2: auto

// sRGB to Linear
vec3 sRGBToLinear(vec3 srgb) {
    return pow(max(srgb, vec3(0.0)), vec3(2.2));
}

// Linear to sRGB
vec3 linearTosRGB(vec3 linear) {
    return pow(max(linear, vec3(0.0)), vec3(1.0 / 2.2));
}

// Custom White Balance (Planckian locus adjustment)
vec3 applyWhiteBalance(vec3 linear, float tempK, float tintVal) {
    // 5500K is neutral daylight reference
    float tempDiff = (tempK - 5500.0) / 4500.0;
    float rScale = 1.0 + tempDiff * 0.4;
    float bScale = 1.0 - tempDiff * 0.4;
    float gScale = 1.0 - (tintVal / 150.0) * 0.2;
    float mScale = 1.0 + (tintVal / 150.0) * 0.2;

    vec3 wb = vec3(
        linear.r * max(0.1, rScale),
        linear.g * max(0.1, gScale),
        linear.b * max(0.1, bScale)
    );
    wb.r *= mScale;
    wb.b *= mScale;
    return wb;
}

void main() {
    vec4 tex = texture(u_image, v_texCoord);
    vec3 linear = sRGBToLinear(tex.rgb);

    // 1. White Balance
    if (u_wb_mode == 0) {
        // Camera As-Shot sensor multipliers
        linear *= u_camera_wb;
    } else {
        // Custom Kelvin & Tint
        linear = applyWhiteBalance(linear, u_temperature, u_tint);
    }

    // 2. Photographic Exposure: linear * 2^(EV)
    linear *= pow(2.0, u_exposure);

    // 3. Highlights and Shadows
    float luma = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    if (u_shadows != 0.0) {
        float shadowMask = 1.0 - smoothstep(0.0, 0.5, luma);
        linear += linear * (u_shadows / 100.0) * shadowMask * 0.5;
    }
    if (u_highlights != 0.0) {
        float highlightMask = smoothstep(0.5, 1.0, luma);
        linear += linear * (u_highlights / 100.0) * highlightMask * 0.5;
    }

    // 4. Contrast around middle gray (0.18 in linear)
    float c = u_contrast / 100.0;
    linear = max(vec3(0.0), (linear - 0.18) * (1.0 + c) + 0.18);

    // 5. Saturation
    float newLuma = dot(linear, vec3(0.2126, 0.7152, 0.0722));
    float satFactor = 1.0 + u_saturation / 100.0;
    linear = max(vec3(0.0), mix(vec3(newLuma), linear, satFactor));

    // 6. Display Transform back to sRGB
    vec3 srgbOut = clamp(linearTosRGB(linear), 0.0, 1.0);
    fragColor = vec4(srgbOut, tex.a);
}
`;
