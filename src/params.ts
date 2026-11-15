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
  followRate: 36, // 1/s; how quickly a carried ball closes the gap to the pointer. A drag at 1000 px/s trails the pointer by under one ball width; at 14 it was nearly two
  carrySpeed: 5, // m/s; the fastest a carried ball moves, and so the fastest throw

  // The credits, which open over the toy: how blurred the toy is behind the text, and how far a coat of
  // navy dims it so the white text reads. Both are judged by eye; the browser tests insist the white text
  // keeps a contrast of 4.5 against the brightest thing behind it (the blurred name), which is why 0.65.
  creditsBlur: 10, // px
  creditsDim: 0.65, // 0 leaves the toy as it is, 1 hides it

  // The trail of a ball in flight: a band of white chips that breaks up behind it. Sizes are in ball widths.
  // These and the poof's numbers are Quinn-Wai's, set on the ?tune sliders: smaller than the first draft's,
  // so the effects go with the ball rather than crowd it.
  trailWidth: 0.7, // how wide the band is
  trailPiece: 0.35, // how big the chips it is made of are, on average
  trailShrink: 1.5, // how fast chips shrink as they age; higher shrinks them sooner
  trailScatter: 0.4, // how far chips drift off the band over their life
  trailLifetime: 0.4, // s; after this long every chip is gone
  trailOpacity: 0.75, // how solid the white of the trail and the poof is; 1 would merge with the white letters where a ball crosses the name

  // The poof where a ball is hit: a starburst of the same chips, which flies outward and breaks up.
  poofSize: 0.5, // how far its points reach, in ball widths
  poofLifetime: 0.2, // s; after this long every chip is gone

  // Sound. A volume of 1 plays a file as loud as it is, and the two from Pixabay are already as loud as a file
  // can be, so theirs only turn it down. The two from freesound are quieter to begin with. All judged by ear.
  soundHit: 0.5,
  soundBounce: 0.5, // a bounce at full speed (see soundBounceFullSpeed); slower impacts are quieter
  soundRising: 0.7, // a fresh ball rising out of an "i"
  soundOut: 1, // a ball leaving past the side lines
  soundBounceMinSpeed: 0.5, // m/s; a gentler impact than this makes no sound, which keeps a settling or resting ball quiet
  soundBounceFullSpeed: 5, // m/s; an impact this fast plays the bounce at full volume; 5 is the fastest a throw goes
  soundMaxVoices: 8, // the most sounds playing at once; past that, the oldest give way

  // The buttons in the corners are bare icons: no circle, all one tone and one size. The tone runs from the page's navy
  // (0, which fades them away) to white (1); a button turns fully white under the pointer. The size is the icon's width
  // and height in px: the first draft's were 18, so 36 is twice that. Both are judged by eye. The stylesheet starts from
  // the same two numbers, so the buttons are right before the script runs (a unit test checks that they agree).
  iconTone: 0.25,
  iconSize: 36, // px
};

export type Params = typeof params;
