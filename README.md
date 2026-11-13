# limen-onebot

极简 QQNT OneBot v11 协议端。

## 环境要求

- Node.js ≥ 22.5.0
- QQNT 运行时（首次启动自动准备，见 `runtime/`）

## 快速开始

Windows 双击 `start.cmd`，或手动执行：

```bash
npm run init      # 生成 .env 配置
npm start         # 启动，按提示扫码登录
```

启动后输出 HTTP 与 WebSocket 地址（`/` universal、`/api`、`/event`），浏览器打开登录页扫码即可。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run init` | 生成初始 `.env` 配置 |
| `npm start` | 启动服务 |
| `npm run cli` | 命令行管理工具 |
| `npm run qq:prepare` / `qq:build` / `qq:check` | QQNT 内核准备、构建与检查 |
| `npm run self-test` | 协议层自测 |

## 目录结构

```
src/        服务端与 OneBot 协议实现（ESM）
scripts/    初始化、启动、构建与自测脚本
runtime/    QQNT 内核运行时
data/       运行数据（登录态、缓存等）
docs/       动作与内核方法对照（CAPABILITIES.md）
```

## 说明

- OneBot 动作与 QQNT 内核方法的对应关系及实现状态见 [docs/CAPABILITIES.md](docs/CAPABILITIES.md)。
- 除登录与协议层外，多数 QQ 动作尚未经真实账号验收，使用前请自行评估风险。
