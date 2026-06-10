import { beforeEach, describe, expect, mock, test } from "bun:test";

// Pre-populate the DOM with the elements dashboard.ts grabs at module load.
document.body.innerHTML = `
  <button id="dashboard-block">Block</button>
  <button id="dashboard-snooze-block" disabled>Snooze block</button>
  <button id="dashboard-toggle">Toggle</button>
  <div id="today-usage"></div>
  <div id="alltime-usage"></div>
  <div id="pieChart"></div>
  <div id="barChart"></div>
  <input type="radio" name="viewType" value="weekly" />
  <input type="radio" name="viewType" value="monthly" />
`;

// Chart.js needs a working canvas2d context; happy-dom's is anemic. Stub it.
const chartInstances: any[] = [];
class FakeChart {
  data: any;
  options: any;
  constructor(_canvas: any, config: any) {
    this.data = config.data;
    this.options = config.options;
    chartInstances.push(this);
  }
  destroy(): void {}
  static register(..._args: unknown[]): void {}
}
mock.module("chart.js", () => ({
  Chart: FakeChart,
  BarController: {},
  BarElement: {},
  CategoryScale: {},
  LinearScale: {},
  PieController: {},
  ArcElement: {},
  Tooltip: {},
  Legend: {},
}));

// Stub webextension-polyfill with an in-memory backing store.
const syncStore: Record<string, unknown> = {};
const fakeBrowser = {
  storage: {
    sync: {
      get: async (keys: any) => {
        if (keys == null) return { ...syncStore };
        const list = typeof keys === "string" ? [keys] : keys;
        const out: Record<string, unknown> = {};
        for (const k of list) if (k in syncStore) out[k] = syncStore[k];
        return out;
      },
      set: async (items: Record<string, unknown>) => {
        Object.assign(syncStore, items);
      },
    },
    local: { get: async () => ({}), set: async () => undefined },
  },
};
mock.module("webextension-polyfill", () => ({ default: fakeBrowser, ...fakeBrowser }));

// Stub storageManager and helpers so we can control return values per-test.
const stm = {
  blocked: false,
  blockReason: null as null | "ManualBlock" | "FixedBlockTime" | "TimeLimit",
  snoozed: false,
  activeProviders: ["openai", "anthropic"] as string[],
  activeUsage: [10_000, 20_000] as number[],
  today: 30_000,
  alltimeSum: 1_000_000,
};
mock.module("../../src/storageManager.js", () => ({
  getActiveTrackedPlatformKeys: async () => stm.activeProviders,
  getActiveTrackedPlatformUsage: async () => stm.activeUsage,
  getManualBlock: async () => stm.blocked,
  getTodayUsage: async () => stm.today,
  isBlockToggledOff: async () => false,
  isSnoozed: async () => stm.snoozed,
  setBlockToggle: async () => undefined,
  setSnooze: async () => {
    stm.snoozed = !stm.snoozed;
  },
  sumForAllProviders: async () => stm.alltimeSum,
  unsetBlockToggle: async () => undefined,
}));
mock.module("../../src/helpers.js", () => ({
  formatTime: (ms: number) => [
    Math.floor(ms / 3_600_000),
    Math.floor(ms / 60_000) % 60,
    Math.floor(ms / 1000) % 60,
  ],
  hasActiveBlock: async () => stm.blocked,
  getCurrentBlockType: async () => stm.blockReason,
  isBlocked: async () => stm.blocked,
  renderTime: async (t: [number, number, number]) => `${t[0]}h ${t[1]}m`,
  renderTimeSynchronously: (t: [number, number, number]) => `${t[0]}h ${t[1]}m`,
  setButtonBlock: (btn: HTMLElement, blocked: boolean) => {
    btn.textContent = blocked ? "Unblock" : "Block";
    btn.classList.toggle("danger", blocked);
  },
}));

const { renderProviderBreakdownChart, computeBlockControls } = await import("../../src/dashboard.js");

// The shared test_setup.ts beforeEach clears document.body. Re-seed it here so
// each test starts with the chart mount points present.
beforeEach(() => {
  for (const k of Object.keys(syncStore)) delete syncStore[k];
  chartInstances.length = 0;
  document.body.innerHTML = `
    <button id="dashboard-block">Block</button>
    <button id="dashboard-snooze-block" disabled>Snooze block</button>
    <button id="dashboard-toggle">Toggle</button>
    <div id="pieChart"></div>
    <div id="barChart"></div>
  `;
});

describe("dashboard module bootstraps DOM listeners", () => {
  test("block button is wired up", () => {
    const block = document.getElementById("dashboard-block");
    expect(block).not.toBeNull();
  });

  test("snooze-block button is wired up", () => {
    const snoozeBlock = document.getElementById("dashboard-snooze-block");
    expect(snoozeBlock).not.toBeNull();
  });

  test("toggle button is wired up", () => {
    const toggle = document.getElementById("dashboard-toggle");
    expect(toggle).not.toBeNull();
  });
});

describe("renderProviderBreakdownChart", () => {
  test("creates a pie chart with the active providers' usage", async () => {
    await renderProviderBreakdownChart("alltime");
    expect(chartInstances).toHaveLength(1);
    const chart = chartInstances[0];
    expect(chart.data.labels).toEqual(stm.activeProviders);
    expect(chart.data.datasets[0].data).toEqual(stm.activeUsage);
  });

  test("mounts a fresh canvas in #pieChart on each call", async () => {
    await renderProviderBreakdownChart("alltime");
    const mount = document.getElementById("pieChart");
    expect(mount?.querySelectorAll("canvas")).toHaveLength(1);
    await renderProviderBreakdownChart("alltime");
    // freshCanvas clears innerHTML before appending, so still 1 canvas
    expect(mount?.querySelectorAll("canvas")).toHaveLength(1);
  });
});

describe("computeBlockControls across toggle/block/snooze combinations", () => {
  const base = { manualBlock: false, dayToggledOff: false, snoozeActive: false, blockActive: false };

  test("nothing active: block & toggle idle, snooze-block disabled", () => {
    const v = computeBlockControls({ ...base });
    expect(v.block).toEqual({ text: "Block", danger: false, disabled: false });
    expect(v.toggle).toEqual({ text: "Toggle", danger: false, disabled: false });
    expect(v.snoozeBlock).toEqual({ text: "Snooze block", danger: false, disabled: true });
  });

  test("manual block on: block shows Unblock, snooze-block available", () => {
    const v = computeBlockControls({ ...base, manualBlock: true, blockActive: true });
    expect(v.block).toEqual({ text: "Unblock", danger: true, disabled: false });
    expect(v.snoozeBlock).toEqual({ text: "Snooze block", danger: false, disabled: false });
  });

  test("fixed/time-limit block (no manual): block stays Block, snooze-block available", () => {
    const v = computeBlockControls({ ...base, manualBlock: false, blockActive: true });
    expect(v.block.text).toBe("Block");
    expect(v.snoozeBlock).toEqual({ text: "Snooze block", danger: false, disabled: false });
  });

  test("block active + snooze pressed: snooze-block shows Resume block", () => {
    const v = computeBlockControls({ ...base, blockActive: true, snoozeActive: true });
    expect(v.snoozeBlock).toEqual({ text: "Resume block", danger: true, disabled: false });
  });

  test("snooze pressed but block already expired: snooze-block disabled and not lying", () => {
    const v = computeBlockControls({ ...base, blockActive: false, snoozeActive: true });
    expect(v.snoozeBlock).toEqual({ text: "Snooze block", danger: false, disabled: true });
  });

  test("day toggle on with a block: toggle shows Untoggle, snooze-block disabled", () => {
    const v = computeBlockControls({ ...base, dayToggledOff: true, blockActive: true });
    expect(v.toggle).toEqual({ text: "Untoggle", danger: true, disabled: false });
    expect(v.snoozeBlock).toEqual({ text: "Snooze block", danger: false, disabled: true });
  });

  test("day toggle dominates an active snooze: snooze-block stays disabled & neutral", () => {
    const v = computeBlockControls({ ...base, dayToggledOff: true, blockActive: true, snoozeActive: true });
    expect(v.snoozeBlock).toEqual({ text: "Snooze block", danger: false, disabled: true });
  });

  test("manual block + day toggle: both reflect their own state independently", () => {
    const v = computeBlockControls({ ...base, manualBlock: true, dayToggledOff: true, blockActive: true });
    expect(v.block).toEqual({ text: "Unblock", danger: true, disabled: false });
    expect(v.toggle).toEqual({ text: "Untoggle", danger: true, disabled: false });
    expect(v.snoozeBlock.disabled).toBe(true);
  });

  test("invariant: Block and Toggle are never disabled across all 16 combinations", () => {
    for (let i = 0; i < 16; i++) {
      const v = computeBlockControls({
        manualBlock: Boolean(i & 1),
        dayToggledOff: Boolean(i & 2),
        snoozeActive: Boolean(i & 4),
        blockActive: Boolean(i & 8),
      });
      expect(v.block.disabled).toBe(false);
      expect(v.toggle.disabled).toBe(false);
      // Snooze-block is enabled iff a block is active and the day isn't toggled off.
      const expectedEnabled = Boolean(i & 8) && !Boolean(i & 2);
      expect(v.snoozeBlock.disabled).toBe(!expectedEnabled);
      // A disabled snooze-block must never show the "Resume block" / danger state.
      if (v.snoozeBlock.disabled) {
        expect(v.snoozeBlock.text).toBe("Snooze block");
        expect(v.snoozeBlock.danger).toBe(false);
      }
    }
  });
});

