import browser from "webextension-polyfill";
import { ONBOARDING_PROVIDERS } from "./constants.js";
import type { ProviderSelections, StepRenderer } from "./types.js";

const wizardEl = document.getElementById("wizard");
if (!(wizardEl instanceof HTMLElement)) {
  throw new Error("Wizard container element not found");
}
const wizard = wizardEl;
let step = 0;
const MIN_DURATION_MINUTES = 5;
const MAX_DURATION_MINUTES = 600;

const steps: StepRenderer[] = [renderNotifications, renderBlocks, renderPlatforms, renderFinish];

function parseDurationMinutes(input: HTMLInputElement): number | null {
  const parsed = Number(input.value);
  if (!Number.isFinite(parsed)) return null;
  if (!Number.isInteger(parsed)) return null;
  if (parsed < MIN_DURATION_MINUTES || parsed > MAX_DURATION_MINUTES) return null;
  return parsed;
}

function setFieldError(errorId: string, message: string): void {
  const errorEl = document.getElementById(errorId);
  if (errorEl instanceof HTMLElement) {
    errorEl.textContent = message;
  }
}

function setInputValidityState(input: HTMLInputElement, isInvalid: boolean): void {
  input.classList.toggle("is-invalid", isInvalid);
  input.setAttribute("aria-invalid", isInvalid ? "true" : "false");
}

function validateDurationField(input: HTMLInputElement, errorId: string, label: string): number | null {
  const minutes = parseDurationMinutes(input);
  if (minutes === null) {
    setInputValidityState(input, true);
    setFieldError(
      errorId,
      `${label} must be a whole number between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`,
    );
    return null;
  }

  setInputValidityState(input, false);
  setFieldError(errorId, "");
  return minutes;
}

function sanitizeDurationField(input: HTMLInputElement, fallback: number): number {
  const parsed = parseDurationMinutes(input);
  return parsed ?? fallback;
}

function timeToMinutes(value: string): number {
  const [hour = "0", minute = "0"] = value.split(":");
  return Number(hour) * 60 + Number(minute);
}

// ---- STEP 1 ----
function renderNotifications(): void {
  wizard.innerHTML = `
    <h2>Step 1 - Notifications</h2>
    <p class="description">Set reminders for your sessions.</p>

      <label class="radio-option">
        <input type="checkbox" id="notifyDailyToggle">
        <span>Notify (Daily) - remind you after a set time of daily usage</span>
      </label>
      <div class="sub-option">
        <span>After</span>
        <input type="number" id="notifyDailyDuration" min="5" max="600" value="45" />
        <span>minutes</span>
      </div>
      <p id="notifyDailyError" class="field-error" aria-live="polite"></p>
      <label class="radio-option">
        <input type="checkbox" id="notifyContinuousToggle">
        <span>Notify (Continuous) - remind you after a set time of continuous usage</span>
      </label>
      <div class="sub-option">
        <span>After</span>
        <input type="number" id="notifyContinuousDuration" min="5" max="600" value="15" />
        <span>minutes</span>
      </div>
      <p id="notifyContinuousError" class="field-error" aria-live="polite"></p>
    </div>

    <div class="button-row">
      <button id="back">< Back</button>
      <button id="next">Next ></button>
    </div>
  `;

  const back = document.getElementById("back");
  if (back instanceof HTMLButtonElement) {
    back.onclick = prevStep;
  }

  const next = document.getElementById("next");
  if (next instanceof HTMLButtonElement) {
    next.onclick = async () => {
      const notifyDailyToggle = document.getElementById("notifyDailyToggle");
      const notifyDailyDuration = document.getElementById("notifyDailyDuration");
      const notifyContinuousToggle = document.getElementById("notifyContinuousToggle");
      const notifyContinuousDuration = document.getElementById("notifyContinuousDuration");

      if (
        !(
          notifyDailyToggle instanceof HTMLInputElement &&
          notifyDailyDuration instanceof HTMLInputElement &&
          notifyContinuousToggle instanceof HTMLInputElement &&
          notifyContinuousDuration instanceof HTMLInputElement
        )
      ) {
        return;
      }

      const updateToggleState = (
        toggle: HTMLInputElement,
        input: HTMLInputElement,
        errorId: string,
        label: string,
      ): boolean => {
        input.disabled = !toggle.checked;
        if (!toggle.checked) {
          setInputValidityState(input, false);
          setFieldError(errorId, "");
          return true;
        }
        return validateDurationField(input, errorId, label) !== null;
      };

      if (
        !updateToggleState(notifyDailyToggle, notifyDailyDuration, "notifyDailyError", "Daily reminder") ||
        !updateToggleState(notifyContinuousToggle, notifyContinuousDuration, "notifyContinuousError", "Continuous reminder")
      ) {
        return;
      }

      await browser.storage.sync.set({
        "settings:notification:daily": {
          enabled: notifyDailyToggle.checked,
          minutes: sanitizeDurationField(notifyDailyDuration, 45),
        },
        "settings:notification:continuous": {
          enabled: notifyContinuousToggle.checked,
          minutes: sanitizeDurationField(notifyContinuousDuration, 15),
        },
      });
      nextStep();
    };
  }

  const notifyDailyToggle = document.getElementById("notifyDailyToggle");
  const notifyDailyDuration = document.getElementById("notifyDailyDuration");
  const notifyContinuousToggle = document.getElementById("notifyContinuousToggle");
  const notifyContinuousDuration = document.getElementById("notifyContinuousDuration");

  if (
    notifyDailyToggle instanceof HTMLInputElement &&
    notifyDailyDuration instanceof HTMLInputElement &&
    notifyContinuousToggle instanceof HTMLInputElement &&
    notifyContinuousDuration instanceof HTMLInputElement
  ) {
    const syncDurationState = (
      toggle: HTMLInputElement,
      input: HTMLInputElement,
      errorId: string,
      label: string,
    ): void => {
      input.disabled = !toggle.checked;
      if (!toggle.checked) {
        setInputValidityState(input, false);
        setFieldError(errorId, "");
      } else {
        void validateDurationField(input, errorId, label);
      }
    };

    notifyDailyToggle.addEventListener("change", () => {
      syncDurationState(notifyDailyToggle, notifyDailyDuration, "notifyDailyError", "Daily reminder");
    });
    notifyContinuousToggle.addEventListener("change", () => {
      syncDurationState(notifyContinuousToggle, notifyContinuousDuration, "notifyContinuousError", "Continuous reminder");
    });

    notifyDailyDuration.addEventListener("input", () => {
      if (notifyDailyToggle.checked) {
        void validateDurationField(notifyDailyDuration, "notifyDailyError", "Daily reminder");
      }
    });
    notifyContinuousDuration.addEventListener("input", () => {
      if (notifyContinuousToggle.checked) {
        void validateDurationField(notifyContinuousDuration, "notifyContinuousError", "Continuous reminder");
      }
    });

    syncDurationState(notifyDailyToggle, notifyDailyDuration, "notifyDailyError", "Daily reminder");
    syncDurationState(
      notifyContinuousToggle,
      notifyContinuousDuration,
      "notifyContinuousError",
      "Continuous reminder",
    );
  }
}
// ---- STEP 2 ----
function renderBlocks(): void {
  wizard.innerHTML = `
    <h2>Step 2 - Blocks</h2>
    <p class="description">Set time limits or and blockers for your sessions.</p>

      <label class="radio-option">
        <input type="checkbox" id="blockToggle">
        <span>Daily time limit (minutes) - restrict AI access after a time limit (we will remind you 5 minutes prior)</span>
      </label>
      <div class="sub-option">
        <span>Block after (minutes)</span>
        <input type="number" id="timeLimit" min="5" max="600" value="60" />
      </div>
      <p id="timeLimitError" class="field-error" aria-live="polite"></p>
    </div>
    <label class="radio-option">
        <input type="checkbox" id="fixedBlockToggle">
        <span>Daily time limit (minutes) - restrict AI access during set times (we will remind you 5 minutes prior)</span>
      </label>
      <div class="sub-option">
        <span>Block after (minutes)</span>
        <input type="time" id="blockStart" /> <span>to</span>
          <input type="time" id="blockEnd" />
      </div>
      <p id="fixedBlockError" class="field-error" aria-live="polite"></p>
    </div>

    <div class="button-row">
      <button id="back">< Back</button>
      <button id="next">Next ></button>
    </div>
  `;

  const blockToggle = document.getElementById("blockToggle");
  const timeLimitInput = document.getElementById("timeLimit");

  const fixedBlockToggle = document.getElementById("fixedBlockToggle");
  const blockStart = document.getElementById("blockStart");
  const blockEnd = document.getElementById("blockEnd");

  if (
    !(blockToggle instanceof HTMLInputElement) ||
    !(timeLimitInput instanceof HTMLInputElement) ||
    !(fixedBlockToggle instanceof HTMLInputElement) ||
    !(blockStart instanceof HTMLInputElement) ||
    !(blockEnd instanceof HTMLInputElement)
  ) {
    throw new Error("Missing block configuration inputs");
  }

  blockToggle.addEventListener("change", () => {
    timeLimitInput.disabled = !blockToggle.checked;
    if (!blockToggle.checked) {
      setInputValidityState(timeLimitInput, false);
      setFieldError("timeLimitError", "");
    }
  });
  timeLimitInput.disabled = !blockToggle.checked;
  fixedBlockToggle.addEventListener("change", () => {
    blockStart.disabled = !fixedBlockToggle.checked;
    blockEnd.disabled = !fixedBlockToggle.checked;
    if (!fixedBlockToggle.checked) {
      setInputValidityState(blockStart, false);
      setInputValidityState(blockEnd, false);
      setFieldError("fixedBlockError", "");
    }
  });
  blockStart.disabled = !fixedBlockToggle.checked;
  blockEnd.disabled = !fixedBlockToggle.checked;

  const back = document.getElementById("back");
  if (back instanceof HTMLButtonElement) {
    back.onclick = prevStep;
  }

  const next = document.getElementById("next");
  if (next instanceof HTMLButtonElement) {
    next.onclick = async () => {
      const blockEnabled = blockToggle.checked;
      const fixedBlockEnabled = fixedBlockToggle.checked;
      let hasError = false;

      if (blockEnabled && validateDurationField(timeLimitInput, "timeLimitError", "Daily time limit") === null) {
        hasError = true;
      } else if (!blockEnabled) {
        setInputValidityState(timeLimitInput, false);
        setFieldError("timeLimitError", "");
      }

      if (fixedBlockEnabled) {
        setFieldError("fixedBlockError", "");
        const start = blockStart.value;
        const end = blockEnd.value;

        if (!start || !end) {
          setInputValidityState(blockStart, !start);
          setInputValidityState(blockEnd, !end);
          setFieldError("fixedBlockError", "Start and end times are required.");
          hasError = true;
        } else if (timeToMinutes(end) <= timeToMinutes(start)) {
          setInputValidityState(blockStart, true);
          setInputValidityState(blockEnd, true);
          setFieldError("fixedBlockError", "End time must be after start time.");
          hasError = true;
        } else {
          setInputValidityState(blockStart, false);
          setInputValidityState(blockEnd, false);
        }
      } else {
        setInputValidityState(blockStart, false);
        setInputValidityState(blockEnd, false);
        setFieldError("fixedBlockError", "");
      }

      if (hasError) {
        return;
      }

      const minutes = sanitizeDurationField(timeLimitInput, 60);

      await browser.storage.sync.set({
        "settings:timeLimit": {
          enabled: blockEnabled,
          minutes,
        },
      });

      if (fixedBlockEnabled) {
        await browser.storage.sync.set({
          "settings:block:fixed": [`${blockStart.value};${blockEnd.value}`],
        });
      }
      nextStep();
    };
  }

  timeLimitInput.addEventListener("input", () => {
    if (blockToggle.checked) {
      void validateDurationField(timeLimitInput, "timeLimitError", "Daily time limit");
    }
  });
  const validateFixedBlockTimes = () => {
    if (!fixedBlockToggle.checked) return;
    const start = blockStart.value;
    const end = blockEnd.value;
    setFieldError("fixedBlockError", "");
    if (!start || !end) return;
    if (timeToMinutes(end) <= timeToMinutes(start)) {
      setInputValidityState(blockStart, true);
      setInputValidityState(blockEnd, true);
      setFieldError("fixedBlockError", "End time must be after start time.");
      return;
    }
    setInputValidityState(blockStart, false);
    setInputValidityState(blockEnd, false);
  };
  blockStart.addEventListener("input", validateFixedBlockTimes);
  blockEnd.addEventListener("input", validateFixedBlockTimes);
}

// ---- STEP 3 ----
function renderPlatforms(): void {
  wizard.innerHTML = `
    <h2>Step 3 - Choose platforms to track</h2>
    <p class="description">Select which AI chat services Deprompt should monitor.</p>

    <div id="alt-radio-group">
      ${ONBOARDING_PROVIDERS.map(
        ([key, label]) => `
        <label class="alt-radio-option">
          <input type="checkbox" name="${key}" checked>
          <span>${label}</span>
        </label>`,
      ).join("")}
    </div>
    <p id="platformsError" class="field-error" aria-live="polite"></p>

    <div class="button-row">
      <button id="back">< Back</button>
      <button id="next">Finish ></button>
    </div>
  `;

  const back = document.getElementById("back");
  if (back instanceof HTMLButtonElement) {
    back.onclick = prevStep;
  }
  const next = document.getElementById("next");
  if (next instanceof HTMLButtonElement) {
    next.onclick = async () => {
      const providers: ProviderSelections = {};
      const checkboxes = document.querySelectorAll<HTMLInputElement>('#alt-radio-group input[type="checkbox"]');
      const hasSelection = Array.from(checkboxes).some((cb) => cb.checked);
      setFieldError("platformsError", hasSelection ? "" : "Select at least one platform.");
      if (!hasSelection) return;

      checkboxes.forEach((cb) => {
        providers[cb.name] = cb.checked;
      });
      await browser.storage.sync.set({ "settings:providers": providers });
      nextStep();
    };
  }

  const group = wizard.querySelector("#alt-radio-group");
  if (!(group instanceof HTMLElement)) return;

  group.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.type !== "checkbox") return;
    setFieldError("platformsError", "");
    const platform = target.name;
    if (!platform) return;
    const isChecked = target.checked;

    browser.storage.sync
      .get("settings:providers")
      .then((data) => {
        const stored = (data["settings:providers"] ?? {}) as ProviderSelections;
        stored[platform] = isChecked;
        return browser.storage.sync.set({ "settings:providers": stored });
      })
      .catch((err) => console.error("Failed to persist provider change", err));
  });
}

// ---- STEP 4 ----
function renderFinish(): void {
  wizard.innerHTML = `
    <div class="finished-image">
      <img src="assets/finished.png" style="width: 200px; height: 200px" alt="finished marker" /> 
    </div> 
    <h2>Setup Complete 🎉</h2>
    <p class="description">You’re all set! Deprompt will start tracking according to your preferences.</p>
    <p class="description">You may close this page.</p>

  `;

  void browser.storage.local.set({ firstTimeSetupComplete: true });
}

function nextStep(): void {
  step = Math.min(step + 1, steps.length - 1);
  const renderer = steps[step];
  if (renderer) renderer();
}
function prevStep(): void {
  step = Math.max(step - 1, 0);
  const renderer = steps[step];
  if (renderer) renderer();
}

const initialRenderer = steps[step];
if (initialRenderer) initialRenderer();
