// 送信テスト用の架空サイト（ポート 4104〜4116）。受け付けた送信の回数を /count で返す
import http from "node:http";

const page = (body) => `<!doctype html><html lang="ja"><meta charset="utf-8"><body>${body}</body></html>`;
const form = (action, extra = "") => `<h1>お問い合わせ</h1><form method="post" action="${action}"><table>
  <tr><th>お名前</th><td><input name="name" required></td></tr>
  <tr><th>メールアドレス</th><td><input type="email" name="email" required></td></tr>
  <tr><th>お問い合わせ内容</th><td><textarea name="body" required></textarea></td></tr>
  ${extra}</table><input type="text" name="contact_sub" style="height:0;width:0;padding:0;margin:0;border:none;overflow:hidden"><span style="opacity:0;position:absolute"><input type="text" name="extra_info" tabindex="-1" autocomplete="off"></span><button type="submit">確 認 画 面 へ</button></form>`;
const received = {};
const readBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

const sites = {
  // 確認画面 → 送信 → 完了
  4104: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/contact/") return page(form("/confirm"));
    if (p === "/confirm") {
      const b = await readBody(req);
      // 見えない罠の欄（ハニーポット）に何か入っていたら、機械の送信として拒否する
      if (/(^|&)(contact_sub|extra_info)=[^&]/.test(b)) return page(`<p>送信に失敗しました。</p>`);
      return page(`<p>以下の内容でよろしければ送信してください。</p><pre>${decodeURIComponent(b).slice(0, 80)}</pre>
        <form method="post" action="/thanks"><input type="hidden" name="d" value="1"><button type="button" onclick="history.back()">戻る</button><button type="submit">送信する</button></form>`);
    }
    if (p === "/thanks") { received[4104] = (received[4104] ?? 0) + 1; return page(`<p>お問い合わせを受け付けました。担当より折り返しご連絡いたします。</p><a href="/">トップへ戻る</a>`); }
  },
  // 同じページのまま送信（Contact Form 7 風）。送信後は入力欄が空になる
  4105: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/api") { received[4105] = (received[4105] ?? 0) + 1; return "ok"; }
    if (p === "/contact/") return page(`<h1>お問い合わせ</h1><form id="f"><input name="name" required><input type="email" name="email" required><textarea name="body" required></textarea><input type="submit" value="送信"><div id="out"></div></form>
      <script>document.getElementById("f").addEventListener("submit", async (e) => { e.preventDefault(); await fetch("/api", {method:"POST"}); e.target.reset(); document.getElementById("out").textContent = "ありがとうございます。メッセージは送信されました。"; });</script>`);
  },
  // 入力エラーで送信できない（電話番号が必須だがツールは入れない種類の欄）
  4106: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/contact/") return page(`<h1>お問い合わせ</h1><form id="f" novalidate><input name="name"><input type="email" name="email"><input name="member_id" placeholder="会員番号"><textarea name="body"></textarea><button type="submit">送信する</button><p id="err"></p></form>
      <script>document.getElementById("f").addEventListener("submit", (e) => { e.preventDefault(); document.getElementById("err").textContent = "会員番号を入力してください"; });</script>`);
  },
  // 確認画面に「ありがとうございます」が出る（ここで完了と誤判定しないこと）
  4107: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/contact/") return page(form("/confirm"));
    if (p === "/confirm") return page(`<p>お問い合わせありがとうございます。以下の内容をご確認のうえ、送信ボタンを押してください。</p><form method="post" action="/thanks"><button type="submit">この内容で送信</button></form>`);
    if (p === "/thanks") { received[4107] = (received[4107] ?? 0) + 1; return page(`<p>送信が完了しました。</p>`); }
  },
  // 別サイトのフォームを iframe で埋め込んでいる（関西オート型）。確認・完了も iframe の中で表示
  4108: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/contact/") return page(`<h1>お問い合わせ</h1><p>お問い合わせありがとうございます。下記にご記入ください。</p><iframe src="/embed" style="width:800px;height:600px"></iframe>`);
    if (p === "/embed") return page(form("/embed/confirm").replace(/<button type="submit">[^<]*<\/button>/, '<input type="image" name="" src="/btn.gif">'));
    if (p === "/embed/confirm") return page(`<p>入力内容をご確認ください。</p><form method="post" action="/embed/thanks"><textarea style="display:none">${"確認用に残された本文。".repeat(10)}</textarea><button type="submit" formaction="/embed">戻る</button><button type="submit">送信する</button></form>`);
    if (p === "/embed/thanks") { received[4108] = (received[4108] ?? 0) + 1; return page(`<p>送信が完了しました。</p>`); }
  },
  // 確認画面で初めて「私はロボットではありません」が出て、送信ボタンが押せない（関西オート型）
  4110: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/contact/") return page(form("/confirm"));
    if (p === "/confirm") return page(`<p>入力内容をご確認ください。</p><form method="post" action="/thanks"><div class="g-recaptcha" data-sitekey="x">私はロボットではありません</div><button type="submit" disabled>送信する</button></form>`);
    if (p === "/thanks") { received[4110] = (received[4110] ?? 0) + 1; return page(`<p>送信が完了しました。</p>`); }
  },
  // 確認画面の送信ボタンを押しても何も起きない（神奈川中古車型）。押すのは1回だけであること
  4111: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/contact/") return page(form("/confirm"));
    if (p === "/confirm") return page(`<p>以下の内容でよろしければ送信してください。</p><button type="button" onclick="fetch('/press',{method:'POST'})">上記の内容で送信します&gt;&gt;</button>`);
    if (p === "/press") { received["4111press"] = (received["4111press"] ?? 0) + 1; return "ok"; }
  },
  // Contact Form 7 のフォームだが、送信窓口（wp-json）が 403 を返す（XSERVER の国外IP制限型）。ボタンを押さないこと
  4112: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p.startsWith("/wp-json/")) return "__403__";
    if (p === "/contact/") return page(`<h1>お問い合わせ</h1><form id="f" class="wpcf7-form"><input type="hidden" name="_wpcf7" value="12"><input name="name" required><input type="email" name="email" required><textarea name="body" required></textarea><input type="submit" value="送信"></form>
      <script>document.getElementById("f").addEventListener("submit", async (e) => { e.preventDefault(); await fetch("/press", {method:"POST"}); });</script>`);
    if (p === "/press") { received[4112] = (received[4112] ?? 0) + 1; return "ok"; }
  },
  // 確認画面が同じページ上の小窓で開き、小窓の「送信する」で送る（カーアシスト吉田型）
  4113: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/api") { received[4113] = (received[4113] ?? 0) + 1; return "ok"; }
    if (p === "/contact/") return page(`<h1>お問い合わせ</h1><form id="f"><input name="name" required><input type="email" name="email" required><textarea name="body" required></textarea><button type="button" id="c">確認画面へ</button></form>
      <div id="m" style="display:none;position:fixed;top:20px;left:20px;background:#fff;border:1px solid #000;padding:20px"><p>入力内容をご確認ください</p><button type="button" id="s">送信する</button><button type="button" onclick="this.parentNode.style.display='none'">キャンセル</button></div><div id="out"></div>
      <script>document.getElementById("c").onclick = () => { document.getElementById("m").style.display = "block"; };
      document.getElementById("s").onclick = async () => { await fetch("/api", {method:"POST"}); document.getElementById("m").remove(); document.getElementById("f").remove(); document.getElementById("out").textContent = "送信が完了しました。"; };</script>`);
  },
  // フリガナ欄が「カタカナのみ（スペース不可）」の書式指定（カセル型）
  4114: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/contact/") return page(form("/thanks", `<tr><th>フリガナ</th><td><input name="kana" pattern="[ァ-ヶー]+" required title="カタカナで入力してください"></td></tr>`));
    if (p === "/thanks") {
      const b = decodeURIComponent((await readBody(req)).replace(/\+/g, " "));
      if (!/(^|&)kana=[ァ-ヶー]+(&|$)/.test(b)) return page(`<p>フリガナはカタカナで入力してください</p>`);
      received[4114] = (received[4114] ?? 0) + 1; return page(`<p>送信が完了しました。</p>`);
    }
  },
  // 送信ボタンを押すと「送信しますか？」の確認ダイアログが出る（クリックセレクト型）
  4115: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/api") { received[4115] = (received[4115] ?? 0) + 1; return "ok"; }
    if (p === "/contact/") return page(`<h1>お問い合わせ</h1><form id="f"><input name="name" required><input type="email" name="email" required><textarea name="body" required></textarea><button type="submit">メールを送信する</button></form><div id="out"></div>
      <script>document.getElementById("f").addEventListener("submit", async (e) => { e.preventDefault(); if (!confirm("送信しますか？")) return; await fetch("/api", {method:"POST"}); e.target.remove(); document.getElementById("out").textContent = "お問い合わせを受け付けました。"; });</script>`);
  },
  // 同じページで送信し、完了の表示を出さずにフォームを空に戻すだけ（YOLO WORLD 型）。空のフォームでもう一度押さないこと
  4116: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/api") { received[4116] = (received[4116] ?? 0) + 1; return "ok"; }
    if (p === "/contact/") return page(`<h1>お問い合わせ</h1><form id="f"><input name="name"><input type="email" name="email"><textarea name="body"></textarea><button type="submit">送信する</button></form><p id="st"></p>
      <script>document.getElementById("f").addEventListener("submit", async (e) => { e.preventDefault(); await fetch("/api", {method:"POST"}); e.target.reset(); document.getElementById("st").textContent = "受付番号：A-12345"; });</script>`);
  },
  // 送信すると 403 を返す（バンガード型）。送信されていない
  4109: async (req, p) => {
    if (p === "/company/") return page(`<a href="/contact/">お問い合わせ</a>`);
    if (p === "/contact/") return page(form("/confirm"));
    if (p === "/confirm") return "__403__";
  },
};

for (const [port, handler] of Object.entries(sites)) {
  http.createServer(async (req, res) => {
    const p = req.url.split("?")[0];
    if (p === "/count") return res.end(JSON.stringify(received[port] ?? 0));
    if (p === "/presscount") return res.end(JSON.stringify(received[port + "press"] ?? 0));
    const html = await handler(req, p === "/" ? "/company/" : p);
    if (html === "__403__") return res.writeHead(403, { "content-type": "text/html" }).end("<h1>403 Forbidden</h1><hr>nginx");
    res.writeHead(html ? 200 : 404, { "content-type": "text/html; charset=utf-8" }).end(html ?? "not found");
  }).listen(Number(port));
}
console.log("mock send sites up");
