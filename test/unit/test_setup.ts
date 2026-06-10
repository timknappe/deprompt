// setup.ts
import { GlobalWindow } from "happy-dom";
import chrome from "sinon-chrome";

// 1. Emulate a complete browser DOM environment in Node/Bun global scope
const window = new GlobalWindow({
  url: "chrome-extension://mock-extension-id/_generated_background_page.html",
});

// Bind critical browser globals to Bun's global context
globalThis.window = window as any;
globalThis.document = window.document as any;
globalThis.navigator = window.navigator as any;
globalThis.Location = window.Location as any;
globalThis.location = window.location as any;
// happy-dom does not expose DOM constructors as bare globals; bind the ones
// our app code references (instanceof checks, event constructors, etc.).
(globalThis as any).HTMLElement = window.HTMLElement;
(globalThis as any).HTMLInputElement = window.HTMLInputElement;
(globalThis as any).HTMLButtonElement = window.HTMLButtonElement;
(globalThis as any).HTMLFormElement = window.HTMLFormElement;
(globalThis as any).Event = window.Event;

// 2. Inject the sinon-chrome mock engine into the global space
// The polyfill checks for `chrome.runtime.id` at load time, so we must
// ensure it exists before requiring it.
(chrome.runtime as any).id = "mock-extension-id";
globalThis.chrome = chrome as any;

/**
 * 3. Initialize the webextension-polyfill.
 * We must use `require` here because it needs to evaluate *after* the global
 * `chrome` and `window` objects have been explicitly attached above.
 */
const webExtensionPolyfill = require("webextension-polyfill");
globalThis.browser = webExtensionPolyfill;

// 4. Clean up mock tracking state automatically between every individual test run
import { beforeEach } from "bun:test";

beforeEach(() => {
  // Reset interaction histories
  chrome.runtime.sendMessage.resetHistory();
  chrome.runtime.onMessage.addListener.resetHistory();

  chrome.storage.local.get.resetHistory();
  chrome.storage.local.set.resetHistory();
  chrome.storage.local.clear.resetHistory();

  chrome.tabs.query.resetHistory();
  chrome.tabs.sendMessage.resetHistory();

  // Clear any stubbed/yielded return configurations to avoid test leakage
  chrome.runtime.sendMessage.flush();
  chrome.storage.local.get.flush();
  chrome.tabs.query.flush();

  // Clear the virtual happy-dom document body if elements were injected
  window.document.body.innerHTML = "";
});
