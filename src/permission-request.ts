import browser from "webextension-polyfill";

const origin = new URLSearchParams(location.search).get("origin");

if (!origin) {
  window.close();
} else {
  const originEl = document.getElementById("origin");
  if (originEl) originEl.textContent = origin;

  document.getElementById("allowBtn")?.addEventListener("click", async () => {
    let granted = false;
    try {
      granted = await browser.permissions.request({ origins: [origin] });
    } catch (err) {
      console.error("Deprompt: permission request failed", err);
    }
    await browser.runtime.sendMessage({ type: "permissionResult", granted, origin });
    window.close();
  });
}
