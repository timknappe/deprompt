export type Views = "daily" | "weekly" | "monthly" | "yearly" | "alltime";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "copilot"
  | "perplexity"
  | "mistral"
  | "qwen"
  | "meta"
  | "grok"
  | "deepseek"
  | "moonshot";

type BrowserMessage = "CLOSE_TAB" | "TOGGLE_BLOCK" | "CLOSE_REMINDER";

export type UsageTime = [number, number, number];

export type WindowUiNotifications = Blockers | Reminder;

export type Blockers = "FixedBlockTime" | "TimeLimit" | "ManualBlock";

export type Reminder = "DailyUsageReminder" | "ContinuousUsageReminder" | "BlockedSoonReminder" | null;

export type ProviderSelections = Record<string, boolean>;

/** A user-added custom provider: its display name and host match pattern (e.g. "https://claude.ai/*"). */
export type CustomProvider = { name: string; url: string };

/** Map of custom provider id -> definition, stored under `providers:custom:added`. */
export type CustomProvidersAdded = Record<string, CustomProvider>;

export type StepRenderer = () => void;

export type ProviderSettings = Partial<Record<ProviderId, boolean>>;

export type IndexScope = Exclude<Views, "alltime">;

export type ToggleableDurationSetting = { enabled: boolean; minutes: number };

export type SettingsState = {
  timeLimit: ToggleableDurationSetting;
  notifications: {
    daily: ToggleableDurationSetting;
    continuous: ToggleableDurationSetting;
    howOften: ToggleableDurationSetting;
  };
  block: { fixedTime: string[] };
  providers: ProviderSelections;
  formatting: {
    showSeconds: boolean;
  };
  tracking: {
    countUnfocusedTime: boolean;
  };
};
