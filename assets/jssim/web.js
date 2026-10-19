/* =====================================================================
   jssim/web.js — a caixa .tryweb do Guia JavaScript: uma página de verdade
   (index.html + script.js + style.css…) num quadro "Resultado", com um painel
   "Console" embaixo (o que o console.log escreveu e os erros não tratados, em texto,
   como o Console do Chrome mostra). Carregado pelo assets/jssim.js quando a página
   tem uma caixa .tryweb.
   Como funciona: o index.html vira o srcdoc de um <iframe> (mesma origem); as outras
   abas viram endereços blob: (o <script src="script.js"> passa a apontar para o blob,
   então os erros dizem "script.js:3"). Um <script> do editor roda antes de tudo no
   quadro e liga o console, os erros, o prompt/alert/confirm e os cliques ao editor.
   Nada do Node aqui: na página não existe process, require, module…
   ===================================================================== */
(function () {
  "use strict";
  var JsSim = window.JsSim;
  if (!JsSim) return;
  var el = JsSim.el, escHtml = JsSim.escHtml;

  /* ------------------------------------------------ valores como o Console do Chrome */
  function curto(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function nomeConstrutor(v) { try { var p = Object.getPrototypeOf(v); return p && p.constructor && p.constructor.name || (p === null ? "" : "Object"); } catch (e) { return "Object"; } }
  // o quadro é outra "janela": Map/Set/Date de lá não são instanceof os daqui
  function tag(v) { try { return Object.prototype.toString.call(v).slice(8, -1); } catch (e) { return ""; } }
  function ehErro(v) { return v && typeof v === "object" && typeof v.message === "string" && typeof v.name === "string" && "stack" in v; }
  function chave(k) { return /^[A-Za-z_$][\w$]*$/.test(k) ? k : "'" + k + "'"; }
  function previa(v) {
    // dentro de um objeto/array: o Chrome mostra uma prévia curta
    var t = typeof v;
    if (v === null) return "null";
    if (t === "undefined") return "undefined";
    if (t === "string") return "'" + v + "'";
    if (t === "number") return Object.is(v, -0) ? "-0" : String(v);
    if (t === "boolean") return String(v);
    if (t === "bigint") return v + "n";
    if (t === "symbol") return v.toString();
    if (t === "function") return /^class\b/.test(Function.prototype.toString.call(v)) ? "class " + v.name : "ƒ";
    if (Array.isArray(v)) return "Array(" + v.length + ")";
    if (v.nodeType === 1) return v.tagName.toLowerCase() + (v.id ? "#" + v.id : "") + (typeof v.className === "string" && v.className ? "." + v.className.trim().split(/\s+/).join(".") : "");
    if (ehErro(v)) return v.name + ": " + v.message;
    var n = nomeConstrutor(v);
    if (tag(v) === "Map") return "Map(" + v.size + ")";
    if (tag(v) === "Set") return "Set(" + v.size + ")";
    if (tag(v) === "Date") return v.toString();
    if (tag(v) === "RegExp") return String(v);
    return n && n !== "Object" ? n : "{…}";
  }
  function formatar(v, topo) {
    var t = typeof v;
    if (t === "string") return topo ? v : "'" + v + "'";
    if (v === null || t !== "object" && t !== "function") return previa(v);
    try {
      if (t === "function") {
        var src = Function.prototype.toString.call(v);
        if (/^class\b/.test(src)) return src;
        return src.replace(/^(async\s+)?function\s*\*?\s*/, function (m, a) { return (a || "") + "ƒ " + (/\*/.test(m) ? "* " : ""); });
      }
      if (ehErro(v)) return mapearPilha(String(v.stack || v.name + ": " + v.message));
      if (v.nodeType === 1) { var h = v.outerHTML; return h.length > 300 ? h.slice(0, 299) + "…" : h; }
      if (v.nodeType === 9) return "#document";
      if (v.nodeType === 3) return "\"" + v.data + "\"";
      if (tag(v) === "Date") return v.toString();
      if (tag(v) === "RegExp") return String(v);
      if (Array.isArray(v)) {
        var itens = v.slice(0, 100).map(previa);
        for (var i = 0; i < Math.min(v.length, 100); i++) if (!(i in v)) itens[i] = "vazio";
        return "(" + v.length + ") [" + itens.join(", ") + (v.length > 100 ? ", …" : "") + "]";
      }
      var n = nomeConstrutor(v);
      if (tag(v) === "Map") { var pm = []; v.forEach(function (val, k) { pm.push(previa(k) + " => " + previa(val)); }); return "Map(" + v.size + ") {" + pm.join(", ") + "}"; }
      if (tag(v) === "Set") { var ps = []; v.forEach(function (val) { ps.push(previa(val)); }); return "Set(" + v.size + ") {" + ps.join(", ") + "}"; }
      if (typeof v.length === "number" && typeof v.item === "function") {
        var li = []; for (var j = 0; j < v.length && j < 50; j++) li.push(previa(v[j]));
        return n + "(" + v.length + ") [" + li.join(", ") + "]";
      }
      var ks = Object.keys(v);
      var partes = ks.slice(0, 50).map(function (k) { return chave(k) + ": " + previa(v[k]); });
      return (n && n !== "Object" ? n + " " : "") + "{" + partes.join(", ") + (ks.length > 50 ? ", …" : "") + "}";
    } catch (e) { try { return String(v); } catch (x) { return "?"; } }
  }
  function formatarArgs(args) {
    args = Array.prototype.slice.call(args);
    if (typeof args[0] === "string" && /%[sdifoOc]/.test(args[0])) {
      var resto = args.slice(1);
      var s = args[0].replace(/%([sdifoOc%])/g, function (t, c) {
        if (c === "%") return "%";
        if (!resto.length) return t;
        var v = resto.shift();
        if (c === "c") return "";
        if (c === "d" || c === "i") return typeof v === "number" ? String(Math.trunc(v)) : String(parseInt(v, 10));
        if (c === "f") return String(parseFloat(v));
        if (c === "s") return typeof v === "string" ? v : formatar(v, false);
        return formatar(v, false);
      });
      args = [s].concat(resto);
    }
    return args.map(function (a) { return formatar(a, true); }).join(" ");
  }
  var blobsNomes = {}; // url do blob → nome da aba
  function mapearPilha(s) {
    return String(s).replace(/blob:[^\s)]+?(?=:\d+:\d+)/g, function (u) { return blobsNomes[u] || u; })
      .replace(/about:srcdoc/g, "index.html");
  }
  JsSim.formatarChrome = formatarArgs;

  /* ------------------------------------------------ a página no quadro */
  function ehFragmento(c) { return !/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(String(c).replace(/<!--[\s\S]*?-->/g, "")); }
  var seq = 0;
  window.__jsweb = {};

  function urlAba(abas, nome, urls) {
    var a = null;
    nome = String(nome).replace(/^\.\//, "").split(/[?#]/)[0];
    abas.forEach(function (x) { if (x.nome === nome) a = x; });
    if (!a) return null;
    if (urls[nome]) return urls[nome];
    var tipo = /\.css$/i.test(nome) ? "text/css" : /\.m?js$/i.test(nome) ? "text/javascript" : /\.json$/i.test(nome) ? "application/json" : /\.svg$/i.test(nome) ? "image/svg+xml" : "text/plain";
    var cod = a.codigo;
    if (/\.m?js$/i.test(nome)) {
      // import "./outro.js" entre as abas
      cod = cod.replace(/(\bimport\s*(?:[\w$*{},\s]+?\s*from\s*)?|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)(["'])(\.{0,2}\/[^"'\n]+)\2/g, function (t, a1, q, esp) {
        var u = urlAba(abas, esp.replace(/^\.\//, ""), urls);
        return u ? a1 + q + u + q : t;
      });
    }
    var u = URL.createObjectURL(new Blob([cod], { type: tipo + ";charset=utf-8" }));
    urls[nome] = u; blobsNomes[u] = nome;
    return u;
  }
  function montarHtml(abas, id) {
    var urls = {};
    var html = abas[0].codigo;
    // <script src="script.js">, <link href="style.css">, <img src="foto.svg"> das abas → blob:
    html = html.replace(/(<(?:script|link|img|source|iframe)\b[^>]*?\b(?:src|href)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi, function (t, a, v, v1, v2, v3) {
      var val = v1 !== undefined ? v1 : v2 !== undefined ? v2 : v3;
      var u = urlAba(abas, val, urls);
      return u ? a + "\"" + u + "\"" : t;
    });
    var ponte = "<script>parent.__jsweb[" + JSON.stringify(id) + "]&&parent.__jsweb[" + JSON.stringify(id) + "](window)<\/script>";
    if (ehFragmento(html)) return "<!DOCTYPE html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" + ponte + "</head><body>\n" + html + "\n</body></html>";
    if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, function (m) { return m + ponte; });
    if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, function (m) { return m + "<head>" + ponte + "</head>"; });
    return html.replace(/(<!doctype[^>]*>)/i, "$1" + ponte);
  }

  /* Pagina: roda as abas num iframe dentro de host.
     opc: { aoConsole(tipo, texto), aoMudar(), respostas: [textos para o prompt] | null (null = o leitor responde) } */
  function Pagina(host, abas, opc) {
    this.id = "p" + (++seq) + "-" + Date.now();
    this.opc = opc || {};
    this.linhas = []; this.excecao = false; this.traceback = "";
    this.respostas = this.opc.respostas ? this.opc.respostas.slice() : null;
    var self = this;
    window.__jsweb[this.id] = function (win) { self.ligar(win); };
    var f = this.frame = el("iframe", { "class": "jw-frame", title: "Resultado da página", loading: "eager" });
    this.carregou = new Promise(function (ok) { f.addEventListener("load", function () { ok(); }, { once: true }); });
    host.appendChild(f);
    f.srcdoc = montarHtml(abas, this.id);
  }
  Pagina.prototype.registrar = function (tipo, txt) {
    this.linhas.push({ tipo: tipo, txt: txt });
    if (this.opc.aoConsole) this.opc.aoConsole(tipo, txt);
  };
  Pagina.prototype.texto = function () { return this.linhas.map(function (l) { return l.txt; }).join("\n"); };
  // localStorage/sessionStorage do quadro: só as chaves "tryweb:…" do site do guia (um clear() na
  // caixa não apaga o tema do leitor); os dados ficam guardados entre um Rodar e outro, como num site
  var PREFIXO = "tryweb:";
  function armazenamento(win, real) {
    function chaves() { var r = []; for (var i = 0; i < real.length; i++) { var k = real.key(i); if (k !== null && k.indexOf(PREFIXO) === 0) r.push(k.slice(PREFIXO.length)); } return r; }
    var metodos = {
      getItem: function getItem(k) { return real.getItem(PREFIXO + String(k)); },
      setItem: function setItem(k, v) { real.setItem(PREFIXO + String(k), String(v)); },
      removeItem: function removeItem(k) { real.removeItem(PREFIXO + String(k)); },
      clear: function clear() { chaves().forEach(function (k) { real.removeItem(PREFIXO + k); }); },
      key: function key(i) { var c = chaves(); return i >= 0 && i < c.length ? c[i] : null; },
    };
    var alvo = Object.create(win.Storage ? win.Storage.prototype : Object.prototype);
    return new Proxy(alvo, {
      get: function (t, k) {
        if (k === "length") return chaves().length;
        if (typeof k === "symbol") return k === Symbol.toStringTag ? "Storage" : undefined;
        if (Object.prototype.hasOwnProperty.call(metodos, k)) return metodos[k];
        var v = real.getItem(PREFIXO + k);
        return v === null ? (k in Object.prototype ? Object.prototype[k] : undefined) : v;
      },
      set: function (t, k, v) { if (typeof k === "string") real.setItem(PREFIXO + k, String(v)); return true; },
      deleteProperty: function (t, k) { if (typeof k === "string") real.removeItem(PREFIXO + k); return true; },
      has: function (t, k) { return typeof k === "string" && (real.getItem(PREFIXO + k) !== null || k in metodos || k === "length"); },
      ownKeys: function () { return chaves(); },
      getOwnPropertyDescriptor: function (t, k) { var v = typeof k === "string" ? real.getItem(PREFIXO + k) : null; return v === null ? undefined : { value: v, writable: true, enumerable: true, configurable: true }; },
    });
  }
  function limparArmazenamento() {
    [window.localStorage, window.sessionStorage].forEach(function (real) {
      try { for (var i = real.length - 1; i >= 0; i--) { var k = real.key(i); if (k && k.indexOf(PREFIXO) === 0) real.removeItem(k); } } catch (e) {}
    });
  }
  Pagina.prototype.ligar = function (win) {
    var self = this;
    this.win = win;
    ["localStorage", "sessionStorage"].forEach(function (nome) {
      try { var real = window[nome]; Object.defineProperty(win, nome, { value: armazenamento(win, real), configurable: true, enumerable: true }); } catch (e) {}
    });
    var c = win.console;
    ["log", "info", "warn", "error", "debug", "dir", "table", "trace", "assert", "count", "group", "groupEnd", "time", "timeEnd"].forEach(function (t) {
      var orig = c[t];
      if (typeof orig !== "function") return;
      var contagens = {}, tempos = {};
      c[t] = function () {
        try {
          var a = arguments;
          if (t === "assert") { if (a[0]) return orig.apply(c, a); self.registrar("error", "Assertion failed" + (a.length > 1 ? ": " + formatarArgs(Array.prototype.slice.call(a, 1)) : "")); }
          else if (t === "count") { var r = a[0] === undefined ? "default" : String(a[0]); contagens[r] = (contagens[r] || 0) + 1; self.registrar("log", r + ": " + contagens[r]); }
          else if (t === "time") { tempos[a[0] === undefined ? "default" : String(a[0])] = win.performance.now(); }
          else if (t === "timeEnd") { var r2 = a[0] === undefined ? "default" : String(a[0]); if (tempos[r2] !== undefined) self.registrar("log", r2 + ": " + (win.performance.now() - tempos[r2]) + " ms"); }
          else if (t === "groupEnd") { /* nada */ }
          else if (t === "group") { if (a.length) self.registrar("log", formatarArgs(a)); }
          else if (t === "trace") self.registrar("log", "console.trace" + (a.length ? " " + formatarArgs(a) : ""));
          else if (t === "table") self.registrar("log", formatarArgs(a));
          else self.registrar(t === "warn" ? "warn" : t === "error" ? "error" : "log", formatarArgs(a));
        } catch (e) {}
        return orig.apply(c, arguments);
      };
    });
    win.addEventListener("error", function (e) {
      var alvo = e.target;
      if (alvo && alvo !== win && alvo.nodeType === 1) {
        var u = alvo.getAttribute("src") || alvo.getAttribute("href") || "";
        self.registrar("error", "GET " + u + " net::ERR_FILE_NOT_FOUND");
        return;
      }
      self.excecao = true;
      var msg = e.error && ehErro(e.error) ? "Uncaught " + mapearPilha(e.error.stack || (e.error.name + ": " + e.error.message)) : "Uncaught " + (e.error !== undefined ? formatar(e.error, false) : (e.message || "Error").replace(/^Uncaught /, ""));
      if (e.error === undefined && e.filename) msg += "\n    at " + mapearPilha(e.filename + ":" + e.lineno + ":" + e.colno);
      self.traceback += (self.traceback ? "\n" : "") + msg;
      self.registrar("error", msg);
    }, true);
    win.addEventListener("unhandledrejection", function (e) {
      self.excecao = true;
      var r = e.reason;
      var msg = "Uncaught (in promise) " + (ehErro(r) ? mapearPilha(r.stack || r.name + ": " + r.message) : formatar(r, false));
      self.traceback += (self.traceback ? "\n" : "") + msg;
      self.registrar("error", msg);
    });
    // prompt/alert/confirm: o leitor responde de verdade; o testador usa as respostas do data-acoes
    if (this.respostas) {
      win.prompt = function (m, padrao) { var r = self.respostas.length ? self.respostas.shift() : null; self.registrar("info", "[prompt] " + (m === undefined ? "" : m) + " → " + (r === null ? "(cancelado)" : r)); return r === null && padrao !== undefined && false ? padrao : r; };
      win.alert = function (m) { self.registrar("info", "[alert] " + (m === undefined ? "" : String(m))); };
      win.confirm = function (m) { self.registrar("info", "[confirm] " + (m === undefined ? "" : String(m)) + " → OK"); return true; };
    }
    // formulário sem preventDefault: a página recarregaria; o editor avisa
    win.addEventListener("submit", function (e) {
      setTimeout(function () {
        if (!e.defaultPrevented) { e.preventDefault(); self.registrar("info", "[editor] o formulário foi enviado: num site de verdade a página recarregaria (e o Console seria limpo). Use evento.preventDefault() para ficar na página."); }
      }, 0);
    });
    win.addEventListener("submit", function (e) { if (!e.defaultPrevented) { e.preventDefault(); e.__jswebEnviado = true; } }, false);
    ["click", "input", "change", "keyup", "submit"].forEach(function (t) {
      win.addEventListener(t, function () { if (self.opc.aoMudar) setTimeout(function () { self.opc.aoMudar(); }, 60); }, true);
    });
    // links de navegação dentro do quadro: só o #âncora funciona
    win.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a || e.defaultPrevented) return;
      var h = a.getAttribute("href") || "";
      if (h.charAt(0) === "#" || /^javascript:/i.test(h)) return;
      e.preventDefault();
      self.registrar("info", "[editor] este link abriria " + (a.target === "_blank" ? "numa nova aba: " : ": ") + a.href.replace(/^about:srcdoc/, ""));
    });
  };
  Pagina.prototype.doc = function () { try { return this.frame.contentDocument; } catch (e) { return null; } };
  Pagina.prototype.dom = function (sel) { var d = this.doc(); try { return !!(d && d.querySelector(sel)); } catch (e) { return false; } };
  Pagina.prototype.textoDe = function (sel) { var d = this.doc(); try { var x = d && d.querySelector(sel); return x ? x.textContent : null; } catch (e) { return null; } };
  Pagina.prototype.destruir = function () { delete window.__jsweb[this.id]; if (this.frame.parentNode) this.frame.parentNode.removeChild(this.frame); };

  /* ------------------------------------------------ ações (data-acoes) */
  function dividirAcoes(s) { return String(s || "").split(";;").map(function (x) { return x.trim(); }).filter(Boolean); }
  JsSim.dividirAcoes = dividirAcoes;
  function respostasDe(acoes) { return dividirAcoes(acoes).filter(function (a) { return /^responder\b/.test(a); }).map(function (a) { return a.replace(/^responder\s?/, ""); }); }
  function esperar(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function executarAcao(pg, a) {
    var win = pg.win, doc = pg.doc();
    if (!win || !doc) return Promise.resolve("a página não carregou");
    var m;
    if ((m = /^esperar\s+(\d+)$/.exec(a))) return esperar(+m[1]).then(function () { return null; });
    if (/^responder\b/.test(a)) return Promise.resolve(null);
    if ((m = /^clicar\s+(.+)$/.exec(a))) {
      var alvo = doc.querySelector(m[1]);
      if (!alvo) return Promise.resolve("não achei " + m[1]);
      alvo.click();
      return esperar(30).then(function () { return null; });
    }
    if ((m = /^digitar\s+(\S+)\s?([\s\S]*)$/.exec(a))) {
      var campo = doc.querySelector(m[1]);
      if (!campo) return Promise.resolve("não achei " + m[1]);
      campo.focus();
      var txt = m[2];
      for (var i = 0; i < txt.length; i++) {
        var ch = txt[i];
        campo.dispatchEvent(new win.KeyboardEvent("keydown", { key: ch, bubbles: true, cancelable: true }));
        if ("value" in campo) campo.value += ch; else campo.textContent += ch;
        campo.dispatchEvent(new win.InputEvent("input", { data: ch, inputType: "insertText", bubbles: true }));
        campo.dispatchEvent(new win.KeyboardEvent("keyup", { key: ch, bubbles: true }));
      }
      campo.dispatchEvent(new win.Event("change", { bubbles: true }));
      return esperar(30).then(function () { return null; });
    }
    if ((m = /^tecla\s+(.+)\s+(\S+)$/.exec(a))) {
      var c2 = doc.querySelector(m[1]);
      if (!c2) return Promise.resolve("não achei " + m[1]);
      var k = m[2], code = k.length === 1 ? "Key" + k.toUpperCase() : k;
      var kc = { Enter: 13, Escape: 27, Tab: 9, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, " ": 32, Backspace: 8 }[k] || (k.length === 1 ? k.toUpperCase().charCodeAt(0) : 0);
      c2.focus();
      var ok = c2.dispatchEvent(new win.KeyboardEvent("keydown", { key: k, code: code, keyCode: kc, which: kc, bubbles: true, cancelable: true }));
      if (k === "Enter") c2.dispatchEvent(new win.KeyboardEvent("keypress", { key: k, code: code, keyCode: 13, which: 13, charCode: 13, bubbles: true, cancelable: true }));
      c2.dispatchEvent(new win.KeyboardEvent("keyup", { key: k, code: code, keyCode: kc, which: kc, bubbles: true }));
      // Enter num campo de formulário envia o formulário (como o navegador faz)
      if (ok && k === "Enter" && c2.form && c2.tagName === "INPUT") { try { c2.form.requestSubmit(); } catch (e) {} }
      return esperar(30).then(function () { return null; });
    }
    return Promise.resolve("ação desconhecida: " + a);
  }

  /* ------------------------------------------------ para o testador */
  // roda as abas numa página escondida, faz as ações e confere as metas
  JsSim.testarWeb = function (abas, opc) {
    opc = opc || {};
    limparArmazenamento(); // o testador começa cada execução sem dados guardados
    var host = el("div", { style: "position:absolute;left:-10000px;top:0;width:800px;height:600px;overflow:hidden" });
    document.body.appendChild(host);
    var pg = new Pagina(host, abas, { respostas: respostasDe(opc.acoes) });
    var falhaAcao = null;
    var tempo = new Promise(function (ok) { setTimeout(ok, 8000); });
    return Promise.race([pg.carregou, tempo]).then(function () { return esperar(150); }).then(function () {
      var lista = dividirAcoes(opc.acoes);
      return lista.reduce(function (p, a) {
        return p.then(function () { return executarAcao(pg, a).then(function (r) { if (r && !falhaAcao) falhaAcao = a + " (" + r + ")"; }); });
      }, Promise.resolve());
    }).then(function () { return esperar(150); }).then(function () {
      var src = abas.map(function (a) { return a.codigo; }).join("\n");
      var ctx = { out: pg.texto(), excecao: pg.excecao, traceback: pg.traceback, src: src, dom: function (s) { return pg.dom(s); }, texto: function (s) { return pg.textoDe(s); } };
      var r = { falhas: opc.goal ? JsSim.checarMeta(opc.goal, ctx) : [], console: pg.texto(), excecao: pg.excecao, traceback: pg.traceback, falhaAcao: falhaAcao, html: (pg.doc() && pg.doc().body) ? pg.doc().body.innerHTML.slice(0, 2000) : "" };
      pg.destruir(); host.parentNode.removeChild(host);
      return r;
    });
  };

  /* ------------------------------------------------ a caixa .tryweb */
  function montar(box) {
    if (box.getAttribute("data-montado")) return;
    box.setAttribute("data-montado", "1");
    var meta = box.getAttribute("data-goal") || "";
    var acoes = box.getAttribute("data-acoes") || "";
    var scripts = Array.prototype.slice.call(box.querySelectorAll("pre.script"));
    var sols = Array.prototype.slice.call(box.querySelectorAll("pre.solucao"));
    var abas = scripts.map(function (p, i) { return { nome: p.getAttribute("data-file") || (i === 0 ? "index.html" : "arquivo" + i + ".txt"), original: JsSim.lerPre(p), atual: JsSim.lerPre(p) }; });
    if (!abas.length) abas.push({ nome: "index.html", original: "", atual: "" });
    var solucao = sols.length ? sols.map(function (p, i) { return { nome: p.getAttribute("data-file") || (abas[i] ? abas[i].nome : "index.html"), codigo: JsSim.lerPre(p) }; }) : null;
    scripts.concat(sols).forEach(function (p) { p.style.display = "none"; });

    var w = el("div", { "class": "ts tc tp jw" });
    w.innerHTML = JsSim.htmlEditor("Código da página", !!solucao) +
      '<div class="ts-run"><span class="ts-sp"></span><button type="button" class="ts-rodar" title="Ctrl+Enter">▶ Rodar</button></div>' +
      '<div class="jw-saida" hidden>' +
      '<div class="jw-quadro"><div class="jw-bar"><span class="sim-dots"><i></i><i></i><i></i></span><span class="jw-tit">Resultado</span></div><div class="jw-host"></div></div>' +
      '<div class="jw-console"><div class="jw-bar jw-bar2"><span class="jw-tit">Console</span><span class="ts-sp"></span><button type="button" class="sim-btn jw-limpar" title="Limpar o Console">Limpar</button></div><div class="jw-linhas" role="log" aria-live="polite"></div></div>' +
      "</div>";
    box.appendChild(w);
    var status = null;
    if (meta) { status = el("p", { "class": "sim-status", "aria-live": "polite" }, "Missão em andamento…"); box.appendChild(status); }
    var btn = w.querySelector(".ts-rodar"), saida = w.querySelector(".jw-saida"), host = w.querySelector(".jw-host"), linhas = w.querySelector(".jw-linhas");
    var ed = JsSim.editor(box, w, abas, solucao, rodar);
    var pg = null, cumprida = false, aoTerminar = [];
    w.querySelector(".jw-limpar").addEventListener("click", function () { linhas.innerHTML = ""; });

    function fonte() { return abas.map(function (a) { return a.atual; }).join("\n"); }
    function verificar() {
      if (!pg) return null;
      var ctx = { out: pg.texto(), excecao: pg.excecao, traceback: pg.traceback, src: fonte(), dom: function (s) { return pg.dom(s); }, texto: function (s) { return pg.textoDe(s); } };
      var f = meta ? JsSim.checarMeta(meta, ctx) : [];
      if (!status || cumprida) return f;
      if (!f.length) { cumprida = true; status.textContent = "✔ Missão cumprida!"; status.className = "sim-status ok"; return f; }
      var tipos = f.map(function (x) { return JsSim.partesMeta(x).tipo; });
      if (tipos.indexOf("semerro") >= 0 && pg.excecao) status.textContent = "Missão em andamento… (a página tem um erro: veja a linha vermelha no Console)";
      else if (tipos.every(function (t) { return t === "src"; })) status.textContent = "Missão em andamento… (o resultado está certo, mas a missão pede outro jeito de escrever)";
      else if (acoes && tipos.some(function (t) { return t === "texto" || t === "dom" || t === "console"; })) status.textContent = "Missão em andamento… (rode e use a página: clique, digite…)";
      else status.textContent = "Missão em andamento… (o resultado ainda não é o esperado)";
      return f;
    }
    function linhaConsole(tipo, txt) {
      var d = el("div", { "class": "jw-l jw-" + tipo });
      d.textContent = txt;
      linhas.appendChild(d);
      linhas.scrollTop = linhas.scrollHeight;
    }
    function rodar() {
      ed.salvarAba();
      if (pg) pg.destruir();
      saida.hidden = false;
      linhas.innerHTML = "";
      var arqs = abas.map(function (a) { return { nome: a.nome, codigo: a.atual }; });
      var este = pg = new Pagina(host, arqs, { aoConsole: linhaConsole, aoMudar: function () { if (pg === este) verificar(); }, respostas: api.testando ? respostasDe(acoes) : null });
      pg.carregou.then(function () { return esperar(200); }).then(function () {
        if (pg !== este) return;
        var f = verificar();
        var fs = aoTerminar; aoTerminar = [];
        fs.forEach(function (x) { try { x({ falhas: f, console: este.texto(), excecao: este.excecao, traceback: este.traceback }); } catch (e) {} });
      });
    }
    btn.addEventListener("click", rodar);
    var api = {
      tipo: "tryweb", box: box, meta: meta, acoes: acoes, testando: false,
      rodar: function () { return new Promise(function (ok) { aoTerminar.push(ok); rodar(); }); },
      testar: function (qual) {
        if (qual === "solucao" && solucao) ed.aplicarSolucao(); else ed.restaurar();
        cumprida = false;
        if (status) { status.textContent = "Missão em andamento…"; status.className = "sim-status"; }
        limparArmazenamento();
        api.testando = true;
        return api.rodar().then(function () {
          return dividirAcoes(acoes).reduce(function (p, a) { return p.then(function () { return executarAcao(pg, a); }); }, Promise.resolve()).then(function () { return esperar(200); }).then(function () {
            api.testando = false;
            return { falhas: verificar(), console: pg.texto(), excecao: pg.excecao, traceback: pg.traceback };
          });
        });
      },
    };
    JsSim.caixas.push(api);
  }

  function estilo() {
    if (document.getElementById("jsweb-estilo")) return;
    var st = document.createElement("style");
    st.id = "jsweb-estilo";
    st.textContent =
      ".jw-saida{margin-top:10px;display:grid;gap:10px}" +
      ".jw-quadro,.jw-console{border:1px solid var(--border,#d9d6cf);border-radius:8px;overflow:hidden;background:var(--code-bg)}" +
      ".jw-bar{display:flex;align-items:center;gap:8px;padding:5px 10px;font:600 12.5px/1.4 system-ui,sans-serif;color:var(--muted);border-bottom:1px solid var(--border,#d9d6cf)}" +
      ".jw-host{background:#fff}" +
      ".jw-frame{display:block;width:100%;height:260px;border:0;background:#fff;resize:vertical}" +
      ".jw-linhas{font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;max-height:220px;overflow:auto;padding:4px 0;min-height:2.2em}" +
      ".jw-l{white-space:pre-wrap;word-break:break-word;padding:2px 10px;border-bottom:1px solid color-mix(in srgb,var(--border,#d9d6cf) 50%,transparent);color:var(--code-text)}" +
      ".jw-warn{background:color-mix(in srgb,#f5c400 16%,transparent);color:color-mix(in srgb,#8a6100 70%,var(--code-text))}" +
      ".jw-error{background:color-mix(in srgb,#e5484d 13%,transparent);color:color-mix(in srgb,#c62828 75%,var(--code-text))}" +
      ".jw-info{color:var(--muted);font-style:italic}" +
      ".jw .sim-btn.jw-limpar{font-size:12px;padding:1px 8px}";
    (document.head || document.documentElement).appendChild(st);
  }
  estilo();
  Array.prototype.forEach.call(document.querySelectorAll(".tryweb"), function (b) { try { montar(b); } catch (e) { console.error("jssim/web:", e); } });
  JsSim.montadoWeb = true;
})();
