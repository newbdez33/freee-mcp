import { createHash } from "node:crypto";

import type { ClockAction } from "./attendance.js";
import type { UnifiedClockStatus } from "./service.js";

export function createClockActionFingerprint(
  status: UnifiedClockStatus,
  action: ClockAction,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, action, status }))
    .digest("hex");
}
