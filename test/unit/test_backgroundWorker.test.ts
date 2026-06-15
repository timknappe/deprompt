import { afterAll, describe, expect, mock, test } from "bun:test";

// Track every listener registration & the calls into stubbed dependencies so
// we can invoke handlers and assert behavior without booting the polyfill.

type AnyFn = (...args: any[]) => any;

const listeners: Record<string, AnyFn[]> = {
  "alarms.onAlarm": [],
  "tabs.onUpdated": [],
  "tabs.onActivated": [],
  "tabs.onRemoved": [],
  "windows.onFocusChanged": [],
  "runtime.onInstalled": [],
  "runtime.onMessage": [],
  "storage.sync.onChanged": [],
};

const stubCalls = {
  initializeDefaults: 0,
  rollover: 0,
  reconcileActiveSessionOnInit: 0 as number,
  finalizeSession: [] as string[],
  setBlockToggle: 0,
  ejectBlockPopup: [] as number[],
  ejectReminderPopup: [] as number[],
  tabsRemove: [] as number[],
};

const fakeBrowser = {
  alarms: {
    onAlarm: { addListener: (cb: AnyFn) => listeners["alarms.onAlarm"]!.push(cb) },
    create: () => undefined,
    clear: async () => true,
  },
  tabs: {
    onUpdated: { addListener: (cb: AnyFn) => listeners["tabs.onUpdated"]!.push(cb) },
    onActivated: { addListener: (cb: AnyFn) => listeners["tabs.onActivated"]!.push(cb) },
    onRemoved: { addListener: (cb: AnyFn) => listeners["tabs.onRemoved"]!.push(cb) },
    query: async () => [],
    get: async (tabId: number) => ({ id: tabId, active: true, windowId: 1, url: "https://example.com" }),
    remove: async (tabId: number) => {
      stubCalls.tabsRemove.push(tabId);
    },
    create: async () => undefined,
  },
  windows: {
    onFocusChanged: { addListener: (cb: AnyFn) => listeners["windows.onFocusChanged"]!.push(cb) },
    get: async () => ({ focused: true, type: "normal" }),
    WINDOW_ID_NONE: -1,
  },
  runtime: {
    onInstalled: { addListener: (cb: AnyFn) => listeners["runtime.onInstalled"]!.push(cb) },
    onMessage: { addListener: (cb: AnyFn) => listeners["runtime.onMessage"]!.push(cb) },
    getURL: (p: string) => `chrome-extension://fake/${p}`,
  },
  storage: {
    sync: {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => undefined,
      onChanged: { addListener: (cb: AnyFn) => listeners["storage.sync.onChanged"]!.push(cb) },
    },
    local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined },
  },
};

mock.module("webextension-polyfill", () => ({ default: fakeBrowser, ...fakeBrowser }));

mock.module("../../src/storageManager.js", () => ({
  startTimerForProvider: async () => undefined,
  finalizeSession: async (reason: string) => {
    stubCalls.finalizeSession.push(reason);
  },
  isAliveCheck: async () => undefined,
  reconcileActiveSessionOnInit: async () => {
    stubCalls.reconcileActiveSessionOnInit += 1;
  },
  rollover: async () => {
    stubCalls.rollover += 1;
  },
  setBlockToggle: async () => {
    stubCalls.setBlockToggle += 1;
  },
  initializeDefaults: async () => {
    stubCalls.initializeDefaults += 1;
  },
  persistActiveDuration: async () => undefined,
  getCountUnfocusedTime: async () => true,
}));

mock.module("../../src/helpers.js", () => ({
  isBlocked: async () => false,
  resolveProvider: async (_url: string) => null,
  scheduleWindowUI: async () => null,
}));

mock.module("../../src/contentScripts.js", () => ({
  ejectBlockPopup: async (tabId: number) => {
    stubCalls.ejectBlockPopup.push(tabId);
  },
  ejectReminderPopup: async (tabId: number) => {
    stubCalls.ejectReminderPopup.push(tabId);
  },
  injectBlockScreen: async () => undefined,
  injectReminder: async () => undefined,
  isBlockPopupInjected: async () => false,
}));

// Import the worker — this runs all the top-level listener registrations + initPromise.
await import("../../src/backgroundWorker.js");

afterAll(() => {
  // Reset module mocks so other test files aren't affected.
});

describe("listener wiring", () => {
  test("registers an alarms.onAlarm listener", () => {
    expect(listeners["alarms.onAlarm"]!.length).toBeGreaterThan(0);
  });

  test("registers tab lifecycle listeners", () => {
    expect(listeners["tabs.onUpdated"]!.length).toBeGreaterThan(0);
    expect(listeners["tabs.onActivated"]!.length).toBeGreaterThan(0);
    expect(listeners["tabs.onRemoved"]!.length).toBeGreaterThan(0);
  });

  test("registers a windows.onFocusChanged listener", () => {
    expect(listeners["windows.onFocusChanged"]!.length).toBeGreaterThan(0);
  });

  test("registers runtime listeners", () => {
    expect(listeners["runtime.onInstalled"]!.length).toBeGreaterThan(0);
    expect(listeners["runtime.onMessage"]!.length).toBeGreaterThan(0);
  });
});

describe("initialization", () => {
  test("initializeDefaults, rollover, reconcileActiveSessionOnInit ran at startup", async () => {
    // initPromise is fire-and-forget, but storageManager stubs resolve immediately.
    // Yield a few microtasks to be sure.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(stubCalls.initializeDefaults).toBeGreaterThanOrEqual(1);
    expect(stubCalls.rollover).toBeGreaterThanOrEqual(1);
    expect(stubCalls.reconcileActiveSessionOnInit).toBeGreaterThanOrEqual(1);
  });
});

describe("runtime.onMessage dispatch", () => {
  const handler = () => listeners["runtime.onMessage"]![0]!;

  test("ignores messages without a sender tab id", async () => {
    const before = stubCalls.tabsRemove.length;
    await handler()({ action: "CLOSE_TAB" }, { tab: undefined });
    expect(stubCalls.tabsRemove.length).toBe(before);
  });

  test("CLOSE_TAB removes the sender tab", async () => {
    await handler()({ action: "CLOSE_TAB" }, { tab: { id: 77 } });
    expect(stubCalls.tabsRemove).toContain(77);
  });

  test("TOGGLE_BLOCK ejects the block popup and sets the block toggle", async () => {
    const ejectsBefore = stubCalls.ejectBlockPopup.length;
    const togglesBefore = stubCalls.setBlockToggle;
    await handler()({ action: "TOGGLE_BLOCK" }, { tab: { id: 5 } });
    expect(stubCalls.ejectBlockPopup.length).toBe(ejectsBefore + 1);
    expect(stubCalls.ejectBlockPopup).toContain(5);
    expect(stubCalls.setBlockToggle).toBe(togglesBefore + 1);
  });

  test("CLOSE_REMINDER ejects the reminder popup", async () => {
    await handler()({ action: "CLOSE_REMINDER" }, { tab: { id: 9 } });
    expect(stubCalls.ejectReminderPopup).toContain(9);
  });

  test("unknown actions are no-ops (do not throw)", async () => {
    await expect(handler()({ action: "BOGUS" }, { tab: { id: 1 } })).resolves.toBeUndefined();
  });
});

describe("runtime.onInstalled", () => {
  test("initializes defaults on a fresh install", async () => {
    const before = stubCalls.initializeDefaults;
    await listeners["runtime.onInstalled"]![0]!({ reason: "install" });
    expect(stubCalls.initializeDefaults).toBeGreaterThan(before);
  });

  test("does nothing for non-install reasons", async () => {
    const before = stubCalls.initializeDefaults;
    await listeners["runtime.onInstalled"]![0]!({ reason: "update" });
    expect(stubCalls.initializeDefaults).toBe(before);
  });
});
