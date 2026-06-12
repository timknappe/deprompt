import { describe, expect, test } from "bun:test";
import {
  ALL_PROVIDER_IDS,
  BLOCKER_CONTENT_SCRIPT,
  DEFAULT_PROVIDER_COLOR,
  DEFAULT_PROVIDER_HOVER_COLOR,
  DEFAULT_SETTINGS,
  LABELS_BY_VIEW,
  MAX_WEEKS_TO_KEEP,
  ONBOARDING_PROVIDERS,
  PROVIDER_COLORS,
  PROVIDER_COLOR_TEST,
  REMINDER_CONTENT_SCRIPT,
  SETTINGS_PROVIDERS,
  STORAGE_KEYS,
  TARGET_DOMAINS,
  VIEW_TYPES,
  customProviderHost,
  customProviderNavigableUrl,
  normalizeCustomProviderPattern,
  slugifyCustomProviderId,
} from "../../src/constants.js";

describe("provider tables stay aligned", () => {
  test("PROVIDER_COLORS, PROVIDER_COLOR_TEST, SETTINGS_PROVIDERS and TARGET_DOMAINS share the same keys", () => {
    const targetKeys = Object.keys(TARGET_DOMAINS).sort();
    expect(Object.keys(PROVIDER_COLORS).sort()).toEqual(targetKeys);
    expect(Object.keys(PROVIDER_COLOR_TEST).sort()).toEqual(targetKeys);
    expect(Object.keys(SETTINGS_PROVIDERS).sort()).toEqual(targetKeys);
  });

  test("every PROVIDER_COLORS entry is a valid CSS color string", () => {
    for (const [, color] of Object.entries(PROVIDER_COLORS)) {
      expect(typeof color).toBe("string");
      expect(color).toMatch(/^#|^rgb/);
    }
  });

  test("ALL_PROVIDER_IDS is derived from TARGET_DOMAINS", () => {
    expect(ALL_PROVIDER_IDS).toEqual(Object.keys(TARGET_DOMAINS) as typeof ALL_PROVIDER_IDS);
  });

  test("every TARGET_DOMAINS entry has at least one domain", () => {
    for (const [, domains] of Object.entries(TARGET_DOMAINS)) {
      expect(domains.length).toBeGreaterThan(0);
    }
  });

  test("ONBOARDING_PROVIDERS covers every tracked provider id exactly once", () => {
    const ids = ONBOARDING_PROVIDERS.map(([id]) => id).sort();
    expect(ids).toEqual([...ALL_PROVIDER_IDS].sort());
  });
});

describe("DEFAULT_SETTINGS", () => {
  test("enables every provider by default", () => {
    for (const id of Object.keys(SETTINGS_PROVIDERS)) {
      expect(DEFAULT_SETTINGS.providers[id]).toBe(true);
    }
  });

  test("has sensible toggleable durations", () => {
    expect(DEFAULT_SETTINGS.timeLimit.enabled).toBe(true);
    expect(DEFAULT_SETTINGS.timeLimit.minutes).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.notifications.daily.minutes).toBeGreaterThan(0);
    expect(DEFAULT_SETTINGS.notifications.continuous.minutes).toBeGreaterThan(0);
  });

  test("starts with no fixed blockers", () => {
    expect(DEFAULT_SETTINGS.block.fixedTime).toEqual([]);
  });
});

describe("LABELS_BY_VIEW", () => {
  test("weekly labels are 7 day names", () => {
    expect(LABELS_BY_VIEW.weekly).toHaveLength(7);
  });

  test("monthly labels are 4 weekly ranges", () => {
    expect(LABELS_BY_VIEW.monthly).toHaveLength(4);
    for (const label of LABELS_BY_VIEW.monthly) {
      expect(label).toMatch(/^\d{2}\.\d{2} - \d{2}\.\d{2}$/);
    }
  });

  test("yearly labels are 12 month names", () => {
    expect(LABELS_BY_VIEW.yearly).toHaveLength(12);
  });

  test("alltime labels are non-empty year strings", () => {
    expect(LABELS_BY_VIEW.alltime.length).toBeGreaterThan(0);
    for (const y of LABELS_BY_VIEW.alltime) {
      expect(y).toMatch(/^\d{4}$/);
    }
  });

  test("daily labels are empty (rendered elsewhere)", () => {
    expect(LABELS_BY_VIEW.daily).toEqual([]);
  });
});

describe("misc constants", () => {
  test("VIEW_TYPES is the expected ordered set", () => {
    expect(VIEW_TYPES).toEqual(["weekly", "monthly", "yearly", "alltime"]);
  });

  test("MAX_WEEKS_TO_KEEP is a positive integer", () => {
    expect(Number.isInteger(MAX_WEEKS_TO_KEEP)).toBe(true);
    expect(MAX_WEEKS_TO_KEEP).toBeGreaterThan(0);
  });

  test("default provider colors are CSS strings", () => {
    expect(DEFAULT_PROVIDER_COLOR).toMatch(/^rgb|^#/);
    expect(DEFAULT_PROVIDER_HOVER_COLOR).toMatch(/^rgb|^#/);
  });

  test("STORAGE_KEYS values are all unique and namespaced", () => {
    const values = Object.values(STORAGE_KEYS);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) {
      expect(v.startsWith("settings:") || v.startsWith("providers:")).toBe(true);
    }
  });

  test("BLOCKER_CONTENT_SCRIPT and REMINDER_CONTENT_SCRIPT have distinct flags", () => {
    expect(BLOCKER_CONTENT_SCRIPT.js_flag).not.toBe(REMINDER_CONTENT_SCRIPT.js_flag);
    expect(BLOCKER_CONTENT_SCRIPT.css_flag).not.toBe(REMINDER_CONTENT_SCRIPT.css_flag);
  });
});

describe("custom provider helpers", () => {
  test("slugifyCustomProviderId produces stable kebab-case ids", () => {
    expect(slugifyCustomProviderId("Claude")).toBe("claude");
    expect(slugifyCustomProviderId("  My Cool AI!! ")).toBe("my-cool-ai");
    expect(slugifyCustomProviderId("***")).toBe("");
  });

  test("normalizeCustomProviderPattern builds a host match pattern", () => {
    expect(normalizeCustomProviderPattern("claude.ai")).toBe("https://claude.ai/*");
    expect(normalizeCustomProviderPattern("https://claude.ai")).toBe("https://claude.ai/*");
    expect(normalizeCustomProviderPattern("https://claude.ai/*")).toBe("https://claude.ai/*");
    expect(normalizeCustomProviderPattern("http://example.com/chat")).toBe("http://example.com/*");
  });

  test("normalizeCustomProviderPattern rejects invalid input", () => {
    expect(normalizeCustomProviderPattern("")).toBeNull();
    expect(normalizeCustomProviderPattern("   ")).toBeNull();
    expect(normalizeCustomProviderPattern("localhost")).toBeNull();
    expect(normalizeCustomProviderPattern("not a url")).toBeNull();
  });

  test("customProviderHost and customProviderNavigableUrl round-trip a pattern", () => {
    const pattern = "https://claude.ai/*";
    expect(customProviderHost(pattern)).toBe("claude.ai");
    expect(customProviderNavigableUrl(pattern)).toBe("https://claude.ai/");
  });
});
