export const LOCAL_MASK_VERTEX_SHADER = `#version 300 es
in vec2 a_position;
in vec2 a_texCoord;
out vec2 v_texCoord;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

export const LOCAL_MASK_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_texCoord;
out vec4 fragColor;

uniform sampler2D u_image;
uniform sampler2D u_mask;
uniform vec4 u_source_rect; // x, y, width, height in full photo coordinates
uniform float u_opacity;
uniform bool u_inverted;
uniform float u_exposure;
uniform float u_temperature;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_saturation;

void main() {
    vec4 inputColor = texture(u_image, v_texCoord);
    // Mask bytes are stored top-down; typed-array texture uploads do not flip rows.
    vec2 globalCoord = u_source_rect.xy + v_texCoord * u_source_rect.zw;
    float maskValue = texture(u_mask, vec2(globalCoord.x, 1.0 - globalCoord.y)).r;
    float weight = clamp((u_inverted ? 1.0 - maskValue : maskValue) * u_opacity, 0.0, 1.0);
    vec3 adjusted = inputColor.rgb * pow(2.0, u_exposure);

    float tempShift = clamp(u_temperature / 100.0, -1.0, 1.0) * 0.35;
    adjusted *= vec3(1.0 + tempShift, 1.0, 1.0 - tempShift);

    float luma = dot(adjusted, vec3(0.2126, 0.7152, 0.0722));
    float shadowWeight = 1.0 / (1.0 + exp((luma - 0.25) * 12.0));
    float highlightWeight = 1.0 / (1.0 + exp(-(luma - 0.55) * 10.0));
    adjusted += adjusted * (u_shadows / 100.0) * shadowWeight * 0.75;
    adjusted += adjusted * (u_highlights / 100.0) * highlightWeight * 0.75;
    float toneY = dot(adjusted, vec3(0.2126, 0.7152, 0.0722));
    if (u_contrast != 0.0 && toneY > 1e-8) adjusted *= (0.18 * pow(toneY / 0.18, pow(2.0, u_contrast / 100.0))) / toneY;

    float adjustedLuma = dot(adjusted, vec3(0.2126, 0.7152, 0.0722));
    adjusted = max(vec3(0.0), mix(vec3(adjustedLuma), adjusted, max(0.0, 1.0 + u_saturation / 100.0)));
    fragColor = vec4(mix(inputColor.rgb, adjusted, weight), inputColor.a);
}
`;
