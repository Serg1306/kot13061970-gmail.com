// 3D-сцена главной страницы: пара роботов, глянцевое сердце и летающие цифры.
// Сборка: см. tools/3d/README.md. Результат — site/lyubov-v-cifrah/3d/scene.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
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

const glossy = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
  color, roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.08, ...extra,
});

// Удар сердца: два быстрых толчка, потом пауза.
const beat = t => { const p = t % 1.1; return 1 + 0.09 * Math.exp(-((p - 0.1) ** 2) / 0.003) + 0.06 * Math.exp(-((p - 0.32) ** 2) / 0.003); };

export async function start(canvas, { modelUrl, onReady } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 760 ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const look = new THREE.Vector3(0, 1.45, 0);

  scene.add(new THREE.HemisphereLight(0xfff0f6, 0xb9d6ff, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 7, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -2, near: 1, far: 20 });
  sun.shadow.radius = 6;
  scene.add(sun);
  const rim = new THREE.PointLight(0xff7aa8, 18, 12);
  rim.position.set(-3, 3, -2);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.ShadowMaterial({ opacity: 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Большое сердце между роботами
  const heart = new THREE.Mesh(heartGeometry(0.62, 0.32), glossy(COLORS.rose, { emissive: 0x7a0f2e, emissiveIntensity: 0.25, sheen: 1, sheenColor: new THREE.Color(0xffc1d6) }));
  heart.position.set(0, 2.35, -0.2);
  heart.castShadow = true;
  scene.add(heart);

  // Летающие цифры 1–9
  const font = new Font(digitsFont);
  const palette = [COLORS.rose, COLORS.sea, COLORS.sun, COLORS.plum];
  const digits = [];
  for (let n = 1; n <= 9; n++) {
    const g = new TextGeometry(String(n), { font, size: 0.42, depth: 0.14, curveSegments: 8, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.025, bevelSegments: 4 });
    g.center();
    const m = new THREE.Mesh(g, glossy(palette[n % 4]));
    m.castShadow = true;
    const a = (n / 9) * Math.PI * 2;
    m.userData = { a, r: 2.5 + (n % 3) * 0.3, y: 0.9 + ((n * 7) % 5) * 0.42, sp: 0.07 + (n % 4) * 0.012, ph: n * 1.7 };
    digits.push(m);
    scene.add(m);
  }

  // Маленькие сердечки поднимаются вверх
  const small = new THREE.InstancedMesh(heartGeometry(0.12, 0.05), glossy(0xffffff), 26);
  const sm = Array.from({ length: small.count }, (_, i) => ({ x: 0, y: -1, z: 0, v: 0, s: 0, rot: 0, life: 1 + i / small.count }));
  const tint = new THREE.Color();
  sm.forEach((p, i) => small.setColorAt(i, tint.setHex(palette[i % 4])));
  scene.add(small);
  const dummy = new THREE.Object3D();
  const spawn = (p, x = (Math.random() - 0.5) * 7, y = 0.1) => Object.assign(p, { x, y, z: (Math.random() - 0.5) * 2.5 - 0.6, v: 0.35 + Math.random() * 0.4, s: 0.6 + Math.random() * 0.8, rot: Math.random() * 6, life: 0 });
  sm.forEach(p => spawn(p, undefined, Math.random() * 4));
  const burst = (x, y) => sm.slice(0, 12).forEach(p => { spawn(p, x + (Math.random() - 0.5) * 0.8, y); p.v *= 2.2; });

  // Роботы (модель Tomás Laulhé, CC0)
  const robots = [];
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const makeRobot = (color, x, turn) => {
    const root = clone(gltf.scene);
    root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.material = o.material.clone();
      if (o.material.name === 'Main') { o.material.color.setHex(color); o.material.roughness = 0.35; }
      if (o.material.name === 'Grey') o.material.color.setHex(0xf3eef6);
    });
    root.scale.setScalar(0.42);
    root.position.set(x, 0, 0);
    root.rotation.y = turn;
    scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const actions = Object.fromEntries(gltf.animations.map(c => [c.name, mixer.clipAction(c)]));
    const r = { root, mixer, actions, cur: null, x };
    mixer.addEventListener('finished', () => play(r, 'Idle'));
    play(r, 'Idle');
    robots.push(r);
    return r;
  };
  const once = new Set(['Wave', 'Jump', 'ThumbsUp', 'Yes', 'No', 'Punch']);
  function play(r, name) {
    const a = r.actions[name];
    if (!a || r.cur === a) return;
    a.reset();
    if (once.has(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } else a.setLoop(THREE.LoopRepeat, Infinity);
    a.fadeIn(0.35).play();
    if (r.cur) r.cur.fadeOut(0.35);
    r.cur = a;
  }
  const she = makeRobot(COLORS.rose, -1.75, 0.55);
  const he = makeRobot(COLORS.sea, 1.75, -0.55);

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
    she.root.position.x = narrow ? -1.05 : -1.6;
    he.root.position.x = narrow ? 1.05 : 1.6;
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // Курсор и наклон телефона сдвигают камеру
  const aim = { x: 0, y: 0 }, cam = { x: 0, y: 0 };
  const onMove = e => { const b = canvas.getBoundingClientRect(); aim.x = ((e.clientX - b.left) / b.width - 0.5) * 2; aim.y = ((e.clientY - b.top) / b.height - 0.5) * 2; };
  addEventListener('pointermove', onMove, { passive: true });

  // Нажатие на робота: прыжок и сердечки
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  const onClick = e => {
    const b = canvas.getBoundingClientRect();
    ptr.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hit = robots.find(r => ray.intersectObject(r.root, true).length);
    if (hit) { play(hit, 'Jump'); burst(hit.root.position.x, 1.2); }
    else if (ray.intersectObject(heart).length) { burst(0, 2); robots.forEach(r => play(r, 'Yes')); }
  };
  canvas.addEventListener('click', onClick);

  // Сценарий: роботы по очереди машут и показывают «класс»
  const moves = [[she, 'Wave'], [he, 'Wave'], [he, 'ThumbsUp'], [she, 'Yes'], [she, 'Jump'], [he, 'Yes']];
  let mi = 0, nextMove = 1.2, danceUntil = 0;

  let running = true, raf = 0, ready = false;
  const clock = new THREE.Clock();
  const frame = () => {
    raf = running ? requestAnimationFrame(frame) : 0;
    const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
    robots.forEach(r => r.mixer.update(dt));
    if (danceUntil && t > danceUntil) { danceUntil = 0; robots.forEach(r => play(r, 'Idle')); }
    if (!danceUntil && t > nextMove) { const [r, m] = moves[mi++ % moves.length]; play(r, m); nextMove = t + 3.2; }

    heart.scale.setScalar(beat(t));
    heart.rotation.y = Math.sin(t * 0.6) * 0.5;
    heart.position.y = 2.35 + Math.sin(t * 1.2) * 0.06;

    digits.forEach(m => {
      const u = m.userData, a = u.a + t * u.sp;
      m.position.set(Math.cos(a) * u.r, u.y + Math.sin(t * 0.9 + u.ph) * 0.18, Math.sin(a) * u.r * 0.5 - 1.5);
      m.rotation.set(Math.sin(t * 0.5 + u.ph) * 0.25, Math.sin(t * 0.7 + u.ph) * 0.6, 0);
    });

    sm.forEach((p, i) => {
      p.life += dt; p.y += p.v * dt; p.x += Math.sin(t * 1.3 + i) * 0.003;
      if (p.y > 4.6) spawn(p);
      const k = Math.min(1, p.life * 2) * Math.max(0, Math.min(1, (4.6 - p.y) / 1.2));
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot + t * 0.8, Math.sin(t + i) * 0.3);
      dummy.scale.setScalar(p.s * k);
      dummy.updateMatrix();
      small.setMatrixAt(i, dummy.matrix);
    });
    small.instanceMatrix.needsUpdate = true;

    cam.x += (aim.x - cam.x) * 0.04; cam.y += (aim.y - cam.y) * 0.04;
    const dist = narrow ? 9 : 8.6;
    camera.position.set(cam.x * 1.1, (narrow ? 1.9 : 1.75) - cam.y * 0.35, dist);
    camera.lookAt(look);
    renderer.render(scene, camera);
    if (!ready) { ready = true; onReady?.(); }
  };
  frame();

  return {
    dance(sec = 4) { danceUntil = clock.elapsedTime + sec; robots.forEach(r => play(r, 'Dance')); },
    pause() { running = false; cancelAnimationFrame(raf); raf = 0; clock.stop(); },
    resume() { if (running) return; running = true; clock.start(); frame(); },
  };
}
