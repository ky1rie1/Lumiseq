import { expect, it } from 'vitest';
import { classifyTask, edgeContext, relevantRegions } from './TaskPolicy';
import { RunBudget, HarnessStop } from './RunBudget';
import { operationDirectory, guideResources } from './OperationGuide';
import { ToolRegistry } from '../tools/ToolRegistry';
import { createDevelopDocument } from '../../document/DevelopDocument';
it.each(['Make the photo cinematic at 1000px','Make a vivid photo with exposure 0.3 EV'])('keeps an unknown mixed visual request conservative: %s',prompt=>{
  expect(classifyTask(prompt).kind).toBe('photo');
});
it.each([['创建一张海报，输出1000px','layout'],['创建一张有高级感的图像，输出1000px','photo'],['设置图层不透明度50%','precise']])('preserves creation design and pure layer parameter semantics: %s',(prompt,kind)=>{
  expect(classifyTask(prompt).kind).toBe(kind);
});
it('classifies conservatively and retains explicit region/target goals', () => {
  expect(classifyTask('增加曝光0.3EV').kind).toBe('precise');
  expect(classifyTask('make it beautiful').visual).toBe(true);
  expect(classifyTask('exposure 0.3',{kind:'develop'} as never,{taskKind:'local-detail',targetIds:['a']}).targetIds).toEqual(['a']);
});
it('includes relevant layer operations for precise Edit work and system discovery for explicit save',()=>{
  expect(classifyTask('opacity 50%',{kind:'edit'} as never).groups).toContain('layers');
  expect(classifyTask('save project',{kind:'edit'} as never).groups).toContain('system');
});
it.each([['将海报排版得更均衡，输出宽 1000px','layout'],['检查整张照片细节，100% 查看','local-detail']])('keeps mixed visual intent for %s',(prompt,kind)=>{
  expect(classifyTask(prompt).kind).toBe(kind);expect(classifyTask(prompt).visual).toBe(true);
});
it('tiles whole-source coverage in original coordinates and clips neighboring context', () => {
  const doc=createDevelopDocument({sourceUri:'x',fileName:'x',isRaw:false}); doc.width=2000;doc.height=1600;
  expect(relevantRegions(classifyTask('whole image detail'),doc)).toHaveLength(4);
  expect(edgeContext({x:0,y:0,width:10,height:10},doc)).toEqual({x:0,y:0,width:26,height:26});
});
it('keeps lower budgets binding and exposes metadata/guide resources from actual registry', () => {
  const budget=new RunBudget({maxSteps:1,maxImages:0}); budget.take('modelSteps');
  expect(()=>budget.take('modelSteps')).toThrow(HarnessStop);expect(()=>budget.take('images')).toThrow(HarnessStop);
  const registry=new ToolRegistry(); expect(operationDirectory(registry)).toHaveLength(registry.getAll().length);
  expect(guideResources(registry).map(r=>r.uri)).toContain('studio://workflow/layout');
});
