// ============================================================
// SPH (Smoothed Particle Hydrodynamics) Water Simulation Engine
// ============================================================

// Kernel radius
const H = 35;
const H2 = H * H;
const H4 = H2 * H2;
const H8 = H4 * H4;

// SPH kernel constants (2D)
const POLY6_COEFF = 4.0 / (Math.PI * Math.pow(H, 8));
const SPIKY_GRAD_COEFF = -10.0 / (Math.PI * Math.pow(H, 5));
const VISC_LAP_COEFF = 40.0 / (Math.PI * Math.pow(H, 5));

// Simulation parameters
const REST_DENSITY = 1000;
const GAS_CONSTANT = 2000;
const VISCOSITY = 250;
const PARTICLE_MASS = 65;
const DT = 0.0008;
const DT_MAX = 0.003;
const SUBSTEPS = 4;
const DAMPING = -0.5;
const PARTICLE_RADIUS = 6;

class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.grid = new Map();
  }

  clear() {
    this.grid.clear();
  }

  getKey(x, y) {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return (cx * 73856093) ^ (cy * 19349663);
  }

  insert(particle) {
    const key = this.getKey(particle.x, particle.y);
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key).push(particle);
  }

  getNeighbors(x, y) {
    const neighbors = [];
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const key = ((cx + dx) * 73856093) ^ ((cy + dy) * 19349663);
        const cell = this.grid.get(key);
        if (cell) {
          for (let i = 0; i < cell.length; i++) {
            neighbors.push(cell[i]);
          }
        }
      }
    }
    return neighbors;
  }
}

export class SPHSimulation {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.particles = [];
    this.gravity = { x: 0, y: 400 };
    this.gravityEnabled = true;
    this.spatialHash = new SpatialHash(H);

    // Hand interaction
    this.handForces = []; // {x, y, vx, vy, radius}
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  createParticle(x, y, vx = 0, vy = 0) {
    return {
      x, y,
      vx, vy,
      fx: 0, fy: 0,
      density: 0,
      pressure: 0,
    };
  }

  spawnBlob(cx, cy, count = 200, spread = 80) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * spread;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      const vx = (Math.random() - 0.5) * 50;
      const vy = (Math.random() - 0.5) * 50;
      this.particles.push(this.createParticle(x, y, vx, vy));
    }
  }

  spawnGrid(cx, cy, cols, rows, spacing = 10) {
    const startX = cx - (cols * spacing) / 2;
    const startY = cy - (rows * spacing) / 2;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const x = startX + i * spacing + (Math.random() - 0.5) * 2;
        const y = startY + j * spacing + (Math.random() - 0.5) * 2;
        this.particles.push(this.createParticle(x, y));
      }
    }
  }

  setHandForces(forces) {
    this.handForces = forces;
  }

  computeDensityPressure() {
    const particles = this.particles;
    const hash = this.spatialHash;

    for (let i = 0; i < particles.length; i++) {
      const pi = particles[i];
      pi.density = 0;

      const neighbors = hash.getNeighbors(pi.x, pi.y);
      for (let j = 0; j < neighbors.length; j++) {
        const pj = neighbors[j];
        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const r2 = dx * dx + dy * dy;

        if (r2 < H2) {
          const diff = H2 - r2;
          pi.density += PARTICLE_MASS * POLY6_COEFF * diff * diff * diff;
        }
      }

      pi.pressure = GAS_CONSTANT * (pi.density - REST_DENSITY);
    }
  }

  computeForces() {
    const particles = this.particles;
    const hash = this.spatialHash;
    const gx = this.gravityEnabled ? this.gravity.x : 0;
    const gy = this.gravityEnabled ? this.gravity.y : 0;

    for (let i = 0; i < particles.length; i++) {
      const pi = particles[i];
      let fpx = 0, fpy = 0;
      let fvx = 0, fvy = 0;

      const neighbors = hash.getNeighbors(pi.x, pi.y);
      for (let j = 0; j < neighbors.length; j++) {
        const pj = neighbors[j];
        if (pi === pj) continue;

        const dx = pj.x - pi.x;
        const dy = pj.y - pi.y;
        const r2 = dx * dx + dy * dy;

        if (r2 < H2 && r2 > 0.0001) {
          const r = Math.sqrt(r2);
          const diff = H - r;

          // Pressure force (Spiky kernel gradient)
          const pressureScale = SPIKY_GRAD_COEFF * diff * diff *
            (pi.pressure + pj.pressure) / (2 * pj.density + 0.0001) * PARTICLE_MASS;
          fpx += (dx / r) * pressureScale;
          fpy += (dy / r) * pressureScale;

          // Viscosity force (Viscosity kernel Laplacian)
          const viscScale = VISC_LAP_COEFF * diff * VISCOSITY * PARTICLE_MASS / (pj.density + 0.0001);
          fvx += (pj.vx - pi.vx) * viscScale;
          fvy += (pj.vy - pi.vy) * viscScale;
        }
      }

      // Gravity
      pi.fx = fpx + fvx + gx * pi.density;
      pi.fy = fpy + fvy + gy * pi.density;

      // Hand interaction forces
      for (let h = 0; h < this.handForces.length; h++) {
        const hand = this.handForces[h];
        const hdx = pi.x - hand.x;
        const hdy = pi.y - hand.y;
        const hDist2 = hdx * hdx + hdy * hdy;
        const hRadius = hand.radius || 80;
        const hRadius2 = hRadius * hRadius;

        if (hDist2 < hRadius2 && hDist2 > 1) {
          const hDist = Math.sqrt(hDist2);
          const influence = 1.0 - hDist / hRadius;
          const strength = 8000 * influence * influence;

          // Push particles away from hand center
          pi.fx += (hdx / hDist) * strength * pi.density;
          pi.fy += (hdy / hDist) * strength * pi.density;

          // Drag particles with hand velocity
          const dragStrength = 3000 * influence;
          pi.fx += (hand.vx - pi.vx) * dragStrength;
          pi.fy += (hand.vy - pi.vy) * dragStrength;
        }
      }
    }
  }

  integrate(dt) {
    const particles = this.particles;
    const w = this.width;
    const h = this.height;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // Semi-implicit Euler
      p.vx += dt * p.fx / (p.density + 0.0001);
      p.vy += dt * p.fy / (p.density + 0.0001);

      p.x += dt * p.vx;
      p.y += dt * p.vy;

      // Boundary collisions
      if (p.x < PARTICLE_RADIUS) {
        p.x = PARTICLE_RADIUS;
        p.vx *= DAMPING;
      }
      if (p.x > w - PARTICLE_RADIUS) {
        p.x = w - PARTICLE_RADIUS;
        p.vx *= DAMPING;
      }
      if (p.y < PARTICLE_RADIUS) {
        p.y = PARTICLE_RADIUS;
        p.vy *= DAMPING;
      }
      if (p.y > h - PARTICLE_RADIUS) {
        p.y = h - PARTICLE_RADIUS;
        p.vy *= DAMPING;
      }
    }
  }

  step() {
    const dt = DT;
    for (let s = 0; s < SUBSTEPS; s++) {
      // Rebuild spatial hash
      this.spatialHash.clear();
      for (let i = 0; i < this.particles.length; i++) {
        this.spatialHash.insert(this.particles[i]);
      }

      this.computeDensityPressure();
      this.computeForces();
      this.integrate(dt);
    }
  }

  getParticleCount() {
    return this.particles.length;
  }

  reset() {
    this.particles = [];
  }
}

export { PARTICLE_RADIUS, H };
