# Goblin Hoard

A web game about overseeing an unruly goblin hoard. The hoard grows with
"effort", which goblins produce over time by gathering and hauling. The
overseer never gives orders: you place food, shinies, and war drums on the
board, and each goblin decides for itself whether to care.

Research and design decisions are in [docs/research-and-design.md](docs/research-and-design.md).

## Layout

```
packages/sim      Pure TypeScript simulation. No DOM, no clock. Deterministic.
packages/client   Vite + Canvas 2D client. Fixed-timestep loop, localStorage
                  save, offline catch-up with a return report.
```

## Run

```
npm install
npm run dev        # client at http://localhost:5173
npm test           # sim unit tests (vitest)
npm run typecheck  # all packages
npm run build      # production build of the client
```

## How the simulation works

- One tick is 250 ms of game time. The client advances the sim from an
  accumulator driven by requestAnimationFrame and renders with interpolation.
- All randomness goes through a seeded generator. Same seed and same
  commands give the same world, which is what makes save, replay, offline
  catch-up and a later server possible.
- Offline progress replays the real simulation at speed, capped at 12 hours.
  The client runs it in chunks so the page stays responsive, then shows a
  return report.
- Goblins pick actions with a utility score built from their needs, their
  temperament (greed, bravery, diligence), and the incentives on the board,
  plus seeded noise. Refusals are written to the log with a reason.
