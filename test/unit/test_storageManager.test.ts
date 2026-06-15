import { beforeEach, describe, expect, mock, test } from "bun:test";
import dayjs from "dayjs";
import {
  ALL_PROVIDER_IDS,
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  TARGET_DOMAINS,
} from "../../src/constants.js";

// In-memory fake "browser" replacing webextension-polyfill for this file.
// storageManager only touches: storage.sync, storage.local, alarms.create/get/clear.

type Bag = Record<string, unknown>;
const syncStore: Bag = {};
const localStore: Bag = {};
const alarmCalls: { name: string; opts?: unknown }[] = [];
const alarmClearCalls: string[] = [];
const activeAlarms = new Map<string, { name: string }>();

function pickKeys(store: Bag, keys: string | string[] | null | undefined): Bag {
  if (keys == null) return { ...store };
  const list = typeof keys === "string" ? [keys] : keys;
  const out: Bag = {};
  for (const k of list) if (k in store) out[k] = store[k];
  return out;
}

const fakeBrowser = {
  storage: {
    sync: {
      get: async (keys: string | string[] | null | undefined) => pickKeys(syncStore, keys),
      set: async (items: Bag) => {
        Object.assign(syncStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const k of typeof keys === "string" ? [keys] : keys) delete syncStore[k];
      },
      clear: async () => {
        for (const k of Object.keys(syncStore)) delete syncStore[k];
      },
    },
    local: {
      get: async (keys: string | string[] | null | undefined) => pickKeys(localStore, keys),
      set: async (items: Bag) => {
        Object.assign(localStore, items);
      },
      remove: async (keys: string | string[]) => {
        for (const k of typeof keys === "string" ? [keys] : keys) delete localStore[k];
      },
      clear: async () => {
        for (const k of Object.keys(localStore)) delete localStore[k];
      },
    },
  },
  alarms: {
    create: (name: string, opts?: unknown) => {
      alarmCalls.push({ name, opts });
      activeAlarms.set(name, { name });
    },
    get: async (name: string) => activeAlarms.get(name),
    clear: async (name: string) => {
      alarmClearCalls.push(name);
      return activeAlarms.delete(name);
    },
  },
};

mock.module("webextension-polyfill", () => ({ default: fakeBrowser, ...fakeBrowser }));

const {
  checkDailyUsageReminderDuration,
  checkLastReminderSent,
  checkShowSeconds,
  flushPendingToSync,
  getActiveTrackedPlatformKeys,
  getActiveTrackedPlatforms,
  getActiveTrackedPlatformUsage,
  getAllProviderIds,
  getCustomProvidersAdded,
  getContinousUsageNotificationLimit,
  getCountUnfocusedTime,
  getCurrentProviderDuration,
  getFixedBlockDurations,
  getManualBlock,
  getMaxmimumUsageTime,
  initializeDefaults,
  isBlockToggledOff,
  isSnoozed,
  normalizeDateKey,
  setBlockToggle,
  setSnooze,
  startTimerForProvider,
  sumForAllProviders,
  unsetBlockToggle,
} = await import("../../src/storageManager.js");

beforeEach(() => {
  for (const k of Object.keys(syncStore)) delete syncStore[k];
  for (const k of Object.keys(localStore)) delete localStore[k];
  alarmCalls.length = 0;
  alarmClearCalls.length = 0;
  activeAlarms.clear();
});

describe("normalizeDateKey", () => {
  test("formats a timestamp as YYYY-MM-DD in the local timezone", () => {
    const ts = dayjs("2025-03-14 10:00:00").valueOf();
    expect(normalizeDateKey(ts)).toBe("2025-03-14");
  });
});

describe("checkShowSeconds", () => {
  test("returns the stored boolean", async () => {
    syncStore["settings:formatting:showSeconds"] = true;
    expect(await checkShowSeconds()).toBe(true);
  });

  test("defaults to false when missing", async () => {
    expect(await checkShowSeconds()).toBe(false);
  });
});

describe("getCountUnfocusedTime", () => {
  test("returns stored value when present", async () => {
    syncStore["settings:tracking:countUnfocused"] = false;
    expect(await getCountUnfocusedTime()).toBe(false);
  });

  test("falls back to default when missing", async () => {
    expect(await getCountUnfocusedTime()).toBe(DEFAULT_SETTINGS.tracking.countUnfocusedTime);
  });
});

describe("getManualBlock", () => {
  test("returns the stored boolean", async () => {
    syncStore["settings:block:manual"] = true;
    expect(await getManualBlock()).toBe(true);
  });
});

describe("getMaxmimumUsageTime", () => {
  test("returns null when unset", async () => {
    expect(await getMaxmimumUsageTime()).toBeNull();
  });

  test("returns null when disabled via object form", async () => {
    syncStore["settings:timeLimit"] = { enabled: false, minutes: 30 };
    expect(await getMaxmimumUsageTime()).toBeNull();
  });

  test("returns ms when enabled object form has minutes", async () => {
    syncStore["settings:timeLimit"] = { enabled: true, minutes: 30 };
    expect(await getMaxmimumUsageTime()).toBe(30 * 60 * 1000);
  });

  test("returns ms when stored as a raw positive number (legacy)", async () => {
    syncStore["settings:timeLimit"] = 45;
    expect(await getMaxmimumUsageTime()).toBe(45 * 60 * 1000);
  });

  test("falls back to default minutes when object form has no numeric minutes", async () => {
    syncStore["settings:timeLimit"] = { enabled: true };
    expect(await getMaxmimumUsageTime()).toBe(DEFAULT_SETTINGS.timeLimit.minutes * 60 * 1000);
  });
});

describe("checkDailyUsageReminderDuration", () => {
  test("returns null when disabled", async () => {
    syncStore["settings:notification:daily"] = { enabled: false, minutes: 5 };
    expect(await checkDailyUsageReminderDuration()).toBeNull();
  });

  test("returns ms when enabled", async () => {
    syncStore["settings:notification:daily"] = { enabled: true, minutes: 15 };
    expect(await checkDailyUsageReminderDuration()).toBe(15 * 60 * 1000);
  });

  test("returns null when missing", async () => {
    expect(await checkDailyUsageReminderDuration()).toBeNull();
  });
});

describe("getContinousUsageNotificationLimit", () => {
  test("returns ms when enabled", async () => {
    syncStore["settings:notification:continuous"] = { enabled: true, minutes: 10 };
    expect(await getContinousUsageNotificationLimit()).toBe(10 * 60 * 1000);
  });

  test("returns null when disabled or missing", async () => {
    expect(await getContinousUsageNotificationLimit()).toBeNull();
  });
});

describe("checkLastReminderSent", () => {
  test("returns a large number when no reminder recorded", async () => {
    const seconds = await checkLastReminderSent("DailyUsageReminder");
    expect(seconds).toBeGreaterThan(1_000_000);
  });

  test("returns small seconds when reminder was sent moments ago", async () => {
    syncStore["meta:lastReminder"] = { DailyUsageReminder: Date.now() - 5_000 };
    const seconds = await checkLastReminderSent("DailyUsageReminder");
    expect(seconds).toBeGreaterThanOrEqual(4);
    expect(seconds).toBeLessThan(10);
  });
});

describe("getFixedBlockDurations", () => {
  test("returns the stored string array", async () => {
    syncStore["settings:block:fixed"] = ["09:00;10:00", "14:00;15:00"];
    expect(await getFixedBlockDurations()).toEqual(["09:00;10:00", "14:00;15:00"]);
  });

  test("returns [] when value isn't an array", async () => {
    syncStore["settings:block:fixed"] = "garbage";
    expect(await getFixedBlockDurations()).toEqual([]);
  });

  test("filters out non-string entries", async () => {
    syncStore["settings:block:fixed"] = ["09:00;10:00", 123, null, "11:00;12:00"];
    expect(await getFixedBlockDurations()).toEqual(["09:00;10:00", "11:00;12:00"]);
  });
});

describe("provider settings + usage", () => {
  test("getActiveTrackedPlatformKeys filters by settings:providers", async () => {
    syncStore["settings:providers"] = { openai: true, anthropic: false, gemini: true };
    const keys = await getActiveTrackedPlatformKeys();
    expect(keys).toContain("openai");
    expect(keys).toContain("gemini");
    expect(keys).not.toContain("anthropic");
  });

  test("getActiveTrackedPlatforms returns the corresponding TARGET_DOMAINS slice", async () => {
    syncStore["settings:providers"] = { openai: true, anthropic: false };
    const platforms = await getActiveTrackedPlatforms();
    expect(platforms.openai).toEqual(TARGET_DOMAINS.openai);
    expect(platforms.anthropic).toBeUndefined();
  });

  test("sumForAllProviders adds numbers across providers, ignoring NaN/non-numbers", async () => {
    syncStore["alltime:openai"] = 10;
    syncStore["alltime:anthropic"] = 20;
    syncStore["alltime:gemini"] = Number.NaN;
    syncStore["alltime:copilot"] = "oops";
    const total = await sumForAllProviders("alltime");
    expect(total).toBe(30);
  });

  test("getActiveTrackedPlatformUsage returns usage entries aligned with active providers", async () => {
    // Disable everyone, enable only openai and anthropic, so length is predictable.
    const providers: Record<string, boolean> = {};
    for (const id of Object.keys(TARGET_DOMAINS)) providers[id] = false;
    providers.openai = true;
    providers.anthropic = true;
    syncStore["settings:providers"] = providers;
    syncStore["alltime:openai"] = 7;
    syncStore["alltime:anthropic"] = 9;
    const usage = await getActiveTrackedPlatformUsage("alltime");
    expect(usage).toHaveLength(2);
    expect(usage.reduce((a, b) => a + b, 0)).toBe(16);
  });
});

describe("custom providers integration", () => {
  const claudeAdded = { claude: { name: "Claude", url: "https://claude.ai/*" } };

  test("getCustomProvidersAdded parses valid entries and drops malformed ones", async () => {
    syncStore[STORAGE_KEYS.customProvidersAdded] = {
      ok: { name: "Ok", url: "https://ok.com/*" },
      missingUrl: { name: "NoUrl" },
      wrongTypes: { name: 1, url: 2 },
      notAnObject: "nope",
    };
    const added = await getCustomProvidersAdded();
    expect(Object.keys(added)).toEqual(["ok"]);
    expect(added.ok).toEqual({ name: "Ok", url: "https://ok.com/*" });
  });

  test("getCustomProvidersAdded returns {} when nothing is stored", async () => {
    expect(await getCustomProvidersAdded()).toEqual({});
  });

  test("getAllProviderIds appends custom ids to the built-in list", async () => {
    syncStore[STORAGE_KEYS.customProvidersAdded] = {
      claude: { name: "Claude", url: "https://claude.ai/*" },
      foo: { name: "Foo", url: "https://foo.com/*" },
    };
    const ids = await getAllProviderIds();
    for (const builtin of ALL_PROVIDER_IDS) expect(ids).toContain(builtin);
    expect(ids).toContain("claude");
    expect(ids).toContain("foo");
    expect(ids).toHaveLength(ALL_PROVIDER_IDS.length + 2);
  });

  test("getActiveTrackedPlatformKeys includes a custom provider that is enabled by default", async () => {
    syncStore["settings:providers"] = { openai: true, anthropic: false };
    syncStore[STORAGE_KEYS.customProvidersAdded] = claudeAdded;
    const keys = (await getActiveTrackedPlatformKeys()) as string[];
    expect(keys).toContain("openai");
    expect(keys).toContain("claude");
    expect(keys).not.toContain("anthropic");
  });

  test("getActiveTrackedPlatformKeys excludes a custom provider turned off in settings", async () => {
    syncStore["settings:providers"] = { claude: false };
    syncStore[STORAGE_KEYS.customProvidersAdded] = claudeAdded;
    const keys = (await getActiveTrackedPlatformKeys()) as string[];
    expect(keys).not.toContain("claude");
  });

  test("getActiveTrackedPlatforms maps a custom provider id to its host", async () => {
    syncStore[STORAGE_KEYS.customProvidersAdded] = claudeAdded;
    const platforms = await getActiveTrackedPlatforms();
    expect(platforms.claude).toEqual(["claude.ai"]);
  });

  test("sumForAllProviders includes custom provider usage", async () => {
    syncStore[STORAGE_KEYS.customProvidersAdded] = claudeAdded;
    syncStore["alltime:openai"] = 10;
    syncStore["alltime:claude"] = 25;
    expect(await sumForAllProviders("alltime")).toBe(35);
  });

  test("getActiveTrackedPlatformUsage surfaces custom provider usage", async () => {
    const providers: Record<string, boolean> = {};
    for (const id of Object.keys(TARGET_DOMAINS)) providers[id] = false;
    syncStore["settings:providers"] = providers;
    syncStore[STORAGE_KEYS.customProvidersAdded] = claudeAdded;
    syncStore["alltime:claude"] = 42;
    const usage = await getActiveTrackedPlatformUsage("alltime");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toBe(42);
  });
});

describe("block toggle / snooze", () => {
  test("isBlockToggledOff is false when stamp missing", async () => {
    expect(await isBlockToggledOff()).toBe(false);
  });

  test("isBlockToggledOff is true while stamp is in the future", async () => {
    localStore["meta:userToggleStamp"] = Date.now() + 60_000;
    expect(await isBlockToggledOff()).toBe(true);
  });

  test("isBlockToggledOff is false once stamp is in the past", async () => {
    localStore["meta:userToggleStamp"] = Date.now() - 60_000;
    expect(await isBlockToggledOff()).toBe(false);
  });

  test("setBlockToggle writes a stamp roughly N minutes in the future", async () => {
    const before = Date.now();
    await setBlockToggle(10);
    const stamp = localStore["meta:userToggleStamp"] as number;
    expect(stamp).toBeGreaterThanOrEqual(before + 10 * 60 * 1000 - 50);
    expect(stamp).toBeLessThan(before + 10 * 60 * 1000 + 1000);
  });

  test("unsetBlockToggle removes the stamp", async () => {
    localStore["meta:userToggleStamp"] = Date.now();
    await unsetBlockToggle();
    expect("meta:userToggleStamp" in localStore).toBe(false);
  });

  test("isSnoozed compares stored value to today's date", async () => {
    syncStore["meta:userSnooze"] = dayjs().format("YYYY-MM-DD");
    expect(await isSnoozed()).toBe(true);
    syncStore["meta:userSnooze"] = "1999-01-01";
    expect(await isSnoozed()).toBe(false);
  });

  test("setSnooze writes today when not snoozed, clears when already snoozed", async () => {
    await setSnooze();
    expect(syncStore["meta:userSnooze"]).toBe(dayjs().format("YYYY-MM-DD"));
    await setSnooze();
    expect(syncStore["meta:userSnooze"]).toBeNull();
  });
});

describe("initializeDefaults", () => {
  test("writes every default when storage is empty", async () => {
    await initializeDefaults();
    expect(syncStore[STORAGE_KEYS.timeLimit]).toEqual(DEFAULT_SETTINGS.timeLimit);
    expect(syncStore[STORAGE_KEYS.notificationDaily]).toEqual(DEFAULT_SETTINGS.notifications.daily);
    expect(syncStore[STORAGE_KEYS.notificationContinuous]).toEqual(DEFAULT_SETTINGS.notifications.continuous);
    expect(syncStore[STORAGE_KEYS.providers]).toEqual(DEFAULT_SETTINGS.providers);
    expect(syncStore[STORAGE_KEYS.formattingShowSeconds]).toBe(DEFAULT_SETTINGS.formatting.showSeconds);
    expect(syncStore[STORAGE_KEYS.trackingCountUnfocused]).toBe(DEFAULT_SETTINGS.tracking.countUnfocusedTime);
  });

  test("does nothing when everything is already configured", async () => {
    const existing = {
      [STORAGE_KEYS.timeLimit]: { enabled: true, minutes: 30 },
      [STORAGE_KEYS.notificationDaily]: { enabled: true, minutes: 5 },
      [STORAGE_KEYS.notificationContinuous]: { enabled: true, minutes: 5 },
      [STORAGE_KEYS.providers]: { openai: true },
      [STORAGE_KEYS.formattingShowSeconds]: true,
      [STORAGE_KEYS.trackingCountUnfocused]: true,
    };
    Object.assign(syncStore, existing);
    await initializeDefaults();
    // Untouched
    expect(syncStore[STORAGE_KEYS.timeLimit]).toEqual(existing[STORAGE_KEYS.timeLimit]);
  });
});

describe("flushPendingToSync", () => {
  test("no-ops when amountMs <= 0", async () => {
    await flushPendingToSync("openai", 0, Date.now());
    expect(Object.keys(syncStore)).toHaveLength(0);
  });

  test("writes per-bucket increments plus updated indices", async () => {
    const ts = dayjs("2026-04-15 10:00:00").valueOf();
    await flushPendingToSync("openai", 5_000, ts);
    expect(syncStore["daily:2026-04-15:openai"]).toBe(5_000);
    expect(syncStore["month:2026-04:openai"]).toBe(5_000);
    expect(syncStore["year:2026:openai"]).toBe(5_000);
    expect(syncStore["alltime:openai"]).toBe(5_000);
    expect(syncStore["index:daily:openai"]).toContain("2026-04-15");
    expect(syncStore["index:monthly:openai"]).toContain("2026-04");
  });

  test("accumulates on repeated calls", async () => {
    const ts = dayjs("2026-04-15 10:00:00").valueOf();
    await flushPendingToSync("openai", 3_000, ts);
    await flushPendingToSync("openai", 2_000, ts);
    expect(syncStore["alltime:openai"]).toBe(5_000);
    // Indices should not duplicate
    expect((syncStore["index:daily:openai"] as string[]).filter((d) => d === "2026-04-15")).toHaveLength(1);
  });
});

describe("session timer", () => {
  test("startTimerForProvider writes runtime keys and creates the syncTimer alarm", async () => {
    await startTimerForProvider("openai");
    expect(localStore["meta:runtime:provider"]).toBe("openai");
    expect(typeof localStore["meta:runtime:start"]).toBe("number");
    expect(localStore["meta:runtime:pendingMs"]).toBe(0);
    expect(alarmCalls).toEqual([{ name: "syncTimer", opts: { periodInMinutes: 1 } }]);
  });

  test("startTimerForProvider does not recreate an existing syncTimer alarm", async () => {
    // Recreating an alarm resets its clock; repeated session starts (e.g. on
    // every MV3 service-worker restart) must not push the heartbeat back.
    await startTimerForProvider("openai");
    await startTimerForProvider("anthropic");
    expect(alarmCalls).toEqual([{ name: "syncTimer", opts: { periodInMinutes: 1 } }]);
  });

  test("getCurrentProviderDuration is 0 when no session is active", async () => {
    expect(await getCurrentProviderDuration()).toBe(0);
  });

  test("getCurrentProviderDuration returns ms since start", async () => {
    localStore["meta:runtime:start"] = Date.now() - 1_500;
    const d = await getCurrentProviderDuration();
    expect(d).toBeGreaterThanOrEqual(1_400);
    expect(d).toBeLessThan(3_000);
  });
});
