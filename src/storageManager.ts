import browser from "webextension-polyfill";
import dayjs from "dayjs";
import type { ConfigType } from "dayjs";
import { ALL_PROVIDER_IDS, DEFAULT_SETTINGS, MAX_WEEKS_TO_KEEP, TARGET_DOMAINS } from "./constants.js";
import type { IndexScope, ProviderId, ProviderSettings, Views } from "./types.js";

const debugLog = (...args: unknown[]) => console.log("[Deprompt-debug]", ...args);

const SYNC_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_SYNC_FLUSH_CHUNK_MS = 10 * 60 * 1000;

type RuntimeSessionState = {
  provider: string;
  start: number;
  lastPersisted: number;
  pendingMs: number;
  lastSeen: number;
  lastFlushAt: number;
};

const RUNTIME_LOCAL_KEYS: string[] = [
  "meta:runtime:provider",
  "meta:runtime:start",
  "meta:runtime:lastPersisted",
  "meta:runtime:pendingMs",
  "meta:runtime:lastSeen",
  "meta:runtime:lastFlushAt",
];

function nowRoundedToSecond(): number {
  const now = Date.now();
  return now - (now % 1000);
}

async function getRuntimeSessionState(): Promise<RuntimeSessionState | null> {
  const local = await browser.storage.local.get(RUNTIME_LOCAL_KEYS);

  const providerRaw = local["meta:runtime:provider"];
  const startRaw = local["meta:runtime:start"];
  const lastPersistedRaw = local["meta:runtime:lastPersisted"];
  const pendingMsRaw = local["meta:runtime:pendingMs"];
  const lastSeenRaw = local["meta:runtime:lastSeen"];
  const lastFlushAtRaw = local["meta:runtime:lastFlushAt"];

  if (typeof providerRaw !== "string" || typeof startRaw !== "number") {
    return null;
  }

  const start = startRaw;
  const lastPersisted =
    typeof lastPersistedRaw === "number" && lastPersistedRaw >= start ? lastPersistedRaw : start;
  const pendingMs = typeof pendingMsRaw === "number" && pendingMsRaw > 0 ? pendingMsRaw : 0;
  const lastSeen = typeof lastSeenRaw === "number" && lastSeenRaw >= start ? lastSeenRaw : lastPersisted;
  const lastFlushAt = typeof lastFlushAtRaw === "number" ? lastFlushAtRaw : 0;

  return {
    provider: providerRaw,
    start,
    lastPersisted,
    pendingMs,
    lastSeen,
    lastFlushAt,
  };
}

async function accumulateRuntimeDelta(now: number): Promise<RuntimeSessionState | null> {
  const runtime = await getRuntimeSessionState();
  if (!runtime) return null;

  const baseline = runtime.lastPersisted >= runtime.start ? runtime.lastPersisted : runtime.start;
  const delta = Math.max(0, now - baseline);

  const pendingMs = runtime.pendingMs + delta;
  const lastPersisted = now;
  const lastSeen = now;

  await browser.storage.local.set({
    "meta:runtime:lastPersisted": lastPersisted,
    "meta:runtime:pendingMs": pendingMs,
    "meta:runtime:lastSeen": lastSeen,
  });

  return {
    ...runtime,
    lastPersisted,
    pendingMs,
    lastSeen,
  };
}

async function getProviderSettings(): Promise<ProviderSettings> {
  const result = await browser.storage.sync.get("settings:providers");
  const providersRaw = result["settings:providers"];

  const normalized: ProviderSettings = { ...DEFAULT_SETTINGS.providers };
  if (!providersRaw || typeof providersRaw !== "object") {
    return normalized;
  }

  for (const providerId of ALL_PROVIDER_IDS) {
    const value = (providersRaw as Record<string, unknown>)[providerId];
    if (typeof value === "boolean") {
      normalized[providerId] = value;
    }
  }

  return normalized;
}

// #region date helpers
/**
 * Formats a timestamp into the daily storage key segment.
 * @param {number} timestamp - Unix timestamp in milliseconds.
 * @returns {string} Date string formatted as YYYY-MM-DD.
 */
export const normalizeDateKey = (timestamp: number): string => dayjs(timestamp).format("YYYY-MM-DD");

/**
 * Normalizes a timestamp to the ISO week start string.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string} Week start date formatted as YYYY-MM-DD.
 */
const weekStartKey = (ts: number): string => dayjs(ts).startOf("week").format("YYYY-MM-DD");

/**
 * Formats a timestamp into the YYYY-MM string used for month storage keys.
 * @param {number} ts - Unix timestamp in milliseconds.
 * @returns {string} Month string formatted as YYYY-MM.
 */
const monthKey = (ts: number): string => dayjs(ts).format("YYYY-MM");

/**
 * Formats a timestamp into the YYYY string used for yearly storage keys.
 * @param {dayjs.ConfigType} ts - Timestamp or Day.js compatible input.
 * @returns {string} Year string formatted as YYYY.
 */
const yearKey = (ts: ConfigType): string => dayjs(ts).format("YYYY");

/**
 * Checks if two timestamps fall within the same Day.js unit.
 * @param {number} a - First timestamp in milliseconds.
 * @param {number} b - Second timestamp in milliseconds.
 * @param {dayjs.OpUnitType} unit - Unit to compare (day, week, month, etc.).
 * @returns {boolean} True when both timestamps share the unit.
 */
const sameUnit = (a: number, b: number, unit: dayjs.OpUnitType) => dayjs(a).isSame(dayjs(b), unit);
// #endregion

// #region sync storage helpers
/**
 * Increments a numeric value stored in sync storage.
 * @param {string} key - Storage key to update.
 * @param {number} delta - Amount in milliseconds to add.
 * @returns {Promise<number>} New accumulated value after the increment.
 */
async function incSync(key: string, delta: number): Promise<number> {
  const result = await getSync(key);
  const currentValue = result[key];
  const cur = typeof currentValue === "number" ? currentValue : 0;
  const newVal = cur + delta;
  await browser.storage.sync.set({ [key]: newVal });
  return newVal;
}

/**
 * Writes a value to sync storage at the provided key.
 * @param {string} key - Storage key to set.
 * @param {unknown} val - Value to persist to sync storage.
 * @returns {Promise<void>} Resolves after the value is saved.
 */
async function setSync(key: string, val: unknown): Promise<void> {
  await browser.storage.sync.set({ [key]: val });
}

/**
 * Removes a single value from sync storage.
 * @param {string} key - Key to delete.
 * @returns {Promise<void>} Resolves after storage is updated.
 */
async function delSync(key: string): Promise<void> {
  await browser.storage.sync.remove(key);
}

/**
 * Reads one or more values from sync storage.
 * @param {string|string[]|null} keys - Key or keys to fetch (null fetches all).
 * @returns {Promise<Record<string, unknown>>} Object map of stored values.
 */
async function getSync(keys: string | string[] | null): Promise<Record<string, unknown>> {
  return browser.storage.sync.get(keys);
}

/**
 * Loads an index array used for rollout bookkeeping.
 * @param {"daily"|"weekly"|"monthly"} name - Index scope being queried.
 * @param {string} provider - Provider identifier for the index entry.
 * @returns {Promise<string[]>} Array of stored key segments for that index.
 */
async function getIndex(name: IndexScope, provider: string): Promise<string[]> {
  const k = `index:${name}:${provider}`;
  const obj = await getSync(k);
  const stored = obj[k];
  return Array.isArray(stored) ? (stored as string[]) : [];
}

/**
 * Writes an updated index array back into sync storage.
 * @param {"daily"|"weekly"|"monthly"} name - Index scope being stored.
 * @param {string} provider - Provider identifier for the index entry.
 * @param {string[]} arr - Array of key segments to persist.
 * @returns {Promise<void>} Resolves after the index is updated.
 */
async function setIndex(name: IndexScope, provider: string, arr: string[]): Promise<void> {
  const k = `index:${name}:${provider}`;
  await setSync(k, arr);
}

/**
 * Ensures an index contains the provided entry at most once.
 * @param {"daily"|"weekly"|"monthly"} name - Index scope being updated.
 * @param {string} provider - Provider identifier.
 * @param {string} entry - Key segment to add if missing.
 * @returns {Promise<string[]>} Updated copy of the index array.
 */
async function addToIndexUnique(name: IndexScope, provider: string, entry: string): Promise<string[]> {
  const idx = await getIndex(name, provider);
  if (!idx.includes(entry)) {
    idx.push(entry);
    await setIndex(name, provider, idx);
  }
  return idx;
}
// #endregion

// #region accumulation + rollover helpers
/**
 * Adds a tracked duration to every aggregation bucket for the provider.
 * @param {string} providerId - Provider identifier the duration belongs to.
 * @param {number} durationMs - Duration in milliseconds to accumulate.
 * @param {number} ts - Timestamp representing when the duration occurred.
 * @returns {Promise<void>} Resolves when all period counters are updated.
 */
async function addDuration(providerId: string, durationMs: number, ts: number) {
  await flushPendingToSync(providerId, durationMs, ts);
}

/**
 * Keeps only the current week's daily records and cleans up older entries.
 * @param {string} providerId - Provider whose daily index should be pruned.
 * @param {number} nowTs - Timestamp indicating the current time.
 * @returns {Promise<void>} Resolves once the pruning completes.
 */
async function pruneDailyToCurrentWeek(providerId: string, nowTs: number) {
  const nowWeekStart = weekStartKey(nowTs);
  const dates = await getIndex("daily", providerId);
  if (dates.length === 0) return;

  const toKeep: string[] = [];
  const toDelete: string[] = [];

  for (const d of dates) {
    const dWeekStart = weekStartKey(dayjs(d, "YYYY-MM-DD").valueOf());
    if (dWeekStart === nowWeekStart) {
      toKeep.push(d);
    } else {
      toDelete.push(d);
    }
  }

  for (const d of toDelete) {
    await delSync(`daily:${d}:${providerId}`);
  }
  await setIndex("daily", providerId, toKeep);
}

/**
 * Collapses historical weekly data into monthly totals and enforces retention.
 * @param {string} providerId - Provider whose weekly history is being maintained.
 * @param {number} lastTs - Timestamp from the previous rollover.
 * @param {number} nowTs - Current timestamp driving the rollover.
 * @returns {Promise<void>} Resolves after retention/collapse work is finished.
 */
async function maintainWeeklyHistory(providerId: string, lastTs: number, nowTs: number) {
  let weeks = await getIndex("weekly", providerId);
  if (weeks.length === 0) return;

  weeks.sort((a, b) => a.localeCompare(b));

  const nowMonthStart = dayjs(nowTs).startOf("month");
  const prevMonth = dayjs(nowTs).subtract(1, "month").format("YYYY-MM");

  const monthChanged = !sameUnit(lastTs, nowTs, "month");

  if (monthChanged) {
    const toCollapse: string[] = [];
    for (const w of weeks) {
      const wStart = dayjs(w, "YYYY-MM-DD");
      const wEnd = wStart.endOf("week");
      if (wEnd.isBefore(nowMonthStart)) toCollapse.push(w);
    }

    if (toCollapse.length > 0) {
      for (const w of toCollapse) {
        const wKey = `week:${w}:${providerId}`;
        const obj = await getSync(wKey);
        const rawVal = obj[wKey];
        const wVal = typeof rawVal === "number" ? rawVal : 0;
        if (wVal > 0) {
          await incSync(`month:${prevMonth}:${providerId}`, wVal);
        }
        await delSync(wKey);
      }
      weeks = weeks.filter((w) => !toCollapse.includes(w));
      await setIndex("weekly", providerId, weeks);
    }
  }

  if (weeks.length > MAX_WEEKS_TO_KEEP) {
    const toRemove = weeks.slice(0, weeks.length - MAX_WEEKS_TO_KEEP);
    for (const w of toRemove) {
      await delSync(`week:${w}:${providerId}`);
    }
    const kept = weeks.slice(weeks.length - MAX_WEEKS_TO_KEEP);
    await setIndex("weekly", providerId, kept);
  }
}

/**
 * Collapses monthly data into yearly totals when crossing a year boundary.
 * @param {string} providerId - Provider whose monthly history is being maintained.
 * @param {number} lastTs - Timestamp from the previous rollover.
 * @param {number} nowTs - Current timestamp driving the rollover.
 * @returns {Promise<void>} Resolves after retention/collapse work is finished.
 */
async function maintainMonthlyHistory(providerId: string, lastTs: number, nowTs: number) {
  let months = await getIndex("monthly", providerId);
  if (months.length === 0) return;

  months.sort((a, b) => a.localeCompare(b));

  const yearChanged = !sameUnit(lastTs, nowTs, "year");
  if (!yearChanged) {
    const currentYear = yearKey(nowTs);
    const keep = months.filter((m) => m.startsWith(`${currentYear}-`));
    if (keep.length !== months.length) {
      await setIndex("monthly", providerId, keep);
    }
    return;
  }

  const lastYear = yearKey(dayjs(nowTs).subtract(1, "year"));
  const lastYearMonths = months.filter((m) => m.startsWith(`${lastYear}-`));

  if (lastYearMonths.length > 0) {
    let sum = 0;
    for (const m of lastYearMonths) {
      const mKey = `month:${m}:${providerId}`;
      const obj = await getSync(mKey);
      const rawVal = obj[mKey];
      const v = typeof rawVal === "number" ? rawVal : 0;
      sum += v;
      await delSync(mKey);
    }
    if (sum > 0) {
      await incSync(`year:${lastYear}:${providerId}`, sum);
    }
    const keep = months.filter((m) => !lastYearMonths.includes(m));
    await setIndex("monthly", providerId, keep);
  }
}
// #endregion

// #region provider settings + usage queries
export async function getActiveTrackedPlatformKeys(): Promise<ProviderId[]> {
  const providers = await getProviderSettings();
  return ALL_PROVIDER_IDS.filter((key) => providers[key]);
}

export async function getActiveTrackedPlatforms(): Promise<Partial<typeof TARGET_DOMAINS>> {
  const providers = await getProviderSettings();
  return Object.fromEntries(
    (Object.entries(TARGET_DOMAINS) as [ProviderId, (typeof TARGET_DOMAINS)[ProviderId]][]).filter(
      ([provider]) => providers[provider],
    ),
  );
}

function resolveTimeFormat(viewType?: string): string {
  if (!viewType) return "alltime";
  const normalized = viewType.toLowerCase();
  const now = Date.now();

  switch (normalized) {
    case "daily":
    case "day":
      return `daily:${normalizeDateKey(now)}`;
    case "weekly":
    case "week":
      return `week:${weekStartKey(now)}`;
    case "monthly":
    case "month":
      return `month:${monthKey(now)}`;
    case "yearly":
    case "year":
      return `year:${yearKey(now)}`;
    case "all":
    case "alltime":
      return "alltime";
    default:
      return viewType;
  }
}

export async function getActiveTrackedPlatformUsage(viewType?: string): Promise<number[]> {
  const providerIds = await getActiveTrackedPlatformKeys();
  const timeFormat = resolveTimeFormat(viewType);
  const usage: number[] = [];

  for (const providerId of providerIds) {
    const key = `${timeFormat}:${providerId}`;
    const obj = await getSync(key);
    const providerValue = obj[key];
    usage.push(typeof providerValue === "number" ? providerValue : 0);
  }

  return usage;
}

export async function getTodayUsage(addActiveTime: boolean = false): Promise<number> {
  return addActiveTime
    ? (await sumForAllProviders(`daily:${normalizeDateKey(Date.now())}`)) +
        (await getCurrentProviderUnpersistedDuration())
    : await sumForAllProviders(`daily:${normalizeDateKey(Date.now())}`);
}

export async function getWeeklyUsage(addActiveTime: boolean = false): Promise<number> {
  return addActiveTime
    ? (await sumForAllProviders(`week:${weekStartKey(Date.now())}`)) + (await getCurrentProviderUnpersistedDuration())
    : sumForAllProviders(`week:${weekStartKey(Date.now())}`);
}

export async function sumForAllProviders(timeFormat = "alltime"): Promise<number> {
  let totalTime = 0;

  for (const providerId of ALL_PROVIDER_IDS) {
    const key = `${timeFormat}:${providerId}`;
    const result = await getSync(key);
    const providerTime = result[key];
    if (typeof providerTime === "number" && !Number.isNaN(providerTime)) {
      totalTime += providerTime;
    }
  }

  return totalTime;
}
// #endregion

/**
 * Performs housekeeping by rolling over any completed periods and pruning history.
 * @param {number} nowTs - Current timestamp used to determine boundary crossings.
 * @returns {Promise<void>} Resolves once all provider data has been updated.
 */
export async function rollover(nowTs: number): Promise<void> {
  const meta = await getSync("meta:lastTick");
  const lastTickRaw = meta["meta:lastTick"];
  const lastTick = typeof lastTickRaw === "number" ? lastTickRaw : nowTs;

  const all = await getSync(null);
  const providerSet = new Set<string>();
  for (const k of Object.keys(all)) {
    if (k.startsWith("index:")) {
      const parts = k.split(":");
      if (parts.length >= 3) {
        const provider = parts[2];
        if (provider) providerSet.add(provider);
      }
    } else if (
      k.startsWith("daily:") ||
      k.startsWith("week:") ||
      k.startsWith("month:") ||
      k.startsWith("year:") ||
      k.startsWith("alltime:")
    ) {
      const provider = k.split(":").pop();
      if (provider) providerSet.add(provider);
    }
  }

  await setSync("meta:lastTick", nowTs);
  if (providerSet.size === 0) return;

  const dayChanged = !sameUnit(lastTick, nowTs, "day");
  const weekChanged = !sameUnit(lastTick, nowTs, "week");
  const monthChanged = !sameUnit(lastTick, nowTs, "month");
  const yearChanged = !sameUnit(lastTick, nowTs, "year");

  for (const providerId of providerSet) {
    if (weekChanged) {
      await pruneDailyToCurrentWeek(providerId, nowTs);
    }
    if (weekChanged || monthChanged) {
      await maintainWeeklyHistory(providerId, lastTick, nowTs);
    }
    if (yearChanged) {
      await maintainMonthlyHistory(providerId, lastTick, nowTs);
    }
  }
}

/**
 * Marks the start of an active provider session in local storage.
 * @param {string} providerId - Provider identifier that just became active.
 * @returns {Promise<void>} Resolves after the timer metadata is written.
 */
export async function startTimerForProvider(providerId: string): Promise<void> {
  const now = nowRoundedToSecond();
  await browser.storage.local.set({
    "meta:runtime:provider": providerId,
    "meta:runtime:start": now,
    "meta:runtime:lastPersisted": now,
    "meta:runtime:pendingMs": 0,
    "meta:runtime:lastSeen": now,
    "meta:runtime:lastFlushAt": now,
  });
  debugLog("startTimerForProvider", {
    providerId,
    start: now,
    iso: new Date(now).toISOString(),
  });
  browser.alarms.create("syncTimer", { periodInMinutes: 1 });
}

/**
 * Stops the current session timer, persists the elapsed duration, and clears state.
 * @param {string} providerId - Provider identifier whose session ended.
 * @returns {Promise<void>} Resolves after duration has been stored and local data cleared.
 */
export async function finalizeSession(reason: string, expectedProviderId?: string): Promise<void> {
  const now = nowRoundedToSecond();
  const runtimeAfterAccumulate = await accumulateRuntimeDelta(now);
  if (!runtimeAfterAccumulate) {
    await browser.alarms.clear("syncTimer");
    return;
  }

  if (expectedProviderId && runtimeAfterAccumulate.provider !== expectedProviderId) {
    debugLog("finalizeSession: provider mismatch, skipping clear", {
      expectedProviderId,
      actualProviderId: runtimeAfterAccumulate.provider,
      reason,
    });
    return;
  }

  let flushSucceeded = true;
  if (runtimeAfterAccumulate.pendingMs > 0) {
    try {
      await flushPendingToSync(runtimeAfterAccumulate.provider, runtimeAfterAccumulate.pendingMs, now);
      await browser.storage.local.set({
        "meta:runtime:pendingMs": 0,
        "meta:runtime:lastFlushAt": now,
      });
    } catch (err) {
      flushSucceeded = false;
      console.error("Deprompt: finalizeSession flush failed", err);
      debugLog("finalizeSession flush failed", {
        providerId: runtimeAfterAccumulate.provider,
        pendingMs: runtimeAfterAccumulate.pendingMs,
        reason,
      });
    }
  }

  if (!flushSucceeded) {
    browser.alarms.create("syncTimer", { periodInMinutes: 1 });
    return;
  }

  await browser.storage.local.remove(RUNTIME_LOCAL_KEYS);
  await browser.alarms.clear("syncTimer");
  debugLog("finalizeSession", {
    providerId: runtimeAfterAccumulate.provider,
    reason,
    pendingFlushedMs: runtimeAfterAccumulate.pendingMs,
    endedAt: now,
    isoEndedAt: new Date(now).toISOString(),
  });
}

export async function receiveEndTime(providerId: string): Promise<void> {
  await finalizeSession("receiveEndTime", providerId);
}

/**
 * Heartbeat invoked by the content scripts to keep timers accurate and roll over.
 * @returns {Promise<void>} Resolves after the heartbeat and rollover run.
 */
export async function isAliveCheck(): Promise<void> {
  const now = Date.now();
  await rollover(now);
}

/**
 * Adds any leftover duration when a tab shuts down without sending an end event.
 * @returns {Promise<void>} Resolves after the remainder was applied.
 */
export async function reconcileActiveSessionOnInit(activeProviderId: ProviderId | null): Promise<void> {
  const runtime = await getRuntimeSessionState();
  if (!runtime) {
    await browser.alarms.clear("syncTimer");
    return;
  }

  if (!activeProviderId || activeProviderId !== runtime.provider) {
    await finalizeSession("reconcile:init-no-active-or-provider-mismatch");
    return;
  }

  const now = nowRoundedToSecond();
  await accumulateRuntimeDelta(now);
  browser.alarms.create("syncTimer", { periodInMinutes: 1 });
  debugLog("reconcileActiveSessionOnInit: resumed active session", {
    providerId: runtime.provider,
    activeProviderId,
    now,
    isoNow: new Date(now).toISOString(),
  });
}

/**
 * Flushes pending local duration into sync aggregates without dropping local state on failure.
 */
export async function flushPendingToSync(providerId: string, amountMs: number, ts: number): Promise<void> {
  if (amountMs <= 0) return;

  const day = normalizeDateKey(ts);
  const week = weekStartKey(ts);
  const month = monthKey(ts);
  const year = yearKey(ts);

  const dKey = `daily:${day}:${providerId}`;
  const wKey = `week:${week}:${providerId}`;
  const mKey = `month:${month}:${providerId}`;
  const yKey = `year:${year}:${providerId}`;
  const aKey = `alltime:${providerId}`;
  const dailyIdxKey = `index:daily:${providerId}`;
  const weeklyIdxKey = `index:weekly:${providerId}`;
  const monthlyIdxKey = `index:monthly:${providerId}`;

  const snapshot = await getSync([dKey, wKey, mKey, yKey, aKey, dailyIdxKey, weeklyIdxKey, monthlyIdxKey]);
  const updates: Record<string, unknown> = {};

  const addToExisting = (key: string, delta: number) => {
    const raw = snapshot[key];
    const current = typeof raw === "number" ? raw : 0;
    updates[key] = current + delta;
  };

  addToExisting(dKey, amountMs);
  addToExisting(wKey, amountMs);
  addToExisting(mKey, amountMs);
  addToExisting(yKey, amountMs);
  addToExisting(aKey, amountMs);

  const dailyIdx = Array.isArray(snapshot[dailyIdxKey]) ? ([...(snapshot[dailyIdxKey] as string[])] as string[]) : [];
  if (!dailyIdx.includes(day)) dailyIdx.push(day);
  updates[dailyIdxKey] = dailyIdx;

  const weeklyIdx = Array.isArray(snapshot[weeklyIdxKey]) ? ([...(snapshot[weeklyIdxKey] as string[])] as string[]) : [];
  if (!weeklyIdx.includes(week)) weeklyIdx.push(week);
  updates[weeklyIdxKey] = weeklyIdx;

  const monthlyIdx = Array.isArray(snapshot[monthlyIdxKey])
    ? ([...(snapshot[monthlyIdxKey] as string[])] as string[])
    : [];
  if (!monthlyIdx.includes(month)) monthlyIdx.push(month);
  updates[monthlyIdxKey] = monthlyIdx;

  await browser.storage.sync.set(updates);
  debugLog("flushPendingToSync", {
    providerId,
    amountMs,
    ts,
    iso: new Date(ts).toISOString(),
    dKey,
    wKey,
    mKey,
    yKey,
    aKey,
  });
}

/**
 * Returns the persisted list of fixed block duration identifiers.
 * @returns {Promise<string[]>} List of fixed block duration identifiers.
 */
export async function getFixedBlockDurations(): Promise<string[]> {
  const fixedBlockTimes = await getSync("settings:block:fixed");
  const rawDurations = fixedBlockTimes["settings:block:fixed"];
  if (!Array.isArray(rawDurations)) {
    return [];
  }
  return rawDurations.filter((entry): entry is string => typeof entry === "string");
}

export async function checkShowSeconds(): Promise<boolean> {
  const { ["settings:formatting:showSeconds"]: showSeconds = false } = await browser.storage.sync.get(
    "settings:formatting:showSeconds",
  );

  return showSeconds as boolean;
}

export async function initializeDefaults() {
  const existing = await browser.storage.sync.get([
    "settings:formatting:showSeconds",
    "settings:timeLimit",
    "settings:notification:daily",
    "settings:notification:continuous",
    "settings:providers",
  ]);

  const updates: Record<string, unknown> = {};

  if (existing["settings:formatting:showSeconds"] === undefined) {
    updates["settings:formatting:showSeconds"] = DEFAULT_SETTINGS.formatting.showSeconds;
  }

  const timeLimit = existing["settings:timeLimit"];
  if (
    timeLimit === undefined ||
    (typeof timeLimit === "object" &&
      timeLimit !== null &&
      (typeof (timeLimit as { minutes?: unknown }).minutes !== "number" ||
        typeof (timeLimit as { enabled?: unknown }).enabled !== "boolean"))
  ) {
    updates["settings:timeLimit"] = DEFAULT_SETTINGS.timeLimit;
  }

  const daily = existing["settings:notification:daily"];
  if (
    daily === undefined ||
    typeof daily !== "object" ||
    daily === null ||
    typeof (daily as { minutes?: unknown }).minutes !== "number"
  ) {
    updates["settings:notification:daily"] = DEFAULT_SETTINGS.notifications.daily;
  }

  const continuous = existing["settings:notification:continuous"];
  if (
    continuous === undefined ||
    typeof continuous !== "object" ||
    continuous === null ||
    typeof (continuous as { minutes?: unknown }).minutes !== "number"
  ) {
    updates["settings:notification:continuous"] = DEFAULT_SETTINGS.notifications.continuous;
  }

  const providers = existing["settings:providers"];
  if (providers === undefined || typeof providers !== "object" || providers === null) {
    updates["settings:providers"] = DEFAULT_SETTINGS.providers;
  }

  if (Object.keys(updates).length > 0) {
    await browser.storage.sync.set(updates);
  }
}

export async function getManualBlock() {
  const { ["settings:block:manual"]: manualBlock } = await browser.storage.sync.get("settings:block:manual");

  return manualBlock as boolean;
}

export async function getMaxmimumUsageTime(): Promise<number | null> {
  const { ["settings:timeLimit"]: timeLimit } = await browser.storage.sync.get("settings:timeLimit");
  if (timeLimit === undefined || timeLimit === null) {
    return null;
  }

  if (typeof timeLimit === "number") {
    const value = Number.isFinite(timeLimit) && timeLimit > 0 ? timeLimit : DEFAULT_SETTINGS.timeLimit.minutes;
    return value * 60 * 1000; // returns in milliseconds
  }

  if (typeof timeLimit === "object") {
    const { enabled = true, minutes } = timeLimit as {
      enabled?: boolean;
      minutes?: number;
    };

    if (!enabled) return null;

    const value =
      typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
        ? minutes
        : DEFAULT_SETTINGS.timeLimit.minutes;

    return value * 60 * 1000;
  }

  return null;
}

export async function checkDailyUsageReminderDuration(): Promise<number | null> {
  const {
    ["settings:notification:daily"]: dailyNotification,
  }: {
    ["settings:notification:daily"]?: {
      enabled: boolean;
      minutes: number;
    };
  } = await browser.storage.sync.get("settings:notification:daily");

  if (!dailyNotification || dailyNotification?.enabled === false) {
    return null;
  }

  return dailyNotification.minutes * 60 * 1000;
}

export async function checkLastReminderSent(key: string): Promise<number> {
  const result = await browser.storage.sync.get("meta:lastReminder");
  const lastReminder = (result["meta:lastReminder"] as Record<string, number> | undefined) ?? {};

  const specificReminder = lastReminder?.[key];

  const durationSince = Date.now() - ((specificReminder as number) || 0);

  return durationSince / 1000; // Convert from milliseconds to seconds
}

// returns the start time of the current provider as a timestamp
async function getCurrentProviderStart() {
  const { ["meta:runtime:start"]: start }: { ["meta:runtime:start"]?: number } =
    await browser.storage.local.get("meta:runtime:start");

  return start as number;
}

export async function getCurrentProviderDuration() {
  const providerStart = await getCurrentProviderStart();
  if (providerStart === undefined || providerStart === null) return 0;
  return Date.now() - providerStart;
}

/**
 * Returns the duration since the last tick for the current session.
 * This avoids double-counting time that got already flushed.
 */
export async function getCurrentProviderUnpersistedDuration(): Promise<number> {
  const runtime = await getRuntimeSessionState();
  if (!runtime) return 0;

  const now = nowRoundedToSecond();
  const baseline = runtime.lastPersisted >= runtime.start ? runtime.lastPersisted : runtime.start;
  const liveDelta = Math.max(0, now - baseline);
  return runtime.pendingMs + liveDelta;
}

/**
 * Flushes elapsed time for the current session without ending it.
 * Uses meta:runtime:lastPersisted to avoid double-counting.
 */
export async function persistActiveDuration(): Promise<void> {
  const now = nowRoundedToSecond();
  const runtime = await accumulateRuntimeDelta(now);
  if (!runtime) return;

  const shouldFlush =
    runtime.pendingMs >= MAX_SYNC_FLUSH_CHUNK_MS ||
    (runtime.pendingMs > 0 && (runtime.lastFlushAt === 0 || now - runtime.lastFlushAt >= SYNC_FLUSH_INTERVAL_MS));

  if (!shouldFlush) {
    debugLog("persistActiveDuration: buffered only", {
      providerId: runtime.provider,
      pendingMs: runtime.pendingMs,
      lastFlushAt: runtime.lastFlushAt,
    });
    return;
  }

  const chunkMs = Math.min(runtime.pendingMs, MAX_SYNC_FLUSH_CHUNK_MS);
  try {
    await flushPendingToSync(runtime.provider, chunkMs, now);
    await browser.storage.local.set({
      "meta:runtime:pendingMs": Math.max(0, runtime.pendingMs - chunkMs),
      "meta:runtime:lastFlushAt": now,
      "meta:runtime:lastSeen": now,
    });
    debugLog("persistActiveDuration: flushed chunk", {
      providerId: runtime.provider,
      chunkMs,
      pendingBefore: runtime.pendingMs,
      pendingAfter: Math.max(0, runtime.pendingMs - chunkMs),
      now,
      isoNow: new Date(now).toISOString(),
    });
  } catch (err) {
    console.error("Deprompt: persistActiveDuration flush failed", err);
    debugLog("persistActiveDuration: flush failed, keeping pending local", {
      providerId: runtime.provider,
      pendingMs: runtime.pendingMs,
      now,
    });
  }
}

export async function getContinousUsageNotificationLimit() {
  const {
    ["settings:notification:continuous"]: continuous,
  }: {
    ["settings:notification:continuous"]?: {
      enabled: boolean;
      minutes: number;
    };
  } = await browser.storage.sync.get("settings:notification:continuous");

  if (!continuous || continuous.enabled === false) {
    return null;
  }

  return continuous.minutes * 60 * 1000; // returns in ms
}

export async function isBlockToggledOff() {
  const { ["meta:userToggleStamp"]: userToggleStamp } = await browser.storage.local.get("meta:userToggleStamp");

  const toggleUntil = typeof userToggleStamp === "number" ? userToggleStamp : null;

  if (toggleUntil === null) {
    return false;
  }

  // When the stamp is in the future, a temporary unblock is active
  return Date.now() < toggleUntil;
}

export async function setBlockToggle(minutes = 5) {
  await browser.storage.local.set({
    "meta:userToggleStamp": Date.now() + minutes * 60 * 1000,
  });
}

export async function unsetBlockToggle() {
  await browser.storage.local.remove("meta:userToggleStamp");
}

export async function isSnoozed() {
  const { ["meta:userSnooze"]: userSnooze } = await browser.storage.sync.get("meta:userSnooze");

  return userSnooze == dayjs().format("YYYY-MM-DD");
}

export async function setSnooze() {
  const snoozed = await isSnoozed();

  if (snoozed) {
    await browser.storage.sync.set({
      "meta:userSnooze": null,
    });
  } else {
    await browser.storage.sync.set({
      "meta:userSnooze": dayjs().format("YYYY-MM-DD"),
    });
  }
}
