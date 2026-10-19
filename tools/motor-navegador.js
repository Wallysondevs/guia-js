/* motor-navegador.js — o editor do guia (assets/jssim.js + assets/jssim/worker.js) rodando
   num Chromium headless DE VERDADE (o mesmo motor V8 do Chrome do leitor). Usado por
   tools/sim.js e tools/testar-missoes.js: o MESMO código do editor, sem adaptação.

   const { abrirMotor } = require("./motor-navegador.js");
   const m = await abrirMotor();          // { rodar(req, opc), web(caixa, opc), fechar(), info }
   const r = await m.rodar({ arquivos:[{nome:"main.js", codigo:"console.log(1)\n"}], args:[], stdin:null },
                           { digitar: ["Ana"], tempo: 10000 });
   r = { saida, segs:[{t,s}], eco, exit, excecao, traceback, arquivos, interrompido, motivo, ms, modo }

   Sobe um servidor HTTP próprio em 127.0.0.1 (porta livre) servindo a raiz do guia;
   o Chromium é o da VPS (/usr/bin/chromium) via puppeteer-core (~/rascunho/coord/cdp). */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");

const RAIZ = path.join(__dirname, "..");
const PUP = process.env.PUPPETEER_DIR || path.join(os.homedir(), "rascunho/coord/cdp/node_modules/puppeteer-core");
const CHROMIUM = process.env.CHROMIUM || "/usr/bin/chromium";
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp",
  ".json": "application/json", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
const PAGINA_SIM = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>sim</title></head><body><script src="assets/jssim.js"></script><script src="assets/jssim/web.js"></script></body></html>';

function servidor(extra) {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p === "/__sim.html") { res.writeHead(200, { "Content-Type": TIPOS[".html"], "Cache-Control": "no-store" }); res.end(PAGINA_SIM); return; }
    if (extra && extra[p] !== undefined) { res.writeHead(200, { "Content-Type": TIPOS[path.extname(p)] || "text/html; charset=utf-8", "Cache-Control": "no-store" }); res.end(extra[p]); return; }
    if (p.endsWith("/")) p += "index.html";
    const arq = path.join(RAIZ, path.normalize(p).replace(/^(\.\.[/\\])+/, ""));
    if (!arq.startsWith(RAIZ) || !fs.existsSync(arq) || !fs.statSync(arq).isFile()) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream", "Cache-Control": "max-age=600" });
    fs.createReadStream(arq).pipe(res);
  });
  return new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv)));
}

async function abrirMotor(opc = {}) {
  const pup = require(PUP);
  const extra = {};
  const srv = await servidor(extra);
  const origem = "http://127.0.0.1:" + srv.address().port;
  // NAVEGADOR=firefox: o mesmo teste no Firefox (outro motor: as mensagens de erro mudam)
  const ff = process.env.NAVEGADOR === "firefox";
  const nav = await pup.launch(ff ? { browser: "firefox", executablePath: process.env.FIREFOX || "/usr/bin/firefox-esr", headless: true } : {
    executablePath: CHROMIUM, headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--lang=pt-BR", "--no-first-run", "--disable-dev-shm-usage"],
    env: Object.assign({}, process.env, { TZ: opc.tz || "America/Sao_Paulo", LANG: "pt_BR.UTF-8" }),
  });
  const pg = await nav.newPage();
  const errosPagina = [];
  pg.on("pageerror", (e) => errosPagina.push(String(e && e.message || e)));
  pg.on("dialog", (d) => { d.accept().catch(() => {}); });
  if (!ff) await pg.emulateTimezone(opc.tz || "America/Sao_Paulo");
  await pg.goto(origem + "/__sim.html");
  await pg.waitForFunction("window.JsSim && JsSim.montado && JsSim.testarWeb", { timeout: 15000 });
  const info = await pg.evaluate(() => ({ ua: navigator.userAgent, node: JsSim.NODE, motor: JsSim.motor }));
  info.chromium = (info.ua.match(/Chrome\/([\d.]+)/) || info.ua.match(/(Firefox\/[\d.]+)/) || [])[1];

  async function rodar(req, o = {}) {
    return pg.evaluate((req, o) => new Promise((ok) => {
      const h = JsSim.rodarMotor(req, { tempo: o.tempo, digitar: o.digitar || null,
        aoEspera: () => { window.__esperou = true; h.eof(); } });
      window.__esperou = false;
      h.promessa.then((r) => { r.pediuTeclado = window.__esperou || !!(o.digitar && r.eco && r.eco.length); ok(r); });
    }), req, { tempo: o.tempo || 10000, digitar: o.digitar || null });
  }
  // .tryweb: abas [{nome, codigo}], opc {acoes, goal} → {falhas, console, excecao, traceback, falhaAcao}
  async function web(abas, o = {}) {
    return pg.evaluate((abas, o) => JsSim.testarWeb(abas, o), abas.map((a) => ({ nome: a.nome, codigo: a.codigo })), { acoes: o.acoes || "", goal: o.goal || "" });
  }
  return {
    info, origem, pagina: pg, navegador: nav, extra, errosPagina,
    rodar, web,
    async fechar() { try { await nav.close(); } catch (e) {} srv.close(); },
  };
}

module.exports = { abrirMotor, servidor, RAIZ, PUP, CHROMIUM };
