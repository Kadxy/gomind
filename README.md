# Gomind

**English** | [简体中文](README.zh-CN.md)

Gomind is a browser-based Gomoku (five-in-a-row) application built around
[Rapfi](https://github.com/dhbloo/rapfi), a strong NNUE Gomoku engine compiled to
WebAssembly. The engine runs entirely in the browser; the only server-side component
is a lightweight WebSocket relay used for online play.

## Features

- **Local play**: two players on the same device.
- **Human vs. AI**: play against the Rapfi engine.
- **Self-play**: watch the engine play against itself.
- **Live analysis**: top candidate moves, position evaluation, and estimated win rate.
- **Online play**: create a room (the host picks a color and the time control), share
  its four-digit code or link, and play over WebSocket. Undo, restart, and draw need the
  opponent's consent; resignation and timeouts end the game. A player who refreshes, loses
  the network, or closes the tab gets 90 seconds to come back to the same seat, and both
  clocks stop meanwhile.

Games use freestyle rules on a 15×15 board: five or more stones in a row wins.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Engine | Rapfi (C++, NNUE) compiled to WebAssembly, running in a Web Worker |
| Frontend | React 18, TypeScript, Vite |
| UI | Tailwind CSS v4, shadcn/ui |
| Relay | Bun (WebSocket relay and static file server) |
| Tooling | Bun workspaces, Biome, Vitest |

## Getting Started

Requires [Bun](https://bun.sh) 1.3 or later.

```bash
bun install
bun run dev          # start the Vite dev server
bun run dev:relay    # optional: start the relay on :8765 for online play
```

During development, Vite proxies `/room/`, `/rooms`, and `/health` to the local relay. The
prebuilt Rapfi WebAssembly modules and network weights are served from
`web/public/rapfi/`, so no native toolchain is required.

## Project Structure

```plaintext
web/      React frontend
relay/    WebSocket relay for online play; can also serve the built frontend
deploy/   Caddyfile, nginx snippet, systemd unit, and redeploy script
```

## Scripts

| Command | Description |
| --- | --- |
| `bun run dev` | Start the frontend dev server |
| `bun run dev:relay` | Start the relay locally on port 8765 |
| `bun run build` | Type-check and build the frontend into `web/dist` |
| `bun run start` | Serve `web/dist` and the relay from a single process |
| `bun run test` | Run frontend unit tests |
| `bun run lint` | Run Biome checks |
| `bun run format` | Format the codebase with Biome |

## Deployment

The application runs as a single Bun process. `relay/server.js` allocates rooms on
`POST /rooms`, handles WebSocket connections on `/room/<ID>`, and answers a health check
on `/health`; when `STATIC_DIR` is set,
it also serves the built frontend with an SPA fallback. By default the frontend connects
to the relay on the same origin, so no additional URL configuration is needed.

### Docker Compose (recommended)

```bash
cp .env.example .env
docker compose up -d --build
```

By default the container is bound to `127.0.0.1:8000` (configurable via `BIND` in
`.env`), for use behind an existing reverse proxy such as nginx, OpenResty, or Caddy.
The proxy must forward WebSocket upgrade headers (`Upgrade` and `Connection`) and use a
read timeout of at least 120 seconds. See `deploy/nginx-site.conf.example` for a
reference configuration.

### Docker Compose with bundled Caddy

If the host has no reverse proxy, an overlay adds Caddy with automatic HTTPS. Set
`DOMAIN` in `.env`, make sure ports 80 and 443 are open, and run:

```bash
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

When a CDN (for example, Cloudflare) terminates TLS in front of the server, enable
WebSocket support on the CDN and set `DOMAIN=:80` so that Caddy serves plain HTTP to
the CDN.

### Redeploying to a remote host

```bash
deploy/deploy.sh <ssh-host> <remote-dir>
```

The script packages the working tree, uploads it over SSH, rebuilds the image, and
restarts the service. An existing `.env` on the server is left untouched.

### Without Docker

```bash
bun install && bun run build
PORT=8000 bun run start    # equivalent to: STATIC_DIR=web/dist bun run relay/server.js
```

To run it as a service, use the systemd unit in `deploy/gomind.service` and place
Caddy or nginx in front of it for TLS. The nginx configuration must forward WebSocket
upgrade headers for `/room/` and set a read timeout of at least two minutes.

### Hosting the frontend and relay separately

The frontend is a set of static files and can be hosted on any static hosting service.
In that case, set `VITE_RELAY_WS_URL` at build time to point to the relay (for example,
`wss://relay.example.com`), and restrict accepted origins on the relay with
`ALLOWED_ORIGINS` (for example, `https://app.example.com`).

### Configuration

| Variable | Default | Scope | Description |
| --- | --- | --- | --- |
| `PORT` | `8000` | Relay | Listening port |
| `STATIC_DIR` | unset | Relay | Directory of static files to serve; unknown routes fall back to `index.html` |
| `ALLOWED_ORIGINS` | `*` | Relay | Comma-separated list of origins allowed to open WebSocket connections; supports `*` wildcards |
| `GRACE_MS` | `90000` | Relay | How long a disconnected player's seat is held before the room closes |
| `DEAD_AFTER_MS` | `15000` | Relay | Silence after which a connection is treated as dropped |
| `BIND` | `127.0.0.1:8000` | Docker Compose | Host address and port the container is published on |
| `DOMAIN` | — | Caddy overlay | Hostname that Caddy serves and obtains a certificate for; `:80` for plain HTTP |
| `VITE_RELAY_WS_URL` | same origin | Frontend build | WebSocket base URL of the relay |

## Notes

Rapfi currently runs in single-threaded mode with WebAssembly SIMD128. A multi-threaded
(pthreads) build is included but not yet enabled, because spawning Emscripten pthreads
from within a nested Web Worker currently hangs. The single-threaded build reaches
about 130K nodes per second on an Apple M3 Pro, which is sufficient for strong play.

## Roadmap

- [ ] Game review
- [ ] Import and export of game records

## Acknowledgements

- [Rapfi](https://github.com/dhbloo/rapfi) by the Rapfi developers, licensed under
  GPL-3.0. The WebAssembly builds in `web/public/rapfi/` are compiled from Rapfi.
- Neural network weights from
  [rapfi-networks](https://github.com/dhbloo/rapfi-networks), released under CC0-1.0.
