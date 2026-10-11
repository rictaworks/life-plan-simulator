import type { ScenarioInput } from "../domain/schema";
import { simulate } from "../domain/simulate";
export const yen = (n: number) =>
  Number.isFinite(n) ? `${n.toLocaleString("ja-JP")}円` : "—";
export default function Results({ input }: { input: ScenarioInput }) {
  const results = input.cases.map((c) => ({ c, r: simulate(input, c) }));
  const maximum = Math.max(
    1,
    ...results.flatMap(({ r }) => [
      r.initial.total,
      ...r.rows.map((x) => x.total),
    ]),
  );
  const point = (value: number, index: number) =>
    `${40 + (index / input.months) * 800},${240 - (value / maximum) * 210}`;
  return (
    <section aria-labelledby="results-title">
      <h2 id="results-title">計算結果</h2>
      <p>
        開始時点と月末残高・名目円。全ケースは同じ時間軸です。資金不足の月で計算と線を終了します。
      </p>
      <svg
        viewBox="0 0 880 340"
        role="img"
        aria-labelledby="chart-title chart-description"
      >
        <title id="chart-title">資産推移グラフ</title>
        <desc id="chart-description">
          実線は合計資産、破線は現金、点線は投資。ケースごとに線幅とラベルで区別します。同じ数値は下の月次明細にあります。
        </desc>
        {results.map(({ c, r }, ci) => (
          <g key={c.id} strokeWidth={1 + ci * 1.5}>
            <polyline
              aria-label={`${c.name} 合計資産`}
              fill="none"
              stroke="currentColor"
              points={[
                point(r.initial.total, 0),
                ...r.rows.map((x, i) => point(x.total, i + 1)),
              ].join(" ")}
            />
            <polyline
              fill="none"
              stroke="currentColor"
              strokeDasharray="8 5"
              points={[
                point(r.initial.cash, 0),
                ...r.rows.map((x, i) => point(x.cash, i + 1)),
              ].join(" ")}
            />
            <polyline
              fill="none"
              stroke="currentColor"
              strokeDasharray="2 5"
              points={[
                point(r.initial.investment, 0),
                ...r.rows.map((x, i) => point(x.investment, i + 1)),
              ].join(" ")}
            />
            <text x="40" y={255 + ci * 11} strokeWidth="0" fontSize="10">
              {c.name}（線幅{1 + ci * 1.5}）
            </text>
            {r.rows.length > 0 && (
              <g>
                <circle
                  cx={40 + (r.rows.length / input.months) * 800}
                  cy={240 - ((r.rows.at(-1)?.total ?? 0) / maximum) * 210}
                  r="4"
                  fill="white"
                  stroke="currentColor"
                />
                <text x="40" y={292 + ci * 11} fontSize="10" strokeWidth="0">
                  {c.name} 計算終了: {r.rows.at(-1)?.month}
                </text>
              </g>
            )}
            {c.events.map((e) => {
              const index = r.rows.findIndex((x) => x.month === e.month);
              return index < 0 ? null : (
                <text
                  key={e.id}
                  x={40 + ((index + 1) / input.months) * 800}
                  y={15 + ci * 13}
                  fontSize="10"
                  strokeWidth="0"
                >
                  ◆ {e.month}
                </text>
              );
            })}
          </g>
        ))}
        <text x="40" y="332" fontSize="10">
          開始 {input.startMonth}
        </text>
        <text x="640" y="332" fontSize="10">
          期間 {input.months}か月
        </text>
      </svg>
      {results.map(({ c, r }) => (
        <article key={c.id}>
          <h3>{c.name}</h3>
          <p>
            開始資産 {yen(r.initial.total)}（現金 {yen(r.initial.cash)} / 投資{" "}
            {yen(r.initial.investment)}）
          </p>
          {r.reason === "overflow" ? (
            <p role="alert">
              安全な計算範囲を超えました。条件を見直してください。完成した予測として利用できません。
            </p>
          ) : r.firstShortfall ? (
            <p role="alert">
              {r.firstShortfall.month}に計算終了。初回資金不足{" "}
              {yen(r.firstShortfall.shortfall)}。期間末資産は未計算です。
            </p>
          ) : (
            <p>
              終了時資産 {yen(r.rows.at(-1)?.total ?? r.initial.total)} / 現金{" "}
              {yen(r.rows.at(-1)?.cash ?? r.initial.cash)} / 投資{" "}
              {yen(r.rows.at(-1)?.investment ?? r.initial.investment)}
              。入力期間内の資金不足なし。
            </p>
          )}
          <p>
            仮定: 手取り {yen(c.income)}、生活費 {yen(c.living)}、投資配分{" "}
            {c.allocation}%、年利回り {c.annualReturn}%、年生活費上昇率{" "}
            {c.annualInflation}%、{input.startMonth}から{input.months}か月。
          </p>
          <details>
            <summary>{c.name}の月次明細</summary>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${c.name} 月次明細`}
            >
              <table>
                <caption>初期資産は上記。以下は月末の確定値です。</caption>
                <thead>
                  <tr>
                    {[
                      "年月",
                      "収入",
                      "生活費",
                      "一時収入",
                      "一時支出",
                      "運用損益",
                      "投資積立",
                      "投資取崩",
                      "不足額",
                      "現金",
                      "投資",
                      "合計資産",
                      "希望貯蓄",
                    ].map((x) => (
                      <th key={x} scope="col">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((x) => (
                    <tr key={x.month}>
                      <th scope="row">{x.month}</th>
                      {[
                        x.income,
                        x.living,
                        x.inflow,
                        x.outflow,
                        x.gain,
                        x.contribution,
                        x.withdrawal,
                        x.shortfall,
                        x.cash,
                        x.investment,
                        x.total,
                        x.targetSaving,
                      ].map((n, i) => (
                        <td key={i}>{yen(n)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </article>
      ))}
      <p>
        支払いは現金→投資の順に取り崩します。貯蓄は現金に含まれ、希望貯蓄は実際の現金増減とは異なります。税金・手数料・現金利息・売却待ち・借入・実質価値は計算しません。利回りは仮定であり利益や生涯の安全を保証しません。
      </p>
    </section>
  );
}
