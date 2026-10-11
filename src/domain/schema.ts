import { z } from "zod";

// The shared browser/server contract presents validation errors in Japanese.
z.config(z.locales.ja());

const identifier = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/, "識別子の形式が不正です");
const money = z.number().int().min(0).max(1_000_000_000);
const stepped = (step: number) => (value: number) =>
  Math.abs(value / step - Math.round(value / step)) < 1e-7;
const annualRate = z
  .number()
  .min(-99.99)
  .max(100)
  .refine(stepped(0.01), "0.01ポイント刻みで入力してください");
const month = z
  .string()
  .regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/, "年月をYYYY-MMで入力してください");
export const monthIndex = (value: string): number =>
  Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
export const formatMonth = (index: number): string =>
  `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
export const eventSchema = z.strictObject({
  id: identifier,
  name: z.string().trim().min(1).max(60),
  month,
  type: z.enum(["income", "living", "inflow", "outflow"]),
  amount: money,
});
export const caseSchema = z
  .strictObject({
    id: identifier,
    name: z.string().trim().min(1).max(40),
    income: money,
    living: money,
    cash: money,
    investment: money,
    allocation: z
      .number()
      .min(0)
      .max(100)
      .refine(stepped(0.1), "0.1ポイント刻みで入力してください"),
    annualReturn: annualRate,
    annualInflation: annualRate,
    events: z.array(eventSchema).max(100),
  })
  .superRefine((value, ctx) => {
    const ids = new Set<string>();
    const replacements = new Set<string>();
    value.events.forEach((event, index) => {
      if (ids.has(event.id))
        ctx.addIssue({
          code: "custom",
          path: ["events", index, "id"],
          message: "イベントIDが重複しています",
        });
      ids.add(event.id);
      if (event.type === "income" || event.type === "living") {
        const key = `${event.month}:${event.type}`;
        if (replacements.has(key))
          ctx.addIssue({
            code: "custom",
            path: ["events", index, "month"],
            message: "同じ月の同種変更は1件までです",
          });
        replacements.add(key);
      }
    });
  });
export const scenarioSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(80),
    startMonth: month,
    months: z.number().int().min(1).max(600),
    cases: z.array(caseSchema).min(1).max(3),
  })
  .superRefine((value, ctx) => {
    const start = monthIndex(value.startMonth);
    const end = start + value.months;
    if (end > 120000)
      ctx.addIssue({
        code: "custom",
        path: ["months"],
        message: "9999年12月までの期間を指定してください",
      });
    const ids = new Set<string>();
    value.cases.forEach((item, index) => {
      if (ids.has(item.id))
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: "ケースIDが重複しています",
        });
      ids.add(item.id);
      item.events.forEach((event, eventIndex) => {
        const time = monthIndex(event.month);
        if (time < start || time >= end)
          ctx.addIssue({
            code: "custom",
            path: ["cases", index, "events", eventIndex, "month"],
            message: "イベント月を計算期間内に修正してください",
          });
      });
    });
  });
export type EventInput = z.infer<typeof eventSchema>;
export type CaseInput = z.infer<typeof caseSchema>;
export type ScenarioInput = z.infer<typeof scenarioSchema>;
