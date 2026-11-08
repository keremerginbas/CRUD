// Giriş ekranının arkasındaki 3D Dünya. Yalnızca giriş ekranında yüklenir (dinamik import) ve kapanınca tamamen serbest bırakılır.
// Dokular: NASA Blue Marble / Black Marble türevleri (public/earth). Three.js r143.
import * as THREE from 'three';
import {EffectComposer} from 'three/examples/jsm/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/examples/jsm/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import {ShaderPass} from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {GammaCorrectionShader} from 'three/examples/jsm/shaders/GammaCorrectionShader.js';

const CONFIG={
 rimColor:'#c1faff',rimPower:2.4,nightLights:10,terrainDepth:0.33,terrainShade:1.3,
 oceanGlint:0.45,oceanDeep:0.12,oceanFlow:3,oceanFlowSpeed:0.8,oceanFlowScale:2.1,
 glowColor:'#3a6cff',glowIntensity:1.15,planetRadius:1.95,spin:0.03,initRotation:2.07,tilt:0.37,
 clouds:[{h:1.006,o:0.75,s:0.06,ry:0,phase:0},{h:1.035,o:0.45,s:0.14,ry:2.2,phase:13}],
 bgColor:'#040a1e',flameColor:'#3a6cff',flameColor2:'#c1faff',flameAmt:0.15,
 starColor:'#cfe0ff',starCount:1400,starSize:1.6,starFlicker:1,
 markerColor:'#ffd27a',markerSize:16,markerSpeed:0.5,
};
// Altın sinyal noktaları: Türkiye'nin büyük şehirleri.
const CITIES:[number,number][]=[[39.93,32.86],[41.01,28.98],[38.42,27.14],[36.9,30.7],[37.87,32.48],[40.19,29.06],[37.0,35.32],[37.07,37.38],
 [41.0,39.72],[39.9,41.27],[37.91,40.23],[38.73,35.48],[41.29,36.33],[39.78,30.52],[38.5,43.38],[38.35,38.31],[39.75,37.02],[36.2,36.16]];

const hexToVec3=(h:string)=>{const c=new THREE.Color(h);return new THREE.Vector3(c.r,c.g,c.b)};
const clamp=(v:number,a:number,b:number)=>Math.min(b,Math.max(a,v));
const easeInOut=(t:number)=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;

const SNOISE=`
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + 1.0 * C.xxx; vec3 x2 = x0 - i2 + 2.0 * C.xxx; vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
  i = mod(i, 289.0);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 1.0/7.0; vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z *ns.z);
  vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ *ns.x + ns.yyyy; vec4 y = y_ *ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy,h.x); vec3 p1 = vec3(a0.zw,h.y); vec3 p2 = vec3(a1.xy,h.z); vec3 p3 = vec3(a1.zw,h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}`;

// three.js SphereGeometry ile aynı UV düzeni: u=0 boylam -180.
export function latLonToVec3(lat:number,lon:number,r:number){
 const phi=(lon+180)*Math.PI/180,theta=(90-lat)*Math.PI/180;
 return new THREE.Vector3(-r*Math.cos(phi)*Math.sin(theta),r*Math.cos(theta),r*Math.sin(phi)*Math.sin(theta));
}

export type PlanetScene={flyTo:(lat:number,lon:number,ms?:number)=>Promise<void>;dispose:()=>void};

export async function createPlanet(canvas:HTMLCanvasElement,{base='earth/',reducedMotion=false,onReady}:{base?:string;reducedMotion?:boolean;onReady?:()=>void}={}):Promise<PlanetScene>{
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
 renderer.setPixelRatio(Math.min(devicePixelRatio,2));
 renderer.outputEncoding=THREE.sRGBEncoding;
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x000000);
 const camera=new THREE.PerspectiveCamera(40,1,0.1,200);camera.position.set(0,0,8);scene.add(camera);
 scene.add(new THREE.AmbientLight(0xffffff,1.8));
 const sun=new THREE.DirectionalLight(0xffffff,0.8);sun.position.set(0,10,2);scene.add(sun);

 const loader=new THREE.TextureLoader();
 const load=(f:string,color=true)=>new Promise<THREE.Texture>((res,rej)=>loader.load(base+f,t=>{if(color)t.encoding=THREE.sRGBEncoding;t.anisotropy=renderer.capabilities.getMaxAnisotropy();res(t)},undefined,rej));
 const [day,night,water,topo,cloudTex]=await Promise.all([load('day.jpg'),load('night.jpg'),load('water.jpg',false),load('topology.jpg',false),load('clouds.jpg',false)]);

 const R=CONFIG.planetRadius;
 const worldGroup=new THREE.Group();scene.add(worldGroup);
 const planetGroup=new THREE.Group();planetGroup.rotation.z=CONFIG.tilt;worldGroup.add(planetGroup);
 let planetTime=0,cloudTime=0,starTime=0,markerTime=0;

 // --- Gezegen: gündüz/gece ışıkları, okyanus akışı ve parıltısı, kenar ışığı (spesifikasyondaki enjeksiyon, su maskesi dokudan) ---
 const planetMat=new THREE.MeshStandardMaterial({map:day,metalness:0,roughness:1,envMapIntensity:0});
 const pu={time:{value:0},noiseScale:{value:30},speedX:{value:1.5},speedY:{value:2},speedZ:{value:2.5},
  rimColor:{value:new THREE.Color(CONFIG.rimColor)},rimPower:{value:CONFIG.rimPower},nightBlendTexture:{value:night},waterTexture:{value:water},topoTexture:{value:topo},
  nightLights:{value:CONFIG.nightLights},terrainDepth:{value:CONFIG.terrainDepth},terrainShade:{value:CONFIG.terrainShade},oceanGlint:{value:CONFIG.oceanGlint},
  oceanDeep:{value:CONFIG.oceanDeep},oceanFlow:{value:CONFIG.oceanFlow},oceanFlowSpeed:{value:CONFIG.oceanFlowSpeed},oceanFlowScale:{value:CONFIG.oceanFlowScale}};
 planetMat.onBeforeCompile=sh=>{
  Object.assign(sh.uniforms,pu);
  sh.vertexShader='varying vec2 vCustomUv;\n'+sh.vertexShader.replace('void main() {','void main() {\n vCustomUv = uv;');
  sh.fragmentShader=`uniform float time,noiseScale,speedX,speedY,speedZ,rimPower,nightLights,terrainDepth,terrainShade,oceanGlint,oceanDeep,oceanFlow,oceanFlowSpeed,oceanFlowScale;
uniform vec3 rimColor; uniform sampler2D nightBlendTexture; uniform sampler2D waterTexture; uniform sampler2D topoTexture; varying vec2 vCustomUv;
${SNOISE}
`+sh.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
vec3 normalizedNormal = normalize(vNormal);
vec3 viewDir = normalize(vViewPosition);
float rim = 1.0 - max(dot(viewDir, normalizedNormal), 0.0);
rim = pow(rim, rimPower); rim = pow(rim, 1.5); rim *= 0.7;
float waterMask = clamp(texture2D(waterTexture, vCustomUv).r, 0.0, 1.0);
float shimmer = snoise(vec3(vCustomUv.x * noiseScale + time * speedX, vCustomUv.y * noiseScale - time * speedY, time * speedZ));
gl_FragColor.rgb += waterMask * shimmer * 0.025;
float fT = time * oceanFlowSpeed * 4.0; float fS = 4.0 * oceanFlowScale;
float warp = snoise(vec3(vCustomUv.x * fS - fT * 0.5, vCustomUv.y * fS + fT * 0.4, fT * 0.5));
float flow = snoise(vec3(vCustomUv.x * fS * 2.0 + fT * 0.6 + warp, vCustomUv.y * fS * 2.0 - fT * 0.5, fT * 0.7));
flow = warp * 0.6 + flow * 0.4;
gl_FragColor.rgb += waterMask * flow * 0.12 * oceanFlow * 0.25;
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.01, 0.06, 0.16), waterMask * oceanDeep);
vec3 finalColor = mix(gl_FragColor.rgb, rimColor, rim);
gl_FragColor = vec4(finalColor, 1.0);
vec3 surfPos = -vViewPosition;
float terrH = texture2D(topoTexture, vCustomUv).r;
vec3 sigX = dFdx(surfPos), sigY = dFdy(surfPos);
vec3 vR1 = cross(sigY, normalizedNormal), vR2 = cross(normalizedNormal, sigX);
float fDet = dot(sigX, vR1);
vec3 vGrad = sign(fDet) * (dFdx(terrH) * vR1 + dFdy(terrH) * vR2);
vec3 bumpedNormal = normalize(abs(fDet) * normalizedNormal - terrainDepth * vGrad);
vec3 shadeNormal = mix(bumpedNormal, normalizedNormal, waterMask);
vec3 cityLights = texture2D(nightBlendTexture, vCustomUv).rgb * vec3(1.0, 0.82, 0.55) * nightLights * 0.12;
vec3 viewSunDir = normalize(vec3(-0.9, 0.18, 0.4));
float ndl = dot(normalizedNormal, viewSunDir);
float dayAmt = smoothstep(-0.05, 0.35, ndl);
float relief = dot(shadeNormal, viewSunDir) - ndl;
gl_FragColor.rgb *= clamp(1.0 + relief * terrainShade * dayAmt, 0.55, 1.6);
float nightFactor  = smoothstep(0.18, -0.30, ndl);
float lightsFactor = smoothstep(0.30, -0.35, ndl);
gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.08, nightFactor);
gl_FragColor.rgb += cityLights * lightsFactor * (1.0 - waterMask);
vec3 halfDir = normalize(viewSunDir + viewDir);
float ripple = snoise(vec3(vCustomUv * 240.0, time * 4.0));
float ndh = max(dot(normalizedNormal, halfDir) + ripple * 0.02, 0.0);
float glint = pow(ndh, 140.0);
gl_FragColor.rgb += glint * waterMask * dayAmt * oceanGlint * vec3(1.0, 0.97, 0.88);`);
 };
 const planet=new THREE.Mesh(new THREE.SphereGeometry(R,160,96),planetMat);planetGroup.add(planet);

 // --- Bulut kabukları ---
 const cloudGroup=new THREE.Group();cloudGroup.rotation.z=CONFIG.tilt;worldGroup.add(cloudGroup);
 cloudTex.wrapS=cloudTex.wrapT=THREE.RepeatWrapping;
 const cloudMeshes=CONFIG.clouds.map(layer=>{
  const mat=new THREE.MeshStandardMaterial({color:0xffffff,alphaMap:cloudTex,transparent:true,depthWrite:false});
  const cu={uTime:{value:0},noiseScale:{value:20},uOpacity:{value:layer.o},uPhase:{value:layer.phase}};
  mat.onBeforeCompile=sh=>{
   Object.assign(sh.uniforms,cu);
   sh.vertexShader='varying vec2 vCloudUv;\n'+sh.vertexShader.replace('void main() {','void main() {\n vCloudUv = uv;');
   sh.fragmentShader=`uniform float uTime,noiseScale,uOpacity,uPhase; varying vec2 vCloudUv;\n${SNOISE}\n`+sh.fragmentShader.replace('#include <dithering_fragment>',`#include <dithering_fragment>
gl_FragColor.rgb = vec3(1.0);
float cloudNoise = snoise(vec3(vCloudUv.x * noiseScale + uTime + uPhase, vCloudUv.y * noiseScale - uTime * 2.0 + uPhase, uTime * 2.0 + uPhase));
float cloudNdv = max(dot(normalize(vNormal), normalize(vViewPosition)), 0.0);
float cloudEdge = pow(1.0 - cloudNdv, 3.0);
float cloudMod = mix(0.75 + 0.25 * cloudNoise, 1.0, cloudEdge);
float cloudNdl = dot(normalize(vNormal), normalize(vec3(-0.9, 0.18, 0.4)));
float cloudDay = 1.0 - smoothstep(0.30, -0.30, cloudNdl) * 0.9;
gl_FragColor.a *= cloudMod * uOpacity * cloudDay;`);
  };
  const m=new THREE.Mesh(new THREE.SphereGeometry(R*layer.h,96,64),mat);m.rotation.y=layer.ry;m.renderOrder=2;cloudGroup.add(m);
  return {mesh:m,spin:layer.s,cu};
 });

 // --- Atmosfer halesi (kameraya dönük düzlem) ---
 const glowMesh=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.ShaderMaterial({
  uniforms:{uGlow:{value:hexToVec3(CONFIG.glowColor)},uIntensity:{value:CONFIG.glowIntensity},uEdge:{value:1/1.32}},
  vertexShader:'varying vec2 vUv; void main(){ vUv=uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader:`uniform vec3 uGlow; uniform float uIntensity; uniform float uEdge; varying vec2 vUv;
void main(){ float d = length(vUv - 0.5) * 2.0; float a = pow(clamp((1.0 - d) / (1.0 - uEdge), 0.0, 1.0), 2.2); gl_FragColor = vec4(uGlow * a * uIntensity, a); }`,
  transparent:true,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
 glowMesh.scale.setScalar(R*1.32);glowMesh.renderOrder=-1;worldGroup.add(glowMesh);

 // --- Yıldızlar ---
 const res=new THREE.Vector2(1,1);
 const sp=new Float32Array(CONFIG.starCount*3),ss=new Float32Array(CONFIG.starCount),sb=new Float32Array(CONFIG.starCount);
 for(let i=0;i<CONFIG.starCount;i++){const v=new THREE.Vector3().randomDirection().multiplyScalar(90);sp.set([v.x,v.y,v.z],i*3);ss[i]=Math.random()*100;sb[i]=0.35+Math.random()*0.65}
 const starGeo=new THREE.BufferGeometry();starGeo.setAttribute('position',new THREE.BufferAttribute(sp,3));starGeo.setAttribute('seed',new THREE.BufferAttribute(ss,1));starGeo.setAttribute('bright',new THREE.BufferAttribute(sb,1));
 const starU={uTime:{value:0},uSize:{value:CONFIG.starSize},uFlicker:{value:CONFIG.starFlicker},uColor:{value:hexToVec3(CONFIG.starColor)},uRes:{value:res}};
 const stars=new THREE.Points(starGeo,new THREE.ShaderMaterial({uniforms:starU,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  vertexShader:`attribute float seed; attribute float bright; uniform float uTime; uniform float uSize; uniform float uFlicker; uniform vec2 uRes; varying float vTw;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float tw = 0.6 + 0.4 * sin(uTime * uFlicker + seed); vTw = bright * tw;
 gl_PointSize = max(uSize * uRes.y / 900.0 * (90.0 / max(-mv.z, 1.0)), 1.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader:`uniform vec3 uColor; varying float vTw; void main(){ vec2 p = gl_PointCoord - 0.5; float l = length(p); if (l > 0.5) discard; float core = smoothstep(0.5, 0.0, l); gl_FragColor = vec4(uColor, core * vTw); }`}));
 stars.frustumCulled=false;scene.add(stars);

 // --- Türkiye şehirlerinde altın sinyal halkaları ---
 const mp=new Float32Array(CITIES.length*3),ms=new Float32Array(CITIES.length);
 CITIES.forEach(([la,lo],i)=>{const v=latLonToVec3(la,lo,R*1.012);mp.set([v.x,v.y,v.z],i*3);ms[i]=Math.random()});
 const markerGeo=new THREE.BufferGeometry();markerGeo.setAttribute('position',new THREE.BufferAttribute(mp,3));markerGeo.setAttribute('seed',new THREE.BufferAttribute(ms,1));
 const markerU={uTime:{value:0},uColor:{value:hexToVec3(CONFIG.markerColor)},uSize:{value:CONFIG.markerSize},uSpeed:{value:CONFIG.markerSpeed},uRes:{value:res}};
 const markers=new THREE.Points(markerGeo,new THREE.ShaderMaterial({uniforms:markerU,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  vertexShader:`attribute float seed; uniform float uSize; uniform vec2 uRes; varying float vSeed; varying float vFade;
void main(){ vSeed = seed; vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 vn = normalize(normalMatrix * normalize(position)); vec3 vd = normalize(-mv.xyz);
 vFade = smoothstep(0.15, 0.5, dot(vn, vd)); gl_PointSize = max(uSize * uRes.y / 900.0 * (7.0 / max(-mv.z, 1.0)), 2.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader:`uniform vec3 uColor; uniform float uTime; uniform float uSpeed; varying float vSeed; varying float vFade;
void main(){ if (vFade <= 0.001) discard; vec2 p = gl_PointCoord - 0.5; float d = length(p) * 2.0; if (d > 1.0) discard;
 float core = smoothstep(0.30, 0.0, d) * 1.2; float ph = fract(uTime * uSpeed + vSeed); float ring = smoothstep(0.07, 0.0, abs(d - ph)) * (1.0 - ph);
 gl_FragColor = vec4(uColor, clamp(core + ring, 0.0, 1.0) * vFade); }`}));
 markers.frustumCulled=false;planet.add(markers);

 // --- Son geçiş: uzay zemini + köşe alevi + bloom ---
 // Yarım-float hedef: hale ve bloom'da renk basamaklanması olmaz.
 const composer=new EffectComposer(renderer,new THREE.WebGLRenderTarget(1,1,{type:THREE.HalfFloatType}));
 composer.addPass(new RenderPass(scene,camera));
 const bloom=new UnrealBloomPass(new THREE.Vector2(1,1),0.32,0.55,0.18);composer.addPass(bloom);
 composer.addPass(new ShaderPass(GammaCorrectionShader));
 const finalPass=new ShaderPass({
  uniforms:{tDiffuse:{value:null},iTime:{value:0},uBg:{value:hexToVec3(CONFIG.bgColor)},uFlameA:{value:hexToVec3(CONFIG.flameColor)},uFlameB:{value:hexToVec3(CONFIG.flameColor2)},uFlameAmt:{value:CONFIG.flameAmt}},
  vertexShader:'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader:`uniform float iTime; uniform sampler2D tDiffuse; uniform vec3 uBg; uniform vec3 uFlameA; uniform vec3 uFlameB; uniform float uFlameAmt; varying vec2 vUv;
vec3 warp3d(vec3 pos, float t){ float curv=.8,a=1.9,b=0.7; pos*=2.; pos.x+=curv*sin(t+a*pos.y)+t*b; pos.y+=curv*cos(t+a*pos.x);
 pos.y+=curv*sin(t+a*pos.z)+t*b; pos.z+=curv*cos(t+a*pos.y); pos.z+=curv*sin(t+a*pos.x)+t*b; pos.x+=curv*cos(t+a*pos.z); return 0.5+0.5*cos(pos.xyz+vec3(1,2,4)); }
void main(){ vec2 uv = 2.*vUv - 1.; vec3 w = pow(warp3d(vec3(uv.x, sin(uv.y), uv.y), iTime*1.5), vec3(1.5));
 vec3 flame = 1.5*uFlameA*w.x; flame*=w.y; flame += uFlameB*w.z; flame *= smoothstep(0.25, 1., abs(uv.y));
 float md = smoothstep(-0.7, 1., -uv.y*uv.x); flame *= md*md; vec3 bg = uBg * (1.0 - 0.4 * length(uv));
 float dither = (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
 gl_FragColor = vec4(bg + flame*uFlameAmt + texture2D(tDiffuse, vUv).xyz + dither, 1.); }`});
 composer.addPass(finalPass);

 function resize(){
  const w=canvas.clientWidth||innerWidth,h=canvas.clientHeight||innerHeight;
  renderer.setSize(w,h,false);composer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();res.set(w,h);
  // Dar ekranda gezegen biraz küçülür.
  baseScale=clamp(w/1200,0.62,1)*1.9;
 }
 let baseScale=1.9;
 resize();addEventListener('resize',resize);

 // Giriş: gezegen ekranın altından süzülerek yükselir; sonra yavaşça döner.
 // Hero: gezegen büyük ve yarısı ekranın altında.
 const ENTRY_DUR=reducedMotion?0:1.9,REST_Y=-4.15,START_Y=-8.5;
 let entryT=0,spinPhase=0,fly:{from:{ry:number;rx:number;rz:number;y:number;s:number;cz:number};to:{ry:number;rx:number};start:number;dur:number;done:()=>void}|null=null;
 planetGroup.rotation.y=CONFIG.initRotation;worldGroup.position.y=reducedMotion?REST_Y:START_Y;worldGroup.scale.setScalar(baseScale);
 // arrived: uçuş bitti; son görüntü sabit kalır (boşta dönme yeniden başlamaz).
 let last=performance.now(),raf=0,disposed=false,arrived=false;
 function frame(now:number){
  if(disposed)return;
  const dt=Math.min(0.05,(now-last)/1000);last=now;
  planetTime+=dt/12;cloudTime+=dt/20;starTime+=dt;markerTime+=dt;
  pu.time.value=planetTime;starU.uTime.value=starTime;markerU.uTime.value=markerTime;finalPass.uniforms.iTime.value=now/1000*0.8*0.1;
  cloudMeshes.forEach(c=>{c.cu.uTime.value=cloudTime;c.mesh.rotation.y+=dt*c.spin*0.3});
  if(fly){
   // Gerçek saate bağlı: yavaş cihazda da süresinde biter.
   const t=Math.min(1,(now-fly.start)/fly.dur);const k=easeInOut(t);
   planetGroup.rotation.set(THREE.MathUtils.lerp(fly.from.rx,fly.to.rx,k),THREE.MathUtils.lerp(fly.from.ry,fly.to.ry,k),THREE.MathUtils.lerp(fly.from.rz,0,k));
   cloudGroup.rotation.z=planetGroup.rotation.z;
   worldGroup.position.y=THREE.MathUtils.lerp(fly.from.y,0,k);worldGroup.scale.setScalar(THREE.MathUtils.lerp(fly.from.s,1,k));
   camera.position.z=THREE.MathUtils.lerp(fly.from.cz,R+2.3,k*k);
   if(t>=1){const d=fly.done;fly=null;arrived=true;d()}
  }else if(!arrived){
   spinPhase+=dt*CONFIG.spin;planetGroup.rotation.y=CONFIG.initRotation+spinPhase;
   if(entryT<1&&ENTRY_DUR>0){entryT=Math.min(1,entryT+dt/ENTRY_DUR);const e=1-Math.pow(1-entryT,3);worldGroup.position.y=THREE.MathUtils.lerp(START_Y,REST_Y,e)}
   worldGroup.scale.setScalar(THREE.MathUtils.lerp(worldGroup.scale.x,baseScale,Math.min(1,dt*3)));
  }
  glowMesh.quaternion.copy(camera.quaternion);
  composer.render(dt);
  raf=requestAnimationFrame(frame);
 }
 raf=requestAnimationFrame(frame);
 onReady?.();

 return {
  // Verilen konum kameraya dönene kadar gezegeni çevirir ve yakınlaşır.
  flyTo(lat,lon,ms=1700){
   if(reducedMotion)return Promise.resolve();
   const v=latLonToVec3(lat,lon,1);
   let ry=-Math.atan2(v.x,v.z);const cur=planetGroup.rotation.y;
   ry+=Math.round((cur-ry)/(2*Math.PI))*2*Math.PI;// en kısa yönden dön
   return new Promise(done=>{fly={from:{ry:cur,rx:planetGroup.rotation.x,rz:planetGroup.rotation.z,y:worldGroup.position.y,s:worldGroup.scale.x,cz:camera.position.z},
    to:{ry,rx:lat*Math.PI/180},start:performance.now(),dur:ms,done}});
  },
  dispose(){
   disposed=true;cancelAnimationFrame(raf);removeEventListener('resize',resize);
   scene.traverse(o=>{const m=o as THREE.Mesh;m.geometry?.dispose?.();const mat=m.material as THREE.Material|THREE.Material[]|undefined;(Array.isArray(mat)?mat:mat?[mat]:[]).forEach(x=>x.dispose())});
   [day,night,water,topo,cloudTex].forEach(t=>t.dispose());composer.renderTarget1.dispose();composer.renderTarget2.dispose();renderer.dispose();
  },
 };
}
