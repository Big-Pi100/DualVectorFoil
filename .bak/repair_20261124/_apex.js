#!/usr/bin/env node
// _apex.js — 临时探针：扫 P_JUMP_V，找"按住跳"的顶点正好落回 203.8px 的速度
// 用法: node _apex.js
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');

function fakeCtx() {
  const grad = { addColorStop() {} };
  return new Proxy({}, {
    get(t, k) {
      if (k === 'canvas') return { width: 960, height: 540 };
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
      if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
      if (k === 'measureText') return () => ({ width: 10 });
      return typeof k === 'string' ? (() => {}) : undefined;
    },
    set() { return true; },
  });
}
function el(id) {
  return {
    id, textContent: '', innerHTML: '', style: {}, width: 150, height: 120, value: '', className: '',
    files: [], classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    appendChild() {}, remove() {}, getContext: () => fakeCtx(), addEventListener() {}, click() {},
  };
}
const SRC = fs.readFileSync(path.join(__dirname, 'src', 'game.js'), 'utf8');

function boot(jumpV) {
  const els = new Map();
  const doc = {
    readyState: 'complete',
    getElementById: id => { if (!els.has(id)) els.set(id, el(id)); return els.get(id); },
    querySelector: s => { if (!els.has(s)) els.set(s, el(s)); return els.get(s); },
    createElement: t => el(t), addEventListener() {},
  };
  const listeners = {}; let rafCb = null; const store = new Map();
  const sb = {
    ATLAS_MAN: null, ATLAS_B64: '', document: doc,
    console: { log() {}, warn() {}, error() {} },
    Image: class { set src(v) {} }, URL: { createObjectURL: () => 'blob:x' },
    requestAnimationFrame: cb => { rafCb = cb; return 1; },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    setTimeout: () => 0,
    Math, Date, JSON, Object, Array, Set, Map, Number, String, Boolean,
    Uint8ClampedArray, isNaN, parseFloat, parseInt, isFinite,
    location: { search: '' }, URLSearchParams: class { get() { return null; } },
    localStorage: { getItem: k => store.has(k) ? store.get(k) : null,
                    setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    performance: { now: () => 0 },
  };
  sb.globalThis = sb; sb.window = sb;
  let code = SRC;
  if (jumpV != null) {
    if (code.indexOf('P_JUMP_V: 961,') < 0) throw new Error('没找到 P_JUMP_V: 961');
    code = code.replace('P_JUMP_V: 961,', 'P_JUMP_V: ' + jumpV + ',');
  }
  code += ';globalThis.__peek = () => ({ P, SAVE, room, loadRoom });';
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: 'game.js' });
  const key = (k, down = true) => {
    const ev = { key: k, preventDefault() {}, ctrlKey: false, repeat: false };
    (listeners[down ? 'keydown' : 'keyup'] || []).forEach(f => f(ev));
  };
  let t = 0;
  return { key, tick: ms => { t += ms; rafCb(t); }, st: () => sb.__sk.state(), peek: sb.__peek };
}

/* 顶点：物理步自己记的 airMinY，不靠采样。按住跳 800ms（穿过顶点窗口）。 */
function apexOf(jumpV, hz = 120) {
  const g = boot(jumpV);
  const fm = 1000 / hz;
  g.peek().loadRoom('hall', null, false);
  for (let i = 0; i < Math.round(800 / fm); i++) g.tick(fm);
  const y0 = g.st().y;
  g.key('k', true);
  for (let i = 0; i < Math.round(800 / fm); i++) g.tick(fm);
  g.key('k', false);
  for (let i = 0; i < Math.round(600 / fm); i++) g.tick(fm);
  const s = g.st();
  return { apex: y0 - s.airMinY, y0, yEnd: s.y, grounded: s.onGround };
}

// 二分：apex 单调随速度增
let lo = 940, hi = 1000;
const target = 203.8;
for (let it = 0; it < 26; it++) {
  const mid = (lo + hi) / 2;
  const a = apexOf(mid).apex;
  if (a < target) lo = mid; else hi = mid;
}
const best = (lo + hi) / 2;
console.log('二分结果 P_JUMP_V = ' + best.toFixed(3) + '  →  apex ' + apexOf(best).apex.toFixed(3));
console.log('\n速度        顶点(px)   落地');
for (const v of [961, 975, 979, 980, best, Math.round(best)]) {
  const r = apexOf(v);
  console.log(String(v.toFixed(3)).padStart(8) + '  ' + r.apex.toFixed(3).padStart(8) + '   ' + (r.grounded ? '✓' : '✗'));
}
console.log('\n跨帧率核对（用二分值）:');
for (const hz of [30, 60, 120, 144]) {
  const r = apexOf(best, hz);
  console.log('  ' + String(hz).padStart(4) + 'Hz  ' + r.apex.toFixed(3));
}
