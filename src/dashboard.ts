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
import {
  formatTime,
  getCurrentBlockType,
  isBlocked,
  renderTime,
  renderTimeSynchronously,
  setButtonBlock,
} from "./helpers.js";
import {
  getActiveTrackedPlatformKeys,
  getActiveTrackedPlatformUsage,
  getTodayUsage,
  isSnoozed,
  setBlockToggle,
  setSnooze,
  sumForAllProviders,
} from "./storageManager.js";
import dayjs from "dayjs";
import type { Views } from "./types.js";
import browser from "webextension-polyfill";
ChartJS.register(BarController, BarElement, CategoryScale, LinearScale, PieController, ArcElement, Tooltip, Legend);

const PROVIDER_SHORT_NAMES: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  gemini: "Gemini",
  copilot: "Copilot",
  poe: "Poe",
  perplexity: "Perplexity",
  pi: "Pi",
  reka: "Reka",
  mistral: "Mistral",
  grok: "Grok",
  qwen: "Qwen",
  meta: "Meta AI",
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

async function getMostUsedProviderToday(): Promise<{ provider: string; ms: number } | null> {
  const today = dayjs().format("YYYY-MM-DD");
  const providers = await getActiveTrackedPlatformKeys();
  let best: { provider: string; ms: number } | null = null;

  for (const pid of providers) {
    const key = `daily:${today}:${pid}`;
    const obj = await browser.storage.sync.get(key);
    const raw = obj[key];
    if (typeof raw === "number" && raw > 0) {
      if (!best || raw > best.ms) {
        best = { provider: pid, ms: raw };
      }
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

function isViewType(value: string): value is Views {
  return VIEW_TYPES.includes(value.toLowerCase() as Views);
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
  const labels = LABELS_BY_VIEW[viewType] ?? [];
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
      animation: false,
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

function handleViewChange(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const value = target.value.toLowerCase();
  if (!isViewType(value)) return;
  currentViewType = value;
  void updateCharts(currentViewType);
}

document.addEventListener("DOMContentLoaded", () => {
  const radios = document.querySelectorAll<HTMLInputElement>('input[name="viewType"]');
  radios.forEach((radio) => {
    radio.addEventListener("change", handleViewChange);
  });

  void setStandardUsage();
  void updateCharts(currentViewType);
});

async function setStandardUsage(): Promise<void> {
  // Today
  const todayTotal = await getTodayUsage();
  const todayUsageElem = document.getElementById("today-usage");
  if (todayUsageElem) {
    todayUsageElem.textContent = await renderTime(formatTime(todayTotal));
  }

  // This week
  const weekTotal = await getThisWeekTotal();
  const weekUsageElem = document.getElementById("week-usage");
  if (weekUsageElem) {
    weekUsageElem.textContent = await renderTime(formatTime(weekTotal));
  }

  // All time
  const allTimeTotal = await sumForAllProviders("alltime");
  const allTimeUsageElem = document.getElementById("alltime-usage");
  if (allTimeUsageElem) {
    allTimeUsageElem.textContent = await renderTime(formatTime(allTimeTotal));
  }

  // Top AI today
  const topAi = await getMostUsedProviderToday();
  const topAiElem = document.getElementById("top-ai-today");
  const topAiTimeElem = document.getElementById("top-ai-today-time");
  if (topAiElem) {
    topAiElem.textContent = topAi ? (PROVIDER_SHORT_NAMES[topAi.provider] ?? topAi.provider) : "—";
  }
  if (topAiTimeElem) {
    topAiTimeElem.textContent = topAi ? await renderTime(formatTime(topAi.ms)) : "";
  }

  // Active days this week
  const activeDays = await getActiveDaysThisWeek();
  const activeDaysElem = document.getElementById("active-days");
  if (activeDaysElem) {
    activeDaysElem.textContent = `${activeDays} of 7`;
  }

  // Last week total
  const lastWeek = await getLastWeekTotal();
  const lastWeekElem = document.getElementById("last-week-usage");
  if (lastWeekElem) {
    lastWeekElem.textContent = lastWeek > 0 ? await renderTime(formatTime(lastWeek)) : "—";
  }
}

const block_button = document.getElementById("dashboard-block")!;
const snooze_button = document.getElementById("dashboard-snooze")!;

block_button.addEventListener("click", async () => {
  const curentBlockReason = await getCurrentBlockType(true);
  if (curentBlockReason === "ManualBlock" || curentBlockReason === null) {
    await browser.storage.sync.set({
      "settings:block:manual": !(await isBlocked(true)),
    });
    const blockState: boolean = await isBlocked(true);
    block_button.textContent = blockState ? "Unblock" : "Block";
    block_button.classList.toggle("danger", blockState);
  } else {
    await setBlockToggle();
    const blockState: boolean = await isBlocked(true);
    block_button.textContent = blockState ? "Toggle block (5 minutes)" : "Block";
    block_button.classList.toggle("danger", blockState);
  }
});

snooze_button.addEventListener("click", async () => {
  await setSnooze();
  const snoozeState = await isSnoozed();

  snooze_button.textContent = snoozeState ? "Unsnooze" : "Snooze for today";
  snooze_button.classList.toggle("danger", snoozeState);

  if (snoozeState === true) {
    (block_button as HTMLButtonElement).disabled = true;
  } else {
    (block_button as HTMLButtonElement).disabled = false;
  }

  if ((await isBlocked()) && snoozeState === false) {
    setButtonBlock(block_button, true);
  } else if ((await isBlocked) && snoozeState === true) {
    setButtonBlock(block_button, false);
  }
});

document.addEventListener("DOMContentLoaded", async () => {
  const blocked: boolean = await isBlocked(true);
  const blockReason = await getCurrentBlockType(true);

  if (blockReason === "ManualBlock") {
    block_button.textContent = blocked ? "Unblock" : "Block";
    block_button.classList.toggle("danger", blocked);
  } else {
    block_button.textContent = blocked ? "Toggle block (5 minutes)" : "Block";
    block_button.classList.toggle("danger", blocked);
  }

  const snoozeState = await isSnoozed();
  snooze_button.textContent = snoozeState ? "Unsnooze" : "Snooze for today";
  snooze_button.classList.toggle("danger", !!snoozeState);
});
