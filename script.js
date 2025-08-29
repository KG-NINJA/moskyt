// ===== Audio (tone / FM) =====
let audioCtx = null;
let carrier = null;   // キャリア（可聴/高周波）
let mod = null;       // モジュレータ（FM時に使用）
let modGain = null;   // モジュレーション深度
let gainNode = null;
let analyser = null;  // レベルメーター用
let meterRAF = null;
let shaper = null;    // 歪み用 Waveshaper

const els = {
  toggleBtn: document.getElementById('toggleBtn'),
  statusBadge: document.getElementById('statusBadge'),
  modeSelect: document.getElementById('modeSelect'),
  freq: document.getElementById('freq'),
  freqVal: document.getElementById('freqVal'),
  gain: document.getElementById('gain'),
  gainVal: document.getElementById('gainVal'),
  btnGood: document.getElementById('btnGood'),
  btnBad: document.getElementById('btnBad'),
  btnUnknown: document.getElementById('btnUnknown'),
  btnShare: document.getElementById('btnShare'),
  btnTest: document.getElementById('btnTest'),
  dbgAudibleFM: document.getElementById('dbgAudibleFM'),
  mosqWrap: document.getElementById('mosqWrap'),
  rtStatus: document.getElementById('rtStatus'),
  carrierWave: document.getElementById('carrierWave'),
  modWave: document.getElementById('modWave'),
  fmRate: document.getElementById('fmRate'),
  fmRateVal: document.getElementById('fmRateVal'),
  fmDepth: document.getElementById('fmDepth'),
  fmDepthVal: document.getElementById('fmDepthVal'),
  distEnable: document.getElementById('distEnable'),
  distDrive: document.getElementById('distDrive'),
  distDriveVal: document.getElementById('distDriveVal'),
};

// 念のため、ボタンが無効化されていたら解除
try { els.toggleBtn?.removeAttribute('disabled'); } catch {}

function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (!gainNode) {
    gainNode = audioCtx.createGain();
    setGainFromUI();
  }
  if (!analyser) {
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
  }
  // 配線: gain -> analyser -> destination（毎回明示的に張り直し）
  try { gainNode.disconnect(); } catch {}
  gainNode.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function startSound() {
  ensureAudio();
  stopSound(true);

  const f0 = Number(els.freq.value);
  const mode = els.modeSelect.value; // 'tone' | 'fm'
  const dbgAudible = !!els.dbgAudibleFM?.checked;

  // キャリア
  carrier = audioCtx.createOscillator();
  carrier.type = (els.carrierWave?.value || 'square');
  carrier.frequency.setValueAtTime(f0, audioCtx.currentTime);
  rebuildPostChain();

  if (mode === 'fm') {
    // FM: 可聴デバッグONなら耳で確認しやすい設定に切替
    mod = audioCtx.createOscillator();
    mod.type = (els.modWave?.value || 'sine');
    modGain = audioCtx.createGain();

    if (dbgAudible) {
      // 可聴帯域でFMを確認（4kHzキャリア、5Hzゆらぎ、depth≈120Hz）
      carrier.type = 'sine';
      carrier.frequency.setValueAtTime(4000, audioCtx.currentTime);
      mod.frequency.setValueAtTime(5, audioCtx.currentTime);
      modGain.gain.setValueAtTime(120, audioCtx.currentTime);
    } else {
      // 高周波用（60Hzゆらぎ、f0の約5%を深さ）
      const rate = Number(els.fmRate?.value || 60);
      mod.frequency.setValueAtTime(rate, audioCtx.currentTime);
      const depthHz = getEffectiveDepthHz(f0);
      modGain.gain.setValueAtTime(depthHz, audioCtx.currentTime);
    }

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    mod.start();

    // 蚊の逃走アニメ
    els.mosqWrap?.classList.add('escape');
  } else {
    els.mosqWrap?.classList.remove('escape');
  }

  carrier.start();
  updateStatus(true);
  startLevelMeter();
}

function stopSound(silent = false) {
  if (carrier) {
    try { carrier.stop(); } catch {}
    try { carrier.disconnect(); } catch {}
    carrier = null;
  }
  if (mod) {
    try { mod.stop(); } catch {}
    try { mod.disconnect(); } catch {}
    mod = null;
  }
  if (modGain) {
    try { modGain.disconnect(); } catch {}
    modGain = null;
  }
  if (shaper) {
    try { shaper.disconnect(); } catch {}
    shaper = null;
  }
  if (!silent) updateStatus(false);
  stopLevelMeter();
}

function updateStatus(isOn) {
  els.statusBadge.textContent = isOn ? 'Playing' : 'Stopped';
  els.statusBadge.classList.toggle('on', isOn);
  els.statusBadge.classList.toggle('off', !isOn);
  els.toggleBtn.textContent = isOn ? 'Stop' : 'Play';
}

function setFreqFromUI() {
  const f = Number(els.freq.value);
  els.freqVal.textContent = String(f);
  if (carrier) {
    carrier.frequency.setValueAtTime(f, audioCtx.currentTime);
  }
}

function setGainFromUI() {
  const percent = Number(els.gain.value);
  els.gainVal.textContent = String(percent);
  const g = Math.pow(percent / 100, 2) * 0.3; // 上限0.3
  if (gainNode) {
    gainNode.gain.setTargetAtTime(g, audioCtx?.currentTime || 0, 0.01);
  }
}

// ===== FM UI Helpers =====
function getEffectiveDepthHz(f0) {
  const slider = Number(els.fmDepth?.value || 0);
  // 0 の場合は自動（約5%）で最低100Hz
  return slider > 0 ? slider : Math.max(100, f0 * 0.05);
}

function updateFmLabels() {
  if (!els.fmRateVal || !els.fmDepthVal) return;
  const f0 = Number(els.freq.value);
  els.fmRateVal.textContent = String(Number(els.fmRate?.value || 60));
  const depthSlider = Number(els.fmDepth?.value || 0);
  if (depthSlider === 0) {
    els.fmDepthVal.textContent = 'Auto (≈5%)';
  } else {
    els.fmDepthVal.textContent = `${depthSlider}` + ' Hz';
  }
  if (els.distDriveVal) {
    els.distDriveVal.textContent = (Number(els.distDrive?.value || 0)).toFixed(2);
  }
}

function makeDistortionCurve(amount = 0) {
  const k = Math.max(0, amount) * 100; // 0..100 を内部スケール
  const n = 1024;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1; // -1..1
    // arctan系のソフトクリップ
    curve[i] = (1 + k) * x / (1 + k * Math.abs(x));
  }
  return curve;
}

function rebuildPostChain() {
  if (!audioCtx || !carrier || !gainNode) return;
  try { carrier.disconnect(); } catch {}
  if (els.distEnable?.checked) {
    if (!shaper) shaper = audioCtx.createWaveShaper();
    const drive = Number(els.distDrive?.value || 0);
    shaper.curve = makeDistortionCurve(drive);
    shaper.oversample = '4x';
    carrier.connect(shaper);
    shaper.connect(gainNode);
  } else {
    carrier.connect(gainNode);
  }
}

// 1kHz テスト音（1秒）
async function playTestBeep() {
  ensureAudio();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  const tOsc = audioCtx.createOscillator();
  const tGain = audioCtx.createGain();
  tOsc.type = 'sine';
  tOsc.frequency.setValueAtTime(1000, audioCtx.currentTime);
  // クリックノイズを避けるための短いエンベロープ
  const now = audioCtx.currentTime;
  tGain.gain.setValueAtTime(0.0001, now);
  tGain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
  tGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
  // メインのゲインをバイパスし、直接アナライザと出力へ
  // こうすることで、UIの音量が小さくてもテスト音は確実に可聴・可視化される
  tOsc.connect(tGain);
  if (analyser) {
    tGain.connect(analyser);
  }
  tGain.connect(audioCtx.destination);
  tOsc.start(now);
  tOsc.stop(now + 1.1);
  tOsc.addEventListener('ended', () => {
    try { tOsc.disconnect(); } catch {}
    try { tGain.disconnect(); } catch {}
  });
  startLevelMeter();
}

// ===== Level Meter =====
function startLevelMeter() {
  const cvs = document.getElementById('levelMeter');
  if (!cvs || !analyser) return;
  const ctx2d = cvs.getContext('2d');
  const buffer = new Float32Array(analyser.fftSize);

  const draw = () => {
    meterRAF = requestAnimationFrame(draw);
    analyser.getFloatTimeDomainData(buffer);
    // RMS 計算
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      const v = buffer[i];
      sum += v * v;
    }
    const rms = Math.sqrt(sum / buffer.length); // 0..~1
    // 視覚レンジを調整（高域で小さく見えすぎないよう軽くブースト）
    const norm = Math.min(1, Math.pow(rms * 2.5, 0.9));

    // 描画
    const w = cvs.width;
    const h = cvs.height;
    ctx2d.clearRect(0, 0, w, h);
    // 背景グラデはCSS、ここはバーのみ
    const barW = Math.max(2, Math.floor(w * norm));
    // 色: 低=シアン 高=オレンジ→レッド
    const grd = ctx2d.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#0df2be');
    grd.addColorStop(0.6, '#f2b00d');
    grd.addColorStop(1, '#f24c0d');
    ctx2d.fillStyle = grd;
    ctx2d.fillRect(0, 0, barW, h);
  };
  if (!meterRAF) meterRAF = requestAnimationFrame(draw);
}

function stopLevelMeter() {
  if (meterRAF) {
    cancelAnimationFrame(meterRAF);
    meterRAF = null;
  }
  const cvs = document.getElementById('levelMeter');
  if (cvs) {
    const ctx2d = cvs.getContext('2d');
    ctx2d?.clearRect(0, 0, cvs.width, cvs.height);
  }
}

// ===== Voting & Realtime =====
const HAS_FIREBASE = typeof window.firebase !== 'undefined' && typeof window.firebase.firestore !== 'undefined';
let db = null;
let unsub = null;
const LOCAL_COUNTS = { good: 0, bad: 0, unknown: 0 };

// グラフ
let chart = null;
function initChart() {
  const ctx = document.getElementById('resultChart');
  if (!ctx || !window.Chart) return;
  chart = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Worked', 'No Effect', 'Unknown'],
      datasets: [{
        label: 'Votes',
        data: [0, 0, 0],
        backgroundColor: ['#0df2be80','#f2820d80','#8793ff80'],
        borderColor: ['#0df2be','#f2820d','#8793ff'],
        borderWidth: 1,
      }],
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

function updateChartFromCounts(counts) {
  if (!chart) return;
  chart.data.datasets[0].data = [counts.good || 0, counts.bad || 0, counts.unknown || 0];
  chart.update();
}

async function initFirebaseIfAny() {
  if (!HAS_FIREBASE) {
    els.rtStatus.textContent = 'Local tally (Firebase not configured)';
    return;
  }
  try {
    // firebase-config.js が読み込まれていれば window.__FIREBASE_CONFIG__ が存在する想定
    const conf = window.__FIREBASE_CONFIG__;
    if (!conf) {
      els.rtStatus.textContent = 'Firebase not configured (place firebase-config.js)';
      return;
    }
    const app = window.firebase.initializeApp(conf);
    db = window.firebase.firestore(app);
    els.rtStatus.textContent = 'Connecting to Firebase…';

    // 集計をサブスクライブ
    const aggRef = db.collection('mosquitoVotesAgg').doc('global');
    unsub = aggRef.onSnapshot((snap) => {
      const data = snap.data() || {};
      updateChartFromCounts({
        good: data.good || 0,
        bad: data.bad || 0,
        unknown: data.unknown || 0,
      });
      els.rtStatus.textContent = 'Realtime tally (Firebase)';
    });
  } catch (e) {
    console.warn('Firebase init failed', e);
    els.rtStatus.textContent = 'Local tally (Firebase init failed)';
  }
}

async function sendVote(result) {
  const payload = {
    result, // 'good' | 'bad' | 'unknown'
    freq: Number(els.freq.value),
    mode: els.modeSelect.value,
    ts: new Date().toISOString(),
    tzOffsetMin: new Date().getTimezoneOffset(),
    ua: navigator.userAgent,
  };

  if (db) {
    try {
      // 原票
      await db.collection('mosquitoVotes').add(payload);
      // 集計（簡易: トランザクション/Cloud Functionsの代わりにクライアント側でincrement）
      const aggRef = db.collection('mosquitoVotesAgg').doc('global');
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(aggRef);
        const data = snap.exists ? snap.data() : { good: 0, bad: 0, unknown: 0 };
        data[result] = (data[result] || 0) + 1;
        tx.set(aggRef, data);
      });
      return true;
    } catch (e) {
      console.warn('vote send failed, fallback local', e);
    }
  }

  // ローカル集計フォールバック
  LOCAL_COUNTS[result]++;
  updateChartFromCounts(LOCAL_COUNTS);
  return false;
}

// ===== Share =====
function generateShareText(lastResult = null) {
  const mode = els.modeSelect.value;
  const freq = Number(els.freq.value);
  const tag = '#MosquitoTest2025';
  const resText = lastResult === 'good' ? 'Worked' : lastResult === 'bad' ? 'No Effect' : lastResult === 'unknown' ? 'Unknown' : 'Testing';
  return `Mosquito Repellent Test: ${resText}\nMode: ${mode}  Frequency: ${freq} Hz\n${tag}`;
}

async function shareResult(lastResult = null) {
  const text = generateShareText(lastResult);
  const shareData = { text, title: 'Mosquito Repellent Test' };
  if (navigator.share) {
    try { await navigator.share(shareData); return true; } catch {}
  }
  try {
    await navigator.clipboard.writeText(text);
    alert('Copied result text to clipboard. Paste it into your social app to share.');
    return true;
  } catch {
    prompt('Copy this text to share', text);
    return false;
  }
}

// ===== Events =====
els.toggleBtn.addEventListener('click', async () => {
  ensureAudio();
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  if (carrier) {
    stopSound();
  } else {
    startSound();
  }
});

els.modeSelect.addEventListener('change', () => {
  if (carrier) {
    // 動作中にモード変更されたら再起動
    startSound();
  }
});

els.dbgAudibleFM?.addEventListener('change', () => {
  if (carrier) startSound();
});

els.freq.addEventListener('input', () => setFreqFromUI());
els.gain.addEventListener('input', () => setGainFromUI());

// FM controls live updates
els.carrierWave?.addEventListener('change', () => {
  if (carrier) {
    carrier.type = els.carrierWave.value;
  }
});
els.modWave?.addEventListener('change', () => {
  if (mod) {
    mod.type = els.modWave.value;
  }
});
els.fmRate?.addEventListener('input', () => {
  updateFmLabels();
  if (mod && !els.dbgAudibleFM?.checked) {
    mod.frequency.setValueAtTime(Number(els.fmRate.value), audioCtx.currentTime);
  }
});
els.fmDepth?.addEventListener('input', () => {
  updateFmLabels();
  if (modGain && !els.dbgAudibleFM?.checked) {
    const f0 = Number(els.freq.value);
    modGain.gain.setValueAtTime(getEffectiveDepthHz(f0), audioCtx.currentTime);
  }
});
els.distEnable?.addEventListener('change', () => {
  if (carrier) rebuildPostChain();
});
els.distDrive?.addEventListener('input', () => {
  updateFmLabels();
  if (els.distEnable?.checked && shaper) {
    const drive = Number(els.distDrive.value);
    shaper.curve = makeDistortionCurve(drive);
  }
});

let lastVoted = null;
els.btnGood.addEventListener('click', async () => { lastVoted = 'good'; await sendVote('good'); });
els.btnBad.addEventListener('click', async () => { lastVoted = 'bad'; await sendVote('bad'); });
els.btnUnknown.addEventListener('click', async () => { lastVoted = 'unknown'; await sendVote('unknown'); });
els.btnShare.addEventListener('click', async () => { await shareResult(lastVoted); });
els.btnTest?.addEventListener('click', async () => { await playTestBeep(); });

// X(Twitter) ツイート
function buildTweetText() {
  const freq = Number(els.freq.value);
  const tags = ['#KGNINJA', '#FMMoskyt'];
  const base = lastVoted === 'good'
    ? `Worked at ${freq} Hz`
    : `Testing ${freq} Hz`;
  return `${base} ${tags.join(' ')}`;
}

function openTweetIntent() {
  const text = buildTweetText();
  const url = 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(text);
  // 1st: window.open（成功すれば新規タブ）
  const w = window.open(url, '_blank', 'noopener');
  if (w && !w.closed) return;
  // 2nd: 動的アンカーをクリック
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 0);
    return;
  } catch {}
  // 3rd: 最終手段として同タブ遷移
  location.href = url;
}

els.btnTweet?.addEventListener('click', () => {
  openTweetIntent();
});

// ページ離脱時は停止
window.addEventListener('pagehide', () => stopSound(true));
window.addEventListener('visibilitychange', () => { if (document.hidden) stopSound(true); });

// 起動
initChart();
initFirebaseIfAny();
updateFmLabels();
