import type { StudioPreferences } from '../../stores/studioPreferences';
import { BrandMark } from '../shared/BrandMark';

type AppearancePreviewProps = Pick<StudioPreferences, 'density' | 'motion' | 'canvasBackground'>;

export function AppearancePreview({ density, motion, canvasBackground }: AppearancePreviewProps) {
  return <div className="settings-appearance-preview" data-density={density} data-motion={motion} aria-label="专业工作台预览">
    <div className="settings-preview-titlebar">
      <BrandMark className="settings-preview-brand" />
      <span>影序</span>
      <i />
      <b>照片编辑</b>
      <div className="settings-preview-window-actions"><i /><i /><i /></div>
    </div>
    <div className="settings-preview-commandbar"><i /><i /><i /><span /><i /><i /></div>
    <div className="settings-preview-workbench">
      <div className="settings-preview-toolrail" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="settings-preview-stage" style={{ backgroundColor: canvasBackground }}><div className="settings-preview-artboard"><span /></div></div>
      <div className="settings-preview-inspector" aria-hidden="true">
        <div className="settings-preview-tabs"><b /><i /></div>
        <div className="settings-preview-layers"><span /><span /><span /></div>
      </div>
    </div>
    <div className="settings-preview-status"><span>100%</span><i /></div>
  </div>;
}
