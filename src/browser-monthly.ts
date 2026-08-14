import { createHash } from "node:crypto";

import type { BrowserApprovalDetail, BrowserApprovalSummary } from "./browser-approvals.js";
import { CliError } from "./errors.js";

export type BrowserMonthlyAction = "submit" | "withdraw";
export type BrowserMonthlyState = "unsubmitted" | "pending" | "approved" | "returned";

export interface BrowserMonthlyStatus {
  period: string;
  periodLabel: string;
  state: BrowserMonthlyState;
  statusLabel: string;
  warnings: string[];
  application: BrowserApprovalSummary | null;
  availableActions: BrowserMonthlyAction[];
}

export interface BrowserMonthlySubmitForm {
  targetMonth: string;
  route: string;
  routeOptions: string[];
  approvalSteps: Array<{ headers: string[]; rows: string[][] }>;
  checks: string[];
}

export interface BrowserMonthlyPreview {
  status: BrowserMonthlyStatus;
  submitForm?: BrowserMonthlySubmitForm;
  applicationDetail?: BrowserApprovalDetail;
}

export interface MonthlyCalendarSnapshot {
  periodLabels: string[];
  statusLabels: string[];
  warnings: string[];
  createActionCount: number;
}

const monthlyStatusMap = new Map<string, BrowserMonthlyState>([
  ["未申請", "unsubmitted"],
  ["未承認", "pending"],
  ["申請中", "pending"],
  ["承認済", "approved"],
  ["差戻し", "returned"],
]);

export function selectMonthlyStatusLabels(scopeTexts: string[]): string[] {
  for (const scopeText of scopeTexts) {
    const labels = Array.from(
      new Set(scopeText.match(/未申請|未承認|申請中|承認済|差戻し/g) ?? []),
    );
    if (labels.length > 0) {
      return labels;
    }
  }
  return [];
}

export function parseMonthlyCalendarSnapshot(
  snapshot: MonthlyCalendarSnapshot,
  requestedPeriod?: string,
): Omit<BrowserMonthlyStatus, "application"> {
  const periodLabels = [...new Set(snapshot.periodLabels)];
  if (periodLabels.length !== 1 || !periodLabels[0]) {
    throw new CliError(
      "BROWSER_MONTHLY_PERIOD_AMBIGUOUS",
      "The freee attendance calendar did not expose one unambiguous monthly period.",
      { details: { periodLabels }, exitCode: 2 },
    );
  }
  const periodLabel = periodLabels[0];
  const match = periodLabel.match(
    /[（(]\s*(20\d{2})年(\d{1,2})月\d{1,2}日\s*[〜～-]\s*20\d{2}年\d{1,2}月\d{1,2}日\s*勤務分\s*[）)]/,
  );
  if (!match) {
    throw new CliError(
      "BROWSER_MONTHLY_PERIOD_AMBIGUOUS",
      "The freee attendance calendar period no longer matches the supported schema.",
      { details: { periodLabels }, exitCode: 2 },
    );
  }
  const period = `${match[1]}-${String(Number(match[2])).padStart(2, "0")}`;
  if (requestedPeriod && requestedPeriod !== period) {
    throw new CliError(
      "BROWSER_MONTHLY_PERIOD_UNSUPPORTED",
      "The Playwright monthly workflow currently supports only the month selected in freee.",
      { details: { requestedPeriod, selectedPeriod: period }, exitCode: 2 },
    );
  }

  const labels = [...new Set(snapshot.statusLabels)].filter((label) => monthlyStatusMap.has(label));
  if (labels.length !== 1 || !labels[0]) {
    throw new CliError(
      "BROWSER_MONTHLY_PAGE_UNEXPECTED",
      "The freee attendance calendar did not expose one supported monthly submission status.",
      { details: { statusLabels: snapshot.statusLabels }, exitCode: 2 },
    );
  }
  const statusLabel = labels[0];
  const state = monthlyStatusMap.get(statusLabel)!;
  if (state === "unsubmitted" && snapshot.createActionCount !== 1) {
    throw new CliError(
      "BROWSER_MONTHLY_PAGE_UNEXPECTED",
      "The unsubmitted freee month did not expose one unique submission creation control.",
      { details: { createActionCount: snapshot.createActionCount }, exitCode: 2 },
    );
  }
  return {
    period,
    periodLabel,
    state,
    statusLabel,
    warnings: [...new Set(snapshot.warnings.map((warning) => warning.trim()))]
      .filter((warning) => warning.length > 0),
    availableActions: state === "unsubmitted"
      ? ["submit"]
      : state === "pending"
        ? ["withdraw"]
        : [],
  };
}

export function periodFromMonthlyTargetDate(targetDate: string | null): string | null {
  const match = targetDate?.match(/^(20\d{2})\/(\d{2})\/01$/);
  if (!match) {
    return null;
  }
  return `${match[1]}-${match[2]}`;
}

export function createMonthlyFingerprint(
  preview: BrowserMonthlyPreview,
  action: BrowserMonthlyAction,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, action, preview }))
    .digest("hex");
}
