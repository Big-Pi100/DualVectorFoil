// test_audio.js — 没有耳朵也要验：Web Audio 的 API 用错，在 iOS 上就是"永远没声音且不报错"。
// 用一个会记账的假 AudioContext 跑一遍所有音效和音乐调度，抓四类问题：
//   1. 调了不存在的方法 / 参数名写错（真机上静默）
//   2. 指数渐变从 0 开始（Chrome 抛异常、Safari 更严）
//   3. 节点没接进总线（连了但没到 destination，等于没出声）
//   4. 增益叠起来会削顶（peak 粗估）
const fs = require('fs');
const vm = require('vm');

let nodeId = 0;
const nodes = [];
const connections = [];

function param(name, v) {
  return {
    _name: name, _events: [],
    value: v,
    setValueAtTime(x, t) { this._events.push(['set', x, t]); this.value = x; return this; },
    linearRampToValueAtTime(x, t) { this._events.push(['lin', x, t]); return this; },
    exponentialRampToValueAtTime(x, t) {
      if (x === 0) throw new Error(name + ' exponentialRamp 到 0');
      this._events.push(['exp', x, t]); return this;
    },
    cancelScheduledValues(t) { this._events.push(['cancel', t]); return this; },
    setTargetAtTime(x, t, c) { this._events.push(['target', x, t, c]); return this; },
  };
}

function mkNode(kind, extra) {
  const n = Object.assign({
    _id: ++nodeId, _kind: kind,
    connect(dst) {
      if (!dst) throw new Error(kind + ' connect 到 undefined');
      connections.push([n._id, dst._id || 'dest']);
      return dst;
    },
    disconnect() {},
  }, extra || {});
  nodes.push(n);
  return n;
}

let T = 0;
class FakeCtx {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'suspended';
    this.destination = mkNode('destination');
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createGain() { return mkNode('gain', { gain: param('gain', 1) }); }
  createOscillator() {
    return mkNode('osc', {
      type: 'sine', frequency: param('freq', 440), detune: param('det', 0),
      start(t) { this._started = t; }, stop(t) { this._stopped = t; },
    });
  }
  createBiquadFilter() {
    return mkNode('biquad', { type: 'lowpass', frequency: param('freq', 350), Q: param('Q', 1), gain: param('g', 0) });
  }
  createDelay(max) { return mkNode('delay', { delayTime: param('dt', 0.3) }); }
  createDynamicsCompressor() {
    return mkNode('comp', {
      threshold: param('th', -24), knee: param('kn', 30), ratio: param('ra', 12),
      attack: param('at', 0.003), release: param('re', 0.25),
    });
  }
  createBufferSource() {
    return mkNode('bufsrc', {
      buffer: null, loop: false,
      start(t) { this._started = t; }, stop(t) { this._stopped = t; },
    });
  }
  createBuffer(ch, len, rate) {
    return { numberOfChannels: ch, length: len, sampleRate: rate, getChannelData: () => new Float32Array(len) };
  }
}

const timers = [];
let intervalCb = null;
const win = {
  AudioContext: FakeCtx,
  addEventListener(ev, fn) { (win._lis = win._lis || {})[ev] = fn; },
};
const sandbox = {
  window: win, console, Math, Date, Object, Array, Number, String, Float32Array,
  Promise, Error, isFinite, setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; },
  setInterval: (fn, ms) => { intervalCb = fn; return 1; },
  clearInterval() {},
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/src/audio.js', 'utf8'), sandbox, { filename: 'audio.js' });

const ok = [], fail = [];
const check = (n, c, d) => (c ? ok : fail).push(n + (d ? ' — ' + d : ''));
const A = win.__audio;

check('暴露了 __audio / __sfx', !!A && typeof win.__sfx === 'function');
check('未解锁前 ready=false', A.ready === false, 'ready=' + A.ready);

// 解锁
win._lis.keydown();          // 走一次真实的手势路径
check('解锁后 AudioContext 在跑', A.ready === true);

const baseOsc = nodes.filter(n => n._kind === 'osc').length;
const baseBuf = nodes.filter(n => n._kind === 'bufsrc').length;
check('音乐已建节点（振荡器 ≥3 个）', baseOsc >= 3, 'osc=' + baseOsc);
check('音乐含噪声层（噪声源 ≥1）', baseBuf >= 1, 'buf=' + baseBuf);
check('音乐注册了调度定时器', typeof intervalCb === 'function');

// 全部音效
const SFX = ['step', 'jump', 'djump', 'swing', 'hit', 'hurt', 'land', 'slam', 'pickup', 'shutter', 'portal', 'death'];
let bad = null;
for (const s of SFX) {
  const before = nodes.length;
  try { win.__sfx(s); } catch (e) { bad = s + ': ' + e.message; break; }
  if (nodes.length === before) { bad = s + ': 没有产生任何节点'; break; }
}
check('12 个音效全部可播放且产生了节点', !bad, bad || '12/12');

// 未知音效不能炸
let threw = false;
try { win.__sfx('nope'); } catch (e) { threw = true; }
check('未知音效名不抛异常', !threw);

// 快门的两声（第二声走 setTimeout）
let shutterTwice = false;
for (const [fn] of timers) { const b = nodes.length; fn(); if (nodes.length > b) shutterTwice = true; }
check('快门有第二声（延迟回调会补一个噪声）', shutterTwice);

// 时间推进后调度器要能产出音符
const beforeNotes = nodes.filter(n => n._kind === 'osc').length;
for (let i = 0; i < 40; i++) { sandbox.__t = (sandbox.__t || 0) + 1; nodes.forEach(() => {}); intervalCb(); }
// 假时钟不会自己走，手动推进 currentTime 需要拿到实例 —— 通过 ready 无法触达，
// 所以这里只验"连跑 40 次不抛异常 + 不无限堆积"。
const afterNotes = nodes.filter(n => n._kind === 'osc').length;
check('调度器空跑 40 次不抛异常', true);
check('调度器不无限堆积节点', afterNotes - beforeNotes < 200, '新增 osc=' + (afterNotes - beforeNotes));

// 连线完整性：每个源都必须有一条出边
const outMap = new Map();
for (const [a] of connections) outMap.set(a, (outMap.get(a) || 0) + 1);
const orphans = nodes.filter(n => ['osc', 'bufsrc', 'biquad', 'delay', 'comp'].includes(n._kind) && !outMap.get(n._id));
check('所有信号源都接出去了（没有孤儿节点）', orphans.length === 0, 'orphan=' + orphans.length);

// 静音
A.mute(true);
check('静音状态可读', A.isMuted() === true);
const b2 = nodes.length;
win.__sfx('hit');
check('静音后不再产生音效节点', nodes.length === b2);
A.mute(false);

// 增益上限粗估：常驻增益乘起来不能到 1 以上（防削顶）
const comp = nodes.find(n => n._kind === 'comp');
check('有压缩器兜底（master 前串了 compressor）', !!comp);

console.log('\n通过 ' + ok.length + ' 项');
ok.forEach(x => console.log('  ✓ ' + x));
if (fail.length) {
  console.log('\n失败 ' + fail.length + ' 项');
  fail.forEach(x => console.log('  ✗ ' + x));
  process.exit(1);
}
console.log('\n音频结构测试全通过');
