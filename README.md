# Goblin Hoard

A web game about overseeing an unruly goblin hoard. The hoard grows with
"effort", which goblins produce over game time by gathering and hauling.
The overseer never gives orders: you place food, shinies, and war drums on
the board, and each goblin decides for itself whether to care.

It is not an idle game. You play forward at up to 64x speed and bank up to
12 hours of game time per segment. Every move is recorded with its tick,
so a later server can replay the segment with other players' moves and
events mixed in and tell you what really happened.

Research and design decisions are in [docs/research-and-design.md](docs/research-and-design.md).

## Layout

```
packages/sim      Pure TypeScript simulation. No DOM, no clock. Deterministic.
packages/client   Vite + Canvas 2D client. Fixed-timestep loop with speed
                  control, localStorage save, 12-hour segment bank.
```

## Run

```
npm install
npm run dev        # client at http://localhost:5173
npm test           # sim unit tests (vitest)
npm run typecheck  # all packages
npm run build      # production build of the client
```

## Play it online

Every push to `main` (and, until `main` exists, to the current working
branch) runs `.github/workflows/deploy-pages.yml`, which tests, builds and
publishes the client to GitHub Pages. One-time setup in the repository:
Settings, Pages, set Source to "GitHub Actions". The site is then at
`https://<owner>.github.io/goblin-game/`.

Saves live in the browser's localStorage, so progress is per browser.

## How the simulation works

- One tick is 250 ms of game time. The client advances the sim from an
  accumulator driven by requestAnimationFrame and renders with interpolation.
- All randomness goes through a seeded generator and all goblin state is
  integer. Same seed and same commands give the same world bit for bit.
- Every applied command is recorded with its tick in the world's history.
  `World.replay(seed, history)` rebuilds the world; `World.checksum()`
  hashes it so two machines can prove they agree.
- A save is seed, history and a snapshot. Nothing happens while the tab is
  closed; there is no offline progress.
- Goblins pick actions with a utility score built from their needs, their
  temperament (greed, bravery, diligence), and the incentives on the board,
  plus seeded noise. Refusals are written to the log with a reason.
