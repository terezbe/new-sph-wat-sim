// ============================================================
// MediaPipe Hands Integration for Hand Tracking
// ============================================================

export class HandTracker {
  constructor() {
    this.hands = null;
    this.camera = null;
    this.landmarks = [];   // normalized [0..1] landmarks per hand
    this.handForces = [];  // computed forces for simulation
    this.prevPositions = new Map(); // for velocity tracking
    this.ready = false;
    this.videoElement = null;
    this.canvasWidth = 0;
    this.canvasHeight = 0;
  }

  async init(videoElement, canvasWidth, canvasHeight) {
    this.videoElement = videoElement;
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    // Load MediaPipe Hands via CDN
    const { Hands } = await this.loadMediaPipe();

    this.hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    this.hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5,
    });

    this.hands.onResults((results) => this.onResults(results));

    // Start webcam
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 1280, height: 720 },
    });
    videoElement.srcObject = stream;
    await videoElement.play();

    this.ready = true;
    this.startProcessing();
  }

  async loadMediaPipe() {
    // Dynamically load MediaPipe scripts
    await this.loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js');
    await this.loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');

    // Access globals set by the scripts
    return { Hands: window.Hands };
  }

  loadScript(src) {
    return new Promise((resolve, reject) => {
      // Check if already loaded
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) { resolve(); return; }

      const script = document.createElement('script');
      script.src = src;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  startProcessing() {
    const processFrame = async () => {
      if (this.videoElement && this.videoElement.readyState >= 2) {
        await this.hands.send({ image: this.videoElement });
      }
      requestAnimationFrame(processFrame);
    };
    processFrame();
  }

  onResults(results) {
    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      this.landmarks = results.multiHandLandmarks;
      this.computeHandForces();
    } else {
      this.landmarks = [];
      this.handForces = [];
    }
  }

  resize(width, height) {
    this.canvasWidth = width;
    this.canvasHeight = height;
  }

  computeHandForces() {
    const forces = [];
    const now = performance.now();
    const w = this.canvasWidth;
    const h = this.canvasHeight;

    for (let hi = 0; hi < this.landmarks.length; hi++) {
      const hand = this.landmarks[hi];

      // Key interaction points: palm center, fingertips
      const interactionPoints = [
        { idx: 9, radius: 70, weight: 1.0 },    // palm center (middle finger base)
        { idx: 8, radius: 40, weight: 0.7 },     // index fingertip
        { idx: 12, radius: 40, weight: 0.6 },    // middle fingertip
        { idx: 4, radius: 35, weight: 0.5 },     // thumb tip
        { idx: 20, radius: 35, weight: 0.4 },    // pinky tip
      ];

      for (const point of interactionPoints) {
        const lm = hand[point.idx];
        if (!lm) continue;

        // MediaPipe gives normalized coords (0-1), mirrored
        // We mirror x since webcam is mirrored
        const x = (1.0 - lm.x) * w;
        const y = lm.y * h;

        const key = `${hi}_${point.idx}`;
        const prev = this.prevPositions.get(key);

        let vx = 0, vy = 0;
        if (prev) {
          const dt = (now - prev.t) / 1000;
          if (dt > 0 && dt < 0.2) {
            vx = (x - prev.x) / dt;
            vy = (y - prev.y) / dt;
            // Smooth velocity
            vx = prev.vx * 0.5 + vx * 0.5;
            vy = prev.vy * 0.5 + vy * 0.5;
          }
        }

        this.prevPositions.set(key, { x, y, t: now, vx, vy });

        forces.push({
          x, y,
          vx: vx * point.weight,
          vy: vy * point.weight,
          radius: point.radius,
        });
      }
    }

    this.handForces = forces;
  }

  getHandForces() {
    return this.handForces;
  }

  getLandmarks() {
    return this.landmarks;
  }

  isReady() {
    return this.ready;
  }
}
