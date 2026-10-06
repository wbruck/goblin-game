# Goblin Hoard: Research and Design

Date: 2026-10-06
Status: Draft v1, decisions confirmed with the project owner.

## 1. Decisions already made

| Question | Decision |
| --- | --- |
| Time model | Play forward at accelerated speed, bank up to 12 hours of game time, server reconciles later. No idle time. (Revised; see section 2.) |
| Board | Square grid, 2D top-down |
| Architecture now | Simulation runs in the browser, structured so it can move to a server later |
| Language and stack | TypeScript. Framework chosen by this research (see section 5) |
| Battles with rival hoards | On the same board, autonomous, auto-battler style |
| How the overseer gives goals | Indirect only: place incentives and loot, never direct orders |
| Players | One now, multiplayer later |
| Mobile | Web first, mobile app later |

## 2. The time model: play forward, then reconcile

### 2.1 Decision (revised 2026-10-06)

This is not an idle game. The player plays actively, on their own screen, at an accelerated rate. Each session banks up to 12 hours of game time worth of moves. Later, an authoritative server (not built yet) replays those moves together with other players' moves and world events, and the result may differ from what the player saw. The player then sees what actually happened.

Until the server exists, the player simply plays in the browser with no idle time. Nothing happens while the tab is closed. What must hold from day one is that every session is recorded and replayable.

Consequences:

- **Local play is a prediction.** The browser runs the real simulation and shows the player the most likely outcome of their moves. The server's replay is the truth.
- **"Moves" are inputs, not outcomes.** The overseer places incentives. Each placement is a command stamped with the tick it applied on. The command log is the session.
- **The 12-hour bank is game time, not wall time.** At 4 ticks per second, 12 hours is 172,800 ticks. Played at 16x that is 45 minutes of screen time, at 64x about 11 minutes.
- **The return moment becomes the reconciliation moment.** The retention screen is no longer "look what grew while you were away" but "here is where reality diverged from your plan": which incentives other hoards subverted, which goblins defected, what events struck. The research on return screens still applies to its shape (clear breakdown, named goblins, nothing hidden) even though the trigger is different.

### 2.2 What still carries over from the idle-game research

- **Early pacing that proves the loop.** First visible decision within a minute, a meaningful choice within 5 minutes. Accelerated play makes this easier to hit.
- **Revealed layers** and **no dead zones** apply unchanged to how the hoard grows.
- **Nothing silent.** Players uninstall when progress is lost or recomputed without explanation. In this model the equivalent failure is a server replay that differs from local play with no account of why. Every divergence must be attributable to a named cause (another player's move, an event, a goblin's temperament roll).
- **The hoard cannot be destroyed without the player present.** Reinterpreted: the server may subvert moves, but the reconciliation should never wipe a hoard outright. Losses must be bounded per segment.

What does not carry over: offline progress rates, offline caps as a daily rhythm, and catch-up by fast forward on return. Those sections were removed from this document.

### 2.3 Recording and replay

Replayability comes from three things, none of which is how a goblin is stored:

1. **A deterministic step function.** Fixed tick, no wall clock inside the sim, stable iteration order, all randomness from a seeded generator, integer state where arithmetic could otherwise drift.
2. **A seed.**
3. **An ordered, tick-stamped input log.** Every command, with the tick it was applied on.

Given those three, the state of every goblin at every tick is reproducible from nothing else. Goblin storage is therefore an optimization for two other jobs: loading a saved game quickly (a snapshot so the client does not replay 172,800 ticks on every page load) and proving that two machines agree (a checksum).

Design:

- `World` keeps `history`, the list of applied commands with their ticks, and `seed`. `World.replay(seed, history, toTick)` rebuilds a world from scratch. A unit test asserts that a replayed world is byte-identical to the live one.
- A save is seed, history, and a snapshot. On load the snapshot is used; the history is kept so the session can be verified or submitted.
- `World.checksum()` hashes a canonical integer encoding of the state. The client can record a checksum every N ticks alongside the log. When the server exists, mismatching checksums pinpoint the first tick where the replay diverged from what the player saw.
- Goblin numeric fields are integers: hunger, energy and mood in hundredths (0 to 10,000; mood from -10,000 to 10,000), temperament traits 0 to 255. This is the change that makes a server in any language able to match the browser bit for bit.

### 2.4 Why not pack each goblin into a hex value

Bit-packing (for example 8 bits of hunger, 8 of energy, 4 of action, and so on in one 64-bit number) was considered. It is not recommended as the primary representation:

- It does not help replayability. Replay needs the input log and determinism, which are independent of the storage format.
- It costs debuggability. Every save file, log line and bug report becomes unreadable without a decoder, and a field that grows past its bit width is a silent corruption.
- The compactness is available without it. A fixed-order array of 32-bit integers per goblin (the "record" the checksum uses) is already compact, byte-exact, trivially hashable, and converts to a binary blob with `Int32Array` when network transfer or storage size matters.
- Where bit flags do fit: once goblins carry many booleans (is wounded, is a chief, has a grudge), pack those into a single `flags` integer. Packing numeric ranges into bit fields is not worth it.

### 2.5 Tick and speed

- Fixed simulation tick of 250 ms of game time. The client advances the world from an accumulator and can run at 1x, 4x, 16x or 64x game speed. Speed only changes how many ticks run per frame; it never changes the simulation.
- Background tabs pause. There is no catch-up, because there is no offline time in this model.
- When the bank reaches 12 hours of game time the client stops advancing and shows the segment summary. In the full game this is where the session would be submitted. For now the player starts the next segment immediately.

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
- Combat must be deterministic given the seed, so that the server's replay and the player's local play produce identical results unless another input intervened.

### 3.5 Determinism

Everything above depends on the simulation being deterministic: fixed timestep, seeded random numbers, stable iteration order, no reliance on wall-clock time inside the sim. This is the same requirement that makes replays, save verification, debugging, and later server authority possible. Use a small seeded generator (Mulberry32 or PCG32, both widely used in JavaScript) and never call `Math.random` inside the sim. Avoid floating-point accumulation where integer math works; store effort and resources as integers.

## 4. Architecture

```
packages/
  sim/        Pure TypeScript. No DOM. The whole game state and rules.
              Tick function: (state, inputs, rng) -> state.
              Runs in the browser today, on a server later.
  client/     Vite app. Renders sim state to Canvas, collects overseer input,
              runs the sim at the chosen speed, saves seed + history +
              snapshot to localStorage, shows the segment summary.
```

- The client holds a `World` from `sim`, calls `world.step()` on a fixed-timestep accumulator driven by requestAnimationFrame, and renders with interpolation.
- Inputs from the overseer (place incentive at tile) are queued as commands with the tick they apply on. This is the same shape a server would accept, so moving to server authority later is a transport change, not a rewrite.
- Save format is seed, command history and a snapshot of the `World`. On load the snapshot is restored directly; the history is kept so the segment can be verified by replay or submitted to a server later.
- Multiplayer path: a Colyseus room (the most used TypeScript authoritative server) runs the same `sim` package, clients send commands, and the room broadcasts state deltas. Nothing in `sim` needs to change for that.
- Mobile path: Capacitor wraps the same web build in a native shell. Canvas and WebGL run at WebView speed, which is enough for a 2D tile game, and this is the route Vampire Survivors used. React Native would require rewriting the renderer, so it is not recommended.

## 5. Rendering library choice

| Option | For | Against |
| --- | --- | --- |
| Plain Canvas 2D | Zero dependencies, trivial to understand, fast enough for a 48x32 grid with under 200 sprites, works identically in Capacitor | You write your own sprite batching and camera; no built-in tweening or audio |
| PixiJS v8 | WebGL and WebGPU renderer, very fast batching, good TypeScript, still "just a renderer" so it does not dictate architecture | Another dependency and a learning curve; overkill until sprite counts climb |
| Phaser 4 | Full engine: scenes, sprites, tweens, audio, input. Released April 2026 with a new WebGL renderer | Wants to own the game loop and scene lifecycle, which fights the "sim is independent of renderer" rule; heavier bundle |

**Recommendation.** Start with plain Canvas 2D behind a small `Renderer` interface. The sim is the hard part and the thing that has to be right for replay and multiplayer. If sprite counts or effects outgrow Canvas 2D, swap in PixiJS behind the same interface. Phaser is not recommended because the simulation must not live inside an engine's update loop.

For UI chrome (panels, the segment summary, the event log) use plain DOM with TypeScript. Add a UI framework only if the panels get complicated.

Entity-component libraries (bitECS, Miniplex) were considered. The goblin count in v1 is small and the entity types are few, so plain arrays of typed records are simpler and keep serialization trivial. Revisit if the entity model grows.

## 6. Proposed v1 scope (playable prototype)

1. Grid map with terrain, a hoard cave, a few resource tiles, one rival camp.
2. 5 to 20 goblins with needs, temperament, utility-based action choice, A\* movement.
3. Effort production, hoard growth (new goblins hatch when effort crosses thresholds).
4. Overseer tools: place food pile, place loot pile, place war drum. Each costs effort and decays.
5. One rival hoard running the same AI; tile-adjacent fights.
6. Fixed-timestep loop with speed control, seeded random with integer state, command history, replay, checksums, save and load, the 12-hour segment bank and segment summary.
7. Event log with reasons for refusals.

## 7. What the scaffold does today and what was measured

The scaffold in `packages/sim` and `packages/client` implements sections 2, 3 and 4 at prototype depth: grid, A\*, utility AI with refusals, three incentives (food pile, shiny pile, war drum), effort and hatching, seeded determinism with integer state, a tick-stamped command history, replay from seed plus history, checksums, save and load, speed control and the 12-hour segment bank. Rival hoards, fighting, events and the server reconciliation are not built yet.

Measured on this container with the default map and starting hoard of 6:

| Game time replayed | Hoard size | Replay time in Node | Replay time in headless Chromium |
| --- | --- | --- | --- |
| 2 hours | about 43 | 0.8 s | not measured |
| 12 hours (the cap) | about 60 | 6.9 s | 18 s |

These numbers were measured when the game still had offline catch-up. They remain relevant as the cost of a full server-side replay of one 12-hour segment, and as the cost of the client verifying a save by replay. If it needs to drop, the options in order of preference are: fewer A\* calls per tick (cache paths, reconsider less often), then a coarser tick.

Balance is untuned. Growth over 12 hours is roughly logarithmic because the hatch threshold grows 15 percent per goblin while effort grows linearly with hoard size. That is a reasonable shape for an idle game but the constants were chosen to make the loop visibly work, not to be fun yet. The first thing playtesting should set is the time to the first hatch (currently about 20 seconds) and the time to the tenth.

## 8. Open questions for later

- Prestige or reset loop: does the hoard "migrate" to a new cave with bonuses? Research says a first reset within the first hour is important, so decide before balancing.
- How large can the map get before flow fields are required?
- What the server may change during reconciliation, and how losses per segment are bounded so a player never returns to a wiped hoard.
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
