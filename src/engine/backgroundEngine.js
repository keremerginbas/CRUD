/* ============================================================
   3D ARKA PLAN MOTORU — 6 sahne (particles, waves, geometric,
   blobs/metaballs, galaxy, black hole) + bloom + tema + shockwave
   + adaptif kalite. three.js (window.THREE, CDN'den yüklenir).

   Bu dosya orijinal tek-sayfa şablonun WebGL motorunun birebir
   taşınmış halidir; initBackground(config) çağrıldığında bir
   kontrol nesnesi döner: {setScene, setTheme, setBloom, next, ...}
   ============================================================ */
/* global THREE */

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  function applyReduced(){
    document.body.classList.toggle('reduced-motion', prefersReduced.matches);
  }
  prefersReduced.addEventListener ? prefersReduced.addEventListener('change', applyReduced)
                                  : prefersReduced.addListener(applyReduced);
  applyReduced();

  const lerp = (a,b,t)=>a+(b-a)*t;

  const THEMES = {
    nebula:   {bg:'#070B18', c:['#6C63FF','#FF6584','#43E97B']},
    synthwave:{bg:'#0D0221', c:['#05D9E8','#FF2A6D','#B537F2']},
    ocean:    {bg:'#03131E', c:['#0FB9E8','#36F1CD','#4D7CFF']},
    sunset:   {bg:'#170B1E', c:['#FFB56B','#FF4E7A','#FFD166']},
    mono:     {bg:'#05070D', c:['#E8ECF5','#8E9AB8','#4A5578']}
  };

  function makeSprite(){
    const cv = document.createElement('canvas'); cv.width=cv.height=64;
    const ctx = cv.getContext('2d');
    const g = ctx.createRadialGradient(32,32,0,32,32,32);
    g.addColorStop(0,'rgba(255,255,255,1)');
    g.addColorStop(0.4,'rgba(255,255,255,.5)');
    g.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle=g; ctx.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(cv);
  }

  function initBackground(config){
    const cfg = Object.assign({
      container:'#bg-canvas',
      scene:'particles',
      theme:'nebula',
      intensity:0.7,
      interactive:true,
      bloom:true
    }, config||{});

    const canvas = document.querySelector(cfg.container);
    const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
    renderer.setClearColor(0x000000, 0);
    let pixelCap = Math.min(window.devicePixelRatio||1, 2);
    renderer.setPixelRatio(pixelCap);
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth/window.innerHeight, 0.1, 500);
    camera.position.set(0, 4, 34);

    const palette = THEMES[cfg.theme].c.map(c=>new THREE.Color(c));
    const bgColor = new THREE.Color(THEMES[cfg.theme].bg);
    let themeName = cfg.theme;

    // ---- etkileşim durumu (lerp'li) + tıklama şoku ----
    const input = {x:0, y:0, tx:0, ty:0, scroll:0, tScroll:0,
                   shockX:0, shockY:0, shockT:-1e3};
    if(cfg.interactive){
      window.addEventListener('pointermove', e=>{
        input.tx = (e.clientX/window.innerWidth)*2-1;
        input.ty = (e.clientY/window.innerHeight)*2-1;
      }, {passive:true});
      window.addEventListener('scroll', ()=>{
        const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
        input.tScroll = window.scrollY / max;
      }, {passive:true});
      window.addEventListener('deviceorientation', e=>{
        if(e.gamma==null) return;
        input.tx = Math.max(-1, Math.min(1, e.gamma/30));
        input.ty = Math.max(-1, Math.min(1, e.beta ? (e.beta-45)/30 : 0));
      }, {passive:true});
      window.addEventListener('pointerdown', e=>{
        if(e.target.closest('button, a, .panel, input, textarea, select, form')) return;
        input.shockX = (e.clientX/window.innerWidth)*2-1;
        input.shockY = (e.clientY/window.innerHeight)*2-1;
        input.shockT = performance.now()/1000;
        if(!prefersReduced.matches){
          const ring = document.createElement('div');
          ring.className = 'shockring';
          ring.style.left = e.clientX+'px';
          ring.style.top = e.clientY+'px';
          document.body.appendChild(ring);
          ring.addEventListener('animationend', ()=>ring.remove());
        }
      }, {passive:true});
    }
    const shockAge = t => t - input.shockT;

    // ==================================================
    //  MİNİ BLOOM HATTI (bright pass → blur → composite)
    // ==================================================
    let bloomOn = cfg.bloom;
    const fsCam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const fsScene = new THREE.Scene();
    const fsGeo = new THREE.PlaneGeometry(2,2);
    const fsMesh = new THREE.Mesh(fsGeo, null);
    fsScene.add(fsMesh);

    const fsVert = `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

    const brightMat = new THREE.ShaderMaterial({
      uniforms:{ tDiffuse:{value:null}, uThreshold:{value:0.35} },
      vertexShader:fsVert,
      fragmentShader:`
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform float uThreshold;
        void main(){
          vec4 c = texture2D(tDiffuse, vUv);
          float l = dot(c.rgb, vec3(0.299,0.587,0.114));
          float f = smoothstep(uThreshold, uThreshold+0.45, l);
          gl_FragColor = vec4(c.rgb*f, 1.0);
        }`
    });
    const blurMat = new THREE.ShaderMaterial({
      uniforms:{ tDiffuse:{value:null}, uDelta:{value:new THREE.Vector2()} },
      vertexShader:fsVert,
      fragmentShader:`
        varying vec2 vUv;
        uniform sampler2D tDiffuse;
        uniform vec2 uDelta;
        void main(){
          vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
          s += texture2D(tDiffuse, vUv + uDelta*1.0).rgb * 0.1945946;
          s += texture2D(tDiffuse, vUv - uDelta*1.0).rgb * 0.1945946;
          s += texture2D(tDiffuse, vUv + uDelta*2.0).rgb * 0.1216216;
          s += texture2D(tDiffuse, vUv - uDelta*2.0).rgb * 0.1216216;
          s += texture2D(tDiffuse, vUv + uDelta*3.0).rgb * 0.054054;
          s += texture2D(tDiffuse, vUv - uDelta*3.0).rgb * 0.054054;
          s += texture2D(tDiffuse, vUv + uDelta*4.0).rgb * 0.016216;
          s += texture2D(tDiffuse, vUv - uDelta*4.0).rgb * 0.016216;
          gl_FragColor = vec4(s, 1.0);
        }`
    });
    const compMat = new THREE.ShaderMaterial({
      uniforms:{ tScene:{value:null}, tBloom:{value:null}, uStrength:{value:1.0} },
      vertexShader:fsVert,
      fragmentShader:`
        varying vec2 vUv;
        uniform sampler2D tScene;
        uniform sampler2D tBloom;
        uniform float uStrength;
        void main(){
          vec4 s = texture2D(tScene, vUv);
          vec3 b = texture2D(tBloom, vUv).rgb * uStrength;
          float ba = clamp((b.r+b.g+b.b)*0.5, 0.0, 1.0);
          gl_FragColor = vec4(s.rgb + b, max(s.a, ba));
        }`
    });

    let rtScene=null, rtA=null, rtB=null;
    const bufSize = new THREE.Vector2();
    function bloomResize(){
      renderer.getDrawingBufferSize(bufSize);
      const w = Math.max(2, Math.floor(bufSize.x));
      const h = Math.max(2, Math.floor(bufSize.y));
      const qw = Math.max(2, Math.floor(w/4));
      const qh = Math.max(2, Math.floor(h/4));
      if(rtScene) rtScene.dispose();
      if(rtA) rtA.dispose();
      if(rtB) rtB.dispose();
      const opts = {minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter, format:THREE.RGBAFormat};
      rtScene = new THREE.WebGLRenderTarget(w, h, opts);
      rtA = new THREE.WebGLRenderTarget(qw, qh, opts);
      rtB = new THREE.WebGLRenderTarget(qw, qh, opts);
    }
    bloomResize();

    function renderWithBloom(bloomCfg){
      renderer.setRenderTarget(rtScene);
      renderer.clear();
      renderer.render(scene, camera);

      brightMat.uniforms.tDiffuse.value = rtScene.texture;
      brightMat.uniforms.uThreshold.value = bloomCfg.threshold;
      fsMesh.material = brightMat;
      renderer.setRenderTarget(rtA); renderer.clear();
      renderer.render(fsScene, fsCam);

      const dx = 1/rtA.width, dy = 1/rtA.height;
      fsMesh.material = blurMat;
      for(let i=0;i<2;i++){
        blurMat.uniforms.tDiffuse.value = rtA.texture;
        blurMat.uniforms.uDelta.value.set(dx*(1+i), 0);
        renderer.setRenderTarget(rtB); renderer.clear();
        renderer.render(fsScene, fsCam);
        blurMat.uniforms.tDiffuse.value = rtB.texture;
        blurMat.uniforms.uDelta.value.set(0, dy*(1+i));
        renderer.setRenderTarget(rtA); renderer.clear();
        renderer.render(fsScene, fsCam);
      }

      compMat.uniforms.tScene.value = rtScene.texture;
      compMat.uniforms.tBloom.value = rtA.texture;
      compMat.uniforms.uStrength.value = bloomCfg.strength;
      fsMesh.material = compMat;
      renderer.setRenderTarget(null);
      renderer.render(fsScene, fsCam);
    }

    // ================= SAHNE 1 · PARTICLE FIELD =================
    function buildParticles(quality){
      const group = new THREE.Group();
      const COUNT = Math.floor(1400 * quality);
      const LINK_COUNT = Math.floor(160 * quality);
      const positions = new Float32Array(COUNT*3);
      const home = new Float32Array(COUNT*3);
      const colors = new Float32Array(COUNT*3);
      const phases = new Float32Array(COUNT);

      for(let i=0;i<COUNT;i++){
        const r = 14 + Math.random()*22;
        const th = Math.random()*Math.PI*2;
        const ph = Math.acos(2*Math.random()-1);
        positions[i*3]=home[i*3]=r*Math.sin(ph)*Math.cos(th);
        positions[i*3+1]=home[i*3+1]=(Math.random()-0.5)*26;
        positions[i*3+2]=home[i*3+2]=r*Math.sin(ph)*Math.sin(th)*0.6;
        phases[i]=Math.random()*Math.PI*2;
        const c = palette[i%3];
        colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
      const sprite = makeSprite();
      const mat = new THREE.PointsMaterial({
        size:0.55, map:sprite, vertexColors:true, transparent:true,
        opacity:0.9, depthWrite:false, blending:THREE.AdditiveBlending
      });
      group.add(new THREE.Points(geo, mat));

      const linkPos = new Float32Array(LINK_COUNT*2*3);
      const linkGeo = new THREE.BufferGeometry();
      linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos,3));
      const linkMat = new THREE.LineBasicMaterial({
        color:palette[0].clone(), transparent:true, opacity:0.16,
        blending:THREE.AdditiveBlending, depthWrite:false
      });
      group.add(new THREE.LineSegments(linkGeo, linkMat));

      let hueT = 0;
      function update(t, dt){
        const pos = geo.attributes.position.array;
        const mx = input.x*24, my = -input.y*12;
        const sAge = shockAge(t);
        const sx = input.shockX*24, sy = -input.shockY*12;
        const ringR = sAge*34;
        for(let i=0;i<COUNT;i++){
          const i3=i*3;
          let px = home[i3]+Math.cos(t*0.25 + phases[i]*1.7)*0.7;
          let py = home[i3+1]+Math.sin(t*0.4 + phases[i])*0.9;
          const dx = px-mx, dy = py-my, d2 = dx*dx+dy*dy;
          if(d2 < 64){
            const f = (64-d2)/64 * 3.2 * cfg.intensity;
            const d = Math.sqrt(d2)||0.001;
            px += dx/d*f; py += dy/d*f;
          }
          if(sAge < 1.6){
            const ddx = px-sx, ddy = py-sy;
            const dist = Math.sqrt(ddx*ddx+ddy*ddy)||0.001;
            const band = Math.exp(-((dist-ringR)*(dist-ringR))/26) * Math.exp(-sAge*1.6) * 7;
            px += ddx/dist*band; py += ddy/dist*band;
          }
          pos[i3]=lerp(pos[i3],px,0.08);
          pos[i3+1]=lerp(pos[i3+1],py,0.08);
        }
        geo.attributes.position.needsUpdate = true;

        hueT += dt*0.05;
        const col = geo.attributes.color.array;
        for(let i=0;i<COUNT;i+=7){
          const base = palette[i%3], next = palette[(i+1)%3];
          const k = (0.5+0.5*Math.sin(hueT + phases[i]))*0.5;
          col[i*3]=lerp(base.r,next.r,k);
          col[i*3+1]=lerp(base.g,next.g,k);
          col[i*3+2]=lerp(base.b,next.b,k);
        }
        geo.attributes.color.needsUpdate = true;

        const lp = linkGeo.attributes.position.array;
        for(let l=0;l<LINK_COUNT;l++){
          const a=(l*17)%COUNT, b=(l*17+9)%COUNT;
          lp[l*6]=pos[a*3]; lp[l*6+1]=pos[a*3+1]; lp[l*6+2]=pos[a*3+2];
          lp[l*6+3]=pos[b*3]; lp[l*6+4]=pos[b*3+1]; lp[l*6+5]=pos[b*3+2];
        }
        linkGeo.attributes.position.needsUpdate = true;

        group.rotation.y = t*0.03 + input.x*0.12;
        group.rotation.x = input.y*0.05;
      }
      function updateCamera(){
        camera.position.x = lerp(camera.position.x, 0, 0.05);
        camera.position.z = lerp(camera.position.z, 34 - input.scroll*10, 0.05);
        camera.position.y = lerp(camera.position.y, 4 - input.scroll*6, 0.05);
        camera.lookAt(0,0,0);
      }
      function dispose(){
        geo.dispose(); mat.dispose(); sprite.dispose();
        linkGeo.dispose(); linkMat.dispose();
      }
      return {object:group, update, updateCamera, dispose,
              fog:0.016, bloom:{threshold:0.32, strength:0.9}};
    }

    // ================= SAHNE 2 · WAVE MESH =================
    function buildWaves(quality){
      const group = new THREE.Group();
      const SEG = Math.floor(110*Math.sqrt(quality));
      const geo = new THREE.PlaneGeometry(90, 90, SEG, SEG);
      geo.rotateX(-Math.PI/2);
      const count = geo.attributes.position.count;
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count*3),3));
      const mat = new THREE.MeshBasicMaterial({
        vertexColors:true, wireframe:true, transparent:true, opacity:0.55
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = -6;
      group.add(mesh);

      const deep = bgColor.clone().lerp(palette[0], 0.15);
      const noise=(x,z,t)=>(
        Math.sin(x*0.14 + t*0.7)*Math.cos(z*0.11 + t*0.5)*1.6 +
        Math.sin(x*0.05 - t*0.3)*1.2 +
        Math.sin((x+z)*0.21 + t*1.1)*0.5
      );

      function update(t){
        const pos = geo.attributes.position.array;
        const col = geo.attributes.color.array;
        const mx = input.x*45, mz = input.y*45;
        const sAge = shockAge(t);
        const sx = input.shockX*45, sz = input.shockY*45;
        const amp = (0.8 + cfg.intensity)*(1 + input.scroll*0.8);
        for(let i=0;i<count;i++){
          const x=pos[i*3], z=pos[i*3+2];
          let h = noise(x,z,t)*amp;
          const dx=x-mx, dz=z-mz, d2=dx*dx+dz*dz;
          if(d2<220) h += (220-d2)/220 * 3.0 * Math.sin(t*2.4);
          if(sAge < 4){
            const sd = Math.sqrt((x-sx)*(x-sx)+(z-sz)*(z-sz));
            h += Math.sin(sd*0.7 - sAge*9) * Math.exp(-sd*0.055) * Math.exp(-sAge*1.4) * 5;
          }
          pos[i*3+1]=h;

          const k = Math.min(1, Math.max(0,(h+3)/7));
          let from, to, u;
          if(k<0.5){ from=deep; to=palette[0]; u=k*2; }
          else if(k<0.75){ from=palette[0]; to=palette[1]; u=(k-0.5)*4; }
          else{ from=palette[1]; to=palette[2]; u=(k-0.75)*4; }
          col[i*3]=lerp(from.r,to.r,u);
          col[i*3+1]=lerp(from.g,to.g,u);
          col[i*3+2]=lerp(from.b,to.b,u);
        }
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
        group.rotation.y = input.x*0.08;
      }
      function updateCamera(){
        camera.position.x = lerp(camera.position.x, 0, 0.05);
        camera.position.z = lerp(camera.position.z, 34 - input.scroll*14, 0.05);
        camera.position.y = lerp(camera.position.y, 9 - input.scroll*4, 0.05);
        camera.lookAt(0,-2,0);
      }
      function dispose(){ geo.dispose(); mat.dispose(); }
      return {object:group, update, updateCamera, dispose,
              fog:0.016, bloom:{threshold:0.30, strength:0.7}};
    }

    // ================= SAHNE 3 · GEOMETRIC CONSTELLATION =================
    function buildGeometric(quality){
      const group = new THREE.Group();
      const N = Math.max(8, Math.floor(14*quality));
      const makers = [
        ()=>new THREE.IcosahedronGeometry(1.4,0),
        ()=>new THREE.OctahedronGeometry(1.2,0),
        ()=>new THREE.TorusKnotGeometry(0.75,0.24,64,8),
        ()=>new THREE.TetrahedronGeometry(1.3,0),
        ()=>new THREE.IcosahedronGeometry(0.9,1)
      ];
      const shapes=[], geos=[], mats=[];
      for(let i=0;i<N;i++){
        const geo = makers[i%makers.length]();
        const mat = new THREE.MeshBasicMaterial({
          color:palette[i%3].clone(), wireframe:true, transparent:true,
          opacity:0.75, blending:THREE.AdditiveBlending, depthWrite:false
        });
        const m = new THREE.Mesh(geo, mat);
        const hx=(Math.random()-0.5)*34, hy=(Math.random()-0.5)*18, hz=(Math.random()-0.5)*16;
        m.position.set(hx,hy,hz);
        m.userData = {
          hx,hy,hz,
          rx:(Math.random()-0.5)*0.8, ry:(Math.random()-0.5)*0.8,
          phase:Math.random()*Math.PI*2,
          speed:0.4+Math.random()*0.7
        };
        group.add(m); shapes.push(m); geos.push(geo); mats.push(mat);
      }

      const pairs=[];
      for(let i=0;i<N;i++){
        const dists = shapes.map((s,j)=>({j, d:i===j?1e9:shapes[i].position.distanceTo(s.position)}))
                            .sort((a,b)=>a.d-b.d);
        pairs.push([i,dists[0].j],[i,dists[1].j]);
      }
      const linkPos = new Float32Array(pairs.length*2*3);
      const linkGeo = new THREE.BufferGeometry();
      linkGeo.setAttribute('position', new THREE.BufferAttribute(linkPos,3));
      const linkMat = new THREE.LineBasicMaterial({
        color:palette[2].clone(), transparent:true, opacity:0.14,
        blending:THREE.AdditiveBlending, depthWrite:false
      });
      group.add(new THREE.LineSegments(linkGeo, linkMat));

      const S = Math.floor(320*quality);
      const sp = new Float32Array(S*3);
      for(let i=0;i<S;i++){
        sp[i*3]=(Math.random()-0.5)*120;
        sp[i*3+1]=(Math.random()-0.5)*70;
        sp[i*3+2]=-30-Math.random()*60;
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(sp,3));
      const sprite = makeSprite();
      const starMat = new THREE.PointsMaterial({
        size:0.5, map:sprite, color:palette[0].clone().lerp(new THREE.Color('#ffffff'),0.4),
        transparent:true, opacity:0.5, depthWrite:false, blending:THREE.AdditiveBlending
      });
      group.add(new THREE.Points(starGeo, starMat));

      function update(t){
        const mx = input.x*22, my=-input.y*11;
        const sAge = shockAge(t);
        const sx = input.shockX*22, sy = -input.shockY*11;
        const ringR = sAge*30;
        for(const m of shapes){
          const u = m.userData;
          m.rotation.x += u.rx*0.01;
          m.rotation.y += u.ry*0.01;
          let px = u.hx + Math.cos(t*0.3+u.phase)*1.2;
          let py = u.hy + Math.sin(t*u.speed*0.5+u.phase)*1.4;
          const dx=px-mx, dy=py-my, d2=dx*dx+dy*dy;
          if(d2<90){
            const f=(90-d2)/90 * 5.0 * cfg.intensity;
            const d=Math.sqrt(d2)||0.001;
            px += dx/d*f; py += dy/d*f;
          }
          if(sAge < 1.6){
            const ddx=px-sx, ddy=py-sy;
            const dist=Math.sqrt(ddx*ddx+ddy*ddy)||0.001;
            const band = Math.exp(-((dist-ringR)*(dist-ringR))/30) * Math.exp(-sAge*1.5) * 8;
            px += ddx/dist*band; py += ddy/dist*band;
          }
          m.position.x = lerp(m.position.x, px, 0.06);
          m.position.y = lerp(m.position.y, py, 0.06);
          const s = 1 + 0.08*Math.sin(t*u.speed*2+u.phase);
          m.scale.setScalar(s);
        }
        const lp = linkGeo.attributes.position.array;
        for(let k=0;k<pairs.length;k++){
          const a=shapes[pairs[k][0]].position, b=shapes[pairs[k][1]].position;
          lp[k*6]=a.x; lp[k*6+1]=a.y; lp[k*6+2]=a.z;
          lp[k*6+3]=b.x; lp[k*6+4]=b.y; lp[k*6+5]=b.z;
        }
        linkGeo.attributes.position.needsUpdate = true;
        group.rotation.y = Math.sin(t*0.07)*0.15 + input.x*0.1;
        group.rotation.x = input.y*0.06;
      }
      function updateCamera(){
        camera.position.x = lerp(camera.position.x, 0, 0.05);
        camera.position.z = lerp(camera.position.z, 30 - input.scroll*12, 0.05);
        camera.position.y = lerp(camera.position.y, 1 + input.scroll*3, 0.05);
        camera.lookAt(0,0,0);
      }
      function dispose(){
        geos.forEach(g=>g.dispose()); mats.forEach(m=>m.dispose());
        linkGeo.dispose(); linkMat.dispose();
        starGeo.dispose(); starMat.dispose(); sprite.dispose();
      }
      return {object:group, update, updateCamera, dispose,
              fog:0.012, bloom:{threshold:0.30, strength:0.9}};
    }

    // ================= SAHNE 4 · RAYMARCHED METABALLS =================
    function buildBlobs(){
      const group = new THREE.Group();
      const uniforms = {
        uTime:{value:0},
        uResolution:{value:new THREE.Vector2(1,1)},
        uMouse:{value:new THREE.Vector2(0,0)},
        uShock:{value:new THREE.Vector3(0,0,999)},
        uScroll:{value:0},
        uC1:{value:palette[0].clone()},
        uC2:{value:palette[1].clone()},
        uC3:{value:palette[2].clone()},
        uBg:{value:bgColor.clone()}
      };
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader:`
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          }`,
        fragmentShader:`
          precision highp float;
          varying vec2 vUv;
          uniform float uTime, uScroll;
          uniform vec2 uResolution, uMouse;
          uniform vec3 uShock;
          uniform vec3 uC1, uC2, uC3, uBg;

          float smin(float a, float b, float k){
            float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
            return mix(b, a, h) - k*h*(1.0-h);
          }
          float map(vec3 p){
            float t = uTime*0.5;
            float d = length(p - vec3(sin(t*0.7)*1.3, cos(t*0.9)*0.9, sin(t*0.5)*0.6)) - 0.95;
            d = smin(d, length(p - vec3(cos(t*0.6)*1.5, sin(t*0.8)*1.1, cos(t*0.4)*0.5)) - 0.72, 0.9);
            d = smin(d, length(p - vec3(sin(t*1.1+2.0), sin(t*0.7+1.0)*1.3, cos(t*0.9)*0.4)) - 0.62, 0.9);
            d = smin(d, length(p - vec3(cos(t*0.5+4.0)*1.7, cos(t*1.2+3.0)*0.7, sin(t*0.8+1.0)*0.5)) - 0.78, 0.9);
            vec3 m = vec3(uMouse.x*2.2, -uMouse.y*1.4, 0.3);
            d = smin(d, length(p - m) - 0.55, 0.8);
            float sAge = uShock.z;
            if(sAge < 1.4){
              float rB = 1.15 * sin(clamp(sAge/1.3, 0.0, 1.0)*3.14159);
              vec3 sp = vec3(uShock.x*2.2, -uShock.y*1.4, 0.2);
              d = smin(d, length(p - sp) - max(rB, 0.001), 0.9);
            }
            return d;
          }
          vec3 calcNormal(vec3 p){
            vec2 e = vec2(0.002, 0.0);
            return normalize(vec3(
              map(p+e.xyy)-map(p-e.xyy),
              map(p+e.yxy)-map(p-e.yxy),
              map(p+e.yyx)-map(p-e.yyx)));
          }
          void main(){
            vec2 uv = vUv*2.0-1.0;
            uv.x *= uResolution.x/uResolution.y;
            uv += uMouse*0.06;

            vec3 ro = vec3(0.0, 0.0, 4.2 - uScroll*1.4);
            vec3 rd = normalize(vec3(uv, -1.8));

            float t = 0.0; float d; vec3 p; bool hit=false;
            float glow = 0.0;
            for(int i=0;i<60;i++){
              p = ro + rd*t;
              d = map(p);
              glow += exp(-d*3.0)*0.012;
              if(d < 0.0015){ hit=true; break; }
              t += d;
              if(t > 12.0) break;
            }
            vec3 bg = mix(uBg*0.85, uBg*1.6 + uC1*0.05, vUv.y);
            bg *= 1.0 - 0.45*length(vUv-0.5);
            vec3 col = bg + glow*mix(uC1,uC2,0.5);

            if(hit){
              vec3 n = calcNormal(p);
              float fres = pow(1.0 - max(dot(n, -rd), 0.0), 2.2);
              float k1 = 0.5 + 0.5*sin(uTime*0.3 + p.x*0.8 + p.y*0.5);
              vec3 base = mix(uC1, uC2, k1);
              base = mix(base, uC3, (0.5+0.5*n.y)*0.45);
              float diff = max(dot(n, normalize(vec3(0.6,0.8,0.4))), 0.0);
              col = base*(0.30 + 0.70*diff) + fres*mix(uC2,uC3,0.5)*0.95;
              col = mix(col, bg, smoothstep(6.0, 12.0, t));
            }
            float sAge = uShock.z;
            if(sAge >= 0.0 && sAge < 1.2) col += uC3 * exp(-sAge*4.0)*0.18;

            float g = fract(sin(dot(vUv*uResolution + uTime, vec2(12.9898,78.233)))*43758.5453);
            col += (g-0.5)*0.02;
            gl_FragColor = vec4(col, 1.0);
          }`
      });
      const geo = new THREE.PlaneGeometry(1,1);
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);

      function update(t){
        uniforms.uTime.value = t;
        uniforms.uMouse.value.set(input.x, input.y);
        uniforms.uShock.value.set(input.shockX, input.shockY, shockAge(t));
        uniforms.uScroll.value = input.scroll;
        uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
        const dist = camera.position.z;
        const h = 2*dist*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
        mesh.scale.set(h*camera.aspect, h, 1);
      }
      function updateCamera(){
        camera.position.set(
          lerp(camera.position.x,0,0.1),
          lerp(camera.position.y,0,0.1),
          lerp(camera.position.z,20,0.1)
        );
        camera.lookAt(0,0,0);
      }
      function dispose(){ geo.dispose(); mat.dispose(); }
      return {object:group, update, updateCamera, dispose,
              fog:0, bloom:{threshold:0.5, strength:0.8}};
    }

    // ================= SAHNE 5 · SPIRAL GALAXY =================
    function buildGalaxy(quality){
      const group = new THREE.Group();
      const COUNT = Math.floor(9000*quality);
      const BRANCHES = 4, RADIUS = 22;
      const positions = new Float32Array(COUNT*3);
      const colors = new Float32Array(COUNT*3);
      const inner = palette[1], mid = palette[0], outer = palette[2];

      for(let i=0;i<COUNT;i++){
        const r = Math.pow(Math.random(),0.7)*RADIUS;
        const branch = ((i%BRANCHES)/BRANCHES)*Math.PI*2;
        const spin = r*0.32;
        const rand = ()=> (Math.random()-0.5)*(Math.random()-0.5)*4;
        const spread = (1 - r/RADIUS)*0.6 + 0.4;
        const a = branch + spin;
        positions[i*3]   = Math.cos(a)*r + rand()*spread*2.2;
        positions[i*3+1] = rand()*spread*1.1;
        positions[i*3+2] = Math.sin(a)*r + rand()*spread*2.2;

        const k = r/RADIUS;
        let c;
        if(k<0.35){ c = inner.clone().lerp(mid, k/0.35); }
        else{ c = mid.clone().lerp(outer, (k-0.35)/0.65); }
        if(Math.random()<0.03) c = new THREE.Color(0xffffff);
        colors[i*3]=c.r; colors[i*3+1]=c.g; colors[i*3+2]=c.b;
      }

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
      const sprite = makeSprite();
      const mat = new THREE.PointsMaterial({
        size:0.34, map:sprite, vertexColors:true, transparent:true,
        opacity:0.95, depthWrite:false, blending:THREE.AdditiveBlending
      });
      group.add(new THREE.Points(geo, mat));

      const coreGeo = new THREE.BufferGeometry();
      coreGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0]),3));
      const coreMat = new THREE.PointsMaterial({
        size:9, map:sprite, color:inner.clone(), transparent:true,
        opacity:0.85, depthWrite:false, blending:THREE.AdditiveBlending
      });
      group.add(new THREE.Points(coreGeo, coreMat));

      group.rotation.x = -0.45;
      let rotOffset = 0;

      function update(t, dt){
        const sAge = shockAge(t);
        if(sAge >= 0 && sAge < 3){
          rotOffset += 1.4*Math.exp(-sAge*2)*dt;
        }
        group.rotation.y = t*0.05 + rotOffset + input.x*0.25;
        group.rotation.x = -0.45 + input.y*0.12 - input.scroll*0.25;
        const flash = (sAge>=0 && sAge<2) ? Math.exp(-sAge*2.5) : 0;
        coreMat.size = 9 + Math.sin(t*1.2)*1.2 + flash*7;
      }
      function updateCamera(){
        camera.position.x = lerp(camera.position.x, 0, 0.05);
        camera.position.z = lerp(camera.position.z, 34 - input.scroll*22, 0.04);
        camera.position.y = lerp(camera.position.y, 10 - input.scroll*7, 0.04);
        camera.lookAt(0,0,0);
      }
      function dispose(){
        geo.dispose(); mat.dispose();
        coreGeo.dispose(); coreMat.dispose(); sprite.dispose();
      }
      return {object:group, update, updateCamera, dispose,
              fog:0.008, bloom:{threshold:0.22, strength:1.35}};
    }

    // ================= SAHNE 6 · BLACK HOLE (kütleçekimsel mercek) =================
    function buildBlackHole(quality){
      const group = new THREE.Group();
      const uniforms = {
        uTime:{value:0},
        uResolution:{value:new THREE.Vector2(1,1)},
        uMouse:{value:new THREE.Vector2(0,0)},
        uScroll:{value:0},
        uShockAge:{value:999},
        uSteps:{value:Math.max(80, Math.floor(150*Math.min(1, quality)))},
        uC1:{value:palette[0].clone()},
        uC2:{value:palette[1].clone()},
        uC3:{value:palette[2].clone()},
        uBg:{value:bgColor.clone()}
      };
      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader:`
          varying vec2 vUv;
          void main(){
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          }`,
        fragmentShader:`
          precision highp float;
          varying vec2 vUv;
          uniform float uTime, uScroll, uShockAge, uSteps;
          uniform vec2 uResolution, uMouse;
          uniform vec3 uC1, uC2, uC3, uBg;

          float hash21(vec2 p){
            p = fract(p*vec2(123.34, 456.21));
            p += dot(p, p+45.32);
            return fract(p.x*p.y);
          }
          float vnoise(vec2 p){
            vec2 i = floor(p); vec2 f = fract(p);
            f = f*f*(3.0-2.0*f);
            float a = hash21(i);
            float b = hash21(i+vec2(1.0,0.0));
            float c = hash21(i+vec2(0.0,1.0));
            float d = hash21(i+vec2(1.0,1.0));
            return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
          }
          float fbm(vec2 p){
            float v = 0.0; float a = 0.5;
            for(int i=0;i<4;i++){ v += a*vnoise(p); p *= 2.1; a *= 0.5; }
            return v;
          }
          vec3 stars(vec3 rd){
            vec2 uv = vec2(atan(rd.z, rd.x), asin(clamp(rd.y,-1.0,1.0)));
            uv *= 9.0;
            vec2 id = floor(uv); vec2 gv = fract(uv)-0.5;
            vec3 col = uBg*1.15;
            float h = hash21(id);
            if(h > 0.9){
              vec2 off = (vec2(hash21(id+1.3), hash21(id+2.7))-0.5)*0.7;
              float d = length(gv - off);
              float tw = 0.6 + 0.4*sin(uTime*2.0 + h*40.0);
              float s = smoothstep(0.06, 0.0, d) * (0.3+0.7*hash21(id+5.0)) * tw;
              col += s * mix(vec3(1.0), uC1, hash21(id+9.0)*0.5);
            }
            return col;
          }
          void main(){
            vec2 uv = vUv*2.0-1.0;
            uv.x *= uResolution.x/uResolution.y;
            if(uShockAge >= 0.0 && uShockAge < 1.0){
              float sh = exp(-uShockAge*6.0)*0.015;
              uv += vec2(hash21(vec2(uTime,1.0))-0.5, hash21(vec2(uTime,7.0))-0.5)*sh*2.0;
            }

            float yaw = uMouse.x*0.7 + uTime*0.03;
            float pitch = 0.22 - uMouse.y*0.22;
            float dist = 12.5 - uScroll*5.5;
            vec3 ro = vec3(sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch)) * dist;
            vec3 fw = normalize(-ro);
            vec3 rt = normalize(cross(vec3(0.0,1.0,0.0), fw));
            vec3 up = cross(fw, rt);
            vec3 rd = normalize(fw*1.7 + uv.x*rt + uv.y*up);

            float diskIn = 2.3;
            float diskOut = 7.5;
            float diskBoost = 1.0;
            if(uShockAge >= 0.0 && uShockAge < 2.0)
              diskBoost += 2.2*exp(-uShockAge*2.5);

            float h2 = pow(length(cross(ro, rd)), 2.0);
            vec3 p = ro;
            vec3 v = rd;
            vec3 col = vec3(0.0);
            float trans = 1.0;
            float halo = 0.0;
            bool done = false;

            for(int i=0;i<200;i++){
              if(float(i) >= uSteps) break;
              float r = length(p);
              if(r < 1.0){ done = true; break; }
              float dt = 0.09 + r*0.028;
              v += -1.5 * h2 * p / pow(r, 5.0) * dt;
              vec3 np = p + v*dt;
              halo += dt/(r*r*r);
              if(p.y * np.y < 0.0){
                float k = p.y/(p.y - np.y);
                vec3 hitp = mix(p, np, k);
                float hr = length(hitp.xz);
                if(hr > diskIn && hr < diskOut){
                  float ang = atan(hitp.z, hitp.x);
                  float sw = fbm(vec2(hr*1.4 - uTime*1.1, ang*3.0 + hr*2.2 + uTime*0.5));
                  float temp = smoothstep(diskOut, diskIn, hr);
                  vec3 dc = mix(uC1, uC2, temp);
                  dc = mix(dc, vec3(1.0,0.97,0.9), temp*temp*0.75);
                  vec3 tangent = normalize(vec3(-hitp.z, 0.0, hitp.x));
                  float dop = dot(tangent, normalize(ro - hitp));
                  float beam = 1.0 + dop*0.85;
                  float bright = (0.35 + sw*0.85) * (0.25 + temp*1.3) * beam * diskBoost;
                  col += dc * bright * trans;
                  trans *= 0.25;
                  if(trans < 0.05){ done = true; break; }
                }
              }
              p = np;
              if(r > 36.0 && dot(p, v) > 0.0){
                col += stars(normalize(v)) * trans;
                done = true; break;
              }
            }
            if(!done) col += uBg * trans * 0.6;
            col += mix(uC2, uC3, 0.35) * halo * 0.16;
            col *= 1.0 - 0.35*pow(length(vUv-0.5)*1.3, 2.0);
            float g = fract(sin(dot(vUv*uResolution + uTime, vec2(12.9898,78.233)))*43758.5453);
            col += (g-0.5)*0.02;
            gl_FragColor = vec4(col, 1.0);
          }`
      });
      const geo = new THREE.PlaneGeometry(1,1);
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);

      function update(t){
        uniforms.uTime.value = t;
        uniforms.uMouse.value.set(input.x, input.y);
        uniforms.uScroll.value = input.scroll;
        uniforms.uShockAge.value = shockAge(t);
        uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height);
        const dist = camera.position.z;
        const h = 2*dist*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
        mesh.scale.set(h*camera.aspect, h, 1);
      }
      function updateCamera(){
        camera.position.set(
          lerp(camera.position.x,0,0.1),
          lerp(camera.position.y,0,0.1),
          lerp(camera.position.z,20,0.1)
        );
        camera.lookAt(0,0,0);
      }
      function dispose(){ geo.dispose(); mat.dispose(); }
      return {object:group, update, updateCamera, dispose,
              fog:0, bloom:{threshold:0.42, strength:1.15}};
    }

    const builders = {
      particles:buildParticles,
      waves:buildWaves,
      geometric:buildGeometric,
      blobs:buildBlobs,
      galaxy:buildGalaxy,
      blackhole:buildBlackHole
    };
    const ORDER = ['particles','waves','geometric','blobs','galaxy','blackhole'];

    // ---------- sahne yaşam döngüsü (fade ile) ----------
    let active=null, activeName=null, quality=1, switching=false;

    function mount(name){
      if(active){ scene.remove(active.object); active.dispose(); }
      active = builders[name](quality);
      scene.fog = active.fog ? new THREE.FogExp2(bgColor.clone(), active.fog) : null;
      scene.add(active.object);
      activeName = name;
      document.querySelectorAll('.chip[data-scene]').forEach(c=>
        c.classList.toggle('active', c.dataset.scene===name));
    }
    function fadeSwap(fn){
      if(switching) return;
      switching = true;
      canvas.style.opacity = 0;
      setTimeout(()=>{
        fn();
        canvas.style.opacity = 1;
        switching = false;
      }, 360);
    }
    function setScene(name, instant){
      if(!builders[name] || activeName===name) return;
      if(instant || !active){ mount(name); return; }
      fadeSwap(()=>mount(name));
    }
    mount(cfg.scene);

    // ---------- tema geçişi ----------
    function setTheme(name){
      if(!THEMES[name] || themeName===name) return;
      fadeSwap(()=>{
        themeName = name;
        const th = THEMES[name];
        for(let i=0;i<3;i++) palette[i].set(th.c[i]);
        bgColor.set(th.bg);
        const root = document.documentElement.style;
        root.setProperty('--bg-deep', th.bg);
        root.setProperty('--c1', th.c[0]);
        root.setProperty('--c2', th.c[1]);
        root.setProperty('--c3', th.c[2]);
        const cur = activeName; activeName = null;
        mount(cur);
        document.querySelectorAll('.dot').forEach(d=>
          d.classList.toggle('active', d.dataset.theme===name));
      });
    }

    // ---------- bloom aç/kapat ----------
    const bloomBtn = document.getElementById('bloomBtn');
    function setBloom(on){
      bloomOn = on;
      if(bloomBtn) bloomBtn.classList.toggle('active', on);
    }
    setBloom(bloomOn);

    // ---------- adaptif kalite ----------
    let frames=0, acc=0;
    const fpsEl=document.getElementById('fps');
    function monitor(dt){
      frames++; acc+=dt;
      if(acc>=1){
        const fps = frames/acc;
        if(fpsEl) fpsEl.textContent = Math.round(fps)+' fps';
        if(fps<30){
          if(bloomOn){
            setBloom(false);
          }else if(quality>0.35){
            quality = Math.max(0.35, quality*0.7);
            pixelCap = Math.max(1, pixelCap*0.8);
            renderer.setPixelRatio(pixelCap);
            bloomResize();
            const cur = activeName; activeName=null; mount(cur);
          }
        }
        frames=0; acc=0;
      }
    }

    // ---------- render döngüsü ----------
    let running=true, last=performance.now();
    document.addEventListener('visibilitychange', ()=>{
      running = !document.hidden;
      if(running){ last=performance.now(); requestAnimationFrame(loop); }
    });

    function loop(now){
      if(!running || prefersReduced.matches) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05,(now-last)/1000); last=now;
      const t = now/1000;

      input.x = lerp(input.x, input.tx, 0.05);
      input.y = lerp(input.y, input.ty, 0.05);
      input.scroll = lerp(input.scroll, input.tScroll, 0.06);

      active.update(t, dt);
      active.updateCamera(t);
      monitor(dt);

      if(bloomOn){
        renderWithBloom(active.bloom);
      }else{
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      }
    }
    requestAnimationFrame(loop);

    prefersReduced.addEventListener && prefersReduced.addEventListener('change', ()=>{
      if(!prefersReduced.matches && !document.hidden){
        last=performance.now(); requestAnimationFrame(loop);
      }
    });

    window.addEventListener('resize', ()=>{
      camera.aspect = window.innerWidth/window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      bloomResize();
    });

    return {
      setScene, setTheme, setBloom,
      next(){ setScene(ORDER[(ORDER.indexOf(activeName)+1)%ORDER.length]); },
      get sceneName(){ return activeName; },
      get bloom(){ return bloomOn; }
    };
  }

export { initBackground };
