import ExcelJS from "exceljs";

const COLS = {
  no: "No",
  company: "企業名",
  business: "確認できた事業",
  angle: "営業切り口（提案仮説）",
  officialUrl: "公式情報URL",
  contactUrl: "問い合わせURL",
  pageCheck: "問い合わせページ確認",
  salesOk: "営業利用可否",
  sendStatus: "送信ステータス",
  note: "備考",
};

const DETAIL_SHEET = "自動チェック詳細";

function cellText(cell) {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.text) return String(v.text);
    if (v.hyperlink) return String(v.hyperlink);
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.result != null) return String(v.result);
  }
  return String(v).trim();
}

export async function loadList(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.worksheets[0];
  const header = {};
  ws.getRow(1).eachCell((cell, col) => {
    header[cellText(cell)] = col;
  });
  for (const key of ["company", "officialUrl", "contactUrl", "pageCheck", "salesOk"]) {
    if (!header[COLS[key]]) throw new Error(`列「${COLS[key]}」が1行目に見つかりません`);
  }
  const rows = [];
  ws.eachRow((row, r) => {
    if (r === 1) return;
    const get = (key) => (header[COLS[key]] ? cellText(row.getCell(header[COLS[key]])) : "");
    const company = get("company");
    if (!company) return;
    rows.push({
      rowNumber: r,
      no: get("no"),
      company,
      business: get("business"),
      angle: get("angle"),
      officialUrl: get("officialUrl"),
      contactUrl: get("contactUrl"),
      sendStatus: get("sendStatus"),
    });
  });
  return { wb, ws, header, rows };
}

// 元のシートの H/I/J 列と備考を更新し、詳細シートを追加する。送信ステータス列は触らない。
export function writeResult(list, row, result) {
  const { ws, header } = list;
  const r = ws.getRow(row.rowNumber);
  if (result.contactUrl) r.getCell(header[COLS.contactUrl]).value = result.contactUrl;
  r.getCell(header[COLS.pageCheck]).value = result.pageCheck;
  r.getCell(header[COLS.salesOk]).value = result.salesOk;
  if (header[COLS.note] && result.noteAppend) {
    const cell = r.getCell(header[COLS.note]);
    // 再実行したときに [自動] の行が重ならないよう、前回分を消してから追記する
    const prev = cellText(cell).split("\n").filter((l) => !l.startsWith("[自動]")).join("\n");
    cell.value = prev ? `${prev}\n[自動] ${result.noteAppend}` : `[自動] ${result.noteAppend}`;
  }
  r.commit();

  let ds = list.wb.getWorksheet(DETAIL_SHEET);
  if (!ds) {
    ds = list.wb.addWorksheet(DETAIL_SHEET);
    ds.columns = [
      { header: "No", width: 5 },
      { header: "企業名", width: 28 },
      { header: "問い合わせURL", width: 45 },
      { header: "結果", width: 26 },
      { header: "営業お断りの記載", width: 40 },
      { header: "CAPTCHA", width: 14 },
      { header: "入力した項目", width: 45 },
      { header: "埋められなかった必須項目", width: 35 },
      { header: "判定方法", width: 10 },
      { header: "スクリーンショット", width: 30 },
      { header: "チェック日時", width: 20 },
    ];
    ds.getRow(1).font = { bold: true };
  }
  const values = [
    row.no,
    row.company,
    result.contactUrl || "",
    result.status,
    result.noSalesText || "",
    result.captcha || "",
    (result.filled || []).join(", "),
    (result.missingRequired || []).join(", "),
    result.classifier || "",
    result.screenshot || "",
    new Date().toLocaleString("ja-JP"),
  ];
  let existing;
  ds.eachRow((r, n) => {
    if (n > 1 && String(r.getCell(1).value) === String(row.no)) existing = r;
  });
  if (existing) {
    values.forEach((v, i) => (existing.getCell(i + 1).value = v));
    existing.commit();
  } else {
    ds.addRow(values);
  }
}

export async function saveList(list, path) {
  await list.wb.xlsx.writeFile(path);
}
