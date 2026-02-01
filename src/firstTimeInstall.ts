import browser from "webextension-polyfill";
import { ONBOARDING_PROVIDERS } from "./constants.js";
import type { ProviderSelections, StepRenderer } from "./types.js";

const wizardEl = document.getElementById("wizard");
if (!(wizardEl instanceof HTMLElement)) {
  throw new Error("Wizard container element not found");
}
const wizard = wizardEl;
let step = 0;

const steps: StepRenderer[] = [renderNotifications, renderBlocks, renderPlatforms, renderFinish];

// ---- STEP 1 ----
function renderNotifications(): void {
  wizard.innerHTML = `
    <h2>Step 1 - Notifications</h2>
    <p class="description">Set reminders for your sessions.</p>

      <label class="radio-option">
        <input type="checkbox" id="notifyDailyToggle" checked>
        <span>Notify (Daily) - remind you after a set time of daily usage</span>
      </label>
      <div class="sub-option">
        <span>After</span>
        <input type="number" id="notifyDailyDuration" min="5" max="600" value="45" />
        <span>minutes</span>
      </div>
      <label class="radio-option">
        <input type="checkbox" id="notifyContinuousToggle" checked>
        <span>Notify (Continuous) - remind you after a set time of continuous usage</span>
      </label>
      <div class="sub-option">
        <span>After</span>
        <input type="number" id="notifyContinuousDuration" min="5" max="600" value="15" />
        <span>minutes</span>
      </div>
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

      await browser.storage.sync.set({
        "settings:notification:daily": {
          enabled: notifyDailyToggle.checked,
          minutes: Number(notifyDailyDuration.value),
        },
        "settings:notification:continuous": {
          enabled: notifyContinuousToggle.checked,
          minutes: Number(notifyContinuousDuration.value),
        },
      });
      nextStep();
    };
  }
}
// ---- STEP 2 ----
function renderBlocks(): void {
  wizard.innerHTML = `
    <h2>Step 2 - Blocks</h2>
    <p class="description">Set time limits or and blockers for your sessions.</p>

      <label class="radio-option">
        <input type="checkbox" id="blockToggle" checked>
        <span>Daily time limit (minutes) - restrict AI access after a time limit (we will remind you 5 minutes prior)</span>
      </label>
      <div class="sub-option">
        <span>Block after (minutes)</span>
        <input type="number" id="timeLimit" min="5" max="600" value="60" />
      </div>
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
    </div>

    <div class="button-row">
      <button id="back">< Back</button>
      <button id="next">Next ></button>
    </div>
  `;

  const blockToggle = document.getElementById("blockToggle");
  const timeLimitInput = document.getElementById("timeLimit");

  const fixedBlockToggle = document.getElementById("fixedBlockToggle");

  if (
    !(blockToggle instanceof HTMLInputElement) ||
    !(timeLimitInput instanceof HTMLInputElement) ||
    !(fixedBlockToggle instanceof HTMLInputElement)
  ) {
    throw new Error("Missing block configuration inputs");
  }

  blockToggle.addEventListener("change", () => {
    timeLimitInput.disabled = !blockToggle.checked;
  });
  timeLimitInput.disabled = !blockToggle.checked;

  const back = document.getElementById("back");
  if (back instanceof HTMLButtonElement) {
    back.onclick = prevStep;
  }

  const next = document.getElementById("next");
  if (next instanceof HTMLButtonElement) {
    next.onclick = async () => {
      const blockEnabled = blockToggle.checked;
      const fixedBlockEnabled = fixedBlockToggle.checked;
      const minutes = Math.max(1, Number(timeLimitInput.value) || 0);

      await browser.storage.sync.set({
        "settings:timeLimit": {
          enabled: blockEnabled,
          minutes,
        },
      });

      if (fixedBlockEnabled) {
        const blockStart = document.getElementById("blockStart");
        const blockEnd = document.getElementById("blockEnd");

        if (blockStart instanceof HTMLInputElement || blockEnd instanceof HTMLInputElement) {
          if ((blockStart as HTMLInputElement).value || (blockEnd as HTMLInputElement).value) {
            await browser.storage.sync.set({
              "settings:block:fixed": [
                `${(blockStart as HTMLInputElement).value};${(blockEnd as HTMLInputElement).value}`,
              ],
            });
          }
        }
      }
      nextStep();
    };
  }
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
