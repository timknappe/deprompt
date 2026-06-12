import { describe, expect, test, beforeEach, mock } from "bun:test";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat.js";
import isBetween from "dayjs/plugin/isBetween.js";

dayjs.extend(customParseFormat);
dayjs.extend(isBetween);

// Mutable stubs that each test configures before calling helpers.
const stubs = {
  checkDailyUsageReminderDuration: async (): Promise<number | null> => null,
  checkLastReminderSent: async (_key: string): Promise<number> => 0,
  checkShowSeconds: async (): Promise<boolean> => false,
  getActiveTrackedPlatforms: async (): Promise<Record<string, readonly string[] | undefined>> => ({}),
  getContinousUsageNotificationLimit: async (): Promise<number | null> => null,
  getCurrentProviderDuration: async (): Promise<number> => 0,
  getFixedBlockDurations: async (): Promise<string[]> => [],
  getHowOftenNotificationSetting: async (): Promise<{ enabled: boolean; minutes: number }> => ({ enabled: true, minutes: 10 }),
  getManualBlock: async (): Promise<boolean> => false,
  getMaxmimumUsageTime: async (): Promise<number | null> => null,
  getTodayUsage: async (_addActiveTime?: boolean): Promise<number> => 0,
  isBlockToggledOff: async (): Promise<boolean> => false,
  isSnoozed: async (): Promise<boolean> => false,
};

mock.module("../../src/storageManager.js", () => ({
  checkDailyUsageReminderDuration: () => stubs.checkDailyUsageReminderDuration(),
  checkLastReminderSent: (key: string) => stubs.checkLastReminderSent(key),
  checkShowSeconds: () => stubs.checkShowSeconds(),
  getActiveTrackedPlatforms: () => stubs.getActiveTrackedPlatforms(),
  getContinousUsageNotificationLimit: () => stubs.getContinousUsageNotificationLimit(),
  getCurrentProviderDuration: () => stubs.getCurrentProviderDuration(),
  getFixedBlockDurations: () => stubs.getFixedBlockDurations(),
  getHowOftenNotificationSetting: () => stubs.getHowOftenNotificationSetting(),
  getManualBlock: () => stubs.getManualBlock(),
  getMaxmimumUsageTime: () => stubs.getMaxmimumUsageTime(),
  getTodayUsage: (addActiveTime?: boolean) => stubs.getTodayUsage(addActiveTime),
  isBlockToggledOff: () => stubs.isBlockToggledOff(),
  isSnoozed: () => stubs.isSnoozed(),
}));

// Import AFTER mocking so the mocked module is wired into helpers.
const {
  formatTime,
  minTimeDifference,
  destructFixedBlocker,
  getTimeTillNextFixedBlocker,
  getTimeTillNextFixedBlockerValue,
  renderTime,
  renderTimeSynchronously,
  isBlocked,
  getCurrentBlockType,
  setButtonBlock,
  getRemainingUsageTime,
  scheduleWindowUI,
  resolveProvider,
} = await import("../../src/helpers.js");

const defaults = { ...stubs };
beforeEach(() => {
  Object.assign(stubs, defaults);
});

describe("formatTime", () => {
  test("converts ms to [h, m, s]", () => {
    expect(formatTime(0)).toEqual([0, 0, 0]);
    expect(formatTime(1000)).toEqual([0, 0, 1]);
    expect(formatTime(60_000)).toEqual([0, 1, 0]);
    expect(formatTime(3_600_000)).toEqual([1, 0, 0]);
    expect(formatTime(3_661_000)).toEqual([1, 1, 1]);
    expect(formatTime(7_322_000)).toEqual([2, 2, 2]);
  });

  test("returns zero tuple for non-number / NaN", () => {
    expect(formatTime(Number.NaN)).toEqual([0, 0, 0]);
    expect(formatTime("abc" as unknown as number)).toEqual([0, 0, 0]);
    expect(formatTime(undefined as unknown as number)).toEqual([0, 0, 0]);
  });

  test("floors fractional seconds", () => {
    expect(formatTime(1999)).toEqual([0, 0, 1]);
  });
});

describe("minTimeDifference", () => {
  test("returns difference in seconds for close times", () => {
    const a = dayjs("10:00:00", "HH:mm:ss");
    const b = dayjs("10:00:30", "HH:mm:ss");
    expect(minTimeDifference(a, b)).toBe(30);
  });

  test("is symmetric (absolute)", () => {
    const a = dayjs("10:00:00", "HH:mm:ss");
    const b = dayjs("10:01:00", "HH:mm:ss");
    expect(minTimeDifference(a, b)).toBe(minTimeDifference(b, a));
  });

  test("wraps across midnight, picking the shorter way around", () => {
    const a = dayjs("23:59:00", "HH:mm:ss");
    const b = dayjs("00:01:00", "HH:mm:ss");
    expect(minTimeDifference(a, b)).toBe(120);
  });

  test("identical times return 0", () => {
    const a = dayjs("12:34:56", "HH:mm:ss");
    expect(minTimeDifference(a, a)).toBe(0);
  });
});

describe("destructFixedBlocker", () => {
  test("parses HH:mm;HH:mm entry into two dayjs values", () => {
    const [start, end] = destructFixedBlocker(["09:30;11:45"], 0);
    expect(start.format("HH:mm")).toBe("09:30");
    expect(end.format("HH:mm")).toBe("11:45");
  });

  test("throws when the entry is missing", () => {
    expect(() => destructFixedBlocker([], 0)).toThrow("Fixed blocker entry missing");
  });

  test("throws on malformed entry", () => {
    expect(() => destructFixedBlocker(["12:00"], 0)).toThrow(/Invalid fixed blocker format/);
    expect(() => destructFixedBlocker(["12:00;13:00;14:00"], 0)).toThrow(/Invalid fixed blocker format/);
  });
});

describe("renderTime / renderTimeSynchronously", () => {
  test("renderTimeSynchronously without seconds", () => {
    expect(renderTimeSynchronously([1, 2, 3], false)).toBe("1h 2m ");
  });

  test("renderTimeSynchronously with seconds", () => {
    expect(renderTimeSynchronously([1, 2, 3], true)).toBe("1h 2m 3s");
  });

  test("renderTime defers to checkShowSeconds = false", async () => {
    stubs.checkShowSeconds = async () => false;
    expect(await renderTime([0, 5, 9])).toBe("0h 5m ");
  });

  test("renderTime defers to checkShowSeconds = true", async () => {
    stubs.checkShowSeconds = async () => true;
    expect(await renderTime([0, 5, 9])).toBe("0h 5m 9s");
  });
});

describe("getTimeTillNextFixedBlocker", () => {
  test("returns 'No blockers set' when there are none", async () => {
    stubs.getFixedBlockDurations = async () => [];
    expect(await getTimeTillNextFixedBlocker()).toBe("No blockers set");
  });

  test("returns 'Blocker currently active' when now is between an entry", async () => {
    const start = dayjs().subtract(1, "hour").format("HH:mm");
    const end = dayjs().add(1, "hour").format("HH:mm");
    stubs.getFixedBlockDurations = async () => [`${start};${end}`];
    expect(await getTimeTillNextFixedBlocker()).toBe("Blocker currently active");
  });

  test("returns next start when one is later today", async () => {
    const start = dayjs().add(2, "hour").format("HH:mm");
    const end = dayjs().add(3, "hour").format("HH:mm");
    stubs.getFixedBlockDurations = async () => [`${start};${end}`];
    expect(await getTimeTillNextFixedBlocker()).toBe(start);
  });

  test("returns 'Tomorrow <first>' when all blockers are in the past", async () => {
    // Skip when "now" is too close to midnight to have a valid past window.
    if (dayjs().hour() < 3) return;
    const start = dayjs().subtract(2, "hour").format("HH:mm");
    const end = dayjs().subtract(1, "hour").format("HH:mm");
    stubs.getFixedBlockDurations = async () => [`${start};${end}`];
    const result = await getTimeTillNextFixedBlocker();
    expect(result.startsWith("Tomorrow ")).toBe(true);
  });
});

describe("getTimeTillNextFixedBlockerValue", () => {
  test("returns null with no blockers", async () => {
    stubs.getFixedBlockDurations = async () => [];
    expect(await getTimeTillNextFixedBlockerValue()).toBeNull();
  });

  test("returns 0 when currently within a blocker", async () => {
    const start = dayjs().subtract(1, "hour").format("HH:mm");
    const end = dayjs().add(1, "hour").format("HH:mm");
    stubs.getFixedBlockDurations = async () => [`${start};${end}`];
    expect(await getTimeTillNextFixedBlockerValue()).toBe(0);
  });

  test("returns a positive seconds value otherwise", async () => {
    const start = dayjs().add(30, "minute").format("HH:mm");
    const end = dayjs().add(60, "minute").format("HH:mm");
    stubs.getFixedBlockDurations = async () => [`${start};${end}`];
    const v = await getTimeTillNextFixedBlockerValue();
    expect(typeof v).toBe("number");
    expect(v!).toBeGreaterThan(0);
    expect(v!).toBeLessThanOrEqual(31 * 60);
    expect(v!).toBeGreaterThanOrEqual(28 * 60);
  });
});

describe("getRemainingUsageTime", () => {
  test("returns null when maximum is unset", async () => {
    stubs.getMaxmimumUsageTime = async () => null;
    expect(await getRemainingUsageTime()).toBeNull();
  });

  test("subtracts today's usage", async () => {
    stubs.getMaxmimumUsageTime = async () => 60_000;
    stubs.getTodayUsage = async () => 20_000;
    expect(await getRemainingUsageTime()).toBe(40_000);
  });

  test("passes addActiveTime through to getTodayUsage", async () => {
    stubs.getMaxmimumUsageTime = async () => 100;
    let receivedFlag: boolean | undefined;
    stubs.getTodayUsage = async (flag?: boolean) => {
      receivedFlag = flag;
      return 30;
    };
    expect(await getRemainingUsageTime(true)).toBe(70);
    expect(receivedFlag).toBe(true);
  });
});

describe("isBlocked / getCurrentBlockType", () => {
  test("not blocked when block toggled off", async () => {
    stubs.isBlockToggledOff = async () => true;
    expect(await isBlocked()).toBe(false);
    expect(await getCurrentBlockType()).toBeNull();
  });

  test("not blocked when snoozed", async () => {
    stubs.isSnoozed = async () => true;
    expect(await isBlocked()).toBe(false);
  });

  test("blocked inside a fixed blocker window -> FixedBlockTime", async () => {
    const start = dayjs().subtract(1, "hour").format("HH:mm");
    const end = dayjs().add(1, "hour").format("HH:mm");
    stubs.getFixedBlockDurations = async () => [`${start};${end}`];
    expect(await isBlocked()).toBe(true);
    expect(await getCurrentBlockType()).toBe("FixedBlockTime");
  });

  test("blocked by manual block when no fixed window matches", async () => {
    stubs.getManualBlock = async () => true;
    expect(await isBlocked()).toBe(true);
    expect(await getCurrentBlockType()).toBe("ManualBlock");
  });

  test("blocked when usage cap reached -> TimeLimit", async () => {
    stubs.getMaxmimumUsageTime = async () => 1_000;
    stubs.getTodayUsage = async () => 1_000;
    expect(await isBlocked()).toBe(true);
    expect(await getCurrentBlockType()).toBe("TimeLimit");
  });

  test("not blocked when below usage cap", async () => {
    stubs.getMaxmimumUsageTime = async () => 1_000;
    stubs.getTodayUsage = async () => 500;
    expect(await isBlocked()).toBe(false);
    expect(await getCurrentBlockType()).toBeNull();
  });

  test("not blocked when no constraints configured", async () => {
    expect(await isBlocked()).toBe(false);
    expect(await getCurrentBlockType()).toBeNull();
  });
});

describe("setButtonBlock (DOM)", () => {
  test("renders 'Unblock' with danger class when blocked", () => {
    const button = document.createElement("button");
    setButtonBlock(button, true);
    expect(button.textContent).toBe("Unblock");
    expect(button.classList.contains("danger")).toBe(true);
  });

  test("renders 'Block' without danger class when not blocked", () => {
    const button = document.createElement("button");
    button.classList.add("danger");
    setButtonBlock(button, false);
    expect(button.textContent).toBe("Block");
    expect(button.classList.contains("danger")).toBe(false);
  });

  test("toggles correctly across multiple calls", () => {
    const button = document.createElement("button");
    setButtonBlock(button, true);
    setButtonBlock(button, false);
    setButtonBlock(button, true);
    expect(button.textContent).toBe("Unblock");
    expect(button.classList.contains("danger")).toBe(true);
  });
});

describe("scheduleWindowUI", () => {
  test("returns the current block type when blocked and block not toggled off", async () => {
    stubs.getManualBlock = async () => true;
    expect(await scheduleWindowUI()).toBe("ManualBlock");
  });

  test("returns BlockedSoonReminder when next fixed blocker is within 5 minutes and reminder is stale", async () => {
    const soon = dayjs().add(2, "minute").format("HH:mm");
    const soonEnd = dayjs().add(10, "minute").format("HH:mm");
    stubs.getFixedBlockDurations = async () => [`${soon};${soonEnd}`];
    stubs.checkLastReminderSent = async () => 9999;
    expect(await scheduleWindowUI()).toBe("BlockedSoonReminder");
  });

  test("does not return BlockedSoonReminder if reminder was just sent", async () => {
    const soon = dayjs().add(2, "minute").format("HH:mm");
    const soonEnd = dayjs().add(10, "minute").format("HH:mm");
    stubs.getFixedBlockDurations = async () => [`${soon};${soonEnd}`];
    stubs.checkLastReminderSent = async () => 10;
    expect(await scheduleWindowUI()).toBeNull();
  });

  test("returns ContinuousUsageReminder when continuous limit exceeded and stale", async () => {
    stubs.getContinousUsageNotificationLimit = async () => 1_000;
    stubs.getCurrentProviderDuration = async () => 5_000;
    stubs.checkLastReminderSent = async (key) => (key === "ContinuousUsageReminder" ? 9999 : 0);
    expect(await scheduleWindowUI()).toBe("ContinuousUsageReminder");
  });

  test("returns DailyUsageReminder when daily limit exceeded and stale", async () => {
    stubs.checkDailyUsageReminderDuration = async () => 1_000;
    stubs.getTodayUsage = async () => 5_000;
    stubs.checkLastReminderSent = async (key) => (key === "DailyUsageReminder" ? 9999 : 0);
    expect(await scheduleWindowUI()).toBe("DailyUsageReminder");
  });

  test("returns null when nothing is triggered", async () => {
    expect(await scheduleWindowUI()).toBeNull();
  });

  test("skips BlockedSoonReminder when block is toggled off but still checks daily", async () => {
    stubs.isBlockToggledOff = async () => true;
    stubs.checkDailyUsageReminderDuration = async () => 1_000;
    stubs.getTodayUsage = async () => 5_000;
    stubs.checkLastReminderSent = async (key) => (key === "DailyUsageReminder" ? 9999 : 0);
    expect(await scheduleWindowUI()).toBe("DailyUsageReminder");
  });
});

describe("resolveProvider", () => {
  test("returns null for an unparseable URL", async () => {
    expect(await resolveProvider("not a url")).toBeNull();
  });

  test("returns null when no domains are configured", async () => {
    stubs.getActiveTrackedPlatforms = async () => ({});
    expect(await resolveProvider("https://chatgpt.com/")).toBeNull();
  });

  test("matches a configured provider by hostname substring", async () => {
    stubs.getActiveTrackedPlatforms = async () => ({
      openai: ["chatgpt.com"],
      anthropic: ["claude.ai"],
    });
    expect(await resolveProvider("https://chatgpt.com/c/abc")).toBe("openai");
    expect(await resolveProvider("https://claude.ai/chats")).toBe("anthropic");
  });

  test("returns null when no provider matches", async () => {
    stubs.getActiveTrackedPlatforms = async () => ({ openai: ["chatgpt.com"] });
    expect(await resolveProvider("https://example.com/")).toBeNull();
  });

  test("skips providers with undefined domain lists", async () => {
    stubs.getActiveTrackedPlatforms = async () => ({
      openai: undefined,
      anthropic: ["claude.ai"],
    });
    expect(await resolveProvider("https://claude.ai/")).toBe("anthropic");
    expect(await resolveProvider("https://chatgpt.com/")).toBeNull();
  });

  test("resolves a custom provider by its host", async () => {
    // Custom providers arrive through getActiveTrackedPlatforms keyed by their slug id.
    stubs.getActiveTrackedPlatforms = async () => ({
      openai: ["chatgpt.com"],
      "my-cool-ai": ["mycoolai.com"],
    });
    expect((await resolveProvider("https://app.mycoolai.com/chat")) as string).toBe("my-cool-ai");
    expect(await resolveProvider("https://chatgpt.com/")).toBe("openai");
  });
});
