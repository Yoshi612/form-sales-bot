// テスト用の架空企業サイト3つ（ポート 4101〜4103）
import http from "node:http";
const page = (body) => `<!doctype html><html lang="ja"><meta charset="utf-8"><body>${body}</body></html>`;
const sites = {
  4101: { // 普通のフォーム（姓名分割・フリガナ・電話3分割・種別select・同意）
    "/company/": page(`<nav><a href="/recruit/">採用情報</a><a href="/satei/">無料査定</a><a href="/contact/">お問い合わせ</a></nav><h1>会社概要</h1>`),
    "/contact/": page(`<h1>お問い合わせ</h1><form><table>
      <tr><th>お問い合わせ種別 必須</th><td><select name="type" required><option>選択してください</option><option>車両の購入について</option><option>その他</option></select></td></tr>
      <tr><th>会社名</th><td><input name="company"></td></tr>
      <tr><th>お名前 必須</th><td><input name="sei" placeholder="姓" required><input name="mei" placeholder="名" required></td></tr>
      <tr><th>フリガナ</th><td><input name="kana_sei" placeholder="セイ"><input name="kana_mei" placeholder="メイ"></td></tr>
      <tr><th>メールアドレス 必須</th><td><input type="email" name="email" required></td></tr>
      <tr><th>メールアドレス（確認）</th><td><input type="email" name="email_confirm" required></td></tr>
      <tr><th>電話番号</th><td><input name="tel1" type="tel">-<input name="tel2" type="tel">-<input name="tel3" type="tel"></td></tr>
      <tr><th>お問い合わせ内容 必須</th><td><textarea name="body" required></textarea></td></tr>
      </table><label><input type="checkbox" name="agree" required>個人情報の取扱いに同意する</label><button type="submit">確認画面へ</button></form>`),
  },
  4102: { // 営業お断り
    "/company/": page(`<a href="/inquiry.html">CONTACT</a>`),
    "/inquiry.html": page(`<p>※営業目的のお問い合わせはご遠慮ください。</p><form><input name="your-name"><input name="your-email" type="email"><textarea name="msg"></textarea><input type="submit"></form>`),
  },
  4103: { // フォームなし、mailtoのみ
    "/company/": page(`<p>お問い合わせは <a href="mailto:info@example.jp">info@example.jp</a> まで</p>`),
  },
};
for (const [port, routes] of Object.entries(sites)) {
  http.createServer((req, res) => {
    const p = req.url.split("?")[0];
    const html = routes[p] ?? (p === "/" ? routes["/company/"] : null);
    res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" }).end(html ?? "not found");
  }).listen(Number(port));
}
console.log("mock sites up");
