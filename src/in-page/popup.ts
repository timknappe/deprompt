import browser from "webextension-polyfill";
import {
  formatTime,
  getCurrentBlockType,
  getTimeTillNextFixedBlocker,
  isBlocked,
  renderTime,
  resolveProvider,
  setButtonBlock,
} from "../helpers.js";
import { getTodayUsage, getWeeklyUsage, isSnoozed, setBlockToggle, setSnooze } from "../storageManager.js";

const debugLog = (...args: unknown[]) => console.log("[Deprompt-debug][popup]", ...args);

let totalMsDaily = 0;
let totalMsWeekly = 0;
let intervalGlobal: number | null = null;

async function refreshTotals() {
  totalMsDaily = await getTodayUsage(true);
  totalMsWeekly = await getWeeklyUsage(true);
  document.getElementById("usage-today")!.textContent = await renderTime(formatTime(totalMsDaily));
  document.getElementById("usage-week")!.textContent = await renderTime(formatTime(totalMsWeekly));
}

await refreshTotals();

document.getElementById("until_block")!.textContent = await getTimeTillNextFixedBlocker();

const blocked: boolean = await isBlocked(true);
const blockReason = await getCurrentBlockType(true);
const button = document.getElementById("blocker")!;

if (blockReason === "ManualBlock") {
  button.textContent = blocked ? "Unblock" : "Block";
  button.classList.toggle("danger", blocked);
} else {
  button.textContent = blocked ? "Toggle block (5 minutes)" : "Block";
  button.classList.toggle("danger", blocked);
}

await ensureIntervalForActiveTab();

button.addEventListener("click", async () => {
  const curentBlockReason = await getCurrentBlockType(true);
  if (curentBlockReason === "ManualBlock" || curentBlockReason === null) {
    await browser.storage.sync.set({
      "settings:block:manual": !(await isBlocked(true)),
    });
    const blockState: boolean = await isBlocked(true);
    button.textContent = blockState ? "Unblock" : "Block";
    button.classList.toggle("danger", blockState);
  } else {
    await setBlockToggle();
    const blockState: boolean = await isBlocked(true);
    button.textContent = blockState ? "Toggle block (5 minutes)" : "Block";
    button.classList.toggle("danger", blockState);
  }
  debugLog("popup blocker click", {
    currentBlockReason: curentBlockReason,
    nowBlocked: await isBlocked(true),
  });

  stopInterval();
});

const snoozeButton = document.getElementById("snoozeButton")!;

snoozeButton.innerHTML = (await isSnoozed())
  ? "<img src='../../assets/snooze.png' /> Unsnooze"
  : "<img src='../../assets/snooze.png' /> Snooze for Today";
snoozeButton.classList.toggle("dangerSnoozed", !!(await isSnoozed()));

snoozeButton.addEventListener("click", async () => {
  await setSnooze();
  const snoozeState = await isSnoozed();
  snoozeButton.innerHTML = (await isSnoozed())
    ? "<img src='../../assets/snooze.png' /> Unsnooze"
    : "<img src='../../assets/snooze.png' /> Snooze for Today";
  snoozeButton.classList.toggle("dangerSnoozed", !!(await isSnoozed()));
  debugLog("popup snooze click", { snoozed: await isSnoozed() });

  if (snoozeState === true) {
    (button as HTMLButtonElement).disabled = true;
  } else {
    (button as HTMLButtonElement).disabled = false;
  }

  if ((await isBlocked()) && snoozeState === false) {
    setButtonBlock(button, true);
  } else if ((await isBlocked) && snoozeState === true) {
    setButtonBlock(button, false);
  }
});

function incrementWhileDisplayed() {
  return window.setInterval(async () => {
    totalMsDaily += 1000;
    document.getElementById("usage-today")!.textContent = await renderTime(formatTime(totalMsDaily));

    totalMsWeekly += 1000;
    document.getElementById("usage-week")!.textContent = await renderTime(formatTime(totalMsWeekly));
  }, 1000);
}

function stopInterval() {
  if (intervalGlobal !== null) {
    clearInterval(intervalGlobal);
    intervalGlobal = null;
    debugLog("stopInterval");
  }
}

function startInterval() {
  stopInterval();
  intervalGlobal = incrementWhileDisplayed();
  debugLog("startInterval");
}

async function ensureIntervalForActiveTab() {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });

  if (!tab?.url) {
    stopInterval();
    return;
  }

  const provider = await resolveProvider(tab.url);
  if (provider) {
    if (intervalGlobal === null) {
      await refreshTotals();
      startInterval();
    }
  } else {
    stopInterval();
  }
  debugLog("ensureIntervalForActiveTab", {
    tabId: tab?.id,
    url: tab?.url,
    provider,
    intervalRunning: intervalGlobal !== null,
  });
}

browser.tabs.onUpdated.addListener(async (tabId, changeInfo, tabInfo) => {
  await ensureIntervalForActiveTab();
  const currentTab = tabInfo ?? (await browser.tabs.get(tabId));
  debugLog("popup tabs.onUpdated", {
    tabId,
    url: currentTab.url,
    intervalRunning: intervalGlobal !== null,
  });
});

browser.tabs.onActivated.addListener(async ({ tabId }) => {
  await ensureIntervalForActiveTab();
  const activeTab = await browser.tabs.get(tabId);
  debugLog("popup tabs.onActivated", {
    tabId,
    url: activeTab.url,
    intervalRunning: intervalGlobal !== null,
  });
});

browser.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === browser.windows.WINDOW_ID_NONE) {
    stopInterval();
  } else {
    const [activeTab] = await browser.tabs.query({ active: true, windowId });
    const provider = await resolveProvider(activeTab?.url ?? "");
    if (provider) {
      startInterval();
    } else {
      stopInterval();
    }
    debugLog("popup windows.onFocusChanged", {
      windowId,
      tabId: activeTab?.id,
      url: activeTab?.url,
      provider,
      intervalRunning: intervalGlobal !== null,
    });
  }
});

document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "hidden") {
    stopInterval();
  } else {
    await ensureIntervalForActiveTab();
  }
  debugLog("popup visibilitychange", {
    state: document.visibilityState,
    intervalRunning: intervalGlobal !== null,
  });
});

window.addEventListener("blur", stopInterval);
window.addEventListener("focus", async () => {
  await ensureIntervalForActiveTab();
  debugLog("popup window focus", { intervalRunning: intervalGlobal !== null });
});
