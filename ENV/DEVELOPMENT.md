# 開発環境

Node.js 24 LTS、npm、UTF-8を使用します。記録時刻はJSTです。

`npm ci`、`npm run check`で型・テスト・ビルドを確認します。`npm run dev`は127.0.0.1:5173でUIを起動し、APIは3000へ転送します。自動ログインや実運用の認証迂回は実装しません。Googleログインは管理者が別途提供するOAuth設定が必要です。

Vite経由で認証を検証する場合はサーバーも別プロセスで起動し、`APP_ORIGIN=http://127.0.0.1:5173` と対応する登録済みコールバックを使用します。ビルド済みUIを `npm start` で配信する場合は `.env.example` の `http://localhost:3000` を使います。ブラウザーで開くオリジンとAPP_ORIGINを一致させてください。不一致のままCSRF・Origin検証を緩和しません。`DATA_ENCRYPTION_KEY` は管理者提供の32バイト鍵の64桁16進表現、`DATABASE_PATH` は絶対パスです。

ブラウザーテストは架空のAPI応答と、架空IDプロバイダーを注入した実サーバーの両方で実施します。後者は127.0.0.1:4174にのみ待ち受け、DBと暗号鍵はプロセス内だけに保持します。本番起動経路はこのfixtureを読み込みません。`npx playwright install chromium`後、`npm run test:e2e`を実行します。既存Chromiumを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` を利用できます。これはブラウザーの選択のみで、認証・ネットワーク設定を変更しません。

この隔離環境ではnpmキャッシュをリポジトリ内の.npm-cacheに置きます。CIではRUNNER_TEMPで上書きします。ブラウザー試験とAPI試験はGoogle本番ログイン成功を証明するものではありません。

待受は既定で`127.0.0.1`です。`.env.example`も`HOST=127.0.0.1`を指定します。Railwayへ直接公開する環境だけ`HOST=0.0.0.0`を明示します。`HOST`とブラウザー側の`APP_ORIGIN`は別設定です。

`npm run check`は型検証を含むビルド後にテストを実行します。実起動の回帰試験が生成済みHTMLも確認するため、`npm test`を単独実行するときも先に`npm run build`を実行してください。
