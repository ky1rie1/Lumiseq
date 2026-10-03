import { describe, expect, it, vi } from 'vitest';
import { createDevelopDocument } from '../document/DevelopDocument';
import { createEditDocument } from '../document/EditDocument';
import { ImageExportService, getImageExportColorContract } from './ImageExportService';

describe('image delivery export', () => {
  it('delivers v2 edit through native float export with a truthful 16-bit contract', async () => {
    const doc = createEditDocument({ renderingVersion: 2, width: 300, height: 200 });
    const exportEditFloat = vi.fn(async () => 'C:\\out.tiff'), renderEdit = vi.fn();
    const service = new ImageExportService({ exportRaw: vi.fn(), renderEdit, exportEditFloat, renderDevelop: vi.fn(), write: vi.fn() });
    await service.export(doc, 'C:\\out.tiff', { format: 'tiff', outputProfile: 'display-p3', quality: 90, width: 150, height: 100 });
    expect(exportEditFloat).toHaveBeenCalledWith(doc, { format: 'tiff', outputProfile: 'display-p3', quality: .9, width: 150, height: 100 }, 'C:\\out.tiff');
    expect(renderEdit).not.toHaveBeenCalled();
    expect(getImageExportColorContract(doc, 'png')).toEqual({ colorSpace: 'srgb', bitDepth: 16, backend: 'native', metadata: 'icc-profile' });
  });
  it('reports actual native PNG16 and JPEG8 color contracts', () => {
    const raw = createDevelopDocument({ sourceUri: 'C:\\photo.nef', fileName: 'photo.nef', isRaw: true });
    raw.nativeAssetId = 'native-color';
    expect(getImageExportColorContract(raw, 'png')).toEqual({ colorSpace: 'srgb', bitDepth: 16, backend: 'native', metadata: 'icc-profile' });
    expect(getImageExportColorContract(raw, 'jpeg')).toEqual({ colorSpace: 'srgb', bitDepth: 8, backend: 'native', metadata: 'icc-profile' });
  });

  it('reports Canvas8 for raster/edit exports and no depth for undecoded RAW', () => {
    const raster = createDevelopDocument({ sourceUri: 'C:\\photo.png', fileName: 'photo.png', isRaw: false });
    raster.sourceAssetId = 'canvas-image';
    const edit = createEditDocument({ name: 'photo.png', width: 1200, height: 800 });
    const raw = createDevelopDocument({ sourceUri: 'C:\\photo.nef', fileName: 'photo.nef', isRaw: true });
    for (const document of [raster, edit]) for (const format of ['png', 'jpeg'] as const) {
      expect(getImageExportColorContract(document, format)).toEqual({ colorSpace: 'srgb', bitDepth: 8, backend: 'canvas', metadata: 'browser-managed' });
    }
    expect(getImageExportColorContract(raw, 'png')).toEqual({ colorSpace: 'srgb', bitDepth: null, backend: 'unavailable', metadata: 'unavailable' });
  });

  it('uses native RAW pixels at requested dimensions and quality', async () => {
    const raw = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true, width: 4000, height: 3000 });
    raw.nativeAssetId = 'native-1';
    const exportRaw = vi.fn(async () => 'C:\\out.jpg');
    const service = new ImageExportService({ exportRaw, renderEdit: vi.fn(), renderDevelop: vi.fn(), write: vi.fn() });
    await service.export(raw, 'C:\\out.jpg', { format: 'jpeg', quality: 82, width: 2000, height: 1500 });
    expect(exportRaw).toHaveBeenCalledWith('native-1', raw.settings, { format: 'jpeg', quality: 0.82, width: 2000, height: 1500 }, 'C:\\out.jpg');
  });

  it('exports TIFF16 P3 through native pixels and rejects profile substitution on Canvas',async()=>{
    const raw=createDevelopDocument({sourceUri:'C:\\photo.arw',fileName:'photo.arw',isRaw:true});raw.nativeAssetId='native-p3';
    const exportRaw=vi.fn(async()=>'C:\\out.tiff');
    const service=new ImageExportService({exportRaw,renderEdit:vi.fn(),renderDevelop:vi.fn(),write:vi.fn()});
    await service.export(raw,'C:\\out.tiff',{format:'tiff',outputProfile:'display-p3',quality:90,width:6192,height:4128});
    expect(exportRaw).toHaveBeenCalledWith('native-p3',raw.settings,{format:'tiff',outputProfile:'display-p3',quality:.9,width:6192,height:4128},'C:\\out.tiff');
    const raster=createEditDocument({name:'raster',width:1,height:1});
    await expect(service.export(raster,'C:\\out.png',{format:'png',outputProfile:'display-p3',quality:90,width:1,height:1})).rejects.toThrow(/native|原生/i);
  });

  it('renders and writes a composited PNG without changing project save state', async () => {
    const doc = createEditDocument({ name: 'photo.png', width: 1200, height: 800 });
    const blob = new Blob(['pixels'], { type: 'image/png' });
    const write = vi.fn(async () => undefined);
    const renderEdit = vi.fn(async () => blob);
    const service = new ImageExportService({ exportRaw: vi.fn(), renderEdit, renderDevelop: vi.fn(), write });
    await service.export(doc, 'C:\\out.png', { format: 'png', quality: 90, width: 600, height: 400 });
    expect(renderEdit).toHaveBeenCalledWith(doc, { format: 'png', quality: 0.9, width: 600, height: 400 });
    expect(write).toHaveBeenCalledWith('C:\\out.png', blob);
    expect(doc.isDirty).toBe(false);
  });

  it('rejects unresolved auto white balance before starting export', async () => {
    const raw = createDevelopDocument({ sourceUri: 'C:\\photo.cr3', fileName: 'photo.cr3', isRaw: true });
    raw.nativeAssetId = 'native-1'; raw.settings.whiteBalance.mode = 'auto';
    const exportRaw = vi.fn();
    const service = new ImageExportService({ exportRaw, renderEdit: vi.fn(), renderDevelop: vi.fn(), write: vi.fn() });
    await expect(service.export(raw, 'C:\\out.png', { format: 'png', quality: 90, width: 4000, height: 3000 })).rejects.toThrow(/自动白平衡/);
    expect(exportRaw).not.toHaveBeenCalled();
  });
});
