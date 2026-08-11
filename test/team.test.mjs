import assert from "node:assert/strict";
import test from "node:test";

import { getTeamStatus } from "../dist/team.js";

function createFakeApi({ employees, clocks = {} }) {
  const calls = [];
  return {
    calls,
    async getCurrentUser() {
      calls.push({ method: "getCurrentUser" });
      return {
        id: 1,
        companies: [{ id: 10, name: "Test company", employee_id: 100, display_name: "Manager" }],
      };
    },
    async listEmployeeGroupMemberships(companyId, date) {
      calls.push({ method: "listEmployeeGroupMemberships", companyId, date });
      return employees;
    },
    async listEmployeeTimeClocks(employeeId, companyId, fromDate, toDate) {
      calls.push({ method: "listEmployeeTimeClocks", employeeId, companyId, fromDate, toDate });
      return clocks[employeeId] ?? [];
    },
  };
}

const baseEmployees = [
  {
    id: 100,
    display_name: "Manager",
    group_memberships: [
      { group_id: 1, group_name: "Side team", main_duty: "sub_duty" },
      { group_id: 2, group_name: "Main team", main_duty: "main_duty", position_name: "Lead" },
    ],
  },
  {
    id: 101,
    display_name: "A Person",
    group_memberships: [
      { group_id: 2, group_name: "Main team", main_duty: "main_duty", position_name: "Member" },
    ],
  },
  {
    id: 102,
    display_name: "B Person",
    group_memberships: [
      { group_id: 2, group_name: "Main team", main_duty: "main_duty" },
    ],
  },
  {
    id: 103,
    display_name: "Other Person",
    group_memberships: [{ group_id: 3, group_name: "Other team", main_duty: "main_duty" }],
  },
];

test("team status selects the current employee's main-duty department and summarizes punches", async () => {
  const api = createFakeApi({
    employees: baseEmployees,
    clocks: {
      100: [
        { id: 1, type: "clock_in", datetime: "2026-08-10T09:00:00+09:00" },
        { id: 2, type: "break_begin", datetime: "2026-08-10T12:00:00+09:00" },
      ],
      101: [
        { id: 3, type: "clock_in", datetime: "2026-08-10T08:30:00+09:00" },
        { id: 4, type: "clock_out", datetime: "2026-08-10T17:30:00+09:00" },
      ],
    },
  });

  const result = await getTeamStatus(api, { date: "2026-08-10" });

  assert.deepEqual(result.group, { id: 2, code: null, name: "Main team" });
  assert.equal(result.summary.memberCount, 3);
  assert.equal(result.summary.on_break, 1);
  assert.equal(result.summary.clocked_out, 1);
  assert.equal(result.summary.not_clocked_in, 1);
  assert.deepEqual(result.members.map((member) => member.employeeId), [101, 102, 100]);
  assert.equal(result.members.find((member) => member.employeeId === 100).isSelf, true);
  assert.equal(api.calls.filter((call) => call.method === "listEmployeeTimeClocks").length, 3);
  assert.equal(api.calls.some((call) => call.employeeId === 103), false);
});

test("an explicit group can be selected", async () => {
  const api = createFakeApi({ employees: baseEmployees });

  const result = await getTeamStatus(api, { date: "2026-08-10", groupId: 3 });

  assert.equal(result.group.id, 3);
  assert.deepEqual(result.members.map((member) => member.employeeId), [103]);
});

test("ambiguous departments stop before any employee punch queries", async () => {
  const employees = [
    {
      id: 100,
      display_name: "Manager",
      group_memberships: [
        { group_id: 1, group_name: "One", main_duty: "sub_duty" },
        { group_id: 2, group_name: "Two", main_duty: "sub_duty" },
      ],
    },
  ];
  const api = createFakeApi({ employees });

  await assert.rejects(
    getTeamStatus(api, { date: "2026-08-10" }),
    (error) => error.code === "GROUP_REQUIRED" && error.details.groups.length === 2,
  );
  assert.equal(api.calls.some((call) => call.method === "listEmployeeTimeClocks"), false);
});

test("an invalid calendar date is rejected before membership lookup", async () => {
  const api = createFakeApi({ employees: baseEmployees });

  await assert.rejects(
    getTeamStatus(api, { date: "2026-02-30" }),
    (error) => error.code === "INVALID_DATE",
  );
  assert.equal(api.calls.some((call) => call.method === "listEmployeeGroupMemberships"), false);
});

test("an invalid event sequence is labeled irregular", async () => {
  const api = createFakeApi({
    employees: [baseEmployees[1]],
    clocks: {
      101: [{ id: 1, type: "clock_out", datetime: "2026-08-10T09:00:00+09:00" }],
    },
  });
  api.getCurrentUser = async () => ({
    id: 2,
    companies: [{ id: 10, employee_id: 101, display_name: "A Person" }],
  });

  const result = await getTeamStatus(api, { date: "2026-08-10" });

  assert.equal(result.members[0].state, "irregular");
  assert.deepEqual(result.members[0].issues, ["clock_out_without_active_work"]);
});
