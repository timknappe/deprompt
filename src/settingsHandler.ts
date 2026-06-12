import browser from "webextension-polyfill";
import {
  DEFAULT_SETTINGS,
  SETTINGS_PROVIDERS,
  STORAGE_KEYS,
  customProviderNavigableUrl,
  normalizeCustomProviderPattern,
  slugifyCustomProviderId,
} from "./constants.js";
import type { CustomProvider, ProviderSelections, ToggleableDurationSetting, SettingsState } from "./types.js";
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
  const howOftenRaw = result[STORAGE_KEYS.notificationHowOften];
  const howOftenObj =
    typeof howOftenRaw === "object" && howOftenRaw ? (howOftenRaw as Partial<ToggleableDurationSetting>) : {};
  const blockFixedRaw = result[STORAGE_KEYS.blockFixedTime];
  const blockFixed = Array.isArray(blockFixedRaw)
    ? (blockFixedRaw as unknown[]).filter((entry): entry is string => typeof entry === "string")
    : [];
  const providersRaw = result[STORAGE_KEYS.providers];
  const providers = typeof providersRaw === "object" && providersRaw ? (providersRaw as ProviderSelections) : {};
  const showSeconds = Boolean(result[STORAGE_KEYS.formattingShowSeconds] ?? DEFAULT_SETTINGS.formatting.showSeconds);
  const countUnfocusedTime = result[STORAGE_KEYS.trackingCountUnfocused] === undefined
    ? DEFAULT_SETTINGS.tracking.countUnfocusedTime
    : Boolean(result[STORAGE_KEYS.trackingCountUnfocused]);

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
      continuous: { ...DEFAULT_SETTINGS.notifications.continuous, ...continuousObj },
      howOften: { ...DEFAULT_SETTINGS.notifications.howOften, ...howOftenObj },
    },
    block: { fixedTime: blockFixed },
    providers: {
      ...DEFAULT_SETTINGS.providers,
      ...providers,
    },
    formatting: {
      showSeconds,
    },
    tracking: {
      countUnfocusedTime,
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

function updateHowOftenSectionState(): void {
  const dailyToggle = document.getElementById("dailyNotifyToggle");
  const continuousToggle = document.getElementById("continuousNotifyToggle");
  const howOftenToggle = document.getElementById("howOftenNotifyToggle");
  const howOftenMinutes = document.getElementById("howOftenNotifyMinutes");

  const anyNotificationEnabled =
    (dailyToggle instanceof HTMLInputElement && dailyToggle.checked) ||
    (continuousToggle instanceof HTMLInputElement && continuousToggle.checked);

  if (howOftenToggle instanceof HTMLInputElement) {
    howOftenToggle.disabled = !anyNotificationEnabled;
    if (howOftenMinutes instanceof HTMLInputElement) {
      howOftenMinutes.disabled = !anyNotificationEnabled || !howOftenToggle.checked;
    }
  }
}

const wireNotifications = (): void => {
  const dailyToggle = document.getElementById("dailyNotifyToggle");
  const dailyMinutes = document.getElementById("dailyNotifyMinutes");
  const continuousToggle = document.getElementById("continuousNotifyToggle");
  const continuousMinutes = document.getElementById("continuousNotifyMinutes");
  const howOftenToggle = document.getElementById("howOftenNotifyToggle");
  const howOftenMinutes = document.getElementById("howOftenNotifyMinutes");

  if (dailyToggle instanceof HTMLInputElement && dailyMinutes instanceof HTMLInputElement) {
    dailyToggle.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const enabled = target.checked;
      toggleNotificationInputs("daily", enabled);
      updateHowOftenSectionState();
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
      updateHowOftenSectionState();
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

  if (howOftenToggle instanceof HTMLInputElement && howOftenMinutes instanceof HTMLInputElement) {
    howOftenToggle.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const enabled = target.checked;
      howOftenMinutes.disabled = !enabled;
      await saveSetting(STORAGE_KEYS.notificationHowOften, {
        enabled,
        minutes: Number(howOftenMinutes.value) || 1,
      });
    });
    howOftenMinutes.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const minutes = Math.max(1, Number(target.value) || 0);
      howOftenMinutes.value = String(minutes);
      await saveSetting(STORAGE_KEYS.notificationHowOften, {
        enabled: howOftenToggle.checked,
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
    row.className = "block-time-entry";
    row.innerHTML = `
      <div class="time-range">
        <span class="time-badge">${start}</span>
        <span class="time-arrow">→</span>
        <span class="time-badge">${end}</span>
      </div>
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

// #region providers (built-in + custom)

// Holds the current provider on/off selections; shared across re-renders so the
// custom-provider add/delete flows stay in sync with the checkbox states.
let providerSelections: ProviderSelections = {};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

async function readCustomAdded(): Promise<Record<string, CustomProvider>> {
  const result = await browser.storage.sync.get(STORAGE_KEYS.customProvidersAdded);
  const raw = result[STORAGE_KEYS.customProvidersAdded];
  if (!raw || typeof raw !== "object") return {};

  const out: Record<string, CustomProvider> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value && typeof value === "object") {
      const name = (value as Record<string, unknown>).name;
      const url = (value as Record<string, unknown>).url;
      if (typeof name === "string" && typeof url === "string") out[id] = { name, url };
    }
  }
  return out;
}

async function readCustomToAdd(): Promise<CustomProvider | null> {
  const result = await browser.storage.sync.get(STORAGE_KEYS.customProvidersToAdd);
  const raw = result[STORAGE_KEYS.customProvidersToAdd];
  if (raw && typeof raw === "object") {
    const name = (raw as Record<string, unknown>).name;
    const url = (raw as Record<string, unknown>).url;
    if (typeof name === "string" && typeof url === "string") return { name, url };
  }
  return null;
}

async function renderProviderList(): Promise<void> {
  const container = document.getElementById("providerList");
  if (!container) return;
  const customAdded = await readCustomAdded();
  container.innerHTML = "";

  Object.entries(SETTINGS_PROVIDERS).forEach(([key, label]) => {
    const wrapper = document.createElement("label");
    wrapper.className = "inline-option";
    wrapper.innerHTML = `
      <input type="checkbox" name="provider-${key}" data-provider="${key}" ${providerSelections[key] ? "checked" : ""} />
      ${label}
    `;
    container.appendChild(wrapper);
  });

  Object.entries(customAdded).forEach(([id, provider]) => {
    // Custom providers default to enabled unless explicitly turned off.
    const checked = providerSelections[id] !== false;
    const row = document.createElement("div");
    row.className = "inline-option custom-provider-row";
    row.innerHTML = `
      <label class="custom-provider-label">
        <input type="checkbox" data-provider="${id}" ${checked ? "checked" : ""} />
        ${escapeHtml(provider.name)}
      </label>
      <button
        type="button"
        class="custom-provider-delete"
        data-delete-provider="${id}"
        title="Remove ${escapeHtml(provider.name)}"
        aria-label="Remove ${escapeHtml(provider.name)}"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </svg>
      </button>
    `;
    container.appendChild(row);
  });
}

async function deleteCustomProvider(id: string): Promise<void> {
  const added = await readCustomAdded();
  const removed = added[id];
  delete added[id];
  await saveSetting(STORAGE_KEYS.customProvidersAdded, added);

  if (id in providerSelections) {
    delete providerSelections[id];
    await saveSetting(STORAGE_KEYS.providers, providerSelections);
  }

  // Best-effort: drop the host permission we no longer need.
  if (removed) {
    try {
      await browser.permissions.remove({ origins: [removed.url] });
    } catch (err) {
      console.warn("Failed to revoke custom provider permission", err);
    }
  }

  await renderProviderList();
}

function wireProviderInteractions(): void {
  const container = document.getElementById("providerList");
  if (!container) return;

  container.addEventListener("change", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const providerKey = target.getAttribute("data-provider");
    if (!providerKey) return;
    providerSelections[providerKey] = target.checked;
    await saveSetting(STORAGE_KEYS.providers, providerSelections);
  });

  container.addEventListener("click", async (event) => {
    const origin = event.target;
    if (!(origin instanceof Element)) return;
    const button = origin.closest("[data-delete-provider]");
    if (!button) return;
    const id = button.getAttribute("data-delete-provider");
    if (id) await deleteCustomProvider(id);
  });
}

async function activatePendingProvider(pending: CustomProvider): Promise<void> {
  // Honour the user gesture: open the site and ask for the host permission in the
  // same click handler so the browser shows its native allow/deny prompt.
  void browser.tabs.create({ url: customProviderNavigableUrl(pending.url) });

  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [pending.url] });
  } catch (err) {
    console.error("Custom provider permission request failed", err);
  }
  if (!granted) return;

  const id = slugifyCustomProviderId(pending.name);
  const added = await readCustomAdded();
  added[id] = { name: pending.name, url: pending.url };
  await saveSetting(STORAGE_KEYS.customProvidersAdded, added);

  providerSelections[id] = true;
  await saveSetting(STORAGE_KEYS.providers, providerSelections);

  await browser.storage.sync.remove(STORAGE_KEYS.customProvidersToAdd);
  await renderPendingProvider();
  await renderProviderList();
}

async function renderPendingProvider(): Promise<void> {
  const container = document.getElementById("customProviderPending");
  if (!container) return;
  const pending = await readCustomToAdd();
  container.innerHTML = "";
  if (!pending) return;

  const row = document.createElement("div");
  row.className = "custom-provider-pending";
  row.innerHTML = `
    <div class="pending-info">
      <span class="pending-badge">Pending</span>
      <span class="pending-name">${escapeHtml(pending.name)}</span>
      <span class="pending-url">${escapeHtml(pending.url)}</span>
    </div>
    <div class="pending-actions">
      <button type="button" class="button primary small" id="openPendingBtn">Open &amp; allow</button>
      <button type="button" class="button danger small" id="cancelPendingBtn">Cancel</button>
    </div>
  `;
  container.appendChild(row);

  document.getElementById("openPendingBtn")?.addEventListener("click", () => {
    void activatePendingProvider(pending);
  });
  document.getElementById("cancelPendingBtn")?.addEventListener("click", async () => {
    await browser.storage.sync.remove(STORAGE_KEYS.customProvidersToAdd);
    await renderPendingProvider();
  });
}

function wireAddCustomProvider(): void {
  const nameInput = document.getElementById("customProviderName");
  const urlInput = document.getElementById("customProviderUrl");
  const addBtn = document.getElementById("addCustomProviderBtn");
  const errorEl = document.getElementById("customProviderError");
  if (
    !(nameInput instanceof HTMLInputElement) ||
    !(urlInput instanceof HTMLInputElement) ||
    !(addBtn instanceof HTMLButtonElement)
  ) {
    return;
  }

  const showError = (message: string) => {
    if (errorEl) errorEl.textContent = message;
  };

  addBtn.addEventListener("click", async () => {
    showError("");
    const name = nameInput.value.trim();
    const pattern = normalizeCustomProviderPattern(urlInput.value);

    if (!name) return showError("Enter a name for the provider.");
    if (!pattern) return showError("Enter a valid URL, e.g. https://claude.ai/*");

    const id = slugifyCustomProviderId(name);
    if (!id) return showError("Name must contain letters or numbers.");
    if (id in SETTINGS_PROVIDERS) return showError("That name matches a built-in provider.");

    const added = await readCustomAdded();
    if (id in added) return showError("A custom provider with that name already exists.");

    await saveSetting(STORAGE_KEYS.customProvidersToAdd, { name, url: pattern });
    nameInput.value = "";
    urlInput.value = "";
    await renderPendingProvider();
  });
}
// #endregion

const wireFormatting = (showSeconds: boolean, countUnfocusedTime: boolean): void => {
  const showSecondsToggle = document.getElementById("showSecondsToggle");
  if (showSecondsToggle instanceof HTMLInputElement) {
    showSecondsToggle.checked = showSeconds;
    showSecondsToggle.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      await saveSetting(STORAGE_KEYS.formattingShowSeconds, target.checked);
    });
  }

  const unfocusedToggle = document.getElementById("countUnfocusedToggle");
  if (unfocusedToggle instanceof HTMLInputElement) {
    unfocusedToggle.checked = countUnfocusedTime;
    unfocusedToggle.addEventListener("change", async (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      await saveSetting(STORAGE_KEYS.trackingCountUnfocused, target.checked);
    });
  }
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
  setCheckboxState("howOftenNotifyToggle", settings.notifications.howOften.enabled);
  setNumberInput(
    "howOftenNotifyMinutes",
    settings.notifications.howOften.minutes,
    !settings.notifications.howOften.enabled
  );
  updateHowOftenSectionState();
  renderBlockRanges(currentBlockRanges);

  providerSelections = settings.providers;
  await renderProviderList();
  wireProviderInteractions();
  await renderPendingProvider();
  wireAddCustomProvider();
  wireFormatting(settings.formatting.showSeconds, settings.tracking.countUnfocusedTime);

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
