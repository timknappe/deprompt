declare module "*.css";

declare module "dayjs/plugin/isSameOrAfter";
declare module "dayjs/plugin/customParseFormat";
import type { Reminder } from "../types.js";

declare global {
  /**
   * Edit the global Window interface to include the dynamically injected property.
   */
  interface Window {
    REMINDER_ARG?: Reminder;
  }
}
