/** Everything tunable about how the toy feels and looks. SI units unless a name says otherwise. */
export const params = {
  // The ball: regulation numbers.
  ballDiameter: 0.067, // m
  gravity: 9.81, // m/s^2
  restitution: 0.78, // with air drag included, a 254 cm drop rebounds about 141 cm: mid regulation range
  friction: 0.6,
  drag: 0.0206, // 1/m; air drag deceleration = drag * speed^2
  rollingResistance: 0.1, // how hard a surface slows a rolling ball; 0.1 stops a 2 m/s roll in about 3 s

  // On the page, a ball is drawn this many times wider than the dot the typeface gives the "i".
  ballScale: 1.15,

  // A tap.
  hitSpeed: 3.0, // m/s; lifts a ball about 45 cm, which keeps a tapped dot on screen
  hitCarryOver: 0.15, // share of the ball's old velocity that survives a hit
  hitReach: 2.5, // a tap within this many ball radii of the center is a hit
  minHitReachPx: 24,
  tapMaxMs: 220,
  tapSlopPx: 6,

  // Carry and throw. A carried ball has weight: it trails the pointer, and it can only be
  // thrown as fast as it was actually moving when let go.
  grabReach: 1.4, // a press within this many ball radii picks the ball up
  minGrabReachPx: 14,
  followRate: 14, // 1/s; how quickly a carried ball closes the gap to the pointer
  carrySpeed: 5, // m/s; the fastest a carried ball moves, and so the fastest throw

  // The credits, which open over the toy: how blurred the toy is behind the text, and how far a coat of
  // navy dims it so the white text reads. Both are judged by eye; the browser tests insist the white text
  // keeps a contrast of 4.5 against the brightest thing behind it (the blurred name), which is why 0.65.
  creditsBlur: 10, // px
  creditsDim: 0.65, // 0 leaves the toy as it is, 1 hides it
};

export type Params = typeof params;
