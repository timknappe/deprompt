export type Views = "daily" | "weekly" | "monthly" | "yearly" | "alltime";

export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "copilot"
  | "poe"
  | "perplexity"
  | "pi"
  | "reka"
  | "mistral"
  | "qwen"
  | "meta"
  | "grok";

type BrowserMessage = "CLOSE_TAB" | "TOGGLE_BLOCK" | "CLOSE_REMINDER";

export type UsageTime = [number, number, number];

export type WindowUiNotifications = Blockers | Reminder;

export type Blockers = "FixedBlockTime" | "TimeLimit" | "ManualBlock";

export type Reminder = "DailyUsageReminder" | "ContinuousUsageReminder" | "BlockedSoonReminder" | null;

export type ProviderSelections = Record<string, boolean>;

export type StepRenderer = () => void;

export type ProviderSettings = Partial<Record<ProviderId, boolean>>;

export type IndexScope = Exclude<Views, "alltime">;

export type ToggleableDurationSetting = { enabled: boolean; minutes: number };

export type SettingsState = {
  timeLimit: ToggleableDurationSetting;
  notifications: {
    daily: ToggleableDurationSetting;
    continuous: ToggleableDurationSetting;
  };
  block: { fixedTime: string[] };
  providers: ProviderSelections;
  formatting: {
    showSeconds: boolean;
  };
};
