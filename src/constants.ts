import dayjs from "dayjs";
import type { ToggleableDurationSetting, ProviderId, ProviderSelections, SettingsState, Views } from "./types.js";

export const PROVIDER_COLORS: Record<string, string> = {
  openai: "#74AA9C",
  anthropic: "#DE7356",
  gemini: "#078EFA",
  copilot: "#199FD7",
  poe: "#B92B27",
  perplexity: "#20808D",
  pi: "#1DB954",
  reka: "#0F58FF",
  mistral: "#FA500F",
  grok: "#596CED",
  qwen: "#6F4AFF",
  meta: "#0082FB",
};

export const PROVIDER_COLOR_TEST: Record<string, string> = {
  openai: "#AACC96",
  anthropic: "#25533F",
  gemini: "#F4BEAE",
  copilot: "#52A5CE",
  poe: "#FF7BAC",
  perplexity: "#876029",
  pi: "#6D1F42",
  reka: "#D3B6D3",
  mistral: "#EFCE7B",
  grok: "#B8CEE8",
  qwen: "#EF6F3C",
  meta: "#AFAB23",
};

export const DEFAULT_PROVIDER_COLOR = "rgb(124, 77, 255)";
export const DEFAULT_PROVIDER_HOVER_COLOR = "#8e63ff";
export const VIEW_TYPES: Views[] = ["weekly", "monthly", "yearly", "alltime"];

export const LABELS_BY_VIEW: Record<Views, string[]> = {
  weekly: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
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
  blockFixedTime: "settings:block:fixed",
  providers: "settings:providers",
  formattingShowSeconds: "settings:formatting:showSeconds",
} as const;

export const SETTINGS_PROVIDERS = {
  openai: "OpenAI (ChatGPT)",
  anthropic: "Anthropic (Claude)",
  gemini: "Gemini",
  copilot: "Microsoft Copilot",
  poe: "Poe",
  perplexity: "Perplexity",
  pi: "Pi",
  reka: "Reka",
  mistral: "Mistral",
  grok: "Grok",
  qwen: "Qwen",
  meta: "Meta AI",
} as const;

export const DEFAULT_SETTINGS: SettingsState = {
  timeLimit: { enabled: true, minutes: 60 },
  notifications: {
    daily: { enabled: true, minutes: 45 } satisfies ToggleableDurationSetting,
    continuous: { enabled: true, minutes: 15 } satisfies ToggleableDurationSetting,
  },
  block: { fixedTime: [] },
  providers: Object.keys(SETTINGS_PROVIDERS).reduce<ProviderSelections>((acc, key) => {
    acc[key] = true;
    return acc;
  }, {}),
  formatting: {
    showSeconds: true,
  },
};

export const ONBOARDING_PROVIDERS: ReadonlyArray<[string, string]> = [
  ["openai", "OpenAI (ChatGPT)"],
  ["anthropic", "Anthropic (Claude)"],
  ["gemini", "Gemini"],
  ["copilot", "Copilot - Microsoft"],
  ["poe", "Poe"],
  ["perplexity", "Perplexity"],
  ["pi", "Pi"],
  ["reka", "Reka"],
  ["mistral", "Mistral"],
  ["grok", "Grok"],
  ["qwen", "Qwen"],
  ["meta", "Meta AI"],
];

export const TARGET_DOMAINS = {
  openai: ["chat.openai.com", "chatgpt.com"],
  anthropic: ["claude.ai"],
  gemini: ["gemini.google.com"],
  copilot: ["copilot.microsoft.com"],
  poe: ["poe.com"],
  perplexity: ["perplexity.ai"],
  pi: ["pi.ai"],
  reka: ["reka.ai", "reka.ai/chat"],
  mistral: ["chat.mistral.ai"],
  grok: ["Grok"],
  qwen: ["chat.qwen.ai"],
  meta: ["meta.ai"],
} as const;

export const ALL_PROVIDER_IDS = Object.keys(TARGET_DOMAINS) as ProviderId[];

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
