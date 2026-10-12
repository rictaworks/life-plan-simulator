# 人生設計シミュレーター

生活費を確保した後の黒字を貯蓄・投資へ配分し、円建ての月次資産を比較します。Googleログイン後、本人専用サーバーへ明示保存できます。税・手数料・年金・借入は計算しません。

Node.js 24 LTSを使用します。`npm ci`、`npm run check`で型・テスト・ビルドを確認します。`npm run test:e2e`は架空の認証応答でブラウザーとAPIの連携を確認します。ライブGoogle認証の試験ではありません。

ローカル起動は `npm run build` 後、管理者が提供する環境設定を.envまたはプロセス環境に渡して `npm start` です。設定項目は [.env.example](.env.example)、開発手順は [ENV/DEVELOPMENT.md](ENV/DEVELOPMENT.md) を参照してください。**自動ログインはありません。** 設定不足時は起動を拒否します。OAuthクライアントや秘密をこのリポジトリから生成しません。

画面一覧: [ログイン・条件設定・結果・比較・本人専用保存管理](http://localhost:3000/) は同じページで認証状態に応じて表示します。Googleからの戻り先は `/auth/callback` です。

API一覧: [認証・保存API仕様](SPEC/api.md) に全エンドポイントを記載しています。データ契約・計算仕様は [requirements.md](requirements.md)、実装判断は [SPEC/architecture.md](SPEC/architecture.md) を参照してください。

保存はAES-256-GCMで財務JSONを暗号化するSQLiteです。所有者を各APIで認可し、更新版の競合を拒否します。メールはセッション中のメモリーだけで保持し、サーバー再起動時は再ログインします。別端末でも同じGoogle識別子なら保存済みシナリオを読み込めます。ブラウザーへの永続保存、自動保存、解析・外部AI送信は行いません。

コミット前は独立securityレビュー、マージ前はreviewer/pr-checkerの実施記録を `scripts/review-gate.mjs` で現在のファイル内容に紐付けます。ローカルのコミットフックは `git config core.hooksPath .githooks` で有効にします。マージ前には `sh scripts/pre-merge.sh` を明示的に実行します。記録は担当者によるレビュー完了の申告であり、自動のコードレビューやGitHub上のマージ制限ではありません。記録はレビュー完了後にのみ作成し、ファイル変更後は再レビューします。CIは検証のみでデプロイしません。

公開前設定は [ENV/PRODUCTION.md](ENV/PRODUCTION.md) を参照してください。実施結果は [WORK](WORK) に記録しています。視覚デザインは、全94候補へのJev評価と低信頼度結果に対する人の採用承認を経た `veliora-sales` です。[選定・採用証跡](WORK/design-access.md)と[画面仕様](app-ui/README.md)を参照してください。公開サンプルの紺・オレンジを既存の認証付きアプリへ適用しており、Google本番認証や公開運用の構成完了を意味しません。
