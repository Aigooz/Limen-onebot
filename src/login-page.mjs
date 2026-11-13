import { readFileSync } from 'node:fs';

// 品牌图标：assets/brand-icon.png 内联成 data URI，页面不额外请求静态文件。
// 读不到文件时退回旧的矢量图标，避免整个登录页模块加载失败。
const BRAND_ICON = (() => {
  try {
    const png = readFileSync(new URL('./assets/brand-icon.png', import.meta.url));
    return `data:image/png;base64,${png.toString('base64')}`;
  } catch {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23f2f6fd'/%3E%3Cpath d='M9.5 23V14.8a6.5 6.5 0 0 1 13 0V23' fill='none' stroke='%235570d8' stroke-width='2.4' stroke-linecap='round'/%3E%3Cpath d='M6.5 23h19' stroke='%235570d8' stroke-width='2.4' stroke-linecap='round'/%3E%3Ccircle cx='16' cy='18' r='2.1' fill='%2394a8f0'/%3E%3C/svg%3E";
  }
})();

const STATUS = {
  idle: '正在准备 QQ 内核…',
  booting: '正在启动内核…',
  requesting_qr: '正在向 QQ 申请二维码…',
  waiting_scan: '等待扫码',
  waiting_confirm: '已扫码，请在手机上确认',
  authenticating: '正在验证…',
  authenticated: '验证通过，正在初始化会话…',
  initializing_session: '正在初始化 QQ 会话…',
  online: '已登录',
  restoring: '正在恢复上次的登录…',
  login_required: '需要重新扫码登录',
  connection_lost: '连接中断，正在自动重连…',
  reconnecting: '正在重连…',
  kicked: '账号被下线，请重新扫码',
  qr_failed: '二维码获取失败',
  login_failed: '登录失败',
  session_failed: '会话初始化失败',
  expired: '二维码已过期'
};

export function renderLoginPage(pageToken, meta = {}) {
  const token = JSON.stringify(pageToken);
  const name = meta.name || 'Limen OneBot';
  const version = meta.version || '0.1.0';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex,nofollow">
<title>${name} · 扫码登录</title>
<script>
(() => {
  // 图标只内联一份，标签页 favicon 与页头 logo 共用。
  const ICON = ${JSON.stringify(BRAND_ICON)};
  window.__BRAND_ICON__ = ICON;
  try {
    const link = document.createElement('link');
    link.rel = 'icon'; link.type = 'image/png'; link.href = ICON;
    document.head.appendChild(link);
  } catch {}
  try {
    const saved = localStorage.getItem('limen-theme');
    const dark = saved ? saved === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch { document.documentElement.dataset.theme = 'light'; }
})();
</script>
<style>
  *, *::before, *::after { box-sizing: border-box; }

  /* NapCat 系配色：极光蓝 / 薰衣草 / 青，不灰、不扎眼 */
  :root {
    --bg: #f2f6fd;
    --card: rgba(255, 255, 255, .82);
    --card-solid: #ffffff;
    --ink: #33406b;
    --ink-2: #55618c;
    --ink-3: #7d88ad;
    --ink-4: #a3accb;
    --line: #e2e9f8;
    --line-2: #d2dcf0;
    --surface: #f4f7fe;
    --accent: #5570d8;
    --accent-2: #6c85e6;
    --accent-ink: #ffffff;
    --accent-soft: rgba(85, 112, 216, .09);
    --ok: #22a08d;
    --ok-soft: rgba(34, 160, 141, .11);
    --wait: #7c8fe0;
    --wait-soft: rgba(124, 143, 224, .12);
    --warn: #b08d47;
    --warn-soft: rgba(176, 141, 71, .13);
    --danger: #d0617e;
    --danger-soft: rgba(208, 97, 126, .11);
    --code-bg: #f0f4fb;
    --shadow: 0 1px 2px rgba(51, 64, 107, .04), 0 24px 60px -30px rgba(85, 112, 216, .45);
    --aurora-1: rgba(167, 200, 248, .5);
    --aurora-2: rgba(196, 189, 246, .45);
    --aurora-3: rgba(165, 230, 240, .38);
  }
  :root[data-theme="dark"] {
    --bg: #0b111f;
    --card: rgba(19, 26, 44, .82);
    --card-solid: #131a2c;
    --ink: #dfe6f8;
    --ink-2: #b7c2e2;
    --ink-3: #8e99bf;
    --ink-4: #667095;
    --line: #26314e;
    --line-2: #33405f;
    --surface: #1a2338;
    --accent: #8ba3ec;
    --accent-2: #a5b8f2;
    --accent-ink: #0b111f;
    --accent-soft: rgba(139, 163, 236, .13);
    --ok: #52c9b4;
    --ok-soft: rgba(82, 201, 180, .13);
    --wait: #93a5e8;
    --wait-soft: rgba(147, 165, 232, .14);
    --warn: #caa566;
    --warn-soft: rgba(202, 165, 102, .15);
    --danger: #e58ba3;
    --danger-soft: rgba(229, 139, 163, .13);
    --code-bg: #1a2439;
    --shadow: 0 1px 2px rgba(0, 0, 0, .25), 0 32px 70px -30px rgba(0, 0, 0, .85);
    --aurora-1: rgba(44, 74, 143, .5);
    --aurora-2: rgba(75, 61, 143, .45);
    --aurora-3: rgba(29, 95, 115, .4);
  }

  html { min-height: 100%; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    padding: 32px 22px;
    color: var(--ink);
    background: var(--bg);
    font: 14px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI",
      "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif;
    -webkit-font-smoothing: antialiased;
    overflow-x: hidden;
  }

  /* ------------------------------------------------------- 极光 aurora */
  .aurora { position: fixed; inset: -18%; z-index: -1; overflow: hidden; pointer-events: none;
    background:
      radial-gradient(58% 48% at 10% 4%, var(--aurora-1) 0%, transparent 70%),
      radial-gradient(52% 44% at 92% 8%, var(--aurora-2) 0%, transparent 68%),
      radial-gradient(60% 50% at 46% 94%, var(--aurora-3) 0%, transparent 72%);
    animation: aurora-drift 36s ease-in-out infinite alternate; }
  @keyframes aurora-drift {
    from { transform: translate(0, 0) scale(1); }
    to { transform: translate(2.5%, -2%) scale(1.05); }
  }

  /* ------------------------------------------------------------------ card */
  .card {
    position: relative;
    width: min(100%, 880px);
    margin: auto;
    padding: 26px 30px 22px;
    background: var(--card);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid var(--line);
    border-radius: 20px;
    box-shadow: var(--shadow);
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 30px;
    row-gap: 0;
  }

  .top { grid-column: 1 / -1; display: flex; align-items: center; gap: 12px; }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .glyph { width: 34px; height: 34px; flex: none; display: block; object-fit: contain;
    border-radius: 9px; filter: drop-shadow(0 1px 2px rgba(51, 64, 107, .12)); }
  :root[data-theme="dark"] .glyph { filter: drop-shadow(0 1px 3px rgba(0, 0, 0, .45)); }
  .brand b { font-size: 14.5px; font-weight: 660; color: var(--ink); white-space: nowrap; }
  .brand em { font-style: normal; font-size: 10.5px; color: var(--accent-2);
    font-variant-numeric: tabular-nums; padding: 1px 8px; border-radius: 999px;
    background: var(--accent-soft); border: 1px solid var(--line); }
  .top .push { flex: 1; }
  .theme-btn { width: 30px; height: 30px; flex: none; display: grid; place-items: center; cursor: pointer;
    border: 1px solid var(--line); border-radius: 999px; background: var(--card-solid); color: var(--ink-4);
    transition: color .15s, background .15s; }
  .theme-btn:hover { color: var(--accent); }
  .theme-btn svg { width: 14px; height: 14px; }
  :root[data-theme="dark"] .i-sun { display: none; }
  :root[data-theme="light"] .i-moon { display: none; }

  /* ---------------------------------------------------------------- status */
  .status { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; align-self: stretch;
    padding: 6px 13px; border-radius: 999px; border: 1px solid var(--line);
    background: var(--surface); font-size: 12.5px; font-weight: 600; color: var(--ink-2); }
  .status .dot { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--ink-4); }
  .status[data-tone="busy"] { color: var(--accent); border-color: var(--line-2); background: var(--accent-soft); }
  .status[data-tone="busy"] .dot { background: var(--accent); animation: blink 1.4s ease-in-out infinite; }
  .status[data-tone="wait"] { color: var(--wait); background: var(--wait-soft); border-color: var(--line-2); }
  .status[data-tone="wait"] .dot { background: var(--wait); animation: blink 1.4s ease-in-out infinite; }
  .status[data-tone="ok"] { color: var(--ok); background: var(--ok-soft); border-color: var(--line-2); }
  .status[data-tone="ok"] .dot { background: var(--ok); }
  .status[data-tone="error"] { color: var(--danger); background: var(--danger-soft); border-color: var(--line-2); }
  .status[data-tone="error"] .dot { background: var(--danger); }
  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }

  /* --------------------------------------------------------------- QR stage */
  .stage { grid-column: 1; display: flex; flex-direction: column; align-items: center; margin-top: 16px; }
  .qr-frame { position: relative; width: 264px; height: 264px; padding: 12px;
    border-radius: 16px; border: 1px solid var(--line-2); background: #fff;
    box-shadow: 0 10px 30px -14px rgba(85, 112, 216, .35); }
  .qr { position: relative; width: 100%; height: 100%; border-radius: 8px; overflow: hidden;
    background: #fff; display: grid; place-items: center; transition: opacity .2s; }
  .qr img { width: 100%; height: 100%; display: block; object-fit: contain; }
  .qr img[hidden] { display: none; }
  .qr-empty { position: absolute; inset: 0; display: grid; place-content: center; gap: 12px;
    justify-items: center; padding: 16px; text-align: center; font-size: 12px; color: #7c90a3; background: #fff; }
  .qr-empty[hidden] { display: none; }
  .qr-empty em { font-style: normal; }
  .spinner { width: 24px; height: 24px; border-radius: 50%; animation: spin .9s linear infinite;
    border: 2px solid rgba(85, 112, 216, .2); border-top-color: #5570d8; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .qr-frame[data-overlay="1"] .qr { opacity: .12; }

  .overlay { position: absolute; inset: 0; z-index: 2; border-radius: 16px; padding: 16px;
    display: grid; place-content: center; justify-items: center; gap: 6px; text-align: center;
    background: rgba(255, 255, 255, .96); opacity: 1; transition: opacity .2s; }
  :root[data-theme="dark"] .overlay { background: rgba(19, 26, 44, .96); }
  .overlay[data-kind="none"] { opacity: 0; pointer-events: none; }
  .overlay .icon { width: 40px; height: 40px; margin-bottom: 2px; border-radius: 50%;
    display: grid; place-items: center; }
  .overlay .icon svg { width: 19px; height: 19px; }
  .overlay strong { font-size: 14px; font-weight: 660; color: var(--ink); }
  .overlay p { margin: 0; max-width: 210px; font-size: 11.5px; line-height: 1.6; color: var(--ink-3); }
  .overlay[data-kind="scan"] .icon { color: var(--wait); background: var(--wait-soft); }
  .overlay[data-kind="success"] .icon { color: var(--ok); background: var(--ok-soft); }
  .overlay[data-kind="error"] .icon { color: var(--danger); background: var(--danger-soft); }
  .overlay[data-kind="expired"] .icon { color: var(--warn); background: var(--warn-soft); }

  .timer { width: 264px; margin-top: 14px; display: flex; align-items: center; gap: 10px; }
  .timer[data-off="1"] { visibility: hidden; }
  .bar { flex: 1; height: 3px; border-radius: 999px; overflow: hidden; background: var(--line-2); }
  .bar i { display: block; width: 100%; height: 100%; border-radius: 999px; background: var(--accent);
    transition: width .5s linear, background .3s; }
  .timer span { min-width: 40px; text-align: right; font-size: 11px; color: var(--ink-4);
    font-variant-numeric: tabular-nums; }

  .hint { margin: 12px 0 0; min-height: 40px; max-width: 280px; text-align: center;
    font-size: 12.5px; line-height: 1.6; color: var(--ink-3); }

  .cta { width: 264px; height: 42px; margin-top: 4px; cursor: pointer;
    border: 0; border-radius: 999px; font-family: inherit; font-size: 13.5px; font-weight: 640;
    color: var(--accent-ink); background: linear-gradient(135deg, var(--accent), var(--accent-2));
    box-shadow: 0 10px 24px -10px rgba(85, 112, 216, .55);
    transition: filter .15s, transform .1s, opacity .2s, box-shadow .15s; }
  .cta:hover:not(:disabled) { filter: brightness(1.08); box-shadow: 0 12px 28px -10px rgba(85, 112, 216, .65); }
  .cta:active:not(:disabled) { transform: translateY(1px); }
  .cta:disabled { opacity: .45; cursor: default; box-shadow: none; }

  /* ------------------------------------------------------------ 右侧信息栏 */
  .side { grid-column: 2; display: flex; flex-direction: column; margin-top: 16px; min-width: 0; }
  .panel { border: 1px solid var(--line); border-radius: 14px;
    background: var(--surface); padding: 2px 14px; }
  .block { padding: 10px 0; }
  .block + .block { border-top: 1px solid var(--line); }
  .block-h { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 0 0 4px;
    font-size: 10.5px; font-weight: 700; letter-spacing: .1em; color: var(--ink-4); }
  .row { display: grid; grid-template-columns: 64px minmax(0, 1fr) auto; align-items: center;
    gap: 10px; padding: 3px 0; }
  .row .k { font-size: 12px; color: var(--ink-3); }
  .row code { display: block; min-width: 0; padding: 3px 8px; border-radius: 8px; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11.5px;
    color: var(--ink-2); background: var(--card-solid); border: 1px solid var(--line); }
  .copy { padding: 4px 8px; border: 0; border-radius: 999px; background: transparent; cursor: pointer;
    font-family: inherit; font-size: 11.5px; color: var(--ink-4); opacity: .75;
    transition: opacity .15s, color .15s, background .15s; }
  .row:hover .copy, .copy:focus-visible { opacity: 1; }
  .copy:hover { color: var(--accent); background: var(--accent-soft); }
  .copy.done { color: var(--ok); opacity: 1; }
  .acts { display: flex; align-items: center; gap: 2px; }
  .note { margin: 4px 0 0; font-size: 10.5px; line-height: 1.6; color: var(--ink-4); }
  .note[data-on="1"] { color: var(--ok); }
  .mini { padding: 2px 9px; border: 1px solid var(--line-2); border-radius: 999px; background: var(--card-solid);
    cursor: pointer; font-family: inherit; font-size: 10px; font-weight: 600; color: var(--ink-3);
    transition: color .15s, border-color .15s; }
  .mini:hover { color: var(--accent); border-color: var(--accent-2); }

  .stats { margin-top: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .stats > div { min-width: 0; padding: 9px 12px; border-radius: 10px;
    border: 1px solid var(--line); background: var(--surface); }
  .stats span { display: block; font-size: 10px; font-weight: 600; letter-spacing: .06em; color: var(--ink-4); }
  .stats b { display: block; margin-top: 1px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    font-size: 12px; font-weight: 620; color: var(--ink-2); font-variant-numeric: tabular-nums; }

  .foot { grid-column: 1 / -1; margin: 20px 0 0; padding-top: 14px; border-top: 1px solid var(--line);
    font-size: 11px; line-height: 1.7; color: var(--ink-4); }
  .foot code { padding: 0 4px; border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 10.5px;
    background: var(--code-bg); border: 1px solid var(--line); }

  .toast { position: fixed; left: 50%; bottom: 26px; z-index: 9; transform: translate(-50%, 12px);
    padding: 7px 15px; border-radius: 999px; background: var(--ink); color: var(--card-solid);
    font-size: 12px; font-weight: 600; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }

  /* ---------------------------------------------------------------- dialog */
  .sheet { width: min(94vw, 560px); padding: 0; color: var(--ink);
    border: 1px solid var(--line); border-radius: 16px; background: var(--card-solid); box-shadow: var(--shadow); }
  .sheet::backdrop { background: rgba(16, 24, 44, .5); backdrop-filter: blur(2px); }
  .sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 18px 0; }
  .sheet-head h3 { margin: 0; font-size: 15px; font-weight: 650; }
  .sheet-head .theme-btn { width: 26px; height: 26px; }
  .sheet-head .theme-btn svg { width: 12px; height: 12px; }
  .sheet-note { margin: 8px 18px 0; font-size: 11.5px; line-height: 1.7; color: var(--ink-3); }
  .sheet-note code { padding: 1px 5px; border-radius: 5px;
    font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 11px;
    background: var(--code-bg); border: 1px solid var(--line); }
  .sheet-rows { display: grid; gap: 10px; max-height: 46vh; overflow-y: auto; padding: 13px 18px 0; }
  .net-empty { margin: 0; padding: 12px 0; text-align: center; font-size: 12px; color: var(--ink-4); }
  .net-row { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto auto; align-items: center; gap: 10px;
    padding: 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .net-fields { display: grid; gap: 6px; min-width: 0; }
  .net-input { width: 100%; height: 30px; padding: 0 9px; border-radius: 8px; border: 1px solid var(--line-2);
    background: var(--card-solid); color: var(--ink); font-family: inherit; font-size: 11.5px; }
  .net-input[data-role="url"] { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
  .net-input::placeholder { color: var(--ink-4); }
  .net-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .net-state { min-width: 44px; text-align: right; white-space: nowrap; font-size: 10.5px; color: var(--ink-4); }
  .net-state[data-on="1"] { color: var(--ok); }
  .net-state[data-on="error"] { color: var(--danger); }
  .net-del { padding: 4px 6px; border: 0; border-radius: 999px; background: transparent; cursor: pointer;
    font-family: inherit; font-size: 11.5px; color: var(--ink-4); }
  .net-del:hover { color: var(--danger); background: var(--danger-soft); }
  .switch { position: relative; display: block; width: 32px; height: 18px; cursor: pointer; }
  .switch input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; }
  .switch span { position: absolute; inset: 0; border-radius: 999px; background: var(--line-2); transition: background .2s; }
  .switch span::after { content: ""; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px;
    border-radius: 50%; background: #fff; transition: transform .2s; }
  .switch input:checked + span { background: var(--accent); }
  .switch input:checked + span::after { transform: translateX(14px); }
  .ghost-btn { padding: 5px 12px; border: 1px solid var(--line-2); border-radius: 999px; cursor: pointer;
    background: var(--card-solid); color: var(--ink-2); font-family: inherit; font-size: 11.5px; font-weight: 600;
    transition: color .15s, border-color .15s; }
  .ghost-btn:hover { color: var(--accent); border-color: var(--accent-2); }
  .ghost-btn.add { margin: 12px 18px 0; width: calc(100% - 36px); padding: 7px 0; border-style: dashed; }
  .sheet-foot { display: flex; align-items: center; gap: 10px; padding: 14px 18px 16px; }
  .sheet-msg { flex: 1; min-height: 16px; font-size: 11.5px; color: var(--ink-3); }
  .sheet-msg[data-tone="error"] { color: var(--danger); }
  .sheet-msg[data-tone="ok"] { color: var(--ok); }
  .cta.sm { width: auto; height: 32px; margin: 0; padding: 0 16px; font-size: 12.5px; }

  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button { font-family: inherit; }

  /* ------------------------------------------------------------- responsive */
  @media (max-width: 760px) {
    body { padding: 16px 12px; }
    .card { grid-template-columns: 1fr; padding: 22px 20px 18px; }
    .stage, .side { grid-column: 1; }
    .side { margin-top: 22px; }
    .stats { margin-top: 12px; }
    .foot { margin-top: 18px; }
  }
  @media (max-width: 420px) {
    .qr-frame, .timer, .cta { width: 252px; }
    .qr-frame { height: 252px; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important;
      transition-duration: .01ms !important; }
    .aurora { animation: none !important; }
  }
</style>
</head>
<body>
<div class="aurora" aria-hidden="true"></div>
<main class="card">
  <header class="top">
    <div class="brand">
      <img class="glyph" id="brandGlyph" alt="${name}" width="34" height="34">
      <b>${name}</b>
      <em>v${version}</em>
    </div>
    <span class="push"></span>
    <button class="theme-btn" id="theme" type="button" title="切换深色 / 浅色" aria-label="切换主题">
      <svg class="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
        <circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"></path>
      </svg>
      <svg class="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"></path>
      </svg>
    </button>
  </header>

  <section class="stage">
    <div class="status" id="status" data-tone="busy" role="status" aria-live="polite">
      <span class="dot"></span><span id="statusText">正在准备…</span>
    </div>

    <div class="qr-frame" id="qrShell">
      <div class="qr" id="qr">
        <img id="qrImage" alt="QQ 登录二维码" hidden>
        <div class="qr-empty" id="qrEmpty">
          <span class="spinner"></span>
          <em>正在获取二维码…</em>
        </div>
      </div>
      <div class="overlay" id="overlay" data-kind="none" aria-live="polite">
        <span class="icon" id="overlayIcon"></span>
        <strong id="overlayTitle"></strong>
        <p id="overlayDesc"></p>
      </div>
    </div>

    <div class="timer" id="timer">
      <div class="bar"><i id="bar"></i></div>
      <span id="count">--:--</span>
    </div>

    <p class="hint" id="hint">正在向 QQ 申请二维码，请稍候…</p>
    <button class="cta" id="refresh" type="button" disabled>获取二维码</button>
  </section>

  <div class="side">
    <div class="panel">
      <div class="block">
        <h2 class="block-h">接入地址</h2>
        <div class="row"><span class="k">HTTP</span><code id="epHttp">—</code><button class="copy" type="button" data-copy="epHttp">复制</button></div>
        <div class="row"><span class="k">WebSocket</span><code id="epWs">—</code><button class="copy" type="button" data-copy="epWs">复制</button></div>
        <div class="row"><span class="k">事件流</span><code id="epEvent">—</code><button class="copy" type="button" data-copy="epEvent">复制</button></div>
      </div>
      <div class="block">
        <h2 class="block-h">反向 WebSocket<button class="mini" id="revConfig" type="button" hidden>配置</button></h2>
        <div class="row"><span class="k">目标</span><code id="revTargets">未配置</code><button class="copy" type="button" data-copy="revTargets">复制</button></div>
        <div class="row"><span class="k">Token</span><code id="revToken">—</code><span class="acts"><button class="copy" id="revReveal" type="button" hidden>显示</button><button class="copy" type="button" data-copy="revToken">复制</button></span></div>
        <p class="note" id="revNote" hidden></p>
      </div>
    </div>

    <div class="stats">
      <div><span>登录账号</span><b id="infoAccount">未登录</b></div>
      <div><span>内核</span><b id="infoKernel">—</b></div>
      <div><span>运行时长</span><b id="infoUptime">—</b></div>
      <div><span>已连接</span><b id="infoClients">—</b></div>
    </div>
  </div>

  <p class="foot">凭据只保存在本机 <code>.env</code>；本页地址携带的是每次启动随机生成的路径令牌。</p>
</main>

<dialog class="sheet" id="netDialog">
  <div class="sheet-head">
    <h3>反向 WebSocket 配置</h3>
    <button class="theme-btn" id="netClose" type="button" aria-label="关闭">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg>
    </button>
  </div>
  <p class="sheet-note">本端是客户端，会主动去连下面这些地址。AstrBot 的 OneBot v11 才是「服务端」，所以填它的 <code>ws://127.0.0.1:6199/ws</code>；NoneBot / Koishi 主动连本端，不需要在这里填。保存后立即生效，不用重启。</p>
  <div class="sheet-rows" id="netRows"></div>
  <button class="ghost-btn add" id="netAdd" type="button">+ 添加一条</button>
  <div class="sheet-foot">
    <span class="sheet-msg" id="netMsg"></span>
    <button class="ghost-btn" id="netCancel" type="button">取消</button>
    <button class="cta sm" id="netSave" type="button">保存并生效</button>
  </div>
</dialog>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
(() => {
  const TOKEN = ${token};
  const BASE = '/login/' + TOKEN;
  const TEXT = ${JSON.stringify(STATUS)};

  const el = id => document.getElementById(id);
  const glyph = el('brandGlyph');
  if (glyph) glyph.src = window.__BRAND_ICON__ || '';
  const root = document.documentElement;
  const shell = el('qrShell'), image = el('qrImage'), empty = el('qrEmpty');
  const overlay = el('overlay'), overlayIcon = el('overlayIcon'), overlayTitle = el('overlayTitle'), overlayDesc = el('overlayDesc');
  const statusBox = el('status'), statusText = el('statusText');
  const bar = el('bar'), count = el('count'), hint = el('hint'), refreshBtn = el('refresh'), timerBox = el('timer');
  const revTargets = el('revTargets'), revToken = el('revToken'), revReveal = el('revReveal'), revNote = el('revNote');
  const revConfig = el('revConfig'), netDialog = el('netDialog'), netRows = el('netRows'), netMsg = el('netMsg');
  const netAdd = el('netAdd'), netSave = el('netSave'), netCancel = el('netCancel'), netClose = el('netClose');
  const meta = { account: el('infoAccount'), kernel: el('infoKernel'), uptime: el('infoUptime'), clients: el('infoClients') };

  const TONE = {
    idle: 'busy', booting: 'busy', requesting_qr: 'busy', authenticating: 'busy', authenticated: 'busy',
    initializing_session: 'busy', restoring: 'busy', connection_lost: 'busy', reconnecting: 'busy',
    waiting_scan: 'wait', waiting_confirm: 'wait', login_required: 'wait', expired: 'wait',
    online: 'ok',
    qr_failed: 'error', login_failed: 'error', session_failed: 'error', kicked: 'error'
  };
  const TERMINAL = ['qr_failed', 'login_failed', 'session_failed', 'kicked'];

  let state = 'idle', handle = null, expiresAt = 0, issuedAt = 0;
  let pollTimer = null, tickTimer = null, overviewTimer = null, busy = false;

  const say = message => {
    const toast = el('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(say.timer);
    say.timer = setTimeout(() => toast.classList.remove('show'), 1600);
  };
  const fmtClock = ms => {
    const total = Math.max(0, Math.round(ms / 1000));
    return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0');
  };
  const fmtUptime = seconds => {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
    if (h) return h + ' 小时 ' + m + ' 分';
    if (m) return m + ' 分 ' + s + ' 秒';
    return s + ' 秒';
  };

  function icon(kind) {
    if (kind === 'success') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"></path></svg>';
    if (kind === 'scan') return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"></path><path d="M8 12h8"></path></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><path d="M12 7v6"></path><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"></circle><circle cx="12" cy="12" r="9"></circle></svg>';
  }
  function setOverlay(kind, title, desc) {
    overlay.dataset.kind = kind || 'none';
    shell.dataset.overlay = kind ? '1' : '0';
    if (!kind) return;
    overlayIcon.innerHTML = icon(kind);
    overlayTitle.textContent = title || '';
    overlayDesc.textContent = desc || '';
  }
  function setButton(label, disabled) {
    refreshBtn.textContent = label;
    refreshBtn.disabled = !!disabled;
  }
  function stopTicking() { clearInterval(tickTimer); tickTimer = null; }
  function tick() {
    if (!expiresAt) { bar.style.width = '0%'; count.textContent = '--:--'; return; }
    const left = expiresAt - Date.now();
    const span = Math.max(1, expiresAt - issuedAt);
    const ratio = Math.max(0, Math.min(1, left / span));
    bar.style.width = (ratio * 100).toFixed(1) + '%';
    bar.style.background = ratio < 0.25 ? 'var(--danger)' : ratio < 0.5 ? 'var(--warn)' : 'var(--accent)';
    count.textContent = left > 0 ? fmtClock(left) : '已过期';
    if (left <= 0 && !['online', 'waiting_confirm', 'authenticating', 'initializing_session', 'authenticated', 'expired'].includes(state)) {
      apply({ state: 'expired' });
    }
  }
  function showQr(src, expiry) {
    image.src = src;
    image.hidden = false;
    empty.hidden = true;
    // A QR is valid for about two minutes: derive the issue time so the bar
    // reflects the real remaining time even when the server returns a cached QR.
    issuedAt = expiry ? expiry - 118000 : Date.now();
  }
  function showEmpty() {
    image.hidden = true;
    image.removeAttribute('src');
    empty.hidden = false;
    bar.style.width = '0%';
    count.textContent = '--:--';
  }

  function apply(data) {
    state = data.state || state;
    timerBox.dataset.off = state === 'waiting_scan' ? '0' : '1';
    const tone = TONE[state] || 'busy';
    const account = data.account || 0;
    if (account) meta.account.textContent = String(account);
    statusBox.dataset.tone = tone;
    statusText.textContent = TEXT[state] ? (TEXT[state] + (data.reason ? '（' + data.reason + '）' : '')) : (state || '未知状态');

    if (state === 'online') {
      stopTicking();
      setOverlay('success', '登录成功', account ? '账号 ' + account + ' 已上线，协议端可用。' : '协议端已上线。');
      hint.textContent = '已建立 QQ 会话，可在 AstrBot / NoneBot / Koishi 中连接。';
      setButton('重新登录', false);
      meta.account.textContent = account ? String(account) : '已登录';
      loadOverview();
      return;
    }
    if (state === 'waiting_scan') {
      setOverlay(null);
      setButton('刷新二维码', false);
      hint.textContent = '打开手机 QQ → 扫一扫，扫描上方二维码。';
      return;
    }
    if (state === 'waiting_confirm') {
      stopTicking();
      setOverlay('scan', '已扫码', '请在手机上确认登录。若已过期，请刷新二维码。');
      setButton('刷新二维码', false);
      hint.textContent = '等待手机端确认…';
      return;
    }
    if (state === 'authenticating' || state === 'authenticated' || state === 'initializing_session') {
      stopTicking();
      setOverlay('scan', '确认成功', '正在建立会话，请稍候…');
      setButton('请稍候…', true);
      hint.textContent = '正在初始化 QQ 会话，首次登录可能需要十几秒。';
      return;
    }
    if (state === 'expired') {
      stopTicking();
      setOverlay('expired', '二维码已过期', '重新获取后请尽快扫描。');
      setButton('重新获取', false);
      hint.textContent = '二维码有效期约 2 分钟，过期后需要重新获取。';
      return;
    }
    if (TERMINAL.includes(state) || state === 'login_required') {
      stopTicking();
      setOverlay('error', TEXT[state] || '登录失败', data.reason || '请重新获取二维码后重试。');
      setButton('重试', false);
      hint.textContent = '如果反复失败，请查看终端日志或 host-stderr.log。';
      return;
    }
    setOverlay(null);
    setButton('获取二维码', true);
  }

  async function start() {
    if (busy) return;
    busy = true; handle = null;
    clearTimeout(pollTimer);
    setButton('正在获取…', true);
    showEmpty();
    statusBox.dataset.tone = 'busy'; statusText.textContent = '正在向 QQ 申请二维码…';
    hint.textContent = '正在向 QQ 申请二维码，请稍候…';
    try {
      const response = await fetch(BASE + '/start', { method: 'POST', cache: 'no-store' });
      const result = await response.json();
      if (result.status !== 'ok') throw new Error(result.message || '请求失败');
      const data = result.data || {};
      if (data.state === 'online') { apply({ state: 'online', account: data.account }); return; }
      if (data.qrcode) {
        handle = data.handle || null;
        expiresAt = Number(data.expires_at) || 0;
        showQr(data.qrcode, expiresAt);
        apply({ state: data.state || 'waiting_scan', account: data.account });
        stopTicking();
        tick();
        tickTimer = setInterval(tick, 500);
        poll();
      } else {
        apply({ state: data.state || 'idle', account: data.account });
        setButton('获取二维码', false);
      }
    } catch (error) {
      apply({ state: 'qr_failed', reason: error.message });
    } finally {
      busy = false;
    }
  }

  async function poll() {
    clearTimeout(pollTimer);
    if (!handle) return;
    try {
      const response = await fetch(BASE + '/state?handle=' + encodeURIComponent(handle), { cache: 'no-store' });
      const result = await response.json();
      if (result.status === 'ok') {
        const data = result.data || {};
        if (data.expires_at && !expiresAt) { expiresAt = Number(data.expires_at); issuedAt = expiresAt - 118000; }
        apply(data);
        if (data.state === 'online') return;
        if (TERMINAL.includes(data.state) || data.state === 'login_required') return;
      }
    } catch (ignored) { /* transient: keep polling */ }
    if (state === 'expired') return;
    pollTimer = setTimeout(poll, 1600);
  }

  function maskToken(value) {
    return '•'.repeat(Math.min(18, Math.max(8, value.length - 4))) + value.slice(-4);
  }
  function paintReverse(reverse) {
    const links = Array.isArray(reverse.links) ? reverse.links : [];
    const active = links.filter(link => link.enable !== false);
    if (active.length) {
      revTargets.textContent = active.map(link => link.url).join('   ');
      revTargets.dataset.value = active.map(link => link.url).join(',');
    } else {
      revTargets.textContent = links.length ? '已全部停用' : '未配置';
      delete revTargets.dataset.value;
    }
    revConfig.hidden = reverse.manageable !== true;

    if (reverse.token) {
      revToken.dataset.value = reverse.token;
      revToken.dataset.revealed = '0';
      revToken.textContent = maskToken(reverse.token);
      revReveal.hidden = false;
      revReveal.textContent = '显示';
    } else {
      delete revToken.dataset.value;
      revToken.textContent = '沿用 Access Token';
      revReveal.hidden = true;
    }

    let note = '';
    if (reverse.connected) note = '已连接 ' + reverse.connected + ' 条。';
    else if (active.length) note = '已配置 ' + active.length + ' 条，登录成功后才会建连。';
    else if (reverse.shared) note = '未独立设置 REVERSE_WS_TOKEN，反向 WS 复用 ONEBOT_ACCESS_TOKEN（不在页面展示）。';
    else note = '还没配置反向连接。点「配置」填 AstrBot 那边的 ws:// 地址。';
    revNote.hidden = !note;
    revNote.textContent = note;
    if (reverse.connected) revNote.dataset.on = '1'; else delete revNote.dataset.on;
  }

  let netLinks = [];
  function netRow(link, index) {
    const row = document.createElement('div');
    row.className = 'net-row';
    row.dataset.index = String(index);
    row.innerHTML = '<label class="switch"><input type="checkbox" data-role="enable"><span></span></label>'
      + '<div class="net-fields">'
      + '<input class="net-input" data-role="url" spellcheck="false" placeholder="ws://127.0.0.1:6199/ws">'
      + '<input class="net-input" data-role="token" spellcheck="false" placeholder="Token（留空沿用默认）">'
      + '</div>'
      + '<span class="net-state" data-role="state"></span>'
      + '<button class="net-del" data-role="del" type="button">删除</button>';
    row.querySelector('[data-role="enable"]').checked = link.enable !== false;
    row.querySelector('[data-role="url"]').value = link.url || '';
    row.querySelector('[data-role="token"]').value = link.token || '';
    const state = row.querySelector('[data-role="state"]');
    if (link.connected) { state.textContent = '已连接'; state.dataset.on = '1'; }
    else if (link.error) { state.textContent = '连接失败'; state.dataset.on = 'error'; }
    else { state.textContent = link.enable === false ? '已停用' : '待连接'; }
    return row;
  }
  function renderNet() {
    netRows.textContent = '';
    if (!netLinks.length) {
      const empty = document.createElement('p');
      empty.className = 'net-empty';
      empty.textContent = '还没有反向连接。点下面「添加一条」填 AstrBot 的地址。';
      netRows.appendChild(empty);
      return;
    }
    netLinks.forEach((link, index) => netRows.appendChild(netRow(link, index)));
  }
  async function openNet() {
    netMsg.dataset.tone = '';
    netMsg.textContent = '读取中…';
    netLinks = [];
    renderNet();
    if (!netDialog.open) netDialog.showModal();
    try {
      const response = await fetch(BASE + '/network', { cache: 'no-store' });
      const result = await response.json();
      if (result.status !== 'ok') throw new Error(result.message || '读取失败');
      netLinks = (result.data.links || []).map(link => ({ ...link }));
      netMsg.textContent = '';
      renderNet();
    } catch (error) {
      netMsg.dataset.tone = 'error';
      netMsg.textContent = error.message;
    }
  }
  async function saveNet() {
    netSave.disabled = true;
    netMsg.dataset.tone = '';
    netMsg.textContent = '保存中…';
    try {
      const response = await fetch(BASE + '/network', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ links: netLinks }) });
      const result = await response.json();
      if (result.status !== 'ok') throw new Error(result.message || '保存失败');
      netLinks = (result.data.links || []).map(link => ({ ...link }));
      renderNet();
      netMsg.dataset.tone = 'ok';
      netMsg.textContent = '已保存，正在重连…';
      setTimeout(() => { netDialog.close(); loadOverview(); }, 800);
    } catch (error) {
      netMsg.dataset.tone = 'error';
      netMsg.textContent = error.message;
    } finally {
      netSave.disabled = false;
    }
  }

  async function loadOverview() {
    clearTimeout(overviewTimer);
    try {
      const response = await fetch(BASE + '/overview', { cache: 'no-store' });
      const result = await response.json();
      if (result.status === 'ok' && result.data) {
        const data = result.data;
        if (data.endpoints) {
          if (data.endpoints.http) el('epHttp').textContent = data.endpoints.http;
          if (data.endpoints.ws) el('epWs').textContent = data.endpoints.ws;
          if (data.endpoints.event) el('epEvent').textContent = data.endpoints.event;
        }
        meta.kernel.textContent = data.kernel_version || (data.driver === 'demo' ? '模拟驱动' : '—');
        meta.uptime.textContent = fmtUptime(data.uptime_s);
        meta.clients.textContent = Number.isFinite(data.clients) ? data.clients + ' 个客户端' : '—';
        if (data.account) meta.account.textContent = String(data.account);
        if (data.reverse) paintReverse(data.reverse);
        if (data.online && state !== 'online' && state !== 'waiting_confirm' && !busy) apply({ state: 'online', account: data.account });
      }
    } catch (ignored) { /* older build without /overview */ }
    overviewTimer = setTimeout(loadOverview, 5000);
  }

  /* endpoints fallback: derive from the page origin so the rows are useful immediately */
  (() => {
    const origin = location.origin;
    const ws = origin.replace(/^http/, 'ws');
    el('epHttp').textContent = origin;
    el('epWs').textContent = ws + '/';
    el('epEvent').textContent = ws + '/event';
  })();

  document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const node = el(button.dataset.copy);
      const text = node ? (node.dataset.value !== undefined ? node.dataset.value : node.textContent) : '';
      if (!text || text === '—' || text === '未配置') return;
      try {
        await navigator.clipboard.writeText(text);
        button.textContent = '已复制';
        button.classList.add('done');
        setTimeout(() => { button.textContent = '复制'; button.classList.remove('done'); }, 1400);
      } catch { say('复制失败，请手动选择文本'); }
    });
  });

  el('theme').addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.theme = next;
    try { localStorage.setItem('limen-theme', next); } catch {}
  });

  revConfig.addEventListener('click', openNet);
  netAdd.addEventListener('click', () => {
    netLinks.push({ id: '', enable: true, url: '', token: '', connected: false, error: '' });
    renderNet();
    const inputs = netRows.querySelectorAll('[data-role="url"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
  });
  netRows.addEventListener('input', event => {
    const row = event.target.closest('.net-row');
    if (!row) return;
    const link = netLinks[Number(row.dataset.index)];
    if (!link) return;
    const role = event.target.dataset.role;
    if (role === 'url') link.url = event.target.value.trim();
    else if (role === 'token') link.token = event.target.value;
    else if (role === 'enable') link.enable = event.target.checked;
  });
  netRows.addEventListener('click', event => {
    if (event.target.dataset.role !== 'del') return;
    const row = event.target.closest('.net-row');
    if (!row) return;
    netLinks.splice(Number(row.dataset.index), 1);
    renderNet();
  });
  netSave.addEventListener('click', saveNet);
  netCancel.addEventListener('click', () => netDialog.close());
  netClose.addEventListener('click', () => netDialog.close());

  refreshBtn.addEventListener('click', start);
  revReveal.addEventListener('click', () => {
    const value = revToken.dataset.value || '';
    if (!value) return;
    const revealed = revToken.dataset.revealed === '1';
    revToken.dataset.revealed = revealed ? '0' : '1';
    revToken.textContent = revealed ? maskToken(value) : value;
    revReveal.textContent = revealed ? '显示' : '隐藏';
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && handle && state !== 'online') poll();
  });

  apply({ state: 'idle' });
  start();
  loadOverview();
})();
</script>
</body>
</html>`;
}
