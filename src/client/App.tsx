import UsageNotice from "./UsageNotice";
import { useEffect, useRef, useState } from "react";
import {
  scenarioSchema,
  type ScenarioInput,
  type CaseInput,
  type EventInput,
} from "../domain/schema";
import { z } from "zod";
import Results, { yen } from "./Results";
import Confirm from "./Confirm";
type Saved = {
  id: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  input: ScenarioInput;
};
const savedSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9_-]+$/),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  input: scenarioSchema,
});
function readSaved(value: unknown): Saved {
  const result = savedSchema.safeParse(value);
  if (!result.success)
    throw Error(
      "保存データが破損しているか未対応形式です。読み替えずに停止しました。",
    );
  return result.data;
}
type Session = { user: { id: string; email: string }; csrfToken: string };
const id = () => crypto.randomUUID();
function fresh(sample = false): ScenarioInput {
  return {
    schemaVersion: 1,
    name: sample ? "架空の家計" : "新しいシナリオ",
    startMonth: "2026-01",
    months: 120,
    cases: [
      {
        id: id(),
        name: "基準",
        income: sample ? 300000 : 0,
        living: sample ? 200000 : 0,
        cash: sample ? 1000000 : 0,
        investment: 0,
        allocation: 50,
        annualReturn: 0,
        annualInflation: 0,
        events: [],
      },
    ],
  };
}
const errorMessages: Record<string, string> = {
  conflict:
    "別端末で更新されています。未保存の入力を確認し、一覧から再読込してください。自動上書きはしません。",
  not_found: "保存データを取得できません。削除された可能性があります。",
  invalid_saved_data:
    "保存データが破損しているか未対応形式です。読み替えずに停止しました。",
  storage_limit: "保存件数の上限です。不要なシナリオを削除してください。",
  rate_limited: "要求が多すぎます。しばらく待って再試行してください。",
  csrf: "認証状態を確認できません。ページを再読込してください。",
};
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [loading, setLoading] = useState(true),
    [input, setInput] = useState<ScenarioInput>(() => fresh()),
    [active, setActive] = useState(0),
    [result, setResult] = useState<ScenarioInput | null>(null),
    [dirty, setDirty] = useState(false),
    [stale, setStale] = useState(false),
    [errors, setErrors] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState(""),
    [list, setList] = useState<Saved[]>([]),
    [saved, setSaved] = useState<Saved | null>(null),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<{
      message: string;
      run: () => void;
    } | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(true);
  function clear() {
    epoch.current++;
    setSession(null);
    setInput(fresh());
    setResult(null);
    setList([]);
    setSaved(null);
    setDirty(false);
    setErrors({});
    setConfirm(null);
    setActive(0);
  }
  async function request(path: string, method = "GET", body?: unknown) {
    const version = epoch.current;
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        ...(session ? { "X-Session-User": session.user.id } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(method !== "GET"
          ? { "X-CSRF-Token": session?.csrfToken ?? "" }
          : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data =
      response.status === 204
        ? null
        : await response.json().catch(() => ({ error: "unknown" }));
    if (version !== epoch.current || !mounted.current) throw Error("expired");
    if (response.status === 401) {
      clear();
      setNotice(
        "セッションの期限が切れました。再ログインしてください。未保存データは消去しました。",
      );
      throw Error("expired");
    }
    if (!response.ok) {
      throw Error(
        errorMessages[data.error] ??
          "通信または保存に失敗しました。未保存の入力を確認して再試行してください。",
      );
    }
    return data;
  }
  async function action(work: () => Promise<void>) {
    const version = epoch.current;
    setBusy(true);
    try {
      await work();
    } catch (e) {
      if (
        version === epoch.current &&
        e instanceof Error &&
        e.message !== "expired"
      )
        setNotice(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function refresh() {
    const data = await request("/api/scenarios");
    if (
      !Array.isArray(data.scenarios) ||
      data.scenarios.some((s: unknown) => !savedSchema.safeParse(s).success)
    )
      throw Error(errorMessages.invalid_saved_data);
    setList(data.scenarios);
  }
  useEffect(() => {
    mounted.current = true;
    const version = epoch.current;
    fetch("/api/session", { credentials: "same-origin", cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) {
          if (r.status !== 401)
            setNotice(
              "ログイン状態を確認できません。ページを再読込してください。",
            );
          return;
        }
        const data = await r.json();
        if (mounted.current && version === epoch.current) setSession(data);
      })
      .catch(() =>
        setNotice("通信に失敗しました。ページを再読込してください。"),
      )
      .finally(() => mounted.current && setLoading(false));
    return () => {
      mounted.current = false;
      epoch.current++;
    };
  }, []);
  useEffect(() => {
    if (session) void action(refresh);
  }, [session]);
  useEffect(() => {
    if (!session) return;
    const version = epoch.current;
    async function check() {
      try {
        const response = await fetch("/api/session", {
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = response.ok ? await response.json() : null;
        if (version !== epoch.current || !mounted.current) return;
        if (
          response.status === 401 ||
          (response.ok &&
            (data.user?.id !== session?.user.id ||
              data.csrfToken !== session?.csrfToken))
        ) {
          clear();
          setNotice(
            "アカウントまたはセッションが変更されました。前の入力を消去しました。再ログインしてください。",
          );
        }
      } catch {
        /* Keep unsaved input on network failure; server binds every private operation. */
      }
    }
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [session]);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function edit(next: ScenarioInput) {
    setInput(next);
    setDirty(true);
    setStale(true);
    setErrors({});
  }
  function changeCase(key: keyof CaseInput, value: unknown) {
    edit({
      ...input,
      cases: input.cases.map((c, i) =>
        i === active ? { ...c, [key]: value } : c,
      ),
    });
  }
  function valid() {
    const parsed = scenarioSchema.safeParse(input);
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path.at(-1));
      fields[issue.path.join(".")] = /[ぁ-んァ-ヶ一-龠]/.test(issue.message)
        ? issue.message
        : key === "months"
          ? "期間は1〜600の整数で入力してください。"
          : key === "allocation"
            ? "投資配分は0〜100%、0.1ポイント刻みで入力してください。"
            : key.startsWith("annual")
              ? "年率は−99.99〜100%、0.01ポイント刻みで入力してください。"
              : key === "name"
                ? "名前を入力してください（シナリオ80文字、ケース40文字、イベント60文字まで）。"
                : "金額は0〜10億円の整数で入力してください。";
    }
    setErrors(fields);
    setNotice(
      "入力内容を確認してください。項目の近くにエラーを表示しています。",
    );
    return null;
  }
  function ask(message: string, run: () => void) {
    setConfirm({ message, run });
  }
  function replace(next: ScenarioInput, record: Saved | null = null) {
    setInput(structuredClone(next));
    setSaved(record);
    setActive(0);
    setResult(null);
    setStale(false);
    setErrors({});
    setDirty(record === null);
    setNotice("");
  }
  function protect(message: string, run: () => void) {
    if (dirty) ask(message, run);
    else run();
  }
  async function persist(update: boolean) {
    const value = valid();
    if (!value) return;
    await action(async () => {
      const record: Saved = readSaved(
        await request(
          update && saved ? `/api/scenarios/${saved.id}` : "/api/scenarios",
          update ? "PUT" : "POST",
          update ? { input: value, version: saved?.version } : { input: value },
        ),
      );
      setSaved(record);
      setDirty(false);
      setNotice("サーバーへの保存が完了しました。");
      await refresh();
    });
  }
  function field(
    label: string,
    key: string,
    value: string | number,
    onChange: (v: string) => void,
    type = "number",
    props: Record<string, unknown> = {},
  ) {
    const error = errors[key];
    return (
      <div className="field" key={key}>
        <label htmlFor={key}>{label}</label>
        <input
          id={key}
          type={type}
          value={typeof value === "number" && Number.isNaN(value) ? "" : value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? `${key}-error` : undefined}
          {...props}
        />
        {error && (
          <span id={`${key}-error`} role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }
  if (loading)
    return (
      <main>
        <p role="status">ログイン状態を確認中…</p>
      </main>
    );
  if (!session)
    return (
      <main>
        <h1>人生設計シミュレーター</h1>
        <p>
          手取りから生活費を確保し、残りの貯蓄・投資配分と将来の資産を仮定で試します。
        </p>
        <p>
          Googleログイン後、ご本人専用のサーバーに保存できます。同じGoogleアカウントで別端末から再開できます。Googleのパスワードは本サービスでは受け取りません。
        </p>
        {notice && <p role="alert">{notice}</p>}
        {new URLSearchParams(window.location.search).has("authError") && (
          <p role="alert">
            ログインがキャンセルされたか失敗しました。再試行できます。
          </p>
        )}
        <a href="/auth/google">Googleでログイン</a>
        <p>利益を保証せず、商品推奨や税・年金の自動計算は行いません。</p>
        <UsageNotice />
      </main>
    );
  const c = input.cases[active]!;
  const surplus = Math.max(0, c.income - c.living),
    invest = Math.round((surplus * c.allocation) / 100);
  const pct = (n: number) =>
    c.income > 0 ? `${((n / c.income) * 100).toFixed(1)}%` : "—";
  return (
    <>
      <a className="skip" href="#editor">
        条件設定へ移動
      </a>
      <header>
        <h1>人生設計シミュレーター</h1>
        <p>ログイン中: {session.user.email}</p>
        <a href="#usage-notice">利用上の注意・データの取扱いへ</a>
        <button
          disabled={busy}
          onClick={() =>
            ask(
              "ログアウトすると未保存の入力を消去します。",
              () =>
                void action(async () => {
                  await request("/auth/logout", "POST");
                  clear();
                  setNotice("ログアウトしました。");
                }),
            )
          }
        >
          ログアウト
        </button>
        <p role="status">
          {dirty
            ? "未保存の変更があります"
            : saved
              ? `保存済み: ${saved.updatedAt}`
              : "まだ保存していません"}
        </p>
      </header>
      <main>
        {notice && <p role="alert">{notice}</p>}
        <p>
          入力は将来の仮定です。計算はブラウザーで行い、自動保存しません。明示的な保存時だけ、財務入力・イベントを本人専用サーバーへ送信します。
        </p>
        <button
          disabled={busy}
          onClick={() =>
            protect(
              "未保存の入力を破棄して架空サンプルに置き換えますか？",
              () => replace(fresh(true)),
            )
          }
        >
          架空サンプルを開く
        </button>
        <button
          disabled={busy}
          onClick={() =>
            protect("未保存の入力を破棄して新規作成しますか？", () =>
              replace(fresh()),
            )
          }
        >
          新規作成
        </button>
        <section id="editor" aria-labelledby="editor-title">
          <h2 id="editor-title">条件設定</h2>
          <fieldset disabled={busy}>
            <legend>共通条件</legend>
            {field(
              "シナリオ名",
              "name",
              input.name,
              (v) => edit({ ...input, name: v }),
              "text",
              { maxLength: 80 },
            )}
            {field(
              "開始年月",
              "startMonth",
              input.startMonth,
              (v) => edit({ ...input, startMonth: v }),
              "month",
            )}
            {field(
              "期間（か月）",
              "months",
              input.months,
              (v) => edit({ ...input, months: v === "" ? NaN : Number(v) }),
              "number",
              { min: 1, max: 600, step: 1 },
            )}
          </fieldset>
          <nav aria-label="比較ケース">
            {input.cases.map((item, i) => (
              <button
                key={item.id}
                aria-pressed={active === i}
                onClick={() => setActive(i)}
              >
                {item.name || `ケース${i + 1}`}
              </button>
            ))}
          </nav>
          <button
            disabled={input.cases.length >= 3 || busy}
            onClick={() => {
              const copy = structuredClone(c);
              copy.id = id();
              copy.name = `比較${input.cases.length}`;
              copy.events = copy.events.map((e) => ({ ...e, id: id() }));
              edit({ ...input, cases: [...input.cases, copy] });
              setActive(input.cases.length);
            }}
          >
            ケースを複製して比較
          </button>
          <button
            disabled={input.cases.length === 1 || busy}
            onClick={() =>
              ask(`「${c.name}」ケースを削除しますか？`, () => {
                edit({
                  ...input,
                  cases: input.cases.filter((_, i) => i !== active),
                });
                setActive(0);
              })
            }
          >
            このケースを削除
          </button>
          <fieldset disabled={busy}>
            <legend>{c.name}の条件</legend>
            {field(
              "ケース名",
              `cases.${active}.name`,
              c.name,
              (v) => changeCase("name", v),
              "text",
              { maxLength: 40 },
            )}
            {(
              [
                "income",
                "living",
                "cash",
                "investment",
                "allocation",
                "annualReturn",
                "annualInflation",
              ] as const
            ).map((key, i) =>
              field(
                [
                  "月手取り（円）",
                  "月生活費（円）",
                  "初期現金（円）",
                  "初期投資（円）",
                  "投資配分（%）",
                  "年利回り（%）",
                  "年生活費上昇率（%）",
                ][i]!,
                `cases.${active}.${key}`,
                c[key],
                (v) => changeCase(key, v === "" ? NaN : Number(v)),
                "number",
                {
                  min: key.startsWith("annual") ? -99.99 : 0,
                  max:
                    key === "allocation" || key.startsWith("annual")
                      ? 100
                      : 1000000000,
                  step:
                    key === "allocation"
                      ? 0.1
                      : key.startsWith("annual")
                        ? 0.01
                        : 1,
                },
              ),
            )}
            <label htmlFor="allocation-slider">投資配分スライダー</label>
            <input
              id="allocation-slider"
              type="range"
              min="0"
              max="100"
              step="0.1"
              value={Number.isFinite(c.allocation) ? c.allocation : 0}
              onChange={(e) => changeCase("allocation", Number(e.target.value))}
            />
            <p>
              生活費を確保した後の黒字を配分します。生活費 {yen(c.living)}
              （手取りの{pct(c.living)}）、希望貯蓄 {yen(surplus - invest)}（
              {pct(surplus - invest)}）、希望投資 {yen(invest)}（{pct(invest)}
              ）。
            </p>
            {c.living > c.income && (
              <p role="alert">
                通常収支が赤字です。新規の貯蓄・投資配分は0円です。
              </p>
            )}
          </fieldset>
          <fieldset disabled={busy}>
            <legend>イベント（最大100件）</legend>
            <p>
              期間内の年月を指定します。同じ月の月手取り変更・月生活費変更はそれぞれ1件までです。
            </p>
            {c.events
              .map((e, index) => ({ e, index }))
              .sort((a, b) => a.e.month.localeCompare(b.e.month))
              .map(({ e, index }) => {
                const key = `cases.${active}.events.${index}`;
                function update(k: keyof EventInput, v: unknown) {
                  changeCase(
                    "events",
                    c.events.map((x, i) =>
                      i === index ? { ...x, [k]: v } : x,
                    ),
                  );
                }
                return (
                  <fieldset key={e.id}>
                    <legend>イベント {index + 1}</legend>
                    {field(
                      "イベント名",
                      `${key}.name`,
                      e.name,
                      (v) => update("name", v),
                      "text",
                      { maxLength: 60 },
                    )}
                    {field(
                      "イベント年月",
                      `${key}.month`,
                      e.month,
                      (v) => update("month", v),
                      "month",
                    )}
                    <label htmlFor={`${key}.type`}>イベント種別</label>
                    <select
                      id={`${key}.type`}
                      value={e.type}
                      onChange={(x) => update("type", x.target.value)}
                    >
                      <option value="income">月手取り変更</option>
                      <option value="living">月生活費変更</option>
                      <option value="inflow">一時収入</option>
                      <option value="outflow">一時支出</option>
                    </select>
                    {field(
                      "イベント金額（円）",
                      `${key}.amount`,
                      e.amount,
                      (v) => update("amount", v === "" ? NaN : Number(v)),
                      "number",
                      { min: 0, max: 1000000000, step: 1 },
                    )}
                    <button
                      onClick={() =>
                        ask(`イベント「${e.name}」を削除しますか？`, () =>
                          changeCase(
                            "events",
                            c.events.filter((x) => x.id !== e.id),
                          ),
                        )
                      }
                    >
                      イベント {index + 1} を削除
                    </button>
                  </fieldset>
                );
              })}
            <button
              disabled={c.events.length >= 100}
              onClick={() =>
                changeCase("events", [
                  ...c.events,
                  {
                    id: id(),
                    name: "新しいイベント",
                    month: input.startMonth,
                    type: "outflow",
                    amount: 0,
                  },
                ])
              }
            >
              イベントを追加
            </button>
          </fieldset>
          {Object.entries(errors)
            .filter(([path]) => !document.getElementById(path))
            .map(([path, message]) => (
              <p role="alert" key={path}>
                {path}: {message}
              </p>
            ))}
          <button
            disabled={busy}
            onClick={() => {
              const value = valid();
              if (value) {
                setResult(structuredClone(value));
                setStale(false);
                setNotice("計算が完了しました。");
              }
            }}
          >
            シミュレーション
          </button>
          <button disabled={busy} onClick={() => void persist(false)}>
            新規としてサーバーに保存
          </button>
          {saved && (
            <button
              disabled={busy}
              onClick={() =>
                ask(
                  `保存済み「${saved.input.name}」を現在の条件で更新しますか？`,
                  () => void persist(true),
                )
              }
            >
              保存済みシナリオを更新
            </button>
          )}
        </section>
        {result && (
          <>
            {stale && (
              <p role="status">入力を変更しました。結果は前回の条件です。</p>
            )}
            <Results input={result} />
          </>
        )}
        <section aria-labelledby="saved-title">
          <h2 id="saved-title">本人専用の保存管理</h2>
          <p>
            保存先は本サービスのサーバーです。同じGoogleアカウントなら別端末から再開できます。削除は稼働系に反映します。バックアップ保持方針は公開前に確定するため、現在は公開前の実装です。
          </p>
          <button disabled={busy} onClick={() => void action(refresh)}>
            一覧を再読込
          </button>
          <button
            disabled={busy || !list.length}
            onClick={() =>
              ask(
                "サーバーに保存したすべてのシナリオを削除します。元に戻せません。",
                () =>
                  void action(async () => {
                    await request("/api/scenarios", "DELETE");
                    setList([]);
                    setSaved(null);
                    setDirty(true);
                    setNotice(
                      "全保存データを削除しました。画面の入力は未保存です。",
                    );
                  }),
              )
            }
          >
            全保存データを削除
          </button>
          {!list.length && <p>保存シナリオはありません。</p>}
          <ul>
            {list.map((s) => (
              <li key={s.id}>
                <strong>{s.input.name}</strong> — 更新 {s.updatedAt}
                <button
                  disabled={busy}
                  onClick={() =>
                    protect(
                      "未保存の入力を破棄して読み込みますか？",
                      () =>
                        void action(async () => {
                          const value = readSaved(
                            await request(`/api/scenarios/${s.id}`),
                          );
                          replace(value.input, value);
                        }),
                    )
                  }
                >
                  「{s.input.name}」を読込
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      await request(`/api/scenarios/${s.id}/duplicate`, "POST");
                      await refresh();
                      setNotice("保存シナリオを複製しました。");
                    })
                  }
                >
                  「{s.input.name}」を複製
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    ask(
                      `保存済み「${s.input.name}」を削除します。元に戻せません。`,
                      () =>
                        void action(async () => {
                          await request(`/api/scenarios/${s.id}`, "DELETE");
                          if (saved?.id === s.id) {
                            setSaved(null);
                            setDirty(true);
                          }
                          await refresh();
                          setNotice("保存シナリオを削除しました。");
                        }),
                    )
                  }
                >
                  「{s.input.name}」を削除
                </button>
              </li>
            ))}
          </ul>
        </section>
        <UsageNotice />
      </main>
      {confirm && (
        <Confirm
          message={confirm.message}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const run = confirm.run;
            setConfirm(null);
            run();
          }}
        />
      )}
    </>
  );
}
