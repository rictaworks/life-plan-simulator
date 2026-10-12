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
    `${122 + (index / input.months) * 708},${270 - (value / maximum) * 230}`;
  return (
    <section className="panel results-content" aria-labelledby="results-title">
      <div className="section-heading">
        <span className="step-number">02</span>
        <h2 id="results-title">計算結果</h2>
      </div>
      <p>
        開始時点と月末残高・名目円。全ケースは同じ時間軸です。資金不足の月で計算と線を終了します。
      </p>
      <div
        className="chart-scroll"
        tabIndex={0}
        role="region"
        aria-label="資産推移グラフ（横にスクロールできます）"
      >
        <svg
          viewBox="0 0 880 325"
          role="img"
          aria-labelledby="chart-title chart-description"
        >
          <title id="chart-title">資産推移グラフ</title>
          <desc id="chart-description">
            実線は合計資産、破線は現金、点線は投資。ケースごとに色・線幅とラベルで区別します。上部の点はイベント適用月です。適用月の一覧と同じ数値は下のケース別明細にあります。
          </desc>
          {[0, 0.5, 1].map((fraction) => (
            <g key={fraction} className="chart-axis">
              <line
                x1="122"
                x2="830"
                y1={270 - fraction * 230}
                y2={270 - fraction * 230}
              />
              <text x="110" y={275 - fraction * 230} textAnchor="end">
                {(maximum * fraction).toLocaleString("ja-JP", {
                  notation: "compact",
                  maximumFractionDigits: 1,
                })}
                円
              </text>
            </g>
          ))}
          {results.map(({ c, r }, ci) => (
            <g
              key={c.id}
              className={`chart-case case-${ci}`}
              strokeWidth={2 + ci}
            >
              <polyline
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
              {r.rows.length > 0 && (
                <circle
                  cx={122 + (r.rows.length / input.months) * 708}
                  cy={270 - ((r.rows.at(-1)?.total ?? 0) / maximum) * 230}
                  r="4"
                  fill="white"
                  stroke="currentColor"
                />
              )}
              {[...new Set(c.events.map((e) => e.month))].map((month) => {
                const index = r.rows.findIndex((x) => x.month === month);
                return index < 0 ? null : (
                  <circle
                    key={month}
                    cx={122 + ((index + 1) / input.months) * 708}
                    cy={12 + ci * 12}
                    r="3"
                    fill="currentColor"
                  />
                );
              })}
            </g>
          ))}
          <text x="122" y="309" fontSize="18">
            開始 {input.startMonth}
          </text>
          <text x="830" y="309" textAnchor="end" fontSize="18">
            期間 {input.months}か月
          </text>
        </svg>
      </div>
      <div className="chart-legend" aria-label="グラフの凡例">
        <span>
          <i className="legend-line" />
          合計資産（実線）
        </span>
        <span>
          <i className="legend-line cash-line" />
          現金（破線）
        </span>
        <span>
          <i className="legend-line investment-line" />
          投資（点線）
        </span>
      </div>
      <ul className="case-legend">
        {results.map(({ c, r }, ci) => (
          <li key={c.id} className={`case-${ci}`}>
            <span className="case-dot" aria-hidden="true" />
            <strong>{c.name}</strong>
            <span>
              線幅 {2 + ci} / 計算終了: {r.rows.at(-1)?.month ?? "開始時点"}
            </span>
          </li>
        ))}
      </ul>
      {results.map(({ c, r }, ci) => (
        <article className={`result-card case-${ci}`} key={c.id}>
          <h3>
            <span className="case-dot" aria-hidden="true" />
            {c.name}
          </h3>
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
          <dl className="result-metrics">
            <div>
              <dt>終了時資産</dt>
              <dd>
                {r.reason === "overflow" || r.firstShortfall
                  ? "未計算"
                  : yen(r.rows.at(-1)?.total ?? r.initial.total)}
              </dd>
            </div>
            <div>
              <dt>計算期間</dt>
              <dd>
                {r.rows.length}
                <small> / {input.months}か月</small>
              </dd>
            </div>
            <div>
              <dt>初回資金不足</dt>
              <dd>
                {r.firstShortfall
                  ? r.firstShortfall.month
                  : r.reason === "overflow"
                    ? "判定不可"
                    : "なし"}
              </dd>
            </div>
          </dl>
          <p className="assumptions">
            仮定: 手取り {yen(c.income)}、生活費 {yen(c.living)}、投資配分{" "}
            {c.allocation}%、年利回り {c.annualReturn}%、年生活費上昇率{" "}
            {c.annualInflation}%、{input.startMonth}から{input.months}か月。
          </p>
          {c.events.length > 0 && (
            <p className="event-months">
              グラフ上のイベント適用月:{" "}
              {[...new Set(c.events.map((e) => e.month))]
                .filter((month) => r.rows.some((row) => row.month === month))
                .sort()
                .join("、") || "なし"}
              （同月の点はまとめて表示。計算終了後は表示しません。）
            </p>
          )}
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
