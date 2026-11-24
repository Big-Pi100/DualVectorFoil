#!/usr/bin/env node
// _cmp.js — 同一把尺子量两个构建：S1 之前的旧循环 vs 现在（给定 P_JUMP_V）
// 目的：确认 203.8px 这个"原始顶点"是用同一种量法得到的，而不是换了尺子。
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
function boot(file, jumpV, djV) {
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
  let code = fs.readFileSync(file, 'utf8');
  if (jumpV != null) {
    if (code.indexOf('P_JUMP_V: 961,') < 0) throw new Error('没找到 P_JUMP_V: 961 in ' + file);
    code = code.replace('P_JUMP_V: 961,', 'P_JUMP_V: ' + jumpV + ',');
  }
  if (djV != null) code = code.replace('P_DJUMP_V: 783,', 'P_DJUMP_V: ' + djV + ',');
  code += ';globalThis.__peek = () => ({ P, SAVE, room, loadRoom });';
  vm.createContext(sb);
  vm.runInContext(code, sb, { filename: path.basename(file) });
  const key = (k, down = true) => {
    const ev = { key: k, preventDefault() {}, ctrlKey: false, repeat: false };
    (listeners[down ? 'keydown' : 'keyup'] || []).forEach(f => f(ev));
  };
  let t = 0;
  return { key, tick: ms => { t += ms; rafCb(t); }, st: () => sb.__sk.state(), peek: sb.__peek };
}

/* 只采样：每帧读一次 y 取最小值 —— 这是审计时用的量法，两个构建一视同仁 */
function sampleApex(file, jumpV, hz) {
  const g = boot(file, jumpV);
  const fm = 1000 / hz;
  g.peek().loadRoom('hall', null, false);
  for (let i = 0; i < Math.round(800 / fm); i++) g.tick(fm);
  const y0 = g.st().y;
  g.key('k', true);
  let minY = y0;
  for (let i = 0; i < Math.round(800 / fm); i++) { g.tick(fm); minY = Math.min(minY, g.st().y); }
  g.key('k', false);
  for (let i = 0; i < Math.round(600 / fm); i++) { g.tick(fm); minY = Math.min(minY, g.st().y); }
  return y0 - minY;
}

const OLD = path.join(__dirname, '.bak', '20261124', 'game.js');
const NEW = path.join(__dirname, 'src', 'game.js');
console.log('采样法（每帧读 y）量顶点：\n');
console.log('构建                         30Hz      60Hz      120Hz     144Hz');
for (const [name, file, v] of [
  ['旧循环 (S1 前, 961)', OLD, null],
  ['现循环 961', NEW, null],
  ['现循环 971.304', NEW, 971.304],
]) {
  const row = [30, 60, 120, 144].map(hz => sampleApex(file, v, hz).toFixed(2).padStart(9));
  console.log(name.padEnd(24) + row.join('  '));
}

/* 二段跳：起跳 → 250ms 后松手 → 60ms 后再按（在空中）→ 按住到底。
 * 量总顶点（从地面到最高点），同样只采样，两个构建一视同仁。 */
function sampleDouble(file, jumpV, djV, hz) {
  const g = boot(file, jumpV, djV);
  const fm = 1000 / hz;
  g.peek().SAVE.owned.add('djump');       // 二段跳要能力门
  g.peek().loadRoom('hall', null, false);
  for (let i = 0; i < Math.round(800 / fm); i++) g.tick(fm);
  const y0 = g.st().y;
  let minY = y0;
  const step = n => { for (let i = 0; i < Math.round(n / fm); i++) { g.tick(fm); minY = Math.min(minY, g.st().y); } };
  g.key('k', true);  step(250);
  g.key('k', false); step(60);
  g.key('k', true);  step(1400);
  g.key('k', false); step(600);
  return y0 - minY;
}
console.log('\n二段跳总顶点：');
console.log('构建                         30Hz      60Hz      120Hz     144Hz');
for (const [name, file, v, dv] of [
  ['旧循环 (961/783)', OLD, null, null],
  ['现循环 (961/783)', NEW, null, null],
  ['现循环 (971.3/783)', NEW, 971.3, null],
  ['现循环 (971.3/791.4)', NEW, 971.3, 791.4],
]) {
  const row = [30, 60, 120, 144].map(hz => sampleDouble(file, v, dv, hz).toFixed(2).padStart(9));
  console.log(name.padEnd(24) + row.join('  '));
}

/* 二段跳的**增量**（从按第二下那一点再往上升多少）。
 * 总顶点测不准是输入量化的锅：第二下按在第 250ms，30Hz 和 120Hz 落在弧线的不同高度。
 * 增量才是 P_DJUMP_V 的函数，和"什么时候按"关系小得多。 */
function djIncrement(file, jumpV, djV, hz) {
  const g = boot(file, jumpV, djV);
  const fm = 1000 / hz;
  g.peek().SAVE.owned.add('djump');
  g.peek().loadRoom('hall', null, false);
  for (let i = 0; i < Math.round(800 / fm); i++) g.tick(fm);
  const step = n => { for (let i = 0; i < Math.round(n / fm); i++) g.tick(fm); };
  g.key('k', true); step(600);        // 单跳，按住穿过顶点窗口
  g.key('k', false); step(fm);
  const yAt = g.st().y;               // 第二下按下的位置
  let minY = yAt;
  g.key('k', true);
  for (let i = 0; i < Math.round(1200 / fm); i++) { g.tick(fm); minY = Math.min(minY, g.st().y); }
  g.key('k', false);
  return { inc: yAt - minY, yAt, jumps: g.st().jumps };
}
console.log('\n二段跳增量（从按下点再升）：');
console.log('构建                         30Hz      60Hz      120Hz     144Hz');
for (const [name, file, v, dv] of [
  ['旧循环 (783)', OLD, null, null],
  ['现循环 (783)', NEW, null, null],
]) {
  const row = [30, 60, 120, 144].map(hz => djIncrement(file, v, dv, hz));
  console.log(name.padEnd(24) + row.map(r => r.inc.toFixed(2).padStart(9)).join('  ') +
              '   jumps=' + row.map(r => r.jumps).join(','));
}

/* DJUMP 标定：让新循环的二段跳增量 = 旧循环 60Hz 的那个值（136.34 = 玩家真正摸到的手感） */
if (process.argv.includes('--cal')) {
  const want = djIncrement(OLD, null, null, 60).inc;
  let lo = 780, hi = 830;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    const inc = djIncrement(NEW, 971.3, mid, 60).inc;
    if (inc < want) lo = mid; else hi = mid;
  }
  const best = (lo + hi) / 2;
  console.log('\nDJUMP 标定: 目标增量 ' + want.toFixed(3) + 'px → P_DJUMP_V = ' + best.toFixed(2) +
              ' (增量 ' + djIncrement(NEW, 971.3, best, 60).inc.toFixed(3) + ')');
  console.log('  比值 DJUMP/JUMP = ' + (best / 971.3).toFixed(4) + '（原来是 ' + (783 / 961).toFixed(4) + '）');
  for (const hz of [30, 60, 120, 144]) {
    console.log('  ' + String(hz).padStart(4) + 'Hz 增量 ' + djIncrement(NEW, 971.3, best, hz).inc.toFixed(3));
  }
}
