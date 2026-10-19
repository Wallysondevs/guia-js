/* =====================================================================
   jssim.js — o "Experimente" do Guia JavaScript.
   .tryjs : imita o `node main.js` (Node.js v24.22.0) com o JavaScript DO PRÓPRIO
            NAVEGADOR, num Web Worker (assets/jssim/worker.js): a página não trava,
            e um laço infinito é parado encerrando o worker ("Parar" ou 10 segundos).
   .tryweb: uma página (index.html + script.js + style.css) num quadro Resultado,
            com um Console embaixo (assets/jssim/web.js, carregado só se houver).
   Contrato das caixas: CONTRIBUINDO.md, seções 3 e 4.
   Também roda no Node: tools/testar-missoes.js usa as funções puras daqui.
   ===================================================================== */
(function () {
  "use strict";
  var NODE_VERSAO = "v24.22.0";
  var VERSAO_ARQS = "2026-10-19e"; // MUDE a cada mudança no worker/inspect/web.js (o navegador guarda os arquivos em cache)
  var TEMPO_MAX = 10000;      // ms rodando sem parar (sem contar a espera pelo teclado)
  var MAX_LINHAS = 3000;      // linhas mostradas no terminal (o resto é resumido)
  var JsSim = { TEMPO_MAX: TEMPO_MAX, NODE: NODE_VERSAO };

  /* =====================================================================
     1. Funções puras (navegador e Node)
     ===================================================================== */
  function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  JsSim.escHtml = escHtml;

  var ENTIDADES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", copy: "©", reg: "®", trade: "™", hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", bull: "•", middot: "·", deg: "°", times: "×", divide: "÷", euro: "€", pound: "£", cent: "¢", sect: "§", para: "¶", ordf: "ª", ordm: "º", larr: "←", rarr: "→", uarr: "↑", darr: "↓", harr: "↔", rArr: "⇒", check: "✓", aacute: "á", Aacute: "Á", eacute: "é", Eacute: "É", iacute: "í", Iacute: "Í", oacute: "ó", Oacute: "Ó", uacute: "ú", Uacute: "Ú", atilde: "ã", Atilde: "Ã", otilde: "õ", Otilde: "Õ", ccedil: "ç", Ccedil: "Ç", acirc: "â", Acirc: "Â", ecirc: "ê", Ecirc: "Ê", ocirc: "ô", Ocirc: "Ô", agrave: "à", Agrave: "À", uuml: "ü", Uuml: "Ü", ntilde: "ñ", Ntilde: "Ñ", le: "≤", ge: "≥", ne: "≠", shy: "\u00ad", zwj: "\u200d", thinsp: "\u2009", ensp: "\u2002", emsp: "\u2003" };
  function decodificarEntidades(s) {
    return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, function (t, n) {
      if (n.charAt(0) === "#") {
        var c = n.charAt(1).toLowerCase() === "x" ? parseInt(n.slice(2), 16) : parseInt(n.slice(1), 10);
        try { return String.fromCodePoint(c); } catch (e) { return t; }
      }
      return Object.prototype.hasOwnProperty.call(ENTIDADES, n) ? ENTIDADES[n] : t;
    });
  }
  JsSim.decodificarEntidades = decodificarEntidades;

  /* Metas (data-goal): separadas por ";;" (CONTRIBUINDO §3). Nada de outros escapes. */
  var META_NOMES = ["out", "outre", "console", "semerro", "erro", "exit", "src", "arquivo", "dom", "texto"];
  var META_CAIXA = { out: "tryjs", outre: "tryjs", exit: "tryjs", arquivo: "tryjs", console: "tryweb", dom: "tryweb", texto: "tryweb" };
  JsSim.META_NOMES = META_NOMES;
  function dividirMetas(meta) {
    return String(meta || "").split(";;").map(function (x) { return x.replace(/^\s+/, ""); }).filter(Boolean);
  }
  JsSim.dividirMetas = dividirMetas;
  function partesMeta(g) {
    var i = g.indexOf(":");
    return { tipo: (i < 0 ? g : g.slice(0, i)).trim(), val: i < 0 ? "" : g.slice(i + 1), temValor: i >= 0 };
  }
  JsSim.partesMeta = partesMeta;
  // "/regex/flags" → RegExp; senão null (é texto)
  function regexDe(v) {
    var m = /^\/([\s\S]*)\/([dgimsuvy]*)$/.exec(v);
    if (!m) return null;
    return new RegExp(m[1], m[2].replace("g", ""));
  }
  JsSim.regexDe = regexDe;
  function confere(v, txt) { var re = regexDe(v); return re ? re.test(txt) : txt.indexOf(v) >= 0; }

  /* Problemas de uma meta (para o testador): [] = ok.  caixa: "tryjs" | "tryweb" */
  function validarMeta(meta, caixa) {
    var probs = [];
    var lista = dividirMetas(meta);
    if (!lista.length) probs.push("data-goal vazio");
    lista.forEach(function (g) {
      var p = partesMeta(g);
      if (META_NOMES.indexOf(p.tipo) < 0) { probs.push("meta desconhecida \"" + p.tipo + "\" em \"" + g + "\" (só " + META_NOMES.join(", ") + ")"); return; }
      if (caixa && META_CAIXA[p.tipo] && META_CAIXA[p.tipo] !== caixa) { probs.push("a meta \"" + p.tipo + ":\" é da caixa ." + META_CAIXA[p.tipo] + ", não da ." + caixa + ": \"" + g + "\""); return; }
      if (p.tipo === "semerro") { if (p.temValor) probs.push("\"semerro\" não leva valor: \"" + g + "\""); return; }
      if (!p.val) { probs.push("meta sem valor: \"" + g + "\""); return; }
      try {
        if (p.tipo === "outre") new RegExp(p.val);
        else if (p.tipo === "src") new RegExp(p.val, "m");
        else if (p.tipo === "erro") regexDe(p.val);
      } catch (e) { probs.push("regex inválida em \"" + g + "\": " + e.message); }
      if (p.tipo === "exit" && !/^\s*\d{1,3}\s*$/.test(p.val)) probs.push("exit: precisa de um número: \"" + g + "\"");
      if (p.tipo === "arquivo") {
        var nome = p.val.split("~")[0];
        if (!nome || /^\/|(^|\/)\.\.(\/|$)/.test(nome)) probs.push("arquivo: o nome é relativo à pasta do programa: \"" + g + "\"");
      }
      if (p.tipo === "texto" && p.val.indexOf("~") < 0) probs.push("texto: precisa de SELETOR~TEXTO: \"" + g + "\"");
      if (p.tipo === "dom" || p.tipo === "texto") {
        var sel = p.tipo === "texto" ? p.val.split("~")[0] : p.val;
        if (typeof document !== "undefined") { try { document.createDocumentFragment().querySelector(sel); } catch (e) { probs.push("seletor CSS inválido em \"" + g + "\""); } }
      }
    });
    return probs;
  }
  JsSim.validarMeta = validarMeta;

  function arquivosDaMeta(meta) {
    return dividirMetas(meta).map(partesMeta).filter(function (p) { return p.tipo === "arquivo" && p.val; })
      .map(function (p) { return p.val.split("~")[0]; });
  }
  JsSim.arquivosDaMeta = arquivosDaMeta;

  /* ctx: { out: saída do PROGRAMA (stdout+stderr na ordem; sem o eco do que foi digitado) ou,
            na .tryweb, o texto do Console; excecao: bool; traceback: a mensagem do erro;
            exit: número; src: código do leitor (todas as abas); arquivos: {nome: texto|null};
            dom(sel) → bool; texto(sel) → texto|null }
     → lista das metas que falharam */
  function checarMeta(meta, ctx) {
    var falhas = [];
    var out = ctx.out === null || ctx.out === undefined ? null : String(ctx.out);
    dividirMetas(meta).forEach(function (g) {
      var p = partesMeta(g), val = p.val, ok = false;
      try {
        switch (p.tipo) {
          case "out": case "console": ok = out !== null && out.indexOf(val) >= 0; break;
          case "outre": ok = out !== null && new RegExp(val).test(out); break;
          case "semerro": ok = out !== null && !ctx.excecao; break;
          case "erro": ok = !!ctx.excecao && confere(val, String(ctx.traceback || "")); break;
          case "exit": ok = ctx.exit !== null && ctx.exit !== undefined && String(ctx.exit) === val.trim(); break;
          case "src": ok = new RegExp(val, "m").test(ctx.src || ""); break;
          case "arquivo":
            var i = val.indexOf("~"), nome = i < 0 ? val : val.slice(0, i), txt = i < 0 ? null : val.slice(i + 1);
            var a = ctx.arquivos ? ctx.arquivos[nome] : null;
            ok = a !== null && a !== undefined && (txt === null || String(a).indexOf(txt) >= 0);
            break;
          case "dom": ok = !!(ctx.dom && ctx.dom(val.trim())); break;
          case "texto":
            var j = val.indexOf("~"), t = ctx.texto ? ctx.texto(val.slice(0, j).trim()) : null;
            ok = t !== null && t !== undefined && String(t).indexOf(val.slice(j + 1)) >= 0;
            break;
          default: ok = false;
        }
      } catch (e) { ok = false; }
      if (!ok) falhas.push(g);
    });
    return falhas;
  }
  JsSim.checarMeta = checarMeta;

  // texto do atributo: "\n" = Enter, "\t" = Tab, "\\" = uma barra
  function decodificarAttr(s) { return String(s).replace(/\\(n|t|\\)/g, function (t, c) { return c === "n" ? "\n" : c === "t" ? "\t" : "\\"; }); }
  JsSim.decodificarAttr = decodificarAttr;
  // data-stdin → texto entregue ao programa (termina com Enter, como quem digita)
  function textoEntrada(s) { s = decodificarAttr(s); return s === "" || /\n$/.test(s) ? s : s + "\n"; }
  JsSim.textoEntrada = textoEntrada;
  // "a 'b c' \"d\"" → ["a", "b c", "d"] (como o bash separa os argumentos)
  function dividirArgs(s) {
    var r = [], cur = null, i = 0;
    s = String(s || "");
    while (i < s.length) {
      var c = s[i];
      if (/\s/.test(c)) { if (cur !== null) { r.push(cur); cur = null; } i++; continue; }
      if (cur === null) cur = "";
      if (c === "'") { var f = s.indexOf("'", i + 1); if (f < 0) f = s.length; cur += s.slice(i + 1, f); i = f + 1; continue; }
      if (c === '"') { i++; while (i < s.length && s[i] !== '"') { if (s[i] === "\\" && /["\\$`]/.test(s[i + 1] || "")) i++; cur += s[i]; i++; } i++; continue; }
      if (c === "\\" && i + 1 < s.length) { cur += s[i + 1]; i += 2; continue; }
      cur += c; i++;
    }
    if (cur !== null) r.push(cur);
    return r;
  }
  JsSim.dividirArgs = dividirArgs;
  function citarArg(x) { return /^[\w@%+=:,.\/-]+$/.test(x) ? x : "'" + String(x).replace(/'/g, "'\\''") + "'"; }
  JsSim.citarArg = citarArg;
  // repl: o modo interativo (data-repl): "node" (com ou sem abas: com abas, o editor faz .load main.js)
  function linhaComando(arquivo, args, repl) {
    if (repl) return "node";
    return "node " + citarArg(arquivo) + (args && args.length ? " " + args.map(citarArg).join(" ") : "");
  }
  JsSim.linhaComando = linhaComando;

  // Texto com cores ANSI (console.log("\x1b[31m…")) → HTML
  var CORES_ANSI = { 30: "c-k", 31: "c-r", 32: "c-g", 33: "c-y", 34: "c-b", 35: "c-m", 36: "c-c", 37: "c-w", 90: "c-k", 91: "c-r", 92: "c-g", 93: "c-y", 94: "c-b", 95: "c-m", 96: "c-c", 97: "c-w" };
  function ansiParaHtml(s, estado) {
    estado = estado || { negrito: false, cor: null };
    var r = "", re = /\x1b\[([0-9;]*)m/g, ult = 0, m;
    function trecho(t) {
      if (!t) return;
      var cls = (estado.negrito ? "c-n " : "") + (estado.cor || "");
      r += cls.trim() ? '<span class="' + cls.trim() + '">' + escHtml(t) + "</span>" : escHtml(t);
    }
    while ((m = re.exec(s))) {
      trecho(s.slice(ult, m.index));
      ult = re.lastIndex;
      (m[1] === "" ? ["0"] : m[1].split(";")).forEach(function (p) {
        var n = +p;
        if (n === 0) { estado.negrito = false; estado.cor = null; }
        else if (n === 1) estado.negrito = true;
        else if (n === 22) estado.negrito = false;
        else if (n === 39) estado.cor = null;
        else if (CORES_ANSI[n]) estado.cor = CORES_ANSI[n];
      });
    }
    trecho(s.slice(ult).replace(/\x1b\[[0-9;]*$/, "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, ""));
    return r;
  }
  JsSim.ansiParaHtml = ansiParaHtml;

  // a linha abre um bloco (o Enter entra mais 2 espaços)? termina em { ( [ ou =>
  function abreBloco(linha) {
    var l = String(linha).replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""').replace(/\s+$/, "");
    return /[{(\[]$|=>$/.test(l);
  }
  JsSim.abreBloco = abreBloco;
  // conteúdo de uma aba: o <pre> perde o último Enter; arquivos terminam com Enter
  function comEnter(codigo) { return codigo !== "" && codigo.slice(-1) !== "\n" ? codigo + "\n" : codigo; }
  JsSim.comEnter = comEnter;
  // o motor deste navegador: "v8" (Chrome, Edge, Opera… — o mesmo do Node) ou outro
  function motorDoNavegador(ua, brands) {
    if (brands && brands.some(function (b) { return /Chromium|Google Chrome|Microsoft Edge/.test(b.brand); })) return "v8";
    ua = String(ua || "");
    if (/Firefox\//.test(ua)) return "spidermonkey";
    if (/(Chrome|Chromium|CriOS|Edg)\//.test(ua)) return "v8";
    if (/Safari\//.test(ua)) return "javascriptcore";
    return "?";
  }
  JsSim.motorDoNavegador = motorDoNavegador;

  if (typeof module === "object" && module.exports) { module.exports = JsSim; }
  if (typeof document === "undefined") return;
  window.JsSim = JsSim;

  /* =====================================================================
     2. O motor: um Web Worker novo por execução (assets/jssim/worker.js)
     ===================================================================== */
  var base = (function () {
    var s = document.querySelectorAll("script[src]");
    for (var i = 0; i < s.length; i++) { var src = s[i].getAttribute("src"); if (/jssim\.js(\?|$)/.test(src)) return src.replace(/jssim\.js.*$/, ""); }
    return "assets/";
  })();
  JsSim.base = base;
  var MOTOR = motorDoNavegador(navigator.userAgent, navigator.userAgentData && navigator.userAgentData.brands);
  JsSim.motor = MOTOR;

  var reserva = null; // um worker já carregado, esperando o próximo Rodar
  function novoWorker() {
    var w = new Worker(base + "jssim/worker.js?v=" + VERSAO_ARQS);
    var pronto = new Promise(function (ok, falha) {
      w.onmessage = function (e) { if (e.data && e.data.ev === "pronto") { w.onmessage = null; ok(w); } };
      w.onerror = function (e) { if (e.preventDefault) e.preventDefault(); falha(new Error((e && e.message) || "o worker do editor não carregou")); };
    });
    return { w: w, pronto: pronto };
  }
  function pegarWorker() {
    var r = reserva; reserva = null;
    if (!r) r = novoWorker();
    return r.pronto;
  }
  function prepararReserva() { if (!reserva) { try { reserva = novoWorker(); reserva.pronto.catch(function () { reserva = null; }); } catch (e) { reserva = null; } } }
  JsSim.prepararReserva = prepararReserva;

  /* Roda um programa. req = {arquivos:[{nome,codigo}], args:[], stdin: texto|null, repl}
     o = { tempo, digitar:[linhas]|null (o testador), aoSaida(t,s), aoEco(s), aoEspera(), aoFim(r) }
     → {promessa, entrada(texto), eof(), parar(motivo), esperando()} ; r = {saida, segs, eco, exit, excecao,
        traceback, arquivos, interrompido, motivo, ms, modo} */
  function rodarMotor(req, o) {
    o = o || {};
    var limite = o.tempo || TEMPO_MAX;
    var segs = [], eco = [], t0 = Date.now(), gasto = 0, desde = Date.now(), esperando = false, fim = false, w = null;
    var digitar = o.digitar ? o.digitar.slice() : null;
    var resolver, relogio;
    var promessa = new Promise(function (ok) { resolver = ok; });
    function saida() { return segs.filter(function (x) { return x.t !== "eco"; }).map(function (x) { return x.s; }).join(""); }
    function terminar(extra) {
      if (fim) return;
      fim = true; clearInterval(relogio);
      if (w) { try { w.terminate(); } catch (e) {} }
      var r = Object.assign({ saida: saida(), segs: segs, eco: eco, ms: Date.now() - t0, interrompido: false }, extra);
      prepararReserva();
      resolver(r);
    }
    function entrada(texto) {
      if (fim || !w) return;
      esperando = false; desde = Date.now();
      eco.push(texto); segs.push({ t: "eco", s: texto });
      w.postMessage({ op: "entrada", texto: texto });
    }
    function eof() { if (fim || !w) return; esperando = false; desde = Date.now(); w.postMessage({ op: "eof" }); }
    function iniciar(reqAtual) {
      pegarWorker().then(function (ww) {
        if (fim) { ww.terminate(); return; }
        w = ww;
        desde = Date.now();
        w.onerror = function (e) { if (e.preventDefault) e.preventDefault(); };
        w.onmessage = function (e) {
          var m = e.data;
          if (fim) return;
          if (m.ev === "saida") {
            m.partes.forEach(function (p) {
              var u = segs[segs.length - 1];
              if (u && u.t === p.t) u.s += p.s; else segs.push({ t: p.t, s: p.s });
              if (o.aoSaida) o.aoSaida(p.t, p.s);
            });
          } else if (m.ev === "espera") {
            gasto += Date.now() - desde; esperando = true;
            if (digitar) {
              if (digitar.length) { var l = digitar.shift() + "\n"; if (o.aoEco) o.aoEco(l); entrada(l); }
              else eof();
            } else if (o.aoEspera) o.aoEspera();
            else eof();
          } else if (m.ev === "lerTudo") {
            // o programa lê a entrada inteira (fs.readFileSync(0)): pega tudo e roda de novo
            gasto += Date.now() - desde; esperando = true;
            var pegar = digitar ? Promise.resolve(digitar.length ? digitar.join("\n") + "\n" : "") : o.aoLerTudo ? o.aoLerTudo() : Promise.resolve("");
            try { w.terminate(); } catch (x) {}
            w = null;
            pegar.then(function (t) {
              if (fim) return;
              esperando = false;
              segs = []; eco = [t];
              if (o.aoRecomecar) o.aoRecomecar(t);
              var r2 = Object.assign({}, reqAtual, { entradaTotal: t });
              iniciar(r2);
            });
          } else if (m.ev === "limite") terminar({ interrompido: true, motivo: "limite" });
          else if (m.ev === "fim") terminar(m.res);
          else if (m.ev === "falha") terminar({ interrompido: true, motivo: "falha", msg: m.msg });
        };
        w.postMessage({ op: "executar", req: reqAtual });
      }, function (e) { terminar({ interrompido: true, motivo: "falha", msg: String(e && e.message || e) }); });
    }
    relogio = setInterval(function () {
      if (fim || esperando) return;
      var agora = Date.now(); gasto += agora - desde; desde = agora;
      if (gasto > limite) terminar({ interrompido: true, motivo: "tempo" });
    }, 100);
    iniciar(req);
    return {
      promessa: promessa,
      entrada: entrada, eof: eof,
      parar: function (motivo) { terminar({ interrompido: true, motivo: motivo || "parado" }); },
      esperando: function () { return esperando && !fim; },
    };
  }
  JsSim.rodarMotor = rodarMotor;

  /* =====================================================================
     3. Interface da caixa .tryjs
     ===================================================================== */
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (html !== undefined && html !== null) e.innerHTML = html;
    return e;
  }
  JsSim.el = el;
  function lerPre(pre) { return pre.textContent.replace(/^\n/, "").replace(/\n$/, ""); }
  JsSim.lerPre = lerPre;
  JsSim.caixas = [];
  var dono = null; // parar() da caixa que está rodando

  // o editor de código (textarea + números de linha + abas + Restaurar/Ver solução), comum às duas caixas
  function editor(box, w, abas, solucao, aoRodar) {
    var ta = w.querySelector(".ts-code"), nums = w.querySelector(".ts-nums");
    var ativa = 0;
    function ajustar() {
      var n = ta.value.split("\n").length, t = "";
      for (var i = 1; i <= n; i++) t += i + "\n";
      nums.textContent = t;
      ta.style.height = "auto";
      ta.style.height = Math.max(ta.scrollHeight, 60) + "px";
    }
    function salvarAba() { abas[ativa].atual = ta.value; }
    function desenharAbas() {
      var cont = w.querySelector(".tc-tabs");
      cont.innerHTML = abas.map(function (a, i) { return '<button type="button" class="tc-tab' + (i === ativa ? " on" : "") + '" data-i="' + i + '" aria-pressed="' + (i === ativa) + '">' + escHtml(a.nome) + "</button>"; }).join("");
      Array.prototype.forEach.call(cont.querySelectorAll(".tc-tab"), function (b) { b.addEventListener("click", function () { trocarAba(+b.getAttribute("data-i")); }); });
    }
    function trocarAba(i) { salvarAba(); ativa = i; ta.value = abas[i].atual; ajustar(); desenharAbas(); }
    function inserir(txt, a, b) {
      if (ta.setRangeText) ta.setRangeText(txt, a, b, "end");
      else { ta.value = ta.value.slice(0, a) + txt + ta.value.slice(b); ta.selectionStart = ta.selectionEnd = a + txt.length; }
      salvarAba(); ajustar();
    }
    ta.value = abas[0].atual;
    desenharAbas();
    ta.addEventListener("input", function () { salvarAba(); ajustar(); });
    ta.addEventListener("keydown", function (e) {
      var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
      if (e.key === "Tab" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        var ini = v.lastIndexOf("\n", a - 1) + 1;
        if (e.shiftKey) {
          var tira = /^ {1,2}|^\t/.exec(v.slice(ini));
          if (tira) { ta.value = v.slice(0, ini) + v.slice(ini + tira[0].length); ta.selectionStart = Math.max(ini, a - tira[0].length); ta.selectionEnd = Math.max(ini, b - tira[0].length); salvarAba(); ajustar(); }
        } else if (a !== b && v.slice(a, b).indexOf("\n") >= 0) {
          var bloco = v.slice(ini, b).replace(/^/gm, "  ");
          ta.value = v.slice(0, ini) + bloco + v.slice(b); ta.selectionStart = ini; ta.selectionEnd = ini + bloco.length; salvarAba(); ajustar();
        } else inserir("  ", a, b);
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); aoRodar(); }
      else if (e.key === "Enter" && !e.shiftKey) {
        var ini2 = v.lastIndexOf("\n", a - 1) + 1, antes = v.slice(ini2, a), ind = /^[ \t]*/.exec(antes)[0];
        if (abreBloco(antes)) {
          ind += "  ";
          // {|} → abre a linha do meio e põe o } embaixo
          var depois = v.slice(b, v.indexOf("\n", b) < 0 ? v.length : v.indexOf("\n", b));
          if (/^\s*[}\])]/.test(depois)) { e.preventDefault(); inserir("\n" + ind + "\n" + ind.slice(2), a, b); ta.selectionStart = ta.selectionEnd = a + 1 + ind.length; return; }
        }
        if (ind) { e.preventDefault(); inserir("\n" + ind, a, b); }
      } else if (e.key === "}" && a === b) {
        // "}" numa linha só com espaços: volta 2 espaços
        var ini4 = v.lastIndexOf("\n", a - 1) + 1, esp2 = v.slice(ini4, a);
        if (esp2.length >= 2 && /^ +$/.test(esp2)) { e.preventDefault(); ta.value = v.slice(0, a - 2) + "}" + v.slice(b); ta.selectionStart = ta.selectionEnd = a - 1; salvarAba(); ajustar(); }
      } else if (e.key === "Backspace" && a === b && a > 0) {
        var ini3 = v.lastIndexOf("\n", a - 1) + 1, esp = v.slice(ini3, a);
        if (esp.length >= 2 && /^ +$/.test(esp)) { e.preventDefault(); var n2 = esp.length % 2 || 2; ta.value = v.slice(0, a - n2) + v.slice(b); ta.selectionStart = ta.selectionEnd = a - n2; salvarAba(); ajustar(); }
      } else if (e.key === "Escape") { ta.blur(); }
    });
    function restaurar() { abas.forEach(function (a) { a.atual = a.original; }); for (var i = abas.length - 1; i >= 0; i--) if (abas[i].extra) abas.splice(i, 1); ativa = Math.min(ativa, abas.length - 1); ta.value = abas[ativa].atual; ajustar(); desenharAbas(); }
    w.querySelector(".ts-rest").addEventListener("click", restaurar);
    var conf = w.querySelector(".ts-confirma");
    function aplicarSolucao() {
      solucao.forEach(function (sl) {
        var a = abas.filter(function (x) { return x.nome === sl.nome; })[0];
        if (a) a.atual = sl.codigo; else abas.push({ nome: sl.nome, original: "", atual: sl.codigo, extra: true });
      });
      ta.value = abas[ativa].atual; ajustar(); desenharAbas(); conf.hidden = true;
    }
    if (solucao) {
      w.querySelector(".ts-sol").addEventListener("click", function () { conf.hidden = false; });
      w.querySelector(".ts-sim").addEventListener("click", aplicarSolucao);
      w.querySelector(".ts-nao").addEventListener("click", function () { conf.hidden = true; });
    }
    ajustar();
    return { salvarAba: salvarAba, restaurar: restaurar, aplicarSolucao: aplicarSolucao, ajustar: ajustar };
  }
  JsSim.editor = editor;

  function htmlEditor(rotulo, comSolucao) {
    return '<div class="ts-bar"><span class="tc-tabs"></span><span class="ts-sp"></span>' +
      (comSolucao ? '<button type="button" class="sim-btn ts-sol">Ver solução</button>' : "") +
      '<button type="button" class="sim-btn ts-rest" title="Volta ao código original">Restaurar</button></div>' +
      '<div class="ts-confirma" hidden><span>Trocar o seu código pela solução?</span> <button type="button" class="sim-btn2 ts-sim">Sim, mostrar</button> <button type="button" class="sim-btn2 secundario ts-nao">Cancelar</button></div>' +
      '<div class="ts-editor"><pre class="ts-nums" aria-hidden="true"></pre><textarea class="ts-code" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" aria-label="' + rotulo + ' (Ctrl+Enter roda)"></textarea></div>';
  }
  JsSim.htmlEditor = htmlEditor;

  function notaMotor() {
    if (MOTOR === "v8") return null;
    return el("p", { "class": "tc-nota jssim-nota" }, "Você está num navegador " + (MOTOR === "spidermonkey" ? "Firefox" : MOTOR === "javascriptcore" ? "Safari" : "") +
      ", que tem outro motor de JavaScript: o programa roda igual, mas <strong>as mensagens de erro podem sair com outras palavras</strong> que as do Node.js (que usa o motor do Chrome).");
  }

  function montar(box) {
    if (box.getAttribute("data-montado")) return;
    box.setAttribute("data-montado", "1");
    var meta = box.getAttribute("data-goal") || "";
    var repl = box.hasAttribute("data-repl");
    var stdinAttr = repl ? null : box.getAttribute("data-stdin");
    var argsAttr = box.getAttribute("data-args");
    var scripts = Array.prototype.slice.call(box.querySelectorAll("pre.script"));
    var sols = Array.prototype.slice.call(box.querySelectorAll("pre.solucao"));
    var abas = scripts.map(function (p, i) { return { nome: p.getAttribute("data-file") || (i === 0 ? "main.js" : "arquivo" + i + ".txt"), original: lerPre(p), atual: lerPre(p) }; });
    if (!abas.length) abas.push({ nome: "main.js", original: "", atual: "" });
    var solucao = sols.length ? sols.map(function (p, i) { return { nome: p.getAttribute("data-file") || (abas[i] ? abas[i].nome : "main.js"), codigo: lerPre(p) }; }) : null;
    scripts.concat(sols).forEach(function (p) { p.style.display = "none"; });
    var soRepl = repl && !scripts.length;
    var TXT_RODAR = soRepl ? "▶ Abrir o node" : "▶ Rodar";

    var w = el("div", { "class": "ts tc tp" });
    var argsHtml = argsAttr !== null ? '<label class="ts-args-l">Argumentos: <input class="ts-args" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" placeholder="(nenhum)" title="O que chega em process.argv[2], process.argv[3]…"></label>' : "";
    var entradaHtml = stdinAttr !== null
      ? '<label class="tc-entrada-l">Entrada: <textarea class="tc-entrada" rows="' + Math.min(4, Math.max(1, textoEntrada(stdinAttr).replace(/\n$/, "").split("\n").length)) + '" spellcheck="false" autocomplete="off" autocapitalize="off" title="O que a entrada padrão (o teclado) vai entregar, uma linha por Enter"></textarea></label>' : "";
    w.innerHTML = htmlEditor("Código JavaScript", !!solucao) +
      '<div class="ts-run">' + argsHtml + entradaHtml + '<span class="ts-sp"></span>' +
      '<button type="button" class="ts-rodar" title="Ctrl+Enter">' + TXT_RODAR + '</button></div>' +
      '<div class="sim ts-saida" hidden><div class="sim-bar"><span class="sim-dots"><i></i><i></i><i></i></span><span class="sim-title">Terminal — ana@notebook: ~</span></div><div class="sim-screen ts-tela"><div class="sim-out"></div></div></div>';
    box.appendChild(w);
    if (soRepl) { w.querySelector(".ts-bar").style.display = "none"; w.querySelector(".ts-editor").style.display = "none"; }
    var status = null;
    if (meta) { status = el("p", { "class": "sim-status", "aria-live": "polite" }, "Missão em andamento…"); box.appendChild(status); }
    var nota = notaMotor(); if (nota) box.appendChild(nota);

    var btn = w.querySelector(".ts-rodar");
    var argsIn = w.querySelector(".ts-args"), entradaIn = w.querySelector(".tc-entrada");
    var saidaBox = w.querySelector(".ts-saida"), out = w.querySelector(".sim-out"), tela = w.querySelector(".ts-tela");
    if (argsIn) argsIn.value = argsAttr;
    if (entradaIn) entradaIn.value = textoEntrada(stdinAttr).replace(/\n$/, "");
    var ed = editor(box, w, abas, solucao, rodar);
    var cumprida = false, sessao = null, aoTerminar = [];

    function arquivos() {
      ed.salvarAba();
      return abas.map(function (a) { return { nome: a.nome, codigo: comEnter(a.atual) }; });
    }
    function fonte() { return abas.map(function (a) { return a.atual; }).join("\n"); }
    function verificar(ctx) {
      ctx.src = fonte();
      var f = meta ? checarMeta(meta, ctx) : [];
      if (!status || cumprida) return f;
      if (!f.length) { cumprida = true; status.textContent = "✔ Missão cumprida!"; status.className = "sim-status ok"; return f; }
      var tipos = f.map(function (x) { return partesMeta(x).tipo; });
      if (tipos.indexOf("semerro") >= 0 && ctx.excecao) status.textContent = "Missão em andamento… (o programa ainda termina com erro: leia a mensagem em vermelho — a linha do erro e o TypeError/ReferenceError…)";
      else if (tipos.indexOf("erro") >= 0) status.textContent = "Missão em andamento… (a missão pede um erro" + (ctx.excecao ? " diferente)" : "; o programa ainda roda sem erro)");
      else if (tipos.every(function (t) { return t === "src"; })) status.textContent = "Missão em andamento… (a saída está certa, mas a missão pede outro jeito de escrever)";
      else if (tipos.indexOf("arquivo") >= 0 && tipos.every(function (t) { return t === "arquivo" || t === "src"; })) status.textContent = "Missão em andamento… (o arquivo " + arquivosDaMeta(f.join(";;")).join(", ") + " ainda não foi criado com o conteúdo esperado)";
      else if (tipos.every(function (t) { return t === "exit"; })) status.textContent = "Missão em andamento… (o código de saída ainda não é o esperado)";
      else status.textContent = "Missão em andamento… (a saída ainda não é a esperada)";
      return f;
    }

    /* ---------- terminal ---------- */
    function linhaCmd(cmd) { out.appendChild(el("div", { "class": "sim-cmd" }, '<span class="c-u">ana@notebook</span>:<span class="c-d">~</span>$ ' + escHtml(cmd))); rolar(); }
    function info(txt, cls) { var d = el("div", { "class": cls || "sim-info" }); d.textContent = txt; out.appendChild(d); rolar(); return d; }
    function rolar() { tela.scrollTop = tela.scrollHeight; }

    function Terminal() { this.linha = null; this.segs = []; this.n = 0; this.omitidas = 0; this.cauda = []; this.ansi = { negrito: false, cor: null }; }
    Terminal.prototype.escrever = function (t, s) {
      // \r volta ao começo da linha (barras de progresso): apaga o que havia
      var partes = s.split("\n");
      for (var i = 0; i < partes.length; i++) {
        var p = partes[i];
        if (p.indexOf("\r") >= 0) { var k = p.lastIndexOf("\r"); this.segs = this.segs.filter(function (x) { return x.t === "eco"; }); p = p.slice(k + 1); }
        if (p) this.seg(t, p);
        else if (partes[i].indexOf("\r") >= 0) this.desenhar();
        if (i < partes.length - 1) this.fechar();
      }
    };
    Terminal.prototype.seg = function (t, s) {
      var u = this.segs[this.segs.length - 1];
      if (u && u.t === t) u.s += s; else this.segs.push({ t: t, s: s });
      this.desenhar();
    };
    Terminal.prototype.html = function (segs) {
      var est = { negrito: this.ansi.negrito, cor: this.ansi.cor };
      return segs.map(function (x) {
        if (x.t === "eco") return '<span class="sim-digitado">' + escHtml(x.s) + "</span>";
        var h = x.s.indexOf("\x1b") >= 0 ? ansiParaHtml(x.s, est) : escHtml(x.s);
        return x.t === "err" ? '<span class="sim-err">' + h + "</span>" : h;
      }).join("");
    };
    Terminal.prototype.desenhar = function () {
      if (this.n >= MAX_LINHAS) return;
      if (!this.linha) { this.linha = el("div"); out.appendChild(this.linha); }
      var campo = this.linha.querySelector(".ts-campo");
      this.linha.innerHTML = this.html(this.segs);
      if (campo) this.linha.appendChild(campo);
    };
    Terminal.prototype.fechar = function () {
      if (this.n < MAX_LINHAS) { this.desenhar(); if (this.linha && !this.linha.innerHTML) this.linha.innerHTML = "<br>"; }
      else { this.omitidas++; this.cauda.push(this.segs); if (this.cauda.length > 40) this.cauda.shift(); }
      var self = this; this.segs.forEach(function (x) { if (x.t !== "eco" && x.s.indexOf("\x1b") >= 0) ansiParaHtml(x.s, self.ansi); });
      this.n++; this.linha = null; this.segs = [];
    };
    Terminal.prototype.terminar = function () {
      if (this.segs.length) this.fechar();
      if (this.omitidas) {
        var pulo = this.omitidas - this.cauda.length, self = this;
        if (pulo > 0) info("(… mais " + pulo.toLocaleString("pt-BR") + " linhas — o editor mostra só o começo e o fim …)");
        this.cauda.forEach(function (c) { out.appendChild(el("div", null, self.html(c) || "<br>")); });
      }
    };
    Terminal.prototype.linhaAtual = function () {
      if (!this.linha) { this.linha = el("div"); out.appendChild(this.linha); this.desenhar(); }
      return this.linha;
    };

    function parar(motivo) {
      if (!sessao) return;
      sessao.motivoParada = motivo || "^C";
      sessao.h.parar("parado");
    }

    function pedirEntrada(s, tudo) {
      if (s.campo) return;
      var campo = el("input", { "class": "ts-campo", type: "text", spellcheck: "false", autocomplete: "off", autocapitalize: "off", "aria-label": "Digite a resposta para o programa e tecle Enter (Ctrl+D encerra a entrada)" });
      s.term.linhaAtual().appendChild(campo);
      s.campo = campo;
      campo.focus({ preventScroll: true });
      rolar();
      function sair() { if (campo.parentNode) campo.parentNode.removeChild(campo); s.campo = null; }
      campo.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          var v = campo.value;
          sair();
          s.term.escrever("eco", v + "\n");
          rolar();
          if (tudo) { tudo.linhas.push(v); pedirEntrada(s, tudo); return; }
          s.h.entrada(v + "\n");
        } else if (e.ctrlKey && (e.key === "d" || e.key === "D")) {
          e.preventDefault(); sair();
          if (tudo) { tudo.ok(tudo.linhas.length ? tudo.linhas.join("\n") + "\n" : ""); return; }
          s.h.eof();
        } else if (e.ctrlKey && (e.key === "c" || e.key === "C") && campo.selectionStart === campo.selectionEnd) {
          e.preventDefault(); parar();
        }
      });
    }

    function finalizar(s, r) {
      if (s.fim) return;
      s.fim = true;
      if (s.campo && s.campo.parentNode) s.campo.parentNode.removeChild(s.campo);
      if (r.interrompido && r.motivo === "parado" && s.motivoParada === "^C") s.term.escrever("eco", "^C");
      s.term.terminar();
      if (r.interrompido) {
        if (r.motivo === "tempo") info("(o editor parou o programa: ele rodou mais de " + TEMPO_MAX / 1000 + " segundos sem terminar — laço infinito?)");
        else if (r.motivo === "limite") info("(o programa escreveu demais: mais de 2 milhões de caracteres; o editor o parou)");
        else if (r.motivo === "falha") info("(o editor falhou: " + String(r.msg || "").split("\n")[0] + ")", "sim-err");
        else if (s.motivoParada && s.motivoParada !== "^C") info(s.motivoParada);
      }
      var codigo = r.interrompido ? null : r.exit;
      out.appendChild(el("div", { "class": "ts-codigo" + (codigo ? " ts-erro" : "") }, codigo === null || codigo === undefined ? "[programa interrompido]" : "[código de saída: " + codigo + "]"));
      rolar();
      sessao = null; if (dono === parar) dono = null;
      btn.textContent = TXT_RODAR; btn.disabled = false;
      var res = { interrompido: !!r.interrompido, motivo: r.motivo || null, saida: r.saida, exit: codigo, excecao: r.interrompido ? null : !!r.excecao, traceback: r.traceback || "", falhas: null, modo: r.modo || null };
      if (!r.interrompido) res.falhas = verificar({ out: r.saida, excecao: !!r.excecao, traceback: r.traceback || "", exit: r.exit, arquivos: r.arquivos || {} });
      var fs = aoTerminar; aoTerminar = [];
      fs.forEach(function (f) { try { f(res); } catch (e) {} });
    }

    function rodar() {
      if (sessao) { parar(); return; }
      if (dono && dono !== parar) dono("(outro programa foi iniciado nesta página)");
      var arqs = arquivos();
      saidaBox.hidden = false;
      out.innerHTML = "";
      var args = argsIn ? dividirArgs(argsIn.value) : [];
      linhaCmd(linhaComando(arqs[0].nome, args, repl));
      var s = sessao = { fim: false, term: new Terminal(), campo: null };
      dono = parar;
      btn.textContent = "■ Parar"; btn.disabled = false;
      var stdin = entradaIn ? textoEntrada(entradaIn.value) : null;
      var fila = [], desenho = null;
      function desenharFila() { if (desenho) { clearTimeout(desenho); desenho = null; } var f = fila; fila = []; f.forEach(function (p) { s.term.escrever(p.t, p.s); }); rolar(); }
      s.h = rodarMotor({ arquivos: arqs, args: args, stdin: stdin, repl: repl ? (soRepl ? "so" : true) : false }, {
        aoSaida: function (t, txt) { var u = fila[fila.length - 1]; if (u && u.t === t) u.s += txt; else fila.push({ t: t, s: txt }); if (!desenho) desenho = setTimeout(desenharFila, 30); },
        aoEspera: function () { desenharFila(); pedirEntrada(s); },
        aoLerTudo: function () { desenharFila(); return new Promise(function (ok) { pedirEntrada(s, { linhas: [], ok: ok }); }); },
        aoRecomecar: function () { out.innerHTML = ""; linhaCmd(linhaComando(arqs[0].nome, args, repl)); s.term = new Terminal(); },
      });
      s.h.promessa.then(function (r) { desenharFila(); finalizar(s, r); });
    }
    btn.addEventListener("click", rodar);

    // para o testador no navegador (tools/testar-navegador.js)
    var api = {
      tipo: "tryjs", box: box, meta: meta,
      rodar: function () { return new Promise(function (ok) { aoTerminar.push(ok); rodar(); }); },
      testar: function (qual) {
        if (sessao) parar();
        if (qual === "solucao" && solucao) ed.aplicarSolucao(); else ed.restaurar();
        cumprida = false;
        if (status) { status.textContent = "Missão em andamento…"; status.className = "sim-status"; }
        return api.rodar();
      },
      digitar: function (texto) { if (sessao && sessao.campo) { sessao.campo.value = texto; sessao.campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return true; } return false; },
      fimDaEntrada: function () { if (sessao && sessao.campo) { sessao.campo.dispatchEvent(new KeyboardEvent("keydown", { key: "d", ctrlKey: true, bubbles: true })); return true; } return false; },
      esperando: function () { return !!(sessao && sessao.campo); },
      parar: function () { parar(); },
    };
    JsSim.caixas.push(api);
  }

  function estilo() {
    if (document.getElementById("jssim-estilo")) return;
    var st = document.createElement("style");
    st.id = "jssim-estilo";
    st.textContent =
      ".tryjs,.tryweb{margin:22px 0;padding:4px 18px 14px;border:2px dashed var(--accent);border-radius:10px;min-width:0}" +
      ".tryjs .sim,.tryweb .sim{max-width:100%}" +
      ".jssim-nota{font-size:.85em;opacity:.8;margin:6px 0 0}" +
      "@media (max-width:600px){.tryjs,.tryweb{padding:4px 10px 12px}}";
    (document.head || document.documentElement).appendChild(st);
  }

  function montarTudo() {
    estilo();
    var js = document.querySelectorAll(".tryjs");
    Array.prototype.forEach.call(js, function (b) { try { montar(b); } catch (e) { console.error("jssim:", e); } });
    if (js.length) setTimeout(prepararReserva, 300);
    if (document.querySelector(".tryweb")) {
      var sc = document.createElement("script");
      sc.src = base + "jssim/web.js?v=" + VERSAO_ARQS;
      sc.onload = function () { JsSim.montadoWeb = true; };
      document.body.appendChild(sc);
    } else JsSim.montadoWeb = true;
    JsSim.montado = true;
  }
  JsSim.montarTudo = montarTudo;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", montarTudo); else montarTudo();
})();
