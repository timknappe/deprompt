import { beforeEach, describe, expect, mock, test } from "bun:test";

// Pre-populate the wizard mount; the module throws at import otherwise.
document.body.innerHTML = `<div id="wizard"></div>`;

const syncStore: Record<string, unknown> = {};
const localStore: Record<string, unknown> = {};

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
    local: {
      get: async () => ({}),
      set: async (items: Record<string, unknown>) => {
        Object.assign(localStore, items);
      },
    },
  },
};
mock.module("webextension-polyfill", () => ({ default: fakeBrowser, ...fakeBrowser }));

await import("../../src/firstTimeInstall.js");

const wizardRef = document.getElementById("wizard")!;

beforeEach(() => {
  // Re-attach the wizard element after the shared setup clears document.body.
  document.body.appendChild(wizardRef);
});

// wipes document.body between tests, so we run every assertion as a single sequential walkthrough.
describe("first-time install wizard", () => {
  test("renders step 1, persists notification settings, then advances to step 2", async () => {
    const wizard = document.getElementById("wizard");
    expect(wizard?.innerHTML).toContain("Step 1");

    const daily = document.getElementById("notifyDailyDuration") as HTMLInputElement;
    const continuous = document.getElementById("notifyContinuousDuration") as HTMLInputElement;
    const dailyToggle = document.getElementById("notifyDailyToggle") as HTMLInputElement;
    const continuousToggle = document.getElementById("notifyContinuousToggle") as HTMLInputElement;
    expect(daily.value).toBe("45");
    expect(continuous.value).toBe("15");

    dailyToggle.checked = true;
    continuousToggle.checked = true;
    const next = document.getElementById("next") as HTMLButtonElement;
    next.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(syncStore["settings:notification:daily"]).toEqual({ enabled: true, minutes: 45 });
    expect(syncStore["settings:notification:continuous"]).toEqual({ enabled: true, minutes: 15 });

    expect(document.getElementById("wizard")?.innerHTML).toContain("Step 2");
    expect(document.getElementById("blockToggle")).not.toBeNull();
    expect(document.getElementById("fixedBlockToggle")).not.toBeNull();
  });
});
