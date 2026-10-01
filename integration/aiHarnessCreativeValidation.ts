/** Real candidate rendering/replay/persistence; original fixture only, no model request. */
import { CandidateService } from '../src/ai/harness/CandidateService';
import { buildCreativeBrief } from '../src/ai/harness/CreativeBrief';
import { DocumentManager } from '../src/document/DocumentManager';
import { CommandBus } from '../src/history/CommandBus';
import { ToolRegistry } from '../src/ai/tools/ToolRegistry';
import { PermissionGuard } from '../src/ai/permissions/PermissionGuard';
import { AssetManager } from '../src/assets/AssetManager';
import { ProjectSerializer } from '../src/project/ProjectSerializer';
import type { DocumentObservationService } from '../src/ai/vision/DocumentObservationService';

type Check = (name: string, passed: boolean, detail?: unknown) => void;
async function sample(preview: string): Promise<number[]> {
  const image = new Image();
  image.src = preview;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext('2d')!;
  context.drawImage(image, 0, 0);
  return [...context.getImageData(40, 80, 1, 1).data];
}

export async function validateHarnessCreative(
  check: Check, documents: DocumentManager, observer: DocumentObservationService,
  assets: AssetManager, documentId: string, layerId: string,
): Promise<void> {
  const commandBus = new CommandBus(documents);
  const service = new CandidateService({ documents, commandBus, assets,
    observationService: observer, toolRegistry: new ToolRegistry(), permissionGuard: new PermissionGuard() });
  const source = documents.getEditDocument(documentId)!;
  const before = JSON.stringify(source);
  const brief = buildCreativeBrief('保留原标题，添加“$10”作为副标题。', source);
  const runId = 'browser-creative';
  const set = await service.create({ runId, brief, plans: [
    { label: 'A · 柔和层次', reason: '保留原图结构，降低底图强度并添加原样价格文字。', operations: [
      { name: 'edit_set_layer_opacity', args: { documentId, layerId, opacity: 0.65 } },
      { name: 'edit_create_text_layer', args: { documentId, text: '$10', fontSize: 240, x: 100, y: 100 }, ref: 'price' },
      { name: 'edit_rename_layer', args: { documentId, layerId: '$price', newName: 'Price title' } },
    ] },
    { label: 'B · 更暗背景', reason: '只调整底图强度，便于比较。', operations: [
      { name: 'edit_set_layer_opacity', args: { documentId, layerId, opacity: 0.35 } },
    ] },
  ] });
  try {
    check('Candidate previews preserve exact source, selection and original history',
      JSON.stringify(documents.getEditDocument(documentId)) === before && commandBus.getHistory().length === 0);
    const baseline = await sample(set.baseline.preview);
    const a = await sample(set.candidates[0].preview);
    const b = await sample(set.candidates[1].preview);
    check('Candidate A/B contain distinct actual rendered pixels', baseline[0] > a[0] + 20 && a[0] > b[0] + 20,
      { baseline, a, b });
    const row = document.createElement('section');
    row.setAttribute('aria-label', '实际候选图像');
    for (const [label, preview] of [['原稿', set.baseline.preview], ...set.candidates.map(c => [c.label, c.preview])]) {
      const figure = document.createElement('figure');
      const image = new Image(); image.src = preview; image.alt = label;
      const caption = document.createElement('figcaption'); caption.textContent = label;
      figure.append(image, caption); row.append(figure);
    }
    document.querySelector('main')!.append(row);
    const accepted = await service.accept(set.candidates[0].id);
    const live = documents.getEditDocument(documentId)!;
    const title = live.layers.find(layer => layer.id === accepted.idMap.price);
    check('Acceptance replays literal currency and symbolic new IDs', title?.type === 'text' && title.text === '$10'
      && title.name === 'Price title' && title.id !== set.candidates[0].createdIds.price);
    check('Accepted candidate uses canonical task history and clears alternatives',
      commandBus.getHistory().length === 3 && commandBus.getHistory().every(entry => entry.agentRunId === runId)
      && !service.getForRun(runId));
    const serializer = new ProjectSerializer();
    const serialized = await serializer.serialize(live, assets);
    const reopenedDocuments = new DocumentManager(), reopenedAssets = new AssetManager();
    try {
      const reopened = await serializer.deserialize(serialized, reopenedDocuments, reopenedAssets);
      check('Accepted source assets and text survive real project serialization',
        reopened.layers.some(layer => layer.type === 'text' && layer.text === '$10' && layer.name === 'Price title')
        && reopened.layers[0].opacity === 0.65);
    } finally {
      reopenedDocuments.closeAll();
      for (const handle of reopenedAssets.listAssets()) reopenedAssets.releaseAsset(handle.id);
    }
    check('One task undo restores complete original layers and selection', commandBus.undoLastAgentRun()
      && JSON.stringify(documents.getEditDocument(documentId)!.layers) === JSON.stringify(source.layers)
      && documents.getEditDocument(documentId)!.selectedLayerId === source.selectedLayerId);
    check('Candidate cleanup leaves shared source asset usable', source.layers[0].type === 'image'
      && assets.hasAsset(source.layers[0].sourceAssetId));
  } finally {
    service.discardRun(runId);
  }
}
