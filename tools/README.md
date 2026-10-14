# 新しい営業リストを作って送るまでの手順（tools/）

上司のルール「送信OKはフォーム画面を必ず確認してから送信する」に沿って、
**調査 → 業者マスタ照合 → フォーム入力（送信しない）→ 担当者が画面確認 → 承認した会社だけ送信** の順に進める。

## 0. 準備
- 営業リスト（xlsx）、`config.json`（自社情報・文面）、業者マスタ（SA登録業者の CSV）を用意する。
- 業者マスタは個人情報を含む。**リポジトリに入れない**（`*.csv` は .gitignore 済み）。
- 作業ファイルは `tools/work/` などリポジトリ外か ignore された場所に置く。

## 1. 候補を調べる
- 既存の会社を書き出す: `python3 tools/export_existing.py 営業リスト.xlsx tools/work/existing.txt`
- 候補を1行1社の JSON（jsonl）で集める。項目: `name, area, business, scale, angle, officialUrl, contactUrl, phones, emails, note`
- 調査の条件（これまでの経験から）:
  - 一般のお問い合わせフォームがある（査定・来店予約・在庫問い合わせだけのフォームは不可）
  - フォームに「営業お断り」の記載がない
  - `https://<ドメイン>/wp-json/` が 403 かつ「XSERVER」の画面 → 海外からの送信が拒否されるので除外
  - reCAPTCHA / hCaptcha / 画像・計算クイズの認証があるフォームは除外
  - 大手チェーン本部・オークション会場・メーカー系ディーラーは除外

## 2. 重複除外・連絡先収集・業者マスタ照合
```bash
tools/process_round.sh tools/work/候補.jsonl tools/work/r5 9000 tools/work/existing.txt 業者マスタ.csv
```
- `tools/work/r5_照合結果.txt` を人が読み、送らない会社（登録あり・要確認）を決めて `r5_decide.json` に書く:
  `{"9001": ["登録あり（確実）", "電話番号・社名が一致。送信しない", ["T00123456"]]}`
- 「怪しい業者も含む」が方針。似た名前が同じ地域にあれば「要確認」として送らない。
- 仮の番号（0000000000 など）による一致は誤一致なので無視してよい。

## 3. 営業リストに追加
```bash
python3 tools/build_append.py tools/work/r5_sites.json tools/work/r5_match.json tools/work/r5_decide.json - tools/work/r5_append.json
node tools/append_rows.mjs 営業リスト.xlsx tools/work/r5_append.json   # 末尾の No. の続きに追加。登録ありは SA登録 列に記載して「対象外」
```

## 4. フォームに入力して画面を撮る（送信しない）
```bash
CHROMIUM_PATH=... node src/index.js --input 営業リスト.xlsx --output 営業リスト.xlsx --only 277,278,...
python3 tools/build_review.py <screenshotsのある場所> 確認.html config.json 営業リスト.xlsx 277 [手作業扱い.json]
```
- 入力内容（自動チェック詳細シート）とスクリーンショットを見て、欄の読み違いがある会社は「手作業扱い.json」に入れる。
- 確認ページを担当者に渡す。

## 5. 承認された会社だけ送る
```bash
node tools/approve.mjs 営業リスト.xlsx 2026-10-14 277,278,...      # 営業利用可否＝利用可（SA登録あり・送信済みは変えない）
CHROMIUM_PATH=... node src/send.js --input 営業リスト.xlsx --only 277,278,...   # 1回10社まで
```
- 送信結果は「送信済み／送信結果不明／未送信」。**送信結果不明は再送しない**。
- 送信後の画面（send_screenshots/）で原因を確かめ、届いていないと確実に分かった会社だけ
  `node tools/reset_unsent.mjs 営業リスト.xlsx 日付 "No=理由"` で未送信に戻す。

## 6. 手動送信の記録
- 担当者が手動で送った: `node tools/mark_manual.mjs 営業リスト.xlsx 日付 No No ...`
- 担当者が送らないと決めた: `node tools/skip.mjs 営業リスト.xlsx 日付 No,No,...`（見送り。以後自動で送らない）
