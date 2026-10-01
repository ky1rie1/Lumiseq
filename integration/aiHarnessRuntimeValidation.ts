/** Production renderer/runtime/bus integration with recorded responses; no model request. */
import { AgentRuntime } from '../src/ai/runtime/AgentRuntime';
import { ProviderRegistry } from '../src/ai/providers/ProviderRegistry';
import type { IAIProvider } from '../src/ai/providers/IAIProvider';
import { ToolRegistry } from '../src/ai/tools/ToolRegistry';
import { PermissionGuard } from '../src/ai/permissions/PermissionGuard';
import { VisionInspector } from '../src/ai/vision/VisionInspector';
import { CapabilityRouter } from '../src/ai/capabilities/CapabilityRouter';
import { CommandBus } from '../src/history/CommandBus';
import type { DocumentManager } from '../src/document/DocumentManager';
import type { DocumentObservationService } from '../src/ai/vision/DocumentObservationService';
import type { AgentMessage, ProviderConfig } from '../src/ai/types';

type Check = (name: string, passed: boolean, detail?: unknown) => void;
export async function validateHarnessRuntime(
  check: Check, documents: DocumentManager, observer: DocumentObservationService,
  documentId: string, layerId: string,
): Promise<void> {
  const config: ProviderConfig = { id: 'recorded-browser', name: 'Recorded browser validation',
    type: 'local', baseUrl: '', model: 'recorded', enabled: true, isDefault: true };
  let turns: AgentMessage[] = [];
  const requests: AgentMessage[][] = [], reviews: AgentMessage[][] = [];
  const provider: IAIProvider = {
    config,
    capabilities: { text: true, vision: true, toolCalling: true, streaming: false,
      imageGeneration: false, structuredOutput: true },
    async chat(messages) {
      if (messages[0].content?.startsWith('Independent result review')) {
        reviews.push(structuredClone(messages));
        return { role: 'assistant', content: '{"verdict":"pass","pending":[]}' };
      }
      requests.push(structuredClone(messages));
      return turns.shift() ?? { role: 'assistant', content: 'Recorded response complete.' };
    },
    async testConnection() { throw new Error('Live connection testing is outside this fixture'); },
  };
  class RecordedRegistry extends ProviderRegistry {
    override getActiveConfig() { return config; }
    override getConfig() { return config; }
    override getProvider() { return provider; }
    override getProviderForModel() { return provider; }
  }
  const providers = new RecordedRegistry(), tools = new ToolRegistry();
  const permissions = new PermissionGuard(); permissions.setLevel('full');
  const bus = new CommandBus(documents), router = new CapabilityRouter(providers);
  // Instance-only QA policy; never persist or alter the user's stored preferences.
  Object.assign(router, { privacyMode: 'allow', stackConfig: {
    agentProviderId: config.id, visionProviderId: config.id,
    segmentationProviderId: 'birefnet-local', imageEditProviderId: config.id,
  } });
  class DocumentOnlyInspector extends VisionInspector {
    override captureSnapshot(): never {
      throw new Error('Runtime must observe document pixels rather than the UI canvas');
    }
  }
  const runtime = new AgentRuntime(providers, tools, permissions, new DocumentOnlyInspector(), bus,
    documents, { observationService: observer, capabilityRouter: router });
  const opacity = () => documents.getEditDocument(documentId)!.layers.find(layer => layer.id === layerId)!.opacity;
  const change = (): AgentMessage => ({ role: 'assistant', toolCalls: [{
    id: 'recorded-opacity', name: 'edit_set_layer_opacity', arguments: { documentId, layerId, opacity: 0.5 },
  }] });

  turns = [change(), { role: 'assistant', content: 'Recorded parameter completion.' }];
  const precise = await runtime.run('设置图层不透明度50%', { taskKind: 'precise', includeVision: false });
  check('Real runtime precise edit changes state without image/review requests',
    precise.status === 'completed' && opacity() === 0.5 && reviews.length === 0
    && requests.every(messages => messages.every(message => !message.image && !message.images?.length)),
    { status: precise.status, opacity: opacity(), modelRequests: requests.length,
      stopReason: precise.stopReason, error: precise.error, verification: precise.verification,
      actions: precise.actions.map(action => ({ tool: action.toolName, status: action.status, result: action.result })) });
  check('Real runtime parameter task undo restores source opacity', runtime.undoRun(precise.runId) && opacity() === 1);

  requests.length = 0; turns = [
    { role: 'assistant', toolCalls: [{ id: 'read-edit', name: 'get_edit_document', arguments: { documentId } }] },
    change(), { role: 'assistant', content: 'Recorded visual completion.' },
  ];
  const photo = await runtime.run('减轻图层的视觉强度并检查结果', { taskKind: 'photo' });
  const reviewImages = reviews.flatMap(messages => messages.flatMap(message => message.images ?? []));
  check('Production composite images reach recorded planner and independent review',
    photo.status === 'completed' && requests[0].some(message => message.images?.length)
    && reviewImages.length === 2 && reviewImages[0].data !== reviewImages[1].data,
    { status: photo.status, stopReason: photo.stopReason, error: photo.error,
      pending: photo.verification?.pending,
      actions: photo.actions.map(action => ({ tool: action.toolName, status: action.status, result: action.result })),
      modelRequests: requests.length,
      reviewImages: reviewImages.map(image => ({ mimeType: image.mimeType, observationId: image.observationId })) });
  const sample = async (image: { mimeType: string; data: string }) => {
    const decoded = new Image(); decoded.src = `data:${image.mimeType};base64,${image.data}`;
    await decoded.decode();
    const canvas = document.createElement('canvas'); canvas.width = decoded.naturalWidth; canvas.height = decoded.naturalHeight;
    const context = canvas.getContext('2d')!; context.drawImage(decoded, 0, 0);
    return [...context.getImageData(50, 80, 1, 1).data];
  };
  const [beforePixel, afterPixel] = await Promise.all(reviewImages.map(sample));
  check('Independent review carries changed source pixels, not image references alone',
    Math.abs(beforePixel[0] - 200) <= 6 && Math.abs(beforePixel[1] - 60) <= 6
    && beforePixel.some((value, index) => index < 3 && Math.abs(value - afterPixel[index]) >= 12),
    { beforePixel, afterPixel });
  const persistent = JSON.stringify([photo, documents.getDocument(documentId)?.aiHistory]);
  check('Runtime and persisted project history exclude actual image bodies',
    reviewImages.every(image => !persistent.includes(image.data)) && !persistent.includes('data:image/'));
  check('Visual task undo restores source and retains immutable source asset',
    runtime.undoRun(photo.runId) && opacity() === 1);

  requests.length = 0; reviews.length = 0;
  turns = [
    { role: 'assistant', toolCalls: [{ id: 'read-mixed-layout', name: 'get_edit_document', arguments: { documentId } }] },
    change(), { role: 'assistant', content: 'Recorded mixed visual completion.' },
  ];
  const mixed = await runtime.run('让海报排版更均衡，输出宽1000px');
  check('Output dimensions preserve visual task classification and actual image review',
    mixed.taskKind === 'layout' && mixed.status === 'completed'
    && requests[0].some(message => message.images?.length) && reviews.length === 1,
    { kind: mixed.taskKind, status: mixed.status, stopReason: mixed.stopReason, pending: mixed.verification?.pending });
  check('Mixed visual task remains one undoable task', runtime.undoRun(mixed.runId) && opacity() === 1);

  requests.length = 0; reviews.length = 0;
  Object.assign(router, { privacyMode: 'never' });
  turns = [{ role: 'assistant', content: 'No visual verification available.' }];
  const privateRun = await runtime.run('检查图像的视觉效果', { taskKind: 'photo' });
  check('Privacy never keeps visual verification pending without image calls',
    privateRun.status === 'partial' && reviews.length === 0
    && requests.every(messages => messages.every(message => !message.image && !message.images?.length)),
    { status: privateRun.status, stopReason: privateRun.stopReason, pending: privateRun.verification?.pending });
  requests.length = 0; reviews.length = 0;
}
