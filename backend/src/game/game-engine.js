const DEG_TO_RAD = Math.PI / 180;

export const FIELD_SCALES = {
  small: 0.75,
  medium: 1,
  large: 1.25
};

export function getTankPosition(index, count) {
  const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;
  return {
    x: Math.cos(angle) * 0.38,
    y: 0.035,
    z: Math.sin(angle) * 0.28
  };
}

export function getTankPositions(players) {
  const ordered = players.map((player, index) => ({
    ...player,
    position: player.position || getTankPosition(index, players.length)
  }));

  return ordered;
}

export function computeTrajectory(origin, azimuth, elevation, power, options = {}) {
  const steps = options.steps || 72;
  const duration = options.duration || 3;
  const gravity = options.gravity || 1.65;
  const speed = 0.45 + (Number(power) / 100) * 0.95;
  const azimuthRad = Number(azimuth) * DEG_TO_RAD;
  const elevationRad = Number(elevation) * DEG_TO_RAD;
  const horizontalSpeed = Math.cos(elevationRad) * speed;
  const verticalSpeed = Math.sin(elevationRad) * speed;
  const dirX = Math.sin(azimuthRad);
  const dirZ = -Math.cos(azimuthRad);
  const points = [];

  for (let i = 0; i < steps; i += 1) {
    const t = (duration * i) / (steps - 1);
    const y = origin.y + verticalSpeed * t - 0.5 * gravity * t * t;

    points.push({
      x: origin.x + dirX * horizontalSpeed * t,
      y: Math.max(0.018, y),
      z: origin.z + dirZ * horizontalSpeed * t
    });

    if (i > 8 && y <= 0.018) {
      break;
    }
  }

  return points;
}

export function computeLeapFrogTrajectory(origin, azimuth, elevation, power, options = {}) {
  const first = computeTrajectory(origin, azimuth, elevation, power, {
    ...options,
    duration: 2.1,
    steps: 46
  });
  const landing = first[first.length - 1];
  const second = computeTrajectory(landing, azimuth, Math.max(20, elevation * 0.45), power * 0.55, {
    ...options,
    duration: 1.35,
    steps: 30
  });
  const thirdOrigin = second[second.length - 1];
  const third = computeTrajectory(thirdOrigin, azimuth, 18, power * 0.32, {
    ...options,
    duration: 0.85,
    steps: 20
  });

  return [...first, ...second.slice(1), ...third.slice(1)];
}

export function detectHit(waypoints, players, firingPlayerId, hitRadius = 0.065) {
  const livingTargets = players.filter((player) => player.alive !== false && player.id !== firingPlayerId);

  for (const point of waypoints) {
    if (point.y > 0.13) continue;

    for (const target of livingTargets) {
      if (!target.position) continue;
      const dx = point.x - target.position.x;
      const dz = point.z - target.position.z;
      const distance = Math.sqrt(dx * dx + dz * dz);

      if (distance <= hitRadius) {
        return {
          hit: true,
          targetId: target.id,
          impactPoint: { x: point.x, y: 0.02, z: point.z }
        };
      }
    }
  }

  const lastPoint = waypoints[waypoints.length - 1];
  return {
    hit: false,
    targetId: null,
    impactPoint: { x: lastPoint.x, y: 0.02, z: lastPoint.z }
  };
}
