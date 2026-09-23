// NORA as a living organism: a GPU-rendered fluid sphere.
//  idle      – slow breathing, gentle currents
//  listening – surface follows your voice, a ring of sound waves around it
//  thinking  – currents speed up and shift colour
//  speaking  – ripples travel outwards from the core
import { useEffect, useRef, useState } from 'preact/hooks';
import { getState, type VoiceState } from '../state/store.ts';
import { mountShader, NOISE, type ShaderSurface } from './gl.ts';

const FRAG = `precision highp float;
uniform vec2 uRes;uniform float uTime;uniform float uLevel;uniform float uMode;uniform float uDark;
${NOISE}
vec3 pal(float t){
  vec3 violet=vec3(0.42,0.29,1.0);vec3 gold=vec3(1.0,0.72,0.32);vec3 cyan=vec3(0.25,0.86,1.0);vec3 rose=vec3(1.0,0.42,0.62);
  vec3 c=mix(violet,cyan,smoothstep(0.0,0.35,t));c=mix(c,gold,smoothstep(0.35,0.7,t));return mix(c,rose,smoothstep(0.75,1.0,t));
}
void main(){
  vec2 uv=(gl_FragCoord.xy-0.5*uRes)/min(uRes.x,uRes.y);
  float think=step(1.5,uMode)*step(uMode,2.5);
  float listen=step(0.5,uMode)*step(uMode,1.5);
  float speak=step(2.5,uMode);
  float t=uTime*(0.22+0.9*think+0.35*speak);
  float r=length(uv);float ang=atan(uv.y,uv.x);
  vec3 dir=vec3(cos(ang),sin(ang),0.0);
  float wob=fbm(dir*0.9+vec3(0.0,0.0,t*0.6))-0.5;
  float breath=0.012*sin(uTime*1.6);
  float R=0.30+breath+wob*(0.045+0.2*uLevel*listen+0.04*think+0.02*speak)+0.025*uLevel;
  float inside=smoothstep(R,R-0.006,r);

  // fluid interior (domain-warped fbm)
  vec3 p=vec3(uv*2.6,t);
  vec2 q=vec2(fbm(p),fbm(p+vec3(5.2,1.3,2.1)));
  vec2 w=vec2(fbm(vec3(uv*2.0+1.6*q,t*1.2)),fbm(vec3(uv*2.0+1.6*q+3.7,t*1.2)));
  float f=fbm(vec3(uv*2.0+1.8*w,t*0.7));
  float hueShift=0.18*sin(uTime*0.15)+0.35*think;
  vec3 col=pal(0.5+0.5*sin((f*1.4+q.x*0.8+hueShift)*6.2831));
  col=mix(col,pal(0.5+0.5*sin((w.y+0.35+hueShift)*6.2831)),0.45);
  col=mix(col,vec3(0.95,0.93,1.0),0.12);

  // sphere shading
  float z=sqrt(max(0.0,R*R-r*r))/R;
  col*=0.5+0.6*z;
  col+=pow(1.0-z,3.0)*vec3(0.6,0.8,1.0)*0.7;
  vec2 hl=uv-vec2(-0.1,0.12);col+=0.28*exp(-dot(hl,hl)*90.0);

  // speaking ripples inside
  col+=speak*0.25*smoothstep(0.6,1.0,sin(r*55.0-uTime*7.0))*z;

  // halo
  float d=max(r-R,0.0);
  float halo=exp(-d*(11.0-5.0*uLevel))*(0.3+0.5*uLevel+0.15*think+0.12*uDark)*smoothstep(0.5,0.36,r);
  vec3 hc=mix(pal(0.15),pal(0.55),0.5+0.5*sin(ang*2.0+uTime*0.4));
  hc=mix(hc,vec3(1.0),0.45*(1.0-uDark)); // light theme: luminous, never grey

  // listening: ring of sound bars
  float seg=floor((ang+3.14159)/6.28318*72.0);
  float barLen=0.02+0.11*uLevel*(0.35+0.65*noise(vec3(seg*0.37,uTime*6.0,0.0)));
  float inRing=step(R+0.03,r)*step(r,R+0.03+barLen);
  float barMask=smoothstep(0.18,0.32,fract((ang+3.14159)/6.28318*72.0))*smoothstep(0.82,0.68,fract((ang+3.14159)/6.28318*72.0));
  vec3 ring=listen*inRing*barMask*pal(fract(seg/72.0+uTime*0.05))*1.1;
  float ringA=listen*inRing*barMask*0.9;

  float a=max(inside,halo*(1.0-inside));
  vec3 outc=mix(hc*halo,col,inside);
  a=max(a,ringA);outc=mix(outc,ring,ringA*(1.0-inside));
  gl_FragColor=vec4(outc*a,a);
}`;

const MODE: Record<VoiceState, number> = { idle: 0, listening: 1, processing: 2, speaking: 3 };

export function Organism({ state }: { state: VoiceState }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const surf = useRef<ShaderSurface | null>(null);
  const [fallback, setFallback] = useState(false);
  const smooth = useRef(0);

  useEffect(() => {
    if (!ref.current) return;
    surf.current = mountShader(ref.current, FRAG, {
      maxDpr: 1.75,
      uniforms: () => {
        // smooth the microphone level so the surface flows instead of jittering
        const target = getState().level;
        smooth.current += (target - smooth.current) * (target > smooth.current ? 0.35 : 0.08);
        const th = document.documentElement.dataset.theme;
        const dark = th === 'dark' || (!th && matchMedia('(prefers-color-scheme: dark)').matches);
        return { uLevel: smooth.current, uDark: dark ? 1 : 0 };
      },
    });
    if (!surf.current) setFallback(true);
    return () => surf.current?.stop();
  }, []);

  useEffect(() => {
    surf.current?.set({ uMode: MODE[state] });
  }, [state]);

  return (
    <span class={`organism${fallback ? ' fallback' : ''}`} aria-hidden="true">
      <canvas ref={ref} class="organism-canvas" />
      {fallback && (
        <span class="orb-core">
          <span class="orb-swirl" />
          <span class="orb-swirl two" />
          <span class="orb-shine" />
        </span>
      )}
    </span>
  );
}
