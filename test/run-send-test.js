// 送信機能のテスト: npm run test:send
// 架空サイト4つで「自動チェック → 担当者が利用可にする → 送信」を通し、二重送信がないことを確かめる
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import ExcelJS from "exceljs";

const dir = "test/out-send";
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

// テスト用リスト: No.1〜4 を架空サイトに向け、No.5 は「利用可」にしないで送信を拒否されることを確かめる
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile("test/test-list.xlsx");
const ws = wb.worksheets[0];
[4104, 4105, 4106, 4107].forEach((port, i) => {
  ws.getCell(i + 2, 7).value = `http://localhost:${port}/company/`;
  ws.getCell(i + 2, 8).value = null;
});
await wb.xlsx.writeFile(`${dir}/list.xlsx`);

const mock = spawn("node", ["test/mock-send-sites.js"], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 800));
const run = (args) => spawnSync("node", args, { stdio: "inherit", env: { ...process.env, NO_PROXY: "localhost", no_proxy: "localhost" } });

run(["src/index.js", "--input", `${dir}/list.xlsx`, "--output", `${dir}/checked.xlsx`, "--only", "1,2,3,4,5", "--config", "config.example.json"]);

// 担当者が画面を確認して No.1〜4 を「利用可」にした想定
const checked = new ExcelJS.Workbook();
await checked.xlsx.readFile(`${dir}/checked.xlsx`);
[2, 3, 4, 5].forEach((r) => (checked.worksheets[0].getCell(r, 10).value = "利用可"));
await checked.xlsx.writeFile(`${dir}/approved.xlsx`);

run(["src/send.js", "--input", `${dir}/approved.xlsx`, "--output", `${dir}/sent.xlsx`, "--only", "1,2,3,4,5", "--config", "config.example.json"]);

// 2回目: 送信済みの会社は送られないこと
run(["src/send.js", "--input", `${dir}/sent.xlsx`, "--output", `${dir}/sent2.xlsx`, "--only", "1,2", "--config", "config.example.json"]);

const counts = {};
for (const port of [4104, 4105, 4106, 4107]) counts[port] = Number(await (await fetch(`http://localhost:${port}/count`)).text());
mock.kill();

const out = new ExcelJS.Workbook();
await out.xlsx.readFile(`${dir}/sent.xlsx`);
const status = [2, 3, 4, 5, 6].map((r) => `No.${r - 1}: ${out.worksheets[0].getCell(r, 11).value} / ${out.worksheets[0].getCell(r, 12).value ?? ""}`);
console.log("\n送信ステータス:", status);
console.log("サイトが受け付けた送信の回数:", counts);

const expect = { 4104: 1, 4105: 1, 4106: 0, 4107: 1 };
const ok = Object.entries(expect).every(([p, n]) => counts[p] === n);
console.log(ok ? "\nOK: 送信回数が期待どおり（二重送信なし）" : "\nNG: 送信回数が期待と違う");
process.exit(ok ? 0 : 1);
