#!/usr/bin/env node
// sim.js — roda um programa como o editor do guia rodaria (o MESMO assets/jssim.js e o MESMO
// worker, num Chromium headless de verdade) e mostra o terminal da caixa e o código de saída.
//
//   timeout 60 node tools/sim.js main.js [contas.js dados.txt…] [opções]
//   timeout 60 node tools/sim.js -e 'console.log("oi")' [opções]
//   timeout 60 node tools/sim.js - [contas.js…] [opções] < programa.js   (o programa vem da entrada; vira main.js)
//
// O 1º arquivo é o que roda (node main.js); os outros vão para a mesma pasta (/home/ana),
// mantendo a subpasta relativa à do 1º (como data-file="lib/contas.js").
//   --stdin TEXTO     o data-stdin da caixa ("Ana\n30": \n = Enter): o que a entrada padrão entrega
//   --digitar TEXTO   o leitor DIGITANDO no terminal da caixa (sem data-stdin): uma linha por \n
//   --args "a 'b c'"  o data-args (process.argv[2], process.argv[3]…)
//   --goal META       o data-goal: diz se a missão passaria e qual meta falhou
//   --repl            o modo interativo (data-repl): "node"; as linhas do --digitar são o que se digita no "> "
//   --tempo MS        limite (padrão 10000, como o editor)
//   --json            o resultado em JSON
// Sem --stdin nem --digitar, quando o programa lê o teclado o testador manda Ctrl+D (fim da
// entrada). No editor o leitor digitaria.
"use strict";
const fs = require("fs");
const path = require("path");
const JsSim = require("../assets/jssim.js");

const a = process.argv.slice(2);
const arqs = [];
let codigo = null, stdin = null, digitar = null, args = [], goal = null, tempo = 10000, json = false, repl = false;
function uso(c) {
  console.error("uso: timeout 60 node tools/sim.js main.js [outros…] [--stdin TEXTO | --digitar TEXTO] [--args \"a b\"] [--goal META] [--repl] [--tempo MS] [--json]\n" +
    "     timeout 60 node tools/sim.js -e 'CÓDIGO' […]\n" +
    "     timeout 60 node tools/sim.js - […] < programa.js");
  process.exit(c);
}
for (let i = 0; i < a.length; i++) {
  const x = a[i];
  if (x === "-e" || x === "-c") codigo = a[++i];
  else if (x === "--stdin") stdin = a[++i];
  else if (x === "--digitar") digitar = a[++i];
  else if (x === "--args") args = JsSim.dividirArgs(a[++i]);
  else if (x === "--goal") goal = a[++i];
  else if (x === "--tempo") tempo = +a[++i];
  else if (x === "--json") json = true;
  else if (x === "--repl") repl = true;
  else if (x === "-h" || x === "--help") uso(0);
  else if (x.startsWith("--")) { console.error("opção desconhecida: " + x); uso(2); }
  else arqs.push(x);
}
if (codigo === null && !arqs.length && !repl) uso(2);
if (repl && stdin !== null) { console.error("--repl usa --digitar (no modo interativo o leitor digita)"); process.exit(2); }
const arquivos = [];
if (codigo !== null) arquivos.push({ nome: "main.js", codigo: JsSim.comEnter(codigo) });
let base = null;
for (const p of arqs) {
  if (p === "-") { arquivos.push({ nome: "main.js", codigo: fs.readFileSync(0, "utf8") }); if (base === null) base = process.cwd(); continue; }
  if (!fs.existsSync(p)) { console.error("não achei " + p); process.exit(2); }
  const c = fs.readFileSync(p, "utf8");
  let nome = path.basename(p);
  if (base === null) base = path.dirname(path.resolve(p));
  else {
    const rel = path.relative(base, path.resolve(p));
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) nome = rel.split(path.sep).join("/");
  }
  arquivos.push({ nome, codigo: JsSim.comEnter(c) });
}
if (!arquivos.length) arquivos.push({ nome: "main.js", codigo: "" });
const soRepl = repl && !arquivos[0].codigo.trim();

(async () => {
  const { abrirMotor } = require("./motor-navegador.js");
  const m = await abrirMotor();
  const req = { arquivos, args, repl: repl ? (soRepl ? "so" : true) : false, stdin: stdin !== null ? JsSim.textoEntrada(stdin) : null };
  const linhas = digitar !== null ? JsSim.decodificarAttr(digitar).replace(/\n$/, "").split("\n") : null;
  const r = await m.rodar(req, { digitar: linhas, tempo });
  await m.fechar();
  let falhas = null;
  if (goal && !r.interrompido) {
    falhas = JsSim.checarMeta(goal, { out: r.saida, excecao: r.excecao, traceback: r.traceback, exit: r.exit, src: arquivos.map((x) => x.codigo.replace(/\n$/, "")).join("\n"), arquivos: r.arquivos });
  }
  if (json) {
    console.log(JSON.stringify({ saida: r.saida, segs: r.segs, eco: r.eco, exit: r.exit, excecao: r.excecao, traceback: r.traceback, interrompido: r.interrompido, motivo: r.motivo, arquivos: r.arquivos, modo: r.modo, ms: r.ms, chromium: m.info.chromium, falhas }, null, 1));
  } else {
    // o terminal da caixa: a saída com o que foi digitado no meio (o eco)
    let tela = "ana@notebook:~$ " + JsSim.linhaComando(arquivos[0].nome, args, repl) + "\n";
    tela += r.segs.map((x) => x.s).join("");
    process.stdout.write(tela);
    if (!/\n$/.test(tela)) process.stdout.write("\n");
    if (r.interrompido) {
      console.log(r.motivo === "tempo" ? "(o editor parou o programa: ele rodou mais de " + tempo / 1000 + " segundos sem terminar — laço infinito?)\n[programa interrompido]"
        : r.motivo === "limite" ? "(o programa escreveu demais: mais de 2 milhões de caracteres; o editor o parou)\n[programa interrompido]"
        : "(o editor falhou: " + String(r.msg || r.motivo).split("\n")[0] + ")\n[programa interrompido]");
    } else console.log("[código de saída: " + r.exit + "]");
    const extra = [];
    if (r.excecao) extra.push("terminou com erro não tratado");
    if (r.eco && r.eco.length) extra.push("digitado: " + JSON.stringify(r.eco.join("")) + " (no editor aparece no meio da saída; não conta para out:)");
    if (stdin === null && digitar === null && r.pediuTeclado) extra.push("o programa leu o teclado: sem --stdin/--digitar o testador mandou Ctrl+D; no editor, sem data-stdin, o leitor digita");
    console.log("-- editor: " + (/Firefox/.test(m.info.chromium) ? m.info.chromium : "Chromium " + m.info.chromium) + " (" + r.modo + "), " + r.ms + " ms" + (extra.length ? "; " + extra.join("; ") : ""));
    if (goal) {
      if (falhas === null) console.log("-- meta: não avaliada (o programa foi interrompido)");
      else if (!falhas.length) console.log("-- meta \"" + goal + "\": CUMPRIDA");
      else console.log("-- meta \"" + goal + "\": NÃO cumprida; falharam: " + falhas.join(" ;; "));
    }
  }
  process.exitCode = r.interrompido ? 3 : (falhas && falhas.length ? 1 : 0);
})().catch((e) => { console.error("erro: " + (e.stack || e)); process.exitCode = 2; });
