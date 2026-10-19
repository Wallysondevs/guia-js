/* lab-nativo.js — roda um programa no node NATIVO do laboratório (~/guia-js-lab/lab:
   Ubuntu 26.04 + Node.js v24.22.0 oficial) para comparar com o editor (o JavaScript do Chromium).
   Usado por tools/testar-missoes.js --nativo. Um processo por vez, timeout 60; o programa
   roda com timeout 10, sem rede (-N). Pasta pessoal própria e única por execução do
   testador (vários autores rodam ao mesmo tempo), apagada quando o processo termina.
   - com data-stdin: `node main.js < entrada` (um pipe, como o editor faz com o data-stdin);
   - com data-digitar (o leitor digitando): terminal de verdade (lab -t + tela), uma linha por vez,
     e no fim Ctrl+D; a saída inclui o que foi digitado (o eco), como o terminal da caixa. */
"use strict";
const { spawnSync } = require("child_process");
const os = require("os");
const path = require("path");
const fs = require("fs");

const LAB = process.env.JS_LAB || path.join(os.homedir(), "guia-js-lab/lab");
const TELA = path.join(path.dirname(LAB), "tela");
const NOME = "tm-" + process.pid + "-" + Math.random().toString(36).slice(2, 8);
const PASTA = path.join(path.dirname(LAB), "homes", NOME);
let usada = false;
process.on("exit", () => { if (usada) { try { fs.rmSync(PASTA, { recursive: true, force: true }); } catch (e) { /* ok */ } } });
for (const sinal of ["SIGINT", "SIGTERM"]) process.on(sinal, () => process.exit(130));

function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }
function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function problema() { return fs.existsSync(LAB) ? null : "laboratório não encontrado em " + LAB; }

function preparar(arquivos) {
  return ["cd /home/ana && rm -rf ./* ./.[!.]* 2>/dev/null; cd /home/ana",
    arquivos.map((a) => 'mkdir -p "$(dirname ' + q(a.nome) + ')" && printf %s ' + q(b64(a.codigo)) + " | base64 -d > " + q(a.nome)).join("\n")].join("\n");
}

/** arquivos: [{nome, codigo}] (o 1º roda); opts: {args: [...], stdin: texto, digitar: [linhas]|null}
 *  → { saida (stdout+stderr na ordem), exit, versao } */
function rodar(arquivos, opts) {
  opts = opts || {};
  usada = true;
  const cmd = "node " + q(arquivos[0].nome) + " " + (opts.args || []).map(q).join(" ");
  if (opts.digitar) {
    // 1) prepara a pasta; 2) terminal de verdade
    spawnSync("timeout", ["60", LAB, "-n", NOME, "-N", "--", "bash", "-s"], { input: preparar(arquivos), encoding: "utf8" });
    const linhas = [cmd + "; echo \"@@EXIT@@$?\""].concat(opts.digitar).concat(["\x04"]);
    const r = spawnSync("bash", ["-c", "timeout 60 " + q(LAB) + " -n " + NOME + " -N -t | " + q(TELA)], { input: linhas.join("\n") + "\n", encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    const s = r.stdout || "";
    const i = s.indexOf("$ " + cmd);
    const corpo = i < 0 ? s : s.slice(s.indexOf("\n", i) + 1);
    const m = /@@EXIT@@(\d+)/.exec(corpo);
    return { saida: m ? corpo.slice(0, m.index) : corpo, exit: m ? +m[1] : null, versao: "24", tty: true };
  }
  const script = [
    preparar(arquivos),
    "printf %s " + q(b64(opts.stdin || "")) + " | base64 -d > /tmp/entrada.txt",
    "echo @@RODA@@",
    "timeout 10 " + cmd + " < /tmp/entrada.txt 2>&1; echo \"@@EXIT@@$?\"",
    "node -v",
  ].join("\n");
  const r = spawnSync("timeout", ["60", LAB, "-n", NOME, "-N", "--", "bash", "-s"], { input: script, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.error) throw r.error;
  const s = r.stdout + (r.stderr || "");
  const m = /@@RODA@@\n([\s\S]*?)@@EXIT@@(\d+)\n([^\n]*)/.exec(s);
  if (!m) return { saida: s, exit: null, versao: "?" };
  return { saida: m[1], exit: +m[2], versao: m[3].trim() };
}

// Diferenças conhecidas entre o editor (navegador) e o node do lab
const CONHECIDAS = [
  [/\d+(\.\d+)?ms\b|\d+\.\d{3}s\b/, "tempo medido (console.time, performance.now)"],
  [/Promise \{/, "estado de uma Promise mostrado pelo console.log (o editor só sabe o estado das criadas com new Promise/Promise.resolve/reject)"],
];
function classificar(dif, fonte) {
  const r = new Set();
  for (const l of dif) for (const [re, t] of CONHECIDAS) if (re.test(l)) r.add(t);
  // diferença numa mensagem de erro/aviso nunca é "esperada" por causa do código-fonte: é um achado
  if (dif.some((l) => /Error|Warning|^[-+]\s+at |Node\.js v|^[-+]\s*\^|\[código de saída|código de saída/.test(l))) return Array.from(r);
  if (fonte && /Math\.random\b/.test(fonte)) r.add("números sorteados (Math.random)");
  if (fonte && /\bnew Date\s*\(\s*\)|Date\.now\b|performance\.now|process\.(hrtime|uptime|memoryUsage|cpuUsage)/.test(fonte)) r.add("data, hora e tempo medido");
  if (fonte && /\bfetch\s*\(/.test(fonte)) r.add("rede (o lab roda sem internet; o editor usa o fetch do navegador)");
  if (fonte && /\bos\.(cpus|totalmem|freemem|uptime|loadavg|networkInterfaces|release|version)\b/.test(fonte)) r.add("dados da máquina (node:os)");
  return Array.from(r);
}

// Diferenças linha a linha (LCS simples).  "- " = editor, "+ " = lab
function diferencas(a, b) {
  if (String(a) === String(b)) return [];
  const linhas = (s) => { s = String(s).replace(/\n$/, ""); return s === "" ? [] : s.split("\n").slice(0, 600); };
  const A = linhas(a), B = linhas(b);
  const n = A.length, m = B.length, L = [];
  for (let i = 0; i <= n; i++) L.push(new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const r = []; let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && A[i] === B[j]) { i++; j++; }
    else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { r.push("+ " + B[j]); j++; }
    else { r.push("- " + A[i]); i++; }
  }
  return r;
}

/** editor: {saida, exit} (com o eco, se foi digitado); lab: resultado de rodar() → null (iguais) ou {motivo, esperado:[…], linhas} */
function comparar(editor, lab, fonte) {
  const motivos = [];
  const d = diferencas(editor.saida, lab.saida);
  if (d.length) motivos.push("saída diferente: " + d.slice(0, 4).join(" | ").slice(0, 200));
  if (editor.exit !== lab.exit) motivos.push("código de saída " + editor.exit + " no editor, " + lab.exit + " no lab");
  if (!motivos.length) return null;
  return { motivo: motivos.join("; "), esperado: classificar(d, fonte), linhas: d };
}

module.exports = { rodar, comparar, diferencas, classificar, problema, LAB };
