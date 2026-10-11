// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  act,
} from "@testing-library/react";
import App from "../../src/client/App";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function ready(label: string) {
  const element = await screen.findByLabelText(label);
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "シミュレーション",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  return element;
}
function mockSession() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (url: string) =>
        new Response(
          JSON.stringify(
            url === "/api/session"
              ? {
                  user: { id: "a", email: "a@example.test" },
                  csrfToken: "csrf",
                }
              : { scenarios: [] },
          ),
          { status: 200 },
        ),
    ),
  );
}
describe("private simulator", () => {
  it("does not show inputs before authentication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    render(<App />);
    expect(
      await screen.findByRole("link", { name: "Googleでログイン" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("月手取り（円）")).toBeNull();
  });
  it("validates drafts and retains stale results", async () => {
    mockSession();
    render(<App />);
    const income = await ready("月手取り（円）");
    fireEvent.click(screen.getByRole("button", { name: "シミュレーション" }));
    expect(
      await screen.findByRole("heading", { name: "計算結果" }),
    ).toBeTruthy();
    fireEvent.change(income, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "シミュレーション" }));
    expect(
      screen.getByText("入力を変更しました。結果は前回の条件です。"),
    ).toBeTruthy();
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0);
  });
  it("protects unsaved input when opening fictional sample", async () => {
    mockSession();
    render(<App />);
    fireEvent.change(await ready("月手取り（円）"), {
      target: { value: "123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "架空サンプルを開く" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(
      (screen.getByLabelText("月手取り（円）") as HTMLInputElement).value,
    ).toBe("123");
  });
  it("clears private state when server session expires", async () => {
    mockSession();
    render(<App />);
    await ready("月手取り（円）");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 401 })),
    );
    fireEvent.click(screen.getByRole("button", { name: "一覧を再読込" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("月手取り（円）")).toBeNull(),
    );
    expect(
      await screen.findByRole("link", { name: "Googleでログイン" }),
    ).toBeTruthy();
  });
});

describe("editing and persistence", () => {
  it("copies cases independently and limits comparison to three", async () => {
    mockSession();
    render(<App />);
    fireEvent.change(await ready("月手取り（円）"), {
      target: { value: "100" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "ケースを複製して比較" }),
    );
    fireEvent.change(screen.getByLabelText("月手取り（円）"), {
      target: { value: "200" },
    });
    fireEvent.click(screen.getByRole("button", { name: "基準" }));
    expect(
      (screen.getByLabelText("月手取り（円）") as HTMLInputElement).value,
    ).toBe("100");
    fireEvent.click(
      screen.getByRole("button", { name: "ケースを複製して比較" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "ケースを複製して比較",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it("never declares a failed save successful and binds request to account", async () => {
    mockSession();
    render(<App />);
    fireEvent.change(await ready("月手取り（円）"), {
      target: { value: "100" },
    });
    const mock = vi.fn(
      async (_url: RequestInfo | URL, _options?: RequestInit) =>
        new Response(JSON.stringify({ error: "internal_error" }), {
          status: 500,
        }),
    );
    vi.stubGlobal("fetch", mock);
    fireEvent.click(
      screen.getByRole("button", { name: "新規としてサーバーに保存" }),
    );
    await screen.findByText(/通信または保存に失敗/);
    expect(screen.getByText("未保存の変更があります")).toBeTruthy();
    expect(mock.mock.calls[0]?.[1]).toMatchObject({
      headers: { "X-Session-User": "a", "X-CSRF-Token": "csrf" },
    });
  });
  it("puts focus on cancel, traps it, and restores invoking button", async () => {
    mockSession();
    render(<App />);
    fireEvent.change(await ready("月手取り（円）"), {
      target: { value: "123" },
    });
    const button = screen.getByRole("button", { name: "架空サンプルを開く" });
    button.focus();
    fireEvent.click(button);
    const cancel = screen.getByRole("button", { name: "キャンセル" }),
      approve = screen.getByRole("button", { name: "確認して実行" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(approve);
    fireEvent.keyDown(approve, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(button);
  });
  it("keeps shortage lines and rows stopped and marks no period-end forecast", async () => {
    mockSession();
    render(<App />);
    fireEvent.change(await ready("月生活費（円）"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: "シミュレーション" }));
    expect(screen.getByText(/期間末資産は未計算/)).toBeTruthy();
    expect(document.querySelectorAll("tbody tr").length).toBe(1);
    expect(
      document.querySelector("polyline")?.getAttribute("points")?.split(" ")
        .length,
    ).toBe(2);
  });
  it("rejects an out-of-period event without refreshing the result", async () => {
    mockSession();
    render(<App />);
    await ready("月手取り（円）");
    fireEvent.click(screen.getByRole("button", { name: "シミュレーション" }));
    fireEvent.click(screen.getByRole("button", { name: "イベントを追加" }));
    fireEvent.change(screen.getByLabelText("イベント年月"), {
      target: { value: "2099-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "シミュレーション" }));
    expect(
      screen.getByLabelText("イベント年月").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getByText("入力を変更しました。結果は前回の条件です。"),
    ).toBeTruthy();
  });
});

describe("session and response isolation", () => {
  it("clears prior financial state on focused-tab identity change", async () => {
    mockSession();
    render(<App />);
    fireEvent.change(await ready("月手取り（円）"), {
      target: { value: "876543" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              user: { id: "b", email: "b@example.test" },
              csrfToken: "different",
            }),
            { status: 200 },
          ),
      ),
    );
    fireEvent(window, new Event("focus"));
    expect(
      await screen.findByRole("link", { name: "Googleでログイン" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("月手取り（円）")).toBeNull();
  });
  it("rejects malformed saved metadata without replacing current inputs", async () => {
    mockSession();
    render(<App />);
    await ready("月手取り（円）");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: "../../other", input: {} }), {
            status: 200,
          }),
      ),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "新規としてサーバーに保存" }),
    );
    expect(await screen.findByText(/保存データが破損/)).toBeTruthy();
    expect(screen.queryByText("サーバーへの保存が完了しました。")).toBeNull();
  });
  it("discards delayed private response bodies after session clearing", async () => {
    mockSession();
    render(<App />);
    await ready("月手取り（円）");
    let finish!: (value: unknown) => void;
    const delayed = new Promise((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/scenarios"
          ? { status: 200, ok: true, json: () => delayed }
          : new Response("{}", { status: 401 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "一覧を再読込" }));
    fireEvent(window, new Event("focus"));
    await screen.findByRole("link", { name: "Googleでログイン" });
    await act(async () => {
      finish({
        scenarios: [
          {
            id: "saved-id",
            version: 1,
            createdAt: "2026-10-11T00:00:00.000Z",
            updatedAt: "2026-10-11T00:00:00.000Z",
            input: {
              schemaVersion: 1,
              name: "PRIVATE DELAYED DATA",
              startMonth: "2026-01",
              months: 12,
              cases: [
                {
                  id: "base",
                  name: "基準",
                  income: 100,
                  living: 0,
                  cash: 0,
                  investment: 0,
                  allocation: 0,
                  annualReturn: 0,
                  annualInflation: 0,
                  events: [],
                },
              ],
            },
          },
        ],
      });
      await delayed;
    });
    await waitFor(() =>
      expect(screen.queryByText(/PRIVATE DELAYED DATA/)).toBeNull(),
    );
    expect(screen.queryByLabelText("月手取り（円）")).toBeNull();
  });
});

describe("save concurrency guarantees", () => {
  const savedRecord = () => ({
    id: "saved-one",
    version: 7,
    createdAt: "2026-10-11T00:00:00.000Z",
    updatedAt: "2026-10-11T00:00:00.000Z",
    input: {
      schemaVersion: 1,
      name: "保存ケース",
      startMonth: "2026-01",
      months: 12,
      cases: [
        {
          id: "base",
          name: "基準",
          income: 100,
          living: 0,
          cash: 0,
          investment: 0,
          allocation: 0,
          annualReturn: 0,
          annualInflation: 0,
          events: [],
        },
      ],
    },
  });
  it("retains edits and original version after an optimistic-lock conflict", async () => {
    const record = savedRecord();
    const api = vi.fn(
      async (url: string, options?: RequestInit) =>
        new Response(
          JSON.stringify(
            url === "/api/session"
              ? {
                  user: { id: "a", email: "a@example.test" },
                  csrfToken: "csrf",
                }
              : options?.method === "PUT"
                ? { error: "conflict" }
                : url === "/api/scenarios"
                  ? { scenarios: [record] }
                  : record,
          ),
          { status: options?.method === "PUT" ? 409 : 200 },
        ),
    );
    vi.stubGlobal("fetch", api);
    render(<App />);
    await ready("月手取り（円）");
    fireEvent.click(
      screen.getByRole("button", { name: "「保存ケース」を読込" }),
    );
    await screen.findByRole("button", { name: "保存済みシナリオを更新" });
    await ready("月手取り（円）");
    fireEvent.change(screen.getByLabelText("月手取り（円）"), {
      target: { value: "321" },
    });
    const update = async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "保存済みシナリオを更新" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "確認して実行" }));
      await screen.findByText(/別端末で更新されています/);
      await ready("月手取り（円）");
    };
    await update();
    expect(
      (screen.getByLabelText("月手取り（円）") as HTMLInputElement).value,
    ).toBe("321");
    expect(screen.getByText("未保存の変更があります")).toBeTruthy();
    expect(screen.queryByText("サーバーへの保存が完了しました。")).toBeNull();
    await update();
    const writes = api.mock.calls.filter(
      ([, options]) => options?.method === "PUT",
    );
    expect(writes).toHaveLength(2);
    for (const [url, options] of writes) {
      expect(url).toBe("/api/scenarios/saved-one");
      expect(JSON.parse(options?.body as string)).toMatchObject({
        version: 7,
        input: { cases: [{ income: 321 }] },
      });
    }
  });
  it("locks inputs and destructive actions while a save is pending, then unlocks on failure", async () => {
    mockSession();
    render(<App />);
    fireEvent.change(await ready("月手取り（円）"), {
      target: { value: "456" },
    });
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      finish = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pending),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "新規としてサーバーに保存" }),
    );
    for (const label of [
      "シナリオ名",
      "開始年月",
      "期間（か月）",
      "月手取り（円）",
      "投資配分スライダー",
    ])
      expect(screen.getByLabelText(label).matches(":disabled")).toBe(true);
    for (const name of [
      "イベントを追加",
      "新規作成",
      "架空サンプルを開く",
      "新規としてサーバーに保存",
      "ログアウト",
    ])
      expect(screen.getByRole("button", { name }).matches(":disabled")).toBe(
        true,
      );
    expect(screen.getByText("未保存の変更があります")).toBeTruthy();
    expect(screen.queryByText("サーバーへの保存が完了しました。")).toBeNull();
    await act(async () => {
      finish(
        new Response(JSON.stringify({ error: "internal_error" }), {
          status: 500,
        }),
      );
      await pending;
    });
    await screen.findByText(/通信または保存に失敗/);
    expect(screen.getByLabelText("月手取り（円）").matches(":disabled")).toBe(
      false,
    );
    expect(
      (screen.getByLabelText("月手取り（円）") as HTMLInputElement).value,
    ).toBe("456");
    expect(screen.getByText("未保存の変更があります")).toBeTruthy();
  });
});
