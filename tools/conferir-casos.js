#!/usr/bin/env node
// conferir-casos.js — a bateria de fidelidade do editor: cada programa de tools/casos/ roda no
// editor (Chromium headless, o mesmo jssim) e no Node.js v24.22.0 do lab, e as saídas são comparadas.
//
//   timeout 900 node tools/conferir-casos.js [filtro…] [-v]
//
// Um caso é um arquivo tools/casos/NOME.js (ou .mjs/.cjs) ou uma pasta tools/casos/NOME/ (o
// main.js e as outras abas). Comentários na 1ª linha (opcionais):
//   // stdin: Ana\n30      // digitar: Ana\n30      // args: a 'b c'
// A saída do lab fica guardada em tools/casos/.lab/ (refeita quando o caso muda).
// -v mostra as diferenças inteiras.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const JsSim = require("../assets/jssim.js");
const lab = require("./lab-nativo.js");

const DIR = path.join(__dirname, "casos");
const CACHE = path.join(DIR, ".lab");
const args = process.argv.slice(2);
const verboso = args.includes("-v");
const filtros = args.filter((a) => !a.startsWith("-"));

function carregar(nome) {
  const p = path.join(DIR, nome);
  let arquivos;
  if (fs.statSync(p).isDirectory()) {
    const lista = fs.readdirSync(p).sort((a, b) => (a === "main.js" || a === "main.mjs" ? -1 : b === "main.js" || b === "main.mjs" ? 1 : a.localeCompare(b)));
    arquivos = lista.map((f) => ({ nome: f, codigo: fs.readFileSync(path.join(p, f), "utf8") }));
  } else arquivos = [{ nome: /\.mjs$/.test(nome) ? "main.mjs" : /\.cjs$/.test(nome) ? "main.cjs" : "main.js", codigo: fs.readFileSync(p, "utf8") }];
  const l1 = arquivos[0].codigo.split("\n")[0];
  const opc = {};
  const m = /^\/\/\s*(stdin|digitar|args):\s?(.*)$/.exec(l1);
  if (m) opc[m[1]] = m[2];
  return { nome, arquivos, opc };
}

(async () => {
  const nomes = fs.readdirSync(DIR).filter((f) => !f.startsWith(".") && (/\.(c|m)?js$/.test(f) || fs.statSync(path.join(DIR, f)).isDirectory()))
    .filter((f) => !filtros.length || filtros.some((x) => f.includes(x))).sort();
  fs.mkdirSync(CACHE, { recursive: true });
  const { abrirMotor } = require("./motor-navegador.js");
  const motor = await abrirMotor();
  let iguais = 0, difs = 0;
  for (const nome of nomes) {
    const c = carregar(nome);
    const digitar = c.opc.digitar !== undefined ? JsSim.decodificarAttr(c.opc.digitar).split("\n") : null;
    const req = { arquivos: c.arquivos.map((a) => ({ nome: a.nome, codigo: JsSim.comEnter(a.codigo) })), args: c.opc.args ? JsSim.dividirArgs(c.opc.args) : [], stdin: c.opc.stdin !== undefined ? JsSim.textoEntrada(c.opc.stdin) : (digitar ? null : ""), repl: false };
    const r = await motor.rodar(req, { digitar });
    const ed = { saida: digitar ? r.segs.map((x) => x.s).join("") : r.saida, exit: r.interrompido ? "interrompido:" + r.motivo : r.exit };
    const chave = crypto.createHash("sha1").update(JSON.stringify(req) + JSON.stringify(digitar)).digest("hex").slice(0, 16);
    const arqCache = path.join(CACHE, nome.replace(/\W/g, "_") + "-" + chave + ".json");
    let n;
    if (fs.existsSync(arqCache)) n = JSON.parse(fs.readFileSync(arqCache, "utf8"));
    else { n = lab.rodar(req.arquivos, { args: req.args, stdin: req.stdin || "", digitar }); fs.writeFileSync(arqCache, JSON.stringify(n)); }
    const d = lab.comparar(ed, n, "");
    if (!d) { iguais++; console.log("  igual  " + nome); continue; }
    difs++;
    console.log("  DIFER  " + nome + ": " + d.motivo.slice(0, 160));
    if (verboso) console.log(d.linhas.map((l) => "         " + l).join("\n"));
  }
  await motor.fechar();
  console.log(iguais + " iguais, " + difs + " diferentes (de " + nomes.length + ")");
  process.exitCode = difs ? 1 : 0;
})().catch((e) => { console.error(e.stack || e); process.exitCode = 2; });
