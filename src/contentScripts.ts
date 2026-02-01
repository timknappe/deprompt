import browser from "webextension-polyfill";
import type { Reminder } from "./types.js";
import { BLOCKER_CONTENT_SCRIPT, REMINDER_CONTENT_SCRIPT } from "./constants.js";

// #region injection checks

export async function isDepromptBlockCssLoaded(tabId: number): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: (cssFlag: string) => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(cssFlag);
      return value.trim().replace(/['"]/g, "") === "yes";
    },
    args: [BLOCKER_CONTENT_SCRIPT.css_flag],
  });

  const res = results[0] as { result?: unknown } | undefined;
  return Boolean(res?.result);
}

export async function isDepromptReminderCssLoaded(tabId: number): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: (cssFlag: string) => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(cssFlag);
      return value.trim().replace(/['"]/g, "") === "yes";
    },
    args: [REMINDER_CONTENT_SCRIPT.css_flag],
  });

  const res = results[0] as { result?: unknown } | undefined;
  return Boolean(res?.result);
}

export async function isBlockPopupInjected(tabId: number): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: (jsFlag: string) => !!document.querySelector(`#${jsFlag}`),
    args: [BLOCKER_CONTENT_SCRIPT.js_flag],
  });

  const res = results[0] as { result?: unknown } | undefined;
  return Boolean(res?.result);
}

export async function isReminderPopupInjected(tabId: number): Promise<boolean> {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    func: (jsFlag: string) => !!document.querySelector(`#${jsFlag}`),
    args: [REMINDER_CONTENT_SCRIPT.js_flag],
  });

  const res = results[0] as { result?: unknown } | undefined;
  return Boolean(res?.result);
}

// #endregion

// #region ejection

export async function ejectBlockPopup(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (jsFlag: string) => {
        document.getElementById(jsFlag)?.remove();
      },
      args: [BLOCKER_CONTENT_SCRIPT.js_flag],
    });
  } catch (err) {
    console.error("Failed to remove block popup", err);
  }
}

export async function ejectReminderPopup(tabId: number): Promise<void> {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (jsFlag: string) => {
        document.getElementById(jsFlag)?.remove();
      },
      args: [REMINDER_CONTENT_SCRIPT.js_flag],
    });
  } catch (err) {
    console.error("Failed to remove reminder popup", err);
  }
}

// #endregion

// #region injection

export async function injectBlockScreen(tabId: number): Promise<void> {
  if (!(await isDepromptBlockCssLoaded(tabId))) {
    await browser.scripting.insertCSS({
      target: { tabId },
      files: [BLOCKER_CONTENT_SCRIPT.css],
    });
  }

  if (!(await isBlockPopupInjected(tabId))) {
    await browser.scripting.executeScript({
      target: { tabId },
      files: [BLOCKER_CONTENT_SCRIPT.javascript],
    });
  }
}

export async function injectReminder(tabId: number, reminderType: Reminder): Promise<void> {
  if (!(await isDepromptReminderCssLoaded(tabId))) {
    await browser.scripting.insertCSS({
      target: { tabId },
      files: [REMINDER_CONTENT_SCRIPT.css],
    });
  }

  if (!(await isReminderPopupInjected(tabId))) {
    await browser.scripting.executeScript({
      target: { tabId },
      func: (reason: Reminder) => {
        (window as any).REMINDER_ARG = reason;
      },
      args: [reminderType],
    });

    await browser.scripting.executeScript({
      target: { tabId },
      files: [REMINDER_CONTENT_SCRIPT.javascript],
    });
  }
}

// #endregion
