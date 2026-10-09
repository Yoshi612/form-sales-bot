// 架空サイトで動作確認: npm test
import { spawn } from "node:child_process";
const mock = spawn("node", ["test/mock-sites.js"], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 800));
const run = spawn("node", ["src/index.js", "--input", "test/test-list.xlsx", "--output", "test/out/result.xlsx", "--only", "1,2,3", "--config", "config.example.json"], { stdio: "inherit" });
run.on("exit", (code) => { mock.kill(); process.exit(code); });
