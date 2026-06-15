import dayjs from "dayjs";
// Importing this applies the default (Monday) week start to Day.js before the
// week-based LABELS_BY_VIEW entries below are computed at module load.
import { WEEK_START_SUNDAY_KEY } from "./weekStart.js";
import type { ToggleableDurationSetting, ProviderId, ProviderSelections, SettingsState, Views } from "./types.js";

export const PROVIDER_COLORS: Record<string, string> = {
  openai: "#74AA9C",
  anthropic: "#DE7356",
  gemini: "#078EFA",
  copilot: "#199FD7",
  perplexity: "#20808D",
  mistral: "#FA500F",
  grok: "#596CED",
  qwen: "#6F4AFF",
  meta: "#0082FB",
  deepseek: "#4D6BFE",
  moonshot: "#EC4899",
};

export const PROVIDER_COLOR_TEST: Record<string, string> = {
  openai: "#AACC96",
  anthropic: "#25533F",
  gemini: "#F4BEAE",
  copilot: "#52A5CE",
  perplexity: "#876029",
  mistral: "#EFCE7B",
  grok: "#B8CEE8",
  qwen: "#EF6F3C",
  meta: "#AFAB23",
  deepseek: "#9DB0FF",
  moonshot: "#F7A8CE",
};

export const DEFAULT_PROVIDER_COLOR = "rgb(124, 77, 255)";
export const DEFAULT_PROVIDER_HOVER_COLOR = "#8e63ff";
export const VIEW_TYPES: Views[] = ["weekly", "monthly", "yearly", "alltime"];

export const LABELS_BY_VIEW: Record<Views, string[]> = {
  weekly: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  monthly: Array.from(
    { length: 4 },
    (_, i) =>
      dayjs().startOf("week").subtract(3, "weeks").add(i, "weeks").format("DD.MM") +
      " - " +
      dayjs()
        .startOf("week")
        .subtract(3, "weeks")
        .add(i + 1, "weeks")
        .subtract(1, "day")
        .format("DD.MM"),
  ),
  yearly: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  alltime: Array.from({ length: dayjs().year() - 2025 + 1 }, (_, i) => (2025 + i).toString()),
  daily: [],
};

export const MAX_WEEKS_TO_KEEP = 4;

export const STORAGE_KEYS = {
  timeLimit: "settings:timeLimit",
  notificationDaily: "settings:notification:daily",
  notificationContinuous: "settings:notification:continuous",
  notificationHowOften: "settings:notification:howOften",
  blockFixedTime: "settings:block:fixed",
  providers: "settings:providers",
  formattingShowSeconds: "settings:formatting:showSeconds",
  formattingWeekStartSunday: WEEK_START_SUNDAY_KEY,
  trackingCountUnfocused: "settings:tracking:countUnfocused",
  customProvidersToAdd: "providers:custom:toAdd",
  customProvidersAdded: "providers:custom:added",
} as const;

export const SETTINGS_PROVIDERS = {
  openai: "OpenAI (ChatGPT)",
  anthropic: "Anthropic (Claude)",
  gemini: "Gemini",
  copilot: "Microsoft Copilot",
  perplexity: "Perplexity",
  mistral: "Mistral",
  grok: "Grok",
  qwen: "Qwen",
  meta: "Meta AI",
  deepseek: "DeepSeek",
  moonshot: "MoonshotAI (Kimi)",
} as const;

export const DEFAULT_SETTINGS: SettingsState = {
  timeLimit: { enabled: true, minutes: 60 },
  notifications: {
    daily: { enabled: true, minutes: 45 } satisfies ToggleableDurationSetting,
    continuous: { enabled: true, minutes: 15 } satisfies ToggleableDurationSetting,
    howOften: { enabled: true, minutes: 10 } satisfies ToggleableDurationSetting,
  },
  block: { fixedTime: [] },
  providers: Object.keys(SETTINGS_PROVIDERS).reduce<ProviderSelections>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {}),
  formatting: {
    showSeconds: true,
    weekStartsOnSunday: false,
  },
  tracking: {
    countUnfocusedTime: true,
  },
};

export const ONBOARDING_PROVIDERS: ReadonlyArray<[string, string]> = [
  ["openai", "OpenAI (ChatGPT)"],
  ["anthropic", "Anthropic (Claude)"],
  ["gemini", "Gemini"],
  ["copilot", "Copilot - Microsoft"],
  ["perplexity", "Perplexity"],
  ["mistral", "Mistral"],
  ["grok", "Grok"],
  ["qwen", "Qwen"],
  ["meta", "Meta AI"],
  ["deepseek", "DeepSeek"],
  ["moonshot", "MoonshotAI (Kimi)"],
];

export const TARGET_DOMAINS = {
  openai: ["chat.openai.com", "chatgpt.com"],
  anthropic: ["claude.ai"],
  gemini: ["gemini.google.com"],
  copilot: ["copilot.microsoft.com"],
  perplexity: ["perplexity.ai"],
  mistral: ["chat.mistral.ai"],
  grok: ["Grok"],
  qwen: ["chat.qwen.ai"],
  meta: ["meta.ai"],
  deepseek: ["chat.deepseek.com"],
  moonshot: ["kimi.com"],
} as const;

export const ALL_PROVIDER_IDS = Object.keys(TARGET_DOMAINS) as ProviderId[];

// #region custom provider helpers
/**
 * Turns a free-form provider name into a stable storage id (slug).
 * @param {string} name - Display name entered by the user.
 * @returns {string} Lowercase kebab-case id, or "" when nothing usable remains.
 */
export function slugifyCustomProviderId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Normalizes user URL input into a host match pattern (e.g. "https://claude.ai/*").
 * @param {string} input - Raw URL or hostname entered by the user.
 * @returns {string|null} A `<scheme>://<host>/*` match pattern, or null when invalid.
 */
export function normalizeCustomProviderPattern(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  const hasHttpScheme = /^https?:\/\//i.test(raw);
  let working = raw;
  if (!hasHttpScheme) {
    working = "https://" + working.replace(/^\*:\/\//, "").replace(/^\/+/, "");
  }

  let host: string;
  try {
    host = new URL(working).hostname;
  } catch {
    return null;
  }
  if (!host || !host.includes(".")) return null;

  const scheme = /^http:\/\//i.test(raw) ? "http" : "https";
  return `${scheme}://${host}/*`;
}

/**
 * Extracts the bare hostname from a custom provider match pattern.
 * @param {string} pattern - Match pattern such as "https://claude.ai/*".
 * @returns {string} The hostname, e.g. "claude.ai".
 */
export function customProviderHost(pattern: string): string {
  try {
    return new URL(pattern.replace(/\/\*$/, "/")).hostname;
  } catch {
    return pattern.replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  }
}

/**
 * Turns a match pattern into a navigable URL for opening the site in a tab.
 * @param {string} pattern - Match pattern such as "https://claude.ai/*".
 * @returns {string} A navigable URL, e.g. "https://claude.ai/".
 */
export function customProviderNavigableUrl(pattern: string): string {
  return pattern.replace(/\*$/, "");
}
// #endregion

export const REMINDER_CONTENT_SCRIPT = {
  html: "in-page/reminder.html",
  javascript: "in-page/reminder.js",
  css: "in-page/reminder.css",
  js_flag: "deprompt-reminder-unique-flag",
  css_flag: "--deprompt-reminder-css-loaded",
};

export const BLOCKER_CONTENT_SCRIPT = {
  html: "in-page/blocked_notification.html",
  javascript: "in-page/blockedNotification.js",
  css: "in-page/blockedNotification.css",
  js_flag: "deprompt-block-unique-flag",
  css_flag: "--deprompt-block-css-loaded",
};
