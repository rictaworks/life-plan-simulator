import { describe, it, expect } from "vitest";
import {
  caseSchema,
  scenarioSchema,
  type CaseInput,
  type ScenarioInput,
} from "../../src/domain/schema.js";
import { simulate, roundYen } from "../../src/domain/simulate.js";
import { cloneCase } from "../../src/domain/cases.js";
const base: CaseInput = {
  id: "base",
  name: "基準",
  income: 0,
  living: 0,
  cash: 0,
  investment: 0,
  allocation: 0,
  annualReturn: 0,
  annualInflation: 0,
  events: [],
};
const scenario = (c: CaseInput, months = 1): ScenarioInput => ({
  schemaVersion: 1,
  name: "架空",
  startMonth: "2026-01",
  months,
  cases: [c],
});
const run = (patch: Partial<CaseInput>, months = 1) => {
  const c = { ...base, ...patch };
  const input = scenario(c, months);
  const result = simulate(input, c);
  expect(result).toEqual(simulate(input, c));
  let prior = c.cash + c.investment;
  for (const row of result.rows) {
    expect(row.total).toBe(
      prior +
        row.income +
        row.inflow -
        row.living -
        row.outflow +
        row.gain +
        row.shortfall,
    );
    expect(row.cash).toBeGreaterThanOrEqual(0);
    expect(row.investment).toBeGreaterThanOrEqual(0);
    prior = row.total;
  }
  return result;
};
const last = (patch: Partial<CaseInput>, months = 1) =>
  run(patch, months).rows.at(-1)!;
const event = (
  id: string,
  type: CaseInput["events"][number]["type"],
  amount: number,
  month = "2026-01",
) => ({ id, name: id, type, amount, month });
describe("approved acceptance calculations", () => {
  it("T01 surplus allocation", () =>
    expect(
      last({ income: 300000, living: 200000, cash: 1000000, allocation: 50 }),
    ).toMatchObject({
      cash: 1050000,
      investment: 50000,
      total: 1100000,
      shortfall: 0,
    }));
  it("T02 twelve months", () =>
    expect(
      last(
        { income: 300000, living: 200000, cash: 1000000, allocation: 50 },
        12,
      ),
    ).toMatchObject({ cash: 1600000, investment: 600000, total: 2200000 }));
  it("T03 cash then investment", () =>
    expect(
      last({ living: 80000, cash: 50000, investment: 100000 }),
    ).toMatchObject({
      withdrawal: 30000,
      cash: 0,
      investment: 70000,
      shortfall: 0,
    }));
  it("T04 terminates on unmet payment", () => {
    const r = run({ living: 200000, cash: 50000, investment: 100000 }, 12);
    expect(r.rows).toHaveLength(1);
    expect(r.completed).toBe(false);
    expect(r.firstShortfall).toMatchObject({
      month: "2026-01",
      shortfall: 50000,
    });
    expect(r.rows[0]).toMatchObject({
      withdrawal: 100000,
      cash: 0,
      investment: 0,
      shortfall: 50000,
    });
  });
  it("T05 zero assets is not itself shortfall", () => {
    const r = run({ living: 50000, cash: 50000 }, 2);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]?.shortfall).toBe(0);
    expect(r.rows[1]?.shortfall).toBe(50000);
  });
  it("T06 deficit has no allocation", () =>
    expect(
      last({
        income: 100000,
        living: 200000,
        cash: 100000,
        investment: 100000,
        allocation: 100,
      }),
    ).toMatchObject({ contribution: 0, cash: 0, investment: 100000 }));
  it("T07 expense limits allocation", () =>
    expect(
      last({
        income: 300000,
        living: 200000,
        allocation: 100,
        events: [event("e", "outflow", 80000)],
      }),
    ).toMatchObject({
      targetInvestment: 100000,
      contribution: 20000,
      cash: 0,
      investment: 20000,
    }));
  it("T08 withdrawal prevents reinvestment", () =>
    expect(
      last({
        income: 300000,
        living: 200000,
        investment: 100000,
        allocation: 100,
        events: [event("e", "outflow", 150000)],
      }),
    ).toMatchObject({
      withdrawal: 50000,
      contribution: 0,
      cash: 0,
      investment: 50000,
    }));
  it("T09 windfalls stay in cash", () =>
    expect(
      last({
        income: 100000,
        living: 100000,
        allocation: 100,
        events: [event("e", "inflow", 50000)],
      }),
    ).toMatchObject({ cash: 50000, investment: 0 }));
  it("T10 effective positive annual return", () =>
    expect(last({ investment: 120000, annualReturn: 12 })).toMatchObject({
      gain: 1139,
      investment: 121139,
    }));
  it("T11 negative return", () =>
    expect(last({ investment: 120000, annualReturn: -12 })).toMatchObject({
      gain: -1272,
      investment: 118728,
    }));
  it("T12 replacement timing", () => {
    const r = run(
      {
        income: 300000,
        living: 100000,
        events: [
          event("y", "income", 0, "2026-02"),
          event("l", "living", 200000, "2026-02"),
        ],
      },
      2,
    );
    expect(r.rows.map((r) => [r.income, r.living])).toEqual([
      [300000, 100000],
      [0, 200000],
    ]);
  });
  it("T13 inflation starts after initial month", () =>
    expect(
      run({ living: 100000, cash: 1000000, annualInflation: 12 }, 2).rows.map(
        (r) => r.living,
      ),
    ).toEqual([100000, 100949]));
  it("T14 contributions earn next month", () =>
    expect(
      last({ income: 100000, allocation: 100, annualReturn: 12 }),
    ).toMatchObject({ gain: 0, investment: 100000 }));
  it("T15 symmetric half-away rounding", () =>
    expect([0.5, -0.5, 1.49, -1.49].map(roundYen)).toEqual([1, -1, 1, -1]));
  it("T16 event order independent; replacements unique", () => {
    const events = [
      event("i", "inflow", 100),
      event("i2", "inflow", 60),
      event("o", "outflow", 50),
      event("o2", "outflow", 30),
    ];
    expect(run({ events })).toEqual(run({ events: [...events].reverse() }));
    expect(
      caseSchema.safeParse({
        ...base,
        events: [event("a", "income", 1), event("b", "income", 2)],
      }).success,
    ).toBe(false);
  });
  it("T17 invalid values rejected with paths", () => {
    for (const patch of [
      { income: "" },
      { living: NaN },
      { cash: -1 },
      { allocation: 101 },
      { annualReturn: -100 },
    ]) {
      const p = caseSchema.safeParse({ ...base, ...patch });
      expect(p.success).toBe(false);
      if (!p.success) expect(p.error.issues[0]?.path.length).toBeGreaterThan(0);
    }
    expect(
      scenarioSchema.safeParse({ ...scenario(base), months: 0 }).success,
    ).toBe(false);
  });
  it("T18 copying isolates inputs and conserves wealth", () => {
    const original = {
      ...base,
      income: 100000,
      events: [event("a", "inflow", 20)],
    };
    const copy = cloneCase(original, "copy");
    copy.allocation = 100;
    copy.events[0]!.amount = 50;
    expect(original.allocation).toBe(0);
    expect(original.events[0]!.amount).toBe(20);
    expect(last({ income: 100000, allocation: 100 }).total).toBe(
      last({ income: 100000, allocation: 0 }).total,
    );
  });
});
describe("boundaries, integrity and safety", () => {
  it("rejects unknown fields including claimed ownership and schema versions", () => {
    expect(
      scenarioSchema.safeParse({ ...scenario(base), ownerId: "intruder" })
        .success,
    ).toBe(false);
    expect(
      scenarioSchema.safeParse({ ...scenario(base), schemaVersion: 2 }).success,
    ).toBe(false);
  });
  it("validates bounded amounts, rates, identifiers, case/event counts", () => {
    for (const patch of [
      { income: 1.5 },
      { cash: 1000000001 },
      { allocation: 0.01 },
      { annualReturn: 0.001 },
      { annualInflation: 101 },
      { name: "" },
      { id: "" },
      {
        events: Array.from({ length: 101 }, (_, i) =>
          event(String(i), "inflow", 0),
        ),
      },
    ])
      expect(caseSchema.safeParse({ ...base, ...patch }).success).toBe(false);
    for (const allocation of [0, 0.1, 33.3, 100])
      expect(caseSchema.safeParse({ ...base, allocation }).success).toBe(true);
    for (const annualReturn of [-99.99, 0, 0.01, 100])
      expect(caseSchema.safeParse({ ...base, annualReturn }).success).toBe(
        true,
      );
    expect(
      scenarioSchema.safeParse({ ...scenario(base), cases: [base, base] })
        .success,
    ).toBe(false);
    expect(
      scenarioSchema.safeParse({ ...scenario(base), cases: [] }).success,
    ).toBe(false);
  });
  it("validates calendar months, event interval and shortened period", () => {
    for (const startMonth of ["2026-00", "2026-13", "2026-1", "0000-01"])
      expect(
        scenarioSchema.safeParse({ ...scenario(base), startMonth }).success,
      ).toBe(false);
    const c = { ...base, events: [event("e", "income", 1, "2026-02")] };
    expect(scenarioSchema.safeParse(scenario(c, 2)).success).toBe(true);
    expect(scenarioSchema.safeParse(scenario(c, 1)).success).toBe(false);
    expect(
      scenarioSchema.safeParse({
        ...scenario(base, 600),
        startMonth: "9999-12",
      }).success,
    ).toBe(false);
  });
  it("rebases inflation after living replacement and handles year boundary", () => {
    const c = {
      ...base,
      cash: 1000000,
      living: 100000,
      annualInflation: 12,
      events: [event("l", "living", 200000, "2027-01")],
    };
    const s = { ...scenario(c, 3), startMonth: "2026-12" };
    expect(simulate(s, c).rows.map((r) => [r.month, r.living])).toEqual([
      ["2026-12", 100000],
      ["2027-01", 200000],
      ["2027-02", 201898],
    ]);
  });
  it("reports integer overflow without a completed forecast or unsafe rows", () => {
    const r = run({ investment: 1000000000, annualReturn: 100 }, 600);
    expect(r.completed).toBe(false);
    expect(r.reason).toBe("overflow");
    expect(r.firstShortfall).toBeNull();
    expect(r.rows.length).toBeLessThan(600);
    expect(r.rows.every((r) => Number.isSafeInteger(r.total))).toBe(true);
  });
  it("extreme negative rates keep assets and living costs nonnegative", () => {
    const r = run(
      {
        cash: 1000000000,
        investment: 1000000000,
        living: 100000,
        annualReturn: -99.99,
        annualInflation: -99.99,
      },
      600,
    );
    expect(r.completed).toBe(true);
    expect(r.rows.at(-1)?.living).toBe(0);
    expect(r.rows.at(-1)!.investment).toBeGreaterThanOrEqual(0);
  });
  it("rejects four cases and duplicate event IDs", () => {
    expect(
      scenarioSchema.safeParse({
        ...scenario(base),
        cases: Array.from({ length: 4 }, (_, i) => ({
          ...base,
          id: String(i),
        })),
      }).success,
    ).toBe(false);
    expect(
      caseSchema.safeParse({
        ...base,
        events: [event("same", "inflow", 1), event("same", "outflow", 1)],
      }).success,
    ).toBe(false);
  });
  it("invalid input cannot bypass validation by calling engine", () =>
    expect(() => run({ cash: -1 })).toThrow());
  it("all generated months conserve resources, remain nonnegative and repeat exactly", () => {
    let seed = 2026;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let n = 0; n < 100; n++) {
      const c = {
        ...base,
        income: Math.floor(rng() * 500000),
        living: Math.floor(rng() * 400000),
        cash: Math.floor(rng() * 1000000),
        investment: Math.floor(rng() * 1000000),
        allocation: Math.round(rng() * 1000) / 10,
        annualReturn: Math.round((rng() * 80 - 40) * 100) / 100,
        annualInflation: Math.round(rng() * 1000) / 100,
        events: [
          event("i", "inflow", Math.floor(rng() * 100000)),
          event("e", "outflow", Math.floor(rng() * 100000)),
        ],
      };
      const s = scenario(c, 60);
      const result = simulate(s, c);
      expect(result).toEqual(simulate(s, c));
      let prior = c.cash + c.investment;
      for (const row of result.rows) {
        expect(row.total).toBe(
          prior +
            row.income +
            row.inflow -
            row.living -
            row.outflow +
            row.gain +
            row.shortfall,
        );
        expect(row.cash).toBeGreaterThanOrEqual(0);
        expect(row.investment).toBeGreaterThanOrEqual(0);
        expect(Number.isSafeInteger(row.total)).toBe(true);
        prior = row.total;
      }
    }
  });
  it("full 600-month, 3-case, 100-event input runs", () => {
    const c = {
      ...base,
      cash: 1000000000,
      events: Array.from({ length: 100 }, (_, i) =>
        event(String(i), "inflow", 1),
      ),
    };
    const s = {
      ...scenario(c, 600),
      cases: [c, { ...c, id: "two" }, { ...c, id: "three" }],
    };
    expect(scenarioSchema.safeParse(s).success).toBe(true);
    for (const item of s.cases)
      expect(simulate(s, item).rows).toHaveLength(600);
  });
});

describe("Japanese validation messages", () => {
  it.each([{ cash: -1 }, { income: "" }, { name: "" }])(
    "rejects invalid input with Japanese field errors: %j",
    (invalid) => {
      const result = caseSchema.safeParse({ ...base, ...invalid });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual([Object.keys(invalid)[0]]);
        expect(result.error.issues[0]?.message).toMatch(
          /[\u3040-\u30ff\u4e00-\u9fff]/,
        );
      }
    },
  );
});
