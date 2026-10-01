// A sampled torus, projected from 3D. No WebGL or external animation runtime.
const CAMERA_DISTANCE = 4.8;
export function createTorus(around = 76, tube = 24) {
  if (!Number.isInteger(around) || !Number.isInteger(tube) || around < 3 || tube < 3) {
    throw new RangeError('Torus sample counts must be integers of at least 3.');
  }
  const points = [];
  for (let u = 0; u < around; u += 1) {
    for (let v = 0; v < tube; v += 1) {
      const theta = u / around * Math.PI * 2;
      const phi = v / tube * Math.PI * 2;
      const radius = 1 + 0.38 * Math.cos(phi);
      points.push({ x: radius * Math.cos(theta), y: radius * Math.sin(theta), z: 0.38 * Math.sin(phi), phase: theta + phi });
    }
  }
  return points;
}

export function projectPoint(point, rotation, scale, centerX, centerY) {
  const cy = Math.cos(rotation);
  const sy = Math.sin(rotation);
  const x = point.x * cy + point.z * sy;
  const z = -point.x * sy + point.z * cy;
  const tilt = 0.94;
  const y = point.y * Math.cos(tilt) - z * Math.sin(tilt);
  const depth = point.y * Math.sin(tilt) + z * Math.cos(tilt);
  const perspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - depth);
  const roll = -0.36;
  const viewX = x * Math.cos(roll) - y * Math.sin(roll);
  const viewY = x * Math.sin(roll) + y * Math.cos(roll);
  return {
    x: centerX + viewX * scale * perspective,
    y: centerY + viewY * scale * perspective,
    viewX,
    viewY,
    depth,
    perspective,
  };
}

export function createTorusMesh(around = 112, tube = 32) {
  const points = createTorus(around, tube);
  const triangles = new Uint32Array(points.length * 6);
  const neighbours = [];
  const index = (u, v) => ((u + around) % around) * tube + (v + tube) % tube;
  let offset = 0;
  for (let u = 0; u < around; u += 1) {
    for (let v = 0; v < tube; v += 1) {
      const a = index(u, v);
      const b = index(u + 1, v);
      const c = index(u, v + 1);
      const d = index(u + 1, v + 1);
      triangles.set([a, b, c, b, d, c], offset);
      offset += 6;
      neighbours[a] = [index(u - 1, v), b, index(u, v - 1), c];
    }
  }
  return { points, triangles, neighbours };
}

export function createPointerRay(x, y, scale, centerX, centerY) {
  const dx = (x - centerX) / scale;
  const dy = (y - centerY) / scale;
  const length = Math.hypot(dx, dy, CAMERA_DISTANCE);
  return {
    origin: { x: 0, y: 0, z: CAMERA_DISTANCE },
    direction: { x: dx / length, y: dy / length, z: -CAMERA_DISTANCE / length },
    screenX: x,
    screenY: y,
  };
}

// Möller–Trumbore ray/triangle intersection, with a cheap screen-bounds rejection.
// All torus vertices remain in front of the camera, so projected bounds are safe.
export function raycastSurface(projected, triangles, ray) {
  const { origin, direction, screenX, screenY } = ray;
  let closest = Infinity;
  let triangleOffset = -1;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const a = projected[triangles[offset]];
    const b = projected[triangles[offset + 1]];
    const c = projected[triangles[offset + 2]];
    const epsilon = 1e-6;
    if (screenX < Math.min(a.x, b.x, c.x) - epsilon || screenX > Math.max(a.x, b.x, c.x) + epsilon
      || screenY < Math.min(a.y, b.y, c.y) - epsilon || screenY > Math.max(a.y, b.y, c.y) + epsilon) continue;

    const e1x = b.viewX - a.viewX;
    const e1y = b.viewY - a.viewY;
    const e1z = b.depth - a.depth;
    const e2x = c.viewX - a.viewX;
    const e2y = c.viewY - a.viewY;
    const e2z = c.depth - a.depth;
    const px = direction.y * e2z - direction.z * e2y;
    const py = direction.z * e2x - direction.x * e2z;
    const pz = direction.x * e2y - direction.y * e2x;
    const determinant = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(determinant) < 1e-10) continue;
    const inverse = 1 / determinant;
    const tx = origin.x - a.viewX;
    const ty = origin.y - a.viewY;
    const tz = origin.z - a.depth;
    const u = (tx * px + ty * py + tz * pz) * inverse;
    if (u < -1e-7 || u > 1 + 1e-7) continue;
    const qx = ty * e1z - tz * e1y;
    const qy = tz * e1x - tx * e1z;
    const qz = tx * e1y - ty * e1x;
    const v = (direction.x * qx + direction.y * qy + direction.z * qz) * inverse;
    if (v < -1e-7 || u + v > 1 + 1e-7) continue;
    const distance = (e2x * qx + e2y * qy + e2z * qz) * inverse;
    if (distance > 0 && distance < closest) {
      closest = distance;
      triangleOffset = offset;
    }
  }
  if (triangleOffset < 0) return null;
  return {
    distance: closest,
    point: {
      x: origin.x + direction.x * closest,
      y: origin.y + direction.y * closest,
      z: origin.z + direction.z * closest,
    },
    indices: Array.from(triangles.subarray(triangleOffset, triangleOffset + 3)),
  };
}

export function selectSurfaceConnections(mesh, projected, pointer, scale, centerX, centerY) {
  const radius = 105;
  const hit = raycastSurface(projected, mesh.triangles, createPointerRay(pointer.x, pointer.y, scale, centerX, centerY));
  if (!hit) return { hit: null, points: [], edges: [] };

  // Walk the parameter-grid neighbours of the hit face; screen proximity alone
  // would mix separate sheets where the front and back of the torus overlap.
  const visited = new Set(hit.indices);
  const queue = hit.indices.map(index => ({ index, steps: 0 }));
  const candidates = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const { index, steps } = queue[cursor];
    const p = projected[index];
    const distance = Math.hypot(p.x - pointer.x, p.y - pointer.y);
    if (distance < radius) {
      candidates.push({ index, distance, surfaceDistance: Math.hypot(p.viewX - hit.point.x, p.viewY - hit.point.y, p.depth - hit.point.z) });
    }
    if (steps >= 3) continue;
    for (const neighbour of mesh.neighbours[index]) {
      if (visited.has(neighbour)) continue;
      visited.add(neighbour);
      queue.push({ index: neighbour, steps: steps + 1 });
    }
  }
  candidates.sort((a, b) => a.surfaceDistance - b.surfaceDistance);

  function visible(p) {
    const ray = createPointerRay(p.x, p.y, scale, centerX, centerY);
    const first = raycastSurface(projected, mesh.triangles, ray);
    const distance = Math.hypot(p.viewX, p.viewY, CAMERA_DISTANCE - p.depth);
    return first !== null && first.distance >= distance - 1e-5;
  }

  // Only a small local shortlist needs its own occlusion rays.
  const points = [];
  for (const candidate of candidates.slice(0, 24)) {
    if (visible(projected[candidate.index])) points.push(candidate);
    if (points.length === 8) break;
  }
  const selected = new Set(points.map(p => p.index));
  const edges = [];
  for (const { index } of points) {
    for (const neighbour of mesh.neighbours[index]) {
      if (neighbour <= index || !selected.has(neighbour)) continue;
      const a = projected[index];
      const b = projected[neighbour];
      const viewX = (a.viewX + b.viewX) / 2;
      const viewY = (a.viewY + b.viewY) / 2;
      const depth = (a.depth + b.depth) / 2;
      const perspective = CAMERA_DISTANCE / (CAMERA_DISTANCE - depth);
      if (visible({ viewX, viewY, depth, x: centerX + viewX * scale * perspective, y: centerY + viewY * scale * perspective })) {
        edges.push([index, neighbour]);
      }
    }
  }
  return { hit, points, edges };
}
