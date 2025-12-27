import browser from "webextension-polyfill";
import { DEFAULT_SETTINGS, SETTINGS_PROVIDERS, STORAGE_KEYS } from "./constants.js";
import type { ProviderSelections, ToggleableDurationSetting, SettingsState } from "./types.js";
import { getFixedBlockDurations, initializeDefaults } from "./storageManager.js";
import { destructFixedBlocker } from "./helpers.js";

let currentBlockRanges: string[] = [];

const selectRadio = (name: string, value: string): void => {
  const radio = document.querySelector<HTMLInputElement>(`input[type="radio"][name="${name}"][value="${value}"]`);
  if (radio) radio.checked = true;
};

const setCheckboxState = (id: string, checked: boolean): void => {
  const cb = document.getElementById(id);
  if (cb instanceof HTMLInputElement) {
    cb.checked = checked;
  }
};

const setNumberInput = (id: string, value: number, disabled = false): void => {
  const el = document.getElementById(id);
  if (el instanceof HTMLInputElement) {
    el.value = String(value);
    el.disabled = disabled;
  }
};

async function loadSettings(): Promise<SettingsState> {
  const result = await browser.storage.sync.get(Object.values(STORAGE_KEYS));
  const timeLimitRaw = result[STORAGE_KEYS.timeLimit];
  const timeLimitObj: Partial<ToggleableDurationSetting> =
    typeof timeLimitRaw === "object" && timeLimitRaw
      ? (timeLimitRaw as Partial<ToggleableDurationSetting>)
      : typeof timeLimitRaw === "number"
      ? { enabled: true, minutes: timeLimitRaw }
      : {};
  const dailyRaw = result[STORAGE_KEYS.notificationDaily];
  const dailyObj = typeof dailyRaw === "object" && dailyRaw ? (dailyRaw as Partial<ToggleableDurationSetting>) : {};
  const continuousRaw = result[STORAGE_KEYS.notificationContinuous];
  const continuousObj =
    typeof continuousRaw === "object" && continuousRaw ? (continuousRaw as Partial<ToggleableDurationSetting>) : {};
  const blockFixedRaw = result[STORAGE_KEYS.blockFixedTime];
  const blockFixed = Array.isArray(blockFixedRaw)
    ? (blockFixedRaw as unknown[]).filter((entry): entry is string => typeof entry === "string")
    : [];
  const providersRaw = result[STORAGE_KEYS.providers];
  const providers = typeof providersRaw === "object" && providersRaw ? (providersRaw as ProviderSelections) : {};
  const showSeconds = Boolean(result[STORAGE_KEYS.formattingShowSeconds] ?? DEFAULT_SETTINGS.formatting.showSeconds);

  const mergedTimeLimit = { ...DEFAULT_SETTINGS.timeLimit, ...timeLimitObj };
  const normalizedTimeLimit: ToggleableDurationSetting = {
    enabled:
      typeof mergedTimeLimit.enabled === "boolean" ? mergedTimeLimit.enabled : DEFAULT_SETTINGS.timeLimit.enabled,
    minutes:
      typeof mergedTimeLimit.minutes === "number" &&
      Number.isFinite(mergedTimeLimit.minutes) &&
      mergedTimeLimit.minutes > 0
        ? mergedTimeLimit.minutes
        : DEFAULT_SETTINGS.timeLimit.minutes,
  };

  return {
    timeLimit: normalizedTimeLimit,
    notifications: {
      daily: { ...DEFAULT_SETTINGS.notifications.daily, ...dailyObj },
      continuous: {
        ...DEFAULT_SETTINGS.notifications.continuous,
        ...continuousObj,
      },
    },
    block: { fixedTime: blockFixed },
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...providers,
    },
    formatting: {
      showSeconds,
    },
  };
}

const saveSetting = async (key: string, value: unknown): Promise<void> => {
  await browser.storage.sync.set({ [key]: value });
};

const wireTimeLimit = (): void => {
  const toggle = document.getElementById("timeLimitToggle");
  const minutesInput = document.getElementById("timeLimitInput");
  if (!(minutesInput instanceof HTMLInputElement)) return;

  const persist = async (enabled: boolean, minutes: number) => {
    await saveSetting(STORAGE_KEYS.timeLimit, { enabled, minutes });
  };
  const isEnabled = () => (toggle instanceof HTMLInputElement ? toggle.checked : true);

  if (toggle instanceof HTMLInputElement) {
    toggle.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const enabled = target.checked;
      const minutes = Math.max(1, Number(minutesInput.value) || 0);
      minutesInput.disabled = !enabled;
      minutesInput.value = String(minutes);
      await persist(enabled, minutes);
    });
  }

  minutesInput.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const minutes = Math.max(1, Number(target.value) || 0);
    minutesInput.value = String(minutes);
    await persist(isEnabled(), minutes);
  });
};

function toggleNotificationInputs(type: "daily" | "continuous", enabled: boolean) {
  const inputId = type === "daily" ? "dailyNotifyMinutes" : "continuousNotifyMinutes";
  const input = document.getElementById(inputId);
  if (input instanceof HTMLInputElement) {
    input.disabled = !enabled;
  }
}

const wireNotifications = (): void => {
  const dailyToggle = document.getElementById("dailyNotifyToggle");
  const dailyMinutes = document.getElementById("dailyNotifyMinutes");
  const continuousToggle = document.getElementById("continuousNotifyToggle");
  const continuousMinutes = document.getElementById("continuousNotifyMinutes");

  if (dailyToggle instanceof HTMLInputElement && dailyMinutes instanceof HTMLInputElement) {
    dailyToggle.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const enabled = target.checked;
      toggleNotificationInputs("daily", enabled);
      await saveSetting(STORAGE_KEYS.notificationDaily, {
        enabled,
        minutes: Number(dailyMinutes.value) || 1,
      });
    });
    dailyMinutes.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const minutes = Math.max(1, Number(target.value) || 0);
      dailyMinutes.value = String(minutes);
      await saveSetting(STORAGE_KEYS.notificationDaily, {
        enabled: dailyToggle.checked,
        minutes,
      });
    });
  }

  if (continuousToggle instanceof HTMLInputElement && continuousMinutes instanceof HTMLInputElement) {
    continuousToggle.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const enabled = target.checked;
      toggleNotificationInputs("continuous", enabled);
      await saveSetting(STORAGE_KEYS.notificationContinuous, {
        enabled,
        minutes: Number(continuousMinutes.value) || 1,
      });
    });
    continuousMinutes.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const minutes = Math.max(1, Number(target.value) || 0);
      continuousMinutes.value = String(minutes);
      await saveSetting(STORAGE_KEYS.notificationContinuous, {
        enabled: continuousToggle.checked,
        minutes,
      });
    });
  }
};

const timeToMinutes = (time: string): number => {
  const [h = "0", m = "0"] = time.split(":");
  const hours = Number(h);
  const minutes = Number(m);
  return hours * 60 + minutes;
};

async function renderBlockRanges(ranges: string[]): Promise<void> {
  const container = document.getElementById("blockTimeContainer");
  if (!container) return;
  container.innerHTML = "";
  const fixedBlockers = await getFixedBlockDurations();
  if (fixedBlockers.length === 0) return;
  for (let i = 0; i < fixedBlockers.length; i++) {
    const [startRaw, endRaw] = destructFixedBlocker(fixedBlockers, i);
    const start = startRaw.format("HH:mm");
    const end = endRaw.format("HH:mm");
    const row = document.createElement("div");
    row.className = "time-row";
    row.innerHTML = `
      <span>${start} - ${end}</span>
      <button type="button" data-idx="${i}" class="button danger small">Remove</button>
    `;
    container.appendChild(row);
  }

  container.querySelectorAll<HTMLButtonElement>("button[data-idx]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const removeIdx = Number(target.getAttribute("data-idx"));
      if (Number.isNaN(removeIdx)) return;
      currentBlockRanges.splice(removeIdx, 1);
      await saveSetting(STORAGE_KEYS.blockFixedTime, currentBlockRanges);
      renderBlockRanges(currentBlockRanges);
    });
  });
}

const wireBlocking = (): void => {
  const blockStart = document.getElementById("blockStart");
  const blockEnd = document.getElementById("blockEnd");
  const addBtn = document.getElementById("addBlockBtn");
  const timeError = document.getElementById("timeError");
  const hint = document.getElementById("blockingModeHint");

  if (hint) {
    hint.textContent = "Blocks during the scheduled windows you add below.";
  }

  if (
    addBtn instanceof HTMLButtonElement &&
    blockStart instanceof HTMLInputElement &&
    blockEnd instanceof HTMLInputElement &&
    timeError instanceof HTMLElement
  ) {
    addBtn.addEventListener("click", async () => {
      timeError.textContent = "";
      const start = blockStart.value;
      const end = blockEnd.value;
      if (!start || !end) {
        timeError.textContent = "Start and end times are required.";
        return;
      }
      const startMin = timeToMinutes(start);
      const endMin = timeToMinutes(end);
      if (endMin <= startMin) {
        timeError.textContent = "End time must be after start time.";
        return;
      }
      currentBlockRanges.push(`${start};${end}`);
      await saveSetting(STORAGE_KEYS.blockFixedTime, currentBlockRanges);
      renderBlockRanges(currentBlockRanges);
      blockStart.value = "";
      blockEnd.value = "";
    });
  }
};

function buildProviderList(selectedProviders: ProviderSelections): void {
  const container = document.getElementById("providerList");
  if (!container) return;
  container.innerHTML = "";
  Object.entries(SETTINGS_PROVIDERS).forEach(([key, label]) => {
    const wrapper = document.createElement("label");
    wrapper.className = "inline-option";
    wrapper.innerHTML = `
      <input type="checkbox" name="provider-${key}" data-provider="${key}" ${selectedProviders[key] ? "checked" : ""} />
      ${label}
    `;
    container.appendChild(wrapper);
  });

  container.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const providerKey = target.getAttribute("data-provider");
    if (!providerKey) return;
    selectedProviders[providerKey] = target.checked;
    await saveSetting(STORAGE_KEYS.providers, selectedProviders);
  });
}

const wireFormatting = (showSeconds: boolean): void => {
  const toggle = document.getElementById("showSecondsToggle");
  if (!(toggle instanceof HTMLInputElement)) return;
  toggle.checked = showSeconds;
  toggle.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    await saveSetting(STORAGE_KEYS.formattingShowSeconds, target.checked);
  });
};

async function init() {
  const settings = await loadSettings();
  currentBlockRanges = [...settings.block.fixedTime];

  setCheckboxState("timeLimitToggle", settings.timeLimit.enabled);
  setNumberInput("timeLimitInput", settings.timeLimit.minutes, !settings.timeLimit.enabled);

  setCheckboxState("dailyNotifyToggle", settings.notifications.daily.enabled);
  setNumberInput("dailyNotifyMinutes", settings.notifications.daily.minutes, !settings.notifications.daily.enabled);
  setCheckboxState("continuousNotifyToggle", settings.notifications.continuous.enabled);
  setNumberInput(
    "continuousNotifyMinutes",
    settings.notifications.continuous.minutes,
    !settings.notifications.continuous.enabled
  );
  renderBlockRanges(currentBlockRanges);

  buildProviderList(settings.providers);
  wireFormatting(settings.formatting.showSeconds);

  wireTimeLimit();
  wireNotifications();
  wireBlocking();
}

window.addEventListener("DOMContentLoaded", () => {
  init().catch((err) => console.error("Error loading settings:", err));
});

// #region sidebar animation

const sections = [...document.querySelectorAll<HTMLElement>(".section")];

let active: HTMLElement | null = null;

let ignoreStamp: number | null = null;

const sideBarLinks = document.querySelectorAll(".sideBarLink");

addEventListener(
  "scroll",
  () => {
    if (ignoreStamp !== null && ignoreStamp >= Date.now()) return;
    ignoreStamp = Date.now() + 100;
    const center = innerHeight / 2;

    let best: HTMLElement | null = null;
    let bestDist = Infinity;

    for (const s of sections) {
      const r = s.getBoundingClientRect();
      const d = Math.abs(r.top + r.height / 2 - center);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }

    if (best && best !== active) {
      sideBarLinks?.forEach((element) => element.classList.remove("focused"));

      const bestId = best.getAttribute("id");
      if (bestId) {
        document.querySelector(`a[href="#${bestId}"]`)?.classList.add("focused");
      }
      active = best;
    }
  },
  { passive: true }
);

document.querySelectorAll(".sideBarLink").forEach((button) => {
  button.addEventListener("click", () => {
    ignoreStamp = Date.now() + 300;

    sideBarLinks?.forEach((element) => element.classList.remove("focused"));
    button.classList.add("focused");
  });
});

// #endregion

// region Reset, Export, Import

const resetDataButton = document.getElementById("resetDataBtn");
const resetDataCancel = document.getElementById("cancelReset");
const resetDataConfirm = document.getElementById("confirmReset");
const confirmDialog = document.getElementById("confirmDialog");

resetDataButton?.addEventListener("click", () => {
  if (!confirmDialog) return;
  confirmDialog.hidden = false;
});

resetDataCancel?.addEventListener("click", () => {
  if (!confirmDialog) return;
  confirmDialog.hidden = true;
});

resetDataConfirm?.addEventListener("click", async () => {
  await Promise.all([
    browser.storage.local.clear(),
    browser.storage.sync.clear(),
    browser.storage.session?.clear(),
    browser.alarms?.clearAll(),
  ]);

  initializeDefaults();
  await browser.tabs.create({
    url: browser.runtime.getURL("firstTimeInstall.html"),
  });
});

const exportDataBtn = document.getElementById("exportDataBtn");

exportDataBtn?.addEventListener("click", async () => {
  const dataSync = await browser.storage.sync.get();

  const data = { ...dataSync };

  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  try {
    await browser.downloads.download({
      url,
      filename: "deprompt_data.json",
      saveAs: false,
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
});

const importDataBtn = document.getElementById("importDataBtn");
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

importDataBtn?.addEventListener("click", async () => {
  fileInput!.value = "";
  fileInput!.click();
});

fileInput.addEventListener("change", async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  await browser.storage.sync.clear();

  const rawText = await file.text();
  const data = JSON.parse(rawText) as Record<string, unknown>;

  for (const [key, value] of Object.entries(data)) {
    await browser.storage.sync.set({ [key]: value });
  }
});

// #endregion
