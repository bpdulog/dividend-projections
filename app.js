const STORAGE_KEY = "dividendProjectionPrefs.v1";

const DEFAULTS = {
  mode: "monthly",
  autoSave: true,
  chartMetric: "ending",
  tableFrequency: "yearly",
  monthly: {
    initialAmount: 45000,
    annualDividendRate: 4.75,
    annualCapitalGainsRate: 2,
    periodicContribution: 120,
    periodsPerYear: 12,
    years: 30
  },
  quarterly: {
    initialAmount: 43000,
    annualDividendRate: 4.75,
    annualCapitalGainsRate: 5,
    monthlyContribution: 200,
    periodsPerYear: 4,
    years: 30
  }
};

const CONTROL_DEFS = {
  monthly: [
    ["initialAmount", "Initial Amount", "currency", 0, 500000, 1000],
    ["annualDividendRate", "Annual Dividend Rate", "percent", 0, 15, 0.05],
    ["annualCapitalGainsRate", "Annual Capital Gains Rate", "percent", -10, 20, 0.05],
    ["periodicContribution", "Monthly Contribution", "currency", 0, 10000, 25],
    ["years", "Projection Years", "number", 1, 50, 1]
  ],
  quarterly: [
    ["initialAmount", "Initial Amount", "currency", 0, 500000, 1000],
    ["annualDividendRate", "Annual Dividend Rate", "percent", 0, 15, 0.05],
    ["annualCapitalGainsRate", "Annual Capital Gains Rate", "percent", -10, 20, 0.05],
    ["monthlyContribution", "Monthly Contribution", "currency", 0, 10000, 25],
    ["years", "Projection Years", "number", 1, 50, 1]
  ]
};

const state = loadState();
let latestProjection = [];
let latestTableRows = [];

const controlsEl = document.querySelector("#controls");
const rowsEl = document.querySelector("#projectionRows");
const chart = document.querySelector("#projectionChart");
const ctx = chart.getContext("2d");

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0
});

const moneyPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return mergeState(DEFAULTS, saved || {});
  } catch {
    return structuredClone(DEFAULTS);
  }
}

function mergeState(base, incoming) {
  const next = structuredClone(base);
  for (const key of Object.keys(incoming)) {
    if (incoming[key] && typeof incoming[key] === "object" && !Array.isArray(incoming[key])) {
      next[key] = { ...(next[key] || {}), ...incoming[key] };
    } else {
      next[key] = incoming[key];
    }
  }
  return next;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getActiveConfig() {
  const active = state[state.mode];
  const periodicContribution = state.mode === "quarterly"
    ? active.monthlyContribution * 3
    : active.periodicContribution;

  return {
    ...active,
    periodicContribution,
    annualDividendRate: active.annualDividendRate / 100,
    annualCapitalGainsRate: active.annualCapitalGainsRate / 100
  };
}

function project(config) {
  const yearlyRows = [];
  const periodRows = [];
  const totalPeriods = config.years * config.periodsPerYear;
  const dividendRate = Math.pow(1 + config.annualDividendRate, 1 / config.periodsPerYear) - 1;
  const gainsRate = Math.pow(1 + config.annualCapitalGainsRate, 1 / config.periodsPerYear) - 1;
  let startingCapital = config.initialAmount;

  for (let period = 1; period <= totalPeriods; period += 1) {
    const contribution = config.periodicContribution;
    const dividend = dividendRate * contribution / 2 + startingCapital * dividendRate;
    const capitalGain = gainsRate * contribution / 2 + startingCapital * gainsRate;
    const endingCapital = startingCapital + contribution + dividend + capitalGain;

    periodRows.push({ period, contribution, dividend, capitalGain, endingCapital });
    startingCapital = endingCapital;
  }

  for (let year = 1; year <= config.years; year += 1) {
    yearlyRows.push(rollupPeriodRows(periodRows, year, config.periodsPerYear, "yearly"));
  }

  return { periodRows, yearlyRows };
}

function rollupPeriodRows(periodRows, index, periodsPerGroup, frequency) {
  const start = (index - 1) * periodsPerGroup;
  const slice = periodRows.slice(start, start + periodsPerGroup);
  const firstPeriod = slice[0].period;
  const year = Math.ceil(firstPeriod / 12);

  return {
    index,
    year,
    label: makeRowLabel(frequency, firstPeriod, index),
    contributions: sum(slice, "contribution"),
    dividendIncome: sum(slice, "dividend"),
    capitalGains: sum(slice, "capitalGain"),
    endingCapital: slice.at(-1).endingCapital
  };
}

function makeRowLabel(frequency, firstPeriod, index) {
  if (frequency === "monthly") return `Month ${firstPeriod}`;
  if (frequency === "quarterly") return `Q${((index - 1) % 4) + 1} Year ${Math.ceil(index / 4)}`;
  return `Year ${index}`;
}

function getTableRows(periodRows, config) {
  if (state.tableFrequency === "monthly") {
    if (config.periodsPerYear !== 12) return [];
    return periodRows.map((row) => ({
      index: row.period,
      year: Math.ceil(row.period / 12),
      label: `Month ${row.period}`,
      contributions: row.contribution,
      dividendIncome: row.dividend,
      capitalGains: row.capitalGain,
      endingCapital: row.endingCapital
    }));
  }

  if (state.tableFrequency === "quarterly") {
    const periodsPerQuarter = config.periodsPerYear === 12 ? 3 : 1;
    const totalQuarters = config.years * 4;
    return Array.from({ length: totalQuarters }, (_, index) =>
      rollupPeriodRows(periodRows, index + 1, periodsPerQuarter, "quarterly")
    );
  }

  return Array.from({ length: config.years }, (_, index) =>
    rollupPeriodRows(periodRows, index + 1, config.periodsPerYear, "yearly")
  );
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}

function renderControls() {
  controlsEl.innerHTML = "";
  for (const [key, label, type, min, max, step] of CONTROL_DEFS[state.mode]) {
    const value = state[state.mode][key];
    const control = document.createElement("div");
    control.className = "control";
    control.innerHTML = `
      <div class="control-head">
        <label for="${key}">${label}</label>
        <input id="${key}" data-key="${key}" data-input="number" type="number" min="${min}" max="${max}" step="${step}" value="${value}">
      </div>
      <input aria-label="${label}" data-key="${key}" data-input="range" type="range" min="${min}" max="${max}" step="${step}" value="${value}">
      <div class="range-labels">
        <span>${formatScaleValue(min, type)}</span>
        <span>${formatScaleValue(max, type)}</span>
      </div>
    `;
    controlsEl.append(control);
  }
}

function formatScaleValue(value, type) {
  if (type === "currency") return currency.format(value);
  if (type === "percent") return `${value}%`;
  return String(value);
}

function render() {
  const config = getActiveConfig();
  const projection = project(config);
  latestProjection = projection.yearlyRows;
  latestTableRows = getTableRows(projection.periodRows, config);
  const final = latestProjection.at(-1);
  const totalContributions = sum(latestProjection, "contributions");
  const totalDividends = sum(latestProjection, "dividendIncome");
  const totalGains = sum(latestProjection, "capitalGains");

  document.querySelector("#endingCapital").textContent = currency.format(final.endingCapital);
  document.querySelector("#finalDividend").textContent = currency.format(final.dividendIncome);
  document.querySelector("#totalContributions").textContent = currency.format(totalContributions);
  document.querySelector("#totalReturn").textContent = currency.format(totalDividends + totalGains);
  renderTableLabels();

  rowsEl.innerHTML = latestTableRows.length ? latestTableRows.map((row) => `
    <tr>
      <td>${row.label}</td>
      <td>${moneyPrecise.format(row.contributions)}</td>
      <td>${moneyPrecise.format(row.dividendIncome)}</td>
      <td>${moneyPrecise.format(row.capitalGains)}</td>
      <td>${moneyPrecise.format(row.endingCapital)}</td>
    </tr>
  `).join("") : `
    <tr>
      <td colspan="5">Monthly detail is available in Monthly mode.</td>
    </tr>
  `;

  drawChart();
  if (state.autoSave) saveState();
}

function renderTableLabels() {
  const labels = {
    yearly: ["Yearly rollup", "Year"],
    quarterly: ["Quarterly rollup", "Quarter"],
    monthly: ["Monthly detail", "Month"]
  };
  const [eyebrow, period] = labels[state.tableFrequency];
  document.querySelector("#tableEyebrow").textContent = eyebrow;
  document.querySelector("#periodHeader").textContent = period;
}

function drawChart() {
  const rect = chart.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  chart.width = Math.max(640, Math.floor(rect.width * scale));
  chart.height = Math.max(320, Math.floor(rect.height * scale));
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const width = chart.width / scale;
  const height = chart.height / scale;
  const pad = { top: 26, right: 28, bottom: 42, left: 74 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const metric = state.chartMetric;
  const key = metric === "income" ? "dividendIncome" : metric === "contributions" ? "contributions" : "endingCapital";
  const values = latestProjection.map((row) => row[key]);
  const max = Math.max(...values) * 1.08 || 1;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#0c1110";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "rgba(231, 215, 168, 0.14)";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#b8b2a2";
  ctx.font = "700 12px Inter, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let i = 0; i <= 4; i += 1) {
    const y = pad.top + plotH * (i / 4);
    const value = max * (1 - i / 4);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(width - pad.right, y);
    ctx.stroke();
    ctx.fillText(shortMoney(value), pad.left - 12, y);
  }

  const gradient = ctx.createLinearGradient(0, pad.top, 0, height - pad.bottom);
  gradient.addColorStop(0, "rgba(216, 180, 95, 0.3)");
  gradient.addColorStop(0.62, "rgba(45, 212, 191, 0.1)");
  gradient.addColorStop(1, "rgba(216, 180, 95, 0.02)");

  const points = values.map((value, index) => ({
    x: pad.left + (latestProjection.length === 1 ? 0 : plotW * index / (latestProjection.length - 1)),
    y: pad.top + plotH * (1 - value / max)
  }));

  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.lineTo(points.at(-1).x, height - pad.bottom);
  ctx.lineTo(points[0].x, height - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y));
  ctx.strokeStyle = "#d8b45f";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = "#2dd4bf";
  for (const point of points.filter((_, index) => index % Math.ceil(points.length / 8) === 0 || index === points.length - 1)) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#b8b2a2";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let i = 0; i < latestProjection.length; i += Math.max(1, Math.ceil(latestProjection.length / 6))) {
    const point = points[i];
    ctx.fillText(`Y${latestProjection[i].year}`, point.x, height - pad.bottom + 14);
  }
}

function shortMoney(value) {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `$${Math.round(value / 1000)}K`;
  return currency.format(value);
}

function syncControl(key, value) {
  const numeric = Number(value);
  state[state.mode][key] = Number.isFinite(numeric) ? numeric : 0;
  for (const input of document.querySelectorAll(`[data-key="${key}"]`)) {
    input.value = state[state.mode][key];
  }
  render();
}

function switchMode(mode) {
  state.mode = mode;
  updateTableFrequencyOptions();
  if (mode === "quarterly" && state.tableFrequency === "monthly") {
    state.tableFrequency = "quarterly";
    document.querySelector("#tableFrequency").value = state.tableFrequency;
  }
  for (const tab of document.querySelectorAll(".mode-tab")) {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  renderControls();
  render();
}

function updateTableFrequencyOptions() {
  const monthlyOption = document.querySelector('#tableFrequency option[value="monthly"]');
  monthlyOption.disabled = state.mode === "quarterly";
}

function downloadCsv() {
  const periodHeader = document.querySelector("#periodHeader").textContent;
  const header = [periodHeader, "Contributions", "Dividend Income", "Capital Gains", "Ending Capital"];
  const lines = latestTableRows.map((row) => [
    row.label,
    row.contributions.toFixed(2),
    row.dividendIncome.toFixed(2),
    row.capitalGains.toFixed(2),
    row.endingCapital.toFixed(2)
  ].join(","));
  const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${state.mode}-${state.tableFrequency}-dividend-projection.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

controlsEl.addEventListener("input", (event) => {
  const key = event.target.dataset.key;
  if (key) syncControl(key, event.target.value);
});

document.querySelectorAll(".mode-tab").forEach((tab) => {
  tab.addEventListener("click", () => switchMode(tab.dataset.mode));
});

document.querySelector("#saveButton").addEventListener("click", saveState);
document.querySelector("#resetButton").addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  Object.assign(state, structuredClone(DEFAULTS));
  document.querySelector("#autoSave").checked = state.autoSave;
  document.querySelector("#chartMetric").value = state.chartMetric;
  switchMode(state.mode);
});
document.querySelector("#autoSave").addEventListener("change", (event) => {
  state.autoSave = event.target.checked;
  if (state.autoSave) saveState();
});
document.querySelector("#chartMetric").addEventListener("change", (event) => {
  state.chartMetric = event.target.value;
  render();
});
document.querySelector("#tableFrequency").addEventListener("change", (event) => {
  state.tableFrequency = event.target.value;
  render();
});
document.querySelector("#downloadButton").addEventListener("click", downloadCsv);
window.addEventListener("resize", drawChart);

document.querySelector("#autoSave").checked = state.autoSave;
document.querySelector("#chartMetric").value = state.chartMetric;
document.querySelector("#tableFrequency").value = state.tableFrequency;
switchMode(state.mode);
