import assert from "node:assert/strict";
import test from "node:test";

import { FreeeClient } from "../dist/client.js";

test("time clock creation sends the documented body and bearer token", async () => {
  let captured;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return new Response(
      JSON.stringify({ employee_time_clock: { id: 7, type: "clock_in" } }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };
  const client = new FreeeClient("test-token", "https://example.test/api/v1", fakeFetch);

  const result = await client.createTimeClock(22, {
    companyId: 11,
    type: "clock_in",
    baseDate: "2026-08-10",
  });

  assert.equal(captured.url, "https://example.test/api/v1/employees/22/time_clocks");
  assert.equal(captured.init.method, "POST");
  assert.equal(captured.init.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(captured.init.body), {
    company_id: 11,
    type: "clock_in",
    base_date: "2026-08-10",
  });
  assert.equal(result.employee_time_clock.id, 7);
});

test("API errors expose status and safe fields, never the bearer token", async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ message: "not allowed", access_token: "leaked-value" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  const client = new FreeeClient("test-token", "https://example.test/api/v1", fakeFetch);

  await assert.rejects(client.getCurrentUser(), (error) => {
    assert.equal(error.code, "FREEE_API_ERROR");
    assert.deepEqual(error.details, { message: "not allowed" });
    assert.equal(JSON.stringify(error).includes("test-token"), false);
    assert.equal(JSON.stringify(error).includes("leaked-value"), false);
    return true;
  });
});

test("a 401 refreshes credentials and retries the API request exactly once", async () => {
  const authorizations = [];
  let refreshCount = 0;
  const credentials = {
    source: "system",
    async getAccessToken() {
      return "old-access";
    },
    async refreshAccessToken() {
      refreshCount += 1;
      return "new-access";
    },
  };
  const fakeFetch = async (_url, init) => {
    authorizations.push(init.headers.Authorization);
    if (authorizations.length === 1) {
      return new Response(JSON.stringify({ code: "expired_access_token" }), { status: 401 });
    }
    return new Response(JSON.stringify({ id: 1, companies: [] }), { status: 200 });
  };
  const client = new FreeeClient(credentials, "https://example.test/api/v1", fakeFetch);

  assert.equal((await client.getCurrentUser()).id, 1);
  assert.equal(refreshCount, 1);
  assert.deepEqual(authorizations, ["Bearer old-access", "Bearer new-access"]);
});

test("employee group memberships are fully paginated with non-payroll employees included", async () => {
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(url);
    const offset = new URL(url).searchParams.get("offset");
    return new Response(
      JSON.stringify({
        employee_group_memberships: offset === "0" ? [{ id: 1 }, { id: 2 }] : [{ id: 3 }],
        total_count: 3,
      }),
      { status: 200 },
    );
  };
  const client = new FreeeClient("test-token", "https://example.test/api/v1", fakeFetch);

  const memberships = await client.listEmployeeGroupMemberships(11, "2026-08-10");

  assert.deepEqual(memberships.map((membership) => membership.id), [1, 2, 3]);
  assert.equal(urls.length, 2);
  assert.equal(
    urls[0],
    "https://example.test/api/v1/employee_group_memberships?company_id=11&base_date=2026-08-10&with_no_payroll_calculation=true&limit=100&offset=0",
  );
  assert.match(urls[1], /offset=2$/);
});

test("employee time clocks use a one-day range and pagination parameters", async () => {
  let captured;
  const fakeFetch = async (url) => {
    captured = url;
    return new Response(JSON.stringify([{ id: 1, type: "clock_in" }]), { status: 200 });
  };
  const client = new FreeeClient("test-token", "https://example.test/api/v1", fakeFetch);

  const clocks = await client.listEmployeeTimeClocks(22, 11, "2026-08-10", "2026-08-10");

  assert.equal(clocks.length, 1);
  assert.equal(
    captured,
    "https://example.test/api/v1/employees/22/time_clocks?company_id=11&from_date=2026-08-10&to_date=2026-08-10&limit=100&offset=0",
  );
});
