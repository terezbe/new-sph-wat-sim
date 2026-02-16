// ============================================================
// Main Application - SPH Water Sim + MediaPipe Hand Tracking
// ============================================================

import { SPHSimulation } from './sph.js';
import { WaterRenderer } from './renderer.js';
import { HandTracker } from './handtracker.js';

// DOM elements
const canvas = document.getElementById('simCanvas');
const video = document.getElementById('webcam');
const statsEl = document.getElementById('stats');
const loadingEl = document.getElementById('loading');
const btnGravity = document.getElementById('btnGravity');
const btnColor = document.getElementById('btnColor');

// State
let sim, renderer, tracker;
let lastTime = performance.now();
let frameCount = 0;
let fps = 0;
let fpsAccum = 0;
let fpsTimer = 0;
let running = true;

// Initialize
async function init() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // Create simulation
  sim = new SPHSimulation(w, h);

  // Create renderer
  renderer = new WaterRenderer(canvas);
  renderer.resize(w, h);

  // Spawn initial water blobs
  sim.spawnBlob(w * 0.3, h * 0.3, 250, 100);
  sim.spawnBlob(w * 0.7, h * 0.5, 250, 100);

  // Create hand tracker
  tracker = new HandTracker();

  try {
    await tracker.init(video, w, h);
    loadingEl.style.display = 'none';
  } catch (err) {
    console.warn('Hand tracking failed to initialize:', err);
    loadingEl.innerHTML = `
      <div style="color:#ffa; font-size:16px; max-width:400px;">
        Camera/hand tracking unavailable.<br>
        <small style="opacity:0.7">You can still interact with mouse/touch.</small>
        <br><br>
        <small style="opacity:0.5">${err.message}</small>
      </div>
    `;
    setTimeout(() => { loadingEl.style.display = 'none'; }, 4000);
  }

  // Mouse/touch fallback interaction
  setupMouseInteraction();

  // Handle resize
  window.addEventListener('resize', onResize);

  // Start game loop
  requestAnimationFrame(gameLoop);
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  sim.resize(w, h);
  renderer.resize(w, h);
  if (tracker) tracker.resize(w, h);
}

// Mouse / touch interaction as fallback
let mouseForce = null;
let prevMouse = null;

function setupMouseInteraction() {
  canvas.addEventListener('pointerdown', (e) => {
    prevMouse = { x: e.clientX, y: e.clientY, t: performance.now() };
    mouseForce = { x: e.clientX, y: e.clientY, vx: 0, vy: 0, radius: 80 };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (mouseForce) {
      const now = performance.now();
      const dt = (now - prevMouse.t) / 1000;
      if (dt > 0) {
        mouseForce.vx = mouseForce.vx * 0.5 + ((e.clientX - prevMouse.x) / dt) * 0.5;
        mouseForce.vy = mouseForce.vy * 0.5 + ((e.clientY - prevMouse.y) / dt) * 0.5;
      }
      mouseForce.x = e.clientX;
      mouseForce.y = e.clientY;
      prevMouse = { x: e.clientX, y: e.clientY, t: now };
    }
  });

  canvas.addEventListener('pointerup', () => { mouseForce = null; prevMouse = null; });
  canvas.addEventListener('pointerleave', () => { mouseForce = null; prevMouse = null; });

  // Double-click to spawn blob at cursor
  canvas.addEventListener('dblclick', (e) => {
    sim.spawnBlob(e.clientX, e.clientY, 100, 50);
  });
}

// Game loop
function gameLoop(timestamp) {
  if (!running) return;

  const dt = timestamp - lastTime;
  lastTime = timestamp;

  // Collect forces from hand tracker + mouse
  const forces = [];
  if (tracker) {
    const handForces = tracker.getHandForces();
    for (const f of handForces) forces.push(f);
  }
  if (mouseForce) {
    forces.push(mouseForce);
  }
  sim.setHandForces(forces);

  // Step physics
  sim.step();

  // Render
  renderer.render(sim, tracker ? tracker.getLandmarks() : []);

  // FPS counter
  frameCount++;
  fpsTimer += dt;
  if (fpsTimer >= 1000) {
    fps = frameCount;
    frameCount = 0;
    fpsTimer = 0;
  }

  // Update stats
  const handCount = tracker ? tracker.getLandmarks().length : 0;
  statsEl.textContent =
    `${sim.getParticleCount()} particles | ${fps} fps | ${handCount} hand${handCount !== 1 ? 's' : ''} detected`;

  requestAnimationFrame(gameLoop);
}

// UI callbacks (attached to window for inline onclick)
window.toggleGravity = function () {
  sim.gravityEnabled = !sim.gravityEnabled;
  btnGravity.textContent = `Gravity: ${sim.gravityEnabled ? 'ON' : 'OFF'}`;
  btnGravity.classList.toggle('active', sim.gravityEnabled);
};

window.spawnBlob = function () {
  const x = Math.random() * window.innerWidth * 0.6 + window.innerWidth * 0.2;
  const y = Math.random() * window.innerHeight * 0.4 + 50;
  sim.spawnBlob(x, y, 150, 70);
};

window.resetSim = function () {
  sim.reset();
  sim.spawnBlob(window.innerWidth * 0.5, window.innerHeight * 0.3, 300, 100);
};

window.cycleColor = function () {
  const name = renderer.cycleColor();
  btnColor.textContent = `Color: ${name}`;
};

// Start
init();
