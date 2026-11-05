# Gomind

五子棋 Web 对战 + AI。

## 技术栈

- **Engine**: [Rapfi](https://github.com/dhbloo/rapfi) (C++ NNUE → WASM)
- **Web**: React 18 + TypeScript + Vite
- **UI**: Tailwind CSS v4 + shadcn/ui
- **Pkg**: bun workspaces

## 启动

```bash
bun install
bun run dev            # 启动 Vite (前端)
bun run dev:relay      # 可选: 启动联机对战中转 (Vite 会把 /room 代理过去)
```

Rapfi 的 WASM + NNUE 权重在 `web/public/rapfi/` 下直接 serve，不需要本地构建。

## 结构

```plaintext
web/     React 前端
relay/   联机对战 WebSocket 中转，也能托管 web/dist 静态文件
deploy/  Caddyfile / systemd 单元
```

## 部署

整个项目就是一个 Bun 进程：`relay/server.js` 既转发 `/room/<ID>` 的 WebSocket，
也（设置 `STATIC_DIR` 时）托管构建好的前端。前端默认连同源地址，不需要配域名。

**Docker（推荐）**

```bash
cp .env.example .env   # BIND=127.0.0.1:端口，给已有的反代（nginx / Caddy）回源
docker compose up -d --build
```

已有服务器的话 `deploy/deploy.sh [ssh主机] [远端目录]` 会打包上传、重建镜像并重启，
服务器上的 `.env` 不会被覆盖。

反代那边要把 WebSocket 升级头转发过去（`Upgrade` / `Connection`，读超时 ≥ 120s），
参考 `deploy/nginx-site.conf.example`。常见面板的"反向代理"站点默认已经带这些头。

机器上还没有反代、想直接对外的话，叠加自带的 Caddy，自动签 HTTPS：

```bash
# .env 里填 DOMAIN=你的域名；服务器开放 80/443
docker compose -f docker-compose.yml -f docker-compose.caddy.yml up -d --build
```

如果前面是 Cloudflare 之类的 CDN 终止 TLS，确保 CDN 开了 WebSocket，
回源走 HTTP 到你的反代或 Caddy（后者把 `DOMAIN` 设为 `:80`）。

**不用 Docker**

```bash
bun install && bun run build
PORT=8000 bun run start          # = STATIC_DIR=web/dist bun run relay/server.js
```

常驻可以用 `deploy/gomind.service`（systemd），再在前面放 Caddy / nginx 做 TLS。
nginx 需要给 `/room/` 加 WebSocket 升级头（`Upgrade` / `Connection`）并把超时调到 2 分钟以上。

**前后端分开部署**

前端是纯静态文件，可以放任意静态托管；此时构建前设置
`VITE_RELAY_WS_URL=wss://relay.example.com` 指向单独部署的 relay，
relay 侧用 `ALLOWED_ORIGINS=https://你的前端域名` 限制来源。

环境变量：

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `8000` | 监听端口 |
| `STATIC_DIR` | 不托管 | 静态文件目录，SPA 路由回退到 index.html |
| `ALLOWED_ORIGINS` | `*` | WebSocket 握手允许的 Origin，逗号分隔，支持 `*` 通配 |

## 开发

```bash
bun run dev        # 前端 dev server
bun run build      # 生产构建
bun run test       # 前端单测
bun run lint       # biome
```

## 功能

### V1(当前)

- [x] 同屏双人
- [x] 人机对战(Rapfi NNUE)
- [x] 机机自对弈观战
- [x] 实时分析:Top 候选手 + 评估分 + 胜率

### V2(规划)

- [x] 远程对战(WebSocket 房间号)  — 接入完成，与前端同进程部署
- [ ] 复盘 / 棋谱导入导出

## 备注

Rapfi 目前跑的是单线程 SIMD128 模式。多线程 (pthread) 在浏览器里暂未启用
 — 需要解决 Emscripten pthread 在嵌套 Worker 里的派生挂死问题。
单线程 + SIMD 在 M3 Pro 上已经能到 ~130K NPS，对局强度足够,不急。
