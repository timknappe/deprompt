import {
  Chart as ChartJS,
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  PieController,
  ArcElement,
  Tooltip,
  Legend,
  type ChartData,
} from "chart.js";
import { VIEW_TYPES, LABELS_BY_VIEW, DEFAULT_PROVIDER_HOVER_COLOR, PROVIDER_COLOR_TEST } from "./constants.js";
import { DEFAULT_PROVIDER_COLOR, MAX_WEEKS_TO_KEEP } from "./constants.js";
import { formatTime, hasActiveBlock, renderTime, renderTimeSynchronously } from "./helpers.js";
import {
  getActiveTrackedPlatformKeys,
  getActiveTrackedPlatformUsage,
  getManualBlock,
  getTodayUsage,
  isBlockToggledOff,
  isSnoozed,
  setBlockToggle,
  setSnooze,
  sumForAllProviders,
  unsetBlockToggle,
} from "./storageManager.js";
import dayjs from "dayjs";
import { loadAndApplyWeekStart, weekdayLabels } from "./weekStart.js";
import type { Views } from "./types.js";
import browser from "webextension-polyfill";
ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, PieController, ArcElement, Tooltip, Legend);

const PROVIDER_SHORT_NAMES: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  perplexity: "Perplexity",
  mistral: "Mistral",
  grok: "Grok",
  qwen: "Qwen",
  meta: "Meta AI",
  deepseek: "DeepSeek",
  moonshot: "Kimi",
};

async function getDailyHistory(providerId?: string) {
  const today = dayjs();
  const weekStart = today.startOf("week").format("YYYY-MM-DD");
  const results: { date: string; value: number }[] = [];

  for (let i = 0; i < 7; i++) {
    const d = today.subtract(i, "day");
    const dateKey = d.format("YYYY-MM-DD");

    if (dayjs(dateKey).startOf("week").format("YYYY-MM-DD") !== weekStart) {
      break;
    }

    if (providerId) {
      const key = `daily:${dateKey}:${providerId}`;
      const obj = await browser.storage.sync.get(key);
      const raw = obj[key];

      if (typeof raw === "number") {
        results.push({ date: dateKey, value: raw });
      }
    } else {
      const raw = await sumForAllProviders(`daily:${dateKey}`);
      if (typeof raw === "number") {
        results.push({ date: dateKey, value: raw });
      }
    }
  }

  return results.reverse();
}

async function getWeeklyHistory(maxWeeks = MAX_WEEKS_TO_KEEP, providerId?: string) {
  const results: { weekStart: string; value: number }[] = [];

  let weekStart = dayjs().startOf("week");

  for (let i = 0; i < maxWeeks; i++) {
    const w = weekStart.subtract(i, "week").format("YYYY-MM-DD");

    if (providerId) {
      const key = `week:${w}:${providerId}`;
      const obj = await browser.storage.sync.get(key);
      const raw = obj[key];

      if (typeof raw === "number") {
        results.push({ weekStart: w, value: raw });
      }
    } else {
      const raw = await sumForAllProviders(`week:${w}`);
      if (typeof raw === "number") {
        results.push({ weekStart: w, value: raw });
      }
    }
  }

  return results.reverse();
}

async function getMonthlyHistory(providerId?: string) {
  const now = dayjs();
  const year = now.year();
  const results: { month: string; value: number }[] = [];

  for (let m = 0; m < 12; m++) {
    const d = dayjs().year(year).month(m).date(1);
    const monthStr = d.format("YYYY-MM");

    if (providerId) {
      const key = `month:${monthStr}:${providerId}`;
      const obj = await browser.storage.sync.get(key);
      const raw = obj[key];

      if (typeof raw === "number") {
        results.push({ month: monthStr, value: raw });
      }
    } else {
      const raw = await sumForAllProviders(`month:${monthStr}`);
      if (typeof raw === "number") {
        results.push({ month: monthStr, value: raw });
      }
    }
  }

  return results;
}

async function getYearlyHistory(providerId?: string) {
  const results: { year: string; value: number }[] = [];

  let y = dayjs().year();

  while (true) {
    const yearStr = String(y);

    if (providerId) {
      const key = `year:${yearStr}:${providerId}`;
      const obj = await browser.storage.sync.get(key);
      const raw = obj[key];

      if (typeof raw !== "number") {
        break;
      }

      results.push({ year: yearStr, value: raw });
    } else {
      const raw = await sumForAllProviders(`year:${yearStr}`);

      if (typeof raw !== "number" || raw === 0) {
        break;
      }

      results.push({ year: yearStr, value: raw });
    }

    y -= 1;
  }

  return results.reverse();
}

async function getThisWeekTotal(): Promise<number> {
  const data = await getDailyHistory();
  return data.reduce((sum, d) => sum + d.value, 0);
}

const PERIOD_LABELS: Record<string, string> = {
  weekly: "This Week",
  monthly: "This Month",
  yearly: "This Year",
  alltime: "All Time",
};

const TOP_AI_PERIOD_LABELS: Record<string, string> = {
  weekly: "Most used AI This Week",
  monthly: "Most used AI This Month",
  yearly: "Most used AI This Year",
  alltime: "Most used AI All Time",
};

async function getPeriodTotal(viewType: Views): Promise<number> {
  switch (viewType) {
    case "weekly": {
      const data = await getDailyHistory();
      return data.reduce((sum, d) => sum + d.value, 0);
    }
    case "monthly": {
      const data = await getWeeklyHistory(MAX_WEEKS_TO_KEEP);
      return data.reduce((sum, d) => sum + d.value, 0);
    }
    case "yearly": {
      const data = await getMonthlyHistory();
      return data.reduce((sum, d) => sum + d.value, 0);
    }
    case "alltime": {
      const raw = await sumForAllProviders("alltime");
      return typeof raw === "number" ? raw : 0;
    }
  }
}

async function getMostUsedProviderForView(viewType: Views): Promise<{ provider: string; ms: number } | null> {
  const providers = await getActiveTrackedPlatformKeys();
  let best: { provider: string; ms: number } | null = null;

  for (const pid of providers) {
    let total = 0;

    switch (viewType) {
      case "weekly": {
        const weekStart = dayjs().startOf("week");
        for (let i = 0; i < 7; i++) {
          const dateKey = weekStart.add(i, "day").format("YYYY-MM-DD");
          if (dayjs(dateKey).isAfter(dayjs())) break;
          const key = `daily:${dateKey}:${pid}`;
          const obj = await browser.storage.sync.get(key);
          const raw = obj[key];
          if (typeof raw === "number") total += raw;
        }
        break;
      }
      case "monthly": {
        const startWeek = dayjs()
          .startOf("week")
          .subtract(MAX_WEEKS_TO_KEEP - 1, "week");
        for (let i = 0; i < MAX_WEEKS_TO_KEEP; i++) {
          const w = startWeek.add(i, "week").format("YYYY-MM-DD");
          const key = `week:${w}:${pid}`;
          const obj = await browser.storage.sync.get(key);
          const raw = obj[key];
          if (typeof raw === "number") total += raw;
        }
        break;
      }
      case "yearly": {
        const year = dayjs().year();
        for (let m = 0; m < 12; m++) {
          const monthStr = dayjs().year(year).month(m).format("YYYY-MM");
          const key = `month:${monthStr}:${pid}`;
          const obj = await browser.storage.sync.get(key);
          const raw = obj[key];
          if (typeof raw === "number") total += raw;
        }
        break;
      }
      case "alltime": {
        let y = dayjs().year();
        while (true) {
          const key = `year:${y}:${pid}`;
          const obj = await browser.storage.sync.get(key);
          const raw = obj[key];
          if (typeof raw !== "number") break;
          total += raw;
          y -= 1;
        }
        break;
      }
    }

    if (total > 0 && (!best || total > best.ms)) {
      best = { provider: pid, ms: total };
    }
  }

  return best;
}

async function getActiveDaysThisWeek(): Promise<number> {
  const data = await getDailyHistory();
  return data.filter((d) => d.value > 0).length;
}

async function getLastWeekTotal(): Promise<number> {
  const lastWeekStart = dayjs().startOf("week").subtract(1, "week").format("YYYY-MM-DD");
  const raw = await sumForAllProviders(`week:${lastWeekStart}`);
  return typeof raw === "number" ? raw : 0;
}

function freshCanvas(selector: string | HTMLElement): HTMLCanvasElement {
  const host = typeof selector === "string" ? document.querySelector(selector) : selector;
  if (!(host instanceof HTMLElement)) {
    throw new Error(`Mount not found: ${selector}`);
  }
  host.innerHTML = "";

  host.style.position = "relative";
  host.style.display = "block";
  host.style.overflow = "hidden";
  host.style.minWidth = "0";

  const canvas = document.createElement("canvas");

  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.maxWidth = "100%";
  canvas.style.maxHeight = "100%";
  canvas.style.boxSizing = "border-box";

  host.appendChild(canvas);
  return canvas;
}

let pieChart: ChartJS<"pie", number[], string> | null = null;

export async function renderProviderBreakdownChart(viewType: Views = "alltime"): Promise<void> {
  const labels = await getActiveTrackedPlatformKeys();
  const usage = await getActiveTrackedPlatformUsage(viewType);
  const colors = labels.map((providerId) => PROVIDER_COLOR_TEST[providerId] ?? "#CCCCCC");
  const data: ChartData<"pie", number[], string> = {
    labels,
    datasets: [
      {
        label: "Time spent %",
        data: usage,
        backgroundColor: colors,
        borderWidth: 0,
      },
    ],
  };

  if (pieChart) pieChart.destroy();
  const canvas = freshCanvas("#pieChart");

  pieChart = new ChartJS(canvas, {
    type: "pie",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: true,
      plugins: {
        legend: {
          position: "left",
          labels: {
            color: "#888",
            font: { size: 11 },
            boxWidth: 10,
            padding: 8,
          },
        },
        title: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const valueMs = context.raw as number;
              const displayTime = renderTimeSynchronously(formatTime(valueMs), true);
              const dataset = (context.chart.data.datasets?.[0]?.data ?? []) as number[];
              const totalMs = dataset.reduce((a, b) => a + b, 0);
              const percentage = totalMs === 0 ? 0 : (valueMs / totalMs) * 100;

              return `${context.label}: ${displayTime} (${percentage.toFixed(1)}%)`;
            },
          },
        },
      },
    },
  });
}

let currentViewType: Views = "weekly";
let barChart: ChartJS<"bar", number[], string> | null = null;
// Mirrors the stored week-start preference; refreshed from storage on every
// refreshAll so the weekly axis re-orders when the user flips the toggle.
let weekStartsOnSunday = false;

function isViewType(value: string): value is Views {
  return VIEW_TYPES.includes(value.toLowerCase() as Views);
}

/**
 * Chart x-axis labels for a view. Weekly and monthly are derived at render time so
 * they track the user's week-start preference; other views use the static labels.
 */
function getChartLabels(viewType: Views): string[] {
  switch (viewType) {
    case "weekly":
      return weekdayLabels(weekStartsOnSunday);
    case "monthly": {
      const startWeek = dayjs()
        .startOf("week")
        .subtract(MAX_WEEKS_TO_KEEP - 1, "week");
      return Array.from({ length: MAX_WEEKS_TO_KEEP }, (_, i) => {
        const start = startWeek.add(i, "week");
        return `${start.format("DD.MM")} - ${start.add(6, "day").format("DD.MM")}`;
      });
    }
    default:
      return LABELS_BY_VIEW[viewType] ?? [];
  }
}

async function getChartDataByViewType(viewType: Views): Promise<number[]> {
  switch (viewType) {
    case "weekly": {
      const weekStart = dayjs().startOf("week");
      const dayKeys = Array.from({ length: 7 }, (_, i) => weekStart.add(i, "day").format("YYYY-MM-DD"));
      const data = await getDailyHistory();
      const map = new Map(data.map((entry) => [entry.date, entry.value]));
      return dayKeys.map((key) => map.get(key) ?? 0);
    }
    case "monthly": {
      const startWeek = dayjs()
        .startOf("week")
        .subtract(MAX_WEEKS_TO_KEEP - 1, "week");
      const weekKeys = Array.from({ length: MAX_WEEKS_TO_KEEP }, (_, i) =>
        startWeek.add(i, "week").format("YYYY-MM-DD"),
      );
      const data = await getWeeklyHistory(MAX_WEEKS_TO_KEEP);
      const map = new Map(data.map((entry) => [entry.weekStart, entry.value]));
      return weekKeys.map((key) => map.get(key) ?? 0);
    }
    case "yearly": {
      const year = dayjs().year();
      const monthKeys = Array.from({ length: 12 }, (_, i) => dayjs().year(year).month(i).format("YYYY-MM"));
      const data = await getMonthlyHistory();
      const map = new Map(data.map((entry) => [entry.month, entry.value]));
      return monthKeys.map((key) => map.get(key) ?? 0);
    }
    case "alltime": {
      const yearKeys = LABELS_BY_VIEW.alltime ?? [];
      const data = await getYearlyHistory();
      const map = new Map(data.map((entry) => [entry.year, entry.value]));
      return yearKeys.map((key) => map.get(key) ?? 0);
    }
    default:
      return (LABELS_BY_VIEW[viewType] ?? []).map(() => 0);
  }
}

async function renderUsageChart(viewType: Views): Promise<void> {
  const labels = getChartLabels(viewType);
  const data: ChartData<"bar", number[], string> = {
    labels,
    datasets: [
      {
        label: "Time spent",
        data: await getChartDataByViewType(viewType),
        backgroundColor: DEFAULT_PROVIDER_COLOR,
        borderColor: "transparent",
        hoverBackgroundColor: DEFAULT_PROVIDER_HOVER_COLOR,
        hoverBorderColor: "transparent",
        borderWidth: 1,
        borderRadius: 6,
      },
    ],
  };

  if (barChart) barChart.destroy();
  const canvas = freshCanvas("#barChart");

  barChart = new ChartJS(canvas, {
    type: "bar",
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: true,
      plugins: {
        legend: { display: false },
        title: { display: false },
        tooltip: {
          callbacks: {
            label(context) {
              const valueMs = context.raw as number;
              const displayTime = renderTimeSynchronously(formatTime(valueMs), true);

              return displayTime;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#666", font: { size: 11 } },
          border: { display: false },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,0.04)" },
          border: { display: false },
          ticks: {
            color: "#555",
            font: { size: 11 },
            callback(value) {
              return renderTimeSynchronously(formatTime(Number(value)), true);
            },
            maxTicksLimit: 4,
          },
        },
      },
    },
  });
}

async function updateCharts(viewType: Views): Promise<void> {
  await renderUsageChart(viewType);
  await renderProviderBreakdownChart(viewType);
}

async function updateViewDependentStats(viewType: Views): Promise<void> {
  const periodLabelElem = document.getElementById("period-label");
  if (periodLabelElem) periodLabelElem.textContent = PERIOD_LABELS[viewType] ?? "This Week";

  const topAiLabelElem = document.getElementById("top-ai-label");
  if (topAiLabelElem) topAiLabelElem.textContent = TOP_AI_PERIOD_LABELS[viewType] ?? "Most used AI This Week";

  const periodTotal = await getPeriodTotal(viewType);
  const periodUsageElem = document.getElementById("period-usage");
  if (periodUsageElem) periodUsageElem.textContent = await renderTime(formatTime(periodTotal));

  const topAi = await getMostUsedProviderForView(viewType);
  const topAiElem = document.getElementById("top-ai-today");
  const topAiTimeElem = document.getElementById("top-ai-today-time");
  if (topAiElem) topAiElem.textContent = topAi ? (PROVIDER_SHORT_NAMES[topAi.provider] ?? topAi.provider) : "—";
  if (topAiTimeElem) topAiTimeElem.textContent = topAi ? await renderTime(formatTime(topAi.ms)) : "";
}

function handleViewChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const value = target.value.toLowerCase();
  if (!isViewType(value)) return;
  currentViewType = value;
  void updateCharts(currentViewType);
  void updateViewDependentStats(currentViewType);
}

/**
 * Re-reads all stored usage and re-renders every widget on the dashboard. Cheap
 * because storage is local, so it's safe to call whenever the data may be stale
 * (initial load, and each time the tab regains focus after the user has been
 * off using an AI in another tab).
 */
async function refreshAll(): Promise<void> {
  // Pick up (and apply to Day.js) the latest week-start preference first so every
  // widget below buckets and labels weeks using the user's chosen first day.
  weekStartsOnSunday = await loadAndApplyWeekStart();
  await Promise.all([
    setStandardUsage(),
    updateViewDependentStats(currentViewType),
    updateCharts(currentViewType),
    refreshBlockControls(),
  ]);
}

// Coalesce the visibility and storage triggers below: switching back from an AI
// tab can fire both within a few ms, and a late session-flush write can arrive
// just after the visibility refresh, so a short debounce keeps it to one render.
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleRefresh(): void {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshAll();
  }, 150);
}

document.addEventListener("DOMContentLoaded", () => {
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="viewType"]');
  radios.forEach((radio) => {
    radio.addEventListener("change", handleViewChange);
  });

  void refreshAll();
});

// Usage keeps accumulating in storage while the dashboard tab is hidden and the
// user is off in an AI tab. Re-read when they return so the numbers aren't stale.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleRefresh();
});

// Switching directly from an AI tab races the background worker's session flush:
// the visibility refresh above often reads storage before `finalizeSession` has
// written the last slice. Re-reading on the storage write itself closes that gap
// regardless of which fires first. Gated on visibility so per-tick writes while
// the dashboard is hidden don't churn a tab nobody is looking at.
browser.storage.sync.onChanged.addListener(() => {
  if (document.visibilityState === "visible") scheduleRefresh();
});

async function setStandardUsage(): Promise<void> {
  const todayTotal = await getTodayUsage();
  const todayUsageElem = document.getElementById("today-usage");
  if (todayUsageElem) todayUsageElem.textContent = await renderTime(formatTime(todayTotal));

  const allTimeTotal = await sumForAllProviders("alltime");
  const allTimeUsageElem = document.getElementById("alltime-usage");
  if (allTimeUsageElem) allTimeUsageElem.textContent = await renderTime(formatTime(allTimeTotal));

  const activeDays = await getActiveDaysThisWeek();
  const activeDaysElem = document.getElementById("active-days");
  if (activeDaysElem) activeDaysElem.textContent = `${activeDays} of 7`;

  const lastWeek = await getLastWeekTotal();
  const lastWeekElem = document.getElementById("last-week-usage");
  if (lastWeekElem) lastWeekElem.textContent = lastWeek > 0 ? await renderTime(formatTime(lastWeek)) : "—";
}

const block_button = document.getElementById("dashboard-block") as HTMLButtonElement;
const snooze_block_button = document.getElementById("dashboard-snooze-block") as HTMLButtonElement;
const toggle_button = document.getElementById("dashboard-toggle") as HTMLButtonElement;

/** Snapshot of every override that influences the block controls. */
export type BlockControlState = {
  /** Manual block setting (`settings:block:manual`). */
  manualBlock: boolean;
  /** All-day "Toggle" that disables every blocker (`isSnoozed`). */
  dayToggledOff: boolean;
  /** 5-minute "Snooze block" that lifts an active block (`isBlockToggledOff`). */
  snoozeActive: boolean;
  /** Whether a block is in effect, ignoring the two overrides above. */
  blockActive: boolean;
};

/** How a single button should be rendered. */
export type ButtonView = { text: string; danger: boolean; disabled: boolean };

export type BlockControlsView = { block: ButtonView; toggle: ButtonView; snoozeBlock: ButtonView };

/**
 * Pure mapping from the stored override state to how each of the three controls
 * should look. Each button maps to one independent piece of state so the
 * controls can't fall out of sync:
 *  - Block: turns the manual block on/off.
 *  - Snooze block: temporarily lifts an active block for 5 minutes; only usable
 *    while a block is actually in effect and the day isn't toggled off.
 *  - Toggle: disables every blocker for the rest of today.
 *
 * Note: the storage helpers are named the opposite of the UI vocabulary —
 * `isBlockToggledOff()`/`setBlockToggle()` back the 5-minute "Snooze block",
 * while `isSnoozed()`/`setSnooze()` back the all-day "Toggle".
 */
export function computeBlockControls(state: BlockControlState): BlockControlsView {
  // The snooze only makes sense while a block is actually in effect, and the
  // all-day toggle already suppresses every block, so the snooze has nothing to
  // act on while the toggle is on. Only show "Resume block" when the snooze is
  // both active and still actionable, so a disabled button never lies.
  const canSnoozeBlock = state.blockActive && !state.dayToggledOff;
  const showResume = state.snoozeActive && canSnoozeBlock;

  return {
    block: { text: state.manualBlock ? "Unblock" : "Block", danger: state.manualBlock, disabled: false },
    toggle: { text: state.dayToggledOff ? "Untoggle" : "Toggle", danger: state.dayToggledOff, disabled: false },
    snoozeBlock: {
      text: showResume ? "Resume block" : "Snooze block",
      danger: showResume,
      disabled: !canSnoozeBlock,
    },
  };
}

function applyButtonView(button: HTMLButtonElement, view: ButtonView): void {
  button.textContent = view.text;
  button.classList.toggle("danger", view.danger);
  button.disabled = view.disabled;
}

/** Reads the current override state and re-renders all three block controls. */
export async function refreshBlockControls(): Promise<void> {
  const [manualBlock, dayToggledOff, snoozeActive, blockActive] = await Promise.all([
    getManualBlock(),
    isSnoozed(), // all-day "Toggle"
    isBlockToggledOff(), // 5-minute "Snooze block"
    hasActiveBlock(true),
  ]);

  const view = computeBlockControls({ manualBlock, dayToggledOff, snoozeActive, blockActive });
  applyButtonView(block_button, view.block);
  applyButtonView(toggle_button, view.toggle);
  applyButtonView(snooze_block_button, view.snoozeBlock);
}

block_button.addEventListener("click", async () => {
  await browser.storage.sync.set({
    "settings:block:manual": !(await getManualBlock()),
  });
  await refreshBlockControls();
});

toggle_button.addEventListener("click", async () => {
  await setSnooze();
  await refreshBlockControls();
});

snooze_block_button.addEventListener("click", async () => {
  if (await isBlockToggledOff()) {
    await unsetBlockToggle();
  } else {
    await setBlockToggle();
  }
  await refreshBlockControls();
});
