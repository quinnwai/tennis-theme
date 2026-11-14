/** Everything tunable about how the ball feels. SI units unless a name says otherwise. */
export const params = {
  // The ball: regulation numbers.
  ballDiameter: 0.067, // m
  gravity: 9.81, // m/s^2
  restitution: 0.78, // with air drag included, a 254 cm drop rebounds about 141 cm: mid regulation range
  friction: 0.6,
  drag: 0.0206, // 1/m; air drag deceleration = drag * speed^2
  rollingResistance: 0.1, // how hard a surface slows a rolling ball; 0.1 stops a 2 m/s roll in about 3 s

  // A tap.
  hitSpeed: 4.5, // m/s
  hitCarryOver: 0.15, // share of the ball's old velocity that survives a hit
  hitReach: 2.5, // a tap within this many ball radii of the center is a hit
  minHitReachPx: 24,
  tapMaxMs: 220,
  tapSlopPx: 6,

  // Carry and fling.
  grabReach: 1.4, // a press within this many ball radii picks the ball up
  minGrabReachPx: 14,
  followRate: 30, // 1/s; how tightly a carried ball tracks the pointer
  maxFling: 14, // m/s
};

export type Params = typeof params;
