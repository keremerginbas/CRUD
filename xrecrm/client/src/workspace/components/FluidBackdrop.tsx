import { useEffect, useRef } from "react";

// Giriş ekranının arka planı: tarayıcıda çalışan akışkan (mürekkep) benzetimi.
// Pavel Dobryakov'un WebGL Fluid Simulation çalışmasından (MIT) sadeleştirilmiştir.
// Video dosyası yoktur; WebGL açılamazsa ya da kullanıcı hareketi azaltmayı seçtiyse
// yalnız CSS'teki koyu degrade görünür.

const VERT = `
precision highp float;
attribute vec2 aPosition;
varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;
uniform vec2 texelSize;
void main () {
  vUv = aPosition * 0.5 + 0.5;
  vL = vUv - vec2(texelSize.x, 0.0);
  vR = vUv + vec2(texelSize.x, 0.0);
  vT = vUv + vec2(0.0, texelSize.y);
  vB = vUv - vec2(0.0, texelSize.y);
  gl_Position = vec4(aPosition, 0.0, 1.0);
}`;
const HEAD = `precision highp float; precision highp sampler2D;
varying vec2 vUv; varying vec2 vL; varying vec2 vR; varying vec2 vT; varying vec2 vB;`;
const FRAG = {
  clear: `${HEAD} uniform sampler2D uTexture; uniform float value;
    void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`,
  display: `${HEAD} uniform sampler2D uTexture; uniform vec2 texelSize;
    void main () {
      vec3 L = texture2D(uTexture, vL).rgb; vec3 R = texture2D(uTexture, vR).rgb;
      vec3 T = texture2D(uTexture, vT).rgb; vec3 B = texture2D(uTexture, vB).rgb;
      vec3 C = texture2D(uTexture, vUv).rgb;
      float dx = length(R) - length(L); float dy = length(T) - length(B);
      vec3 n = normalize(vec3(dx, dy, length(texelSize)));
      float diffuse = clamp(dot(n, vec3(0.0, 0.0, 1.0)) + 0.7, 0.7, 1.0);
      C *= diffuse;
      gl_FragColor = vec4(C, max(C.r, max(C.g, C.b)));
    }`,
  splat: `${HEAD} uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius;
    void main () {
      vec2 p = vUv - point.xy; p.x *= aspectRatio;
      vec3 splat = exp(-dot(p, p) / radius) * color;
      gl_FragColor = vec4(texture2D(uTarget, vUv).xyz + splat, 1.0);
    }`,
  advection: `${HEAD} uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform vec2 sourceTexel; uniform float dt; uniform float dissipation;
    vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
      vec2 st = uv / tsize - 0.5; vec2 iuv = floor(st); vec2 fuv = fract(st);
      vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
      vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
      vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
      vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
      return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
    }
    void main () {
      vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize;
      gl_FragColor = dissipation * bilerp(uSource, coord, sourceTexel);
      gl_FragColor.a = 1.0;
    }`,
  divergence: `${HEAD} uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x;
      float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y;
      vec2 C = texture2D(uVelocity, vUv).xy;
      if (vL.x < 0.0) { L = -C.x; } if (vR.x > 1.0) { R = -C.x; }
      if (vT.y > 1.0) { T = -C.y; } if (vB.y < 0.0) { B = -C.y; }
      gl_FragColor = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
    }`,
  curl: `${HEAD} uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uVelocity, vL).y; float R = texture2D(uVelocity, vR).y;
      float T = texture2D(uVelocity, vT).x; float B = texture2D(uVelocity, vB).x;
      gl_FragColor = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
    }`,
  vorticity: `${HEAD} uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;
    void main () {
      float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x;
      float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x;
      float C = texture2D(uCurl, vUv).x;
      vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
      force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0;
      gl_FragColor = vec4(texture2D(uVelocity, vUv).xy + force * dt, 0.0, 1.0);
    }`,
  pressure: `${HEAD} uniform sampler2D uPressure; uniform sampler2D uDivergence;
    void main () {
      float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;
      float divergence = texture2D(uDivergence, vUv).x;
      gl_FragColor = vec4((L + R + B + T - divergence) * 0.25, 0.0, 0.0, 1.0);
    }`,
  gradient: `${HEAD} uniform sampler2D uPressure; uniform sampler2D uVelocity;
    void main () {
      float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x;
      float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x;
      vec2 velocity = texture2D(uVelocity, vUv).xy - vec2(R - L, T - B);
      gl_FragColor = vec4(velocity, 0.0, 1.0);
    }`,
};

const CONFIG = {
  SIM: 128,
  DYE: 512,
  DENSITY_DISSIPATION: 0.962,
  VELOCITY_DISSIPATION: 0.965,
  PRESSURE_DISSIPATION: 0.8,
  PRESSURE_ITERATIONS: 18,
  CURL: 36,
  SPLAT_RADIUS: 0.24,
  BACK: [6 / 255, 12 / 255, 22 / 255],
};

function hsv(h: number, s: number, v: number) {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
  return { r, g, b };
}
// Marka tonları: turkuaz → mavi → çivit.
function inkColor(scale = 1) {
  const c = hsv(0.5 + Math.random() * 0.2, 0.9, 1);
  return { r: c.r * 0.85 * scale, g: c.g * 0.85 * scale, b: c.b * 0.85 * scale };
}

function startFluid(canvas: HTMLCanvasElement): (() => void) | null {
  const params = { alpha: false, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
  const gl2 = canvas.getContext("webgl2", params) as WebGL2RenderingContext | null;
  const gl = (gl2 || canvas.getContext("webgl", params)) as any;
  if (!gl) return null;
  const isGL2 = Boolean(gl2);
  let halfFloat: number;
  let linear: boolean;
  if (isGL2) {
    if (!gl.getExtension("EXT_color_buffer_float")) return null;
    linear = Boolean(gl.getExtension("OES_texture_float_linear"));
    halfFloat = gl.HALF_FLOAT;
  } else {
    const ext = gl.getExtension("OES_texture_half_float");
    if (!ext) return null;
    linear = Boolean(gl.getExtension("OES_texture_half_float_linear"));
    halfFloat = ext.HALF_FLOAT_OES;
  }
  const internal = isGL2 ? gl.RGBA16F : gl.RGBA;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, VERT);
  const program = (fragment: string) => {
    const prog = gl.createProgram();
    gl.attachShader(prog, vertex);
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(prog, 0, "aPosition");
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const u: Record<string, WebGLUniformLocation> = {};
    const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(prog, i).name;
      u[name] = gl.getUniformLocation(prog, name);
    }
    return { u, bind: () => gl.useProgram(prog) };
  };
  let P: Record<keyof typeof FRAG, ReturnType<typeof program>>;
  try {
    P = Object.fromEntries(Object.entries(FRAG).map(([k, src]) => [k, program(src)])) as typeof P;
  } catch {
    return null;
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);
  const blit = (target: WebGLFramebuffer | null) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };

  type FBO = { fbo: WebGLFramebuffer; w: number; h: number; attach: (id: number) => number };
  const createFBO = (w: number, h: number, smooth = false): FBO => {
    const filter = smooth && linear ? gl.LINEAR : gl.NEAREST;
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, halfFloat, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { fbo, w, h, attach: (id) => (gl.activeTexture(gl.TEXTURE0 + id), gl.bindTexture(gl.TEXTURE_2D, texture), id) };
  };
  const double = (w: number, h: number, smooth = false) => {
    let read = createFBO(w, h, smooth), write = createFBO(w, h, smooth);
    return { get read() { return read; }, get write() { return write; }, swap() { [read, write] = [write, read]; } };
  };
  const resolution = (base: number) => {
    const aspect = Math.max(canvas.width / canvas.height, canvas.height / canvas.width) || 1;
    const max = Math.round(base * aspect);
    return canvas.width > canvas.height ? { w: max, h: base } : { w: base, h: max };
  };

  let density: ReturnType<typeof double>, velocity: ReturnType<typeof double>, pressure: ReturnType<typeof double>;
  let divergence: FBO, curl: FBO;
  const init = () => {
    const sim = resolution(CONFIG.SIM), dye = resolution(CONFIG.DYE);
    density = double(dye.w, dye.h, true);
    velocity = double(sim.w, sim.h);
    pressure = double(sim.w, sim.h);
    divergence = createFBO(sim.w, sim.h);
    curl = createFBO(sim.w, sim.h);
  };
  const size = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(2, Math.round(canvas.clientWidth * ratio)), h = Math.max(2, Math.round(canvas.clientHeight * ratio));
    if (canvas.width === w && canvas.height === h) return false;
    canvas.width = w;
    canvas.height = h;
    return true;
  };
  size();
  if (gl.checkFramebufferStatus === undefined) return null;
  init();
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;

  const splat = (x: number, y: number, dx: number, dy: number, color: { r: number; g: number; b: number }) => {
    P.splat.bind();
    gl.viewport(0, 0, velocity.read.w, velocity.read.h);
    gl.uniform1i(P.splat.u.uTarget, velocity.read.attach(0));
    gl.uniform1f(P.splat.u.aspectRatio, canvas.width / canvas.height);
    gl.uniform2f(P.splat.u.point, x / canvas.width, 1 - y / canvas.height);
    gl.uniform3f(P.splat.u.color, dx, -dy, 1);
    gl.uniform1f(P.splat.u.radius, CONFIG.SPLAT_RADIUS / 100);
    blit(velocity.write.fbo);
    velocity.swap();
    gl.viewport(0, 0, density.read.w, density.read.h);
    gl.uniform1i(P.splat.u.uTarget, density.read.attach(0));
    gl.uniform3f(P.splat.u.color, color.r, color.g, color.b);
    blit(density.write.fbo);
    density.swap();
  };
  const burst = (amount: number) => {
    for (let i = 0; i < amount; i++)
      splat(canvas.width * Math.random(), canvas.height * Math.random(), 900 * (Math.random() - 0.5), 900 * (Math.random() - 0.5), inkColor(7));
  };

  const step = (dt: number) => {
    gl.disable(gl.BLEND);
    const sw = velocity.read.w, sh = velocity.read.h;
    gl.viewport(0, 0, sw, sh);
    const texel = (p: { u: Record<string, WebGLUniformLocation> }) => gl.uniform2f(p.u.texelSize, 1 / sw, 1 / sh);

    P.curl.bind(); texel(P.curl);
    gl.uniform1i(P.curl.u.uVelocity, velocity.read.attach(0));
    blit(curl.fbo);

    P.vorticity.bind(); texel(P.vorticity);
    gl.uniform1i(P.vorticity.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(P.vorticity.u.uCurl, curl.attach(1));
    gl.uniform1f(P.vorticity.u.curl, CONFIG.CURL);
    gl.uniform1f(P.vorticity.u.dt, dt);
    blit(velocity.write.fbo); velocity.swap();

    P.divergence.bind(); texel(P.divergence);
    gl.uniform1i(P.divergence.u.uVelocity, velocity.read.attach(0));
    blit(divergence.fbo);

    P.clear.bind();
    gl.uniform1i(P.clear.u.uTexture, pressure.read.attach(0));
    gl.uniform1f(P.clear.u.value, CONFIG.PRESSURE_DISSIPATION);
    blit(pressure.write.fbo); pressure.swap();

    P.pressure.bind(); texel(P.pressure);
    gl.uniform1i(P.pressure.u.uDivergence, divergence.attach(0));
    for (let i = 0; i < CONFIG.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(P.pressure.u.uPressure, pressure.read.attach(1));
      blit(pressure.write.fbo); pressure.swap();
    }

    P.gradient.bind(); texel(P.gradient);
    gl.uniform1i(P.gradient.u.uPressure, pressure.read.attach(0));
    gl.uniform1i(P.gradient.u.uVelocity, velocity.read.attach(1));
    blit(velocity.write.fbo); velocity.swap();

    P.advection.bind(); texel(P.advection);
    gl.uniform2f(P.advection.u.sourceTexel, 1 / sw, 1 / sh);
    gl.uniform1i(P.advection.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(P.advection.u.uSource, velocity.read.attach(0));
    gl.uniform1f(P.advection.u.dt, dt);
    gl.uniform1f(P.advection.u.dissipation, CONFIG.VELOCITY_DISSIPATION);
    blit(velocity.write.fbo); velocity.swap();

    gl.viewport(0, 0, density.read.w, density.read.h);
    gl.uniform2f(P.advection.u.sourceTexel, 1 / density.read.w, 1 / density.read.h);
    gl.uniform1i(P.advection.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(P.advection.u.uSource, density.read.attach(1));
    gl.uniform1f(P.advection.u.dissipation, CONFIG.DENSITY_DISSIPATION);
    blit(density.write.fbo); density.swap();
  };

  const render = () => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(CONFIG.BACK[0], CONFIG.BACK[1], CONFIG.BACK[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);
    P.display.bind();
    gl.uniform2f(P.display.u.texelSize, 1 / canvas.width, 1 / canvas.height);
    gl.uniform1i(P.display.u.uTexture, density.read.attach(0));
    blit(null);
  };

  // Açılış patlaması, ardından merkez çevresinde sürekli dönen görünmez imleç.
  burst(22);
  const waves = Array.from({ length: 5 }, () => 6 + Math.floor(Math.random() * 6));
  const started = performance.now();
  let angle = 0, prevX = 0, prevY = 0, seeded = false, color = inkColor(3), colorAt = 0;
  const pointer = { x: 0, y: 0, dx: 0, dy: 0, moved: false, seen: false };
  const onMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const scale = canvas.width / (rect.width || 1);
    const x = (e.clientX - rect.left) * scale, y = (e.clientY - rect.top) * scale;
    if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return void (pointer.seen = false);
    if (pointer.seen) {
      pointer.dx = (x - pointer.x) * 5;
      pointer.dy = (y - pointer.y) * 5;
      pointer.moved = true;
    }
    pointer.seen = true;
    pointer.x = x;
    pointer.y = y;
  };
  window.addEventListener("mousemove", onMove, { passive: true });

  let raf = 0, stopped = false;
  const frame = () => {
    if (stopped) return;
    if (size()) init();
    const now = performance.now();
    if (waves.length) burst(waves.pop()!);
    if (now - started > 700) {
      const base = Math.min(canvas.width, canvas.height) * 0.3;
      const r = base * (0.72 + 0.28 * Math.sin(angle * 0.37));
      angle += 0.022;
      const x = canvas.width / 2 + Math.cos(angle) * r, y = canvas.height / 2 + Math.sin(angle) * r;
      if (seeded) {
        if (now - colorAt > 140) {
          color = inkColor(2.6);
          colorAt = now;
        }
        splat(x, y, (x - prevX) * 9, (y - prevY) * 9, color);
      }
      seeded = true;
      prevX = x;
      prevY = y;
    }
    if (pointer.moved) {
      pointer.moved = false;
      splat(pointer.x, pointer.y, pointer.dx, pointer.dy, inkColor(2.2));
    }
    step(0.016);
    render();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("mousemove", onMove);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}

export default function FluidBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let stop: (() => void) | null = null;
    try {
      stop = startFluid(canvas);
    } catch {
      stop = null;
    }
    if (stop) canvas.classList.add("ready");
    return () => stop?.();
  }, []);
  return <canvas ref={ref} className="login-fluid" aria-hidden="true" />;
}
