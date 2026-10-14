import type { AntSegments, DocumentPlacement } from './ants';
import { ANT_PHASES, antDashes, lineWidthFor } from './ants';

// Each edge is one instance: a quad around it, one device pixel wider than the line on every
// side for anti-aliasing, with square caps so corners are filled as by a mitred join.
const VERTEX_SHADER = `#version 300 es
layout(location = 0) in vec4 a_ends;
layout(location = 1) in vec2 a_dash;
uniform vec2 u_origin;
uniform vec2 u_scale;
uniform vec2 u_size;
uniform float u_half;
uniform float u_average;
out vec2 v_position;
out float v_length;
out float v_base;
out float v_unit;
out float v_still;
void main() {
  vec2 start = u_origin + a_ends.xy * u_scale;
  vec2 end = u_origin + a_ends.zw * u_scale;
  float len = length(end - start);
  vec2 along = (end - start) / len;
  vec2 across = vec2(-along.y, along.x);
  float reach = u_half + 1.0;
  float a = (gl_VertexID & 1) == 0 ? -reach : len + reach;
  float b = (gl_VertexID & 2) == 0 ? -reach : reach;
  vec2 p = start + along * a + across * b;
  gl_Position = vec4(p.x / u_size.x * 2.0 - 1.0, 1.0 - p.y / u_size.y * 2.0, 0.0, 1.0);
  v_position = vec2(a, b);
  v_length = len;
  v_base = a_dash.x;
  // Dashes are measured at the average scale, as the 2D path measures them.
  v_unit = length(a_ends.zw - a_ends.xy) * u_average / len;
  v_still = a_dash.y;
}
`;

// Coverage is the pixel's overlap with the line (exact for axis-aligned edges), and the dark
// share of the dash pattern over the pixel's span along the edge, so dash ends are smooth.
// Moving loops blend as the 2D path draws them, a white line and then black dashes over it,
// each anti-aliased; still loops are black alone.
const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_position;
in float v_length;
in float v_base;
in float v_unit;
in float v_still;
uniform float u_half;
uniform float u_period;
uniform float u_offset;
out vec4 color;
float dark(float x) {
  float half_period = 0.5 * u_period;
  return floor(x / u_period) * half_period + min(mod(x, u_period), half_period);
}
void main() {
  float across = max(0.0, min(v_position.y + 0.5, u_half) - max(v_position.y - 0.5, -u_half));
  float low = max(v_position.x - 0.5, -u_half);
  float high = min(v_position.x + 0.5, v_length + u_half);
  float coverage = across * max(0.0, high - low);
  if (coverage <= 0.0) discard;
  if (v_still > 0.5) {
    color = vec4(0.0, 0.0, 0.0, coverage);
    return;
  }
  float start = v_base - u_offset;
  float shade = (dark(start + high * v_unit) - dark(start + low * v_unit)) / ((high - low) * v_unit);
  float dash = coverage * shade;
  float light = coverage * (1.0 - dash);
  color = vec4(light, light, light, dash + coverage * (1.0 - dash));
}
`;

/** What one frame of the ants shows. */
export interface GlAntsFrame {
  readonly segments: AntSegments;
  readonly placement: DocumentPlacement;
  readonly dpr: number;
  /** CSS pixels per canvas pixel. */
  readonly zoom: number;
  /** Animation step, 0 to `ANT_PHASES` − 1. */
  readonly phase: number;
}

interface Resources {
  readonly program: WebGLProgram;
  readonly vertices: WebGLVertexArrayObject;
  readonly ends: WebGLBuffer;
  readonly dashes: WebGLBuffer;
  readonly origin: WebGLUniformLocation | null;
  readonly scale: WebGLUniformLocation | null;
  readonly size: WebGLUniformLocation | null;
  readonly half: WebGLUniformLocation | null;
  readonly average: WebGLUniformLocation | null;
  readonly period: WebGLUniformLocation | null;
  readonly offset: WebGLUniformLocation | null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Could not create a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`Shader didn't compile: ${log}`);
  }
  return shader;
}

function createResources(gl: WebGL2RenderingContext): Resources {
  const program = gl.createProgram();
  const vertexShader = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program didn't link: ${gl.getProgramInfoLog(program) ?? ''}`);
  }
  const vertices = gl.createVertexArray();
  const ends = gl.createBuffer();
  const dashes = gl.createBuffer();
  gl.bindVertexArray(vertices);
  gl.bindBuffer(gl.ARRAY_BUFFER, ends);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(0, 1);
  gl.bindBuffer(gl.ARRAY_BUFFER, dashes);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  gl.vertexAttribDivisor(1, 1);
  gl.bindVertexArray(null);
  gl.enable(gl.BLEND);
  // Premultiplied colour, source over.
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  return {
    program,
    vertices,
    ends,
    dashes,
    origin: uniform('u_origin'),
    scale: uniform('u_scale'),
    size: uniform('u_size'),
    half: uniform('u_half'),
    average: uniform('u_average'),
    period: uniform('u_period'),
    offset: uniform('u_offset'),
  };
}

/** What the dash buffer was worked out for. */
interface DashKey {
  readonly segments: AntSegments;
  readonly scale: number;
  readonly zoom: number;
  readonly dpr: number;
}

function sameFrame(a: GlAntsFrame, b: GlAntsFrame): boolean {
  return (
    a.segments === b.segments &&
    a.dpr === b.dpr &&
    a.zoom === b.zoom &&
    a.phase === b.phase &&
    a.placement.x === b.placement.x &&
    a.placement.y === b.placement.y &&
    a.placement.scaleX === b.placement.scaleX &&
    a.placement.scaleY === b.placement.scaleY
  );
}

/**
 * Draws the selection's marching ants with WebGL 2, on a canvas of its own under the
 * overlay. The outline's edges go to the GPU once per outline, and where the dash pattern
 * starts on each, once per zoom; each frame is then a single draw call, whatever the pan and
 * phase, with lines and dashes anti-aliased exactly as the 2D overlay draws them.
 */
export class GlAnts {
  private resources: Resources | null;
  private uploaded: AntSegments | null = null;
  private dashKey: DashKey | null = null;
  private dashes = new Float32Array(0);
  /** The frame on the canvas, or null if it's blank. */
  private shown: GlAntsFrame | null = null;
  private lost = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly gl: WebGL2RenderingContext,
  ) {
    this.resources = createResources(gl);
    canvas.addEventListener('webglcontextlost', this.handleLost);
    canvas.addEventListener('webglcontextrestored', this.handleRestored);
  }

  /** A renderer drawing on `canvas`, or null where WebGL 2 isn't available. */
  static create(canvas: HTMLCanvasElement): GlAnts | null {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });
    if (!gl) return null;
    try {
      return new GlAnts(canvas, gl);
    } catch {
      return null;
    }
  }

  /** Sets the canvas's size in device pixels, which clears it. */
  resize(width: number, height: number): void {
    this.canvas.width = width;
    this.canvas.height = height;
    this.shown = null;
  }

  /** Draws `frame`, unless it's already showing; false if the context is lost. */
  draw(frame: GlAntsFrame): boolean {
    const resources = this.resources;
    if (this.lost || !resources) return false;
    if (this.shown && sameFrame(this.shown, frame)) return true;
    const { gl } = this;
    const { segments, placement, dpr, zoom } = frame;
    if (this.uploaded !== segments) {
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.ends);
      gl.bufferData(gl.ARRAY_BUFFER, segments.ends, gl.STATIC_DRAW);
      this.uploaded = segments;
    }
    const scale = (placement.scaleX + placement.scaleY) / 2;
    const key = this.dashKey;
    if (key?.segments !== segments || key.scale !== scale || key.zoom !== zoom || key.dpr !== dpr) {
      if (this.dashes.length < segments.count * 2) {
        this.dashes = new Float32Array(segments.count * 2);
      }
      const dashes = antDashes(segments, scale, zoom, dpr, this.dashes);
      gl.bindBuffer(gl.ARRAY_BUFFER, resources.dashes);
      gl.bufferData(gl.ARRAY_BUFFER, dashes, gl.DYNAMIC_DRAW, 0, segments.count * 2);
      this.dashKey = { segments, scale, zoom, dpr };
    }

    const { width, height } = this.canvas;
    const { lineWidth, nudge } = lineWidthFor(dpr);
    gl.viewport(0, 0, width, height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(resources.program);
    gl.bindVertexArray(resources.vertices);
    gl.uniform2f(resources.origin, placement.x + nudge, placement.y + nudge);
    gl.uniform2f(resources.scale, placement.scaleX, placement.scaleY);
    gl.uniform2f(resources.size, width, height);
    gl.uniform1f(resources.half, lineWidth / 2);
    gl.uniform1f(resources.average, scale);
    gl.uniform1f(resources.period, ANT_PHASES * dpr);
    gl.uniform1f(resources.offset, (frame.phase % ANT_PHASES) * dpr);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, segments.count);
    gl.bindVertexArray(null);
    this.shown = frame;
    return true;
  }

  /** Clears the canvas, if anything is on it. */
  clear(): void {
    if (!this.shown || this.lost) return;
    const { gl } = this;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.shown = null;
  }

  /** Removes the canvas and frees the GPU's memory. */
  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.handleLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleRestored);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.resources = null;
    this.canvas.remove();
  }

  private readonly handleLost = (e: Event): void => {
    // Allows the context to be restored.
    e.preventDefault();
    this.lost = true;
    this.resources = null;
    this.uploaded = null;
    this.dashKey = null;
    this.shown = null;
  };

  private readonly handleRestored = (): void => {
    try {
      this.resources = createResources(this.gl);
      this.lost = false;
    } catch {
      this.resources = null;
    }
  };
}
