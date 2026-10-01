import { expect, it } from 'vitest';
import { StudioMCPServer } from './StudioMCPServer';
import { ToolRegistry } from '../tools/ToolRegistry';
import { PermissionGuard } from '../permissions/PermissionGuard';
import { DocumentManager } from '../../document/DocumentManager';
import { CommandBus } from '../../history/CommandBus';
import { VisionInspector } from '../vision/VisionInspector';
import { createEditDocument } from '../../document/EditDocument';

it('discovers and reads generated operation directory and every workflow through MCP',async()=>{
  const registry=new ToolRegistry(),docs=new DocumentManager();
  const server=new StudioMCPServer(registry,new PermissionGuard(),docs,new CommandBus(docs),new VisionInspector());
  try {
    const listed=await server.dispatch({method:'resources/list'});
    for(const uri of ['studio://guide/operations','studio://workflow/precise','studio://workflow/photo','studio://workflow/local-detail','studio://workflow/layout']) {
      expect(listed.resources.some((r:{uri:string})=>r.uri===uri)).toBe(true);
      const resource=await server.dispatch({method:'resources/read',params:{uri}});
      const data=JSON.parse(resource.contents[0].text);
      if(uri==='studio://guide/operations') {
        expect(data.length).toBe(registry.getAll().length);
        expect(data.find((t:{name:string})=>t.name==='develop_set_parameter').units).toContain('EV');
      } else expect(data.steps.length).toBeGreaterThan(2);
    }
  } finally {await server.close();}
});
it('calls canonical read-only discovery and guide through the same MCP tool dispatcher',async()=>{
  const registry=new ToolRegistry(),docs=new DocumentManager(),guard=new PermissionGuard();guard.setLevel('full');
  docs.openDocument(createEditDocument({id:'guide-edit',width:100,height:80}));
  const server=new StudioMCPServer(registry,guard,docs,new CommandBus(docs),new VisionInspector());
  try {
    const listed=await server.dispatch({method:'tools/list'});
    expect(listed.tools.some((t:{name:string})=>t.name==='studio_read_guide')).toBe(true);
    const guide=await server.dispatch({method:'tools/call',params:{name:'studio_read_guide',arguments:{uri:'studio://workflow/layout'}}});
    expect(JSON.stringify(guide)).toContain('Read layer tree, selected IDs and locks');
    const discovery=await server.dispatch({method:'tools/call',params:{name:'studio_discover_tools',arguments:{groups:['local'],expand:true}}});
    expect(JSON.stringify(discovery)).toContain('edit_brush_stroke');
  } finally {await server.close();}
});
