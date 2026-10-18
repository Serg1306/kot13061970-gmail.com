// 3D-сцена главной страницы: фотографии в объёмных рамках, глянцевое сердце и летающие цифры.
// Сборка: sh site/lyubov-v-cifrah/tools/3d/build.sh. Результат — site/lyubov-v-cifrah/3d/scene.js.
import * as THREE from 'three';
import { Font } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import digitsFont from './digits.json';

const COLORS = { rose: 0xe8457a, sea: 0x2fb5a8, sun: 0xf5b331, plum: 0x8f63e6 };

function heartShape(s = 1) {
  const h = new THREE.Shape();
  h.moveTo(0, -0.9 * s);
  h.bezierCurveTo(-0.15 * s, -0.75 * s, -1 * s, -0.25 * s, -1 * s, 0.25 * s);
  h.bezierCurveTo(-1 * s, 0.75 * s, -0.4 * s, 0.95 * s, 0, 0.5 * s);
  h.bezierCurveTo(0.4 * s, 0.95 * s, 1 * s, 0.75 * s, 1 * s, 0.25 * s);
  h.bezierCurveTo(1 * s, -0.25 * s, 0.15 * s, -0.75 * s, 0, -0.9 * s);
  return h;
}

function heartGeometry(s, depth) {
  const g = new THREE.ExtrudeGeometry(heartShape(s), {
    depth, bevelEnabled: true, bevelThickness: depth * 0.6, bevelSize: s * 0.12, bevelSegments: 8, curveSegments: 24,
  });
  g.center();
  return g;
}

function roundRect(w, h, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

// Плоская фотография со скруглёнными углами: UV от 0 до 1 по размеру карточки
function photoGeometry(w, h, r) {
  const g = new THREE.ShapeGeometry(roundRect(w, h, r), 12);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5);
  return g;
}

const glossy = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, ...extra,
});

// Удар сердца: два быстрых толчка, потом пауза.
const beat = t => { const p = t % 1.1; return 1 + 0.09 * Math.exp(-((p - 0.1) ** 2) / 0.003) + 0.06 * Math.exp(-((p - 0.32) ** 2) / 0.003); };
const ease = k => k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;

export async function start(canvas, { photos = [], onReady } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 760 ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const look = new THREE.Vector3(0, 1.7, 0);

  scene.add(new THREE.HemisphereLight(0xfff0f6, 0xb9d6ff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(3, 7, 6);
  scene.add(sun);
  const rim = new THREE.PointLight(0xff7aa8, 14, 12);
  rim.position.set(-3, 3, -1);
  scene.add(rim);

  // Фотографии в объёмных рамках
  const texLoader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const textures = await Promise.all(photos.map(p => texLoader.loadAsync(p.src).then(t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, maxAniso);
    return t;
  })));
  const frameColors = [0xffffff, 0xffe3ee, 0xe4f6ff];
  // мягкая тень под карточкой: радиальный градиент
  const shadowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(90,30,70,0.55)'); g.addColorStop(1, 'rgba(90,30,70,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();
  const H = 2.6;
  const cards = textures.map((tex, i) => {
    const aspect = tex.image.width / tex.image.height, W = H * aspect, R = 0.14;
    const group = new THREE.Group();
    const frame = new THREE.Mesh(
      new THREE.ExtrudeGeometry(roundRect(W + 0.14, H + 0.14, R + 0.05), { depth: 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 4, curveSegments: 12 }),
      glossy(frameColors[i % frameColors.length], { roughness: 0.3 }),
    );
    frame.position.z = -0.1;
    const photo = new THREE.Mesh(photoGeometry(W, H, R), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    photo.position.z = 0.02;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.6, H * 0.45), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.5, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    group.add(frame, photo);
    scene.add(group, glow);
    return { group, glow, photo, slot: i, from: null, t0: 0, ph: i * 2.1 };
  });

  // Места для карточек: центр впереди, две по бокам чуть сзади и развёрнуты к центру
  let slots;
  const layout = narrow => {
    const sx = narrow ? 1.0 : 2.05, back = narrow ? -1.0 : -1.2, turn = narrow ? 0.5 : 0.42, side = narrow ? 0.6 : 0.84;
    slots = [
      { x: 0, z: 0.35, ry: 0, s: 1 },
      { x: -sx, z: back, ry: turn, s: side },
      { x: sx, z: back, ry: -turn, s: side },
    ];
  };
  layout(false);
  const slotOf = c => slots[c.slot % slots.length];

  // Сердце над карточками
  const heart = new THREE.Mesh(heartGeometry(0.42, 0.24), glossy(COLORS.rose, { emissive: 0x7a0f2e, emissiveIntensity: 0.25, sheen: 1, sheenColor: new THREE.Color(0xffc1d6) }));
  scene.add(heart);

  // Летающие цифры 1–9
  const font = new Font(digitsFont);
  const palette = [COLORS.rose, COLORS.sea, COLORS.sun, COLORS.plum];
  const digits = [];
  for (let n = 1; n <= 9; n++) {
    const g = new TextGeometry(String(n), { font, size: 0.36, depth: 0.12, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.02, bevelSegments: 4 });
    g.center();
    const m = new THREE.Mesh(g, glossy(palette[n % 4]));
    m.userData = { a: (n / 9) * Math.PI * 2, r: 2.9 + (n % 3) * 0.3, y: 0.6 + ((n * 7) % 5) * 0.55, sp: 0.07 + (n % 4) * 0.012, ph: n * 1.7 };
    digits.push(m);
    scene.add(m);
  }

  // Маленькие сердечки поднимаются вверх
  const small = new THREE.InstancedMesh(heartGeometry(0.11, 0.045), glossy(0xffffff), 26);
  const sm = Array.from({ length: small.count }, () => ({ x: 0, y: -1, z: 0, v: 0, s: 0, rot: 0, life: 1 }));
  const tint = new THREE.Color();
  sm.forEach((p, i) => small.setColorAt(i, tint.setHex(palette[i % 4])));
  scene.add(small);
  const dummy = new THREE.Object3D();
  const spawn = (p, x = (Math.random() - 0.5) * 7, y = 0) => Object.assign(p, { x, y, z: -1.6 - Math.random() * 1.4, v: 0.35 + Math.random() * 0.4, s: 0.6 + Math.random() * 0.8, rot: Math.random() * 6, life: 0 });
  sm.forEach(p => spawn(p, undefined, Math.random() * 4.5));
  const burst = (x, y) => sm.slice(0, 12).forEach(p => { spawn(p, x + (Math.random() - 0.5) * 1.2, y); p.v *= 2.2; });

  // Размер и камера под ширину экрана
  let narrow = false;
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    narrow = camera.aspect < 0.9;
    camera.fov = narrow ? 46 : 34;
    // на широком экране текст слева, сцена сдвигается вправо
    if (camera.aspect > 1.15) camera.setViewOffset(w, h, -w * 0.25, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    layout(narrow);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // Курсор сдвигает камеру и наклоняет карточки
  const aim = { x: 0, y: 0 }, cam = { x: 0, y: 0 };
  addEventListener('pointermove', e => {
    const b = canvas.getBoundingClientRect();
    aim.x = Math.max(-1, Math.min(1, ((e.clientX - b.left) / b.width - 0.5) * 2));
    aim.y = Math.max(-1, Math.min(1, ((e.clientY - b.top) / b.height - 0.5) * 2));
  }, { passive: true });

  // Нажатие на боковую карточку выводит её вперёд
  const clock = new THREE.Clock();
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const moveTo = (c, slot) => { c.from = { ...c.group.position, ry: c.group.rotation.y, s: c.group.scale.x }; c.slot = slot; c.t0 = clock.elapsedTime; };
  const bringFront = c => {
    if (c.slot === 0) { burst(0, 1.8); return; }
    const front = cards.find(o => o.slot === 0);
    if (front) moveTo(front, c.slot);
    moveTo(c, 0);
    burst(0, 1.6);
  };
  canvas.addEventListener('click', e => {
    const b = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = cards.find(c => ray.intersectObject(c.group, true).length);
    if (hit) bringFront(hit);
    else if (ray.intersectObject(heart).length) burst(0, 3);
  });

  // Карточки меняются местами сами, раз в несколько секунд
  let nextSwap = 6, fanUntil = 0;

  let running = true, raf = 0, ready = false;
  const frame = () => {
    raf = running ? requestAnimationFrame(frame) : 0;
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    if (t > nextSwap && cards.length > 1) { bringFront(cards.find(c => c.slot === 1) || cards[0]); nextSwap = t + 6; }
    const fan = fanUntil > t ? 1 : 0;

    cards.forEach(c => {
      const s = slotOf(c), g = c.group;
      const bob = Math.sin(t * 0.9 + c.ph) * 0.06;
      let x = s.x * (1 + fan * 0.12), z = s.z, ry = s.ry * (1 + fan * 0.6), sc = s.s;
      if (c.from) {
        const k = Math.min(1, (t - c.t0) / 0.9), e = ease(k);
        x = c.from.x + (x - c.from.x) * e; z = c.from.z + (z - c.from.z) * e + Math.sin(k * Math.PI) * 0.5;
        ry = c.from.ry + (ry - c.from.ry) * e; sc = c.from.s + (sc - c.from.s) * e;
        if (k >= 1) c.from = null;
      }
      g.position.set(x, H / 2 * sc + 0.25 + bob, z);
      g.rotation.set(-cam.y * 0.06 + Math.sin(t * 0.6 + c.ph) * 0.02, ry + cam.x * 0.12, Math.sin(t * 0.5 + c.ph) * 0.015);
      g.scale.setScalar(sc);
      c.glow.position.set(x, 0.02, z + 0.1);
      c.glow.scale.setScalar(sc);
    });

    const front = slots[0];
    heart.scale.setScalar(beat(t));
    heart.rotation.y = Math.sin(t * 0.6) * 0.5;
    heart.position.set(front.x + (narrow ? 0.75 : 0.95), H + 0.45 + Math.sin(t * 1.2) * 0.06, front.z + 0.35);

    digits.forEach(m => {
      const u = m.userData, a = u.a + t * u.sp;
      m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.9 + u.ph) * 0.18, Math.sin(a) * u.r * 0.35 - 2.6);
      m.rotation.set(Math.sin(t * 0.5 + u.ph) * 0.25, Math.sin(t * 0.7 + u.ph) * 0.6, 0);
    });

    sm.forEach((p, i) => {
      p.life += dt; p.y += p.v * dt; p.x += Math.sin(t * 1.3 + i) * 0.003;
      if (p.y > 5) spawn(p);
      const k = Math.min(1, p.life * 2) * Math.max(0, Math.min(1, (5 - p.y) / 1.2));
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot + t * 0.8, Math.sin(t + i) * 0.3);
      dummy.scale.setScalar(p.s * k);
      dummy.updateMatrix();
      small.setMatrixAt(i, dummy.matrix);
    });
    small.instanceMatrix.needsUpdate = true;

    cam.x += (aim.x - cam.x) * 0.04; cam.y += (aim.y - cam.y) * 0.04;
    camera.position.set(cam.x * 0.9, (narrow ? 2.0 : 1.85) - cam.y * 0.3, narrow ? 10 : 8.8);
    camera.lookAt(look);
    renderer.render(scene, camera);
    if (!ready) { ready = true; onReady?.(); }
  };
  frame();

  return {
    // карточки раскрываются веером (при наведении на кнопку «Найти свою пару»)
    fan(sec = 2.5) { fanUntil = clock.elapsedTime + sec; burst(0, 1); },
    pause() { running = false; cancelAnimationFrame(raf); raf = 0; clock.stop(); },
    resume() { if (running) return; running = true; clock.start(); frame(); },
  };
}
