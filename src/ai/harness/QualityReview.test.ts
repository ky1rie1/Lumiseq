import { expect, it } from 'vitest';
import { createDevelopDocument } from '../../document/DevelopDocument';
import { createEditDocument, createGroupLayer, createImageLayer } from '../../document/EditDocument';
import { technicalReview, parseVisualReview } from './QualityReview';
import type { AgentActionLogEntry } from '../types';
it('checks current values rather than trusting tool-success snapshots', () => {
  const doc = createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:false});
  const action = {toolName:'develop_set_parameter',args:{parameterId:'exposure',value:0.3},status:'success',result:{success:true,commandId:'real-command'}} as unknown as AgentActionLogEntry;
  expect(technicalReview(doc,[action]).pending.join(' ')).toContain('exposure');
  doc.settings.exposure=0.3;
  expect(technicalReview(doc,[action]).verified).toContain('exposure = 0.3');
});
it('requires an explicit independent verdict and keeps unsupported output pending', () => {
  expect(parseVisualReview('looks fine').verdict).toBe('pending');
  expect(parseVisualReview('{"verdict":"repair","pending":["edge halo"]}').pending).toEqual(['edge halo']);
  expect(parseVisualReview('{"verdict":"pass","pending":["uninspected sky"]}').verdict).toBe('pending');
});
it('accepts native zero-size group containers but detects invalid leaf geometry',()=>{
  const leaf=createImageLayer({id:'leaf',name:'leaf',sourceAssetId:'x',naturalWidth:20,naturalHeight:20});
  const doc=createEditDocument({layers:[createGroupLayer({children:[leaf]})]});
  expect(technicalReview(doc,[]).pending).toEqual([]);
  leaf.transform.width=-1;
  expect(technicalReview(doc,[]).pending).toContain('layer leaf: invalid geometry');
});
