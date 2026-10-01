const canvas = document.querySelector('#geometry-canvas');
const errorMessage = document.querySelector('#geometry-error');
const motionButton = document.querySelector('#motion-toggle');

async function startGeometry() {
  // Keep the renderer and geometry on the same release, and catch module-load
  // failures here so an old cached module cannot leave a silently empty canvas.
  const { createTorusMesh, projectPoint, selectSurfaceConnections } = await import('./geometry.js?v=20261001-raycast-1');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available.');

  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const mesh = createTorusMesh();
  const points = mesh.points;
  const pointer = { x: 0, y: 0, active: false };
  let paused = motionPreference.matches;
  let frame = null;
  let previousTime = null;
  let elapsed = 0;
  let width = 0;
  let height = 0;
  let pixelRatio = 1;

  function updateButton() {
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.innerHTML = paused
      ? '<span aria-hidden="true">▷</span> 움직임 켜기'
      : '<span aria-hidden="true">Ⅱ</span> 움직임 멈추기';
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    // Let the form reach past the viewport edges instead of fitting in a column.
    const scale = Math.max(width * 0.43, height * 0.56);
    const centerX = width * (0.54 + Math.sin(elapsed * 0.000035) * 0.025);
    const centerY = height * (0.53 + Math.cos(elapsed * 0.00004) * 0.025);
    const rotation = 0.24 + elapsed * 0.000035;

    // Sparse sky-blue points carry the same atmosphere across the whole screen.
    const ambientCount = Math.min(150, Math.round(width * height / 11000));
    for (let i = 0; i < ambientCount; i += 1) {
      const x = (i * 137.51 + Math.sin(elapsed * 0.00012 + i) * 9 + width) % width;
      const y = (i * 83.73 + Math.cos(elapsed * 0.0001 + i) * 9 + height) % height;
      ctx.fillStyle = 'rgba(83, 174, 225, 0.2)';
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }

    const projected = points.map((point) => {
      const breath = 1 + Math.sin(elapsed * 0.0005 + point.phase) * 0.012;
      return projectPoint({ x: point.x * breath, y: point.y * breath, z: point.z }, rotation, scale, centerX, centerY);
    });

    const connections = pointer.active && !paused
      ? selectSurfaceConnections(mesh, projected, pointer, scale, centerX, centerY)
      : { points: [], edges: [] };

    ctx.lineWidth = 0.65;
    for (const { index, distance } of connections.points) {
      const p = projected[index];
      const alpha = (1 - distance / 105) * 0.35;
      ctx.strokeStyle = `rgba(55, 153, 212, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(pointer.x, pointer.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    for (const [a, b] of connections.edges) {
      ctx.strokeStyle = 'rgba(55, 153, 212, 0.2)';
      ctx.beginPath();
      ctx.moveTo(projected[a].x, projected[a].y);
      ctx.lineTo(projected[b].x, projected[b].y);
      ctx.stroke();
    }

    for (const point of projected.slice().sort((a, b) => a.depth - b.depth)) {
      const depth = (point.depth + 1.5) / 3;
      ctx.fillStyle = `rgba(74, 165, 220, ${0.14 + depth * 0.4})`;
      ctx.beginPath();
      ctx.arc(point.x, point.y, (0.85 + depth * 0.6) * point.perspective, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function tick(time) {
    frame = null;
    if (paused || document.hidden) return;
    if (previousTime !== null) elapsed += Math.min(time - previousTime, 50);
    previousTime = time;
    draw();
    frame = requestAnimationFrame(tick);
  }

  function syncAnimation() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    previousTime = null;
    draw();
    if (!paused && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function resize() {
    const bounds = canvas.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    if (width <= 0 || height <= 120) throw new Error('The geometry canvas requires a visible drawing area.');
    pixelRatio = Math.min(devicePixelRatio, 2);
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    pointer.active = false;
    draw();
  }

  window.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const bounds = canvas.getBoundingClientRect();
    pointer.x = event.clientX - bounds.left;
    pointer.y = event.clientY - bounds.top;
    pointer.active = true;
  });
  document.addEventListener('pointerleave', () => { pointer.active = false; });
  window.addEventListener('pointercancel', () => { pointer.active = false; });
  window.addEventListener('blur', () => { pointer.active = false; });
  motionButton.addEventListener('click', () => {
    paused = !paused;
    updateButton();
    syncAnimation();
  });
  motionPreference.addEventListener('change', (event) => {
    paused = event.matches;
    updateButton();
    syncAnimation();
  });
  document.addEventListener('visibilitychange', syncAnimation);
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(canvas);

  resize();
  updateButton();
  motionButton.hidden = false;
  syncAnimation();
}

try {
  await startGeometry();
} catch (error) {
  errorMessage.textContent = '3D 배경을 불러오지 못했습니다. 페이지를 새로고침해 주세요.';
  errorMessage.hidden = false;
  motionButton.hidden = true;
  throw error;
}
