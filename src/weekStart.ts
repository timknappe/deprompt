import dayjs from "dayjs";
import updateLocale from "dayjs/plugin/updateLocale.js";
import browser from "webextension-polyfill";

dayjs.extend(updateLocale);

export const WEEK_START_SUNDAY_KEY = "settings:formatting:weekStartsOnSunday";

export const DEFAULT_WEEK_STARTS_ON_SUNDAY = false;

export function applyWeekStart(weekStartsOnSunday: boolean): void {
  dayjs.updateLocale("en", { weekStart: weekStartsOnSunday ? 0 : 1 });
}

applyWeekStart(DEFAULT_WEEK_STARTS_ON_SUNDAY);

export async function getWeekStartsOnSunday(): Promise<boolean> {
  const result = await browser.storage.sync.get(WEEK_START_SUNDAY_KEY);
  const raw = result[WEEK_START_SUNDAY_KEY];
  return raw === undefined ? DEFAULT_WEEK_STARTS_ON_SUNDAY : Boolean(raw);
}

export async function loadAndApplyWeekStart(): Promise<boolean> {
  const value = await getWeekStartsOnSunday();
  applyWeekStart(value);
  return value;
}

export async function setWeekStartsOnSunday(weekStartsOnSunday: boolean): Promise<void> {
  await browser.storage.sync.set({ [WEEK_START_SUNDAY_KEY]: weekStartsOnSunday });
  applyWeekStart(weekStartsOnSunday);
}

const SUNDAY_FIRST_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function weekdayLabels(weekStartsOnSunday: boolean): string[] {
  return weekStartsOnSunday ? [...SUNDAY_FIRST_LABELS] : [...SUNDAY_FIRST_LABELS.slice(1), SUNDAY_FIRST_LABELS[0]];
}
