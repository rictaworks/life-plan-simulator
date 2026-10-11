import { test, expect } from "@playwright/test";

test("maximum-input browser calculation meets the one-second target", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:4174");
  await page.getByRole("link", { name: "Googleでログイン" }).click();
  await expect(page.getByLabel("月手取り（円）")).toBeVisible();
  const name = `最大入力-${test.info().project.name}`;
  await page.evaluate(async (name) => {
    const session = await (await fetch("/api/session")).json();
    const input = {
      schemaVersion: 1,
      name,
      startMonth: "2026-01",
      months: 600,
      cases: Array.from({ length: 3 }, (_, i) => ({
        id: `maximum-${i}`,
        name: `比較${i}`,
        income: 300000,
        living: 200000,
        cash: 1000000,
        investment: 1000000,
        allocation: 50,
        annualReturn: 0,
        annualInflation: 0,
        events: Array.from({ length: 100 }, (_, j) => ({
          id: `event-${i}-${j}`,
          name: "架空イベント",
          month: "2026-01",
          type: "inflow",
          amount: 1,
        })),
      })),
    };
    const response = await fetch("/api/scenarios", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Session-User": session.user.id,
        "X-CSRF-Token": session.csrfToken,
      },
      body: JSON.stringify({ input }),
    });
    if (!response.ok) throw Error("fixture save failed");
  }, name);
  await page.getByRole("button", { name: "一覧を再読込" }).click();
  await page.getByRole("button", { name: `「${name}」を読込` }).click();
  await expect(page.getByLabel("シナリオ名", { exact: true })).toHaveValue(
    name,
  );
  await expect(
    page.getByRole("button", { name: "シミュレーション", exact: true }),
  ).toBeEnabled();
  const duration = await page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const started = performance.now();
        const timer = setTimeout(() => {
          observer.disconnect();
          reject(Error("result timeout"));
        }, 5000);
        const observer = new MutationObserver(() => {
          if (document.querySelector("#results-title")) {
            observer.disconnect();
            clearTimeout(timer);
            requestAnimationFrame(() =>
              requestAnimationFrame(() => resolve(performance.now() - started)),
            );
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        [...document.querySelectorAll("button")]
          .find((x) => x.textContent === "シミュレーション")!
          .click();
      }),
  );
  console.log(
    `Maximum-input calculation (${test.info().project.name}): ${duration.toFixed(1)} ms`,
  );
  expect(duration).toBeLessThan(1000);
});

test("real server: mocked identity, save, second device, conflict and logout", async ({
  page,
  browser,
}) => {
  await page.goto("http://127.0.0.1:4174");
  await page.getByRole("link", { name: "Googleでログイン" }).click();
  await page.getByRole("button", { name: "架空サンプルを開く" }).click();
  const name = `ブラウザー試験-${test.info().project.name}`;
  await page.getByLabel("シナリオ名", { exact: true }).fill(name);
  await page.getByRole("button", { name: "新規としてサーバーに保存" }).click();
  await expect(
    page.getByText("サーバーへの保存が完了しました。"),
  ).toBeVisible();
  const other = await browser.newContext();
  const second = await other.newPage();
  await second.goto("http://127.0.0.1:4174");
  await second.getByRole("link", { name: "Googleでログイン" }).click();
  await second.getByRole("button", { name: `「${name}」を読込` }).click();
  await expect(second.getByLabel("月手取り（円）")).toHaveValue("300000");
  await page.getByLabel("月手取り（円）").fill("400000");
  await page.getByRole("button", { name: "保存済みシナリオを更新" }).click();
  await page.getByRole("button", { name: "確認して実行" }).click();
  await expect(
    page.getByText("サーバーへの保存が完了しました。"),
  ).toBeVisible();
  await second.getByLabel("月手取り（円）").fill("500000");
  await second.getByRole("button", { name: "保存済みシナリオを更新" }).click();
  await second.getByRole("button", { name: "確認して実行" }).click();
  await expect(second.getByText(/別端末で更新されています/)).toBeVisible();
  await expect(second.getByLabel("月手取り（円）")).toHaveValue("500000");
  await page.getByRole("button", { name: "ログアウト", exact: true }).click();
  await expect(page.getByRole("button", { name: "キャンセル" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "確認して実行" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("link", { name: "Googleでログイン" }),
  ).toBeVisible();
  await expect(page.getByLabel("月手取り（円）")).toHaveCount(0);
  await other.close();
});
