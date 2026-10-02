import { expect, it, vi } from 'vitest';
import { RenderGraph } from './RenderGraph';
function device(extension = true, complete = true, hdr = true) {
 const uploads: unknown[][] = [];
 const gl = new Proxy({ RGBA16F: 1, RGBA32F: 6, RGBA: 2, HALF_FLOAT: 3, FLOAT: 4, FRAMEBUFFER_COMPLETE: 5, NO_ERROR: 0,
  getExtension: () => extension ? {} : null, getError: () => 0,
  checkFramebufferStatus: () => complete ? 5 : 0,
  createBuffer: () => ({}), createTexture: () => ({}), createFramebuffer: () => ({}),
  texImage2D: (...args: unknown[]) => uploads.push(args),
  readPixels: (...args: unknown[]) => (args[6] as Float32Array).set(hdr ? [1.0001234,-.125,.000001,1] : [1,-.125,0,1]),
 }, { get: (target,key) => Reflect.get(target,key) ?? vi.fn() }) as unknown as WebGL2RenderingContext;
 return { gl, uploads };
}
it('allocates verified RGBA32F working targets without half-float significand loss',()=>{
 const {gl,uploads}=device(); const graph=new RenderGraph(gl); graph.resize(8,4);
 expect(uploads.every(args=>args[2]===gl.RGBA32F && args[7]===gl.FLOAT)).toBe(true);
});
it.each([[false,true,true],[true,false,true],[true,true,false]])('rejects unreliable float targets (%s %s %s)',(extension,complete,hdr)=>{
 const {gl}=device(extension,complete,hdr);
 expect(()=>new RenderGraph(gl).resize(8,4)).toThrow(/float|framebuffer|HDR/i);
});
