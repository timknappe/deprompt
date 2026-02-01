import dayjs from "dayjs";
import {
  checkDailyUsageReminderDuration,
  checkLastReminderSent,
  checkShowSeconds,
  getActiveTrackedPlatforms,
  getContinousUsageNotificationLimit,
  getCurrentProviderDuration,
  getFixedBlockDurations,
  getManualBlock,
  getMaxmimumUsageTime,
  getTodayUsage,
  isBlockToggledOff,
  isSnoozed,
} from "./storageManager.js";
import type { Blockers, ProviderId, Reminder, UsageTime, WindowUiNotifications } from "./types.js";
import isBetween from "dayjs/plugin/isBetween.js";
import customParseFormat from "dayjs/plugin/customParseFormat.js";

dayjs.extend(customParseFormat);
dayjs.extend(isBetween);

export const formatTime = (milliseconds: number): UsageTime => {
  if (typeof milliseconds !== "number" || Number.isNaN(milliseconds)) {
    return [0, 0, 0];
  }

  const totalMinutes = Math.floor(milliseconds / (1000 * 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor(milliseconds / 1000) % 60;

  return [hours, minutes, seconds];
};

export function minTimeDifference(t1: dayjs.Dayjs, t2: dayjs.Dayjs): number {
  const format = "HH:mm:ss";

  const a = dayjs(t1, format);
  const b = dayjs(t2, format);

  const diffSeconds = Math.abs(a.diff(b, "second"));
  const wrapSeconds = 24 * 60 * 60 - diffSeconds;

  return Math.min(diffSeconds, wrapSeconds);
}

export function destructFixedBlocker(blockTimes: string[], index: number): [dayjs.Dayjs, dayjs.Dayjs] {
  const entry = blockTimes[index]; // e.g. "12:00;14:00"
  if (!entry) {
    throw new Error("Fixed blocker entry missing");
  }

  const parts = entry.split(";");

  if (parts.length !== 2) {
    throw new Error(`Invalid fixed blocker format: "${entry}"`);
  }

  const start = parts[0]!;
  const end = parts[1]!;
  const startTime = dayjs(start, "HH:mm");
  const endTime = dayjs(end, "HH:mm");
  return [startTime, endTime];
}

export const getTimeTillNextFixedBlocker = async (): Promise<string> => {
  const blockDurations = await getFixedBlockDurations();
  if (blockDurations.length === 0) {
    return "No blockers set";
  }

  const now = dayjs();
  let nextStart: string | null = null;

  // assumes blockDurations is sorted by start time
  for (let i = 0; i < blockDurations.length; i++) {
    const [start, end] = destructFixedBlocker(blockDurations, i);

    if (now.isBetween(start, end)) {
      return "Blocker currently active";
    }

    if (start > now) {
      nextStart = start.format("HH:mm");
      break;
    }
  }

  if (nextStart) {
    return `${nextStart}`;
  }

  const [firstStart] = destructFixedBlocker(blockDurations, 0);
  return `Tomorrow ${firstStart}`;
};
export const getTimeTillNextFixedBlockerValue = async (): Promise<number | null> => {
  const blockDurations = await getFixedBlockDurations();
  if (blockDurations.length === 0) {
    return null;
  }

  const now = dayjs();
  let bestDiff: number | null = null;

  const normalize = (t: string) => (t.length === 5 ? `${t}:00` : t);

  for (let i = 0; i < blockDurations.length; i++) {
    let [start, end] = destructFixedBlocker(blockDurations, i);

    if (now.isBetween(start, end)) {
      return 0;
    }

    const diff = minTimeDifference(now, start);
    bestDiff = bestDiff === null ? diff : Math.min(bestDiff, diff);
  }

  return bestDiff;
};

export async function renderTime(time: UsageTime) {
  const includeSeconds: boolean = await checkShowSeconds();
  return `${time[0]}h ${time[1]}m ${includeSeconds ? `${time[2]}s` : ""}`;
}

export function renderTimeSynchronously(time: UsageTime, showSeconds: boolean) {
  return `${time[0]}h ${time[1]}m ${showSeconds ? `${time[2]}s` : ""}`;
}

export async function isBlocked(addActiveTime: boolean = false): Promise<boolean> {
  // If user toggled a block, we shouldnt block
  if (await isBlockToggledOff()) {
    return false;
  }
  if (await isSnoozed()) {
    return false;
  }

  const blockDurations = await getFixedBlockDurations();

  for (let i = 0; i < blockDurations.length; i++) {
    // optimize
    const [start, end] = destructFixedBlocker(blockDurations, i);
    console.log("FIXED_BLOCKERS");
    console.log(start, end);
    const now = dayjs();
    console.log(now);
    console.log(now.isBetween(start, end));
    if (now.isBetween(start, end)) {
      return true;
    }
  }

  if (await getManualBlock()) return true;

  const remainingUsage = await getRemainingUsageTime(addActiveTime);
  if (remainingUsage !== null) {
    return remainingUsage <= 0 ? true : false;
  }
  return false;
}

export async function getCurrentBlockType(addActiveTime: boolean = false): Promise<Blockers | null> {
  if (!(await isBlocked(addActiveTime))) {
    return null;
  }

  const blockDurations = await getFixedBlockDurations();

  for (let i = 0; i < blockDurations.length; i++) {
    // optimize
    const [start, end] = destructFixedBlocker(blockDurations, i);
    const now = dayjs();
    if (now.isBetween(start, end)) {
      return "FixedBlockTime";
    }
  }

  if (await getManualBlock()) return "ManualBlock";

  const remainingUsage = await getRemainingUsageTime(addActiveTime);
  if (remainingUsage !== null) {
    return remainingUsage <= 0 ? "TimeLimit" : null;
  }
  return null;
}

export const setButtonBlock = (button: HTMLElement, isBlocked: boolean) => {
  button.textContent = isBlocked ? "Unblock" : "Block";
  button.classList.toggle("danger", !!isBlocked);
};

export async function getRemainingUsageTime(addActiveTime: boolean = false): Promise<number | null> {
  const maximumUsage: number | null = await getMaxmimumUsageTime();
  if (maximumUsage === null) {
    return null;
  }
  if (addActiveTime) {
    return maximumUsage - (await getTodayUsage(true));
  }
  return maximumUsage - (await getTodayUsage());
}

export async function scheduleWindowUI(): Promise<WindowUiNotifications> {
  // if blocks are injected reminders arent required
  if (!(await isBlockToggledOff())) {
    if (await isBlocked(true)) {
      return getCurrentBlockType(true);
    }

    const tempUsage = await getRemainingUsageTime(true); // Remaining allowed usage in milliseconds

    // This needs no Active time added as this uses the current timestamp
    const nextBlockerTime = await getTimeTillNextFixedBlockerValue(); // Seconds until the next fixed blocker starts

    let secondsTillBlock: number | null = null;
    let reminderType: Reminder = null;

    if (typeof nextBlockerTime === "number") {
      secondsTillBlock = nextBlockerTime;
      reminderType = "BlockedSoonReminder";
    } else if (tempUsage !== null) {
      secondsTillBlock = Math.floor(tempUsage / 1000);
      reminderType = "BlockedSoonReminder";
    }

    if (secondsTillBlock !== null && secondsTillBlock <= 300 && reminderType !== null) {
      if ((await checkLastReminderSent(reminderType)) > 300) {
        return reminderType;
      }
    }
  }
  const maxContinousUsage = await getContinousUsageNotificationLimit();

  if (maxContinousUsage !== null && maxContinousUsage - (await getCurrentProviderDuration()) <= 0) {
    if ((await checkLastReminderSent("ContinuousUsageReminder")) >= 600) {
      return "ContinuousUsageReminder";
    }
  }

  const maxDailyUsage = await checkDailyUsageReminderDuration();
  if (maxDailyUsage !== null) {
    if (maxDailyUsage - (await getTodayUsage(true)) < 0) {
      if ((await checkLastReminderSent("DailyUsageReminder")) >= 600) {
        return "DailyUsageReminder";
      }
    }
  }
  return null;
}

export async function resolveProvider(url: string): Promise<ProviderId | null> {
  try {
    const hostname = new URL(url).hostname;

    const domains = await getActiveTrackedPlatforms();
    for (const [provider, domainList] of Object.entries(domains)) {
      if (!domainList) continue;
      if (domainList.some((domain) => hostname.includes(domain))) {
        return provider as ProviderId;
      }
    }
    return null;
  } catch {
    return null;
  }
}
