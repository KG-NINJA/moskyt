// script.js — Pure HTML/CSS/JS complete version
document.addEventListener('DOMContentLoaded', () => {
  // ========= DOM refs =========
  const btnToggle = document.getElementById('toggleBtn');
  const statusBadge = document.getElementById('statusBadge');
  const modeSelect = document.getElementById('modeSelect');
  const chkAudibleFM = document.getElementById('dbgAudibleFM');
  const btnTest = document.getElementById('btnTest');

  const freq = document.getElementById('freq');
  const freqVal = document.getElementById('freqVal');
  const gain = document.getElementById('gain');
  const gainVal = document.getElementById('gainVal');

  const carrierWave = document.getElementById('carrierWave');
  const modWave = document.getElementById('modWave');
  const fmRate = document.getElementById('fmRate');
  const fmRateVal = document.getElementById('fmRateVal');
  const fmDepth = document.getElementById('fmDepth');
  const fmDepthVal = document.getElementById('fmDepthVal');
  const distEnable = document.getElementById('distEnable');
  const distDrive = document.getElementById('distDrive');
  const distDriveVal = document.getElementById('distDriveVal');

  const btnGood = document.getElementById('btnGood');
  const btnBad = document.getElementById('btnBad');
  const btnUnknown = document.getElementById('btnUnknown');
  const btnTweet = document.getElementById('btnTweet');
  const btnShare = document.getElementById('btnShare');

  const mosqWrap = document.getElementById('mosqWrap');

  // Status paragraphs (注意：HTMLに同じIDが2つあるため両方更新する)
  const setRtStatus = (msg) => {
    document.querySelectorAll('#rtStatus').forEach(el => el.textContent = msg);
  };

  // Charts / Meter
  const meterCanvas = document.getElementById('levelMeter');
  const meterCtx = meterCanvas?.getContext?.('2d') || null;
  const resultChartCanvas = document.getElementById('resultChart');

  // ========= Constants =========
  const SITE_URL = 'https://kg-ninja.github.io/moskyt/';
  const locale = navigator.language || 'Unknown';
  const UA = navigator.userAgent || 'UA';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  // ========= Audio Graph =========
  let actx = null;
  let masterGain = null;
  let analyser = null;
  let toneOsc = null;              // for "tone" mode
  let carrierOsc = null;           // for "fm" mode
  let modOsc = null;               // for "fm" mode
  let modGainNode = null;          // for "fm" mode
  let shaper = null;               // optional distortion
  let meterRAF = null;             // requestAnimationFrame id
  let isPlaying = false;

  function ensureCtx() {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = actx.createGain();
      masterGain.gain.value = (Number(gain.value) || 20) / 100; // 0..1
      analyser = actx.createAnalyser();
      analyser.fftSize = 2048;

      // master -> analyser -> destination
      masterGain.connect(analyser);
      analyser.connect(actx.destination);
    }
  }

  function cleanupNodes() {
    try { toneOsc && toneOsc.stop(); } catch {}
    try { carrierOsc && carrierOsc.stop(); } catch {}
    try { modOsc && modOsc.stop(); } catch {}
    toneOsc = carrierOsc = modOsc = null;
    modGainNode = null;
    if (shaper) {
      try { shaper.disconnect(); } catch {}
      shaper = null;
    }
  }

  function setMasterGainFromUI() {
    if (masterGain) {
      masterGain.gain.value = (Number(gain.value) || 20) / 100;
    }
  }

  function waveshaperCurve(drive = 0) {
    // Simple arctan curve
    const k = clamp(drive, 0, 1) * 100;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / n) * 2 - 1;
      curve[i] = Math.atan(k * x) / Math.atan(k);
    }
    return curve;
  }

  function attachDistortionIfEnabled(sourceNode) {
    if (!distEnable.checked) {
      // sourceNode -> masterGain
      sourceNode.connect(masterGain);
      return;
    }
    shaper = actx.createWaveShaper();
    shaper.curve = waveshaperCurve(Number(distDrive.value) || 0);
    sourceNode.connect(shaper).connect(masterGain);
  }

  function startToneMode() {
    const hz = computeCarrierHz();
    toneOsc = actx.createOscillator();
    toneOsc.type = carrierWave.value || 'square';
    toneOsc.frequency.value = hz;

    attachDistortionIfEnabled(toneOsc);
    toneOsc.start();
  }

  function startFMMode() {
    const carrierHz = computeCarrierHz();
    const audibleDebug = chkAudibleFM.checked;

    carrierOsc = actx.createOscillator();
    carrierOsc.type = carrierWave.value || 'square';
    carrierOsc.frequency.value = carrierHz;

    modOsc = actx.createOscillator();
    modOsc.type = modWave.value || 'sine';
    // FM レートは 0.1..200Hz（UI）/ デバッグ時は可聴帯
    const modHz = audibleDebug ? clamp(Number(fmRate.value) * 10, 1, 2000) : Number(fmRate.value);
    modOsc.frequency.value = modHz || 60;

    modGainNode = actx.createGain();
    // 深さは 0..3000（Hz 偏移の目安）
    modGainNode.gain.value = Number(fmDepth.value) || 0;

    // Modulator -> (gain) -> carrier frequency
    modOsc.connect(modGainNode);
    modGainNode.connect(carrierOsc.frequency);

    // 出力チェーン
    attachDistortionIfEnabled(carrierOsc);

    // 可聴デバッグ用に carrier 自体も 500~2000Hz に切り替える
    if (audibleDebug) {
      carrierOsc.frequency.value = clamp(carrierHz / 10, 300, 3000);
    }

    carrierOsc.start();
    modOsc.start();
  }

  function stopAudio() {
    cleanupNodes();
    isPlaying = false;
    if (meterRAF) {
      cancelAnimationFrame(meterRAF);
      meterRAF = null;
    }
    updateUIPlaying(false);
  }

  function computeCarrierHz() {
    // "FM (Mosquito)"は 16~22kHz 推奨。UIのfreqがそのままHz
    // "Tone" でも同じスライダ値をそのまま使用
    return Number(freq.value) || 19000;
  }

  async function startAudio() {
    ensureCtx();
    await actx.resume().catch(() => {});
    cleanupNodes();
    setMasterGainFromUI();

    if (modeSelect.value === 'fm') startFMMode();
    else startToneMode();

    isPlaying = true;
    updateUIPlaying(true);
    kickMeter();
  }

  // ========= UI state =========
  function updateUIPlaying(on) {
    if (on) {
      btnToggle.textContent = 'Stop';
      statusBadge.textContent = 'Playing';
      statusBadge.classList.remove('off');
      statusBadge.classList.add('on');
      mosqWrap?.classList.add('active'); // CSS次第で飛行演出
    } else {
      btnToggle.textContent = 'Play';
      statusBadge.textContent = 'Stopped';
      statusBadge.classList.remove('on');
      statusBadge.classList.add('off');
      mosqWrap?.classList.remove('active');
    }
  }

  // ========= Level meter =========
  function kickMeter() {
    if (!meterCtx || !analyser) return;
    const buf = new Float32Array(analyser.fftSize);
    const W = meterCanvas.width;
    const H = meterCanvas.height;

    function draw() {
      analyser.getFloatTimeDomainData(buf);
      // RMSを概算
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length); // 0..1程度

      meterCtx.clearRect(0, 0, W, H);
      meterCtx.fillStyle = '#1e90ff';
      const w = clamp(rms * W * 3, 2, W); // 誇張気味に表示
      meterCtx.fillRect(0, 0, w, H);
      meterCtx.fillStyle = '#889';
      meterCtx.fillRect(w, 0, W - w, H);

      meterRAF = requestAnimationFrame(draw);
    }
    draw();
  }

  // ========= Chart (local tally) =========
  let worked = 0, noEffect = 0, unknown = 0;
  const feedback = []; // in-memory
  let chart;
  if (window.Chart && resultChartCanvas) {
    chart = new Chart(resultChartCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: ['Worked', 'No Effect', 'Unknown'],
        datasets: [{
          label: 'Votes',
          data: [0, 0, 0]
        }]
      },
      options: {
        responsive: true,
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        plugins: { legend: { display: false } }
      }
    });
  }

  function updateChart() {
    if (!chart) return;
    chart.data.datasets[0].data = [worked, noEffect, unknown];
    chart.update();
  }

  // ========= Tweet / Share =========
  let lastResult = 'No vote yet';

  function setResultLabel(txt) {
    lastResult = txt;
    setRtStatus(`Your last result: ${txt} | Local tally in progress`);
  }

  function openTweetSync(text) {
    const intentUrl =
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SITE_URL)}`;
    const w = window.open(intentUrl, '_blank', 'noopener,noreferrer');
    if (!w) window.location.href = intentUrl;
  }

  btnTweet?.addEventListener('click', () => {
    const text =
      `Tried the #MosquitoTest2025 🦟\n` +
      `Result: ${lastResult}\n` +
      `Mode: ${modeSelect?.value || 'tone'} | ` +
      `Freq: ${freq?.value || '—'} Hz | Vol: ${gain?.value || '—'}%`;
    openTweetSync(text);
  });

  btnShare?.addEventListener('click', () => {
    const text = `I joined the #MosquitoTest2025 🦟 Result: ${lastResult}`;
    if (navigator.share) {
      navigator.share({ title: 'Mosquito Repellent Demo', text, url: SITE_URL })
        .catch(() => {});
    } else {
      openTweetSync(text);
    }
  });

  // ========= Voting / Logging =========
  async function logFeedback(resultStr) {
    // local
    const entry = {
      ts: new Date().toISOString(),
      result: resultStr,
      mode: modeSelect?.value || 'tone',
      freq: Number(freq?.value) || null,
      volumePct: Number(gain?.value) || null,
      locale,
      ua: UA
    };
    feedback.push(entry);

    // Firebase(任意)
    try {
      // 互換版SDK（*-compat.js）での参照
      if (window.firebase?.apps?.length === 0 && window.FIREBASE_CONFIG) {
        window.firebase.initializeApp(window.FIREBASE_CONFIG);
      }
      if (window.firebase?.firestore) {
        const db = window.firebase.firestore();
        await db.collection('feedback').add(entry);
        setRtStatus('Sent to Firebase + local tally');
      } else {
        setRtStatus('Local tally in progress (Firebase not set up)');
      }
    } catch {
      setRtStatus('Local tally only (Firebase write failed)');
    }
  }

  btnGood?.addEventListener('click', () => {
    worked++; updateChart();
    setResultLabel('✅ Worked');
    logFeedback('worked');
  });
  btnBad?.addEventListener('click', () => {
    noEffect++; updateChart();
    setResultLabel('❌ No Effect');
    logFeedback('no_effect');
  });
  btnUnknown?.addEventListener('click', () => {
    unknown++; updateChart();
    setResultLabel('🤔 Unknown');
    logFeedback('unknown');
  });

  // ========= Controls & Handlers =========
  btnToggle?.addEventListener('click', () => {
    if (!isPlaying) startAudio();
    else stopAudio();
  });

  btnTest?.addEventListener('click', async () => {
    ensureCtx(); await actx.resume().catch(()=>{});
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1000;
    g.gain.value = 0.1;
    osc.connect(g).connect(actx.destination);
    osc.start();
    setTimeout(() => { try { osc.stop(); } catch {} }, 1000);
  });

  // 値表示
  const updateFreqLabel = () => { freqVal.textContent = `${freq.value}`; };
  const updateGainLabel = () => { gainVal.textContent = `${gain.value}`; };
  const updateRateLabel = () => { fmRateVal.textContent = `${fmRate.value}`; };
  const updateDepthLabel = () => {
    const pct = Math.round((Number(fmDepth.value) / 3000) * 100);
    fmDepthVal.textContent = `${pct}%`;
  };
  const updateDriveLabel = () => { distDriveVal.textContent = Number(distDrive.value).toFixed(2); };

  // スライダ変更時にリアルタイム反映
  freq?.addEventListener('input', () => {
    updateFreqLabel();
    if (isPlaying) {
      const hz = computeCarrierHz();
      if (modeSelect.value === 'fm' && carrierOsc) {
        carrierOsc.frequency.setTargetAtTime(hz, actx.currentTime, 0.02);
      } else if (toneOsc) {
        toneOsc.frequency.setTargetAtTime(hz, actx.currentTime, 0.02);
      }
    }
  });

  gain?.addEventListener('input', () => {
    updateGainLabel();
    setMasterGainFromUI();
  });

  carrierWave?.addEventListener('change', () => {
    if (!isPlaying) return;
    if (modeSelect.value === 'fm' && carrierOsc) carrierOsc.type = carrierWave.value;
    if (modeSelect.value === 'tone' && toneOsc) toneOsc.type = carrierWave.value;
  });

  modWave?.addEventListener('change', () => {
    if (isPlaying && modOsc) modOsc.type = modWave.value;
  });

  fmRate?.addEventListener('input', () => {
    updateRateLabel();
    if (isPlaying && modOsc) {
      const audibleDebug = chkAudibleFM.checked;
      const r = Number(fmRate.value);
      const target = audibleDebug ? clamp(r * 10, 1, 2000) : r;
      modOsc.frequency.setTargetAtTime(target, actx.currentTime, 0.03);
    }
  });

  fmDepth?.addEventListener('input', () => {
    updateDepthLabel();
    if (isPlaying && modGainNode) {
      modGainNode.gain.setTargetAtTime(Number(fmDepth.value), actx.currentTime, 0.03);
    }
  });

  distEnable?.addEventListener('change', () => {
    if (!isPlaying) return;
    // 再構築：現在のモードを再スタート
    const wasMode = modeSelect.value;
    stopAudio(); startAudio();
    modeSelect.value = wasMode;
  });

  distDrive?.addEventListener('input', () => {
    updateDriveLabel();
    if (shaper) shaper.curve = waveshaperCurve(Number(distDrive.value));
  });

  chkAudibleFM?.addEventListener('change', () => {
    if (isPlaying && modeSelect.value === 'fm') {
      // 可聴/超音波切替はFMの再構築が安全
      const was = modeSelect.value;
      stopAudio(); startAudio();
      modeSelect.value = was;
    }
  });

  modeSelect?.addEventListener('change', () => {
    if (isPlaying) {
      stopAudio(); startAudio();
    }
  });

  // 初期ラベル
  updateFreqLabel(); updateGainLabel();
  updateRateLabel(); updateDepthLabel(); updateDriveLabel();
  setRtStatus('Local tally in progress (Firebase not set up)');
  updateUIPlaying(false);
});
