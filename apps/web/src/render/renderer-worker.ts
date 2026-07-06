import * as Comlink from 'comlink';
import type { LineBatch } from 'scene';

export interface Viewport {
  /** Screen-pixel offset of the document origin. */
  panX: number;
  panY: number;
  /** Pixels per millimetre. */
  zoom: number;
  width: number;
  height: number;
  dpr: number;
}

const VERTEX_SRC = `#version 300 es
in vec2 a_pos;
uniform vec2 u_pan;
uniform float u_zoom;
uniform vec2 u_size;
void main() {
  // document mm (Y-up) -> screen px (Y-down) -> clip space
  vec2 screen = vec2(a_pos.x * u_zoom + u_pan.x, -a_pos.y * u_zoom + u_pan.y);
  vec2 clip = vec2(screen.x / u_size.x * 2.0 - 1.0, 1.0 - screen.y / u_size.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FRAGMENT_SRC = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 outColor;
void main() { outColor = u_color; }`;

function hexToRgba(hex: string): [number, number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
}

class Renderer {
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private uPan: WebGLUniformLocation | null = null;
  private uZoom: WebGLUniformLocation | null = null;
  private uSize: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private canvas: OffscreenCanvas | null = null;

  init(canvas: OffscreenCanvas): boolean {
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: true });
    if (!gl) return false;
    this.canvas = canvas;
    this.gl = gl;

    const program = link(gl, VERTEX_SRC, FRAGMENT_SRC);
    this.program = program;
    gl.useProgram(program);
    this.uPan = gl.getUniformLocation(program, 'u_pan');
    this.uZoom = gl.getUniformLocation(program, 'u_zoom');
    this.uSize = gl.getUniformLocation(program, 'u_size');
    this.uColor = gl.getUniformLocation(program, 'u_color');

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const loc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    return true;
  }

  draw(batches: LineBatch[], viewport: Viewport, selection?: Float32Array): void {
    const { gl, program } = this;
    if (!gl || !program || !this.canvas) return;

    const pxW = Math.round(viewport.width * viewport.dpr);
    const pxH = Math.round(viewport.height * viewport.dpr);
    if (this.canvas.width !== pxW) this.canvas.width = pxW;
    if (this.canvas.height !== pxH) this.canvas.height = pxH;
    gl.viewport(0, 0, pxW, pxH);
    gl.clearColor(0.043, 0.055, 0.075, 1); // #0b0e13
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniform2f(this.uPan, viewport.panX * viewport.dpr, viewport.panY * viewport.dpr);
    gl.uniform1f(this.uZoom, viewport.zoom * viewport.dpr);
    gl.uniform2f(this.uSize, pxW, pxH);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

    for (const batch of batches) {
      if (batch.segments.length === 0) continue;
      gl.bufferData(gl.ARRAY_BUFFER, batch.segments, gl.DYNAMIC_DRAW);
      const [r, g, b, a] = hexToRgba(batch.color);
      gl.uniform4f(this.uColor, r, g, b, a);
      gl.drawArrays(gl.LINES, 0, batch.segments.length / 2);
    }

    if (selection && selection.length > 0) {
      gl.bufferData(gl.ARRAY_BUFFER, selection, gl.DYNAMIC_DRAW);
      gl.uniform4f(this.uColor, 0.94, 0.4, 0.23, 1); // accent
      gl.drawArrays(gl.LINES, 0, selection.length / 2);
    }
  }
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('createShader failed');
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`shader compile: ${gl.getShaderInfoLog(shader) ?? ''}`);
    }
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error('createProgram failed');
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`link: ${gl.getProgramInfoLog(program) ?? ''}`);
  }
  return program;
}

export type RendererApi = Renderer;
Comlink.expose(new Renderer());
