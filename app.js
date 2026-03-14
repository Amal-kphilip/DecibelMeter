(function () {
  const STORAGE_KEY = "sound-meter-state-v2";
  const MAX_DB = 140;
  const MIN_DB = 0;
  const CHART_MAX_DB = 110;
  const SAMPLE_INTERVAL_MS = 180;
  const referenceLevels = [
    { db: 140, color: "#d93025", label: "Fireworks" },
    { db: 130, color: "#ea4335", label: "Jackhammer, jet takeoff" },
    { db: 120, color: "#f55353", label: "Ambulance, thunderclap" },
    { db: 110, color: "#ff6b57", label: "Concerts, symphony orchestra" },
    { db: 100, color: "#ff8752", label: "Subway train, car horn" },
    { db: 90, color: "#ff9e48", label: "Lawnmower, shouted conversation" },
    { db: 80, color: "#ff8c1a", label: "Busy traffic, blender" },
    { db: 70, color: "#f59f00", label: "Restaurant, washing machine" },
    { db: 60, color: "#ffb11c", label: "Conversation, background music" },
    { db: 50, color: "#ffaa26", label: "Quiet office, refrigerator hum" },
    { db: 40, color: "#43a047", label: "Quiet room, light rain" },
    { db: 30, color: "#34a853", label: "Quiet library, soft whisper" },
    { db: 20, color: "#2e7d32", label: "Clock ticking" },
    { db: 10, color: "#1b66c9", label: "Breathing, rustling leaves" },
    { db: 0, color: "#185abc", label: "Threshold of hearing" },
  ];

  const translations = {
    title: "Sound Decibel Meter",
    statusIdle: "Ready to measure",
    threshold: "Threshold of Hearing",
    min: "MIN",
    avg: "AVG",
    max: "MAX",
    peak: "PEAK",
    historyTitle: "Live history",
    historyHint: "Approximate dB SPL, calibrated in browser",
    referenceTitle: "REFERENCE SOUND LEVELS (APPROX. dB SPL)",
    referenceHint: "Tap Start and compare your current reading against familiar sounds.",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    reset: "Reset",
    helpTitle: "How to use it",
    helpCopy:
      "Allow microphone access, press Start, and the meter will show a live weighted estimate of sound level. For the most accurate reading, compare it to a known sound meter and adjust calibration in Settings.",
    tip1: "Use the app over HTTPS or localhost so the browser can access the microphone.",
    tip2: "Disable loud music or fans nearby while calibrating your baseline.",
    tip3: "Pause keeps your current session. Reset clears the chart and statistics.",
    settingsTitle: "Meter settings",
    calibration: "Calibration offset",
    smoothing: "Smoothing",
    historyWindow: "History points",
    settingsNote: "Browsers cannot know your microphone's exact SPL sensitivity, so calibration aligns the meter with your device.",
    running: "Listening for sound...",
    paused: "Paused",
    awaitingPermission: "Waiting for microphone access...",
    permissionDenied: "Microphone access was blocked. Please allow access and try again.",
    noSupport: "This browser does not support microphone measurement.",
    secureContext: "Open this page on localhost or HTTPS to enable the microphone.",
    levelBandLabel: "dB band",
    chartAxis: "Level (dB)",
  };

  const ui = {
    body: document.body,
    currentDb: document.getElementById("currentDb"),
    minDb: document.getElementById("minDb"),
    avgDb: document.getElementById("avgDb"),
    maxDb: document.getElementById("maxDb"),
    peakDb: document.getElementById("peakDb"),
    scaleFill: document.getElementById("scaleFill"),
    thresholdLabel: document.getElementById("thresholdLabel"),
    levelBand: document.getElementById("levelBand"),
    statusLine: document.getElementById("statusLine"),
    referenceList: document.getElementById("referenceList"),
    startButton: document.getElementById("startButton"),
    pauseButton: document.getElementById("pauseButton"),
    resetButton: document.getElementById("resetButton"),
    themeToggle: document.getElementById("themeToggle"),
    overlay: document.getElementById("overlay"),
    panels: Array.from(document.querySelectorAll(".panel")),
    closeButtons: Array.from(document.querySelectorAll(".close-panel")),
    panelTriggers: Array.from(document.querySelectorAll("[data-panel-target]")),
    calibrationRange: document.getElementById("calibrationRange"),
    calibrationOutput: document.getElementById("calibrationOutput"),
    smoothingRange: document.getElementById("smoothingRange"),
    smoothingOutput: document.getElementById("smoothingOutput"),
    historyRange: document.getElementById("historyRange"),
    historyOutput: document.getElementById("historyOutput"),
    chart: document.getElementById("historyChart"),
  };

  const chartContext = ui.chart.getContext("2d");
  const saved = loadSavedState();

  const state = {
    theme: saved.theme || "light",
    calibrationOffset: clamp(saved.calibrationOffset ?? 95, 70, 120),
    smoothing: clamp(saved.smoothing ?? 0.82, 0, 0.95),
    historyPoints: clamp(saved.historyPoints ?? 90, 30, 180),
    currentDb: 0,
    smoothedDb: 0,
    minDb: 0,
    maxDb: 0,
    avgDb: 0,
    peakDb: 0,
    sampleCount: 0,
    totalDb: 0,
    history: [],
    lastSampleTime: 0,
    isRunning: false,
    isPaused: false,
    audioContext: null,
    analyser: null,
    mediaStream: null,
    sourceNode: null,
    filterNode: null,
    timeDomainData: null,
    frequencyData: null,
    animationFrameId: null,
    chartDpr: Math.max(1, Math.min(2, window.devicePixelRatio || 1)),
  };

  function loadSavedState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    } catch (error) {
      return {};
    }
  }

  function saveState() {
    const snapshot = {
      theme: state.theme,
      calibrationOffset: state.calibrationOffset,
      smoothing: state.smoothing,
      historyPoints: state.historyPoints,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatDb(value) {
    return `${value.toFixed(1)} dB`;
  }

  function getText(key) {
    return translations[key] || key;
  }

  function setStatus(key) {
    ui.statusLine.textContent = getText(key);
  }

  function applyTheme() {
    ui.body.classList.toggle("theme-light", state.theme === "light");
    ui.body.classList.toggle("theme-dark", state.theme !== "light");
  }

  function renderReferenceList() {
    const fragment = document.createDocumentFragment();
    referenceLevels.forEach((item) => {
      const row = document.createElement("li");
      row.className = "reference-item";
      row.dataset.db = String(item.db);

      const swatch = document.createElement("span");
      swatch.className = "reference-swatch";
      swatch.style.background = item.color;

      const db = document.createElement("strong");
      db.className = "reference-db";
      db.textContent = `${item.db} dB`;

      const label = document.createElement("span");
      label.className = "reference-label";
      label.textContent = item.label;

      row.append(swatch, db, label);
      fragment.appendChild(row);
    });

    ui.referenceList.replaceChildren(fragment);
  }

  function applyTranslations() {
    document.documentElement.lang = "en";
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.dataset.i18n;
      element.textContent = getText(key);
    });

    ui.pauseButton.querySelector("span").textContent = state.isPaused
      ? getText("resume")
      : getText("pause");

    renderReferenceList();
    updateMeter(state.currentDb);
  }

  function updateSettingsUi() {
    ui.calibrationRange.value = String(state.calibrationOffset);
    ui.calibrationOutput.value = `${state.calibrationOffset} dB`;
    ui.smoothingRange.value = String(Math.round(state.smoothing * 100));
    ui.smoothingOutput.value = `${Math.round(state.smoothing * 100)}%`;
    ui.historyRange.value = String(state.historyPoints);
    ui.historyOutput.value = String(state.historyPoints);
  }

  function resetStats() {
    state.currentDb = 0;
    state.smoothedDb = 0;
    state.minDb = 0;
    state.maxDb = 0;
    state.avgDb = 0;
    state.peakDb = 0;
    state.sampleCount = 0;
    state.totalDb = 0;
    state.history = [];
    state.lastSampleTime = 0;
    updateMeter(0);
    drawChart();
  }

  function updateMeter(db) {
    const clampedDb = clamp(db, MIN_DB, MAX_DB);
    state.currentDb = clampedDb;
    ui.currentDb.textContent = clampedDb.toFixed(1);
    ui.minDb.textContent = formatDb(state.minDb);
    ui.avgDb.textContent = formatDb(state.avgDb);
    ui.maxDb.textContent = formatDb(state.maxDb);
    ui.peakDb.textContent = formatDb(state.peakDb);
    ui.scaleFill.style.width = `${(clampedDb / MAX_DB) * 100}%`;

    const reference = getReferenceForDb(clampedDb);
    ui.thresholdLabel.textContent = reference.label;
    ui.levelBand.textContent = `${getText("levelBandLabel")}: ${Math.max(reference.db - 10, 0)} - ${reference.db}`;

    Array.from(ui.referenceList.children).forEach((row) => {
      row.classList.toggle("active", Number(row.dataset.db) === reference.db);
    });
  }

  function getReferenceForDb(db) {
    return referenceLevels.find((item) => db >= item.db) || referenceLevels[referenceLevels.length - 1];
  }

  function openPanel(panelId) {
    ui.overlay.hidden = false;
    ui.panels.forEach((panel) => {
      panel.hidden = panel.id !== panelId;
    });
  }

  function closePanels() {
    ui.overlay.hidden = true;
    ui.panels.forEach((panel) => {
      panel.hidden = true;
    });
  }

  async function startMeter() {
    if (!window.isSecureContext) {
      setStatus("secureContext");
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus("noSupport");
      return;
    }

    if (state.audioContext && state.isPaused) {
      await resumeMeter();
      return;
    }

    if (state.isRunning) {
      return;
    }

    setStatus("awaitingPermission");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        video: false,
      });

      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const filterNode = audioContext.createBiquadFilter();
      const analyser = audioContext.createAnalyser();

      filterNode.type = "highpass";
      filterNode.frequency.value = 20;
      analyser.fftSize = 2048;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = state.smoothing;

      sourceNode.connect(filterNode);
      filterNode.connect(analyser);

      state.audioContext = audioContext;
      state.sourceNode = sourceNode;
      state.filterNode = filterNode;
      state.analyser = analyser;
      state.mediaStream = stream;
      state.timeDomainData = new Float32Array(analyser.fftSize);
      state.frequencyData = new Float32Array(analyser.frequencyBinCount);
      state.isRunning = true;
      state.isPaused = false;

      ui.pauseButton.disabled = false;
      ui.startButton.disabled = true;
      ui.pauseButton.querySelector("span").textContent = getText("pause");
      setStatus("running");
      tick();
    } catch (error) {
      setStatus("permissionDenied");
    }
  }

  async function pauseMeter() {
    if (!state.audioContext || !state.isRunning) {
      return;
    }

    await state.audioContext.suspend();
    state.isPaused = true;
    state.isRunning = false;
    if (state.animationFrameId) {
      cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
    }
    ui.startButton.disabled = false;
    ui.pauseButton.querySelector("span").textContent = getText("resume");
    setStatus("paused");
  }

  async function resumeMeter() {
    if (!state.audioContext || !state.isPaused) {
      return;
    }

    await state.audioContext.resume();
    state.isPaused = false;
    state.isRunning = true;
    ui.startButton.disabled = true;
    ui.pauseButton.querySelector("span").textContent = getText("pause");
    setStatus("running");
    tick();
  }

  function stopAudioTracks() {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => track.stop());
    }
  }

  async function resetMeter() {
    if (state.animationFrameId) {
      cancelAnimationFrame(state.animationFrameId);
      state.animationFrameId = null;
    }

    if (state.audioContext) {
      try {
        await state.audioContext.close();
      } catch (error) {
        // Ignore close errors during reset.
      }
    }

    stopAudioTracks();
    state.audioContext = null;
    state.analyser = null;
    state.mediaStream = null;
    state.sourceNode = null;
    state.filterNode = null;
    state.timeDomainData = null;
    state.frequencyData = null;
    state.isRunning = false;
    state.isPaused = false;
    ui.startButton.disabled = false;
    ui.pauseButton.disabled = true;
    ui.pauseButton.querySelector("span").textContent = getText("pause");
    setStatus("statusIdle");
    resetStats();
  }

  function aWeightingDb(frequency) {
    const f2 = frequency * frequency;
    const numerator = 12200 ** 2 * f2 * f2;
    const denominator =
      (f2 + 20.6 ** 2) *
      Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) *
      (f2 + 12200 ** 2);

    if (!denominator) {
      return -80;
    }

    return 20 * Math.log10(numerator / denominator) + 2.0;
  }

  function calculateDb() {
    if (!state.analyser || !state.frequencyData || !state.timeDomainData || !state.audioContext) {
      return 0;
    }

    state.analyser.getFloatFrequencyData(state.frequencyData);
    state.analyser.getFloatTimeDomainData(state.timeDomainData);

    let weightedPower = 0;
    const binWidth = state.audioContext.sampleRate / state.analyser.fftSize;

    for (let i = 1; i < state.frequencyData.length; i += 1) {
      const dbValue = state.frequencyData[i];
      if (!Number.isFinite(dbValue)) {
        continue;
      }

      const frequency = i * binWidth;
      if (frequency < 20) {
        continue;
      }

      const weightedDb = dbValue + aWeightingDb(frequency);
      weightedPower += 10 ** (weightedDb / 10);
    }

    let weightedEstimate = weightedPower > 0 ? 10 * Math.log10(weightedPower) : -100;
    let rms = 0;

    for (let i = 0; i < state.timeDomainData.length; i += 1) {
      const sample = state.timeDomainData[i];
      rms += sample * sample;
    }

    rms = Math.sqrt(rms / state.timeDomainData.length);
    const timeDomainEstimate = rms > 0 ? 20 * Math.log10(rms) : -100;

    if (!Number.isFinite(weightedEstimate)) {
      weightedEstimate = timeDomainEstimate;
    } else {
      weightedEstimate = weightedEstimate * 0.82 + timeDomainEstimate * 0.18;
    }

    return clamp(weightedEstimate + state.calibrationOffset, MIN_DB, MAX_DB);
  }

  function updateStats(db) {
    if (state.sampleCount === 0) {
      state.minDb = db;
      state.maxDb = db;
      state.peakDb = db;
    } else {
      state.minDb = Math.min(state.minDb, db);
      state.maxDb = Math.max(state.maxDb, db);
      state.peakDb = Math.max(state.peakDb, db);
    }

    state.sampleCount += 1;
    state.totalDb += db;
    state.avgDb = state.totalDb / state.sampleCount;
  }

  function pushHistory(db, timestamp) {
    if (!state.lastSampleTime || timestamp - state.lastSampleTime >= SAMPLE_INTERVAL_MS) {
      state.history.push(db);
      if (state.history.length > state.historyPoints) {
        state.history.shift();
      }
      state.lastSampleTime = timestamp;
    }
  }

  function tick(timestamp = performance.now()) {
    if (!state.isRunning || !state.audioContext) {
      return;
    }

    const rawDb = calculateDb();
    state.smoothedDb = state.sampleCount === 0
      ? rawDb
      : state.smoothedDb * state.smoothing + rawDb * (1 - state.smoothing);

    updateStats(state.smoothedDb);
    updateMeter(state.smoothedDb);
    pushHistory(state.smoothedDb, timestamp);
    drawChart();
    state.animationFrameId = requestAnimationFrame(tick);
  }

  function resizeCanvas() {
    const bounds = ui.chart.getBoundingClientRect();
    ui.chart.width = Math.max(320, Math.floor(bounds.width * state.chartDpr));
    ui.chart.height = Math.max(220, Math.floor(bounds.height * state.chartDpr));
    drawChart();
  }

  function drawChart() {
    const ctx = chartContext;
    const width = ui.chart.width;
    const height = ui.chart.height;
    const dpr = state.chartDpr;
    const styles = getComputedStyle(document.body);
    const isCompactChart = ui.chart.getBoundingClientRect().width < 420;
    const padTop = 18 * dpr;
    const padRight = 16 * dpr;
    const padBottom = 30 * dpr;
    const padLeft = (isCompactChart ? 52 : 40) * dpr;
    const chartWidth = width - padLeft - padRight;
    const chartHeight = height - padTop - padBottom;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = styles.getPropertyValue("--chart-grid").trim();
    ctx.lineWidth = 1;
    ctx.font = `${(isCompactChart ? 10 : 11) * dpr}px ${styles.getPropertyValue("--font-sans").trim()}`;
    ctx.fillStyle = styles.getPropertyValue("--muted").trim();

    [0, 20, 40, 60, 80, 100, 110].forEach((mark) => {
      const y = padTop + chartHeight - (mark / CHART_MAX_DB) * chartHeight;
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(width - padRight, y);
      ctx.stroke();
      ctx.fillText(String(mark), 10 * dpr, y + 4 * dpr);
    });

    if (!isCompactChart) {
      ctx.save();
      ctx.translate(16 * dpr, padTop + chartHeight / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(getText("chartAxis"), 0, 0);
      ctx.restore();
    }

    if (state.history.length === 0) {
      return;
    }

    const step = state.history.length > 1 ? chartWidth / (state.history.length - 1) : chartWidth;
    const gradient = ctx.createLinearGradient(padLeft, padTop, width - padRight, height - padBottom);
    gradient.addColorStop(0, "#8ac7ff");
    gradient.addColorStop(1, "#4e93ff");
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath();

    state.history.forEach((value, index) => {
      const x = padLeft + step * index;
      const y = padTop + chartHeight - (clamp(value, 0, CHART_MAX_DB) / CHART_MAX_DB) * chartHeight;
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();
  }

  function bindEvents() {
    ui.themeToggle.addEventListener("click", () => {
      state.theme = state.theme === "light" ? "dark" : "light";
      applyTheme();
      saveState();
      drawChart();
    });

    ui.panelTriggers.forEach((button) => {
      button.addEventListener("click", () => openPanel(button.dataset.panelTarget));
    });

    ui.closeButtons.forEach((button) => {
      button.addEventListener("click", closePanels);
    });

    ui.overlay.addEventListener("click", closePanels);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closePanels();
      }
    });

    ui.calibrationRange.addEventListener("input", () => {
      state.calibrationOffset = Number(ui.calibrationRange.value);
      ui.calibrationOutput.value = `${state.calibrationOffset} dB`;
      saveState();
    });

    ui.smoothingRange.addEventListener("input", () => {
      state.smoothing = Number(ui.smoothingRange.value) / 100;
      ui.smoothingOutput.value = `${Math.round(state.smoothing * 100)}%`;
      if (state.analyser) {
        state.analyser.smoothingTimeConstant = state.smoothing;
      }
      saveState();
    });

    ui.historyRange.addEventListener("input", () => {
      state.historyPoints = Number(ui.historyRange.value);
      state.history = state.history.slice(-state.historyPoints);
      ui.historyOutput.value = String(state.historyPoints);
      drawChart();
      saveState();
    });

    ui.startButton.addEventListener("click", startMeter);
    ui.pauseButton.addEventListener("click", () => {
      if (state.isPaused) {
        resumeMeter();
      } else {
        pauseMeter();
      }
    });
    ui.resetButton.addEventListener("click", resetMeter);

    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("beforeunload", stopAudioTracks);
  }

  function initialize() {
    applyTheme();
    updateSettingsUi();
    applyTranslations();
    resetStats();
    bindEvents();
    resizeCanvas();
  }

  initialize();
})();
