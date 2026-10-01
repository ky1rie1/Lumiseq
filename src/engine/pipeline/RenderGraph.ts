// src/engine/pipeline/RenderGraph.ts
//! WebGL 2.0 Multi-Pass Framebuffer Object (FBO) RenderGraph Manager

export class RenderGraph {
  private gl: WebGL2RenderingContext;
  private width: number = 0;
  private height: number = 0;

  private fboA: WebGLFramebuffer | null = null;
  private texA: WebGLTexture | null = null;

  private fboB: WebGLFramebuffer | null = null;
  private texB: WebGLTexture | null = null;

  private quadBuffer: WebGLBuffer | null = null;
  private currentReadTex: WebGLTexture | null = null;
  private currentWriteFbo: WebGLFramebuffer | null = null;
  private floatVerified = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.initQuadBuffer();
  }

  private initQuadBuffer(): void {
    const gl = this.gl;
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -1.0, -1.0, 0.0, 0.0,
         1.0, -1.0, 1.0, 0.0,
        -1.0,  1.0, 0.0, 1.0,
         1.0,  1.0, 1.0, 1.0,
      ]),
      gl.STATIC_DRAW
    );
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height && this.fboA && this.fboB) {
      return;
    }

    this.width = width;
    this.height = height;
    const gl = this.gl;

    this.disposeFBOs();

    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('Half-float working buffers are unavailable; use CPU rendering.');
    try {

    // Allocate FBO A & Texture A
    this.texA = this.createFBOTexture(width, height);
    this.fboA = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texA, 0);
    this.checkTarget();
    if (!this.floatVerified) {
      gl.clearBufferfv(gl.COLOR, 0, new Float32Array([1.25, .125, 2, 1]));
      const pixel = new Float32Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, pixel);
      if (gl.getError() !== gl.NO_ERROR || pixel.some((value, index) => !Number.isFinite(value) || Math.abs(value - [1.25, .125, 2, 1][index]) > .002)) {
        throw new Error('Half-float HDR readback verification failed; use CPU rendering.');
      }
      this.floatVerified = true;
    }

    // Allocate FBO B & Texture B
    this.texB = this.createFBOTexture(width, height);
    this.fboB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.texB, 0);
    this.checkTarget();

    } catch (error) {
      this.disposeFBOs();
      throw error;
    } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
  }

  private checkTarget(): void {
    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE || this.gl.getError() !== this.gl.NO_ERROR) {
      throw new Error('Half-float framebuffer is incomplete; use CPU rendering.');
    }
  }

  private createFBOTexture(width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error('Could not allocate half-float working texture.');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // Never silently quantize linear dark tones or clip HDR into RGBA8.
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    return tex;
  }

  /**
   * Begins multi-pass pipeline from initial source texture.
   */
  begin(initialSourceTexture: WebGLTexture): void {
    this.currentReadTex = initialSourceTexture;
    this.currentWriteFbo = this.fboA;
  }

  get readTexture(): WebGLTexture {
    if (!this.currentReadTex) throw new Error('Render graph has no input texture');
    return this.currentReadTex;
  }

  /** Attach a quality-stage output; the next graph target remains a separate texture. */
  replaceReadTexture(texture: WebGLTexture): void { this.currentReadTex = texture; }

  /**
   * Renders a pass reading from currentReadTex and writing to currentWriteFbo (or screen if isFinalPass).
   */
  runPass(
    program: WebGLProgram,
    setupUniforms: (readTex: WebGLTexture) => void,
    isFinalPass: boolean = false
  ): void {
    const gl = this.gl;

    gl.useProgram(program);
    gl.viewport(0, 0, this.width, this.height);

    const targetFbo = isFinalPass ? null : this.currentWriteFbo;
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo);

    // Bind Quad attributes
    const aPosition = gl.getAttribLocation(program, 'a_position');
    const aTexCoord = gl.getAttribLocation(program, 'a_texCoord');

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    if (aPosition >= 0) {
      gl.enableVertexAttribArray(aPosition);
      gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 16, 0);
    }
    if (aTexCoord >= 0) {
      gl.enableVertexAttribArray(aTexCoord);
      gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 16, 8);
    }

    // Call uniform setup with current read texture
    if (this.currentReadTex) {
      setupUniforms(this.currentReadTex);
    }

    // Draw full-screen quad
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!isFinalPass) {
      // Ping-pong swap
      this.currentReadTex = this.currentWriteFbo === this.fboA ? this.texA : this.texB;
      this.currentWriteFbo = this.currentWriteFbo === this.fboA ? this.fboB : this.fboA;
    }
  }

  dispose(): void {
    this.disposeFBOs();
    if (this.quadBuffer) {
      this.gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }
  }

  private disposeFBOs(): void {
    const gl = this.gl;
    if (this.fboA) { gl.deleteFramebuffer(this.fboA); this.fboA = null; }
    if (this.texA) { gl.deleteTexture(this.texA); this.texA = null; }
    if (this.fboB) { gl.deleteFramebuffer(this.fboB); this.fboB = null; }
    if (this.texB) { gl.deleteTexture(this.texB); this.texB = null; }
  }
}
