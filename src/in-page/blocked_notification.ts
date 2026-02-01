import browser from "webextension-polyfill";
import { BLOCKER_CONTENT_SCRIPT } from "../constants.js";
(async () => {
  const popupId = BLOCKER_CONTENT_SCRIPT.js_flag;
  if (document.getElementById(popupId)) return;

  const response = await fetch(browser.runtime.getURL(BLOCKER_CONTENT_SCRIPT.html));
  const htmlContent = await response.text();

  const container = document.createElement("div");

  container.innerHTML = htmlContent;

  document.body.appendChild(container.firstElementChild as Node);

  const popupOuter = document.getElementById(popupId);
  if (!(popupOuter instanceof HTMLElement)) {
    console.warn("Deprompt: block popup root missing after injection");
    return;
  }

  const closeBtn = document.getElementById("close");
  const toggleBtn = document.getElementById("toggleBlock");

  popupOuter.style.opacity = "1";

  closeBtn?.addEventListener("click", () => {
    console.log("Deprompt: close block popup clicked");
    void browser.runtime.sendMessage({ action: "CLOSE_TAB" });
    popupOuter.remove();
  });

  toggleBtn?.addEventListener("click", () => {
    console.log("Deprompt: toggle block clicked");
    void browser.runtime.sendMessage({ action: "TOGGLE_BLOCK" });
    popupOuter.remove();
  });
})();
