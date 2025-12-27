# Browser Storage Key Scheme

`<provider>` placeholders are one of the ids listed at the end of the file.

## Sync storage (browser.storage.sync)

### Usage counters (milliseconds)

| Key pattern                   | Type        | Description                                                                  |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------- |
| `daily:YYYY-MM-DD:<provider>` | number (ms) | Daily accumulated usage for the provider.                                    |
| `week:YYYY-MM-DD:<provider>`  | number (ms) | Weekly accumulated usage; week starts per Day.js locale (Sunday by default). |
| `month:YYYY-MM:<provider>`    | number (ms) | Monthly accumulated usage.                                                   |
| `year:YYYY:<provider>`        | number (ms) | Yearly accumulated usage.                                                    |
| `alltime:<provider>`          | number (ms) | Lifetime accumulated usage.                                                  |

### Rollup indexes

| Key                        | Type                    | Description                                           |
| -------------------------- | ----------------------- | ----------------------------------------------------- |
| `index:daily:<provider>`   | string[] (`YYYY-MM-DD`) | Dates that have daily usage entries for the provider. |
| `index:weekly:<provider>`  | string[] (`YYYY-MM-DD`) | Week-start dates that have weekly usage entries.      |
| `index:monthly:<provider>` | string[] (`YYYY-MM`)    | Months that have monthly usage entries.               |

### Meta (sync)

| Key                          | Type                          | Description                                                             |
| ---------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `meta:lastTick`              | number (ms)                   | Timestamp of the last rollover check.                                   |
| `meta:lastReminder`          | number (ms)                   | Timestamp of the most recent reminder (read when scheduling reminders). |
| `meta:runtime:lastPersisted` | number (ms)                   | Last timestamp flushed into usage buckets for the active session.       |
| `meta:userSnooze`            | string (`YYYY-MM-DD`) or null | Day the user snoozed notifications/blocks for.                          |

### User settings

| Key                                | Type                                                             | Description                                          |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------- |
| `settings:timeLimit`               | `{ enabled: boolean; minutes: number }` (legacy: number minutes) | Daily time limit configuration.                      |
| `settings:notification:daily`      | `{ enabled: boolean; minutes: number }`                          | Daily usage reminder configuration.                  |
| `settings:notification:continuous` | `{ enabled: boolean; minutes: number }`                          | Continuous usage reminder configuration.             |
| `settings:block:fixed`             | string[] entries `HH:MM;HH:MM`                                   | Fixed block windows.                                 |
| `settings:block:manual`            | boolean                                                          | Manual block toggle state.                           |
| `settings:providers`               | Record\<string, boolean>                                         | Provider tracking preferences by id.                 |
| `settings:formatting:showSeconds`  | boolean                                                          | Whether to render time with seconds.                 |
| `settings:toggle:togglesReminders` | boolean                                                          | Whether to toggle just for blocks or also reminders. |

## Local storage (browser.storage.local)

| Key                      | Type        | Description                                           |
| ------------------------ | ----------- | ----------------------------------------------------- |
| `meta:runtime:provider`  | string      | Provider currently being timed.                       |
| `meta:runtime:start`     | number (ms) | Session start time for the active provider.           |
| `lastHeartbeat`          | number (ms) | Timestamp of the last heartbeat from content scripts. |
| `meta:userToggleStamp`   | number (ms) | Until-when timestamp for a temporary unblock toggle.  |
| `firstTimeSetupComplete` | boolean     | Onboarding completion flag.                           |

## Provider ids

- openai
- anthropic
- gemini
- copilot
- poe
- perplexity
- pi
- reka
- mistral
- grok
- qwen
- meta
