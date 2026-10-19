#!/usr/bin/env node
// testar-missoes.js — confere as páginas do Guia JavaScript antes do commit.
//
//   timeout 300 node tools/testar-missoes.js pagina.html [outra.html…]
//   timeout 600 node tools/testar-missoes.js --nativo pagina.html   (+ compara com o node do lab)
//   timeout 900 node tools/testar-missoes.js --todas                 (todas as .html da raiz)
//   -q / --quieto   mostra só FALHA e aviso (e o resumo)
//
// Para cada página:
//   - cada caixa .tryjs: contrato (pre.script com data-file, metas conhecidas, regex válidas),
//     missão com pre.solucao, o código INICIAL NÃO cumpre a meta e a SOLUÇÃO cumpre — rodando o
//     MESMO editor (assets/jssim.js + assets/jssim/worker.js) num Chromium headless de verdade;
//     caixa livre: roda (erro/laço infinito viram aviso/FALHA);
//     data-digitar="Ana\n30": o que o testador "digita" quando a caixa (sem data-stdin) lê o teclado;
//     data-sem-fim: laço infinito de propósito (o testador confere que o editor o para);
//     data-repl: o modo interativo ("node"); o testador digita o data-digitar;
//   - cada caixa .tryweb: contrato e metas; a página roda no Chromium (assets/jssim/web.js), com
//     as data-acoes, e as metas são conferidas no inicial (falha) e na solução (passa);
//   - todo <pre>: "<" e "&" escapados (&lt; &amp;);
//   - links internos só para páginas da NIVEIS (aviso); nada da máquina real (FALHA).
// --nativo: roda o inicial e a solução das .tryjs também no node do lab (~/guia-js-lab/lab)
//   e registra as diferenças de saída/código de saída em tools/DIFERENCAS-AUTO.md (fora do git).
// Código de saída: 0 = tudo ok; 1 = alguma FALHA; 2 = uso errado / página inexistente.
"use strict";
const fs = require("fs");
const path = require("path");
const JsSim = require("../assets/jssim.js");

const RAIZ = path.join(__dirname, "..");
// o registro automático fica FORA do git (tools/DIFERENCAS-AUTO.md está no .gitignore);
// o tools/DIFERENCAS.md (no git) é o resumo escrito à mão pelo agente do simulador
const DIFERENCAS = path.join(RAIZ, "tools/DIFERENCAS-AUTO.md");

/* ------------------------------------------------------------------ args */
const args = process.argv.slice(2);
let nativo = false, quieto = false, todas = false;
const paginas = [];
for (const a of args) {
  if (a === "--nativo") nativo = true;
  else if (a === "-q" || a === "--quieto") quieto = true;
  else if (a === "--todas") todas = true;
  else if (a === "-h" || a === "--help") uso(0);
  else if (a.startsWith("-")) { console.error("opção desconhecida: " + a); uso(2); }
  else paginas.push(a);
}
function uso(cod) {
  console.error("uso: timeout 300 node tools/testar-missoes.js [--nativo] [-q] pagina.html [outra.html…]\n" +
    "     timeout 900 node tools/testar-missoes.js [--nativo] [-q] --todas");
  process.exit(cod);
}
if (todas) fs.readdirSync(RAIZ).filter((f) => /\.html$/.test(f)).sort().forEach((f) => paginas.push(f));
if (!paginas.length) uso(2);

/* ------------------------------------------------------------- utilidades */
const decodificar = JsSim.decodificarEntidades;
function atributos(s) {
  const r = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(s))) r[m[1].toLowerCase()] = decodificar(m[2] ?? m[3] ?? m[4] ?? "");
  return r;
}
function classes(at) { return (at["class"] || "").split(/\s+/).filter(Boolean); }
function trecho(s, i, n = 30) { return JSON.stringify(s.slice(Math.max(0, i - n), i + n).replace(/\s+/g, " ")); }
// o texto que o navegador (e o jssim.lerPre) enxerga dentro de um <pre>
function textoPre(cru) {
  let t = decodificar(cru.replace(/<[^>]*>/g, ""));
  t = t.replace(/^\n/, "");                       // o parser de HTML come o 1º \n depois de <pre>
  return t.replace(/^\n/, "").replace(/\n$/, ""); // e o lerPre tira mais um de cada ponta
}
const ENT_OK = new Set(["lt", "gt", "amp", "quot", "apos", "nbsp", "middot", "rarr", "larr", "uarr", "darr", "harr", "hellip", "mdash", "ndash", "laquo", "raquo", "copy", "deg", "times", "divide", "sect", "bull", "check", "ordm", "ordf", "lsquo", "rsquo", "ldquo", "rdquo", "shy", "zwj", "ne", "le", "ge", "euro"]);
function paginasNiveis() {
  try {
    const js = fs.readFileSync(path.join(RAIZ, "assets/site.js"), "utf8");
    const ini = js.indexOf("var NIVEIS"), fim = js.indexOf("\n];", ini);
    const set = new Set();
    for (const m of js.slice(ini, fim).matchAll(/\[\s*"([^"]+\.html)"/g)) set.add(m[1]);
    return set;
  } catch (e) { return null; }
}
const NIVEIS = paginasNiveis();

/* ------------------------------------------------------- leitura da página */
function analisarHtml(html) {
  const src = html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, " "));
  const linhaDe = (i) => src.slice(0, i).split("\n").length;
  const problemas = [];

  const pres = [];
  const rePre = /<pre\b([^>]*)>([\s\S]*?)<\/pre\s*>/gi;
  let m;
  while ((m = rePre.exec(src))) {
    const at = atributos(m[1]);
    const ini = m.index + m[0].indexOf(">") + 1;
    pres.push({ at, cls: classes(at), cru: m[2], ini, fim: ini + m[2].length, linha: linhaDe(m.index) });
  }

  const reTagOk = /^<\/?(mark|b|strong|em|i|u|span|kbd|sup|sub|br|a)(\s+[\w-]+\s*=\s*("[^"]*"|'[^']*'))*\s*\/?>/i;
  for (const p of pres) {
    const nome = "<pre" + (p.at["class"] ? ' class="' + p.at["class"] + '"' : "") + ">";
    const codigoEditor = p.cls.includes("script") || p.cls.includes("solucao");
    let i = -1;
    while ((i = p.cru.indexOf("<", i + 1)) >= 0) {
      if (!codigoEditor && reTagOk.test(p.cru.slice(i))) continue;
      problemas.push({ grav: "FALHA", linha: linhaDe(p.ini + i), msg: '"<" sem escape dentro de ' + nome + " (escreva &lt;): " + trecho(p.cru, i) });
      break;
    }
    i = -1;
    while ((i = p.cru.indexOf("&", i + 1)) >= 0) {
      const ent = /^&(#\d+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/.exec(p.cru.slice(i));
      if (ent && (ent[1][0] === "#" || ENT_OK.has(ent[1]))) continue;
      problemas.push(ent
        ? { grav: "FALHA", linha: linhaDe(p.ini + i), msg: "entidade " + ent[0] + " que o testador não conhece, dentro de " + nome + " (use &lt; &gt; &amp; &quot; ou o caractere direto)" }
        : { grav: "FALHA", linha: linhaDe(p.ini + i), msg: '"&" sem escape dentro de ' + nome + " (escreva &amp;): " + trecho(p.cru, i) });
      break;
    }
  }

  const caixas = [];
  const reDiv = /<div\b([^>]*)>/gi;
  while ((m = reDiv.exec(src))) {
    const at = atributos(m[1]);
    const cl = classes(at);
    const tipo = cl.includes("tryjs") ? "tryjs" : cl.includes("tryweb") ? "tryweb" : null;
    if (!tipo) continue;
    const reTok = /<(\/?)div\b[^>]*>/gi;
    reTok.lastIndex = m.index + m[0].length;
    let prof = 1, t, fim = -1;
    while ((t = reTok.exec(src))) { prof += t[1] ? -1 : 1; if (!prof) { fim = t.index; break; } }
    const linha = linhaDe(m.index);
    if (fim < 0) { problemas.push({ grav: "FALHA", linha, msg: '<div class="' + tipo + '"> sem o </div> de fechamento' }); continue; }
    const ini = m.index + m[0].length;
    const dentro = pres.filter((p) => p.ini > ini && p.fim < fim);
    caixas.push({ tipo, at, linha, goal: at["data-goal"], script: dentro.filter((p) => p.cls.includes("script")), solucao: dentro.filter((p) => p.cls.includes("solucao")) });
    dentro.forEach((p) => { p.naCaixa = true; });
  }
  pres.filter((p) => !p.naCaixa && (p.cls.includes("solucao") || p.cls.includes("script"))).forEach((p) => {
    problemas.push({ grav: "aviso", linha: p.linha, msg: '<pre class="' + p.at["class"] + '"> fora de uma caixa .tryjs/.tryweb (o editor ignora)' });
  });
  for (const v of src.matchAll(/class="[^"]*\b(trypy|trysql|tryc|trycpp|tryhtml|trycs|tryscript|tryphp|tryjshell|trylua|trypwsh)\b/g))
    problemas.push({ grav: "FALHA", linha: linhaDe(v.index), msg: 'caixa "' + v[1] + '" é de outro guia: aqui é <div class="tryjs"> ou <div class="tryweb">' });

  for (const l of src.matchAll(/\bhref\s*=\s*"([^"#?:]+\.html)(?:[#?][^"]*)?"/g)) {
    const alvo = l[1];
    if (NIVEIS && !NIVEIS.has(alvo) && !alvo.includes("/"))
      problemas.push({ grav: "aviso", linha: linhaDe(l.index), msg: 'link para "' + alvo + '", que não está na NIVEIS' });
  }
  const PROIBIDO = /\/home\/admin|\/home\/wallyson|wallyson(?!devs\.github\.io)|ip-172-\d|guia-[a-z]+-lab|\/tmp\/claude/i;
  const PROIBIDO_EXTRA = (() => { try { return fs.readFileSync(path.join(require("os").homedir(), ".guia-proibido"), "utf8").split("\n").map((x) => x.trim()).filter(Boolean); } catch (e) { return []; } })();
  const linhasSrc = html.split("\n");
  for (let k = 0; k < linhasSrc.length; k++) {
    const p = PROIBIDO.exec(linhasSrc[k]) || PROIBIDO_EXTRA.map((x) => [x]).find((x) => linhasSrc[k].includes(x[0]));
    if (p) problemas.push({ grav: "FALHA", linha: k + 1, msg: 'dado da máquina real na página: "' + p[0] + '" (use só /home/ana e ana@notebook)' });
  }
  return { caixas, problemas };
}

/* --------------------------------------------------------- DIFERENCAS.md */
const CABECALHO_DIF = `# Diferenças encontradas: editor do guia (navegador) × node do lab (registro automático, fora do git)

Mantido pelo \`tools/testar-missoes.js --nativo\`. O editor roda o JavaScript **do navegador do
leitor** (no testador: Chromium headless, motor V8 como o do Node) num ambiente que imita o
\`node main.js\` (\`assets/jssim/worker.js\`); o lab (\`~/guia-js-lab/lab\`) roda o **Node.js v24.22.0
oficial** no Ubuntu 26.04. O testador roda o código inicial e a solução de cada caixa .tryjs nos dois,
com o mesmo stdin e os mesmos argumentos, e compara a saída (stdout + stderr) e o código de saída.

## Diferenças conhecidas (esperadas)
Estão na §4 do \`CONTRIBUINDO.md\` e no \`tools/DIFERENCAS.md\`: \`Math.random\`, data/hora e tempos medidos, rede (\`fetch\`),
dados da máquina (\`node:os\`), o estado de Promises no \`console.log\`.
Uma diferença que **não** está lá é um achado: avise o agente do simulador.

## Diferenças encontradas
<!-- AUTO: cada página tem a sua seção, reescrita a cada --nativo. Página sem diferença não aparece. -->
`;
function travar(fn) {
  const lock = DIFERENCAS + ".lock";
  for (let t = 0; t < 100; t++) {
    try {
      const fd = fs.openSync(lock, "wx");
      try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock); } catch (e2) {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  throw new Error("não consegui travar " + DIFERENCAS + ".lock");
}
function cerca(s) { const n = Math.max(3, ...(String(s).match(/`+/g) || [""]).map((x) => x.length + 1)); return "`".repeat(n); }
function gravarDiferencas(pagina, lista) {
  travar(() => {
    let txt = fs.existsSync(DIFERENCAS) ? fs.readFileSync(DIFERENCAS, "utf8") : CABECALHO_DIF;
    const marca = txt.indexOf("<!-- AUTO:");
    if (marca >= 0) txt = CABECALHO_DIF + txt.slice(txt.indexOf("\n", marca) + 1);
    const abre = "<!-- pagina:" + pagina + " -->", fecha = "<!-- /pagina:" + pagina + " -->";
    const a = txt.indexOf(abre), f = txt.indexOf(fecha);
    if (a >= 0 && f > a) txt = txt.slice(0, a).replace(/\n+$/, "\n") + txt.slice(f + fecha.length).replace(/^\n+/, "\n");
    if (lista.length) {
      let s = "\n" + abre + "\n### " + pagina + " (" + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC)\n";
      for (const d of lista) {
        s += "\n**" + d.onde + "** — " + d.motivo + (d.esperado.length ? " (esperado: " + d.esperado.join("; ") + ")" : "") + "\n\n" +
          cerca(d.codigo) + "js\n" + d.codigo + "\n" + cerca(d.codigo) + "\n\n" +
          "- editor (código de saída " + d.editor.exit + "):\n\n" + cerca(d.editor.saida) + "\n" + d.editor.saida.replace(/\n$/, "") + "\n" + cerca(d.editor.saida) + "\n" +
          "- lab, node (código de saída " + d.lab.exit + "):\n\n" + cerca(d.lab.saida) + "\n" + d.lab.saida.replace(/\n$/, "") + "\n" + cerca(d.lab.saida) + "\n";
      }
      txt = txt.replace(/\n*$/, "\n") + s + fecha + "\n";
    }
    fs.writeFileSync(DIFERENCAS, txt);
  });
}

/* ------------------------------------------------------------- o teste */
const curto = (s) => { s = String(s).replace(/\n/g, "↵"); return s.length > 90 ? s.slice(0, 87) + "…" : s; };
// a linha da mensagem de erro do node que diz o erro ("TypeError: x is not a function")
const linhaErro = (r) => { const t = String(r.traceback || ""); const m = /^(\w*Error\b[^\n]*|Uncaught[^\n]*|\w+ \[ERR_\w+\][^\n]*)$/m.exec(t); return curto(m ? m[0] : t.trim().split("\n")[0]); };

async function testarPagina(arq, motor, lab) {
  const html = fs.readFileSync(arq, "utf8");
  const nomePag = path.basename(arq);
  const { caixas, problemas } = analisarHtml(html);
  const itens = problemas.slice();
  const difs = [];
  let nComparados = 0;

  async function rodar(cx, abas, onde) {
    const stdinAttr = cx.at["data-stdin"];
    const repl = "data-repl" in cx.at;
    const req = {
      repl: repl ? (cx.script.length ? true : "so") : false,
      arquivos: abas.map((a) => ({ nome: a.nome, codigo: JsSim.comEnter(a.codigo) })),
      args: cx.at["data-args"] !== undefined ? JsSim.dividirArgs(cx.at["data-args"]) : [],
      stdin: stdinAttr !== undefined && !repl ? JsSim.textoEntrada(stdinAttr) : null,
    };
    const semFim = "data-sem-fim" in cx.at;
    const dig = (stdinAttr === undefined || repl) && cx.at["data-digitar"] !== undefined ? JsSim.decodificarAttr(cx.at["data-digitar"]).replace(/\n$/, "").split("\n") : null;
    const r = await motor.rodar(req, { tempo: semFim ? 3000 : JsSim.TEMPO_MAX, digitar: dig });
    if (semFim) {
      if (!r.interrompido) itens.push({ grav: "FALHA", linha: onde.linha, msg: onde.nome + ": tem data-sem-fim (laço infinito de propósito) mas terminou (código de saída " + r.exit + ")" });
      else if (r.motivo !== "tempo") itens.push({ grav: "FALHA", linha: onde.linha, msg: onde.nome + ": tem data-sem-fim mas foi interrompido por outro motivo: " + r.motivo });
      r.semFimOk = r.interrompido && r.motivo === "tempo";
    } else if (r.interrompido) {
      itens.push({ grav: "FALHA", linha: onde.linha, msg: onde.nome + ": " + (r.motivo === "tempo" ? "não terminou em " + JsSim.TEMPO_MAX / 1000 + " s (laço infinito? esperando o teclado sem data-digitar? o editor para o programa)" : r.motivo === "limite" ? "escreveu mais de 2 milhões de caracteres (o editor para o programa)" : "o editor falhou: " + String(r.msg || "").split("\n")[0]) });
    } else if (r.ms > 3000) itens.push({ grav: "aviso", linha: onde.linha, msg: onde.nome + ": levou " + r.ms + " ms (o editor para em " + JsSim.TEMPO_MAX / 1000 + " s; o navegador do leitor pode ser mais lento)" });
    if (r.pediuTeclado && stdinAttr === undefined && !dig && !repl)
      itens.push({ grav: "aviso", linha: onde.linha, msg: onde.nome + ": lê o teclado e a caixa não tem data-stdin nem data-digitar: no editor o leitor digita; aqui o testador mandou Ctrl+D (fim da entrada)" + (r.excecao ? " e o programa terminou com erro: " + linhaErro(r) : "") });
    if (lab && !r.interrompido && !repl) {
      nComparados++;
      const n = lab.rodar(req.arquivos, { args: req.args, stdin: req.stdin !== null ? req.stdin : "", digitar: dig });
      const ed = { saida: dig ? r.segs.map((x) => x.s).join("") : r.saida, exit: r.exit };
      const d = lab.comparar(ed, n, req.arquivos.map((a) => a.codigo).join("\n"));
      if (d) {
        difs.push({ onde: onde.nome + " (linha " + onde.linha + ")", codigo: req.arquivos[0].codigo.replace(/\n$/, ""), editor: ed, lab: n, motivo: d.motivo, esperado: d.esperado });
        itens.push({ grav: d.esperado.length ? "ok" : "aviso", linha: onde.linha, msg: onde.nome + ": diferença com o node do lab (" + d.motivo + ")" + (d.esperado.length ? " — esperada: " + d.esperado.join("; ") : " — veja tools/DIFERENCAS-AUTO.md") });
      }
    }
    return r;
  }

  for (let k = 0; k < caixas.length; k++) {
    const cx = caixas[k];
    const nome = "caixa " + (k + 1) + " (." + cx.tipo + ")", L = cx.linha, goal = cx.goal;
    const fal = (msg) => itens.push({ grav: "FALHA", linha: L, msg: nome + ": " + msg });
    const avi = (msg) => itens.push({ grav: "aviso", linha: L, msg: nome + ": " + msg });
    const web = cx.tipo === "tryweb";
    const repl = "data-repl" in cx.at;
    if (web) {
      for (const at of ["data-stdin", "data-args", "data-repl", "data-digitar", "data-sem-fim"]) if (at in cx.at) avi(at + " é da caixa .tryjs (a .tryweb ignora)");
    } else if ("data-acoes" in cx.at) avi("data-acoes é da caixa .tryweb (a .tryjs ignora; para o teclado use data-digitar)");
    if (repl) {
      if ("data-stdin" in cx.at) avi("data-repl com data-stdin: no modo interativo o leitor digita (o editor ignora o data-stdin; para o testador, use data-digitar)");
      if (cx.at["data-digitar"] === undefined) avi("data-repl sem data-digitar: o testador só abre o node e manda Ctrl+D (ponha as linhas que o leitor digitaria)");
      if (goal !== undefined && !cx.script.length) { fal("data-repl sem pre.script não pode ter data-goal (não há código para mudar; deixe a caixa livre)"); continue; }
    }
    if (!cx.script.length && !repl) { fal('sem <pre class="script" data-file="' + (web ? "index.html" : "main.js") + '"> (o código inicial da caixa)'); continue; }
    const abas = !cx.script.length ? [{ nome: "main.js", codigo: "" }] : cx.script.map((p, i) => ({ nome: p.at["data-file"] || (i === 0 ? (web ? "index.html" : "main.js") : "arquivo" + i + ".txt"), codigo: textoPre(p.cru) }));
    cx.script.forEach((p, i) => { if (!p.at["data-file"]) avi('o <pre class="script"> nº ' + (i + 1) + ' não tem data-file (o editor chama de "' + abas[i].nome + '")'); });
    if (cx.script.length && !web && !/\.(js|mjs|cjs)$/i.test(abas[0].nome)) fal('o 1º <pre class="script"> é o que roda: precisa ser um .js (data-file="' + abas[0].nome + '")');
    if (cx.script.length && web && !/\.html?$/i.test(abas[0].nome)) fal('o 1º <pre class="script"> da .tryweb é a página: precisa ser um .html (data-file="' + abas[0].nome + '")');
    const nomes = abas.map((a) => a.nome);
    if (new Set(nomes).size !== nomes.length) fal("duas abas com o mesmo data-file: " + nomes.join(", "));
    for (const n of nomes) if (/^\/|(^|\/)\.\.(\/|$)/.test(n)) fal('data-file="' + n + '": o nome é relativo à pasta do programa (/home/ana)');
    const sols = cx.solucao.map((p, i) => ({ nome: p.at["data-file"] || (abas[i] ? abas[i].nome : "main.js"), codigo: textoPre(p.cru), linha: p.linha }));
    sols.forEach((s) => { if (!nomes.includes(s.nome)) avi('a solução tem data-file="' + s.nome + '", que não é nenhuma aba (vira uma aba nova no "Ver solução")'); });
    const abasSol = abas.map((a) => { const s = sols.find((x) => x.nome === a.nome); return s ? { nome: a.nome, codigo: s.codigo } : a; })
      .concat(sols.filter((s) => !nomes.includes(s.nome)).map((s) => ({ nome: s.nome, codigo: s.codigo })));
    if ("data-stdin" in cx.at && /\\[^nt\\]/.test(cx.at["data-stdin"])) avi('data-stdin tem uma "\\" que não é \\n, \\t nem \\\\ (fica como está)');

    if (web) {
      if (goal !== undefined && goal.trim()) {
        const probs = JsSim.validarMeta(goal, "tryweb");
        if (probs.length) { probs.forEach(fal); continue; }
        if (!sols.length) { fal('missão (data-goal="' + goal + '") sem <pre class="solucao">'); continue; }
      }
      if (!motor.web) { avi("a .tryweb ainda não é rodada pelo testador (em construção): conferi só o contrato"); continue; }
      const acoes = cx.at["data-acoes"] || "";
      const ri = await motor.web(abas, { acoes, goal: goal || "" });
      if (ri.falhaAcao) avi("ação \"" + ri.falhaAcao + "\" não deu certo no código inicial");
      if (!goal || !goal.trim()) {
        if (ri.excecao) avi("caixa livre com erro não tratado no Console: " + curto(ri.traceback));
        else itens.push({ grav: "ok", linha: L, msg: nome + " (livre): a página abre sem erro" + (ri.console ? " (Console: " + curto(ri.console) + ")" : "") });
        continue;
      }
      const rs = await motor.web(abasSol, { acoes, goal });
      if (rs.falhaAcao) fal("ação \"" + rs.falhaAcao + "\" não deu certo na solução");
      let ok = true;
      if (!ri.falhas.length) { ok = false; fal('o código INICIAL já cumpre a meta "' + goal + '" (a missão não pede nada; mude o inicial ou a meta)'); }
      for (const f of rs.falhas) { ok = false; fal('a solução NÃO cumpre "' + f + '"' + (rs.excecao ? " (erro na solução: " + curto(rs.traceback) + ")" : "") + " (Console: " + curto(rs.console || "(vazio)") + ")"); }
      if (ok) itens.push({ grav: "ok", linha: L, msg: nome + ' (missão "' + curto(goal) + '"): o inicial falha (' + curto(ri.falhas.join(" ;; ")) + "), a solução cumpre" });
      continue;
    }

    if (goal === undefined || goal.trim() === "") {
      if (goal !== undefined) avi("data-goal vazio (tire o atributo para uma caixa livre)");
      const r = await rodar(cx, abas, { nome: nome + ", código inicial", linha: L });
      if (r.semFimOk) { itens.push({ grav: "ok", linha: L, msg: nome + " (livre, data-sem-fim): não termina, como esperado (o editor para em " + JsSim.TEMPO_MAX / 1000 + " s)" }); continue; }
      if (r.interrompido) continue;
      if (sols.length) {
        const rs = await rodar(cx, abasSol, { nome: nome + ", solução", linha: sols[0].linha });
        if (!rs.interrompido && rs.excecao) fal("a solução termina com erro: " + linhaErro(rs));
      }
      if (repl) itens.push({ grav: "ok", linha: L, msg: nome + " (livre, modo interativo): terminou com Ctrl+D (código de saída " + r.exit + ")" });
      else if (r.excecao) avi("caixa livre que termina com erro (de propósito? o leitor vê a mensagem em vermelho): " + linhaErro(r));
      else itens.push({ grav: "ok", linha: L, msg: nome + " (livre): roda sem erro (código de saída " + r.exit + ")" });
      continue;
    }

    const probs = JsSim.validarMeta(goal, "tryjs");
    if (probs.length) { probs.forEach(fal); continue; }
    if (!sols.length) { fal('missão (data-goal="' + goal + '") sem <pre class="solucao">'); continue; }
    const ri = await rodar(cx, abas, { nome: nome + ", código inicial", linha: L });
    const rs = await rodar(cx, abasSol, { nome: nome + ", solução", linha: sols[0].linha });
    const ctx = (r, ab) => ({ out: r.saida, excecao: r.excecao, traceback: r.traceback, exit: r.exit, src: ab.map((a) => a.codigo).join("\n"), arquivos: r.arquivos || {} });
    let ok = true, fi = null;
    if (!ri.interrompido) {
      fi = JsSim.checarMeta(goal, ctx(ri, abas));
      if (!fi.length) { ok = false; fal('o código INICIAL já cumpre a meta "' + goal + '" (a missão não pede nada; mude o inicial ou a meta)'); }
    }
    if (rs.interrompido) ok = false;
    else {
      for (const f of JsSim.checarMeta(goal, ctx(rs, abasSol))) {
        ok = false;
        const t = JsSim.partesMeta(f).tipo;
        const dica = t === "semerro" ? " (a solução termina com erro: " + linhaErro(rs) + ")"
          : (t === "out" || t === "outre") ? " (saída da solução: " + curto(rs.saida) + ")"
          : t === "exit" ? " (código de saída da solução: " + rs.exit + ")"
          : t === "erro" ? (rs.excecao ? " (o erro da solução: " + linhaErro(rs) + ")" : " (a solução roda sem erro)")
          : t === "arquivo" ? " (arquivos depois de rodar: " + curto(JSON.stringify(rs.arquivos)) + ")" : "";
        fal('a solução NÃO cumpre "' + f + '"' + dica);
      }
    }
    if (ok) itens.push({ grav: "ok", linha: L, msg: nome + ' (missão "' + curto(goal) + '"): o inicial falha (' + curto((fi || []).join(" ;; ")) + "), a solução cumpre" });
  }

  if (!caixas.length) itens.push({ grav: "aviso", linha: 1, msg: "a página não tem nenhuma caixa .tryjs/.tryweb" });
  else {
    if (!caixas.some((c) => c.goal && c.goal.trim())) itens.push({ grav: "aviso", linha: 1, msg: "nenhuma caixa é missão (data-goal); a §2 pede uma missão no fim da aula" });
    if (caixas.length < 2 && !/^(ref-|projeto-)/.test(nomePag)) itens.push({ grav: "aviso", linha: 1, msg: "só " + caixas.length + " caixa; a §2 pede pelo menos dois Experimente por aula" });
  }
  if (lab) gravarDiferencas(nomePag, difs);
  return { itens: itens.sort((a, b) => a.linha - b.linha), nDif: difs.length, nComparados };
}

/* ------------------------------------------------------------- principal */
function achar(p) {
  const cands = [p, path.join(RAIZ, p), path.join(RAIZ, path.basename(p))];
  return cands.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
}

(async () => {
  let lab = null;
  if (nativo) {
    lab = require("./lab-nativo.js");
    const prob = lab.problema();
    if (prob) { console.error("--nativo: " + prob); process.exit(2); }
  }
  const { abrirMotor } = require("./motor-navegador.js");
  const motor = await abrirMotor();
  let totFalha = 0, totAviso = 0, totOk = 0, faltando = 0, totDif = 0;
  const ruins = [];
  for (const p of paginas) {
    const arq = achar(p);
    console.log("== " + p);
    if (!arq) { console.log("  FALHA  página não encontrada (mandou com o enviar?)"); faltando++; ruins.push(p); continue; }
    let r;
    try { r = await testarPagina(arq, motor, lab); }
    catch (e) { console.log("  FALHA  erro do testador: " + (e.stack || e)); totFalha++; ruins.push(p); continue; }
    const c = { ok: 0, FALHA: 0, aviso: 0 };
    for (const it of r.itens) {
      c[it.grav]++;
      if (quieto && it.grav === "ok") continue;
      console.log("  " + (it.grav + "      ").slice(0, 6) + " linha " + it.linha + ": " + it.msg.replace(/\n/g, "↵"));
    }
    console.log("  -> " + c.ok + " ok, " + c.FALHA + " FALHA, " + c.aviso + " aviso" + (lab ? "; nativo: " + r.nComparados + " execuções comparadas, " + r.nDif + " diferença(s)" : ""));
    totOk += c.ok; totFalha += c.FALHA; totAviso += c.aviso; totDif += r.nDif;
    if (c.FALHA) ruins.push(p);
  }
  await motor.fechar();
  if (paginas.length > 1)
    console.log("\nTOTAL: " + paginas.length + " página(s), " + totOk + " ok, " + totFalha + " FALHA, " + totAviso + " aviso" +
      (lab ? ", " + totDif + " diferença(s) com o lab" : "") + (ruins.length ? "\ncom FALHA: " + ruins.join(" ") : ""));
  if (lab && totDif) console.log("diferenças registradas em tools/DIFERENCAS-AUTO.md (fora do git)");
  console.log("(editor: Chromium " + motor.info.chromium + ", Node imitado " + motor.info.node + ")");
  process.exitCode = faltando ? 2 : totFalha ? 1 : 0;
})().catch((e) => { console.error("erro do testador: " + (e.stack || e)); process.exitCode = 2; });
