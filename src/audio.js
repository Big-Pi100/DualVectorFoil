/* audio.js — 全部现场合成，不加载任何音频文件。
 *
 * 为什么不用音频文件：
 *   1. 单文件 HTML 不能被 3MB 的 mp3 撑爆；
 *   2. 音乐授权是最容易被下架的一环（版号也要查）；
 *   3. 现场合成 = 参数化，改一个数值整个气氛就变，比重新导出音频快一个数量级。
 *
 * 音色设计对应世界观：冷、薄、有纸的质感。
 *   - 底噪层：带通白噪（纸在动）
 *   - 持续层：两个低音三角波，微微失谐（不和谐但不刺）
 *   - 点状层：D 小调五声音阶的稀疏单音，长衰减 + 延迟空间
 *   没有鼓，没有和声进行。它不该有"节奏"，只有"时间在过"。
 */
(function () {
  var ctx = null, master = null, musicBus = null, sfxBus = null, verb = null;
  var noiseBuf = null, started = false, muted = false, timer = null;
  var nextNote = 0, stepN = 0;

  // D 小调五声：D F G A C
  var SCALE = [146.83, 174.61, 196.00, 220.00, 261.63, 293.66, 349.23];

  function now() { return ctx ? ctx.currentTime : 0; }

  function init() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }

    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    // 轻压缩：合成器叠加很容易削顶，压一下比事后调音量可靠
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.knee.value = 24;
    comp.ratio.value = 3.5; comp.attack.value = 0.004; comp.release.value = 0.15;
    comp.connect(master);

    musicBus = ctx.createGain(); musicBus.gain.value = 0.0001; musicBus.connect(comp);
    sfxBus   = ctx.createGain(); sfxBus.gain.value   = 0.55;   sfxBus.connect(comp);

    // 简易空间：反馈延迟 + 低通（比卷积混响省一个数量级的 CPU）
    verb = ctx.createDelay(1.0);
    verb.delayTime.value = 0.29;
    var fb = ctx.createGain(); fb.gain.value = 0.34;
    var lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000;
    verb.connect(lp); lp.connect(fb); fb.connect(verb);
    var wet = ctx.createGain(); wet.gain.value = 0.5;
    verb.connect(wet); wet.connect(comp);

    // 白噪缓冲（2 秒，够所有短促音共用）
    var n = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, n, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;

    return ctx;
  }

  function noise(dur, gain, type, freq, q, dest) {
    var s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    var f = ctx.createBiquadFilter();
    f.type = type || 'bandpass'; f.frequency.value = freq || 1200; f.Q.value = q || 1;
    var g = ctx.createGain();
    var t = now();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || sfxBus);
    s.start(t); s.stop(t + dur + 0.02);
    return { f: f, t: t };
  }

  function tone(freq, dur, gain, type, slideTo, dest) {
    var o = ctx.createOscillator();
    o.type = type || 'sine';
    var g = ctx.createGain();
    var t = now();
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  /* ---------------- 音效 ---------------- */
  function play(name) {
    if (!ctx || muted) return;
    if (ctx.state === 'suspended') {
      var pr2 = ctx.resume();
      if (pr2 && pr2.catch) pr2.catch(function () {});
    }
    switch (name) {
      case 'step':                       // 脚步：不音高，只换频段，避免"电子鼓"
        stepN = (stepN + 1) % 4;
        noise(0.055, 0.055, 'bandpass', 780 + stepN * 70, 1.4);
        noise(0.03, 0.03, 'highpass', 3200, 0.7);
        break;
      case 'jump':
        tone(300, 0.10, 0.055, 'sine', 470);
        noise(0.09, 0.028, 'highpass', 1800, 0.8);
        break;
      case 'djump':
        tone(430, 0.13, 0.06, 'triangle', 700);
        noise(0.12, 0.035, 'highpass', 2400, 0.8);
        break;
      case 'swing':                      // 出拳：布被划开，不是金属
        var s = noise(0.13, 0.075, 'bandpass', 1700, 0.9);
        s.f.frequency.setValueAtTime(1900, s.t);
        s.f.frequency.exponentialRampToValueAtTime(520, s.t + 0.13);
        break;
      case 'hit':
        noise(0.06, 0.10, 'highpass', 1400, 0.7);
        tone(190, 0.10, 0.16, 'sine', 62);       // 闷的低音才是"打实了"
        break;
      case 'hurt':
        tone(240, 0.20, 0.10, 'sawtooth', 92);
        noise(0.10, 0.06, 'bandpass', 900, 1.2);
        break;
      /* 'paper' 音效（侧身时纸对折的那一下）随侧身一起删了：没有调用方，
       * 留着就是一段永远不会响的音频设计。想找回看 .bak/pre_unflat_20261125/。 */
      case 'land':
        tone(105, 0.11, 0.10, 'sine', 46);
        noise(0.07, 0.045, 'lowpass', 700, 0.8);
        break;
      case 'slam':
        tone(78, 0.22, 0.14, 'sine', 34);
        noise(0.14, 0.06, 'lowpass', 480, 0.7);
        break;
      case 'pickup':                     // 拾取：两声，第二声高一个五度
        tone(659.25, 0.45, 0.055, 'sine');
        tone(987.77, 0.55, 0.040, 'sine');
        break;
      case 'shutter':                    // 快门：两声机械"咔"，这才是二向箔
        noise(0.018, 0.20, 'highpass', 2600, 0.8);
        setTimeout(function () {
          if (ctx && !muted) noise(0.026, 0.16, 'bandpass', 1500, 2.2);
        }, 85);
        break;
      case 'portal':
        tone(180, 0.5, 0.06, 'triangle', 300);
        break;
      case 'death':
        tone(320, 0.7, 0.10, 'triangle', 60);
        break;
    }
  }

  /* ---------------- 音乐 ---------------- */
  function startMusic() {
    if (started || !ctx) return;
    started = true;

    // 1) 持续层：两根低音，失谐 0.6%，慢速滤波扫动
    var lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 2.5;
    var g = ctx.createGain(); g.gain.value = 0.075;
    lp.connect(g); g.connect(musicBus);
    [73.42, 110.0, 146.83].forEach(function (f, i) {
      var o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'triangle';
      o.frequency.value = f * (1 + (i - 1) * 0.0035);
      var og = ctx.createGain(); og.gain.value = i === 2 ? 0.35 : 0.8;
      o.connect(og); og.connect(lp); o.start();
    });
    // 极慢的滤波呼吸：0.03Hz ≈ 33 秒一个来回，听不出周期但能感到"在动"
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.03;
    var lfoG = ctx.createGain(); lfoG.gain.value = 200;
    lfo.connect(lfoG); lfoG.connect(lp.frequency); lfo.start();

    // 2) 纸层：带通白噪，慢速起伏
    var pn = ctx.createBufferSource(); pn.buffer = noiseBuf; pn.loop = true;
    var pf = ctx.createBiquadFilter(); pf.type = 'bandpass'; pf.frequency.value = 2400; pf.Q.value = 0.6;
    var pg = ctx.createGain(); pg.gain.value = 0.004;
    pn.connect(pf); pf.connect(pg); pg.connect(musicBus); pn.start();
    var pl = ctx.createOscillator(); pl.frequency.value = 0.07;
    var plg = ctx.createGain(); plg.gain.value = 0.003;
    pl.connect(plg); plg.connect(pg.gain); pl.start();

    // 3) 点状层：稀疏单音，间隔随机 3.5~9s
    nextNote = now() + 2.0;
    timer = setInterval(schedule, 220);

    // 淡入 3 秒，别一开场就压上来
    var t = now();
    musicBus.gain.cancelScheduledValues(t);
    musicBus.gain.setValueAtTime(0.0001, t);
    musicBus.gain.linearRampToValueAtTime(0.5, t + 3.0);
  }

  function schedule() {
    if (!ctx || muted) return;
    var t = now();
    while (nextNote < t + 0.5) {
      var f = SCALE[Math.floor(Math.random() * SCALE.length)];
      // 旋律只走高音区（×2），低音区留给持续层，避免糊在一起
      var o = ctx.createOscillator();
      o.type = Math.random() < 0.3 ? 'triangle' : 'sine';
      o.frequency.value = f * 2;
      var g = ctx.createGain();
      var dur = 2.2 + Math.random() * 1.8;
      g.gain.setValueAtTime(0.0001, nextNote);
      g.gain.linearRampToValueAtTime(0.030 + Math.random() * 0.014, nextNote + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, nextNote + dur);
      o.connect(g);
      g.connect(musicBus);
      g.connect(verb);
      o.start(nextNote); o.stop(nextNote + dur + 0.05);

      // 偶尔补一个低八度，像影子
      if (Math.random() < 0.35) {
        var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f;
        var g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, nextNote);
        g2.gain.linearRampToValueAtTime(0.018, nextNote + 0.03);
        g2.gain.exponentialRampToValueAtTime(0.0001, nextNote + dur * 1.2);
        o2.connect(g2); g2.connect(verb);
        o2.start(nextNote); o2.stop(nextNote + dur * 1.2 + 0.05);
      }

      nextNote += 3.5 + Math.random() * 5.5;
    }
  }

  function setMuted(v) {
    muted = !!v;
    if (!master) return;
    var t = now();
    master.gain.cancelScheduledValues(t);
    master.gain.setTargetAtTime(muted ? 0 : 0.85, t, 0.08);
  }

  /* ---------------- 启动 ---------------- */
  // iOS：AudioContext 必须在用户手势里创建/恢复，且受静音拨片影响（Web 无解，需提示）
  function unlock() {
    if (!init()) return;
    if (ctx.state === 'suspended') {
      var pr = ctx.resume();
      if (pr && pr.catch) pr.catch(function () {});
    }
    startMusic();
  }

  window.__audio = {
    unlock: unlock,
    sfx: play,
    mute: setMuted,
    isMuted: function () { return muted; },
    get ready() { return !!ctx && ctx.state === 'running'; },
  };
  window.__sfx = play;

  ['pointerdown', 'touchstart', 'keydown'].forEach(function (ev) {
    window.addEventListener(ev, unlock, { once: true, passive: true });
  });
})();
