import { build } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from "url";
import { dirname, resolve as R } from "path";
import { existsSync } from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1. Files for HTML pages (MPA entry points)
const HTML_INPUTS = {
  popup: R(__dirname, "src/in-page/popup.html"),
  options: R(__dirname, "src/options.html"),
  dashboard: R(__dirname, "src/dashboard.html"),
  firstTimeInstall: R(__dirname, "src/firstTimeInstall.html"),
  reminder: R(__dirname, "src/in-page/reminder.html"),
  blockedNotification: R(__dirname, "src/in-page/blocked_notification.html"),
};

// 2. Scripts injected dynamically via browser.scripting.executeScript()
// These MUST be output as IIFE.
const INJECTED_SCRIPTS = {
  reminder: R(__dirname, "src/in-page/reminder.ts"),
  blockedNotification: R(__dirname, "src/in-page/blocked_notification.ts"),
};

// 3. Explicit CSS inputs to ensure they are bundled and placed correctly.
const CSS_INPUTS = {
  blockedNotification: R(__dirname, "src/in-page/blocked_notification.css"),
  reminder: R(__dirname, "src/in-page/reminder.css"),
};

// build.mjs
function copyTargets(version) {
  const targets = [
    { src: "../assets", dest: "." },

    { src: "in-page/blocked_notification.html", dest: "in-page" },
    { src: "in-page/reminder.html", dest: "in-page" },

    { src: "*.css", dest: "." },
  ];

  const manifestPath = R(__dirname, `manifest.${version}.json`);
  if (existsSync(manifestPath)) {
    targets.push({
      src: `../manifest.${version}.json`,
      dest: ".",
      rename: () => "manifest.json",
    });
  } else {
    console.warn(`Manifest file manifest.${version}.json not found. Skipping.`);
  }

  return targets;
}

// Function to determine if a file should go into the 'in-page/' folder
function isInPageFile(name) {
  return name.includes("reminder") || name.includes("blockedNotification");
}

async function run() {
  // --- MV3 BUILD ---
  console.log("▶ MV3 pages and background (ES, MPA)...");
  await build({
    root: "src",
    appType: "mpa",
    build: {
      outDir: "../dist-v3",
      emptyOutDir: true,
      rollupOptions: {
        // MERGED HTML and CSS inputs
        input: {
          ...HTML_INPUTS,
          ...CSS_INPUTS,
          backgroundWorker: R(__dirname, "src/backgroundWorker.js"),
        },
        output: {
          format: "es",
          // Route specific JS files to 'in-page/'
          entryFileNames: (chunkInfo) => {
            if (isInPageFile(chunkInfo.name)) {
              return `in-page/[name].js`;
            }
            return "[name].js";
          },
          chunkFileNames: "[name].js",
          // Route specific CSS files to 'in-page/'
          assetFileNames: (assetInfo) => {
            if (
              assetInfo.name &&
              assetInfo.name.endsWith(".css") &&
              isInPageFile(assetInfo.name)
            ) {
              // Note: Rollup/Vite automatically renames the input 'blockedNotificationCss'
              // to 'blocked_notification.css' for the output file.
              return `in-page/[name].[ext]`;
            }
            return "[name].[ext]";
          },
        },
        // FIX: Exclude native Node modules like 'fsevents' which fail compilation.
        external: ["fsevents"],
      },
    },
    plugins: [viteStaticCopy({ targets: copyTargets("v3") })],
  });

  // FIX: Build injected scripts sequentially.
  // We use 'es' format (to support TLA) and manually wrap the output
  // with an async IIFE using banner/footer to ensure it executes correctly
  // when injected via browser.scripting.executeScript({ files: [...] }).
  console.log("▶ MV3 dynamic content injection scripts (Async IIFE Fix)...");

  for (const [name, entryPath] of Object.entries(INJECTED_SCRIPTS)) {
    console.log(`  - Building ${name}...`);
    await build({
      root: "src",
      appType: "custom",
      build: {
        outDir: "../dist-v3",
        emptyOutDir: false, // Important: Don't wipe the previous steps
        rollupOptions: {
          input: { [name]: entryPath }, // Single input per build
          output: {
            format: "es", // 'es' supports Top-Level Await
            // Output these injected scripts directly into 'in-page/'
            entryFileNames: "in-page/[name].js", // <-- UPDATED
            inlineDynamicImports: true, // Ensure single file output
            // Manually wrap the entire ES output in an async IIFE
            banner: "(async () => {",
            footer: "})();",
          },
        },
      },
    });
  }

  console.log("✅ All builds complete!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
