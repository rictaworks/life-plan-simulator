# Issue #26: Railway client IP

Railway公開後、X-Forwarded-Forとtrust proxy=falseの警告および共有IPの制限枠が報告された。全体のproxy信頼を緩めず、認証/APIのキーに限り明示設定でX-Real-IPを採用する。

- `RATE_LIMIT_IP_SOURCE=socket`が既定。`socket`/`railway-edge`以外の値は拒否。
- Express trust proxy=falseを固定。両リミッターに同じキー選択を配線。
- 有効な単一X-Real-IPだけを採用。不正・重複・リスト・zoneはソケットへフォールバック。IPv6 /56とmapped IPv4の正規化は既存express-rate-limitを使用。
- XFF/Forwarded/CFヘッダーはキーに使わない。警告だけを無効化する変更ではない。
- 依存追加、Railway操作、OAuth設定、秘密情報の変更はない。

公式資料と従業員回答・運用条件はENV/PRODUCTION.mdにリンク付きで記録。Railwayエッジによる上書きはprivate/TCP経路へ適用されない。TCP Proxy等の別公開入口がなく、private接続可能な全サービスを信頼できることがopt-inの前提。アプリ単独でその入口を証明する仕組みはない。実環境の確認は管理者へ引き継ぐ。

RailpackのInstallは`RAILPACK_INSTALL_CMD=npm ci --include=dev`、Buildは`npm run build`、Startは`npm start`に分ける。既存環境から報告されたbuild中npm ciのEBUSYを記録し、一般的な必発障害とはしていない。

検証: npm run check (92 tests)、Playwright desktop/mobile/accessibility (14 tests)、隔離したnpm ci --omit=dev後の本番エントリーポイント起動、production依存audit。試験は架空IPとGoogle discoveryのテスト応答だけを使用。実エッジの書換え、実Googleログイン、保存/再起動の本番確認を意味しない。
