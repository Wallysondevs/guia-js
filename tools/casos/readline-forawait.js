// stdin: 1\n2\n3
const readline = require("readline");
(async () => { const rl = readline.createInterface({ input: process.stdin }); let n = 0; for await (const l of rl) { n += Number(l); } console.log(n); })();
