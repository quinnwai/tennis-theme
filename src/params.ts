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

  // A finger is blunter than a pointer: it covers the ball it presses and cannot say which pixel it means. So a touch
  // gets bigger floors than the mouse's two above (a phone held sideways draws a ball only about 21 px across, which
  // puts the mouse's floors in charge). A tap within touchMinHitReachPx of a ball's middle hits it, and a press within
  // touchMinGrabReachPx picks it up. 22 is half of the 44 px a fingertip needs to be sure of a target. Both are judged
  // by feel, on a real phone.
  touchMinHitReachPx: 32,
  touchMinGrabReachPx: 22,

  // The bottom edge of a phone's screen is where the system's own swipe-up lives (the home bar): a press there is taken for it,
  // so a ball lying on a floor at the edge cannot be picked up. On a touch screen the floor is lifted by this many px, to keep
  // balls clear of that strip; about 30 clears an iPhone's, and Quinn-Wai chose that on seeing it (QWW-83). A laptop has no such
  // strip and is not lifted, whatever this says. Judged by feel, on a phone.
  floorLiftPx: 30,

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
  // can be, so theirs only turn it down. The two from freesound are quieter to begin with. All judged by ear; Quinn-Wai asked for them halved on 2026-11-22 (still too loud).
  // These four are before the sound button's level (soundGain) is applied.
  soundHit: 0.25,
  soundBounce: 0.125, // a bounce at full speed (see soundBounceFullSpeed); slower impacts are quieter. Bounces are far more frequent than the rest
  soundRising: 0.25, // a fresh ball rising out of an "i"
  soundApplause: 0.75, // a point's applause (QWW-102)
  soundZipper: 0.07, // the bag's zip, as the pull moves (QWW-109); matches a full-speed bounce to the ear
  soundPaper: 0.25, // the notebook opening (QWW-109); the file is 6.2 dB under the bounce's, so twice soundBounce matches it
  cheerVolume: 0.95, // the win's cheer (QWW-104), Quinn-Wai's own
  cheerFxVolume: 0.3, // the cheer's second layer, 0.5 s after it (QWW-117), Quinn-Wai's own
  soundOut: 0.5, // a ball leaving past the side lines
  soundBounceMinSpeed: 0.5, // m/s; a gentler impact than this makes no sound, which keeps a settling or resting ball quiet
  soundBounceFullSpeed: 5, // m/s; an impact this fast plays the bounce at full volume; 5 is the fastest a throw goes
  soundMaxVoices: 4, // the most sounds playing at once, not counting the kept sounds (hit, applause, cheer, a can's pop, ...), which are never cut short; past that, the oldest give way
  soundGain: 0.15, // everything plays at this share of the volumes above (about -16.5 dB), which is the whole of "on"; the sound button only chooses between this and mute

  // The buttons in the corners are icons with no circle (but for the "?"), all one tone and one size. The tone runs from the page's navy
  // (0, which fades them away) to white (1); a button turns fully white under the pointer. The size is the icon's width
  // and height in px: the first draft's were 18, so 36 is twice that. Both are judged by eye. The stylesheet starts from
  // the same numbers, so the buttons are right before the script runs (a unit test checks that they agree).
  iconTone: 0.25,
  rowTone: 0.15, // the top-right row (credits, clear, sound) is not solid, so it is drawn fainter than the "?", which is; same scale as iconTone; needs Quinn-Wai's call, judged by eye
  iconSize: 36, // px; the biggest the icons get, as on a laptop
  // On a short window the icons are smaller, by this share of the window's shorter side (and never below 20 px). A phone
  // held sideways is only about 280 px tall in iOS 26's Safari, with its two rows of toolbar, and 36 px icons crowd it:
  // this makes them 28 px there. Judged by eye, on a phone. (The stylesheet starts from the same two numbers.)
  iconShare: 0.1,

  // The cans of balls (Quinn-Wai's controls spec). A can holds 3 balls. Drag moves a can and a tap acts on it: a press that moves more
  // than canTapPx is a drag, one that lets go within canTapMs without moving is a tap (it pours the can, or wiggles it if it is empty).
  // A press lands on a ball if one is within canBallReachPx of its edge, else on a can if its outline is within canReachPx. Judged by feel.
  canTapMs: 450,
  canTapPx: 8,
  canBallReachPx: 16,
  canReachPx: 14,

  // Scoring (QWW-99). A ball let go at least throwSpeed m/s was thrown, slower it was only dropped. A throw scores when it goes into a can
  // that is at least shotDistance of the window's width from where it was let go, in a straight line in any direction. A can leaning
  // further than refillTilt degrees (lying flat or upside down) takes no balls. mouthGrace widens a can's mouth, in balls' radii, so a
  // ball clipping the rim rolls in. Quinn-Wai's, from the playtests of the prototype.
  throwSpeed: 0.8,
  shotDistance: 1 / 5,
  refillTilt: 89,
  mouthGrace: 0.3,

  // The v6 scene (the bench, towel, bag and racquet; see src/v6). Its sizes are real and not tunable. These are its motion and its
  // light touch on the toy; all judged by eye, on the live site.
  zipMs: 520, // ms for the zip to run all the way by itself (a key press, restart, the last stretch after a drag)
  zipSnap: 0.85, // let go past this far along the zip and it runs on to the end
  riseMs: 580, // ms for each can, and the notebook, to rise in the open bag, with a slight spring
  riseStaggerMs: 80, // ms between one can starting to rise and the next
  riseNotebookMs: 260, // ms after the bag opens that the notebook starts to rise
  sinkMs: 320, // ms for what is in the bag to sink back when it closes
  notebookLiftMs: 450, // ms for the notebook to lift out of the bag toward the middle
  notebookSpreadMs: 250, // ms for it to open out into its two pages
  notebookBlur: 5, // px; how blurred the toy is behind the open notebook (the credits' are 10)
  notebookVeil: 0.3, // how far a navy veil dims the toy behind the open notebook, 0 to 1 (the credits' is 0.65)
  benchEndRestitution: 0.1, // how much of its speed a ball keeps off the bench's ends (its seat keeps the usual bounce, `restitution`)
  ballShadows: 1, // 1 draws each ball's shadow on the bench and the bag; 0 leaves them out (they cost a little at every frame)
};

export type Params = typeof params;
