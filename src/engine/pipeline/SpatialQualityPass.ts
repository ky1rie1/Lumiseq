import { SPATIAL_VERTEX_SHADER } from '../shaders/passSpatialFilter';
import type { RawSpatialAnalysis } from '../../app/rawSpatialAnalysis';
import type { DevelopSettings } from '../../types/develop';
import { RenderGraph } from './RenderGraph';

const head = `#version 300 es
precision highp float;
in vec2 v_texCoord; out vec4 outColor;
uniform sampler2D u_image;`;
const encode = head+`
void main(){ vec4 c=texture(u_image,v_texCoord);vec3 q=sign(c.rgb)*sqrt(abs(c.rgb));
outColor=vec4(dot(q,vec3(.25,.5,.25)),q.r-q.g,q.b-q.g,c.a); }`;
const blur = head+`
uniform vec2 u_step;
void main(){outColor=(texture(u_image,v_texCoord-2.0*u_step)+4.0*texture(u_image,v_texCoord-u_step)
+6.0*texture(u_image,v_texCoord)+4.0*texture(u_image,v_texCoord+u_step)+texture(u_image,v_texCoord+2.0*u_step))/16.0;}`;
const accumulate = head+`
uniform sampler2D u_low; uniform sampler2D u_accum; uniform vec3 u_threshold;
void main(){ vec3 d=texture(u_image,v_texCoord).rgb-texture(u_low,v_texCoord).rgb;
vec3 shrunk=sign(d)*max(vec3(0),abs(d)-u_threshold);
outColor=vec4(texture(u_accum,v_texCoord).rgb+shrunk,1); }`;
const decode = head+`
uniform sampler2D u_accum; uniform sampler2D u_original;
void main(){vec3 q=texture(u_image,v_texCoord).rgb+texture(u_accum,v_texCoord).rgb;
float g=q.x-.25*q.y-.25*q.z;vec3 c=vec3(g+q.y,g,g+q.z);
outColor=vec4(sign(c)*c*c,texture(u_original,v_texCoord).a);}`;
const haze = head+`
uniform sampler2D u_coefficients; uniform vec4 u_source_rect;
uniform vec3 u_atmosphere; uniform float u_amount;
void main(){vec4 c=texture(u_image,v_texCoord);
vec2 globalUV=u_source_rect.xy+vec2(v_texCoord.x,1.0-v_texCoord.y)*u_source_rect.zw;
vec2 ab=texture(u_coefficients,globalUV).rg;
float dark=clamp(ab.x*dot(c.rgb,vec3(.2126,.7152,.0722))+ab.y,0.0,1.0);
vec3 rgb=u_amount>0.0 ? u_atmosphere+(c.rgb-u_atmosphere)/max(.15,1.0-.9*u_amount/100.0*dark)
:mix(c.rgb,u_atmosphere,-u_amount/100.0*.26);
outColor=vec4(rgb,c.a);}`;

interface Target { texture:WebGLTexture; fbo:WebGLFramebuffer }

/** Three real undecimated wavelet levels plus globally guided physical haze restoration. */
export class SpatialQualityPass {
  private programs:WebGLProgram[]=[];
  private targets:Target[]=[];
  private quad:WebGLBuffer;
  private dimensions='';
  constructor(private gl:WebGL2RenderingContext) {
    const quad=gl.createBuffer(); if(!quad)throw new Error('Quality quad allocation failed');this.quad=quad;
    gl.bindBuffer(gl.ARRAY_BUFFER,quad);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,0,0,1,-1,1,0,-1,1,0,1,1,1,1,1]),gl.STATIC_DRAW);
    try { for(const source of [encode,blur,accumulate,decode,haze]) this.programs.push(this.compile(source)); }
    catch(error){this.dispose();throw error;}
  }
  private compile(fragment:string):WebGLProgram {
    const gl=this.gl,shaders:WebGLShader[]=[];let program:WebGLProgram|null=null;
    try {
      for(const [kind,source] of [[gl.VERTEX_SHADER,SPATIAL_VERTEX_SHADER],[gl.FRAGMENT_SHADER,fragment]] as const){
        const shader=gl.createShader(kind);if(!shader)throw new Error('Quality shader allocation failed');shaders.push(shader);
        gl.shaderSource(shader,source);gl.compileShader(shader);
        if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(shader)||'Quality shader compilation failed');
      }
      program=gl.createProgram();if(!program)throw new Error('Quality program allocation failed');
      for(const shader of shaders)gl.attachShader(program,shader);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Quality link failed');
      return program;
    }catch(error){if(program)gl.deleteProgram(program);throw error;}
    finally{for(const shader of shaders)gl.deleteShader(shader);}
  }
  private allocate(width:number,height:number):void {
    if(this.dimensions===`${width}:${height}`)return;
    this.disposeTargets();const gl=this.gl;
    try {for(let i=0;i<5;i++){
      const texture=gl.createTexture(),fbo=gl.createFramebuffer();
      if(!texture||!fbo){if(texture)gl.deleteTexture(texture);if(fbo)gl.deleteFramebuffer(fbo);throw new Error('Wavelet buffer allocation failed');}
      this.targets.push({texture,fbo});gl.bindTexture(gl.TEXTURE_2D,texture);
      for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);
      for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,param,gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,width,height,0,gl.RGBA,gl.FLOAT,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,fbo);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Wavelet floating point target unavailable');
    }this.dimensions=`${width}:${height}`;}catch(error){this.disposeTargets();throw error;}
  }
  private bind(program:WebGLProgram,name:string,texture:WebGLTexture,unit:number):void {
    const gl=this.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.uniform1i(gl.getUniformLocation(program,name),unit);
  }
  private draw(index:number,target:Target,width:number,height:number,setup:(p:WebGLProgram)=>void):void {
    const gl=this.gl,p=this.programs[index];gl.useProgram(p);gl.bindFramebuffer(gl.FRAMEBUFFER,target.fbo);gl.viewport(0,0,width,height);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.quad);
    for(const [name,offset] of [['a_position',0],['a_texCoord',8]] as const){const a=gl.getAttribLocation(p,name);if(a>=0){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,2,gl.FLOAT,false,16,offset);}}
    setup(p);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
  denoise(graph:RenderGraph,width:number,height:number,settings:DevelopSettings,analysis:RawSpatialAnalysis,pixelScale:number):void {
    const luma=settings.detail.lumaDenoise/100,chroma=settings.detail.chromaDenoise/100;
    if((!luma&&!chroma)||analysis.noise.every(v=>v===0))return;
    this.allocate(width,height);const gl=this.gl,original=graph.readTexture;
    let low=this.targets[0],next=this.targets[1],sum=this.targets[3],nextSum=this.targets[4];const temp=this.targets[2];
    this.draw(0,low,width,height,p=>this.bind(p,'u_image',original,0));
    gl.bindFramebuffer(gl.FRAMEBUFFER,sum.fbo);gl.clearBufferfv(gl.COLOR,0,new Float32Array([0,0,0,0]));
    const factors=[1,.22526345103699957,.0959899628755893];
    for(let level=0;level<3;level++){
      const spacing=(1<<level)*pixelScale;
      this.draw(1,temp,width,height,p=>{this.bind(p,'u_image',low.texture,0);gl.uniform2f(gl.getUniformLocation(p,'u_step'),spacing/width,0);});
      this.draw(1,next,width,height,p=>{this.bind(p,'u_image',temp.texture,0);gl.uniform2f(gl.getUniformLocation(p,'u_step'),0,spacing/height);});
      this.draw(2,nextSum,width,height,p=>{
        this.bind(p,'u_image',low.texture,0);this.bind(p,'u_low',next.texture,1);this.bind(p,'u_accum',sum.texture,2);
        const f=factors[level]*Math.min(1,pixelScale);
        gl.uniform3f(gl.getUniformLocation(p,'u_threshold'),analysis.noise[0]*f*luma,analysis.noise[1]*f*chroma,analysis.noise[2]*f*chroma);
      });
      [low,next]=[next,low];[sum,nextSum]=[nextSum,sum];
    }
    this.draw(3,temp,width,height,p=>{this.bind(p,'u_image',low.texture,0);this.bind(p,'u_accum',sum.texture,1);this.bind(p,'u_original',original,2);});
    graph.replaceReadTexture(temp.texture);
  }
  dehaze(graph:RenderGraph,analysis:RawSpatialAnalysis,amount:number,rect:[number,number,number,number]):void {
    if(!amount)return;const gl=this.gl,profile=analysis.haze,texture=gl.createTexture();
    if(!texture)throw new Error('Haze profile texture allocation failed');
    try{
      gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_2D,texture);
      for(const param of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,param,gl.CLAMP_TO_EDGE);
      for(const param of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,param,gl.LINEAR);
      const buffer=new Float32Array(profile.width*profile.height*4);
      for(let i=0;i<profile.width*profile.height;i++){buffer[i*4]=profile.coefficients[i*2];buffer[i*4+1]=profile.coefficients[i*2+1];}
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,profile.width,profile.height,0,gl.RGBA,gl.FLOAT,buffer);
      const p=this.programs[4];graph.runPass(p,read=>{
        this.bind(p,'u_image',read,0);this.bind(p,'u_coefficients',texture,3);
        gl.uniform4f(gl.getUniformLocation(p,'u_source_rect'),...rect);
        gl.uniform3f(gl.getUniformLocation(p,'u_atmosphere'),...profile.atmosphere);
        gl.uniform1f(gl.getUniformLocation(p,'u_amount'),amount);
      });
    }finally{gl.deleteTexture(texture);}
  }
  private disposeTargets():void {for(const t of this.targets){this.gl.deleteFramebuffer(t.fbo);this.gl.deleteTexture(t.texture);}this.targets=[];this.dimensions='';}
  dispose():void {this.disposeTargets();for(const p of this.programs)this.gl.deleteProgram(p);this.programs=[];if(this.quad)this.gl.deleteBuffer(this.quad);}
}
