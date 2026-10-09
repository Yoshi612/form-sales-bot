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
  contactDate: "接触日",
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
      salesOk: get("salesOk"),
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
  // 担当者が確認して付けた「利用可」は、営業お断りが見つかった場合を除いて残す
  const current = cellText(r.getCell(header[COLS.salesOk]));
  if (!(current === "利用可" && result.salesOk !== "禁止")) r.getCell(header[COLS.salesOk]).value = result.salesOk;
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
    (result.filled || []).join("\n"),
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

/** 自動チェック詳細シートに記録された「入力した項目」（担当者が確認した内容） */
export function approvedFilled(list, no) {
  const ds = list.wb.getWorksheet(DETAIL_SHEET);
  let text = null;
  ds?.eachRow((r, n) => {
    if (n > 1 && String(r.getCell(1).value) === String(no)) text = cellText(r.getCell(7));
  });
  return text;
}

const SEND_SHEET = "送信記録";

/** 送信結果を、送信ステータス・接触日・備考と「送信記録」シートに書く */
export function writeSend(list, row, res) {
  const { ws, header } = list;
  const r = ws.getRow(row.rowNumber);
  if (res.sendStatus) r.getCell(header[COLS.sendStatus]).value = res.sendStatus;
  if (res.contactDate && header[COLS.contactDate]) r.getCell(header[COLS.contactDate]).value = res.contactDate;
  if (res.salesOk) r.getCell(header[COLS.salesOk]).value = res.salesOk;
  if (header[COLS.note] && res.note) {
    const cell = r.getCell(header[COLS.note]);
    const prev = cellText(cell);
    cell.value = prev ? `${prev}\n[送信] ${res.note}` : `[送信] ${res.note}`;
  }
  r.commit();

  let ss = list.wb.getWorksheet(SEND_SHEET);
  if (!ss) {
    ss = list.wb.addWorksheet(SEND_SHEET);
    ss.columns = [
      { header: "日時", width: 20 },
      { header: "No", width: 5 },
      { header: "企業名", width: 28 },
      { header: "問い合わせURL", width: 45 },
      { header: "結果", width: 22 },
      { header: "詳細", width: 50 },
      { header: "送信前の画面", width: 32 },
      { header: "送信後の画面", width: 32 },
    ];
    ss.getRow(1).font = { bold: true };
  }
  ss.addRow([new Date().toLocaleString("ja-JP"), row.no, row.company, row.contactUrl, res.result, res.detail || "", res.beforeShot || "", res.afterShot || ""]);
}
