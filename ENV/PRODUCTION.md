# Railwayへの公開設定

ユーザーからRailwayへのデプロイに必要な修正を承認済みです。本書と起動試験は公開完了を意味しません。実際のリソース・費用・秘密設定は管理者が承認した対象で別途行います。

## ビルドと起動

- Node.js **24.x**、単一レプリカを使用します。
- Install: Railway変数`RAILPACK_INSTALL_CMD=npm ci --include=dev`を明示設定します。`NODE_ENV=production`でも型検証・Vite用の開発依存をビルド段階に入れます。
- Build: `npm run build`（型検証と静的UIを`dist/`へ生成）。サーバーJSへのコンパイルではありません。
- Start: `npm start`。実体は `node --env-file-if-exists=.env --import tsx src/server/main.ts`。`tsx`は本番依存に含みます。
- 実行用のクリーンな段階では `npm ci --omit=dev` を利用できます。`package.json`・lockfile・`src/`・`dist/`を保持してください。buildと同じ段階でdev依存を省略するとビルドできません。
- RailwayのStart Commandは`npm start`、Build Commandは`npm run build`。ビルダーが開発依存を省略する設定の場合は、Install段階を上記コマンドに明示設定します。

InstallコマンドをBuild Commandへ移しません。既存環境ではbuild中の`npm ci`がマウントされたViteキャッシュを削除しようとして`EBUSY`になりました。現行Railpackのキャッシュ自動回避機能に依存せず、install/build/startを上記の段階へ分けます。実環境の設定変更は別途管理者が行います。

ビルド後に`node scripts/check-production-install.mjs`で、隔離一時ディレクトリへの`npm ci --omit=dev`と実エントリーポイントの起動を検証できます。CIでも実行します。Google discoveryだけをテスト用応答に置き換え、実Googleログインや本番秘密を使用しません。

## Variables

| 名前                   | 設定                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`             | `production`                                                                                           |
| `HOST`                 | Railwayへ直接公開するときだけ`0.0.0.0`。未指定は`127.0.0.1`。両者以外・空文字は起動拒否                |
| `RATE_LIMIT_IP_SOURCE` | 未指定は`socket`。下記の入口条件を確認した場合のみ`railway-edge`。他の値・空文字は起動拒否             |
| `PORT`                 | Railwayから提供された値を使用。未指定時のローカル既定値は`3000`。公開ドメインのtarget portも一致させる |
| `APP_ORIGIN`           | 実際の正確なHTTPSオリジン。末尾スラッシュ・パスを含めない                                              |
| `GOOGLE_CLIENT_ID`     | 管理者提供のWeb applicationクライアントID                                                              |
| `GOOGLE_CLIENT_SECRET` | 同クライアントの秘密。ログ・Git・チャットへ記録しない                                                  |
| `DATA_ENCRYPTION_KEY`  | 管理者提供の固定32バイト鍵を64桁16進で設定。再起動ごとに生成しない                                     |
| `DATABASE_PATH`        | 永続ボリューム内の絶対ファイルパス。例:`/data/life-plan.sqlite`                                        |

GoogleのAuthorized redirect URIsは `${APP_ORIGIN}/auth/callback` と完全一致させます。アプリの要求スコープは`openid email`です。クライアント新規作成・秘密入力はこのコード修正で行いません。

`HOST`は待受アドレスだけを変更します。HTTPSオリジン検証、Secure/HttpOnly/SameSite Cookie、CSRF、所有者認可は維持します。Expressの`trust proxy`は常にfalseです。レート制限のみ下記設定でクライアントIPを選べます。RailwayのTLS終端からHTTPで転送されても`NODE_ENV=production`のCookieはSecureです。

## Railwayでのレート制限と信頼境界

既定の`RATE_LIMIT_IP_SOURCE=socket`は接続元ソケットだけを使用し、転送ヘッダーを無視します。Railway経由では利用者が同じ枠を共有するため、公開エッジを使う環境では次の条件を管理者が確認してから`railway-edge`へ切り替えます。

- 公開入口はRailway HTTPエッジのみ。アプリのポートへ到達するTCP Proxyや別の直接公開経路がないこと。
- 同じproject/environmentでprivate networkからこのポートへ到達できる**すべてのサービス**を信頼できること。現在呼び出しているサービスだけではありません。
- 実際の公開経路で、異なる利用者の制限枠が分かれ、送信者が付けた`X-Real-IP`がエッジによって上書きされることを確認すること。

Railway公式仕様と従業員回答ではHTTPエッジが`X-Real-IP`を実クライアントIPで上書きします。一方、private通信とTCP Proxyはこの書換えを通りません。固定プロキシCIDR、署名付きヘッダーやmTLSによるエッジ認証は前提にできません。アプリはヘッダーだけでエッジとprivate呼出元を識別できず、信頼したprivateサービスが偽の有効なIPを送れば制限枠を変えられます。条件を確認できない環境では`socket`を維持してください。

`railway-edge`は単一の有効な`X-Real-IP`だけを採用します。欠落、重複、リスト、配列、不正IP、zone identifierはソケットIPへ戻します。`X-Forwarded-For`、`Forwarded`、Cloudflareヘッダー、RailwayのリクエストIDは判定に使いません。IPv4 mapped IPv6はIPv4へ正規化し、native IPv6はライブラリ標準の/56で集約します。認証30回/15分とAPI180回/分の両方へ適用し、認証・ホスト・プロトコル・Cookieの判断へ波及させません。

カスタムキー生成により既定キー生成器のX-Forwarded-For警告は出ませんが、警告がないことは入口の安全性の証明ではありません。自動試験は合成リクエストで選択処理と起動配線を検証するもので、実Railwayエッジの検証を代替しません。

根拠: [公式ヘッダー仕様](https://docs.railway.com/networking/public-networking/specs-and-limits)、[エッジの上書きに関する従業員回答](https://station.railway.com/questions/security-critical-questions-on-edge-prox-8fddd775)、[private/TCP経路と信頼条件の従業員確認](https://station.railway.com/questions/fastapi-uvicorn-trusted-proxy-configura-9c06fa12)、[Express proxy設定](https://expressjs.com/en/guide/behind-proxies.html)、[IP正規化](https://express-rate-limit.mintlify.app/reference/helpers)、[Railpack環境変数](https://railpack.com/config/environment-variables)、[Nodeキャッシュ](https://railpack.com/languages/node#cache--removing-node_modules)。

## 永続保存・公開確認

SQLiteのため単一インスタンス構成です。例ではボリュームを`/data`へマウントし、DB本体とジャーナルを含むディレクトリを永続化します。ビルド・pre-deploy段階でDBを作成しません。実行ユーザーに親ディレクトリの作成・書込とDBのchmod権限が必要です。起動時に作成するディレクトリは0700、DBは0600です。既存ディレクトリ・ボリュームの権限は管理者が確認します。

財務JSONのAES-256-GCM暗号化に加え、永続ボリューム・バックアップの暗号化と鍵の復旧手段を確認します。バックアップ保持期間・復元時の削除再適用・退会運用を確定して利用者へ説明します。本人限定は利用者間の認可で、運用者に読めない保証ではありません。金融入力・Cookie・認証コード・応答本文をTLS終端のログへ記録しません。

公開の完了確認は、HTTPS、実Googleログイン、未認証アクセス拒否、本人のみの保存・再読込・削除、再起動後の保存保持を架空シナリオで行います。認証迂回やブラウザー試験用fixtureを本番起動へ入れません。ローカルのdiscoveryモックを使った実エントリーポイント試験は、この公開確認を代替しません。

公式参照: [Railway待受host/port](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)、[永続ボリューム](https://docs.railway.com/volumes)、[Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)。
