// Minimal WebGL runner for full-canvas fragment shaders (no library, ~1 KB).
// Pauses when the page is hidden; renders a single still frame with reduced motion.

export type Uniforms = Record<string, number | number[]>;

const VERT = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

export interface ShaderSurface {
  stop(): void;
  set(u: Uniforms): void;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function mountShader(canvas: HTMLCanvasElement, frag: string, opts: { scale?: number; maxDpr?: number; fps?: number; uniforms?: () => Uniforms }): ShaderSurface | null {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  let prog: WebGLProgram;
  try {
    prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const locs = new Map<string, WebGLUniformLocation | null>();
  const uni = (name: string) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(prog, name));
    return locs.get(name)!;
  };
  let extra: Uniforms = {};
  const apply = (u: Uniforms) => {
    for (const [k, v] of Object.entries(u)) {
      const l = uni(k);
      if (!l) continue;
      if (typeof v === 'number') gl.uniform1f(l, v);
      else if (v.length === 2) gl.uniform2fv(l, v);
      else if (v.length === 3) gl.uniform3fv(l, v);
      else if (v.length === 4) gl.uniform4fv(l, v);
    }
  };

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr ?? 2) * (opts.scale ?? 1);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
    return [w, h];
  };

  const start = performance.now();
  const still = prefersReducedMotion();
  const minFrame = 1000 / (opts.fps ?? 60);
  let raf = 0;
  let last = 0;
  let running = true;

  const frame = (now: number) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden || now - last < minFrame - 1) return;
    last = now;
    const [w, h] = resize();
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    apply({ uRes: [w, h], uTime: still ? 12.0 : (now - start) / 1000, ...(opts.uniforms?.() ?? {}), ...extra });
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (still) {
      running = false;
      cancelAnimationFrame(raf);
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    stop() {
      running = false;
      cancelAnimationFrame(raf);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
    set(u: Uniforms) {
      extra = { ...extra, ...u };
      if (still && !running) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    },
  };
}

// Shared GLSL: cheap 3D value noise + fbm.
export const NOISE = `
float hash(vec3 p){p=fract(p*0.3183099+0.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float noise(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);
return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.0;float a=0.5;for(int i=0;i<4;i++){v+=a*noise(p);p*=2.03;a*=0.5;}return v;}
`;
