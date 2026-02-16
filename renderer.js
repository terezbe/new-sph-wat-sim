// ============================================================
// Water Particle Renderer with Metaball Effect
// ============================================================

import { PARTICLE_RADIUS, H } from './sph.js';

const COLOR_SCHEMES = [
  { name: 'Blue',   inner: [30, 144, 255], outer: [0, 60, 180],  glow: [100, 180, 255] },
  { name: 'Cyan',   inner: [0, 230, 230],  outer: [0, 100, 140], glow: [100, 255, 255] },
  { name: 'Lava',   inner: [255, 100, 20], outer: [180, 30, 0],  glow: [255, 180, 60] },
  { name: 'Green',  inner: [30, 220, 80],  outer: [0, 120, 40],  glow: [100, 255, 140] },
  { name: 'Purple', inner: [180, 60, 255], outer: [80, 20, 160], glow: [200, 140, 255] },
];

export class WaterRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.colorIndex = 0;
    this.scheme = COLOR_SCHEMES[0];

    // Offscreen buffer for metaball threshold
    this.offscreen = document.createElement('canvas');
    this.offCtx = this.offscreen.getContext('2d');
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    // Use lower resolution offscreen for performance
    this.offscreen.width = Math.floor(width / 2);
    this.offscreen.height = Math.floor(height / 2);
  }

  cycleColor() {
    this.colorIndex = (this.colorIndex + 1) % COLOR_SCHEMES.length;
    this.scheme = COLOR_SCHEMES[this.colorIndex];
    return this.scheme.name;
  }

  getColorName() {
    return this.scheme.name;
  }

  render(simulation, handLandmarks) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const particles = simulation.particles;

    // Clear main canvas (transparent so webcam shows through)
    ctx.clearRect(0, 0, w, h);

    if (particles.length === 0) return;

    // -- Metaball rendering at half resolution --
    const ow = this.offscreen.width;
    const oh = this.offscreen.height;
    const offCtx = this.offCtx;
    const sx = ow / w;
    const sy = oh / h;

    offCtx.clearRect(0, 0, ow, oh);

    // Draw particle blobs onto offscreen
    const blobRadius = H * 0.6 * sx;
    offCtx.globalCompositeOperation = 'source-over';

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const px = p.x * sx;
      const py = p.y * sy;

      const grad = offCtx.createRadialGradient(px, py, 0, px, py, blobRadius);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.3)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');

      offCtx.fillStyle = grad;
      offCtx.beginPath();
      offCtx.arc(px, py, blobRadius, 0, Math.PI * 2);
      offCtx.fill();
    }

    // Threshold the metaball field via pixel manipulation
    const imageData = offCtx.getImageData(0, 0, ow, oh);
    const data = imageData.data;
    const [ir, ig, ib] = this.scheme.inner;
    const [or_, og, ob] = this.scheme.outer;
    const threshold = 0.35;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3] / 255;
      if (alpha > threshold) {
        const t = Math.min((alpha - threshold) / (1.0 - threshold), 1.0);
        const t2 = t * t;
        data[i]     = Math.floor(or_ + (ir - or_) * t2); // R
        data[i + 1] = Math.floor(og + (ig - og) * t2);   // G
        data[i + 2] = Math.floor(ob + (ib - ob) * t2);   // B
        data[i + 3] = Math.floor(180 + 75 * t);          // A
      } else {
        data[i + 3] = 0;
      }
    }

    offCtx.putImageData(imageData, 0, 0);

    // Draw the metaball result scaled up to full canvas
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(this.offscreen, 0, 0, w, h);

    // -- Highlight / specular pass --
    ctx.globalCompositeOperation = 'screen';
    const [gr, gg, gb] = this.scheme.glow;
    for (let i = 0; i < particles.length; i += 3) { // every 3rd particle for perf
      const p = particles[i];
      const specGrad = ctx.createRadialGradient(
        p.x - 2, p.y - 2, 0,
        p.x, p.y, PARTICLE_RADIUS * 2.5
      );
      specGrad.addColorStop(0, `rgba(${gr}, ${gg}, ${gb}, 0.25)`);
      specGrad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
      ctx.fillStyle = specGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PARTICLE_RADIUS * 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // -- Draw hand landmarks --
    this.drawHandOverlay(ctx, handLandmarks);
  }

  drawHandOverlay(ctx, handLandmarks) {
    if (!handLandmarks || handLandmarks.length === 0) return;

    const w = this.canvas.width;
    const h = this.canvas.height;

    for (const hand of handLandmarks) {
      // Draw connections between landmarks
      const connections = [
        [0,1],[1,2],[2,3],[3,4],       // thumb
        [0,5],[5,6],[6,7],[7,8],       // index
        [0,9],[9,10],[10,11],[11,12],  // middle
        [0,13],[13,14],[14,15],[15,16],// ring
        [0,17],[17,18],[18,19],[19,20],// pinky
        [5,9],[9,13],[13,17],          // palm
      ];

      ctx.strokeStyle = 'rgba(100, 200, 255, 0.5)';
      ctx.lineWidth = 2;

      for (const [a, b] of connections) {
        if (hand[a] && hand[b]) {
          ctx.beginPath();
          ctx.moveTo(hand[a].x * w, hand[a].y * h);
          ctx.lineTo(hand[b].x * w, hand[b].y * h);
          ctx.stroke();
        }
      }

      // Draw landmark dots
      for (let i = 0; i < hand.length; i++) {
        const lm = hand[i];
        if (!lm) continue;
        const x = lm.x * w;
        const y = lm.y * h;
        const r = i === 0 ? 6 : (i % 4 === 0 ? 5 : 3);

        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = i % 4 === 0
          ? 'rgba(255, 255, 255, 0.9)'
          : 'rgba(80, 200, 255, 0.8)';
        ctx.fill();
      }

      // Draw interaction radius around palm and fingertips
      const palmX = hand[9] ? hand[9].x * w : 0;
      const palmY = hand[9] ? hand[9].y * h : 0;
      if (hand[9]) {
        ctx.beginPath();
        ctx.arc(palmX, palmY, 60, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(80, 200, 255, 0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}

export { COLOR_SCHEMES };
