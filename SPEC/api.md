# 認証・保存API

同一オリジンのみを使用します。金融入力をURLに含めず、すべての応答はno-storeです。CookieはHttpOnly/SameSite=Laxで、本番はSecureです。

|操作|エンドポイント|内容|
|---|---|---|
|Googleログイン|GET `/auth/google`|state/nonce/PKCEトランザクションを開始します。|
|戻り先|GET `/auth/callback`|Googleの署名・issuer・audience・有効期限等を検証し、旧セッションを無効化します。|
|セッション確認|GET `/api/session`|`{user:{id,email},csrfToken}` を返します。|
|ログアウト|POST `/auth/logout`|現在のサーバーセッションを無効化します。|
|保存一覧|GET `/api/scenarios`|本人分の `{scenarios:[Saved]}` を返します。|
|新規保存|POST `/api/scenarios`|本文 `{input}` を保存します。|
|取得|GET `/api/scenarios/:id`|本人のSavedだけを返します。|
|更新|PUT `/api/scenarios/:id`|本文 `{input,version}` で楽観ロックを行います。|
|複製|POST `/api/scenarios/:id/duplicate`|本人の保存入力を新IDで複製します。|
|個別削除|DELETE `/api/scenarios/:id`|本人分を稼働DBから削除します。|
|全削除|DELETE `/api/scenarios`|本人の保存シナリオだけを削除します。|

保存APIとログアウトは `X-Session-User` に画面が認識するユーザーIDを送り、Cookieの認証ユーザーと一致しなければ401にします。これはクライアントに認可を委ねる仕組みではなく、アカウント切替時の混在防止です。所有者IDはサーバーが認証済みセッションから決定します。変更操作はさらに完全一致Originと `X-CSRF-Token` が必要です。

Savedは `{id,version,createdAt,updatedAt,input}` です。inputは共有Zodスキーマを両層で検証します。本文256KiB、50シナリオ/所有者、3ケース/シナリオ、100イベント/ケースを上限とします。認証30要求/15分/IP、API180要求/分/IPです。単一プロキシ運用では共有の保守的な上限になるため、公開前に正当な運用トポロジーを評価します。

未認証・アカウント不一致401、Origin/CSRF不一致403、他人・存在しないID404、版競合409、保存上限・破損422、本文超過413、回数超過429を返します。一般エラーは詳細や金融入力を含めません。
