# Railwayへの公開設定

ユーザーからRailwayへのデプロイに必要な修正を承認済みです。本書と起動試験は公開完了を意味しません。実際のリソース・費用・秘密設定は管理者が承認した対象で別途行います。

## ビルドと起動

- Node.js **24.x**、単一レプリカを使用します。
- Install: `npm ci --include=dev`。`NODE_ENV=production`でも型検証・Vite用の開発依存をビルド段階に入れます。
- Build: `npm run build`（型検証と静的UIを`dist/`へ生成）。サーバーJSへのコンパイルではありません。
- Start: `npm start`。実体は `node --env-file-if-exists=.env --import tsx src/server/main.ts`。`tsx`は本番依存に含みます。
- 実行用のクリーンな段階では `npm ci --omit=dev` を利用できます。`package.json`・lockfile・`src/`・`dist/`を保持してください。buildと同じ段階でdev依存を省略するとビルドできません。
- RailwayのStart Commandは`npm start`、Build Commandは`npm run build`。ビルダーが開発依存を省略する設定の場合は、Install段階を上記コマンドに明示設定します。

ビルド後に`node scripts/check-production-install.mjs`で、隔離一時ディレクトリへの`npm ci --omit=dev`と実エントリーポイントの起動を検証できます。CIでも実行します。Google discoveryだけをテスト用応答に置き換え、実Googleログインや本番秘密を使用しません。

## Variables

| 名前                   | 設定                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `NODE_ENV`             | `production`                                                                                           |
| `HOST`                 | Railwayへ直接公開するときだけ`0.0.0.0`。未指定は`127.0.0.1`。両者以外・空文字は起動拒否                |
| `PORT`                 | Railwayから提供された値を使用。未指定時のローカル既定値は`3000`。公開ドメインのtarget portも一致させる |
| `APP_ORIGIN`           | 実際の正確なHTTPSオリジン。末尾スラッシュ・パスを含めない                                              |
| `GOOGLE_CLIENT_ID`     | 管理者提供のWeb applicationクライアントID                                                              |
| `GOOGLE_CLIENT_SECRET` | 同クライアントの秘密。ログ・Git・チャットへ記録しない                                                  |
| `DATA_ENCRYPTION_KEY`  | 管理者提供の固定32バイト鍵を64桁16進で設定。再起動ごとに生成しない                                     |
| `DATABASE_PATH`        | 永続ボリューム内の絶対ファイルパス。例:`/data/life-plan.sqlite`                                        |

GoogleのAuthorized redirect URIsは `${APP_ORIGIN}/auth/callback` と完全一致させます。アプリの要求スコープは`openid email`です。クライアント新規作成・秘密入力はこのコード修正で行いません。

`HOST`は待受アドレスだけを変更します。HTTPSオリジン検証、Secure/HttpOnly/SameSite Cookie、CSRF、所有者認可は維持します。転送ヘッダーは信用しません。プロキシ経由のIP制限は利用者で共有される可能性があり、実構成で確認します。RailwayのTLS終端からHTTPで転送されても`NODE_ENV=production`のCookieはSecureです。

## 永続保存・公開確認

SQLiteのため単一インスタンス構成です。例ではボリュームを`/data`へマウントし、DB本体とジャーナルを含むディレクトリを永続化します。ビルド・pre-deploy段階でDBを作成しません。実行ユーザーに親ディレクトリの作成・書込とDBのchmod権限が必要です。起動時に作成するディレクトリは0700、DBは0600です。既存ディレクトリ・ボリュームの権限は管理者が確認します。

財務JSONのAES-256-GCM暗号化に加え、永続ボリューム・バックアップの暗号化と鍵の復旧手段を確認します。バックアップ保持期間・復元時の削除再適用・退会運用を確定して利用者へ説明します。本人限定は利用者間の認可で、運用者に読めない保証ではありません。金融入力・Cookie・認証コード・応答本文をTLS終端のログへ記録しません。

公開の完了確認は、HTTPS、実Googleログイン、未認証アクセス拒否、本人のみの保存・再読込・削除、再起動後の保存保持を架空シナリオで行います。認証迂回やブラウザー試験用fixtureを本番起動へ入れません。ローカルのdiscoveryモックを使った実エントリーポイント試験は、この公開確認を代替しません。

公式参照: [Railway待受host/port](https://docs.railway.com/networking/troubleshooting/application-failed-to-respond)、[永続ボリューム](https://docs.railway.com/volumes)、[Google Web OAuth](https://developers.google.com/identity/protocols/oauth2/web-server)。
