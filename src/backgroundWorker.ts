import browser from "webextension-polyfill";
import {
  getActiveTrackedPlatforms,
  startTimerForProvider,
  receiveEndTime,
  isAliveCheck,
  addRemainderOnNonGracefulExit,
  rollover,
  setBlockToggle,
  initializeDefaults,
  persistActiveDuration,
} from "./storageManager.js";
import { isBlocked, resolveProvider, scheduleWindowUI } from "./helpers.js";
import type { ProviderId } from "./types.js";
import {
  ejectBlockPopup,
  ejectReminderPopup,
  injectBlockScreen,
  injectReminder,
  isBlockPopupInjected,
} from "./contentScripts.js";

const debugLog = (...args: unknown[]) => console.log("[Deprompt-debug]", ...args);

// #region State Management

let lastActiveTabId: number | null = null;
let lastActiveProviderId: ProviderId | null = null;
let trackingQueue = Promise.resolve();
let focusLossTimer: ReturnType<typeof setTimeout> | null = null;

function enqueueTracking(taskName: string, task: () => Promise<void>) {
  trackingQueue = trackingQueue.then(task).catch((err) => {
    console.error(`Deprompt: tracking task failed (${taskName})`, err);
  });
  return trackingQueue;
}

async function isFocusedNormalWindow(windowId: number): Promise<boolean> {
  try {
    const win = await browser.windows.get(windowId);
    return Boolean(win.focused && win.type !== "popup");
  } catch {
    return false;
  }
}

async function hasFocusedNormalWindow(): Promise<boolean> {
  try {
    const wins = await browser.windows.getAll({ windowTypes: ["normal"] });
    return wins.some((win) => win.focused);
  } catch {
    return false;
  }
}

function clearFocusLossTimer() {
  if (focusLossTimer !== null) {
    clearTimeout(focusLossTimer);
    focusLossTimer = null;
  }
}

/**
 * when service workers restartthey restart we lose in-memory tab
 * references. Re-hydrate the active provider tab so alarms can still inject UI.
 */
async function hydrateActiveTab(): Promise<number | null> {
  if (lastActiveTabId !== null) return lastActiveTabId;

  const [activeTab] = await browser.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });

  if (!activeTab?.id || !activeTab.url) return null;

  const providerId = await resolveProvider(activeTab.url);
  if (!providerId) return null;

  lastActiveTabId = activeTab.id;
  lastActiveProviderId = providerId;
  return lastActiveTabId;
}

// TODO The early checks reduce load, monitor performance, if heavy we will need to debounce this
async function handleTabStateChange(tab: browser.Tabs.Tab): Promise<void> {
  if (!tab.id || !tab.url) return;

  const providerId = await resolveProvider(tab.url);

  if (lastActiveTabId === tab.id && lastActiveProviderId === providerId) return;

  // Stop previous provider (unchanged)
  if (lastActiveProviderId) {
    debugLog("handleTabStateChange: stopping previous provider", {
      tabId: lastActiveTabId,
      provider: lastActiveProviderId,
    });
    await receiveEndTime(lastActiveProviderId);
    lastActiveProviderId = null;
  }

  if (!providerId) {
    lastActiveTabId = null;
    return;
  }

  // Commit new state optimistically so reappearing calls skip
  lastActiveProviderId = providerId;
  lastActiveTabId = tab.id;

  debugLog("handleTabStateChange: starting provider", { tabId: tab.id, url: tab.url, providerId });

  if (await isBlocked()) {
    await injectBlockScreen(tab.id);
  } else {
    if (await isBlockPopupInjected(tab.id)) {
      await ejectBlockPopup(tab.id);
    }
  }

  await startTimerForProvider(providerId);
}

// #endregion

// #region Listeners

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "syncTimer") {
    void enqueueTracking("alarms.onAlarm", async () => {
      await isAliveCheck();
      await persistActiveDuration();
      const targetTabId = lastActiveTabId ?? (await hydrateActiveTab());
      if (targetTabId === null) return;

      debugLog("alarms.onAlarm: syncTimer", {
        targetTabId,
        lastActiveProviderId,
      });

      if (!(await isBlockPopupInjected(targetTabId))) {
        const UI = await scheduleWindowUI();
        if (UI) {
          if (UI === "FixedBlockTime" || UI === "TimeLimit" || UI === "ManualBlock") {
            injectBlockScreen(targetTabId);
          } else if (UI === "DailyUsageReminder" || UI === "ContinuousUsageReminder" || UI === "BlockedSoonReminder") {
            const lastReminderStorage = await browser.storage.sync.get("meta:lastReminder");

            const lastReminder =
              typeof lastReminderStorage["meta:lastReminder"] === "object" &&
              lastReminderStorage["meta:lastReminder"] !== null
                ? lastReminderStorage["meta:lastReminder"]
                : {};

            await browser.storage.sync.set({
              "meta:lastReminder": { ...lastReminder, [UI]: Date.now() },
            });
            debugLog("alarms.onAlarm: injecting reminder", { targetTabId, UI });
            injectReminder(targetTabId, UI);
          }
        }
      }
    });
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tabInfo) => {
  void enqueueTracking("tabs.onUpdated", async () => {
    const currentTab = tabInfo ?? (await browser.tabs.get(tabId));
    if (!currentTab.active || currentTab.windowId === undefined) return;
    if (!(await isFocusedNormalWindow(currentTab.windowId))) return;
    await handleTabStateChange(currentTab);
    debugLog("tabs.onUpdated", { tabId, url: currentTab.url });
  });
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  void enqueueTracking("tabs.onActivated", async () => {
    const activeTab = await browser.tabs.get(tabId);
    if (!activeTab.active || activeTab.windowId === undefined) return;
    if (!(await isFocusedNormalWindow(activeTab.windowId))) return;
    await handleTabStateChange(activeTab);
    debugLog("tabs.onActivated", { tabId, url: activeTab?.url });
  });
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  // This case will remain a problem as it is a technical limitation of browsers like chrome, WINDOW_ID_NONE is not only triggered by lost focus but also by toolbar interactions
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    clearFocusLossTimer();
    focusLossTimer = setTimeout(() => {
      void enqueueTracking("windows.onFocusChanged:none", async () => {
        if (await hasFocusedNormalWindow()) return;
        if (lastActiveProviderId) {
          debugLog("windows.onFocusChanged: window lost focus", {
            provider: lastActiveProviderId,
          });
          await receiveEndTime(lastActiveProviderId);
          lastActiveProviderId = null;
        }
      });
    }, 750);
    return;
  }

  clearFocusLossTimer();
  void enqueueTracking("windows.onFocusChanged", async () => {
    if (!(await isFocusedNormalWindow(windowId))) return;
    const [activeTab] = await browser.tabs.query({ active: true, windowId });
    if (!activeTab || !activeTab.id) return;

    await handleTabStateChange(activeTab);
  });
});

// #endregion

// #region Initialization & Messaging

(async () => {
  const now = Date.now();
  await initializeDefaults();
  await rollover(now);
  await addRemainderOnNonGracefulExit();
  debugLog("background init complete", {
    now,
    iso: new Date(now).toISOString(),
  });
})();

browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    initializeDefaults();
    await browser.tabs.create({
      url: browser.runtime.getURL("firstTimeInstall.html"),
    });
  }
});

// TODO fix that after a time the buttons dont work

browser.runtime.onMessage.addListener(async (msg: any, sender: browser.Runtime.MessageSender) => {
  if (sender.tab?.id === undefined) return;
  try {
    if (msg.action === "CLOSE_TAB") {
      console.log("Deprompt: closing tab on user request");
      await browser.tabs.remove(sender.tab.id);
    } else if (msg.action === "TOGGLE_BLOCK") {
      console.log("Deprompt: toggling block timer for 5 minutes");
      await ejectBlockPopup(sender.tab.id);
      await setBlockToggle();
    } else if (msg.action === "CLOSE_REMINDER") {
      console.log("Deprompt: closing reminder popup");
      await ejectReminderPopup(sender.tab.id);
    }
  } catch (err) {
    console.error("Deprompt: message handling failed", err);
  }
});

// #endregion
