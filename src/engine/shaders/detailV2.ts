const head = `#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 outColor;
uniform sampler2D u_image;
float logOnePlus(float x) { return x < .01 ? x*(1.0-x*.5+x*x/3.0-x*x*x*.25) : log(1.0+x); }
float expMinusOne(float x) { return x < .01 ? x*(1.0+x*.5+x*x/6.0+x*x*x/24.0) : exp(x)-1.0; }
float perceptual(float y) { return sign(y) * logOnePlus(16.0 * abs(y)) / 16.0; }
`;

export const DETAIL_MOMENTS = head + `
void main() {
    float p = perceptual(dot(texture(u_image, v_texCoord).rgb, vec3(.2126,.7152,.0722)));
    outColor = vec4(p, p*p, 0, 0);
}`;

export const DETAIL_GAUSSIAN = head + `
uniform ivec2 u_axis;
uniform float u_sigma;
uniform int u_radius;
void main() {
    ivec2 size = textureSize(u_image, 0);
    ivec2 pixel = ivec2(gl_FragCoord.xy);
    vec4 sum = vec4(0); float weightSum = 0.0;
    for (int k = -u_radius; k <= u_radius; ++k) {
        float weight = exp(-0.5 * pow(float(k) / u_sigma, 2.0));
        sum += texelFetch(u_image, clamp(pixel + k*u_axis, ivec2(0), size-1), 0) * weight;
        weightSum += weight;
    }
    outColor = sum / weightSum;
}`;

export const DETAIL_COEFFICIENTS = head + `
void main() {
    vec2 moments = texture(u_image, v_texCoord).rg;
    float variance = max(0.0, moments.y - moments.x*moments.x);
    float a = variance / (variance + .0004);
    outColor = vec4(a, (1.0-a)*moments.x, 0, 0);
}`;

export const DETAIL_RECONSTRUCT = head + `
uniform sampler2D u_low;
uniform sampler2D u_mean;
uniform bool u_guided;
uniform float u_amount;
uniform float u_threshold;
void main() {
    vec4 source = texture(u_image, v_texCoord);
    float y = dot(source.rgb, vec3(.2126,.7152,.0722));
    float p = perceptual(y);
    vec2 low = texture(u_low, v_texCoord).rg;
    float mean = texture(u_mean, v_texCoord).r;
    float diff = p - (u_guided ? low.x*p + low.y : low.x);
    float noise = smoothstep(.0002, .002, abs(diff));
    float threshold = u_threshold > 0.0 ? smoothstep(u_threshold*.5, u_threshold*1.5+1e-6, abs(diff)) : 1.0;
    float point = 1.0 - .85*smoothstep(1.5, 3.0, abs(p)/(abs(mean)+.0001));
    float targetP = p + diff*u_amount*noise*threshold*point;
    float target = sign(targetP)*expMinusOne(16.0*abs(targetP))/16.0;
    float ratio = abs(p)/(abs(mean)+.0001);
    float enhancementLimit = u_amount > 0.0 ? ((target-y)*y < 0.0 ? .02 : .35-.33*smoothstep(1.3,1.6,ratio)) : .35;
    float limit = .0002 + enhancementLimit*abs(y);
    float delta = clamp(target-y, -limit, limit);
    float gain = abs(y)>1e-12 ? 1.0+delta/y*smoothstep(0.0,1e-5,abs(y)) : 1.0;
    outColor = vec4(source.rgb*gain, source.a);
}`;

export const DETAIL_COPY = head + `
void main() { outColor = texture(u_image, v_texCoord); }`;
