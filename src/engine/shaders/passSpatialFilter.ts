// src/engine/shaders/passSpatialFilter.ts
//! Pass 2: Spatial Filtering (Neighborhood Processing)
//! Implements fixed-scale local contrast (Texture, Clarity), regional neutral-veil approximate Dehaze,
//! unsharp mask Sharpening, and spatial Luma/Chroma Noise Reduction.

export const SPATIAL_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

export const SPATIAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform vec2 u_texel_size;             // 1.0 / (width, height)
uniform float u_spatial_scale;         // canonical source radius expressed in preview pixels
uniform float u_texture;               // -100 to +100 (high-frequency local contrast)
uniform float u_clarity;               // -100 to +100 (mid-frequency local contrast)
uniform float u_sharpen_amount;        // 0 to 150
uniform float u_sharpen_radius;        // 0.5 to 3.0
uniform float u_sharpen_threshold;     // 0 to 25

// Weighted 9-tap sampling around the current texel (not a full Gaussian convolution).
vec3 sampleBlur(vec2 uv, float radiusScale) {
    vec2 offset = u_texel_size * radiusScale * u_spatial_scale;
    vec3 c = texture(u_image, uv).rgb * 0.25;
    c += texture(u_image, uv + vec2( offset.x,  0.0)).rgb * 0.15;
    c += texture(u_image, uv + vec2(-offset.x,  0.0)).rgb * 0.15;
    c += texture(u_image, uv + vec2( 0.0,  offset.y)).rgb * 0.15;
    c += texture(u_image, uv + vec2( 0.0, -offset.y)).rgb * 0.15;
    c += texture(u_image, uv + vec2( offset.x,  offset.y)).rgb * 0.0375;
    c += texture(u_image, uv + vec2(-offset.x,  offset.y)).rgb * 0.0375;
    c += texture(u_image, uv + vec2( offset.x, -offset.y)).rgb * 0.0375;
    c += texture(u_image, uv + vec2(-offset.x, -offset.y)).rgb * 0.0375;
    return c;
}

// Wide blur for mid-frequency clarity estimation
vec3 sampleWideBlur(vec2 uv) {
    vec2 offset = u_texel_size * 4.0 * u_spatial_scale;
    vec3 c = texture(u_image, uv).rgb * 0.20;
    c += texture(u_image, uv + vec2( offset.x,  0.0)).rgb * 0.15;
    c += texture(u_image, uv + vec2(-offset.x,  0.0)).rgb * 0.15;
    c += texture(u_image, uv + vec2( 0.0,  offset.y)).rgb * 0.15;
    c += texture(u_image, uv + vec2( 0.0, -offset.y)).rgb * 0.15;
    c += texture(u_image, uv + vec2( offset.x * 2.0,  0.0)).rgb * 0.05;
    c += texture(u_image, uv + vec2(-offset.x * 2.0,  0.0)).rgb * 0.05;
    c += texture(u_image, uv + vec2( 0.0,  offset.y * 2.0)).rgb * 0.05;
    c += texture(u_image, uv + vec2( 0.0, -offset.y * 2.0)).rgb * 0.05;
    return c;
}

void main() {
    vec4 centerTex = texture(u_image, v_texCoord);
    vec3 color = centerTex.rgb;

    // Fast-path bypass if all spatial parameters are 0
    if (u_texture == 0.0 && u_clarity == 0.0 &&
        u_sharpen_amount == 0.0) {
        fragColor = centerTex;
        return;
    }

    // 2. Texture (High-frequency band-pass separation)
    if (u_texture != 0.0) {
        vec3 fineBlur = sampleBlur(v_texCoord, 1.0);
        vec3 highFreq = color - fineBlur;
        color += highFreq * (u_texture / 100.0) * 1.2;
    }

    // 3. Clarity (Mid-frequency local contrast)
    if (u_clarity != 0.0) {
        vec3 midBlur = sampleWideBlur(v_texCoord);
        vec3 midFreq = color - midBlur;
        color += midFreq * (u_clarity / 100.0) * 0.85;
    }

    // 5. Sharpen (Unsharp Mask: Amount, Radius, Threshold)
    if (u_sharpen_amount > 0.0) {
        vec3 unsharpBlur = sampleBlur(v_texCoord, max(0.5, u_sharpen_radius));
        vec3 diff = color - unsharpBlur;
        float diffMag = length(diff);
        float thresholdNorm = u_sharpen_threshold / 255.0;

        if (diffMag > thresholdNorm) {
            color += diff * (u_sharpen_amount / 100.0);
        }
    }

    fragColor = vec4(color, centerTex.a);
}
`;
