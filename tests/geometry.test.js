import test from 'node:test';
import assert from 'node:assert/strict';
import { createTorus, createTorusMesh, projectPoint, createPointerRay, raycastSurface, selectSurfaceConnections } from '../site/geometry.js';

test('the sampled torus satisfies its implicit surface equation', () => {
  const points = createTorus();
  assert.equal(points.length, 76 * 24);
  for (const p of points) {
    const radius = Math.hypot(p.x, p.y);
    assert.ok(Math.abs((radius - 1) ** 2 + p.z ** 2 - 0.38 ** 2) < 1e-12);
  }
});

test('full-screen projection stays finite at all rotations, including points beyond the viewport', () => {
  const points = createTorus(112, 32);
  for (const [width, height] of [[320, 740], [390, 844], [820, 1180], [1440, 900]]) {
    const scale = Math.max(width * 0.43, height * 0.56);
    for (let rotation = 0; rotation < Math.PI * 2; rotation += 0.1) {
      for (const point of points) {
        const p = projectPoint(point, rotation, scale, width * 0.54, height * 0.555);
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
        assert.ok(p.perspective > 0);
      }
    }
  }
});

test('invalid sample counts fail explicitly', () => {
  for (const count of [0, -1, 2, 3.5, NaN]) {
    assert.throws(() => createTorus(count, 24), RangeError);
    assert.throws(() => createTorus(76, count), RangeError);
  }
});

test('the picking mesh closes both torus seams and has reciprocal surface neighbours', () => {
  const mesh = createTorusMesh(12, 8);
  assert.equal(mesh.triangles.length, mesh.points.length * 6);
  assert.ok(mesh.neighbours[0].includes(11 * 8));
  assert.ok(mesh.neighbours[0].includes(7));
  const edgeCounts = new Map();
  for (let offset = 0; offset < mesh.triangles.length; offset += 3) {
    const indices = Array.from(mesh.triangles.subarray(offset, offset + 3));
    assert.equal(new Set(indices).size, 3);
    for (let i = 0; i < 3; i += 1) {
      const a = indices[i];
      const b = indices[(i + 1) % 3];
      const key = `${Math.min(a, b)},${Math.max(a, b)}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
    }
  }
  assert.ok([...edgeCounts.values()].every(count => count === 2));
  mesh.neighbours.forEach((neighbours, index) => {
    for (const neighbour of neighbours) assert.ok(mesh.neighbours[neighbour].includes(index));
  });
});

test('pointer rays invert the perspective projection across rotations and offsets', () => {
  const point = { x: 1.2, y: -.4, z: .2 };
  for (const rotation of [0, .24, 1.5, 3.8]) {
    const projected = projectPoint(point, rotation, 550, 760, 470);
    const ray = createPointerRay(projected.x, projected.y, 550, 760, 470);
    const distance = Math.hypot(projected.viewX, projected.viewY, 4.8 - projected.depth);
    assert.ok(Math.abs(ray.direction.x * distance - projected.viewX) < 1e-12);
    assert.ok(Math.abs(ray.direction.y * distance - projected.viewY) < 1e-12);
    assert.ok(Math.abs(ray.origin.z + ray.direction.z * distance - projected.depth) < 1e-12);
  }
});

test('raycasting chooses the front surface regardless of triangle order and includes shared edges', () => {
  const vertex = (viewX, viewY, depth) => ({ viewX, viewY, depth, x: viewX * 4.8 / (4.8 - depth), y: viewY * 4.8 / (4.8 - depth) });
  const vertices = [-1, 1].flatMap(depth => [vertex(-1, -1, depth), vertex(1, -1, depth), vertex(0, 1, depth)]);
  const ray = createPointerRay(0, 0, 1, 0, 0);
  for (const indices of [[0, 1, 2, 3, 4, 5], [3, 4, 5, 0, 1, 2]]) {
    const hit = raycastSurface(vertices, Uint32Array.from(indices), ray);
    assert.ok(Math.abs(hit.distance - 3.8) < 1e-12);
    assert.ok(Math.abs(hit.point.z - 1) < 1e-12);
    assert.deepEqual(hit.indices, [3, 4, 5]);
  }
  const mesh = createTorusMesh();
  const projected = mesh.points.map(p => projectPoint(p, .24, 550, 760, 470));
  const point = projected.reduce((a, b) => a.depth > b.depth ? a : b);
  const hit = raycastSurface(projected, mesh.triangles, createPointerRay(point.x, point.y, 550, 760, 470));
  assert.ok(hit);
  assert.ok(Math.abs(hit.point.z - point.depth) < 1e-6);
});

test('the torus hole and exterior never connect to nearby points', () => {
  const mesh = createTorusMesh();
  const projected = mesh.points.map(p => projectPoint(p, 0, 550, 760, 470));
  for (const pointer of [{ x: 760, y: 470 }, { x: -10000, y: 470 }]) {
    const selected = selectSurfaceConnections(mesh, projected, pointer, 550, 760, 470);
    assert.equal(selected.hit, null);
    assert.deepEqual(selected.points, []);
    assert.deepEqual(selected.edges, []);
  }
});

// Independent screen-space depth interpolation checks the ray selection against
// the nearest rasterized surface, including camera-facing surfaces hidden by a rim.
function frontDepthAt(projected, triangles, x, y) {
  let front = -Infinity;
  for (let offset = 0; offset < triangles.length; offset += 3) {
    const a = projected[triangles[offset]];
    const b = projected[triangles[offset + 1]];
    const c = projected[triangles[offset + 2]];
    const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denominator) < 1e-10) continue;
    const u = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denominator;
    const v = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denominator;
    const w = 1 - u - v;
    if (Math.min(u, v, w) < -1e-7) continue;
    const cameraDistance = 1 / (u / (4.8 - a.depth) + v / (4.8 - b.depth) + w / (4.8 - c.depth));
    front = Math.max(front, 4.8 - cameraDistance);
  }
  return front;
}

test('surface connections stay visible and follow mesh neighbours through rotation and breathing', () => {
  const mesh = createTorusMesh();
  let selections = 0;
  let hiddenNearby = 0;
  let seamConnections = 0;
  for (const [rotation, elapsed] of [[0, 0], [.24, 1500], [1.5, 4000], [3.8, 10000]]) {
    const projected = mesh.points.map(p => {
      const breath = 1 + Math.sin(elapsed * .0005 + p.phase) * .012;
      return projectPoint({ x: p.x * breath, y: p.y * breath, z: p.z }, rotation, 550, 760, 470);
    });
    for (let index = 0; index < projected.length; index += 137) {
      const pointer = projected[index];
      const selected = selectSurfaceConnections(mesh, projected, pointer, 550, 760, 470);
      if (!selected.points.length) continue;
      selections += 1;
      assert.ok(selected.points.length <= 8);
      const indices = new Set(selected.points.map(p => p.index));
      for (const candidate of selected.points) {
        const p = projected[candidate.index];
        assert.ok(Math.abs(frontDepthAt(projected, mesh.triangles, p.x, p.y) - p.depth) < 1e-5, `hidden point ${candidate.index} at rotation ${rotation}`);
        assert.ok(Math.hypot(p.x - pointer.x, p.y - pointer.y) < 105);
      }
      if (frontDepthAt(projected, mesh.triangles, pointer.x, pointer.y) > pointer.depth + .01) {
        hiddenNearby += 1;
        assert.ok(!indices.has(index), 'the hidden point under the cursor is excluded');
      }
      for (const [a, b] of selected.edges) {
        assert.ok(indices.has(a) && indices.has(b));
        assert.ok(mesh.neighbours[a].includes(b));
        const viewX = (projected[a].viewX + projected[b].viewX) / 2;
        const viewY = (projected[a].viewY + projected[b].viewY) / 2;
        const depth = (projected[a].depth + projected[b].depth) / 2;
        const perspective = 4.8 / (4.8 - depth);
        assert.ok(Math.abs(frontDepthAt(projected, mesh.triangles, 760 + viewX * 550 * perspective, 470 + viewY * 550 * perspective) - depth) < 1e-5);
        if (Math.abs(a - b) > 32) seamConnections += 1;
      }
    }
  }
  assert.ok(selections > 50);
  assert.ok(hiddenNearby > 10, 'the fixtures exercise overlapping front/back surfaces');
  assert.ok(seamConnections > 0, 'the selection remains connected across a torus seam');
});
