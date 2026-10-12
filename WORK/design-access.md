# デザイン選定・採用記録

確認日: 2026-10-12 UTC。Issue #17。

## Jevの実結果と人による採用

- カタログ: rictaworks/context `setup/design-systems-catalog.json`、Git blob `ec944a0369e14779cde9b9ceb6c0de2f02dc3766`。全94件を読み、全94件を候補にした。
- 実行先: `POST https://api.typesafe.ai/v1/systemone`。指定済みNetwork secretの環境プレースホルダーをHTTPSプロキシ経由のAuthorizationにのみ使用。値・ヘッダーを保存していない。
- 要求・応答モデル: `jev-1.13.0`。実結果 `veliora-sales`、確率0.22、confidence **0.21**。入力32,256／出力959トークン。
- 自動採用の事前基準0.70を満たさなかったため採用を保留し、人に確認した。モデルの確信度を変更したり、確信度を上げるための再実行はしていない。
- その後、所有者が低信頼度を知った上で **veliora-salesの採用、実装・テスト・マージまで**を明示承認。親スレッドで検証済みの承認: Slack `C0C8J8G0ECC`、提案メッセージ `1791763583.891609`、所有者 `U0BR9LR0Z7C` のthumbs-upイベント `Ev0C99DMD4QG`。本作業はこの人による採用を根拠に進める。
- 送信許可の別記録: メッセージ `1791762978.628029`、white_check_markイベント `Ev0C7ZKCHU9M`。送信範囲は94件のデザインメタデータと要件。実際の給与・資産等の個人データは送信していない。

## 再現・監査用の証跡

[design-selection/](design-selection/) に、完全なカタログの正規化コピー、実際に受理された `request.json`、応答の `model` / `answers` / `usage` 全体、事前基準と試行記録を置く。応答には全94件の確率を含む。秘密値・Cookie・財務入力は含まない。

最初の全フィールド入力はHTTP 400。同じ入力の診断用再試行で `max_tokens_exceeded` を確認した。候補数を変えずフィールドを一律圧縮した1回の修正版がHTTP 200となった。POSTは合計3回、成功した評価は1回。追加評価は行わない。

受理された入力は全94候補の `name` / `mood` / `background` / `palette` / `fonts` / `shape` / `intended_use` を保持。UUID・読了状態・元行数・imagery・noteは一律に省略し、元カタログは保存した。要件は画面設計に必要な内容を英語で要約した。代理モデルや手作業で候補を絞り込んでいない。

64k全体、32kのstate＋最長questionという制限を確認。ローカル2種の推定器は提供元の計数より少なく見積もったため、推定を正確な提供元トークン数とは扱わない。修正版は約22.5–22.7kと推定され、APIは入力32,256トークンとして受理した。stateとquestion別の正確な内訳は応答にない。再実行時の同一結果は保証しない。

## 公開サンプルの確認範囲

親スレッドのクラウドブラウザーで **https://sample.chartd.net/veliora-sales/** を視覚確認済み。日本語、紺・オレンジ、カード、KPI、FAQを確認。ダッシュボードのチャートはヒーロー内モニター画像であり、実際に操作できる金融フォーム・計算アプリではない。

専用実行環境から同ホストへの直接取得はプロキシCONNECTの403で拒否される。この境界を回避したり、ネットワーク権限を変更していない。公開参照を「未確認」とは扱わず、親スレッドの視覚確認とカタログを出典として、既存アプリのフォーム・結果・明細・比較へ適用する。参照サイトを金融機能の実装根拠にはしない。

## 方針と公式資料

- [分類器・低信頼度時確認の方針](https://github.com/rictaworks/context/blob/4718f4e189f7f4874f5204255bcdc66ffa82810a/setup/Claude/chat/project-instructions.md)
- [AI_POLICY](https://github.com/rictaworks/context/blob/4718f4e189f7f4874f5204255bcdc66ffa82810a/setup/Claude/AI_POLICY.md)
- [公式API](https://docs.typesafe.ai/api)、[モデル・上限](https://docs.typesafe.ai/models)、[confidence](https://docs.typesafe.ai/confidence)。2026-10-12 UTC確認。

独立したサブエージェントが94件の入力対応、モデル・確信度・使用量・証跡ハッシュ・秘密値非含有を確認済み。executorスキル一覧とローカルSKILL.mdは存在せず、インストールされていないスキルを実行済みとは扱わない。コード・セキュリティ・PRの独立レビューは別の検証記録に残す。
