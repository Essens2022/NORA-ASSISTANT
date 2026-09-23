// Living background: a slow aurora field whose palette follows the time of day.
// Rendered at a fraction of the screen resolution – soft by nature and cheap.
import { useEffect, useRef } from 'preact/hooks';
import { mountShader, NOISE, prefersReducedMotion } from './gl.ts';

const FRAG = `precision mediump float;
uniform vec2 uRes;uniform float uTime;uniform vec3 uA;uniform vec3 uB;uniform vec3 uC;uniform float uI;
${NOISE}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float t=uTime*0.045;
  vec3 p=vec3(uv*vec2(1.3,2.0),t);
  float n=fbm(p+vec3(0.0,t*0.5,0.0));
  float m=fbm(vec3(uv*2.2+n*1.6,t*1.4));
  vec3 col=mix(uA,uB,smoothstep(0.25,0.75,m));
  col=mix(col,uC,smoothstep(0.55,0.9,n*m*1.9));
  float veil=smoothstep(0.1,0.95,uv.y)*(0.55+0.45*m);
  float a=uI*veil;
  gl_FragColor=vec4(col*a,a);
}`;

type Pal = [number[], number[], number[]];
function paletteForHour(h: number): Pal {
  if (h >= 5 && h < 11) return [[1.0, 0.62, 0.38], [1.0, 0.82, 0.45], [0.55, 0.45, 1.0]]; // dawn: peach, gold, lilac
  if (h >= 11 && h < 17) return [[0.25, 0.75, 1.0], [0.45, 0.4, 1.0], [0.4, 1.0, 0.85]]; // day: sky, violet, mint
  if (h >= 17 && h < 22) return [[0.45, 0.3, 1.0], [1.0, 0.42, 0.62], [1.0, 0.72, 0.32]]; // evening: violet, rose, gold
  return [[0.2, 0.2, 0.75], [0.35, 0.2, 0.85], [0.2, 0.75, 0.85]]; // night: indigo, purple, teal
}

export function Aurora() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const s = mountShader(ref.current, FRAG, {
      scale: 0.3,
      maxDpr: 1,
      fps: 30,
      uniforms: () => {
        const [a, b, c] = paletteForHour(new Date().getHours());
        const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
        return { uA: a, uB: b, uC: c, uI: dark ? 0.42 : 0.3 };
      },
    });
    if (!s) ref.current.classList.add('aurora-css');
    return () => s?.stop();
  }, []);
  return <canvas ref={ref} class={`aurora-canvas${prefersReducedMotion() ? ' still' : ''}`} aria-hidden="true" />;
}
