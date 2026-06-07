import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ArToolkitSource, ArToolkitContext, ArMarkerControls } from 'threex';

// ── constants ────────────────────────────────────────────────────────────────
// Physical AR scale relative to the marker: 1=fits inside card, 2=twice marker, 4=four times
const FIELD_SCALES      = { small: 1, medium: 2, large: 4 };
const TANK_COLORS       = [0x4fc3f7, 0xf06292, 0x81c784, 0xffb74d, 0xce93d8, 0x80cbc4];
const SHOT_STEP_MS      = 60;   // ms per waypoint — controls bullet speed
const PARTICLE_COUNT    = 60;
const TURN_TIMEOUT_SECS = 30;
// Game-world dimensions for medium field (logical unit = FIELD_M_W metres)
const FIELD_M_W = 400;
const FIELD_M_D = 300;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const markerStatus   = document.getElementById('markerStatus');
const gameStatus     = document.getElementById('gameStatus');
const turnTimerEl    = document.getElementById('turnTimer');
const finder         = document.getElementById('finder');
const focusReticle   = document.getElementById('focusReticle');
const controls       = document.getElementById('controls');
const waitingOverlay = document.getElementById('waitingOverlay');
const gameOverEl     = document.getElementById('gameOver');
const debugPanel     = document.getElementById('debugPanel');
const rotateLeft     = document.getElementById('rotateLeft');
const rotateRight    = document.getElementById('rotateRight');
const azimuthValue   = document.getElementById('azimuthValue');
const elevationInput = document.getElementById('elevationInput');
const elevationValue = document.getElementById('elevationValue');
const powerInput     = document.getElementById('powerInput');
const powerValue     = document.getElementById('powerValue');
const fireButton     = document.getElementById('fireButton');

// ── URL params / socket ───────────────────────────────────────────────────────
const params       = new URLSearchParams(window.location.search);
const gameId       = params.get('gameId');
const playerId     = params.get('playerId');
const storedPlayer = JSON.parse(localStorage.getItem('se-player') || '{}');
const API_BASE     = window.API_URL || window.VITE_API_URL || window.SE_API_URL || '';
const socket       = io(`${API_BASE}/game`);

// ── game state ────────────────────────────────────────────────────────────────
const tanks     = new Map();
let game        = null;
let myAzimuth   = 0;
let currentTurn = null;
let animating        = false;
let resolveOwnShot   = null;  // set when firing optimistically, resolved by server result
let fieldScale       = 1;
let countdownInterval = null;
let focusReticleTimer = null;

// ── Three.js core ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.domElement.id = 'arCanvas';
document.body.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.Camera();
scene.add(camera);
scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(1, 2, 1);
scene.add(dirLight);

// ── Hide AR.js processing canvases ───────────────────────────────────────────
// AR.js repositions its internal canvases via JS every frame, which briefly
// overrides CSS. Stamping inline cssText on insertion wins the first race.
// A per-canvas attribute observer then re-stamps on every subsequent style
// mutation (e.g. during projectile animation when AR.js is most active).
const HIDE_CSS = 'position:fixed!important;top:-9999px!important;left:-9999px!important;width:1px!important;height:1px!important;opacity:0!important;visibility:hidden!important;pointer-events:none!important;';

// All AR.js processing canvases we have hidden, re-stamped every render frame.
const hiddenCanvases = new Set();

function lockHide(canvas) {
  canvas.style.cssText = HIDE_CSS;
  hiddenCanvases.add(canvas);
  // Attribute observer catches async style changes outside the rAF window.
  new MutationObserver(() => { canvas.style.cssText = HIDE_CSS; })
    .observe(canvas, { attributes: true, attributeFilter: ['style'] });
}

new MutationObserver(mutations => {
  for (const m of mutations) {
    for (const node of m.addedNodes) {
      if (node.nodeType === 1 && node.tagName === 'CANVAS' && node.id !== 'arCanvas') lockHide(node);
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// ── GLTF model loading ────────────────────────────────────────────────────────
const gltfLoader   = new GLTFLoader();
let pineGltfScene  = null;
let birchGltfScene = null;

function loadGltf(url) {
  return new Promise((resolve, reject) =>
    gltfLoader.load(url, gltf => resolve(gltf), undefined, reject)
  );
}

const modelsReady = Promise.all([
  loadGltf('/ar/models/pine/scene.gltf').then(g  => { pineGltfScene  = g.scene; })
    .catch(e => console.warn('Pine model failed',  e)),
  loadGltf('/ar/models/birch/scene.gltf').then(g => { birchGltfScene = g.scene; })
    .catch(e => console.warn('Birch model failed', e)),
]);

// ── AR.js ─────────────────────────────────────────────────────────────────────
const arContext = new ArToolkitContext({
  cameraParametersUrl: '/ar/markers/camera_para.dat',
  detectionMode: 'mono',
  maxDetectionRate: 30,
});
arContext.init(() => {
  camera.projectionMatrix.copy(arContext.getProjectionMatrix());
});

const markerRoot = new THREE.Group();
scene.add(markerRoot);
new ArMarkerControls(arContext, markerRoot, {
  type: 'pattern',
  patternUrl: '/ar/markers/pattern-Lo.patt',
  smooth: true, smoothCount: 5, smoothTolerance: 0.01, smoothThreshold: 2,
});

const battlefieldGroup = new THREE.Group();
markerRoot.add(battlefieldGroup);

const arSource$ = new ArToolkitSource({ sourceType: 'webcam' });
arSource$.init(() => {
  const video = arSource$.domElement;
  if (video && !document.body.contains(video)) {
    document.body.insertBefore(video, document.body.firstChild);
  }
  if (video) {
    Object.assign(video.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100vw', height: '100vh',
      objectFit: 'cover', zIndex: '0', display: 'block',
    });
  }
});

function handleResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', handleResize);

// ── marker visibility ─────────────────────────────────────────────────────────
function pollMarkerVisible() {
  const visible = markerRoot.visible;
  markerStatus.textContent = visible ? 'Marker locked' : 'Find marker';
  finder.hidden = visible;
  requestAnimationFrame(pollMarkerVisible);
}
pollMarkerVisible();

// ── terrain ───────────────────────────────────────────────────────────────────
const TERRAIN_W = 1.0;
const TERRAIN_D = 0.75;
let terrainMesh = null;

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

function sampleHeight(nx, nz, seed) {
  const fade = Math.max(0, (1 - Math.pow(Math.abs(nx) * 1.9, 4)) * (1 - Math.pow(Math.abs(nz) * 1.9, 4)));
  const s = seed * 0.0001;
  // Increased amplitude: ~2.5× from original
  return (
    Math.sin(nx * 9.3 + s) * Math.cos(nz * 7.1 + s * 1.3) * 0.052 +
    Math.sin(nx * 17.7 - s * 0.7) * Math.cos(nz * 13.4 + s) * 0.028 +
    Math.cos(nx * 5.1 + s * 2.1) * Math.sin(nz * 6.3 - s * 0.5) * 0.042
  ) * fade;
}

function getTerrainY(lx, lz) {
  const seed = game ? hashSeed(game.id) : 12345;
  return sampleHeight(lx / TERRAIN_W, lz / TERRAIN_D, seed);
}

function buildTerrain(seed = 12345) {
  if (terrainMesh) {
    battlefieldGroup.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();
    terrainMesh = null;
  }
  const geo = new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D, 40, 30);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, sampleHeight(pos.getX(i) / TERRAIN_W, pos.getZ(i) / TERRAIN_D, seed));
  }
  geo.computeVertexNormals();
  terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: 0x4a7a30, roughness: 0.95, metalness: 0.0,
  }));
  battlefieldGroup.add(terrainMesh);

  // Field border
  const border = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(TERRAIN_W, 0.002, TERRAIN_D)),
    new THREE.LineBasicMaterial({ color: 0xf7d36e, opacity: 0.45, transparent: true })
  );
  border.position.y = 0.001;
  battlefieldGroup.add(border);
}

buildTerrain();

// ── scenery & scale labels ────────────────────────────────────────────────────
const sceneryGroup = new THREE.Group();
battlefieldGroup.add(sceneryGroup);

// Convert game-world metres to terrain logical units
function metersToLu(mx, mz) {
  return [mx / FIELD_M_W * TERRAIN_W, mz / FIELD_M_D * TERRAIN_D];
}

// Canvas-texture label sprite — stays upright, depth-sorted above terrain
function makeLabelSprite(text, { textColor = '#f7d36e', bgColor = 'rgba(10,8,5,0.72)', fontSize = 38, spriteHeight = 0.06 } = {}) {
  const pad = 14;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = `bold ${fontSize}px "Trebuchet MS", Verdana, sans-serif`;
  const tw = Math.ceil(ctx.measureText(text).width);
  canvas.width = tw + pad * 2;
  canvas.height = fontSize + pad * 2;
  // re-set font after resize
  ctx.font = `bold ${fontSize}px "Trebuchet MS", Verdana, sans-serif`;
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(spriteHeight * canvas.width / canvas.height, spriteHeight, 1);
  return sp;
}

// Place one tree GLTF model centred at (lx, lz) with given height, optional label above
function placeTree(gltfScene, lx, lz, targetH, label) {
  if (!gltfScene) return;
  const model = gltfScene.clone(true);
  const box   = new THREE.Box3().setFromObject(model);
  const sz    = box.getSize(new THREE.Vector3());
  const sf    = targetH / (Math.max(sz.x, sz.y, sz.z) || 1);
  model.scale.setScalar(sf);
  const cx = (box.min.x + box.max.x) / 2 * sf;
  const cz = (box.min.z + box.max.z) / 2 * sf;
  const by = box.min.y * sf;
  const ty = getTerrainY(lx, lz);
  model.position.set(lx - cx, ty - by, lz - cz);
  sceneryGroup.add(model);
  if (label) {
    const sp = makeLabelSprite(label, { spriteHeight: 0.015 });
    sp.position.set(lx, ty + targetH + 0.03, lz);
    sceneryGroup.add(sp);
  }
}

function populateScenery() {
  while (sceneryGroup.children.length) sceneryGroup.remove(sceneryGroup.children[0]);

  const PINE_H  = 0.11;
  const BIRCH_H = 0.085;

  // 4 pines at ±100 m corners
  for (const [mx, mz] of [[100,100],[-100,100],[100,-100],[-100,-100]]) {
    const [lx, lz] = metersToLu(mx, mz);
    placeTree(pineGltfScene,  lx, lz, PINE_H,  `Pine ${mx}m,${mz}m`);
  }

  // 4 birches at ±50 m corners
  for (const [mx, mz] of [[50,50],[-50,50],[50,-50],[-50,-50]]) {
    const [lx, lz] = metersToLu(mx, mz);
    placeTree(birchGltfScene, lx, lz, BIRCH_H, `Birch ${mx}m,${mz}m`);
  }

  // Scale-reference labels floating above terrain
  const fieldLabel = makeLabelSprite(`${FIELD_M_W}m × ${FIELD_M_D}m  (medium field)`,
    { textColor: '#89e163', fontSize: 34 });
  fieldLabel.position.set(0, 0.12, 0);
  sceneryGroup.add(fieldLabel);

  // X-axis ruler ticks: -200, 0, +200
  for (const mx of [-200, 0, 200]) {
    const [lx] = metersToLu(mx, 0);
    const sp = makeLabelSprite(`${mx > 0 ? '+' : ''}${mx}m`, { textColor: '#f5bf52', fontSize: 28 });
    sp.position.set(lx, getTerrainY(lx, 0) + 0.035, 0);
    sceneryGroup.add(sp);
  }

  // Z-axis ruler ticks: -150, +150
  for (const mz of [-150, 150]) {
    const [, lz] = metersToLu(0, mz);
    const sp = makeLabelSprite(`${mz > 0 ? '+' : ''}${mz}m`, { textColor: '#f5bf52', fontSize: 28 });
    sp.position.set(0, getTerrainY(0, lz) + 0.035, lz);
    sceneryGroup.add(sp);
  }
}

// ── tank building (GLTF) ──────────────────────────────────────────────────────
const textureLoader = new THREE.TextureLoader();
const avatarCache   = new Map();

function loadAvatar(url) {
  if (avatarCache.has(url)) return Promise.resolve(avatarCache.get(url));
  return new Promise((resolve) => {
    textureLoader.load(url, (tex) => { avatarCache.set(url, tex); resolve(tex); }, undefined, () => resolve(null));
  });
}

function buildTankGeometric(colorHex) {
  const group = new THREE.Group();
  const hullMat  = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6, metalness: 0.3 });
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.036, 0.065), hullMat);
  hull.position.y = 0.018;
  group.add(hull);
  const trackL = new THREE.Mesh(new THREE.BoxGeometry(0.096, 0.018, 0.068), trackMat);
  trackL.position.set(-0.048, 0.009, 0);
  group.add(trackL);
  const trackR = trackL.clone(); trackR.position.set(0.048, 0.009, 0); group.add(trackR);
  const turretGroup = new THREE.Group(); turretGroup.position.y = 0.036; group.add(turretGroup);
  const turretMat = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.5, metalness: 0.5 });
  turretGroup.add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.028, 0.022, 8), turretMat));
  const barrelGroup = new THREE.Group(); barrelGroup.position.set(0, 0.008, 0); turretGroup.add(barrelGroup);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.4, metalness: 0.6 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.11, 6), barrelMat);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0, -0.055); barrelGroup.add(barrel);
  return { group, turretGroup, barrelGroup };
}

async function addTank(player, index) {
  const colorHex = TANK_COLORS[index % TANK_COLORS.length];

  const { group, turretGroup } = buildTankGeometric(colorHex);

  // Bright floating disc so the tank position is unmissable regardless of camera angle
  const discGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.004, 16);
  const discMat = new THREE.MeshBasicMaterial({ color: colorHex, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(discGeo, discMat);
  disc.position.y = 0.09;
  group.add(disc);

  const ty = getTerrainY(player.position.x, player.position.z);
  group.position.set(player.position.x, ty, player.position.z);
  turretGroup.rotation.y = THREE.MathUtils.degToRad(player.azimuth || 0);

  let avatarMat = null;
  if (player.avatarUrl) {
    const tex = await loadAvatar(player.avatarUrl);
    if (tex) {
      avatarMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(avatarMat);
      sprite.scale.set(0.08, 0.08, 1);
      sprite.position.set(0, 0.16, 0);
      group.add(sprite);
    }
  }

  battlefieldGroup.add(group);
  tanks.set(player.id, { group, turretGroup, discGeo, discMat, avatarMat });
}

function removeTank(id) {
  const t = tanks.get(id);
  if (!t) return;
  battlefieldGroup.remove(t.group);
  t.discGeo.dispose();
  t.discMat.dispose();
  t.avatarMat?.dispose();
  tanks.delete(id);
}

function clearBattlefield() {
  [...tanks.keys()].forEach(removeTank);
  // Dispose textures/materials we own (label sprites). GLTF clones share geometries
  // with the source scene so those must not be disposed here.
  sceneryGroup.traverse(node => {
    if (node.isSprite) { node.material?.map?.dispose(); node.material?.dispose(); }
  });
  while (sceneryGroup.children.length) sceneryGroup.remove(sceneryGroup.children[0]);
}

function rotateTank(id, azimuth) {
  const t = tanks.get(id);
  if (t) t.turretGroup.rotation.y = THREE.MathUtils.degToRad(azimuth);
}

// ── scene init ────────────────────────────────────────────────────────────────
async function initScene(nextGame) {
  game        = nextGame;
  currentTurn = game.currentTurn;
  fieldScale  = FIELD_SCALES[game.config?.fieldSize] ?? 2;
  battlefieldGroup.scale.setScalar(fieldScale);

  const seed = hashSeed(game.id);
  buildTerrain(seed);

  clearBattlefield();

  // Wait for models, then build tanks and scenery
  await modelsReady;
  const alive = game.players.filter((p) => p.alive !== false);
  await Promise.all(alive.map((p, i) => addTank(p, i)));
  populateScenery();

  setHud(`${game.status} · ${tanks.size} tank${tanks.size === 1 ? '' : 's'}`);
  const me = game.players.find((p) => p.id === playerId);
  if (me) setAzimuth(me.azimuth || 0, false);
  updateControls();
}

// ── HUD helpers ───────────────────────────────────────────────────────────────
function setHud(msg) { gameStatus.textContent = msg; }

function startCountdown() {
  clearInterval(countdownInterval);
  let secs = TURN_TIMEOUT_SECS;
  turnTimerEl.textContent = `${secs}s`;
  turnTimerEl.hidden = false;
  turnTimerEl.classList.remove('low');
  countdownInterval = setInterval(() => {
    secs -= 1;
    turnTimerEl.textContent = `${secs}s`;
    if (secs <= 10) turnTimerEl.classList.add('low');
    if (secs <= 0) clearInterval(countdownInterval);
  }, 1000);
}

function stopCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
  turnTimerEl.hidden = true;
}

function updateControls() {
  if (!game || game.status !== 'playing' || animating) {
    controls.hidden = true;
    waitingOverlay.hidden = false;
    waitingOverlay.textContent = animating ? 'Shot in flight' : 'Waiting for game';
    return;
  }
  const myTurn = currentTurn === playerId;
  controls.hidden = !myTurn;
  waitingOverlay.hidden = myTurn;
  if (!myTurn) {
    const p = game.players.find((item) => item.id === currentTurn);
    waitingOverlay.textContent = `Waiting for ${p?.username || 'next player'}`;
  }
}

function setAzimuth(value, broadcast = true) {
  myAzimuth = ((Number(value) % 360) + 360) % 360;
  azimuthValue.textContent = `${Math.round(myAzimuth)} deg`;
  rotateTank(playerId, myAzimuth);
  if (broadcast) socket.emit('rotate-tank', { gameId, playerId, azimuth: myAzimuth });
}

// ── particles ─────────────────────────────────────────────────────────────────
const activeParticleSystems = [];

function spawnExplosion(point, hit) {
  const positions  = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    positions[i * 3]     = point.x; positions[i * 3 + 1] = point.y; positions[i * 3 + 2] = point.z;
    const theta = Math.random() * Math.PI * 2, phi = Math.random() * Math.PI;
    const spd = 0.003 + Math.random() * 0.006;
    velocities[i * 3]     = Math.sin(phi) * Math.cos(theta) * spd;
    velocities[i * 3 + 1] = Math.abs(Math.cos(phi)) * spd + 0.002;
    velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * spd;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: hit ? 0xff6545 : 0xf5bf52, size: 0.012, transparent: true, opacity: 1, sizeAttenuation: true });
  const pts = new THREE.Points(geo, mat);
  battlefieldGroup.add(pts);

  const ringGeo = new THREE.RingGeometry(0.001, 0.018, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd580, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(point.x, point.y + 0.002, point.z);
  battlefieldGroup.add(ring);

  activeParticleSystems.push({ pts, geo, mat, ring, ringMat, velocities, startTime: performance.now(), duration: 650, done: false });
}

function tickParticles() {
  const now = performance.now();
  for (const sys of activeParticleSystems) {
    if (sys.done) continue;
    const t = (now - sys.startTime) / sys.duration;
    if (t >= 1) {
      sys.done = true;
      battlefieldGroup.remove(sys.pts); battlefieldGroup.remove(sys.ring);
      sys.geo.dispose(); sys.mat.dispose(); sys.ring.geometry.dispose(); sys.ringMat.dispose();
      continue;
    }
    const pos = sys.geo.attributes.position.array;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      pos[i * 3]     += sys.velocities[i * 3];
      pos[i * 3 + 1] += sys.velocities[i * 3 + 1];
      pos[i * 3 + 2] += sys.velocities[i * 3 + 2];
      sys.velocities[i * 3 + 1] -= 0.00015;
    }
    sys.pts.geometry.attributes.position.needsUpdate = true;
    sys.mat.opacity = 1 - t;
    const rs = 1 + t * 12;
    sys.ring.scale.set(rs, 1, rs);
    sys.ringMat.opacity = 0.85 * (1 - t);
  }
}

// ── trajectory math (mirrors backend game-engine.js exactly) ─────────────────
// Used for optimistic client-side fire: start animating immediately on button
// press without waiting for the server round-trip.
const DEG_TO_RAD_C = Math.PI / 180;

function computeTrajectory(origin, azimuth, elevation, power, options = {}) {
  const steps    = options.steps    || 36;
  const duration = options.duration || 3;
  const gravity  = options.gravity  || 1.65;
  const speed    = 0.45 + (Number(power) / 100) * 0.95;
  const azRad    = Number(azimuth)   * DEG_TO_RAD_C;
  const elRad    = Number(elevation) * DEG_TO_RAD_C;
  const hSpeed   = Math.cos(elRad) * speed;
  const vSpeed   = Math.sin(elRad) * speed;
  const dirX     = -Math.sin(azRad);
  const dirZ     = -Math.cos(azRad);
  const pts      = [];
  for (let i = 0; i < steps; i++) {
    const t = (duration * i) / (steps - 1);
    const y = origin.y + vSpeed * t - 0.5 * gravity * t * t;
    pts.push({ x: origin.x + dirX * hSpeed * t, y: Math.max(0.018, y), z: origin.z + dirZ * hSpeed * t });
    if (i > 8 && y <= 0.018) break;
  }
  return pts;
}

function computeLeapFrogTrajectory(origin, azimuth, elevation, power, options = {}) {
  const first  = computeTrajectory(origin, azimuth, elevation, power, { ...options, duration: 2.1,  steps: 23 });
  const second = computeTrajectory(first[first.length - 1], azimuth, Math.max(20, elevation * 0.45), power * 0.55, { ...options, duration: 1.35, steps: 15 });
  const third  = computeTrajectory(second[second.length - 1], azimuth, 18, power * 0.32, { ...options, duration: 0.85, steps: 10 });
  return [...first, ...second.slice(1), ...third.slice(1)];
}

// ── projectile animation ──────────────────────────────────────────────────────
async function animateProjectile({ waypoints, hit, targetId, impactPoint, launchAt, resultPromise }) {
  animating = true;
  updateControls();

  // Non-optimistic path (other players' shots): respect server timestamp
  if (launchAt != null) await new Promise(r => setTimeout(r, Math.max(0, launchAt - Date.now())));

  const pts = waypoints.map(wp => new THREE.Vector3(wp.x, wp.y, wp.z));

  // Bullet
  const projGeo = new THREE.SphereGeometry(0.02, 8, 8);
  const projMat = new THREE.MeshStandardMaterial({ color: 0xffe35d, emissive: 0xff9f28, emissiveIntensity: 2.0 });
  const proj    = new THREE.Mesh(projGeo, projMat);
  battlefieldGroup.add(proj);

  // Comet tail — Points at each past position (Line is always 1px in WebGL, useless in AR)
  const TRAIL_LEN = 22;
  const trailBuf  = new Float32Array(TRAIL_LEN * 3).fill(-9999);
  const trailGeo  = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailBuf, 3));
  const trailMat  = new THREE.PointsMaterial({ color: 0xffd580, size: 0.011, transparent: true, opacity: 0.7, sizeAttenuation: true });
  const trailPts  = new THREE.Points(trailGeo, trailMat);
  battlefieldGroup.add(trailPts);

  // Hot spark cloud — more numerous, bigger, wider jitter, orange colour
  const SPARK_LEN = 14;
  const sparkBuf  = new Float32Array(SPARK_LEN * 3).fill(-9999);
  const sparkGeo  = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkBuf, 3));
  const sparkMat  = new THREE.PointsMaterial({ color: 0xff7010, size: 0.014, transparent: true, opacity: 0.95, sizeAttenuation: true });
  const sparkPts  = new THREE.Points(sparkGeo, sparkMat);
  battlefieldGroup.add(sparkPts);

  const trailHistory = [];

  for (const wp of pts) {
    proj.position.copy(wp);
    trailHistory.unshift(wp.clone());
    if (trailHistory.length > TRAIL_LEN) trailHistory.pop();

    // Update trail dots
    const drawn = trailHistory.length;
    for (let i = 0; i < drawn; i++) {
      trailBuf[i * 3]     = trailHistory[i].x;
      trailBuf[i * 3 + 1] = trailHistory[i].y;
      trailBuf[i * 3 + 2] = trailHistory[i].z;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.setDrawRange(0, drawn);

    // Update sparks — 2 per recent position, spread wider for visible fireworks
    const recentCount = Math.min(SPARK_LEN >> 1, drawn);
    for (let i = 0; i < SPARK_LEN; i++) {
      const src = trailHistory[Math.min(i >> 1, recentCount - 1)];
      sparkBuf[i * 3]     = src.x + (Math.random() - 0.5) * 0.014;
      sparkBuf[i * 3 + 1] = src.y + (Math.random() - 0.5) * 0.014;
      sparkBuf[i * 3 + 2] = src.z + (Math.random() - 0.5) * 0.014;
    }
    sparkGeo.attributes.position.needsUpdate = true;
    sparkGeo.setDrawRange(0, Math.min(SPARK_LEN, drawn * 2));

    await new Promise(r => setTimeout(r, SHOT_STEP_MS));
  }

  battlefieldGroup.remove(proj);     projGeo.dispose();  projMat.dispose();
  battlefieldGroup.remove(trailPts); trailGeo.dispose(); trailMat.dispose();
  battlefieldGroup.remove(sparkPts); sparkGeo.dispose(); sparkMat.dispose();

  // Optimistic path: wait for server's authoritative hit/targetId/impactPoint
  if (resultPromise) {
    const result = await resultPromise;
    if (result) {
      hit = result.hit; targetId = result.targetId; impactPoint = result.impactPoint;
    } else {
      // Server rejected the shot — fizzle at the trajectory end
      const last = pts[pts.length - 1];
      impactPoint = { x: last.x, y: 0.02, z: last.z };
      hit = false;
    }
  }

  spawnExplosion(impactPoint, hit);
  if (hit && targetId) removeTank(targetId);

  await new Promise(r => setTimeout(r, 650));
  animating = false;
  updateControls();
}

// ── tap to focus ──────────────────────────────────────────────────────────────
function showFocusReticle(x, y, ok) {
  focusReticle.style.left = `${x}px`; focusReticle.style.top = `${y}px`;
  focusReticle.style.borderColor = ok ? '#89e163' : '#f7d36e';
  focusReticle.hidden = false;
  clearTimeout(focusReticleTimer);
  focusReticleTimer = setTimeout(() => { focusReticle.hidden = true; }, 760);
}

async function focusCameraAt(clientX, clientY) {
  const track = arSource$?.domElement?.srcObject?.getVideoTracks?.()[0] || null;
  let ok = false;
  if (track?.applyConstraints) {
    const x = clientX / window.innerWidth, y = clientY / window.innerHeight;
    const caps = track.getCapabilities?.() || {}, modes = caps.focusMode || [];
    const fm = modes.includes('single-shot') ? 'single-shot' : modes.includes('continuous') ? 'continuous' : null;
    const attempts = fm ? [{ advanced: [{ focusMode: fm, pointsOfInterest: [{ x, y }] }] }, { advanced: [{ focusMode: fm }] }] : [];
    attempts.push({ advanced: [{ pointsOfInterest: [{ x, y }] }] });
    for (const c of attempts) { try { await track.applyConstraints(c); ok = true; break; } catch { ok = false; } }
  }
  showFocusReticle(clientX, clientY, ok);
}

document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.controls, .top-hud, .game-over, button, input')) return;
  focusCameraAt(e.clientX, e.clientY);
});

// ── debug panel ───────────────────────────────────────────────────────────────
let debugTick = 0;
function updateDebug() {
  if (++debugTick % 30 !== 0) return;
  const pm = camera.projectionMatrix.elements;
  const fx = pm[0].toFixed(2), fy = pm[5].toFixed(2);
  const vid = arSource$?.domElement;
  const vidState = vid ? `${vid.readyState} ${vid.videoWidth}x${vid.videoHeight}` : 'none';
  debugPanel.textContent = [
    `src.ready=${arSource$?.ready ?? '?'}  marker=${markerRoot.visible}`,
    `game=${game?.status ?? 'null'}  tanks=${tanks.size}  trees=${sceneryGroup.children.length}`,
    `cam fx=${fx} fy=${fy}  (identity=1.00)`,
    `vid readyState=${vidState}   socket=${socket.connected ? 'ok' : 'dc'}`,
    `models: pine=${pineGltfScene ? 'ok' : 'miss'}  birch=${birchGltfScene ? 'ok' : 'miss'}`,
  ].join('\n');
}

// ── render loop ───────────────────────────────────────────────────────────────
function render() {
  requestAnimationFrame(render);
  if (arSource$?.ready && arContext) arContext.update(arSource$.domElement);
  // Re-stamp hidden canvases in the same rAF callback, after arContext.update(),
  // so AR.js style mutations are overridden before the browser paints this frame.
  for (const c of hiddenCanvases) c.style.cssText = HIDE_CSS;
  tickParticles();
  updateDebug();
  renderer.render(scene, camera);
}
render();

// ── socket events ─────────────────────────────────────────────────────────────
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
}

socket.on('connect', () => { setHud('Online'); socket.emit('rejoin-game', { gameId, playerId }); });
socket.on('disconnect', () => setHud('Offline'));

socket.on('game-state', ({ game: nextGame }) => { initScene(nextGame); setHud(nextGame.status); });
socket.on('game-started', ({ game: nextGame }) => { initScene(nextGame); setHud('Playing'); startCountdown(); updateControls(); });

socket.on('your-turn', ({ playerId: nextTurn }) => {
  currentTurn = nextTurn;
  if (game) game.currentTurn = nextTurn;
  startCountdown(); updateControls();
});

socket.on('tank-rotated', ({ playerId: rotatedId, azimuth }) => {
  rotateTank(rotatedId, azimuth);
  if (rotatedId === playerId) { myAzimuth = azimuth; azimuthValue.textContent = `${Math.round(myAzimuth)} deg`; }
});

socket.on('projectile-launched', (payload) => {
  stopCountdown();
  if (resolveOwnShot) {
    // Own shot: animation already running — feed server result into it
    resolveOwnShot(payload);
    resolveOwnShot = null;
  } else {
    // Another player's shot: animate from scratch with full server payload
    animateProjectile(payload);
  }
});

socket.on('turn-timeout', ({ playerId: timedOutId }) => {
  const p = game?.players.find((item) => item.id === timedOutId);
  waitingOverlay.hidden = false;
  waitingOverlay.textContent = `${p?.username || 'Player'} timed out`;
});

socket.on('player-eliminated', ({ playerId: eliminatedId }) => {
  const p = game?.players.find((item) => item.id === eliminatedId);
  if (p) p.alive = false;
});

socket.on('game-over', ({ winnerId, game: finalGame }) => {
  stopCountdown(); game = finalGame || game;
  controls.hidden = true; waitingOverlay.hidden = true;
  const winner = game?.players.find((p) => p.id === winnerId);
  gameOverEl.innerHTML = `<div>
    <img src="${escapeHtml(winner?.avatarUrl || storedPlayer.avatarUrl || '')}" alt="" />
    <h1>Game Over</h1>
    <p>${escapeHtml(winner?.username || 'Winner')} wins</p>
  </div>`;
  gameOverEl.hidden = false;
  setTimeout(() => {
    window.location.href = `/venue/${encodeURIComponent(game?.venueId || 'demo')}/table/${encodeURIComponent(game?.tableNo || '1')}`;
  }, 5000);
});

socket.on('error-message', ({ error }) => { waitingOverlay.hidden = false; waitingOverlay.textContent = error; });

// ── controls ──────────────────────────────────────────────────────────────────
rotateLeft.addEventListener('click',  () => setAzimuth(myAzimuth - 5));
rotateRight.addEventListener('click', () => setAzimuth(myAzimuth + 5));
elevationInput.addEventListener('input', () => { elevationValue.textContent = `${elevationInput.value} deg`; });
powerInput.addEventListener('input',     () => { powerValue.textContent = `${powerInput.value}%`; });
fireButton.addEventListener('click', () => {
  const me = game?.players.find(p => p.id === playerId);
  if (!me?.position) return;
  fireButton.disabled = true;

  const az = myAzimuth;
  const el = Number(elevationInput.value);
  const pw = Number(powerInput.value);

  // Compute trajectory locally and start animation immediately — no round-trip wait
  const trajectoryFn = game.config?.bombMode === 'leap-frog' ? computeLeapFrogTrajectory : computeTrajectory;
  const waypoints    = trajectoryFn({ ...me.position, y: 0.07 }, az, el, pw);
  const resultPromise = new Promise(r => { resolveOwnShot = r; });
  animateProjectile({ waypoints, resultPromise });

  socket.emit('fire', { gameId, playerId, azimuth: az, elevation: el, power: pw },
    (res) => {
      fireButton.disabled = false;
      if (!res?.ok) { resolveOwnShot?.(null); resolveOwnShot = null; }
    }
  );
});
