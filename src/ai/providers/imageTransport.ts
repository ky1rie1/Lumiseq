import type { AgentMessage, ImageInput, ImageInputLimits, ProviderConfig } from '../types';
export const DEFAULT_IMAGE_LIMITS: ImageInputLimits = { maxImages: 16, maxImageBytes: 8 * 1024 * 1024, maxTotalBytes: 24 * 1024 * 1024 };
export function negotiatedImageLimits(config: ProviderConfig, ceiling = DEFAULT_IMAGE_LIMITS): ImageInputLimits {
    const limits = { ...ceiling };
    for (const key of Object.keys(limits) as Array<keyof ImageInputLimits>) {
        const requested = config.imageLimits?.[key];
        if (requested !== undefined) {
            if (!Number.isSafeInteger(requested) || requested < 1)
                throw new Error('Invalid image input limit');
            limits[key] = Math.min(requested, ceiling[key]);
        }
    }
    return limits;
}
export function normalizeImages(message: Pick<AgentMessage, 'image' | 'images'>): ImageInput[] {
    const images = [...(message.images ?? [])];
    if (message.image && !images.some(i => i.mimeType === message.image!.mimeType && i.data === message.image!.data))
        images.push(message.image);
    return images;
}
function imageBytes(image: ImageInput): number {
    if (!/^image\/(?:png|jpeg|webp|gif)$/.test(image.mimeType) || typeof image.data !== 'string'
        || !image.data.length || image.data.length % 4 !== 0
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))
        throw new Error('Invalid image MIME or base64 data');
    const bytes = image.data.length / 4 * 3 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
    // Reject noncanonical padding bits without creating a decoded image copy.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (image.data.endsWith('==') && (alphabet.indexOf(image.data.at(-3)!) & 15)
        || image.data.endsWith('=') && !image.data.endsWith('==') && (alphabet.indexOf(image.data.at(-2)!) & 3))
        throw new Error('Invalid image base64 padding');
    return bytes;
}
export function metadataOnly(value: unknown): unknown {
    if (Array.isArray(value))
        return value.map(metadataOnly);
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value)
            .filter(([key]) => !['image', 'images', 'preview', 'preview512', 'preview1024', 'selectedRegion'].includes(key))
            .map(([key, item]) => [key, metadataOnly(item)]));
    if (typeof value === 'string' && /^data:image\//i.test(value))
        return '[image omitted]';
    return value;
}
export function toolText(content = ''): string {
    try {
        return JSON.stringify(metadataOnly(JSON.parse(content)));
    }
    catch {
        return content.replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/gi, '[image omitted]');
    }
}
/** Validates the whole request. Rejection preserves evidence geometry; no hidden resizing or truncation. */
export function normalizeImageMessages(messages: AgentMessage[], limits: ImageInputLimits): AgentMessage[] {
    let count = 0, bytes = 0, textBytes = 0;
    return messages.map(message => {
        const images = normalizeImages(message);
        if (images.length && message.role !== 'user' && message.role !== 'tool')
            throw new Error('Images require a user or tool message');
        for (const image of images) {
            if (image.data.length > Math.ceil(limits.maxImageBytes / 3) * 4)
                throw new Error('Image exceeds input limit; request a smaller observation');
            const size = imageBytes(image);
            bytes += size;
            count++;
            if (size > limits.maxImageBytes || bytes > limits.maxTotalBytes || count > limits.maxImages)
                throw new Error('Image request exceeds input limits; request fewer or smaller observations');
        }
        const content = message.role === 'tool' ? toolText(message.content) : message.content;
        textBytes += new TextEncoder().encode(content ?? '').length;
        if (textBytes > 1024 * 1024)
            throw new Error('Image transport text exceeds request limit');
        return { ...message, content, image: undefined, images: images.length ? images : undefined };
    });
}
/** For protocols whose tool results accept text only. Flush after the complete tool-result run. */
export function separateToolImages(messages: AgentMessage[]): AgentMessage[] {
    const output: AgentMessage[] = [];
    let pending: ImageInput[] = [];
    const flush = () => { if (pending.length)
        output.push({ role: 'user', content: 'Observation images from the preceding tool results, in result order.', images: pending }); pending = []; };
    for (const message of messages) {
        if (message.role !== 'tool')
            flush();
        if (message.role === 'tool' && message.images?.length) {
            pending.push(...message.images);
            output.push({ ...message, images: undefined });
        }
        else
            output.push(message);
    }
    flush();
    return output;
}
export function serializeImageRequest(payload: unknown, maxBytes = 32 * 1024 * 1024): string {
    const body = JSON.stringify(payload);
    if (body.length > maxBytes || new TextEncoder().encode(body).length > maxBytes)
        throw new Error('Image request exceeds serialized request limit');
    return body;
}
