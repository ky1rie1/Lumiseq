import { describe, it, expect } from 'vitest';
import { routeFile, isRawFile, isRasterFile } from '../src/router/FileRouter';

describe('FileRouter', () => {
  it('routes native camera formats from additional manufacturers to Develop', () => {
    for (const file of ['camera.3FR','camera.FFF','camera.IIQ','camera.X3F','camera.MRW','camera.NRW','camera.CRW','camera.KDC','camera.DCR','camera.ERF','camera.GPR','camera.MOS','camera.RWL','camera.RWZ','camera.SR2','camera.SRF','camera.PEF']) {
      expect(routeFile(file).fileType, file).toBe('raw');
      expect(routeFile(file).targetWorkspace, file).toBe('develop');
    }
  });
  it('6. RAW files are routed to Develop Workspace', () => {
    const rawFiles = [
      'IMG_1001.CR2',
      'portrait.cr3',
      'landscape.NEF',
      'sony_a7r5.ARW',
      'fuji_xt5.RAF',
      'panasonic.RW2',
      'olympus.orf',
      'drone_shot.DNG',
    ];

    for (const file of rawFiles) {
      expect(isRawFile(file)).toBe(true);
      const route = routeFile(file);
      expect(route.targetWorkspace).toBe('develop');
      expect(route.fileType).toBe('raw');
    }
  });

  it('7. Common raster images (PNG, JPG, WEBP, BMP, TIFF) are routed to Edit Workspace', () => {
    const rasterFiles = [
      'poster.png',
      'photo.jpg',
      'banner.JPEG',
      'asset.webp',
      'icon.bmp',
      'print.tiff',
      'scan.tif',
    ];

    for (const file of rasterFiles) {
      expect(isRasterFile(file)).toBe(true);
      const route = routeFile(file);
      expect(route.targetWorkspace).toBe('edit');
      expect(route.fileType).toBe('raster');
    }
  });

  it('8. Project files (.lsq, .lumiseq, .aistudio, .psd) are routed to Project/Edit Workspace', () => {
    const projectFiles = [
      'masterpiece.lsq',
      'composition.lumiseq',
      'retouch.aistudio',
      'layered.psd',
    ];

    for (const file of projectFiles) {
      const route = routeFile(file);
      expect(route.targetWorkspace).toBe('edit');
      expect(route.fileType).toBe('project');
    }
  });

  it('Unknown files route to Home', () => {
    const route = routeFile('document.pdf');
    expect(route.targetWorkspace).toBe('home');
    expect(route.fileType).toBe('unknown');
  });
});
