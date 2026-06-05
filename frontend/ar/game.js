import * as THREE from 'three';
import { ArToolkitSource, ArToolkitContext, ArMarkerControls } from 'threex';

// ── constants ────────────────────────────────────────────────────────────────
const FIELD_SCALES = { small: 0.75, medium: 1, large: 1.25 };
const TANK_COLORS = [0x4fc3f7, 0xf06292, 0x81c784, 0xffb74d, 0xce93d8, 0x80cbc4];
const TRAIL_LENGTH = 10;
const TURN_TIMEOUT_SECS = 30;

// ── DOM refs ─────────────────────────────────────────────────────────────────
const markerStatus   = document.getElementById('markerStatus');
const gameStatus     = document.getElementById('gameStatus');
const turnTimerEl    = document.getElementById('turnTimer');
const finder         = document.getElementById('finder');
const focusReticle   = document.getElementById('focusReticle');
const controls       = document.getElementById('controls');
const waitingOverlay = document.getElementById('waitingOverlay');
const gameOverEl     = document.getElementById('gameOver');
const rotateLeft     = document.getElementById('rotateLeft');
const rotateRight    = document.getElementById('rotateRight');
const azimuthValue   = document.getElementById('azimuthValue');
const elevationInput = document.getElementById('elevationInput');
const elevationValue = document.getElementById('elevationValue');
const powerInput     = document.getElementById('powerInput');
const powerValue     = document.getElementById('powerValue');
const fireButton     = document.getElementById('fireButton');

// ── URL params / socket ───────────────────────────────────────────────────────
const params        = new URLSearchParams(window.location.search);
const gameId        = params.get('gameId');
const playerId      = params.get('playerId');
const storedPlayer  = JSON.parse(localStorage.getItem('se-player') || '{}');
const API_BASE      = window.API_URL || window.VITE_API_URL || window.SE_API_URL || '';
const socket        = io(`${API_BASE}/game`);

// ── game state ────────────────────────────────────────────────────────────────
const tanks     = new Map();   // playerId → { group, turretGroup, barrelGroup, avatarSprite }
let game        = null;
let myAzimuth   = 0;
let currentTurn = null;
let animating   = false;
let fieldScale  = 1;
let countdownInterval = null;
let focusReticleTimer = null;

// ── Three.js core ────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
document.body.appendChild(renderer.domElement);

const scene  = new THREE.Scene();
const camera = new THREE.Camera();
scene.add(camera);

scene.add(new THREE.AmbientLight(0xffffff, 1.2));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(0, 1, 1);
scene.add(dirLight);

// ── AR.js ────────────────────────────────────────────────────────────────────
let arSource, arContext, markerRoot, arReady = false;

arSource = new ArToolkitSource({ sourceType: 'webcam' });
arSource.init(() => {
  arSource.domElement.addEventListener('canplay', initArContext, { once: true });
  setTimeout(handleResize, 2000);
});

function initArContext() {
  arContext = new ArToolkitContext({
    cameraParametersUrl: 'https://cdn.jsdelivr.net/npm/@ar-js-org/ar.js@3.4.8/data/data/camera_para.dat',
    detectionMode: 'mono',
    maxDetectionRate: 30,
  });
  arContext.init(() => {
    camera.projectionMatrix.copy(arContext.getProjectionMatrix());
    arReady = true;
  });

  markerRoot = new THREE.Group();
  scene.add(markerRoot);

  new ArMarkerControls(arContext, markerRoot, {
    type: 'pattern',
    patternUrl: '/ar/markers/pattern-ARFly_binary_clean_05.patt',
    smooth: true,
    smoothCount: 5,
    smoothTolerance: 0.01,
    smoothThreshold: 2,
  });

  // battlefield group sits on the marker
  battlefieldGroup = new THREE.Group();
  markerRoot.add(battlefieldGroup);

  buildTerrain();
}

function handleResize() {
  if (arSource?.onResizeElement) {
    arSource.onResizeElement();
    arSource.copyElementSizeTo(renderer.domElement);
    if (arContext?.arController) arContext.arController.orientation = arSource.getVideoOrientation();
  }
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', handleResize);

// ── marker visibility polling ─────────────────────────────────────────────────
function pollMarkerVisible() {
  if (markerRoot) {
    const visible = markerRoot.visible;
    markerStatus.textContent = visible ? 'Marker locked' : 'Find marker';
    finder.hidden = visible;
  }
  requestAnimationFrame(pollMarkerVisible);
}
pollMarkerVisible();

// ── terrain ──────────────────────────────────────────────────────────────────
let battlefieldGroup = new THREE.Group(); // replaced once markerRoot exists
let terrainMesh = null;
let terrainHeights = null;  // Float32Array of sampled heights for tank placement
const TERRAIN_W = 1.0;
const TERRAIN_D = 0.75;
const TERRAIN_SEG_W = 28;
const TERRAIN_SEG_D = 22;

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

function sampleHeight(nx, nz, seed) {
  // nx, nz in [-0.5, 0.5]; returns y offset
  const edgeFade = (1 - Math.pow(Math.abs(nx) * 1.8, 3)) * (1 - Math.pow(Math.abs(nz) * 1.8, 3));
  const fade = Math.max(0, edgeFade);
  const s = seed * 0.0001;
  const h =
    Math.sin(nx * 9.3 + s) * Math.cos(nz * 7.1 + s * 1.3) * 0.022 +
    Math.sin(nx * 17.7 - s * 0.7) * Math.cos(nz * 13.4 + s) * 0.012 +
    Math.cos(nx * 5.1 + s * 2.1) * Math.sin(nz * 6.3 - s * 0.5) * 0.018;
  return h * fade;
}

function buildTerrain(seed = 12345) {
  if (terrainMesh) {
    battlefieldGroup.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh.material.dispose();
  }

  const geo = new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D, TERRAIN_SEG_W, TERRAIN_SEG_D);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  terrainHeights = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const nx = pos.getX(i) / TERRAIN_W;
    const nz = pos.getZ(i) / TERRAIN_D;
    const h = sampleHeight(nx, nz, seed);
    pos.setY(i, h);
    terrainHeights[i] = h;
  }
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a6b2a,
    roughness: 0.9,
    metalness: 0.0,
  });

  terrainMesh = new THREE.Mesh(geo, mat);
  terrainMesh.position.y = 0;
  battlefieldGroup.add(terrainMesh);

  // flat base outline
  const borderGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(TERRAIN_W, 0.002, TERRAIN_D));
  const borderMat = new THREE.LineBasicMaterial({ color: 0xf7d36e, opacity: 0.5, transparent: true });
  const border = new THREE.LineSegments(borderGeo, borderMat);
  border.position.y = 0.001;
  battlefieldGroup.add(border);
}

function getTerrainY(wx, wz) {
  // approximate terrain height at world x,z (local to battlefieldGroup, before scale)
  const nx = wx / TERRAIN_W;
  const nz = wz / TERRAIN_D;
  const seed = game ? hashSeed(game.id) : 12345;
  return sampleHeight(nx, nz, seed);
}

// ── tank building ─────────────────────────────────────────────────────────────
const textureLoader = new THREE.TextureLoader();
const avatarCache = new Map();

function loadAvatar(url) {
  if (avatarCache.has(url)) return Promise.resolve(avatarCache.get(url));
  return new Promise((resolve) => {
    textureLoader.load(url, (tex) => {
      avatarCache.set(url, tex);
      resolve(tex);
    }, undefined, () => resolve(null));
  });
}

function buildTankMesh(colorHex) {
  const group = new THREE.Group();

  // hull
  const hullGeo = new THREE.BoxGeometry(0.09, 0.036, 0.065);
  const hullMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.6, metalness: 0.3 });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.position.y = 0.018;
  group.add(hull);

  // left track
  const trackGeo = new THREE.BoxGeometry(0.096, 0.018, 0.068);
  const trackMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9 });
  const trackL = new THREE.Mesh(trackGeo, trackMat);
  trackL.position.set(-0.048, 0.009, 0);
  group.add(trackL);
  const trackR = trackL.clone();
  trackR.position.set(0.048, 0.009, 0);
  group.add(trackR);

  // turret group — rotates around Y for azimuth
  const turretGroup = new THREE.Group();
  turretGroup.position.y = 0.036;
  group.add(turretGroup);

  const turretGeo = new THREE.CylinderGeometry(0.026, 0.028, 0.022, 8);
  const turretMat = new THREE.MeshStandardMaterial({ color: 0x1a1a18, roughness: 0.5, metalness: 0.5 });
  const turret = new THREE.Mesh(turretGeo, turretMat);
  turretGroup.add(turret);

  // barrel group — child of turretGroup; tilts around X for elevation
  const barrelGroup = new THREE.Group();
  barrelGroup.position.set(0, 0.008, 0);
  turretGroup.add(barrelGroup);

  const barrelGeo = new THREE.CylinderGeometry(0.007, 0.009, 0.11, 6);
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.4, metalness: 0.6 });
  const barrel = new THREE.Mesh(barrelGeo, barrelMat);
  // lay barrel along -Z, tip at z = -0.055
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, -0.055);
  barrelGroup.add(barrel);

  return { group, turretGroup, barrelGroup };
}

async function addTank(player, index) {
  const colorHex = TANK_COLORS[index % TANK_COLORS.length];
  const { group, turretGroup, barrelGroup } = buildTankMesh(colorHex);

  const tx = player.position.x * fieldScale;
  const tz = player.position.z * fieldScale;
  const ty = getTerrainY(player.position.x, player.position.z) + 0.003;
  group.position.set(tx, ty, tz);

  const az = player.azimuth || 0;
  turretGroup.rotation.y = THREE.MathUtils.degToRad(az);

  // avatar sprite
  let avatarSprite = null;
  if (player.avatarUrl) {
    const tex = await loadAvatar(player.avatarUrl);
    if (tex) {
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      avatarSprite = new THREE.Sprite(spriteMat);
      avatarSprite.scale.set(0.1, 0.1, 1);
      avatarSprite.position.set(0, 0.19, 0);
      group.add(avatarSprite);
    }
  }

  battlefieldGroup.add(group);
  tanks.set(player.id, { group, turretGroup, barrelGroup, avatarSprite });
}

function removeTank(id) {
  const t = tanks.get(id);
  if (!t) return;
  battlefieldGroup.remove(t.group);
  tanks.delete(id);
}

function clearBattlefield() {
  tanks.forEach((_, id) => removeTank(id));
  tanks.clear();
}

function rotateTank(id, azimuth) {
  const t = tanks.get(id);
  if (!t) return;
  t.turretGroup.rotation.y = THREE.MathUtils.degToRad(azimuth);
}

// ── scene init ────────────────────────────────────────────────────────────────
async function initScene(nextGame) {
  game = nextGame;
  currentTurn = game.currentTurn;
  fieldScale = FIELD_SCALES[game.config?.fieldSize] || 1;

  if (battlefieldGroup) {
    battlefieldGroup.scale.setScalar(fieldScale);
    // rebuild terrain with game seed
    buildTerrain(hashSeed(game.id));
  }

  clearBattlefield();

  const promises = game.players
    .filter((p) => p.alive !== false)
    .map((p, i) => addTank(p, i));
  await Promise.all(promises);

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

// ── projectile + particles ────────────────────────────────────────────────────
const activeParticleSystems = [];

function spawnExplosion(point, hit) {
  const COUNT = 60;
  const positions = new Float32Array(COUNT * 3);
  const velocities = [];
  for (let i = 0; i < COUNT; i++) {
    positions[i * 3]     = point.x * fieldScale;
    positions[i * 3 + 1] = point.y;
    positions[i * 3 + 2] = point.z * fieldScale;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.random() * Math.PI;
    const speed = 0.003 + Math.random() * 0.006;
    velocities.push(
      Math.sin(phi) * Math.cos(theta) * speed,
      Math.abs(Math.cos(phi)) * speed + 0.002,
      Math.sin(phi) * Math.sin(theta) * speed
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
  const mat = new THREE.PointsMaterial({
    color: hit ? 0xff6545 : 0xf5bf52,
    size: 0.012,
    transparent: true,
    opacity: 1,
    sizeAttenuation: true,
  });
  const pts = new THREE.Points(geo, mat);
  battlefieldGroup.add(pts);

  // shockwave ring
  const ringGeo = new THREE.RingGeometry(0.001, 0.018, 24);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd580, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.position.set(point.x * fieldScale, point.y + 0.002, point.z * fieldScale);
  battlefieldGroup.add(ring);

  const startTime = performance.now();
  const duration  = 650;
  activeParticleSystems.push({
    pts, geo, mat, ring, ringMat,
    velocities, positions: geo.attributes.position.array,
    startTime, duration, done: false
  });
}

function tickParticles() {
  const now = performance.now();
  for (const sys of activeParticleSystems) {
    if (sys.done) continue;
    const t = (now - sys.startTime) / sys.duration;
    if (t >= 1) {
      sys.done = true;
      battlefieldGroup.remove(sys.pts);
      battlefieldGroup.remove(sys.ring);
      sys.geo.dispose(); sys.mat.dispose();
      sys.ring.geometry.dispose(); sys.ringMat.dispose();
      continue;
    }
    const pos = sys.positions;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[i * 3]     += sys.velocities[i * 3];
      pos[i * 3 + 1] += sys.velocities[i * 3 + 1];
      pos[i * 3 + 2] += sys.velocities[i * 3 + 2];
      sys.velocities[i * 3 + 1] -= 0.00015; // gravity
    }
    sys.pts.geometry.attributes.position.needsUpdate = true;
    sys.mat.opacity = 1 - t;

    const ringScale = 1 + t * 12;
    sys.ring.scale.set(ringScale, 1, ringScale);
    sys.ringMat.opacity = 0.85 * (1 - t);
  }
}

// ── projectile animation ──────────────────────────────────────────────────────
async function animateProjectile({ waypoints, hit, targetId, impactPoint, launchAt }) {
  animating = true;
  updateControls();

  const delay = Math.max(0, launchAt - Date.now());
  await new Promise((r) => setTimeout(r, delay));

  // scale waypoints
  const scaled = waypoints.map((wp) => new THREE.Vector3(wp.x * fieldScale, wp.y, wp.z * fieldScale));

  // projectile sphere
  const projGeo = new THREE.SphereGeometry(0.016, 8, 8);
  const projMat = new THREE.MeshStandardMaterial({ color: 0xffe35d, emissive: 0xff9f28, emissiveIntensity: 1.5 });
  const proj = new THREE.Mesh(projGeo, projMat);
  battlefieldGroup.add(proj);

  // trail pool
  const trailGeos = [];
  const trailMats = [];
  const trailMeshes = [];
  const trailHistory = [];
  for (let i = 0; i < TRAIL_LENGTH; i++) {
    const tg = new THREE.SphereGeometry(0.009 * (1 - i / TRAIL_LENGTH), 5, 5);
    const tm = new THREE.MeshBasicMaterial({ color: 0xffd580, transparent: true, opacity: (1 - i / TRAIL_LENGTH) * 0.6 });
    const tm2 = new THREE.Mesh(tg, tm);
    tm2.visible = false;
    battlefieldGroup.add(tm2);
    trailGeos.push(tg);
    trailMats.push(tm);
    trailMeshes.push(tm2);
  }

  for (const wp of scaled) {
    proj.position.copy(wp);

    trailHistory.unshift(wp.clone());
    if (trailHistory.length > TRAIL_LENGTH) trailHistory.pop();
    trailMeshes.forEach((m, i) => {
      if (trailHistory[i]) {
        m.position.copy(trailHistory[i]);
        m.visible = true;
      } else {
        m.visible = false;
      }
    });

    await new Promise((r) => setTimeout(r, 45));
  }

  // cleanup projectile + trail
  battlefieldGroup.remove(proj);
  projGeo.dispose(); projMat.dispose();
  trailMeshes.forEach((m) => battlefieldGroup.remove(m));
  trailGeos.forEach((g) => g.dispose());
  trailMats.forEach((m) => m.dispose());

  // explosion
  spawnExplosion(impactPoint, hit);

  if (hit && targetId) {
    const t = tanks.get(targetId);
    if (t) removeTank(targetId);
  }

  await new Promise((r) => setTimeout(r, 650));
  animating = false;
  updateControls();
}

// ── camera focus (tap to focus) ───────────────────────────────────────────────
function showFocusReticle(x, y, supported) {
  focusReticle.style.left = `${x}px`;
  focusReticle.style.top  = `${y}px`;
  focusReticle.style.borderColor = supported ? '#89e163' : '#f7d36e';
  focusReticle.hidden = false;
  clearTimeout(focusReticleTimer);
  focusReticleTimer = setTimeout(() => { focusReticle.hidden = true; }, 760);
}

async function focusCameraAt(clientX, clientY) {
  const video  = arSource?.domElement;
  const stream = video?.srcObject;
  const track  = stream?.getVideoTracks?.()[0] || null;
  let supported = false;

  if (track?.applyConstraints) {
    const x = Math.min(1, Math.max(0, clientX / window.innerWidth));
    const y = Math.min(1, Math.max(0, clientY / window.innerHeight));
    const caps  = track.getCapabilities?.() || {};
    const modes = caps.focusMode || [];
    const focusMode = modes.includes('single-shot') ? 'single-shot'
                    : modes.includes('continuous')  ? 'continuous'
                    : modes.includes('manual')       ? 'manual'
                    : null;
    const attempts = [];
    if (focusMode) {
      attempts.push({ advanced: [{ focusMode, pointsOfInterest: [{ x, y }] }] });
      attempts.push({ advanced: [{ focusMode }] });
    }
    attempts.push({ advanced: [{ pointsOfInterest: [{ x, y }] }] });

    for (const c of attempts) {
      try { await track.applyConstraints(c); supported = true; break; } catch { supported = false; }
    }
  }
  showFocusReticle(clientX, clientY, supported);
}

document.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.controls, .top-hud, .game-over, button, input')) return;
  focusCameraAt(e.clientX, e.clientY);
});

// ── render loop ───────────────────────────────────────────────────────────────
function render() {
  requestAnimationFrame(render);
  if (arReady && arContext && arSource?.domElement) {
    arContext.update(arSource.domElement);
  }
  tickParticles();
  renderer.render(scene, camera);
}
render();

// ── socket events ─────────────────────────────────────────────────────────────
function escapeHtml(v) {
  return String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
}

socket.on('connect', () => {
  setHud('Online');
  socket.emit('rejoin-game', { gameId, playerId });
});

socket.on('disconnect', () => setHud('Offline'));

socket.on('game-state', ({ game: nextGame }) => {
  initScene(nextGame);
  setHud(nextGame.status);
});

socket.on('game-started', ({ game: nextGame, currentTurn: nextTurn }) => {
  initScene(nextGame);
  currentTurn = nextTurn;
  setHud('Playing');
  startCountdown();
  updateControls();
});

socket.on('your-turn', ({ playerId: nextTurn }) => {
  currentTurn = nextTurn;
  if (game) game.currentTurn = nextTurn;
  startCountdown();
  updateControls();
});

socket.on('tank-rotated', ({ playerId: rotatedId, azimuth }) => {
  rotateTank(rotatedId, azimuth);
  if (rotatedId === playerId) {
    myAzimuth = azimuth;
    azimuthValue.textContent = `${Math.round(myAzimuth)} deg`;
  }
});

socket.on('projectile-launched', (payload) => {
  stopCountdown();
  animateProjectile(payload);
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
  stopCountdown();
  game = finalGame || game;
  controls.hidden = true;
  waitingOverlay.hidden = true;
  const winner = game?.players.find((p) => p.id === winnerId);
  gameOverEl.innerHTML = `
    <div>
      <img src="${escapeHtml(winner?.avatarUrl || storedPlayer.avatarUrl || '')}" alt="" />
      <h1>Game Over</h1>
      <p>${escapeHtml(winner?.username || 'Winner')} wins</p>
    </div>
  `;
  gameOverEl.hidden = false;
  setTimeout(() => {
    window.location.href = `/venue/${encodeURIComponent(game?.venueId || 'demo')}/table/${encodeURIComponent(game?.tableNo || '1')}`;
  }, 5000);
});

socket.on('error-message', ({ error }) => {
  waitingOverlay.hidden = false;
  waitingOverlay.textContent = error;
});

// ── controls ──────────────────────────────────────────────────────────────────
rotateLeft.addEventListener('click',  () => setAzimuth(myAzimuth - 5));
rotateRight.addEventListener('click', () => setAzimuth(myAzimuth + 5));

elevationInput.addEventListener('input', () => {
  elevationValue.textContent = `${elevationInput.value} deg`;
});

powerInput.addEventListener('input', () => {
  powerValue.textContent = `${powerInput.value}%`;
});

fireButton.addEventListener('click', () => {
  fireButton.disabled = true;
  socket.emit(
    'fire',
    { gameId, playerId, azimuth: myAzimuth, elevation: Number(elevationInput.value), power: Number(powerInput.value) },
    () => { fireButton.disabled = false; }
  );
});
