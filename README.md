# むしよけ（デモ）

HTML/CSS/JS のみで動作する高周波トーンの実験アプリです。FM変調モード、投票（効いた/効かない/不明）、共有、リアルタイム集計（Firebase/ローカルフォールバック）に対応。防虫効果は科学的に保証しません。

## 使い方
- `index.html` をブラウザで開きます。
- 「通常トーン / 虫よけFM」を選択し、「再生開始」で音をON/OFF。
- 周波数（16–22kHz）・音量をスライダーで調整。
- 体感結果を「効いた / 効かない / 不明」でワンタップ投票。
- 「結果を共有」でハッシュタグ `#MosquitoTest2025` を含むテキストを共有（Web Share 非対応環境では自動コピー）。
- Firebase未設定時はローカル集計でチャートが動作します。

## リアルタイム集計（任意・Firebase）
1. `firebase-config.example.js` を `firebase-config.js` にコピーし、Firebaseコンソールの設定で値を埋める。
2. Firebaseで Firestore を有効化。
3. ルールは用途に合わせて設定してください（例: デモ用途の簡易ルール）
   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if true; // デモ用。必ず本番では制限してください
       }
     }
   }
   ```
4. 本アプリが使用するコレクション
   - `mosquitoVotes`（原票）
   - `mosquitoVotesAgg/global`（集計ドキュメント: { good, bad, unknown }）

注意: 本番では認証やCloud Functions等でサーバーサイド集計を推奨します。

## 構成
- `index.html` — UI（モード選択/投票/チャート/アニメ）
- `styles.css` — スタイル（ダークテーマ、投票チップ、蚊アニメ）
- `script.js` — 音声生成（トーン/FM）、投票、共有、集計（Chart.js / Firestore）
- `firebase-config.example.js` — Firebase設定の雛形

## 注意事項
- 一部デバイス／スピーカーは高周波を再生できません。
- 聴力保護のため音量は控えめに。
- 実際の防虫効果は保証しません（技術デモ）。
