import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { BLOCKER_CONTENT_SCRIPT, REMINDER_CONTENT_SCRIPT } from "../../src/constants.js";

type Recorded = { kind: "exec" | "css"; opts: any };
let recorded: Recorded[] = [];
let nextExecResults: Array<{ result?: unknown }> = [{ result: false }];

const fakeBrowser = {
  scripting: {
    executeScript: async (opts: any) => {
      recorded.push({ kind: "exec", opts });
      const out = nextExecResults;
      nextExecResults = [{ result: false }];
      return out;
    },
    insertCSS: async (opts: any) => {
      recorded.push({ kind: "css", opts });
    },
  },
};

mock.module("webextension-polyfill", () => ({
  default: fakeBrowser,
  ...fakeBrowser,
}));

const {
  isDepromptBlockCssLoaded,
  isDepromptReminderCssLoaded,
  isBlockPopupInjected,
  isReminderPopupInjected,
  ejectBlockPopup,
  ejectReminderPopup,
  injectBlockScreen,
  injectReminder,
} = await import("../../src/contentScripts.js");

beforeEach(() => {
  recorded = [];
  nextExecResults = [{ result: false }];
});

afterEach(() => {
  recorded = [];
});

describe("CSS-loaded checks", () => {
  test("isDepromptBlockCssLoaded returns true when stub yields true", async () => {
    nextExecResults = [{ result: true }];
    const ok = await isDepromptBlockCssLoaded(123);
    expect(ok).toBe(true);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.opts.target).toEqual({ tabId: 123 });
    expect(recorded[0]!.opts.args).toEqual([BLOCKER_CONTENT_SCRIPT.css_flag]);
  });

  test("isDepromptBlockCssLoaded returns false when stub yields false-ish", async () => {
    nextExecResults = [{ result: false }];
    expect(await isDepromptBlockCssLoaded(1)).toBe(false);
    nextExecResults = [];
    expect(await isDepromptBlockCssLoaded(1)).toBe(false);
  });

  test("isDepromptReminderCssLoaded passes the reminder css flag", async () => {
    nextExecResults = [{ result: true }];
    expect(await isDepromptReminderCssLoaded(7)).toBe(true);
    expect(recorded[0]!.opts.args).toEqual([REMINDER_CONTENT_SCRIPT.css_flag]);
  });
});

describe("popup injected checks", () => {
  test("isBlockPopupInjected passes the block js flag", async () => {
    nextExecResults = [{ result: true }];
    expect(await isBlockPopupInjected(42)).toBe(true);
    expect(recorded[0]!.opts.args).toEqual([BLOCKER_CONTENT_SCRIPT.js_flag]);
  });

  test("isReminderPopupInjected passes the reminder js flag", async () => {
    nextExecResults = [{ result: true }];
    expect(await isReminderPopupInjected(42)).toBe(true);
    expect(recorded[0]!.opts.args).toEqual([REMINDER_CONTENT_SCRIPT.js_flag]);
  });
});

describe("ejection", () => {
  test("ejectBlockPopup executes the block flag remover", async () => {
    await ejectBlockPopup(99);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.opts.args).toEqual([BLOCKER_CONTENT_SCRIPT.js_flag]);
  });

  test("ejectBlockPopup swallows errors from the scripting API", async () => {
    const original = fakeBrowser.scripting.executeScript;
    fakeBrowser.scripting.executeScript = async () => {
      throw new Error("nope");
    };
    await expect(ejectBlockPopup(1)).resolves.toBeUndefined();
    fakeBrowser.scripting.executeScript = original;
  });

  test("ejectReminderPopup executes the reminder flag remover", async () => {
    await ejectReminderPopup(99);
    expect(recorded[0]!.opts.args).toEqual([REMINDER_CONTENT_SCRIPT.js_flag]);
  });
});

describe("injection", () => {
  test("injectBlockScreen inserts CSS then JS when neither is loaded", async () => {
    // First call: CSS check -> false. Second call: popup-injected check -> false.
    // Then insertCSS, then executeScript (block content).
    let call = 0;
    const original = fakeBrowser.scripting.executeScript;
    fakeBrowser.scripting.executeScript = async (opts: any) => {
      recorded.push({ kind: "exec", opts });
      call += 1;
      // calls 1 and 2 are status checks -> false; call 3 is the actual injection
      return [{ result: false }];
    };
    await injectBlockScreen(11);
    fakeBrowser.scripting.executeScript = original;

    const cssCalls = recorded.filter((r) => r.kind === "css");
    const execCalls = recorded.filter((r) => r.kind === "exec");
    expect(cssCalls).toHaveLength(1);
    expect(cssCalls[0]!.opts.files).toEqual([BLOCKER_CONTENT_SCRIPT.css]);
    // 2 status checks + 1 actual file injection
    expect(execCalls).toHaveLength(3);
    expect(execCalls[2]!.opts.files).toEqual([BLOCKER_CONTENT_SCRIPT.javascript]);
    expect(call).toBe(3);
  });

  test("injectBlockScreen skips CSS and JS when already loaded", async () => {
    const original = fakeBrowser.scripting.executeScript;
    fakeBrowser.scripting.executeScript = async (opts: any) => {
      recorded.push({ kind: "exec", opts });
      return [{ result: true }];
    };
    await injectBlockScreen(12);
    fakeBrowser.scripting.executeScript = original;

    const cssCalls = recorded.filter((r) => r.kind === "css");
    const execCalls = recorded.filter((r) => r.kind === "exec");
    expect(cssCalls).toHaveLength(0);
    expect(execCalls).toHaveLength(2); // just the two status checks
  });

  test("injectReminder injects css, sets window.REMINDER_ARG, then injects js", async () => {
    const original = fakeBrowser.scripting.executeScript;
    fakeBrowser.scripting.executeScript = async (opts: any) => {
      recorded.push({ kind: "exec", opts });
      return [{ result: false }];
    };
    await injectReminder(33, "DailyUsageReminder");
    fakeBrowser.scripting.executeScript = original;

    const cssCalls = recorded.filter((r) => r.kind === "css");
    const execCalls = recorded.filter((r) => r.kind === "exec");
    expect(cssCalls[0]!.opts.files).toEqual([REMINDER_CONTENT_SCRIPT.css]);
    // 2 status checks + window-arg setter + js file injection
    expect(execCalls).toHaveLength(4);
    expect(execCalls[2]!.opts.args).toEqual(["DailyUsageReminder"]);
    expect(execCalls[3]!.opts.files).toEqual([REMINDER_CONTENT_SCRIPT.javascript]);
  });
});
