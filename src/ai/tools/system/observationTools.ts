import { CanonicalTool, type IToolContext } from '../CanonicalTool';
import type { CanonicalToolSchema, JSONSchemaProperty, ToolResult, ToolErrorCode } from '../../types';
import type { DocumentObservation, ObservationRequest } from '../../vision/observationTypes';
import { validToolArguments } from '../../providers/toolArgumentValidation';
const region: JSONSchemaProperty = { type: 'object', description: 'Original document pixel rectangle.', properties: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, { type: 'number', description: key }])), required: ['x', 'y', 'width', 'height'] };
const requestProperties: Record<string, JSONSchemaProperty> = {
    mode: { type: 'string', description: 'Overview, scaled region, or exact 1:1 detail.', enum: ['overview', 'region', 'detail'] },
    variant: { type: 'string', description: 'Current composite or neutral original (Develop only).', enum: ['current', 'original'] },
    region, maxDimension: { type: 'integer', description: 'Output long edge limit, 1 through 1536. Detail stays 1:1.' },
    expectedRevision: { type: 'string', description: 'Reject when the document revision differs.' },
};
const documentId: JSONSchemaProperty = { type: 'string', description: 'Explicit open document ID.' };
export function observationResult(observation: DocumentObservation, toolCallId: string): ToolResult {
    return { success: true, toolCallId, renderRequired: false, data: { evidence: observation.evidence },
        images: [{ ...observation.image, observationId: observation.evidence.observationId }] };
}
function failure(toolCallId: string, error: unknown, validationCode?: ToolErrorCode): ToolResult {
    const message = error instanceof Error ? error.message : 'Document observation unavailable';
    let code: ToolErrorCode = validationCode ?? 'SOURCE_UNAVAILABLE';
    if (!validationCode) {
        if (/revision|stale/i.test(message)) code = 'STALE_SOURCE';
        else if (/document.*(not found|does not exist)|^No document/i.test(message)) code = 'NO_DOCUMENT';
        else if (/^Edit original observation is unsupported/i.test(message)) code = 'UNSUPPORTED_OPERATION';
        else if (/^(Invalid document dimensions|Invalid observation (mode|variant|region)|Observation maxDimension must|Region observation requires|Overview observes|Observation region is outside|Detail requires)/.test(message)) code = 'INVALID_ARGUMENT';
    }
    return { success: false, toolCallId, renderRequired: false, error: { code, message } };
}
async function observe(context: IToolContext, request: ObservationRequest, toolCallId: string): Promise<ToolResult> {
    if (!context.observationService)
        return { success: false, toolCallId, renderRequired: false, error: { code: 'SOURCE_UNAVAILABLE', message: 'Document observation service is unavailable.' } };
    try {
        return observationResult(await context.observationService.observe(request,context.signal), toolCallId);
    }
    catch (error) {
        return failure(toolCallId, error);
    }
}
export class InspectDocumentTool extends CanonicalTool {
    readonly schema: CanonicalToolSchema = { name: 'inspect_document', description: 'Observe an explicit open document as a versioned image with original-pixel evidence. Default is complete overview.', workspace: 'any', category: 'read', riskLevel: 'safe', parameters: { type: 'object', properties: { documentId, request: { type: 'object', description: 'Optional observation request (documentId comes from the explicit outer field).', properties: requestProperties } }, required: ['documentId'] } };
    async execute(context: IToolContext, args: Record<string, any>, id: string): Promise<ToolResult> {
        if (!validToolArguments(args, this.schema))
            return failure(id, new Error('Invalid document observation arguments.'), 'INVALID_ARGUMENT');
        if (typeof args.documentId !== 'string' || !args.documentId || args.request !== undefined && (!args.request || typeof args.request !== 'object' || Array.isArray(args.request)))
            return failure(id, new Error('Explicit documentId and an observation request object are required.'), 'INVALID_ARGUMENT');
        return observe(context, { mode: 'overview', ...args.request, documentId: args.documentId }, id);
    }
}
export class InspectRegionTool extends CanonicalTool {
    readonly schema: CanonicalToolSchema = { name: 'inspect_region', description: 'Observe an original-pixel region without changing the user viewport. Detail is 1:1 and at most 1536 pixels per side.', workspace: 'any', category: 'read', riskLevel: 'safe', parameters: { type: 'object', properties: { documentId, ...requestProperties, mode: { ...requestProperties.mode, enum: ['region', 'detail'] } }, required: ['documentId', 'region', 'mode'] } };
    async execute(context: IToolContext, args: Record<string, any>, id: string): Promise<ToolResult> {
        if (!validToolArguments(args, this.schema))
            return failure(id, new Error('Invalid region observation arguments.'), 'INVALID_ARGUMENT');
        if (typeof args.documentId !== 'string' || !args.documentId || !args.region || !['region', 'detail'].includes(args.mode))
            return failure(id, new Error('Explicit documentId, region, and region/detail mode are required.'), 'INVALID_ARGUMENT');
        return observe(context, { documentId: args.documentId, region: args.region, mode: args.mode, variant: args.variant, maxDimension: args.maxDimension, expectedRevision: args.expectedRevision }, id);
    }
}
export class GetObservationTool extends CanonicalTool {
    readonly schema: CanonicalToolSchema = { name: 'get_observation', description: 'Read retained current observation by ID, or evidence only. Stale or evicted observations require a new inspection.', workspace: 'any', category: 'read', riskLevel: 'safe', parameters: { type: 'object', properties: { id: { type: 'string', description: 'Observation ID.' }, metadataOnly: { type: 'boolean', description: 'Return evidence without image bytes.', default: false } }, required: ['id'] } };
    async execute(context: IToolContext, args: Record<string, any>, id: string): Promise<ToolResult> {
        if (!validToolArguments(args, this.schema))
            return failure(id, new Error('Invalid observation read arguments.'), 'INVALID_ARGUMENT');
        if (typeof args.id !== 'string' || !args.id || args.metadataOnly !== undefined && typeof args.metadataOnly !== 'boolean')
            return failure(id, new Error('Observation ID and boolean metadataOnly are required.'), 'INVALID_ARGUMENT');
        if (!context.observationService) return failure(id, new Error('Document observation service is unavailable.'));
        const observation = context.observationService?.get(args.id);
        if (!observation)
            return { success: false, toolCallId: id, renderRequired: false, error: { code: 'STALE_SOURCE', message: 'Observation is unavailable, stale, or evicted. Inspect the document again.' } };
        const result = observationResult(observation, id);
        if (args.metadataOnly)
            delete result.images;
        return result;
    }
}
export async function observeLegacyPreview(context: IToolContext, args: Record<string, any>, id: string): Promise<ToolResult> {
    const doc = context.documentManager.getActiveDocument();
    if (!doc)
        return { success: false, toolCallId: id, renderRequired: false, error: { code: 'NO_DOCUMENT', message: 'No document is open.' } };
    const maxDimension = args.maxDimension === 1024 ? 1024 : 512;
    const result = await observe(context, { documentId: doc.id, mode: 'overview', maxDimension }, id);
    if (result.success) {
        const image = result.images![0];
        result.data = { ...result.data, maxDimension, preview: `data:${image.mimeType};base64,${image.data}` };
    }
    return result;
}
