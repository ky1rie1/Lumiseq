import { afterEach, expect, it, vi } from 'vitest';
import { OpenAIProvider } from '../src/ai/providers/OpenAIProvider';
import { LocalProvider } from '../src/ai/providers/LocalProvider';
import { ClaudeProvider } from '../src/ai/providers/ClaudeProvider';
import { GeminiProvider } from '../src/ai/providers/GeminiProvider';
import type { AgentMessage, ProviderConfig } from '../src/ai/types';
import type { SecureVault } from '../src/ai/security/SecureVault';
const vault = { getProviderSecret: async () => '' } as SecureVault;
const config: ProviderConfig = { id:'test',name:'test',type:'openai',baseUrl:'https://example.test/v1',model:'test',enabled:true,isDefault:false };
const image = { mimeType:'image/png', data:'aGVsbG8=', observationId:'obs1' };
afterEach(() => vi.unstubAllGlobals());
for (const Provider of [OpenAIProvider, LocalProvider, ClaudeProvider, GeminiProvider]) {
  it(`${Provider.name} serializes multiple images as protocol blocks without duplicating legacy image`, async () => {
    let body: any;
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      body = JSON.parse(init.body as string);
      return Response.json({choices:[{message:{content:'ok'}}],content:[{type:'text',text:'ok'}],candidates:[{content:{parts:[{text:'ok'}]}}]});
    });
    const messages: AgentMessage[] = [{role:'user',content:'Compare',image,images:[image,{mimeType:'image/jpeg',data:'d29ybGQ=',observationId:'obs2'}]}];
    await new Provider(config,vault).chat(messages,[]);
    const blocks = body.messages?.[0].content ?? body.contents?.[0].parts;
    expect(blocks).toHaveLength(3);
    expect(JSON.stringify(blocks.filter((b:any)=>b.type==='text'||b.text))).not.toContain('aGVsbG8=');
    expect(JSON.stringify(body).match(/aGVsbG8=/g)).toHaveLength(1);
    expect(JSON.stringify(messages)).toContain('obs1');
  });
}
it('OpenAI defers tool images until all ordered tool responses have been sent',async()=>{
  let body:any;
  vi.stubGlobal('fetch',async(_url:string,init:RequestInit)=>{body=JSON.parse(init.body as string);return Response.json({choices:[{message:{content:'ok'}}]});});
  await new OpenAIProvider(config,vault).chat([
    {role:'assistant',toolCalls:[{id:'a',name:'inspect_document',arguments:{}},{id:'b',name:'get_layers',arguments:{}}]},
    {role:'tool',toolCallId:'a',name:'inspect_document',content:'{"evidence":{"observationId":"obs1"}}',images:[image]},
    {role:'tool',toolCallId:'b',name:'get_layers',content:'{}'},
  ],[]);
  expect(body.messages.map((m:any)=>m.role)).toEqual(['assistant','tool','tool','user']);
  expect(body.messages[1].content).not.toContain(image.data);
  expect(body.messages[3].content[1].image_url.url).toContain(image.data);
});
it('rejects malformed image data before any request',async()=>{
  const fetch=vi.fn(async()=>Response.json({choices:[{message:{content:'ok'}}]}));vi.stubGlobal('fetch',fetch);
  await expect(new OpenAIProvider(config,vault).chat([{role:'user',images:[{mimeType:'text/plain',data:'secret'}]}],[])).rejects.toThrow(/image/i);
  expect(fetch).not.toHaveBeenCalled();
});
it('honors negotiated image limits without silently resizing evidence pixels',async()=>{
 const fetch=vi.fn(async()=>Response.json({choices:[{message:{content:'ok'}}]}));vi.stubGlobal('fetch',fetch);
 const provider=new OpenAIProvider({...config,imageLimits:{maxImages:1,maxImageBytes:4,maxTotalBytes:4}},vault);
 await expect(provider.chat([{role:'user',images:[image]}],[])).rejects.toThrow(/limit/);expect(fetch).not.toHaveBeenCalled();
});
it('bounds actual serialized payload including tool schemas',async()=>{
 const fetch=vi.fn(async()=>Response.json({choices:[{message:{content:'ok'}}]}));vi.stubGlobal('fetch',fetch);
 const schema={name:'large',description:'x'.repeat(32*1024*1024),workspace:'any' as const,category:'read' as const,riskLevel:'safe' as const,parameters:{type:'object' as const,properties:{},required:[]}};
 await expect(new OpenAIProvider(config,vault).chat([{role:'user',images:[image]}],[schema])).rejects.toThrow(/request.*limit/i);expect(fetch).not.toHaveBeenCalled();
});
it('Claude nests tool images in result content while Gemini preserves ordered tool responses before image reads',async()=>{
 for(const Provider of [ClaudeProvider,GeminiProvider]){
  let body:any;vi.stubGlobal('fetch',async(_url:string,init:RequestInit)=>{body=JSON.parse(init.body as string);return Response.json({content:[{type:'text',text:'ok'}],candidates:[{content:{parts:[{text:'ok'}]}}]});});
  await new Provider(config,vault).chat([{role:'assistant',toolCalls:[{id:'a',name:'inspect_document',arguments:{}}]},{role:'tool',name:'inspect_document',toolCallId:'a',content:JSON.stringify({evidence:{observationId:'obs1'},preview:'data:image/png;base64,aGVsbG8='}),images:[image]}],[]);
  if(Provider===ClaudeProvider){expect(body.messages[1].content[0].content[1]).toEqual({type:'image',source:{type:'base64',media_type:'image/png',data:image.data}});expect(body.messages[1].content[0].content[0].text).not.toContain(image.data);}
  else{expect(body.contents[1].parts[0].functionResponse.id).toBe('a');expect(body.contents[2].parts[1].inlineData.data).toBe(image.data);expect(body.contents[1].parts[0].functionResponse.response.content).not.toContain(image.data);}
 }
});
