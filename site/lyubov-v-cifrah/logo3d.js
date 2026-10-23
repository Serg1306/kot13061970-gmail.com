// Логотип «Любовь в цифрах»: вращающийся 3D-шар инь-ян (WebGL).
// <canvas data-logo3d> — шар без свечения (шапка), <canvas data-logo3d="hero"> — со свечением и искрами.
// Без WebGL холст заменяется картинкой из data-fallback; при «уменьшенном движении» — один неподвижный кадр.
// window.LVCLogo(size) рисует такой же шар вне страницы — для видео-карточки сторис в index.html.
(() => {
  const FRAG = `
precision highp float;
uniform vec2 res;
uniform float t;
uniform float R;        // радиус шара в долях половины холста
uniform float glow;     // 0 — без ауры и искр, 1 — полная
const float PI = 3.14159265;
const float LOOP = 6.0;
const vec3 PINK = vec3(1.0, 0.31, 0.545);
const vec3 BLUE = vec3(0.31, 0.486, 1.0);

mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1.,0.,0.,0.,c,s,0.,-s,c);}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0.,-s,0.,1.,0.,s,0.,c);}
mat3 rz(float a){float c=cos(a),s=sin(a);return mat3(c,s,0.,-s,c,0.,0.,0.,1.);}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float heart(vec2 p){
  p.y += 0.15;
  float a = p.x*p.x + p.y*p.y - 1.0;
  return a*a*a - p.x*p.x*p.y*p.y*p.y;
}

void main(){
  vec2 uv = (gl_FragCoord.xy - 0.5*res) / (0.5*res.y);
  vec2 q = uv / R;
  float r2 = dot(q,q);
  float rr = sqrt(r2);
  float ph = t / LOOP * 2.0 * PI;
  float beat = 1.0 + 0.10*pow(max(sin(t*PI*2.0),0.0),6.0) + 0.05*pow(max(sin(t*PI*2.0-0.9),0.0),6.0);
  mat3 M = rz(-0.22) * rx(-0.38 + 0.06*sin(ph*2.0)) * ry(0.30*sin(ph)) * rz(-ph);

  vec3 col = vec3(0.0);
  float alpha = 0.0;
  vec3 g = vec3(0.0);

  if (glow > 0.0) {
    vec3 auraCol = mix(BLUE, PINK, smoothstep(-0.5,0.5, uv.x + 0.25*sin(ph)));
    g += auraCol * (0.45*exp(-max(rr-1.0,0.0)*7.0) + 0.12*exp(-max(rr-1.0,0.0)*2.5)) * step(1.0, rr);

    // искры по кольцам вокруг шара
    float ang = atan(uv.y, uv.x);
    float rad = length(uv);
    for (int k=0;k<3;k++){
      float fk = float(k);
      float rings = 14.0 + fk*6.0;
      float ri = floor(rad*rings);
      float speed = (mod(ri,2.0)==0.0 ? 1.0 : -1.0) * (1.0 + mod(ri,3.0));
      float a2 = ang + ph*speed/(1.0+fk) + hash(vec2(ri,fk))*6.28;
      float n = 18.0 + fk*10.0;
      float ci = floor(a2/(2.0*PI)*n);
      vec2 cell = vec2(ci, ri);
      float h = hash(cell + fk*7.3);
      if (h > 0.78) {
        float ca = (ci+0.5)/n*2.0*PI;
        float cr = (ri+0.5)/rings;
        vec2 local = vec2((a2 - ca)*rad, rad - cr);
        float sz = 0.0035 + 0.005*hash(cell+3.1);
        float d = length(local);
        float tw = 0.6 + 0.4*sin(ph*float(1+int(mod(ri,4.0))) + h*30.0);
        float fade = smoothstep(R*1.02, R*1.25, rad) * (1.0 - smoothstep(0.8, 1.0, rad));
        vec3 sc = mix(BLUE, PINK, step(0.0, cos(ca)));
        if (hash(cell+9.0) > 0.82) sc = mix(PINK, BLUE, step(0.0, cos(ca)));
        g += sc * (smoothstep(sz, 0.0, d)*1.8 + exp(-d/(sz*2.5))*0.35) * tw * fade;
      }
    }

    // свечение сердец
    for (int i=0;i<2;i++){
      float sgn = i==0 ? 1.0 : -1.0;
      vec3 hc = i==0 ? PINK : BLUE;
      vec3 cw = M * vec3(0.0, 0.5*sgn, sqrt(0.75));
      vec3 cb = M * vec3(0.0, 0.5*sgn, -sqrt(0.75));
      g += hc * exp(-length(q - cw.xy)*6.0) * 0.56 * smoothstep(-0.1, 0.4, cw.z) * beat;
      g += hc * exp(-length(q - cb.xy)*6.0) * 0.56 * smoothstep(-0.1, 0.4, cb.z) * beat;
    }
    g *= glow;
  }

  if (r2 < 1.0) {
    vec3 n = vec3(q, sqrt(1.0 - r2));
    vec3 o = n * M;
    vec2 p = o.xy;

    bool pink = p.x > 0.0;
    if (dot(p-vec2(0.,0.5),p-vec2(0.,0.5)) < 0.25) pink = false;
    if (dot(p+vec2(0.,0.5),p+vec2(0.,0.5)) < 0.25) pink = true;
    vec3 base = pink ? PINK : BLUE;

    float dS = 10.0;
    if (p.x >= 0.0) dS = min(dS, abs(length(p-vec2(0.,0.5))-0.5));
    if (p.x <= 0.0) dS = min(dS, abs(length(p+vec2(0.,0.5))-0.5));
    // у края шара проекция сжимается: сужаем канавку, чтобы не было клина
    float fw = min(length(fwidth(p)), 0.01) + 1e-4;
    float gw = max(0.012, fw*0.8) * smoothstep(0.0, 0.35, abs(o.z));
    float groove = (1.0 - smoothstep(gw, gw + fw*1.5, dS)) * smoothstep(0.02, 0.2, abs(o.z));
    float lip = (1.0 - smoothstep(0.0, fw*1.2, abs(dS-gw-0.008))) * smoothstep(0.05, 0.3, abs(o.z));

    vec3 L = normalize(vec3(-0.55, 0.65, 0.75));
    vec3 H = normalize(L + vec3(0.,0.,1.));
    float ndl = max(dot(n,L),0.0);
    float ndh = max(dot(n,H),0.0);
    float fres = pow(1.0 - n.z, 3.0);
    vec3 refl = reflect(vec3(0.,0.,-1.), n);

    vec3 c = base * (0.18 + 0.82*ndl);
    c *= 0.6 + 0.4*n.z;
    c += vec3(1.0) * exp(-pow((refl.y-0.55)/0.06,2.0)) * clamp(-refl.x+0.3,0.,1.) * 0.35;
    c += vec3(1.0) * exp(-pow((refl.y+0.35)/0.05,2.0)) * clamp(refl.x+0.2,0.,1.) * 0.10;
    c += base * pow(clamp(refl.y,0.,1.),2.0) * 0.18;
    c += vec3(1.0) * pow(ndh, 140.0) * 1.4;
    c += vec3(1.0) * pow(ndh, 22.0) * 0.18;
    c += (pink ? BLUE : PINK) * fres * 0.75;
    c *= 1.0 - groove*0.85;
    c += vec3(1.0,0.92,1.0) * lip * 0.35 * (0.4+0.6*ndl);

    float s = 0.19 * beat;
    float hT = heart((p - vec2(0.,0.5))/s);
    float hB = heart((p + vec2(0.,0.5))/s);
    if (hT < 0.0) {
      vec3 e = mix(PINK*1.2, vec3(1.0,0.88,0.95), clamp(-hT*3.0,0.,1.)*0.7);
      c = o.z > 0.0 ? e : mix(c, PINK, 0.35);
    }
    if (hB < 0.0) {
      vec3 e = mix(BLUE*1.2, vec3(0.88,0.95,1.0), clamp(-hB*3.0,0.,1.)*0.7);
      c = o.z > 0.0 ? e : mix(c, BLUE, 0.35);
    }
    col = c;
    alpha = clamp((1.0 - rr) * R * res.y * 0.5 / 1.2, 0.0, 1.0);
  }

  vec3 pre = col*alpha + g;
  pre = clamp((1.0 - exp(-pre*1.2)) / (1.0 - exp(-1.2)), 0.0, 1.0);
  gl_FragColor = vec4(pre, max(alpha, max(pre.r, max(pre.g, pre.b))));
}`;
  const VERT = 'attribute vec2 p; void main(){ gl_Position = vec4(p,0.,1.); }';

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const items = [];

  function fallback(cv) {
    const img = new Image();
    img.src = cv.dataset.fallback || 'icons/logo-3d-256.png';
    img.alt = cv.getAttribute('aria-label') || '';
    img.className = cv.className;
    img.decoding = 'async';
    cv.replaceWith(img);
  }

  // fixed — размер холста вне страницы (карточка для сторис): без замены картинкой и без общего цикла
  function setup(cv, fixed) {
    const hero = cv.dataset.logo3d === 'hero';
    const fail = () => (fixed ? null : fallback(cv));
    const gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: Boolean(fixed) });
    if (!gl || !gl.getExtension('OES_standard_derivatives')) return fail();
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, (type === gl.FRAGMENT_SHADER ? '#extension GL_OES_standard_derivatives : enable\n' : '') + src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return fail();
    const pr = gl.createProgram();
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return fail();
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1f(gl.getUniformLocation(pr, 'R'), hero ? 0.55 : 0.96);
    gl.uniform1f(gl.getUniformLocation(pr, 'glow'), hero ? 1 : 0);
    const uRes = gl.getUniformLocation(pr, 'res'), uT = gl.getUniformLocation(pr, 't');
    const it = { cv, gl, visible: true, size: 0, hero };
    it.draw = (time) => {
      const px = fixed || Math.round(cv.clientWidth * Math.min(devicePixelRatio || 1, hero ? 1.5 : 2));
      if (px && px !== it.size) { it.size = cv.width = cv.height = px; gl.viewport(0, 0, px, px); }
      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uT, time);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    if (fixed) return it;
    if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { it.visible = e.isIntersecting; }).observe(cv);
    cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); items.splice(items.indexOf(it), 1); fallback(cv); });
    items.push(it);
  }

  // Шар для карточки сторис: LVCLogo(360) → { cv, draw(t) } или null без WebGL.
  window.LVCLogo = size => { const cv = document.createElement('canvas'); cv.dataset.logo3d = 'hero'; return setup(cv, size); };
  document.querySelectorAll('canvas[data-logo3d]').forEach(cv => setup(cv));
  if (!items.length) return;

  const t0 = performance.now();
  let raf = 0;
  const frame = (now) => {
    raf = 0;
    const t = (now - t0) / 1000;
    for (const it of items) if (it.visible && it.cv.clientWidth) it.draw(t);
    if (!still.matches && !document.hidden) raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf) raf = requestAnimationFrame(frame); };
  // неподвижный кадр: шар повёрнут так, чтобы был виден весь знак
  const pose = () => { for (const it of items) it.draw(0); };
  const sync = () => { if (still.matches) pose(); else start(); };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  still.addEventListener?.('change', sync);
  addEventListener('resize', () => { if (still.matches) pose(); });
  sync();
})();
