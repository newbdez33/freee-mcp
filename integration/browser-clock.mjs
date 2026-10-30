import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium } from "playwright";
import { FreeeBrowserClient } from "../dist/browser.js";
import { normalizePersonalApplicationCreateInput } from "../dist/browser-personal-applications.js";

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function withForm(options, run) {
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  try {
    await page.setContent('<form><textarea data-testid="申請理由"></textarea><button type="button">Next</button></form>');
    await page.evaluate(({ menuDelay = 0, commitDelay = 0, revert = false, ambiguous = false, disabled = false }) => {
      const form = document.querySelector("form");
      for (const [label, defaults] of [
        ["出勤時刻", ["09", "00"]], ["退勤時刻", ["18", "00"]],
        ["休憩開始時刻", ["", ""]], ["休憩終了時刻", ["", ""]],
      ]) {
        for (const [index, suffix] of ["時", "分"].entries()) {
          const input = document.createElement("input");
          input.setAttribute("role", "combobox");
          input.setAttribute("aria-label", `${label}_${suffix}`);
          const id = `options-${label}-${suffix}`;
          input.setAttribute("aria-controls", id);
          let committed = defaults[index];
          input.value = committed;
          form.insertBefore(input, form.lastElementChild);
          input.addEventListener("focus", () => {
            setTimeout(() => {
              if (document.activeElement !== input || document.getElementById(id)) return;
              const listbox = document.createElement("div");
              listbox.id = id;
              listbox.setAttribute("role", "listbox");
              for (let n = 0; n < (index === 0 ? 24 : 60); n += 1) {
                const value = String(n).padStart(2, "0");
                for (let copy = 0; copy < (ambiguous && value === "10" ? 2 : 1); copy += 1) {
                  const option = document.createElement("div");
                  option.setAttribute("role", "option");
                  if (disabled) option.setAttribute("aria-disabled", "true");
                  option.textContent = value;
                  option.addEventListener("click", () => {
                    input.value = value;
                    if (!revert && !disabled) {
                      setTimeout(() => { committed = value; input.value = value; }, commitDelay);
                    }
                  });
                  listbox.append(option);
                }
              }
              document.body.append(listbox);
            }, menuDelay);
          });
          input.addEventListener("blur", () => {
            input.value = committed;
            document.getElementById(id)?.remove();
          });
        }
      }
    }, options);
    const client = new FreeeBrowserClient({}, page, {}, {
      navigationTimeoutMs: 2000, interactionTimeoutMs: 1000,
    });
    client.selectApplicationDate = async () => {};
    client.readPersonalApplicationRoute = async () => "勤怠申請";
    client.captureDiagnosticScreenshot = async () => {};
    await run(client, page);
  } finally {
    await page.close();
  }
}

test("clock fields commit non-default hours and minutes after delayed menus and state updates", async () => {
  await withForm({ menuDelay: 250, commitDelay: 250 }, async (client, page) => {
    const requested = normalizePersonalApplicationCreateInput({
      kind: "work-time-correction", date: "2026-10-30",
      clockIn: "10:17", clockOut: "19:43", breakStart: "12:11", breakEnd: "13:23",
    });
    assert.equal(await client.fillWorkTimeCorrectionForm(requested), "勤怠申請");
    assert.deepEqual(await page.getByRole("combobox").evaluateAll((inputs) => inputs.map((input) => input.value)),
      ["10", "17", "19", "43", "12", "11", "13", "23"]);
  });
});

test("clock fields reject a displayed selection that reverts on blur", async () => {
  await withForm({ revert: true }, async (client) => {
    await assert.rejects(client.selectClockTime("出勤時刻", "10:17"),
      (error) => error.code === "PERSONAL_APPLICATION_TIME_UNAVAILABLE");
  });
});

test("clock fields reject duplicate and disabled options", async () => {
  for (const options of [{ ambiguous: true }, { disabled: true }]) {
    await withForm(options, async (client, page) => {
      await assert.rejects(client.selectClockTime("出勤時刻", "10:17"),
        (error) => error.code === "PERSONAL_APPLICATION_TIME_UNAVAILABLE");
      assert.equal(await page.getByRole("combobox", { name: "出勤時刻_時", exact: true }).inputValue(), "09");
    });
  }
});
