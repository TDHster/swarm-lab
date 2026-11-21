// The Millennium Bridge (London, 2000): pedestrians and the deck lock into one rhythm.
// Model: Strogatz, Abrams, McRobie, Eckhardt, Ott, "Crowd synchrony on the Millennium Bridge", Nature 438 (2005).
// No DOM here (runs in Node too).
//
// The deck's lateral mode is a damped spring:  M·X'' + 2ζΩM·X' + Ω²M·X = G·Σ sin θᵢ
// (every walker pushes sideways with force G·sin θ, θ - the phase of their side-to-side sway, one sway = two steps).
// A walker who feels the deck swing adjusts the gait to it:  θᵢ' = Ωᵢ + C·A·sin(Ψ − θᵢ + α),
// where the deck moves as X = A·sin Ψ. Small crowd: pushes cancel out, the deck stays still. Above a critical
// crowd the deck starts swinging, swinging brings walkers into step, and walkers in step swing it harder.

const BRIDGE = {
  M: 113000,              // modal mass of the span, kg
  OMEGA: 2 * Math.PI * 1.03, // the lateral mode, rad/s (1.03 Hz on the real bridge)
  G: 30,                  // sideways force of one walker, N
  ALPHA: Math.PI / 2,
  WALK_HZ: 1.0,           // average sway frequency of the walkers (half the step frequency)
  LENGTH: 144,            // the central span, m
};

class Bridge {
  // params: { count, zeta (damping ratio), C (sensitivity, 1/(m·s)), sigma (spread of walkers' frequencies, Hz) }
  constructor(params, rng) {
    this.p = params;
    this.rng = rng;
    this.X = 0;
    this.V = 0;
    this.t = 0;
    this.theta = [];
    this.omega = [];
    this.pos = [];   // along the span, m (only for drawing)
    this.side = [];  // across the deck, -1..1 (only for drawing)
    this.setCount(params.count);
  }

  gauss() { // Box-Muller
    return Math.sqrt(-2 * Math.log(1 - this.rng())) * Math.cos(2 * Math.PI * this.rng());
  }

  setCount(n) {
    while (this.theta.length < n) {
      this.theta.push(this.rng() * 2 * Math.PI);
      this.omega.push(2 * Math.PI * (BRIDGE.WALK_HZ + this.p.sigma * this.gauss()));
      this.pos.push(this.rng() * BRIDGE.LENGTH);
      this.side.push(this.rng() * 2 - 1);
    }
    this.theta.length = this.omega.length = this.pos.length = this.side.length = n;
    this.p.count = n;
  }

  // New spread of walking frequencies: everyone's own frequency is drawn again.
  setSigma(sigma) {
    this.p.sigma = sigma;
    for (let i = 0; i < this.omega.length; i++) this.omega[i] = 2 * Math.PI * (BRIDGE.WALK_HZ + sigma * this.gauss());
  }

  // Deck amplitude and phase from X = A sin Ψ, X' = A Ω cos Ψ.
  get A() { return Math.hypot(this.X, this.V / BRIDGE.OMEGA); }
  get psi() { return Math.atan2(this.X, this.V / BRIDGE.OMEGA); }

  step(dt) {
    const { M, OMEGA, G, ALPHA } = BRIDGE, n = this.theta.length, C = this.p.C;
    let force = 0;
    for (let i = 0; i < n; i++) force += Math.sin(this.theta[i]);
    force *= G;
    // Semi-implicit Euler: stable for a spring with this step.
    this.V += dt * (force / M - 2 * this.p.zeta * OMEGA * this.V - OMEGA * OMEGA * this.X);
    this.X += dt * this.V;
    const A = this.A, psi = this.psi;
    for (let i = 0; i < n; i++) {
      this.theta[i] += dt * (this.omega[i] + C * A * Math.sin(psi - this.theta[i] + ALPHA));
      this.pos[i] = (this.pos[i] + dt * 1.3) % BRIDGE.LENGTH;   // walking at 1.3 m/s
    }
    this.t += dt;
  }

  // Share of walkers in step: |average of e^(iθ)|.
  order() {
    let c = 0, s = 0;
    for (const th of this.theta) { c += Math.cos(th); s += Math.sin(th); }
    return this.theta.length ? Math.hypot(c, s) / this.theta.length : 0;
  }
}

// Critical crowd (linear stability, as in the paper): the in-step part of the crowd pushes with G·N·π·P(Ω)·C·A/2,
// damping resists with 2ζΩ²M·A, so N_c = 4ζΩ²M / (π G C P(Ω)); P - density of walkers' frequencies at the deck's (per rad/s).
function criticalCrowd(p) {
  const sig = 2 * Math.PI * p.sigma, d = BRIDGE.OMEGA - 2 * Math.PI * BRIDGE.WALK_HZ;
  const P = Math.exp(-d * d / (2 * sig * sig)) / (Math.sqrt(2 * Math.PI) * sig);
  return 4 * p.zeta * BRIDGE.OMEGA * BRIDGE.OMEGA * BRIDGE.M / (Math.PI * BRIDGE.G * p.C * P);
}

if (typeof module !== 'undefined') module.exports = { BRIDGE, Bridge, criticalCrowd };
