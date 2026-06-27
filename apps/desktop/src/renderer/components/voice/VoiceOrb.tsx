import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

interface VoiceOrbProps {
  state: VoiceState;
  audioLevel?: number;
  size?: number;
  className?: string;
}

// ─── 4D Simplex noise (shared by vertex + fragment) ────────────────────────
const NOISE_GLSL = /* glsl */ `
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
float mod289(float x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
float permute(float x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float taylorInvSqrt(float r){return 1.79284291400159-0.85373472095314*r;}
vec4 grad4(float j,vec4 ip){
  const vec4 ones=vec4(1.0,1.0,1.0,-1.0);
  vec4 p,s;
  p.xyz=floor(fract(vec3(j)*ip.xyz)*7.0)*ip.z-1.0;
  p.w=1.5-dot(abs(p.xyz),ones.xyz);
  s=vec4(lessThan(p,vec4(0.0)));
  p.xyz=p.xyz+(s.xyz*2.0-1.0)*s.www;
  return p;
}
#define F4 0.309016994374947451
float snoise(vec4 v){
  const vec4 C=vec4(0.138196601125011,0.276393202250021,0.414589803375032,-0.447213595499958);
  vec4 i=floor(v+dot(v,vec4(F4)));
  vec4 x0=v-i+dot(i,C.xxxx);
  vec4 i0;vec3 isX=step(x0.yzw,x0.xxx);vec3 isYZ=step(x0.zww,x0.yyz);
  i0.x=isX.x+isX.y+isX.z;i0.yzw=1.0-isX;
  i0.y+=isYZ.x+isYZ.y;i0.zw+=1.0-isYZ.xy;i0.z+=isYZ.z;i0.w+=1.0-isYZ.z;
  vec4 i3=clamp(i0,0.0,1.0);vec4 i2=clamp(i0-1.0,0.0,1.0);vec4 i1=clamp(i0-2.0,0.0,1.0);
  vec4 x1=x0-i1+C.xxxx;vec4 x2=x0-i2+C.yyyy;vec4 x3=x0-i3+C.zzzz;vec4 x4=x0+C.wwww;
  i=mod289(i);
  float j0=permute(permute(permute(permute(i.w)+i.z)+i.y)+i.x);
  vec4 j1=permute(permute(permute(permute(
    i.w+vec4(i1.w,i2.w,i3.w,1.0))+i.z+vec4(i1.z,i2.z,i3.z,1.0))
    +i.y+vec4(i1.y,i2.y,i3.y,1.0))+i.x+vec4(i1.x,i2.x,i3.x,1.0));
  vec4 ip=vec4(1.0/294.0,1.0/49.0,1.0/7.0,0.0);
  vec4 p0=grad4(j0,ip);vec4 p1=grad4(j1.x,ip);vec4 p2=grad4(j1.y,ip);
  vec4 p3=grad4(j1.z,ip);vec4 p4=grad4(j1.w,ip);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;p4*=taylorInvSqrt(dot(p4,p4));
  vec3 m0=max(0.6-vec3(dot(x0,x0),dot(x1,x1),dot(x2,x2)),0.0);
  vec2 m1=max(0.6-vec2(dot(x3,x3),dot(x4,x4)),0.0);
  m0=m0*m0;m1=m1*m1;
  return 49.0*(dot(m0*m0,vec3(dot(p0,x0),dot(p1,x1),dot(p2,x2)))+dot(m1*m1,vec2(dot(p3,x3),dot(p4,x4))));
}
`;

// ─── Vertex: gentle glass-sphere deformation ───────────────────────────────
const vertexShader = /* glsl */ `
${NOISE_GLSL}

uniform float uTime;
uniform float uAudioLevel;
uniform float uBlobAmt;
uniform float uAudioReact;
uniform float uBreathAmt;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vObjPos;

void main() {
  // Subtle watery deformation on the glass surface
  float blob = snoise(vec4(position * 1.2, uTime * 0.04)) * 0.6
             + snoise(vec4(position * 2.0 + 4.0, uTime * 0.03)) * 0.4;

  float breath = sin(uTime * 0.4) * uBreathAmt;
  float audio = uAudioLevel * uAudioReact * 0.12;

  float disp = blob * uBlobAmt + breath + audio;
  vec3 newPos = position + normal * disp;

  vObjPos = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(newPos, 1.0);
  vPosition = mvPos.xyz;
  gl_Position = projectionMatrix * mvPos;
}
`;

// ─── Fragment: sky + clouds inside a glass sphere ──────────────────────────
const fragmentShader = /* glsl */ `
${NOISE_GLSL}

uniform float uTime;
uniform float uAudioLevel;
uniform float uRotation;
uniform float uCloudDensity;
uniform float uDistortion;
uniform float uGlowStr;
uniform float uOpacity;
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec3 uCloudColor;

varying vec3 vNormal;
varying vec3 vPosition;
varying vec3 vObjPos;

// Rotate around Y axis
vec3 rotateY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}

// Fractal Brownian Motion clouds
float fbmClouds(vec3 p, float t) {
  float v = 0.0;
  v += snoise(vec4(p * 1.5, t * 0.025)) * 0.5;
  v += snoise(vec4(p * 3.0 + 7.0, t * 0.03)) * 0.25;
  v += snoise(vec4(p * 6.0 + 13.0, t * 0.04)) * 0.125;
  v += snoise(vec4(p * 12.0 + 21.0, t * 0.05)) * 0.0625;
  return v;
}

void main() {
  vec3 viewDir = normalize(-vPosition);
  float facing = max(dot(viewDir, vNormal), 0.0);
  float fresnel = pow(1.0 - facing, 4.0);

  // ── Refraction: warp the lookup position like light bending through glass ──
  vec3 refracted = refract(-viewDir, vNormal, 1.0 / 1.45);
  vec3 samplePos = vObjPos + refracted * uDistortion;

  // Rotate the inner scene (globe rotation)
  vec3 rotated = rotateY(samplePos, uRotation);

  // ── Sky gradient based on "latitude" inside the sphere ──
  float latitude = rotated.y * 0.5 + 0.5; // 0 = bottom, 1 = top
  vec3 sky = mix(uSkyBottom, uSkyTop, smoothstep(0.0, 1.0, latitude));

  // ── Procedural clouds ──
  float cloudNoise = fbmClouds(rotated, uTime);
  float clouds = smoothstep(0.0, 0.5, cloudNoise * uCloudDensity);
  // Softer, thinner at edges
  clouds *= smoothstep(0.0, 0.3, facing);

  vec3 interior = mix(sky, uCloudColor, clouds);

  // ── Glass surface effects ──
  // Reflection environment (fake sky reflection)
  vec3 reflDir = reflect(-viewDir, vNormal);
  float envGrad = reflDir.y * 0.5 + 0.5;
  vec3 envColor = mix(uSkyBottom * 0.6, uSkyTop * 0.8, smoothstep(0.2, 0.9, envGrad));

  // Blend interior with reflection via fresnel
  vec3 color = mix(interior, envColor, fresnel * 0.6);

  // Inner glow at center
  color += uSkyTop * pow(facing, 3.0) * uGlowStr * 0.5;

  // Specular highlights (glass shine)
  vec3 lightDir = normalize(vec3(0.8, 1.0, 0.6));
  vec3 halfVec = normalize(lightDir + viewDir);
  float spec = pow(max(dot(vNormal, halfVec), 0.0), 120.0);
  color += vec3(1.0) * spec * 0.9;

  vec3 lightDir2 = normalize(vec3(-0.6, -0.3, -0.8));
  vec3 halfVec2 = normalize(lightDir2 + viewDir);
  float spec2 = pow(max(dot(vNormal, halfVec2), 0.0), 60.0);
  color += vec3(0.9, 0.95, 1.0) * spec2 * 0.4;

  // Rim glow
  color += uSkyTop * fresnel * 0.25;

  // Audio-reactive brightness boost
  color += uCloudColor * uAudioLevel * 0.08;

  float alpha = uOpacity * (1.0 - fresnel * 0.03);
  gl_FragColor = vec4(color, alpha);
}
`;

// ─── State configs ─────────────────────────────────────────────────────────
const STATE_CONFIGS: Record<VoiceState, {
  skyTop: [number, number, number];
  skyBottom: [number, number, number];
  cloudColor: [number, number, number];
  cloudDensity: number;
  rotSpeed: number;       // Globe rotation speed (rad/s)
  blobAmt: number;        // Glass surface deformation
  breathAmt: number;
  audioReact: number;
  distortion: number;     // Glass refraction amount
  glowStr: number;
  opacity: number;
}> = {
  idle: {
    skyTop: [0.35, 0.6, 1.0],
    skyBottom: [0.7, 0.85, 1.0],
    cloudColor: [1.0, 1.0, 1.0],
    cloudDensity: 1.2,
    rotSpeed: 0.06,
    blobAmt: 0.06,
    breathAmt: 0.015,
    audioReact: 0.0,
    distortion: 0.3,
    glowStr: 0.3,
    opacity: 0.95,
  },
  listening: {
    skyTop: [0.3, 0.55, 1.0],
    skyBottom: [0.65, 0.82, 1.0],
    cloudColor: [0.95, 0.97, 1.0],
    cloudDensity: 1.4,
    rotSpeed: 0.1,
    blobAmt: 0.08,
    breathAmt: 0.012,
    audioReact: 0.4,
    distortion: 0.35,
    glowStr: 0.4,
    opacity: 0.96,
  },
  thinking: {
    skyTop: [0.28, 0.5, 0.95],
    skyBottom: [0.6, 0.75, 0.95],
    cloudColor: [0.92, 0.95, 1.0],
    cloudDensity: 1.6,
    rotSpeed: 0.15,
    blobAmt: 0.07,
    breathAmt: 0.015,
    audioReact: 0.0,
    distortion: 0.4,
    glowStr: 0.35,
    opacity: 0.94,
  },
  speaking: {
    skyTop: [0.32, 0.6, 1.0],
    skyBottom: [0.72, 0.88, 1.0],
    cloudColor: [1.0, 1.0, 1.0],
    cloudDensity: 1.3,
    rotSpeed: 0.12,
    blobAmt: 0.1,
    breathAmt: 0.01,
    audioReact: 0.6,
    distortion: 0.35,
    glowStr: 0.5,
    opacity: 0.97,
  },
};

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function lerpC(c: THREE.Color, t: [number, number, number], s: number) {
  c.r = lerp(c.r, t[0], s); c.g = lerp(c.g, t[1], s); c.b = lerp(c.b, t[2], s);
}

export function VoiceOrb({ state, audioLevel = 0, size = 220, className }: VoiceOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const timerRef = useRef(new THREE.Timer());
  const stateRef = useRef(state);
  const audioRef = useRef(audioLevel);
  stateRef.current = state;
  audioRef.current = audioLevel;

  const u = useMemo(() => ({
    uTime: { value: 0 },
    uAudioLevel: { value: 0 },
    uRotation: { value: 0 },
    uBlobAmt: { value: 0.06 },
    uBreathAmt: { value: 0.015 },
    uAudioReact: { value: 0.0 },
    uCloudDensity: { value: 1.2 },
    uDistortion: { value: 0.3 },
    uGlowStr: { value: 0.3 },
    uOpacity: { value: 0.95 },
    uSkyTop: { value: new THREE.Color(...STATE_CONFIGS.idle.skyTop) },
    uSkyBottom: { value: new THREE.Color(...STATE_CONFIGS.idle.skyBottom) },
    uCloudColor: { value: new THREE.Color(...STATE_CONFIGS.idle.cloudColor) },
  }), []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.z = 3.5;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const geo = new THREE.IcosahedronGeometry(1, 128);
    const mat = new THREE.ShaderMaterial({
      vertexShader, fragmentShader, uniforms: u,
      transparent: true, depthWrite: false,
    });
    const orbMesh = new THREE.Mesh(geo, mat);
    scene.add(orbMesh);

    // Soft outer halo
    const hGeo = new THREE.SphereGeometry(1.5, 32, 32);
    const hMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.5, 0.7, 1.0), transparent: true, opacity: 0.02, side: THREE.BackSide,
    });
    scene.add(new THREE.Mesh(hGeo, hMat));

    const s = 0.03;
    let currentRotSpeed = STATE_CONFIGS.idle.rotSpeed;

    const timer = timerRef.current;
    timer.connect(document);

    const animate = (timestamp?: number) => {
      rafRef.current = requestAnimationFrame(animate);
      timer.update(timestamp);
      const t = timer.getElapsed();
      const dt = timer.getDelta();
      const cfg = STATE_CONFIGS[stateRef.current];
      const audio = Math.min(1, Math.max(0, audioRef.current));

      u.uTime.value = t;
      u.uAudioLevel.value = lerp(u.uAudioLevel.value, audio, 0.08);
      u.uBlobAmt.value = lerp(u.uBlobAmt.value, cfg.blobAmt, s);
      u.uBreathAmt.value = lerp(u.uBreathAmt.value, cfg.breathAmt, s);
      u.uAudioReact.value = lerp(u.uAudioReact.value, cfg.audioReact, s);
      u.uCloudDensity.value = lerp(u.uCloudDensity.value, cfg.cloudDensity, s);
      u.uDistortion.value = lerp(u.uDistortion.value, cfg.distortion, s);
      u.uGlowStr.value = lerp(u.uGlowStr.value, cfg.glowStr + audio * 0.1, s);
      u.uOpacity.value = lerp(u.uOpacity.value, cfg.opacity, s);

      // Smooth globe rotation
      currentRotSpeed = lerp(currentRotSpeed, cfg.rotSpeed, s);
      u.uRotation.value += currentRotSpeed * dt;

      // Gentle tilt of the whole glass sphere
      orbMesh.rotation.x = Math.sin(t * 0.03) * 0.12;
      orbMesh.rotation.z = Math.cos(t * 0.025) * 0.06;

      lerpC(u.uSkyTop.value, cfg.skyTop, s);
      lerpC(u.uSkyBottom.value, cfg.skyBottom, s);
      lerpC(u.uCloudColor.value, cfg.cloudColor, s);
      lerpC(hMat.color, cfg.skyTop, s);
      hMat.opacity = lerp(hMat.opacity, 0.02 + audio * 0.01, 0.02);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafRef.current);
      timer.disconnect();
      timer.dispose();
      renderer.dispose(); geo.dispose(); mat.dispose(); hGeo.dispose(); hMat.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [size, u]);

  return <div ref={containerRef} className={className} style={{ width: size, height: size }} />;
}
