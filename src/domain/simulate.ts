import {
  scenarioSchema,
  formatMonth,
  monthIndex,
  type CaseInput,
  type ScenarioInput,
} from "./schema.js";

export interface MonthlyRow {
  month: string;
  income: number;
  living: number;
  inflow: number;
  outflow: number;
  gain: number;
  contribution: number;
  withdrawal: number;
  shortfall: number;
  cash: number;
  investment: number;
  total: number;
  targetInvestment: number;
  targetSaving: number;
}
export interface SimulationResult {
  rows: MonthlyRow[];
  completed: boolean;
  reason: "completed" | "shortfall" | "overflow";
  initial: { cash: number; investment: number; total: number };
  firstShortfall: MonthlyRow | null;
}
/** Round halves away from zero, including negative investment losses. */
export function roundYen(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}
class ArithmeticOverflow extends Error {}
function safe(value: number): number {
  if (!Number.isSafeInteger(value))
    throw new ArithmeticOverflow("安全な整数範囲を超えました");
  return value;
}
function add(...values: number[]): number {
  return values.reduce((total, value) => safe(total + value), 0);
}

/** Pure monthly model. Every call validates the shared period and the selected case. */
export function simulate(
  scenario: ScenarioInput,
  caseInput: CaseInput,
): SimulationResult {
  scenarioSchema.parse(scenario);
  const parsed = scenarioSchema.parse({ ...scenario, cases: [caseInput] });
  const c = parsed.cases[0]!;
  const result: SimulationResult = {
    rows: [],
    completed: false,
    reason: "completed",
    initial: {
      cash: c.cash,
      investment: c.investment,
      total: c.cash + c.investment,
    },
    firstShortfall: null,
  };
  let cash = c.cash;
  let investment = c.investment;
  let income = c.income;
  let livingBase = c.living;
  let baseIndex = 0;
  const monthlyReturn = Math.pow(1 + c.annualReturn / 100, 1 / 12) - 1;
  const start = monthIndex(parsed.startMonth);
  try {
    for (let index = 0; index < parsed.months; index++) {
      const month = formatMonth(start + index);
      const events = c.events.filter((event) => event.month === month);
      const incomeEvent = events.find((event) => event.type === "income");
      if (incomeEvent) income = incomeEvent.amount;
      const livingEvent = events.find((event) => event.type === "living");
      if (livingEvent) {
        livingBase = livingEvent.amount;
        baseIndex = index;
      }
      const living = safe(
        roundYen(
          livingBase *
            Math.pow(1 + c.annualInflation / 100, (index - baseIndex) / 12),
        ),
      );
      const gain = Math.max(
        -investment,
        safe(roundYen(investment * monthlyReturn)),
      );
      let nextInvestment = add(investment, gain);
      const inflow = events
        .filter((e) => e.type === "inflow")
        .reduce((sum, e) => add(sum, e.amount), 0);
      const outflow = events
        .filter((e) => e.type === "outflow")
        .reduce((sum, e) => add(sum, e.amount), 0);
      let balance = add(cash, income, inflow, -living, -outflow);
      const withdrawal = balance < 0 ? Math.min(nextInvestment, -balance) : 0;
      nextInvestment = add(nextInvestment, -withdrawal);
      balance = add(balance, withdrawal);
      const shortfall = Math.max(0, -balance);
      const surplus = Math.max(0, income - living);
      const targetInvestment = safe(roundYen(surplus * (c.allocation / 100)));
      const targetSaving = safe(surplus - targetInvestment);
      const contribution =
        shortfall > 0 || withdrawal > 0
          ? 0
          : Math.min(targetInvestment, balance);
      const nextCash = shortfall > 0 ? 0 : safe(balance - contribution);
      nextInvestment = add(nextInvestment, contribution);
      const total = add(nextCash, nextInvestment);
      const row: MonthlyRow = {
        month,
        income,
        living,
        inflow,
        outflow,
        gain,
        contribution,
        withdrawal,
        shortfall,
        cash: nextCash,
        investment: nextInvestment,
        total,
        targetInvestment,
        targetSaving,
      };
      result.rows.push(row);
      cash = nextCash;
      investment = nextInvestment;
      if (shortfall > 0) {
        result.reason = "shortfall";
        result.firstShortfall = row;
        return result;
      }
    }
    result.completed = true;
  } catch (error) {
    if (!(error instanceof ArithmeticOverflow)) throw error;
    result.reason = "overflow";
  }
  return result;
}
