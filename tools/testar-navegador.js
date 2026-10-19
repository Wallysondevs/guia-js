#!/usr/bin/env node
// testar-navegador.js — abre páginas do Guia JavaScript num Chromium headless (na VPS) e usa o
// editor como o leitor usaria: a página inteira, com o menu, o site.js e as caixas montadas.
//
//   timeout 600 node tools/testar-navegador.js pagina.html [outra.html…]
//   timeout 3600 node tools/testar-navegador.js --todas          (todas as .html da raiz)
//   --fotos DIR   salva um print de página inteira de cada uma em DIR
//   -q            mostra só as páginas com problema (e o resumo)
//
// Em cada página: erro de JS/console/HTTP = problema; cada caixa .tryjs/.tryweb montada;
// JsSim.caixas[i].testar("inicial") e ("solucao"): missão = o inicial NÃO cumpre e a solução
// cumpre, com o "✔ Missão cumprida!" na tela; caixa livre = roda até o fim. Quando uma .tryjs
// pede o teclado, o testador digita o data-digitar (ou manda Ctrl+D), pelo campo do terminal.
// Código de saída: 0 = tudo ok; 1 = alguma página com problema; 2 = uso errado.
"use strict";
const fs = require("fs");
const path = require("path");
const { servidor, RAIZ, PUP, CHROMIUM } = require("./motor-navegador.js");
const JsSim = require("../assets/jssim.js");

const args = process.argv.slice(2);
let fotos = null, quieto = false;
const paginas = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--todas") fs.readdirSync(RAIZ).filter((f) => /\.html$/.test(f)).sort().forEach((f) => paginas.push(f));
  else if (a === "--fotos") fotos = path.resolve(args[++i] || "fotos");
  else if (a === "-q") quieto = true;
  else if (a.startsWith("-")) { console.error("opção desconhecida: " + a); process.exit(2); }
  else paginas.push(fs.existsSync(path.join(RAIZ, a)) ? a : path.basename(a));
}
if (!paginas.length) { console.error("uso: timeout 600 node tools/testar-navegador.js [--fotos DIR] [-q] pagina.html…|--todas"); process.exit(2); }
if (fotos) fs.mkdirSync(fotos, { recursive: true });

(async () => {
  const pup = require(PUP);
  const srv = await servidor();
  const origem = "http://127.0.0.1:" + srv.address().port;
  const nav = await pup.launch({ executablePath: CHROMIUM, headless: true, args: ["--no-sandbox", "--disable-gpu", "--lang=pt-BR", "--disable-dev-shm-usage"], env: Object.assign({}, process.env, { TZ: "America/Sao_Paulo" }) });
  let ruins = 0;
  for (const nome of paginas) {
    const probs = [], oks = [];
    const pg = await nav.newPage();
    await pg.setViewport({ width: 1200, height: 900 });
    // erros do código do LEITOR dentro do quadro da .tryweb (blob:, about:srcdoc) são parte da aula, não da página
    const doQuadro = (u) => /^blob:|about:srcdoc/.test(String(u || ""));
    pg.on("pageerror", (e) => doQuadro((String(e && e.stack || "").match(/(blob:\S+|about:srcdoc)/) || [])[1]) || probs.push("erro de JS na página: " + String(e && e.message || e).split("\n")[0]));
    pg.on("console", (m) => { if (m.type() === "error" && !doQuadro(m.location() && m.location().url) && m.location() && m.location().url !== undefined && !/Failed to load resource/.test(m.text())) probs.push("console.error da página: " + m.text().slice(0, 200)); });
    pg.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) probs.push("HTTP " + r.status() + ": " + r.url().replace(origem, "")); });
    pg.on("dialog", (d) => d.accept().catch(() => {}));
    try {
      await pg.goto(origem + "/" + nome, { waitUntil: "load", timeout: 30000 });
      const temCaixa = await pg.evaluate(() => !!document.querySelector(".tryjs, .tryweb"));
      if (temCaixa) await pg.waitForFunction("window.JsSim && JsSim.montado && JsSim.montadoWeb", { timeout: 20000 });
      const n = temCaixa ? await pg.evaluate(() => JsSim.caixas.length) : 0;
      const nDom = await pg.evaluate(() => document.querySelectorAll(".tryjs, .tryweb").length);
      if (n !== nDom) probs.push("caixas montadas: " + n + " de " + nDom);
      for (let i = 0; i < n; i++) {
        const info = await pg.evaluate((i) => { const c = JsSim.caixas[i]; return { tipo: c.tipo, meta: c.meta, digitar: c.box.getAttribute("data-digitar"), semFim: c.box.hasAttribute("data-sem-fim"), repl: c.box.hasAttribute("data-repl"), temSol: !!c.box.querySelector("pre.solucao") }; }, i);
        const rotulo = "caixa " + (i + 1) + " (." + info.tipo + ")";
        const rodar = async (qual) => {
          const linhas = info.digitar !== null ? JsSim.decodificarAttr(info.digitar).replace(/\n$/, "").split("\n") : [];
          await pg.evaluate((i, qual) => { window.__r = null; JsSim.caixas[i].testar(qual).then((r) => { window.__r = r; }); }, i, qual);
          const t0 = Date.now();
          for (;;) {
            const est = await pg.evaluate((i) => ({ r: window.__r, esp: JsSim.caixas[i].esperando ? JsSim.caixas[i].esperando() : false }), i);
            if (est.r) return est.r;
            if (est.esp) {
              if (linhas.length) await pg.evaluate((i, t) => JsSim.caixas[i].digitar(t), i, linhas.shift());
              else await pg.evaluate((i) => JsSim.caixas[i].fimDaEntrada(), i);
            }
            if (info.semFim && Date.now() - t0 > 2500) { await pg.evaluate((i) => JsSim.caixas[i].parar(), i); }
            if (Date.now() - t0 > 20000) { await pg.evaluate((i) => JsSim.caixas[i].parar && JsSim.caixas[i].parar(), i); return { interrompido: true, motivo: "tempo do testador" }; }
            await new Promise((ok) => setTimeout(ok, 60));
          }
        };
        const status = () => pg.evaluate((i) => { const s = JsSim.caixas[i].box.querySelector(".sim-status"); return s ? s.textContent : ""; }, i);
        const ri = await rodar("inicial");
        if (info.semFim) { if (ri.interrompido) oks.push(rotulo + ": laço sem fim parado"); else probs.push(rotulo + ": data-sem-fim, mas terminou"); continue; }
        if (ri.interrompido) { probs.push(rotulo + ": o código inicial foi interrompido (" + ri.motivo + ")"); continue; }
        if (!info.meta) {
          if (ri.excecao && !info.repl) oks.push(rotulo + " (livre): terminou com erro (de propósito?)");
          else oks.push(rotulo + " (livre): roda");
          continue;
        }
        if (ri.falhas && !ri.falhas.length) probs.push(rotulo + ": o inicial já cumpre a missão");
        if (!info.temSol) { probs.push(rotulo + ": missão sem solução"); continue; }
        const rs = await rodar("solucao");
        const st = await status();
        if (rs.interrompido) probs.push(rotulo + ": a solução foi interrompida (" + rs.motivo + ")");
        else if (rs.falhas && rs.falhas.length) probs.push(rotulo + ": a solução não cumpre " + rs.falhas.join(" ;; "));
        else if (!/Missão cumprida/.test(st)) probs.push(rotulo + ": a tela não mostra \"Missão cumprida\" (" + st + ")");
        else oks.push(rotulo + ": inicial falha, solução cumpre (✔ na tela)");
      }
      if (fotos) await pg.screenshot({ path: path.join(fotos, nome.replace(/\.html$/, ".png")), fullPage: true });
    } catch (e) { probs.push("erro do testador: " + String(e && e.message || e).split("\n")[0]); }
    await pg.close();
    if (probs.length) ruins++;
    if (!quieto || probs.length) {
      console.log("== " + nome + (probs.length ? "  (" + probs.length + " problema(s))" : "  ok"));
      if (!quieto) oks.forEach((x) => console.log("  ok     " + x));
      probs.forEach((x) => console.log("  FALHA  " + x));
    }
  }
  await nav.close(); srv.close();
  console.log("\n" + paginas.length + " página(s), " + ruins + " com problema");
  process.exitCode = ruins ? 1 : 0;
})().catch((e) => { console.error("erro: " + (e.stack || e)); process.exitCode = 2; });
