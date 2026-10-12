# Issue #24 Railway向け起動修正

基点: `6b82ef09dcb3cca5f83c6fc5c8c0b2ae4d316f2b`。ユーザーがRailwayデプロイに必要な修正を承認したため、待受・依存分類・検証を変更する。外部サービス・資格情報・課金設定は変更しない。

## 変更と検証範囲

- HOST未設定時は127.0.0.1。RailwayではHOST=0.0.0.0を明示し、提供されたPORTを使う。空値・他のホストは起動拒否する。
- npm startが読み込むtsxを同じ固定バージョンのまま本番依存へ移動。ビルドには開発依存、実行には本番依存のみで足りる構成にした。
- 本番起動経路・Googleプロバイダーをそのまま実行するNodeスモーク試験を追加。テスト専用preloadはGoogle discoveryだけに固定の応答を返し、それ以外の外部取得は拒否する。トークン・署名鍵・ユーザー・ログイン済みセッションは作らない。製品からfixtureをimportしない。
- package.jsonの実際のstartコマンドを読み、制限したNode引数として実行する。テストは.envのあるruntimeを拒否し、継承する環境もPATH以外は架空値に限定する。
- GET /のビルド済みHTML、指定PORT、既定のループバック限定、明示HOSTの非ループバック到達（インターフェースがある環境）、未認証API401、Secure/HttpOnly/SameSite Cookie、Googleリダイレクトのstate/nonce/PKCE、SQLite生成・0600、無効HOSTの起動拒否を確認する。
- npm run checkは型検証を含むbuild後にtestを実行する。CIではさらにチェックアウト外の一時ディレクトリへruntimeをコピーし、npm ci --omit=dev後、開発パッケージが存在しない状態で同じスモーク試験を実行する。全試験子プロセスと架空DBは後処理で終了・削除する。

## 公開との区別

これはRailway実機・実Googleログイン・既存ユーザーのデータを用いた試験ではない。公開URL・秘密値・ボリューム・費用の設定、実TLS経由の確認、再起動後の実保存保持、バックアップ運用は別途必要。セキュリティ設定・trust proxy・認証・CSRF・所有者認可の緩和は行っていない。公開用手順はENV/PRODUCTION.mdを参照する。

## 検証結果

Node24.19.0で`npm run check`（型・build・85テスト）、Chromiumによるdesktop/mobile14ブラウザーテスト、`node scripts/check-production-install.mjs`が成功。独立した本番用インストールは80パッケージで、tsxあり・vite/vitest/typescriptなし。既定/明示ループバック、0.0.0.0の非ループバック到達を実確認した。`npm audit --omit=dev --audit-level=high`は0件、`git diff --check`は問題なし。lintスクリプトなし。

通常レビューで、開発者の.envが存在するチェックアウトでは新規テストが止まる点を検出した。Vitest側も必要なファイルだけを一時runtimeへコピーし、.envを読まない構成へ修正した。本番依存検証は別の物理インストールを維持する。
