# form-sales-bot — クラウドセッションでの実行手順

ユーザーは会社PCに何もインストールせず、このクラウドセッションで実行を依頼する。

1. `npm install`（`npm run setup` は不要。Chromium はプリインストール済み）
2. ユーザーが添付した営業リスト xlsx と `config.json` を使う。
   `config.json` が添付されていなければ、`config.example.json` を元に自社情報を聞いて作る（git にはコミットしない）。
3. 実行（Chromium のパスを指定する）:
   ```bash
   CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
     node src/index.js --input <リスト.xlsx> --output <scratchpad>/結果.xlsx --only 1,2,3
   ```
   外部サイトに繋がらない場合は、環境の Network access 設定の問題なのでユーザーに伝える。
4. 結果の xlsx と `screenshots/` のうち主要なものを SendUserFile で返し、各社の結果を表で要約する。
   フォームURLが採用・査定フォームになっていないか、入力欄のずれがないかをスクリーンショットで確認して報告する。

## 守ること

- 送信ボタンは押さない。送信機能は未実装で、追加はユーザーが明示的に依頼したときだけ。
- 「営業利用可否」を自動で「利用可」にしない。
- 1社ごとの待ち時間（`settings.delayMs`）を短くしない。
