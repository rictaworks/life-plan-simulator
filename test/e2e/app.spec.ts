import { test, expect, type Page } from "@playwright/test";

async function mockServer(page: Page) {
  const records = new Map<string, any>();
  let sequence = 0;
  let authenticated = true;
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (!authenticated)
      return route.fulfill({ status: 401, json: { error: "unauthorized" } });
    if (path === "/api/session")
      return route.fulfill({
        json: {
          user: { id: "fixture-owner", email: "fixture@example.test" },
          csrfToken: "fixture-csrf",
        },
      });
    if (method !== "GET")
      expect(req.headers()["x-csrf-token"]).toBe("fixture-csrf");
    if (path === "/api/scenarios" && method === "GET")
      return route.fulfill({ json: { scenarios: [...records.values()] } });
    if (path === "/api/scenarios" && method === "POST") {
      const body = req.postDataJSON();
      const record = {
        id: `s${++sequence}`,
        version: 1,
        createdAt: "2026-10-12T00:00:00Z",
        updatedAt: "2026-10-12T00:00:00Z",
        input: body.input,
      };
      records.set(record.id, record);
      return route.fulfill({ status: 201, json: record });
    }
    if (path === "/api/scenarios" && method === "DELETE") {
      records.clear();
      return route.fulfill({ status: 204 });
    }
    const record = records.get(path.split("/")[3]!);
    if (!record)
      return route.fulfill({ status: 404, json: { error: "not_found" } });
    if (method === "GET") return route.fulfill({ json: record });
    if (method === "PUT") {
      const body = req.postDataJSON();
      if (body.version !== record.version)
        return route.fulfill({ status: 409, json: { error: "conflict" } });
      record.input = body.input;
      record.version++;
      return route.fulfill({ json: record });
    }
    if (method === "DELETE") {
      records.delete(record.id);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 400, json: { error: "invalid_request" } });
  });
  await page.route("**/auth/logout", async (route) => {
    authenticated = false;
    return route.fulfill({ status: 204 });
  });
  return {
    expire: () => {
      authenticated = false;
    },
  };
}

test("calculate, compare, explicitly save, reload, and delete fictional data", async ({
  page,
}) => {
  const outbound: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== "http://127.0.0.1:4173")
      outbound.push(r.url());
  });
  await mockServer(page);
  await page.goto("/");
  await page.getByRole("button", { name: "架空サンプルを開く" }).click();
  await page.getByLabel("期間（か月）").fill("12");
  await page
    .getByRole("button", { name: "シミュレーション", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "計算結果" })).toBeVisible();
  await expect(page.getByText("2,200,000円").first()).toBeVisible();
  await page.getByRole("button", { name: "ケースを複製して比較" }).click();
  await page.getByLabel("投資配分（%）").fill("100");
  await page.getByRole("button", { name: "ケースを複製して比較" }).click();
  await expect(
    page.getByRole("button", { name: "ケースを複製して比較" }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "シミュレーション", exact: true })
    .click();
  await page.getByRole("button", { name: "新規としてサーバーに保存" }).click();
  await expect(
    page.getByText("サーバーへの保存が完了しました。"),
  ).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "「架空の家計」を読込" }).click();
  await expect(page.getByLabel("月手取り（円）")).toHaveValue("300000");
  await page.getByRole("button", { name: "全保存データを削除" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "確認して実行" }).click();
  await expect(page.getByText("保存シナリオはありません。")).toBeVisible();
  expect(outbound).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("event bounds, stale results and session expiry", async ({ page }) => {
  const server = await mockServer(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "シミュレーション", exact: true })
    .click();
  await page.getByRole("button", { name: "イベントを追加" }).click();
  await page.getByLabel("イベント年月").fill("2099-01");
  await page
    .getByRole("button", { name: "シミュレーション", exact: true })
    .click();
  await expect(
    page.getByText("イベント月を計算期間内に修正してください"),
  ).toBeVisible();
  await expect(
    page.getByText("入力を変更しました。結果は前回の条件です。"),
  ).toBeVisible();
  server.expire();
  await page.getByRole("button", { name: "一覧を再読込" }).click();
  await expect(
    page.getByRole("link", { name: "Googleでログイン" }),
  ).toBeVisible();
  await expect(page.getByLabel("月手取り（円）")).toHaveCount(0);
});
