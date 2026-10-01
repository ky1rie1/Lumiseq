// src/engine/shaders/passDisplay.ts
//! Pass 4: Final Display Pass (Vignette & Linear -> sRGB Display EOTF)

export const DISPLAY_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

export const DISPLAY_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec4 u_source_rect; // x, y, width, height in full photo coordinates
uniform float u_vignette_amount;       // -100 to +100
uniform float u_vignette_midpoint;     // 0 to 100 (default 50)

// Accurate Linear to sRGB EOTF
vec3 linearTosRGB(vec3 linear) {
    vec3 c = max(linear, vec3(0.0));
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
    vec4 tex = texture(u_image, v_texCoord);
    vec3 color = tex.rgb;

    // 1. Radial Vignette
    if (u_vignette_amount != 0.0) {
        vec2 centerDist = u_source_rect.xy + v_texCoord * u_source_rect.zw - vec2(0.5);
        float radius = length(centerDist) * 1.41421356; // Normalize corner to 1.0
        float midpoint = clamp(u_vignette_midpoint / 100.0, 0.05, 0.95);
        float vignetteMask = smoothstep(midpoint * 0.5, midpoint * 1.5, radius);

        float factor = u_vignette_amount / 100.0;
        if (factor < 0.0) {
            // Dark vignette
            color *= (1.0 + factor * vignetteMask);
        } else {
            // Light/high-key vignette
            color = mix(color, vec3(1.0), factor * vignetteMask * 0.6);
        }
    }

    // 2. Display Color Transform (Linear to sRGB Gamma)
    vec3 srgb = linearTosRGB(color);

    // Final Safe Clamping to [0.0, 1.0]
    fragColor = vec4(clamp(srgb, 0.0, 1.0), tex.a);
}
`;
