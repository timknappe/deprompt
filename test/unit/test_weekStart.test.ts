import { beforeEach, describe, expect, mock, test } from "bun:test";
import dayjs from "dayjs";

// In-memory fake "browser" so the storage-backed helpers can be exercised.
type Bag = Record<string, unknown>;
const syncStore: Bag = {};

const fakeBrowser = {
  storage: {
    sync: {
      get: async (keys: string | string[] | null | undefined) => {
        if (keys == null) return { ...syncStore };
        const list = typeof keys === "string" ? [keys] : keys;
        const out: Bag = {};
        for (const k of list) if (k in syncStore) out[k] = syncStore[k];
        return out;
      },
      set: async (items: Bag) => {
        Object.assign(syncStore, items);
      },
    },
  },
};

mock.module("webextension-polyfill", () => ({ default: fakeBrowser, ...fakeBrowser }));

const {
  WEEK_START_SUNDAY_KEY,
  DEFAULT_WEEK_STARTS_ON_SUNDAY,
  applyWeekStart,
  getWeekStartsOnSunday,
  loadAndApplyWeekStart,
  setWeekStartsOnSunday,
  weekdayLabels,
} = await import("../../src/weekStart.js");

// 2026-04-15 is a Wednesday; its Monday is the 13th and its Sunday is the 12th.
const WEDNESDAY = "2026-04-15";
const MONDAY = "2026-04-13";
const SUNDAY = "2026-04-12";

beforeEach(() => {
  for (const k of Object.keys(syncStore)) delete syncStore[k];
  // Reset Day.js to the default (Monday) so each test starts from a known state.
  applyWeekStart(DEFAULT_WEEK_STARTS_ON_SUNDAY);
});

describe("default", () => {
  test("the extension defaults to weeks starting on Monday", () => {
    expect(DEFAULT_WEEK_STARTS_ON_SUNDAY).toBe(false);
  });
});

describe("applyWeekStart", () => {
  test("Monday: startOf('week') lands on the preceding Monday", () => {
    applyWeekStart(false);
    expect(dayjs(WEDNESDAY).startOf("week").format("YYYY-MM-DD")).toBe(MONDAY);
  });

  test("Sunday: startOf('week') lands on the preceding Sunday", () => {
    applyWeekStart(true);
    expect(dayjs(WEDNESDAY).startOf("week").format("YYYY-MM-DD")).toBe(SUNDAY);
  });

  test("Monday: the Sunday before is treated as the previous week", () => {
    applyWeekStart(false);
    expect(dayjs(WEDNESDAY).isSame(dayjs(SUNDAY), "week")).toBe(false);
    expect(dayjs(WEDNESDAY).isSame(dayjs(MONDAY), "week")).toBe(true);
  });

  test("Sunday: the Sunday before is part of the same week", () => {
    applyWeekStart(true);
    expect(dayjs(WEDNESDAY).isSame(dayjs(SUNDAY), "week")).toBe(true);
  });
});

describe("weekdayLabels", () => {
  test("Monday ordering starts at Mon and ends at Sun", () => {
    expect(weekdayLabels(false)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  test("Sunday ordering starts at Sun and ends at Sat", () => {
    expect(weekdayLabels(true)).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });
});

describe("getWeekStartsOnSunday", () => {
  test("returns the default (Monday) when unset", async () => {
    expect(await getWeekStartsOnSunday()).toBe(false);
  });

  test("returns the stored preference", async () => {
    syncStore[WEEK_START_SUNDAY_KEY] = true;
    expect(await getWeekStartsOnSunday()).toBe(true);
  });
});

describe("setWeekStartsOnSunday", () => {
  test("persists the value and applies it to Day.js", async () => {
    await setWeekStartsOnSunday(true);
    expect(syncStore[WEEK_START_SUNDAY_KEY]).toBe(true);
    expect(dayjs(WEDNESDAY).startOf("week").format("YYYY-MM-DD")).toBe(SUNDAY);

    await setWeekStartsOnSunday(false);
    expect(syncStore[WEEK_START_SUNDAY_KEY]).toBe(false);
    expect(dayjs(WEDNESDAY).startOf("week").format("YYYY-MM-DD")).toBe(MONDAY);
  });
});

describe("loadAndApplyWeekStart", () => {
  test("reads the stored Sunday preference and applies it", async () => {
    syncStore[WEEK_START_SUNDAY_KEY] = true;
    const applied = await loadAndApplyWeekStart();
    expect(applied).toBe(true);
    expect(dayjs(WEDNESDAY).startOf("week").format("YYYY-MM-DD")).toBe(SUNDAY);
  });

  test("falls back to Monday when nothing is stored", async () => {
    const applied = await loadAndApplyWeekStart();
    expect(applied).toBe(false);
    expect(dayjs(WEDNESDAY).startOf("week").format("YYYY-MM-DD")).toBe(MONDAY);
  });
});
