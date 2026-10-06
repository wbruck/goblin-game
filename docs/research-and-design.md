# Goblin Hoard: Research and Design

Date: 2026-10-06
Status: Draft v1, decisions confirmed with the project owner.

## 1. Decisions already made

| Question | Decision |
| --- | --- |
| Growth while away | Real time with offline progress |
| Board | Square grid, 2D top-down |
| Architecture now | Simulation runs in the browser, structured so it can move to a server later |
| Language and stack | TypeScript. Framework chosen by this research (see section 5) |
| Battles with rival hoards | On the same board, autonomous, auto-battler style |
| How the overseer gives goals | Indirect only: place incentives and loot, never direct orders |
| Players | One now, multiplayer later |
| Mobile | Web first, mobile app later |

## 2. What the research says about the "time metric"

### 2.1 What players like

- **Return value.** The strongest motivator in idle games is coming back to find things changed. Pecorella's GDC analysis of Kongregate data puts it as "the longer you're away, the greater your incentive to return," and the moment of return is a "celebratory moment." The return screen is the single most important screen in the game.
- **Progress continues when the tab is closed.** Offline progress is treated as the backbone of the genre. Games that cap it too aggressively or compute it wrong on launch see players uninstall.
- **Meaningful but not dominant offline gains.** Players expect offline gains to matter, but active play must still be the faster route. Common implementations use a 50 percent efficiency for offline time, or exclude certain activities from offline simulation (Clicker Heroes excludes click skills, hero leveling, and purchases).
- **Early pacing that proves the loop.** From a developer who shipped seven idle prototypes: first upgrade within 60 seconds, first automation by 3 minutes, a meaningful decision within 5 minutes, first prestige-style reset within 10 to 15 minutes. Phase transitions every 3 to 5 minutes of active play. Another post puts first reset at 45 to 90 minutes and calls a 10-hour first reset "a death sentence."
- **Revealed layers.** A new system should open roughly as the previous one is mastered. Players quit when all numbers are visible at once ("spreadsheet syndrome").
- **Emergent stories.** This is the colony-sim half of the design. Dwarf Fortress and RimWorld players describe the appeal as surrendering to the simulation and being surprised by it. A goblin who ignores the loot pile and wanders into the enemy camp is content, not a bug, if the game tells the player about it.

### 2.2 What players dislike

- **Pure waiting.** Forcing a player to wait with nothing to do is described as the cardinal sin of the genre. The fix is not to remove time, it is to always have a reachable next goal visible.
- **Dead zones.** Flat linear scaling produces stretches of glacial progress. Growth needs "bumps": milestone multipliers that cause bursts of purchases, then slow parts. Cost scaling around 1.15x per level is the common default.
- **Offline caps that feel like punishment.** Caps are accepted when they are explained and when the cap aligns with a natural rhythm. MergeCiv caps at 12 hours so two check-ins a day capture everything. Another game caps at 8 hours and discards time beyond that. Egg, Inc. caps at 2 hours but compensates with steep prestige math. Caps that silently lose progress or that produce a wrong total on launch cause uninstalls.
- **Opaque offline math.** Players want a breakdown on return: what was gathered, what was built, who died.
- **Overnight disasters.** MergeCiv prevents food from dropping below zero while offline. RimWorld-style games do not, and that is a common complaint. For a hoard, the equivalent is "I came back and everyone starved." The safe rule: offline time can fail to make progress, but it cannot destroy the hoard.

### 2.3 Tick-based versus real-time

Tick-based games (progress in discrete steps on a real-time clock) and real-time games with fixed timesteps are the same thing at different granularity. The research supports a hybrid: the simulation advances in fixed ticks, the renderer runs at display rate, and offline time is paid out as a batch of ticks. Budgeted action points (accrue while away, spend when present) are a known pattern that fits the overseer role well: incentives the overseer can place could be rationed by a slowly refilling budget.

### 2.4 Recommendation: the time model for this game

1. **Fixed simulation tick of 250 ms** (4 ticks per second). Fast enough for movement to look continuous when interpolated, slow enough that an hour offline is 14,400 ticks, which is cheap to replay.
2. **"Effort" as the displayed metric.** Every tick, each goblin that is working produces effort. Effort is what the hoard spends on growth. Effort per tick is the number the player watches go up. Effort is proportional to time, but it scales with hoard size, mood, and how many goblins are actually doing something useful, which is where the "unruly" fantasy lives.
3. **Offline progress by fast-forward simulation, not by formula.** Replay the real simulation at high speed when the player returns. This keeps the board honest (goblins moved, loot was taken, a fight happened) and avoids a second economy model that drifts from the first. Melvor Idle markets "perfect accuracy" from exactly this approach. Keep a formula fallback only for the case where the replay budget is exceeded.
4. **Offline cap of 12 hours of simulated time**, stated in the UI. Beyond 12 hours, time is discarded. Reconsider to 8 or 24 after playtesting.
5. **Offline efficiency.** Simulate offline time with goblins in "cautious" mode: no raids are started, no fights with rival hoards are initiated, and gathering runs at full speed. Rival hoards do not attack during offline time in v1. This gives natural offline gains below active play without an arbitrary 50 percent multiplier, and it keeps the "cannot destroy the hoard" guarantee.
6. **Return report.** On return, show elapsed time, effort earned, hoard growth, notable events (births, deaths, discoveries), and the three funniest things goblins did. This screen is the retention mechanic.
7. **Background tabs.** requestAnimationFrame pauses in background tabs. Do not try to keep simulating with setInterval. Treat a backgrounded tab as offline: record the wall-clock time and catch up on focus using the same code path as a cold start.

## 3. What the research says about the board and the autonomous goblins

### 3.1 Grid representation

- Square grid stored as flat typed arrays (terrain, occupancy, item layer). Index is `y * width + x`. This is the standard for tile games and is what flow-field and A* implementations expect.
- Start with a single map around 48 by 32 tiles. Rival hoard camps sit at the edges. Expand by unlocking regions later rather than by making the whole map large from the start.
- Separate the **simulation grid** (what the sim knows) from the **render grid** (what is drawn). The sim must not depend on the renderer, because the sim will later run on a server.

### 3.2 Pathfinding

- **A\*** per goblin is fine for a few dozen agents and is the simplest to get right. Use it for v1.
- **Flow fields** become the better fit once many goblins share destinations (a loot pile, a war drum, an enemy camp). Fieldrunners 2 used flow fields plus steering to move thousands of agents on mobile. Each incentive the overseer places can own one flow field computed once per change. This maps directly onto the indirect-control design: an incentive is literally a field that pulls goblins. Plan the movement code so a goblin follows a "direction provider" that can be an A\* path today and a flow field later.
- Avoid diagonal corner cutting through walls. Use 8-direction movement with a corner check, or 4-direction movement in v1.

### 3.3 How goblins decide what to do

Three families appear in the literature. Behavior trees are good at sequencing a task once chosen but weak at choosing. GOAP plans multi-step actions toward a goal and is usually used in action games. **Utility AI** scores every available action from several considerations and picks the highest, which the sources describe as producing more lifelike behavior because it weighs competing motivations at the same time. The practical consensus is to combine them: utility to choose, a small state machine or behavior tree to execute.

Colony sims give concrete, player-tested models for the choosing step:

- **RimWorld** ranks work types per colonist, then does all work at a priority before moving to the next, with no regard for travel efficiency. Players find this both legible and infuriating.
- **Oxygen Not Included** chooses by priority level, then sub-priority, then distance. Personal needs (eat, sleep, toilet) override everything unless Red Alert is on.
- **Majesty** and its descendants (Crown of Greed, Lessaria) let the player place bounties and build attractions. Heroes weigh reward against danger and their own temperament, and refuse when the price is wrong. Reviewers describe the result as "power based on patience and calculation, not control" and note that heroes become picky exactly when you need them most, which is the intended tension.
- The design-pattern literature names this **Indirect Control** and warns that it conflicts with **Predictable Consequences**. The game has to compensate with feedback: show why a goblin chose what it chose.

**Recommendation.** Utility AI for choosing, a tiny state machine for executing.

Each goblin has stats: hunger, fatigue, greed, bravery, loyalty, and a mood. Each candidate action (idle, eat, sleep, gather at X, grab loot at Y, follow war drum at Z, pick a fight, wander, steal from the hoard) is scored from:

- the goblin's own needs (hungry goblins score eating high),
- the incentive strength at the target (a bigger loot pile pulls harder, decaying with distance),
- the goblin's temperament (a cowardly goblin discounts fights, a greedy one overweights loot),
- a per-goblin random noise term from a seeded generator, so the hoard does not move as one block.

The overseer never sets priorities directly. The overseer's tools are things in the world: a food pile, a pile of shiny things, a war drum, a totem that calms or enrages, a fence that blocks. Incentives have a cost in effort and decay over time, which rations the player's influence and creates the rhythm of "spend effort to steer, wait to see if they listened."

**Feedback is mandatory.** Every goblin shows a one-word intent above its head, and the event log records refusals with a reason ("Grub ignored the loot: too scared of the ogre camp"). Without this, indirect control reads as bugs.

### 3.4 Battles with rival hoards

Auto-battler research says skill lives in preparation and watching is the payoff. Players report never tiring of watching fights when fights are readable. Lessons that transfer:

- Keep fights short and legible. Small groups, clear hit feedback, a visible outcome.
- Let the player influence fights only through the same indirect tools: a war drum near the enemy, loot bait placed to pull enemies into a chokepoint, a totem that buffs nearby goblins.
- Rival hoards run the same utility AI with different temperaments. A cowardly rival hoard raids when the player's goblins are away. A greedy one takes bait.
- Fights resolve on the grid, tile-adjacent, a few ticks per exchange. No separate battle screen.
- Combat must be deterministic given the seed, so that offline replay and later server authority produce identical results.

### 3.5 Determinism

Everything above depends on the simulation being deterministic: fixed timestep, seeded random numbers, stable iteration order, no reliance on wall-clock time inside the sim. This is the same requirement that makes replays, offline catch-up, debugging, and later server authority possible. Use a small seeded generator (Mulberry32 or PCG32, both widely used in JavaScript) and never call `Math.random` inside the sim. Avoid floating-point accumulation where integer math works; store effort and resources as integers.

## 4. Architecture

```
packages/
  sim/        Pure TypeScript. No DOM. The whole game state and rules.
              Tick function: (state, inputs, rng) -> state.
              Runs in the browser today, on a server later.
  client/     Vite app. Renders sim state to Canvas, collects overseer input,
              saves to localStorage, handles offline catch-up and the
              return report.
```

- The client holds a `World` from `sim`, calls `world.step()` on a fixed-timestep accumulator driven by requestAnimationFrame, and renders with interpolation.
- Inputs from the overseer (place incentive at tile) are queued as commands with the tick they apply on. This is the same shape a server would accept, so moving to server authority later is a transport change, not a rewrite.
- Save format is the serialized `World` plus the wall-clock timestamp. On load, compute elapsed ticks, clamp to the cap, and run the catch-up loop in chunks so the UI stays responsive, then show the return report.
- Multiplayer path: a Colyseus room (the most used TypeScript authoritative server) runs the same `sim` package, clients send commands, and the room broadcasts state deltas. Nothing in `sim` needs to change for that.
- Mobile path: Capacitor wraps the same web build in a native shell. Canvas and WebGL run at WebView speed, which is enough for a 2D tile game, and this is the route Vampire Survivors used. React Native would require rewriting the renderer, so it is not recommended.

## 5. Rendering library choice

| Option | For | Against |
| --- | --- | --- |
| Plain Canvas 2D | Zero dependencies, trivial to understand, fast enough for a 48x32 grid with under 200 sprites, works identically in Capacitor | You write your own sprite batching and camera; no built-in tweening or audio |
| PixiJS v8 | WebGL and WebGPU renderer, very fast batching, good TypeScript, still "just a renderer" so it does not dictate architecture | Another dependency and a learning curve; overkill until sprite counts climb |
| Phaser 4 | Full engine: scenes, sprites, tweens, audio, input. Released April 2026 with a new WebGL renderer | Wants to own the game loop and scene lifecycle, which fights the "sim is independent of renderer" rule; heavier bundle |

**Recommendation.** Start with plain Canvas 2D behind a small `Renderer` interface. The sim is the hard part and the thing that has to be right for offline replay and multiplayer. If sprite counts or effects outgrow Canvas 2D, swap in PixiJS behind the same interface. Phaser is not recommended because the simulation must not live inside an engine's update loop.

For UI chrome (panels, the return report, the event log) use plain DOM with TypeScript. Add a UI framework only if the panels get complicated.

Entity-component libraries (bitECS, Miniplex) were considered. The goblin count in v1 is small and the entity types are few, so plain arrays of typed records are simpler and keep serialization trivial. Revisit if the entity model grows.

## 6. Proposed v1 scope (playable prototype)

1. Grid map with terrain, a hoard cave, a few resource tiles, one rival camp.
2. 5 to 20 goblins with needs, temperament, utility-based action choice, A\* movement.
3. Effort production, hoard growth (new goblins hatch when effort crosses thresholds).
4. Overseer tools: place food pile, place loot pile, place war drum. Each costs effort and decays.
5. One rival hoard running the same AI; tile-adjacent fights.
6. Fixed-timestep loop, seeded random, save and load, offline catch-up with a 12-hour cap and a return report.
7. Event log with reasons for refusals.

## 7. What the scaffold does today and what was measured

The scaffold in `packages/sim` and `packages/client` implements sections 2.4, 3 and 4 at prototype depth: grid, A\*, utility AI with refusals, three incentives (food pile, shiny pile, war drum), effort and hatching, seeded determinism, save and load, offline replay with a 12-hour cap, and the return report. Rival hoards and fighting are not built yet.

Measured on this container with the default map and starting hoard of 6:

| Simulated time | Hoard size | Replay time in Node | Replay time in headless Chromium |
| --- | --- | --- | --- |
| 2 hours | about 43 | 0.8 s | not measured |
| 12 hours (the cap) | about 60 | 6.9 s | 18 s |

The browser figure is the worst case a returning player sees, with a progress bar. It is acceptable for a prototype. If it needs to drop, the options in order of preference are: fewer A\* calls per tick (cache paths, reconsider less often), a coarser offline tick, and only then a formula fallback.

Balance is untuned. Growth over 12 hours is roughly logarithmic because the hatch threshold grows 15 percent per goblin while effort grows linearly with hoard size. That is a reasonable shape for an idle game but the constants were chosen to make the loop visibly work, not to be fun yet. The first thing playtesting should set is the time to the first hatch (currently about 20 seconds) and the time to the tenth.

## 8. Open questions for later

- Prestige or reset loop: does the hoard "migrate" to a new cave with bonuses? Research says a first reset within the first hour is important, so decide before balancing.
- How large can the map get before flow fields are required?
- Whether rival hoards should act during offline time once the player has defenses.
- Art direction and whether a tile set is hand-drawn or generated.

## 9. Sources

Time metric and idle design:

- Clicker Heroes, offline progression design: https://blog.clickerheroes.com/?p=1902
- MergeCiv, how offline earnings are calculated (12-hour cap rationale): https://mergeciv.io/idle-progression
- Monash University, "Playing to Wait: A Taxonomy of Idle Games": https://research.monash.edu/en/publications/playing-to-wait-a-taxonomy-of-idle-games/
- Pecorella, "Idle Games: The Mechanics and Monetization of Self-Playing Games" (GDC): https://gdcvault.com/play/1022066/Idle-Games-The-Mechanics-and
- Pecorella, "The Math of Idle Games, Part III": https://gamedeveloper.com/design/the-math-of-idle-games-part-iii
- "I built 7 idle games in 30 days": https://dev.to/aguier/i-built-7-idle-games-in-30-days-what-i-learned-about-incremental-design-5d3f
- Gamedeveloper, "The Rise of Games You Mostly Don't Play": https://www.gamedeveloper.com/design/the-rise-of-games-you-mostly-don-t-play
- bugnet, how to design an idle or incremental game: https://bugnet.io/blog/how-to-design-an-idle-or-incremental-game
- Tick-based games design pattern: https://www.math.vu.nl/~eliens/multimedia/media/pattern-tick-basedgames.html
- Offline progress implementation approaches (itch.io thread): https://itch.io/post/14654594
- Prestige loop pacing feedback: https://itch.io/t/5446445/feedback-prestige-loop-accelerates-to-endgame-levels-at-3-prestige-points

Indirect control and autonomous agents:

- Indirect Control design pattern: https://math.vu.nl/~eliens/media/pattern-indirectcontrol.html
- Crown of Greed review (Majesty-style indirect control): https://www.galaxus.de/en/page/gold-instead-of-obedience-crown-of-greed-tested-42293
- Lessaria demo, heroes refuse orders: https://gamespace.com/all-articles/news/lessaria-demo-your-majesty-heroes-refuse-to-follow-orders/
- Oxygen Not Included priority system: https://oxygennotincluded.wiki.gg/wiki/Priority
- RimWorld work priorities: https://rimworldwiki.com/wiki/Work
- Dwarf Fortress, "Losing is fun": https://tripharrison.substack.com/p/losing-is-fun
- Utility AI versus behavior trees versus GOAP discussion: https://humor.gamedev.net/forums/topic/709749-over-stuffed-ai-models-in-game-dev
- Comparison of AI models in Unity games (journal article): https://ph.pollub.pl/index.php/jcsi/article/view/6471

Board, pathfinding, battles:

- Flow fields for crowds: https://github.com/Vincent-VD/Flow-Fields-Nav
- Multi-agent pathfinding in games (lecture notes): https://ktiml.mff.cuni.cz/~svancara/files/08MAPF_Games.pdf
- Teamfight Tactics design lessons: https://www.pockettactics.com/teamfight-tactics-design
- What is an auto battler: https://www.pocketgamer.com/real-auto-chess/auto-battler
- Mechabellum, watching auto battles: https://forum.quartertothree.com/t/mechabellum-tactical-autobattler-against-other-people/167835

Engineering:

- Fixed timestep game loop in JavaScript: https://codeincomplete.com/articles/javascript-game-foundations-the-game-loop
- Game loop in TypeScript, basic to advanced: https://dev.to/stormsidali2001/building-a-professional-game-loop-in-typescript-from-basic-to-advanced-implementation-eo8
- Mulberry32 deterministic randomness: https://emanueleferonato.com/?p=15615
- Fixing replay desync (determinism checklist): https://bugnet.io/blog/how-to-fix-a-replay-system-that-desyncs
- Phaser versus PixiJS: https://dev.to/ritza/phaser-vs-pixijs-for-making-2d-games-2j8c
- Phaser 4 released: https://gamedev.net/news/2759-phaser-4-released/
- PixiJS v8 launch: https://pixijs.com/blog/pixi-v8-launches
- bitECS: https://gittrend.io/repo/NateTheGreatt/bitECS
- Miniplex: https://github.com/jure/miniplex
- Capacitor games guide: https://capacitorjs.com/docs/guides/games
- Capacitor versus React Native performance: https://vp0.com/blogs/react-native-vs-capacitor-2026-performance
- Colyseus concepts (authoritative rooms): https://docs.colyseus.io/concepts

Existing goblin-themed idle games (for differentiation):

- Goblin Rift: https://speedincgames.itch.io/goblin-rift
- GoGoGoblins: https://ostsergey.itch.io/gogogoblins
