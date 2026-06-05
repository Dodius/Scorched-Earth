const FIELD_SCALES = {
  small: 0.75,
  medium: 1,
  large: 1.25
};

const SCENE_COLORS = {
  'classic-grid': { plane: '#15331f', wire: '#70f28c', tankBase: 0 },
  'pub-table': { plane: '#3a2818', wire: '#f2bb60', tankBase: 30 },
  'crater-field': { plane: '#2c2c28', wire: '#d8e06b', tankBase: 170 }
};

const params = new URLSearchParams(window.location.search);
const gameId = params.get('gameId');
const playerId = params.get('playerId');
const storedPlayer = JSON.parse(localStorage.getItem('se-player') || '{}');
const API_BASE = window.API_URL || window.VITE_API_URL || window.SE_API_URL || '';
const socket = io(`${API_BASE}/game`);

const battlefield = document.querySelector('#battlefield');
const marker = document.querySelector('#mainMarker');
const markerStatus = document.querySelector('#markerStatus');
const gameStatus = document.querySelector('#gameStatus');
const controls = document.querySelector('#controls');
const waitingOverlay = document.querySelector('#waitingOverlay');
const gameOver = document.querySelector('#gameOver');
const finder = document.querySelector('#finder');
const rotateLeft = document.querySelector('#rotateLeft');
const rotateRight = document.querySelector('#rotateRight');
const azimuthValue = document.querySelector('#azimuthValue');
const elevationInput = document.querySelector('#elevationInput');
const elevationValue = document.querySelector('#elevationValue');
const powerInput = document.querySelector('#powerInput');
const powerValue = document.querySelector('#powerValue');
const fireButton = document.querySelector('#fireButton');

const tanks = new Map();
let game = null;
let myAzimuth = 0;
let currentTurn = null;
let animating = false;
let arLayerFixes = 0;

AFRAME.registerComponent('face-camera', {
  tick() {
    const camera = document.querySelector('[camera]');
    if (!camera) return;
    this.el.object3D.lookAt(camera.object3D.getWorldPosition(new THREE.Vector3()));
  }
});

function setHud(message) {
  gameStatus.textContent = message;
}

function setMarkerText() {
  markerStatus.textContent = marker.object3D.visible ? 'Marker locked' : 'Find marker';
  finder.hidden = marker.object3D.visible;
  requestAnimationFrame(setMarkerText);
}
setMarkerText();

function forceCameraLayerVisible() {
  document.querySelectorAll('video').forEach((video) => {
    video.style.position = 'fixed';
    video.style.inset = '0';
    video.style.width = '100vw';
    video.style.height = '100vh';
    video.style.objectFit = 'cover';
    video.style.zIndex = '0';
    video.style.filter = 'none';
    video.style.opacity = '1';
  });

  document.querySelectorAll('canvas').forEach((canvas) => {
    canvas.style.position = 'fixed';
    canvas.style.inset = '0';
    canvas.style.zIndex = '1';
    canvas.style.background = 'transparent';
  });

  arLayerFixes += 1;
  if (arLayerFixes < 80) {
    window.setTimeout(forceCameraLayerVisible, 250);
  }
}
forceCameraLayerVisible();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
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
    const player = game.players.find((item) => item.id === currentTurn);
    waitingOverlay.textContent = `Waiting for ${player?.username || 'next player'}`;
  }
}

function setAzimuth(value, broadcast = true) {
  myAzimuth = ((Number(value) % 360) + 360) % 360;
  azimuthValue.textContent = `${Math.round(myAzimuth)}°`;
  rotateTank(playerId, myAzimuth);

  if (broadcast) {
    socket.emit('rotate-tank', { gameId, playerId, azimuth: myAzimuth });
  }
}

function createEntity(tag, attrs = {}) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function tankColor(index, base = 0) {
  return `hsl(${(base + index * 58) % 360}, 78%, 55%)`;
}

function rotateTank(id, azimuth) {
  const tank = tanks.get(id);
  if (!tank) return;
  tank.setAttribute('rotation', `0 ${azimuth} 0`);
}

function clearBattlefield() {
  tanks.clear();
  while (battlefield.firstChild) battlefield.removeChild(battlefield.firstChild);
}

function addField(config) {
  const colors = SCENE_COLORS[config.scenePreset] || SCENE_COLORS['classic-grid'];
  battlefield.setAttribute('scale', `${FIELD_SCALES[config.fieldSize] || 1} ${FIELD_SCALES[config.fieldSize] || 1} ${FIELD_SCALES[config.fieldSize] || 1}`);

  const plane = createEntity('a-plane', {
    width: '1',
    height: '0.75',
    rotation: '-90 0 0',
    color: colors.plane,
    material: `shader: standard; roughness: 0.8; metalness: 0.05; opacity: 0.92`
  });
  battlefield.appendChild(plane);

  for (let i = 0; i <= 10; i += 1) {
    const x = -0.5 + i * 0.1;
    battlefield.appendChild(createEntity('a-box', {
      width: '0.004',
      height: '0.004',
      depth: '0.75',
      position: `${x} 0.006 0`,
      color: colors.wire
    }));
  }

  for (let i = 0; i <= 8; i += 1) {
    const z = -0.375 + i * 0.09375;
    battlefield.appendChild(createEntity('a-box', {
      width: '1',
      height: '0.004',
      depth: '0.004',
      position: `0 0.007 ${z}`,
      color: colors.wire
    }));
  }

  if (config.scenePreset === 'crater-field') {
    for (let i = 0; i < 5; i += 1) {
      const crater = createEntity('a-ring', {
        radiusInner: '0.035',
        radiusOuter: '0.055',
        rotation: '-90 0 0',
        position: `${-0.28 + i * 0.14} 0.006 ${i % 2 ? -0.12 : 0.12}`,
        color: '#111',
        material: 'opacity: 0.45; transparent: true'
      });
      battlefield.appendChild(crater);
    }
  }
}

function addTank(player, index, config) {
  const colors = SCENE_COLORS[config.scenePreset] || SCENE_COLORS['classic-grid'];
  const group = createEntity('a-entity', {
    id: `tank-${player.id}`,
    position: `${player.position.x} ${player.position.y} ${player.position.z}`,
    rotation: `0 ${player.azimuth || 0} 0`
  });

  const body = createEntity('a-box', {
    width: '0.09',
    height: '0.045',
    depth: '0.065',
    color: tankColor(index, colors.tankBase),
    position: '0 0.02 0'
  });

  const turret = createEntity('a-cylinder', {
    radius: '0.026',
    height: '0.024',
    color: '#20231e',
    position: '0 0.055 0'
  });

  const barrel = createEntity('a-cylinder', {
    radius: '0.008',
    height: '0.105',
    color: '#e8ddc6',
    position: '0 0.058 -0.065',
    rotation: '90 0 0'
  });

  const avatar = createEntity('a-image', {
    src: player.avatarUrl,
    width: '0.1',
    height: '0.1',
    position: '0 0.19 0',
    'face-camera': ''
  });

  group.append(body, turret, barrel, avatar);
  battlefield.appendChild(group);
  tanks.set(player.id, group);
}

function initScene(nextGame) {
  game = nextGame;
  currentTurn = game.currentTurn;
  clearBattlefield();
  addField(game.config);
  game.players.forEach((player, index) => {
    if (player.alive !== false) addTank(player, index, game.config);
  });

  const me = game.players.find((player) => player.id === playerId);
  if (me) setAzimuth(me.azimuth || 0, false);
  updateControls();
}

function waitUntil(timestamp) {
  const delay = Math.max(0, timestamp - Date.now());
  return new Promise((resolve) => window.setTimeout(resolve, delay));
}

async function animateProjectile({ waypoints, hit, targetId, impactPoint, launchAt }) {
  animating = true;
  updateControls();
  await waitUntil(launchAt);

  const projectile = createEntity('a-sphere', {
    radius: '0.018',
    color: '#ffe35d',
    material: 'emissive: #ff9f28; emissiveIntensity: 1.2'
  });
  battlefield.appendChild(projectile);

  for (const point of waypoints) {
    projectile.setAttribute('position', `${point.x} ${point.y} ${point.z}`);
    await new Promise((resolve) => window.setTimeout(resolve, 45));
  }

  projectile.remove();
  explodeAt(impactPoint, hit, targetId);
  await new Promise((resolve) => window.setTimeout(resolve, 650));
  animating = false;
  updateControls();
}

function explodeAt(point, hit, targetId) {
  const burst = createEntity('a-sphere', {
    radius: '0.025',
    color: hit ? '#ff6545' : '#f5bf52',
    position: `${point.x} ${point.y} ${point.z}`,
    material: 'transparent: true; opacity: 0.9; emissive: #ff7a2e',
    animation__scale: 'property: scale; to: 7 7 7; dur: 420; easing: easeOutQuad',
    animation__fade: 'property: material.opacity; to: 0; dur: 520; easing: easeOutQuad'
  });
  battlefield.appendChild(burst);

  for (let i = 0; i < 7; i += 1) {
    const angle = (Math.PI * 2 * i) / 7;
    const debris = createEntity('a-box', {
      width: '0.012',
      height: '0.012',
      depth: '0.012',
      color: '#f5bf52',
      position: `${point.x} ${point.y + 0.03} ${point.z}`,
      animation__move: `property: position; to: ${point.x + Math.cos(angle) * 0.16} ${point.y + 0.08} ${point.z + Math.sin(angle) * 0.16}; dur: 520; easing: easeOutQuad`,
      animation__fade: 'property: material.opacity; to: 0; dur: 520'
    });
    battlefield.appendChild(debris);
    window.setTimeout(() => debris.remove(), 620);
  }

  window.setTimeout(() => {
    burst.remove();
    if (hit && targetId) tanks.get(targetId)?.remove();
  }, 620);
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
  updateControls();
});

socket.on('your-turn', ({ playerId: nextTurn }) => {
  currentTurn = nextTurn;
  if (game) game.currentTurn = nextTurn;
  updateControls();
});

socket.on('tank-rotated', ({ playerId: rotatedPlayerId, azimuth }) => {
  rotateTank(rotatedPlayerId, azimuth);
  if (rotatedPlayerId === playerId) {
    myAzimuth = azimuth;
    azimuthValue.textContent = `${Math.round(myAzimuth)}°`;
  }
});

socket.on('projectile-launched', (payload) => {
  animateProjectile(payload);
});

socket.on('player-eliminated', ({ playerId: eliminatedId }) => {
  const player = game?.players.find((item) => item.id === eliminatedId);
  if (player) player.alive = false;
});

socket.on('game-over', ({ winnerId, game: finalGame }) => {
  game = finalGame || game;
  controls.hidden = true;
  waitingOverlay.hidden = true;
  const winner = game?.players.find((player) => player.id === winnerId);
  gameOver.innerHTML = `
    <div>
      <img src="${winner?.avatarUrl || storedPlayer.avatarUrl || ''}" alt="" />
      <h1>Game Over</h1>
      <p>${escapeHtml(winner?.username || 'Winner')} wins</p>
    </div>
  `;
  gameOver.hidden = false;
  window.setTimeout(() => {
    window.location.href = `/venue/${encodeURIComponent(game?.venueId || 'demo')}/table/${encodeURIComponent(game?.tableNo || '1')}`;
  }, 5000);
});

socket.on('error-message', ({ error }) => {
  waitingOverlay.hidden = false;
  waitingOverlay.textContent = error;
});

rotateLeft.addEventListener('click', () => setAzimuth(myAzimuth - 5));
rotateRight.addEventListener('click', () => setAzimuth(myAzimuth + 5));

elevationInput.addEventListener('input', () => {
  elevationValue.textContent = `${elevationInput.value}°`;
});

powerInput.addEventListener('input', () => {
  powerValue.textContent = `${powerInput.value}%`;
});

fireButton.addEventListener('click', () => {
  fireButton.disabled = true;
  socket.emit(
    'fire',
    {
      gameId,
      playerId,
      azimuth: myAzimuth,
      elevation: Number(elevationInput.value),
      power: Number(powerInput.value)
    },
    () => {
      fireButton.disabled = false;
    }
  );
});
