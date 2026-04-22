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
bun run dev:relay      # 可选: 启动联机对战中转
```

Rapfi 的 WASM + NNUE 权重在 `web/public/rapfi/` 下直接 serve，不需要本地构建。

## 结构

```plaintext
web/     React 前端
relay/   联机对战 WebSocket 中转
```

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

- [x] 远程对战(WebSocket 房间号)  — 接入完成,稳定性待打磨
- [ ] 复盘 / 棋谱导入导出

## 备注

Rapfi 目前跑的是单线程 SIMD128 模式。多线程 (pthread) 在浏览器里暂未启用
 — 需要解决 Emscripten pthread 在嵌套 Worker 里的派生挂死问题。
单线程 + SIMD 在 M3 Pro 上已经能到 ~130K NPS，对局强度足够,不急。
