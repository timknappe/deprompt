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

/**
 * MV3 service workers are ephemeral; when they restart we lose in-memory tab
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
async function handleTabStateChange(tabId: number, url: string | undefined): Promise<void> {
  if (!url) return;

  const win = await browser.windows.getCurrent();
  if (win.type === "popup") return;

  const providerId = await resolveProvider(url);

  if (lastActiveTabId === tabId && lastActiveProviderId === providerId) return;

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

  // Commit new state optimistically so re-entrant calls skip
  lastActiveProviderId = providerId;
  lastActiveTabId = tabId;

  debugLog("handleTabStateChange: starting provider", { tabId, url, providerId });

  // Handle Blocking UI
  if (await isBlocked()) {
    await injectBlockScreen(tabId);
  } else {
    if (await isBlockPopupInjected(tabId)) {
      await ejectBlockPopup(tabId);
    }
  }

  await startTimerForProvider(providerId);
}

// #endregion

// #region Listeners

browser.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "syncTimer") {
    void isAliveCheck();
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
  }
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tabInfo) => {
  const currentTab = tabInfo ?? (await browser.tabs.get(tabId));
  await handleTabStateChange(tabId, currentTab.url);
  debugLog("tabs.onUpdated", { tabId, url: currentTab.url });
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  const activeTab = await browser.tabs.get(tabId);
  await handleTabStateChange(tabId, activeTab?.url);
  debugLog("tabs.onActivated", { tabId, url: activeTab?.url });
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  // This case will remain a problem as it is a technical limitation of browsers like chrome, WINDOW_ID_NONE is not only triggered by lost focus but also by toolbar interactions
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    if (lastActiveProviderId) {
      debugLog("windows.onFocusChanged: window lost focus", {
        provider: lastActiveProviderId,
      });
      await receiveEndTime(lastActiveProviderId);
      lastActiveProviderId = null;
    }
    return;
  }

  const [activeTab] = await browser.tabs.query({ active: true, windowId });
  if (!activeTab || !activeTab.id) return;

  await handleTabStateChange(activeTab.id, activeTab.url);
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
