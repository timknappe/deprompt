import browser from "webextension-polyfill";
import { getRemainingUsageTime, getTimeTillNextFixedBlockerValue } from "../helpers.js";
import { getCurrentProviderDuration, getTodayUsage } from "../storageManager.js";
import { REMINDER_CONTENT_SCRIPT } from "../constants.js";

(async () => {
  const reminderId = REMINDER_CONTENT_SCRIPT.js_flag;
  if (document.getElementById(reminderId)) return;

  try {
    const response = await fetch(browser.runtime.getURL(REMINDER_CONTENT_SCRIPT.html));
    const htmlContent = await response.text();

    const container = document.createElement("div");
    container.innerHTML = htmlContent;

    if (container.firstElementChild) {
      document.body.appendChild(container.firstElementChild);
    }
  } catch (error) {
    console.error("Failed to inject reminder HTML:", error);
    return;
  }

  const timeReminder = document.getElementById("time-reminder")!;
  const reasonText = document.getElementById("reason-text")!;

  const reminderType = (window as any).REMINDER_ARG;

  if (!timeReminder || !reasonText || !reminderType) {
    console.error("Reminder elements or argument missing.");
    return;
  }

  let reasonMessage = "";
  let countdownSeconds: number | null = null;
  let reverseReminderCountdown = false;
  switch (reminderType) {
    case "DailyUsageReminder":
      reasonMessage = "You have been using AI for a while today. Remember to take breaks!";
      countdownSeconds = (await getTodayUsage(true)) / 1000;
      reverseReminderCountdown = true;
      break;
    case "ContinuousUsageReminder":
      reasonMessage = "You've been using AI for a while. Remember to take breaks!";
      countdownSeconds = (await getCurrentProviderDuration()) / 1000;
      reverseReminderCountdown = true;
      break;
    case "BlockedSoonReminder":
      reasonMessage = "You're about to reach one of your set blocked times";
      countdownSeconds = await getTimeTillNextFixedBlockerValue();
      break;
    case "TimeLimit":
      reasonMessage = "You will reach your daily AI usage limit soon.";
      countdownSeconds = (await getRemainingUsageTime(true))! / 1000;
      break;
    default:
      reasonMessage = "";
      break;
  }
  countdownSeconds == null ? (countdownSeconds = 0) : null;
  countdownSeconds = Math.floor(countdownSeconds);
  reasonText.textContent = reasonMessage;

  if (countdownSeconds === null) {
    console.warn("No countdown source available (no blockers and no usage limit).");
    timeReminder.textContent = "--:--";
    return;
  }

  let timerInterval: number | null = null;

  function updateTimer(reverseCountdown: boolean = false) {
    if (countdownSeconds === null) {
      timeReminder.textContent = "--:--";
      return;
    }

    if (countdownSeconds <= 0) {
      timeReminder.textContent = "00:00";
      browser.runtime.sendMessage({ action: "CLOSE_REMINDER" });
      if (timerInterval !== null) {
        clearInterval(timerInterval);
      }
      return;
    }

    const minutes = Math.floor(countdownSeconds / 60);
    const seconds = countdownSeconds % 60;

    timeReminder.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    if (reverseCountdown) {
      countdownSeconds += 1;
    } else {
      countdownSeconds -= 1;
    }
  }

  updateTimer(reverseReminderCountdown);
  timerInterval = window.setInterval(() => updateTimer(reverseReminderCountdown), 1000);

  const closeBtn = document.getElementById("close-reminder-btn");

  closeBtn?.addEventListener("click", () => {
    browser.runtime.sendMessage({ action: "CLOSE_REMINDER" });
  });
})();
