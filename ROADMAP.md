# Roadmap: the quinn wai tennis sandbox

Draft 8, Saturday 2026-11-14. No open decisions.

A homepage that is a toy. The name "quinn wai" sits on navy, the dots of the i's are tennis balls, and you can hit, carry and throw them.

## Status

- **Live:** https://tennis-theme.vercel.app (Vercel production, public).
- **Milestones 0 and 1: built, and through two rounds of Quinn-Wai's review.** The first made the balls heavier in the hand, redrew them from the reference photo, made them larger and switched the name to Ubuntu. The second made the dots regenerate without limit, added a clear button, and turned the credits link into an icon at bottom left.
- **Milestone 2, the look: first pass done, waiting on review.** Colors come from the towel and ball photos; the ball has one tapering seam line.
- **Milestone 3: partly built.** The contact control and credits page are in. The browser tests are not started.

Add `?tune` to the address for sliders that change the feel live, and `?font=roboto-mono` to see the name in the earlier typeface. To run it on this Mac instead, use `npm run dev` and open http://localhost:5173.

## Decided

- **Page:** this is the homepage. Name centered, lowercase, landscape, desktop first.
- **Feel:** a toy to fiddle with, not a game. No score, no goals.
- **Look:** flat and minimal, icon-like. Navy background. The towel's blue and ball green are for accents only. The ball is a circle with one white seam line, traced from the reference photo, and it is a little larger than the dot the typeface gives the i.
- **Not the look:** app-onboarding clip art (thick outlines, cartoon proportions, mascot energy) and retro arcade (pixel fonts, neon, Pong nostalgia).
- **Lettering:** Ubuntu Bold, on trial. Roboto Mono is still one address change away. A custom typeface comes later.
- **Balls:** the dots of the two i's. Each i is also the can: knock the dot away and a fresh ball rises out of the stem. The i is drawn as a plain letter; the can is in how it behaves, not how it looks. The stem never runs out, so a dot always comes back. A clear button sweeps every ball away. Past about 60 balls on the court, the oldest loose one makes way for each new one. At this ball size nothing drops inside or between the letters, and that is fine.
- **Controls:** click to hit (the ball flies away from the click), hold to carry, let go while moving to throw. A carried ball has weight: it trails the pointer and can only be thrown as fast as it was actually moving.
- **World:** the floor and side walls are solid and the top is open. A ball that leaves through the top falls back in, unless it drifts past the side lines up there, in which case it is gone.
- **Around the edges:** a contact control at bottom right (a "?" in a circle that opens to email, GitHub and LinkedIn) and a credits icon at bottom left, both solid objects that balls bounce off. A clear button at top left. A sound toggle at top right (default on, arriving with sound).
- **Contact links:** quinnwai.wong@gmail.com, https://github.com/quinnwai, https://www.linkedin.com/in/quinn-wai-wong/
- **Where it runs:** public, on Vercel production at https://tennis-theme.vercel.app. The Vercel project is `tennis-theme` under the team `quinnwaiwong-3429s-projects`, deployed with the CLI on Quinn-Wai's Mac.
- **One skin of several:** tennis is the first of several planned skins of the homepage, each in its own repo, later joined under one address. The shared rules are in `../water-theme/SKIN-RULES.md`. Following them, every address in the built site is relative and its files sit in a `tennis/` folder, so the same build works at the root of a domain or under a path such as `/tennis/`.
- **Physics engine:** Planck. In a head-to-head test it matched Rapier on every pass or fail check (bounce height, fast balls against thin outlines, coming to rest, piles) and is about 45 kB to download instead of 1.26 MB.
- **Deadline:** the first draft (milestones 0 to 3) is live by the end of Sunday 2026-11-15.
- **Testing:** Quinn-Wai's own testing and the automated checks judge each version until the page works on phones. The five-friend test comes after that.
- **Who it's for:** friends first, for fun. Possibly a work showcase later.

## Working assumptions

Say no to any of these and the plan changes.

- A click on or right next to a ball counts as a hit from that side.
- Clicks give a fixed pop. A carried ball tops out at 5 m/s, which is also the fastest throw.
- The ball behaves like a real one: 6.7 cm across, real gravity at that scale, air drag, and a regulation bounce (dropped from 254 cm, it rebounds 135 to 147 cm; ours rebounds 141).
- The name is white.
- No sound toggle on screen until there is sound to toggle.
- A click on the middle of a ball sends it straight up. A tap is worth 3 m/s, about 45 cm of height, which keeps a tapped dot on screen.
- An i refills 1.2 seconds after its dot has gone, and only when nothing is sitting on the stem or about to land on it.
- Built as a small static site (Vite and TypeScript, drawn on a canvas), with Playwright for the browser tests.

## Milestones

| # | Milestone | What exists at the end | Build time (rough) |
|---|---|---|---|
| 0 | Feel spike | One ball in a plain box: hit, carry, fling, bounce. Physics engine picked by testing two candidates on the hard cases (a fast ball into a thin letter stroke, a ball at rest in the cup of the "u"). | 1 to 2 h |
| 1 | The name is the level | The name in Roboto Mono with solid letters, dots as balls, the i that refills, the open top, and a window that can resize. | 2 h |
| 2 | The look | Navy, the flat ball with seams that show its spin, the fading white trail, a "pow" burst where a hit lands. | 1 to 2 h |
| 3 | First draft live | Contact control, credits page, automated browser tests, deployed to Vercel. A polite note for phones held upright. | 2 h |
| 4 | Sound | Hit, bounce, the pop of a new can, an "out" call. Sound toggle. | 2 to 4 h |
| 5 | Phone | Landscape layout, touch tuning, a rotate prompt. | 2 to 4 h |
| 6 | Friends test | Cookieless analytics for two numbers, then five people with no instructions. Fix the top three things that tripped them up. | 3 h, plus waiting on people |
| 7 | The scene | A bench with a plaque Easter egg (personal tennis notes), cans by the bench that you can shake balls out of, and a racket. | 4 to 8 h |
| 8 | Your own letters | A custom typeface for the six glyphs: q, u, i, n, w, a. | your drawing time, plus 1 h |

**First draft (milestones 0 to 3): 6 to 8 hours of building, plus three short review passes from Quinn-Wai** (feel, letters, look). The building is the predictable part. The review passes are where time can stretch, because feel and look are judged by eye.

## This weekend

| When | Work | Quinn-Wai's part |
|---|---|---|
| Saturday | Milestone 0, the feel spike. In parallel, an empty shell goes live on Vercel so the public URL exists from day one. Then milestone 1. | Review pass 1: does a hit feel right? Review pass 2: do the letters play well? |
| Sunday | Milestone 2, then the rest of milestone 3: contact control, credits page, and the browser tests run against the live URL. | Review pass 3: the look. |

If time runs short, the note for phones is the first thing cut. The nine checks below are not cut.

After the weekend: sound, then phone, then the friends test.

## The first draft is done when

Checked automatically in a real browser:

1. Clicking under a ball sends it up, and clicking at its bottom left sends it up and to the right. In general the ball leaves along the line from the click through its center.
2. Pressing and holding a ball lets you drag it around.
3. Pressing, moving and letting go throws the ball in the direction of the movement.
4. A hit shows a "pow" burst at the point of contact, and a moving ball leaves a fading white trail.
5. Balls bounce off the floor, the side walls, the letters and each other.
6. The name is clearly readable in a screenshot.
7. The contact control opens, and email, GitHub and LinkedIn each go to the right place in a new tab.
8. The credits page loads from the homepage.
9. All of the above passes against the public Vercel production URL.

## Success

Measured at milestone 6. Five friends, on their own phones or laptops, with no instructions: all five hit a ball within 10 seconds, and at least three are still playing after 30. Two numbers are recorded per visit to check this: seconds until the first hit, and seconds of play.

## Later, not scheduled

- Harder hits from real pressure, on hardware that reports it
- More links and pages
