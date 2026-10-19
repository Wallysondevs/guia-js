/* =====================================================================
   jssim/worker.js — o "node" do editor do Guia JavaScript.
   Roda num Web Worker (um por execução: cada Rodar parte do zero) e imita o
   `node main.js` do Node.js v24.22.0 com o JavaScript DO PRÓPRIO NAVEGADOR:
   console (util.inspect do Node, extraído: jssim/inspect.js), process, require/import
   das abas, node:fs numa pasta em memória (/home/ana), path, readline, events, util,
   os, assert, timers, erros não tratados no formato do Node.
   Protocolo (postMessage):
     ← {op:"executar", req:{arquivos:[{nome,codigo}], args:[], stdin:texto|null, repl:false|true|"so", conferir:[]}}
     ← {op:"entrada", texto} | {op:"eof"}
     → {ev:"saida", partes:[{t:"out"|"err", s}]}  {ev:"espera"}  {ev:"limite"}
     → {ev:"fim", res:{exit, excecao, traceback, arquivos, modo}}
   ===================================================================== */
(function () {
  "use strict";
  var G = self;
  var NODE_VERSAO = "v24.22.0";
  var HOME = "/home/ana";
  var LIMITE_SAIDA = 2000000;
  var postar = G.postMessage.bind(G);
  var nSetTimeout = G.setTimeout.bind(G), nClearTimeout = G.clearTimeout.bind(G);
  var nQueueMicrotask = G.queueMicrotask ? G.queueMicrotask.bind(G) : function (f) { Promise.resolve().then(f); };
  var nImportScripts = G.importScripts.bind(G);
  var nFetch = G.fetch ? G.fetch.bind(G) : null;
  var NativePromise = G.Promise;
  var NWorker = G.Worker, NBlob = G.Blob, NMessageChannel = G.MessageChannel;
  // V8 (Chrome, Edge…): o Error.prepareStackTrace funciona. O Firefox tem captureStackTrace, mas não o prepareStackTrace
  var ehV8 = (function () {
    if (typeof Error.captureStackTrace !== "function") return false;
    var o = Error.prepareStackTrace;
    try { Error.prepareStackTrace = function () { return "v8"; }; return new Error().stack === "v8"; }
    catch (e) { return false; } finally { Error.prepareStackTrace = o; }
  })();
  var BASE = (function () { try { return String(G.location.href).replace(/[^/]*$/, ""); } catch (e) { return ""; } })();
  nImportScripts(BASE + "inspect.js" + (function () { try { return G.location.search; } catch (e) { return ""; } })());
  var U = G.util; try { delete G.util; } catch (e) { G.util = undefined; }
  Error.stackTraceLimit = 80;

  /* ------------------------------------------------------------ estado */
  var req = null;
  var encerrado = false, codigoSaida = 0, houveExcecao = false, textoExcecao = "";
  var ativos = 0;              // "handles" que seguram o laço de eventos (timers, stdin lendo, fetch…)
  var principalPendente = false; // ESM com await no topo ainda não terminou
  var buffer = [], tamBuffer = 0, totalSaida = 0, ultimoEnvio = 0;
  var arquivosInfo = {};       // url do blob/script → { caminho, mostrar, linha1: deslocamento da coluna na linha 1, cjs, fonte }
  var fontes = {};             // caminho → código (para o cabeçalho do erro)
  var marcas = new WeakMap();  // erro → { topo:[frames do Node], cab: "node:fs:483\n…", semUsuario }
  var esmComAwait = false;

  function contarLinhas(s) { return s.split("\n").length; }

  /* ------------------------------------------------------------ saída */
  function enviarSaida() {
    if (!buffer.length) return;
    postar({ ev: "saida", partes: buffer });
    buffer = []; tamBuffer = 0; ultimoEnvio = Date.now();
  }
  function escrever(t, s) {
    s = String(s);
    if (encerrado || !s) return;
    totalSaida += s.length;
    if (totalSaida > LIMITE_SAIDA) { enviarSaida(); encerrado = true; postar({ ev: "limite" }); throw SAIR; }
    var u = buffer[buffer.length - 1];
    if (u && u.t === t) u.s += s; else buffer.push({ t: t, s: s });
    tamBuffer += s.length;
    if (tamBuffer > 8192 || Date.now() - ultimoEnvio > 40) enviarSaida();
    else agendarEnvio();
  }
  var envioAgendado = false;
  function agendarEnvio() {
    if (envioAgendado) return;
    envioAgendado = true;
    nSetTimeout(function () { envioAgendado = false; enviarSaida(); }, 16);
  }
  var SAIR = { jsNodeSair: true };

  /* ------------------------------------------------- pilha (stack) como no Node */
  var CJS_COMPILE = [
    "Module._compile (node:internal/modules/cjs/loader:1929:14)",
    "Object..js (node:internal/modules/cjs/loader:2060:10)",
    "Module.load (node:internal/modules/cjs/loader:1651:32)",
    "Module._load (node:internal/modules/cjs/loader:1443:12)",
    "wrapModuleLoad (node:internal/modules/cjs/loader:261:19)"];
  var CJS_MAIN = ["Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)", "node:internal/main/run_main_module:33:47"];
  var CJS_REQUIRE = ["Module.require (node:internal/modules/cjs/loader:1674:12)", "require (node:internal/modules/helpers:157:16)"];
  var ESM_MAIN = ["ModuleJob.run (node:internal/modules/esm/module_job:561:25)", "async node:internal/modules/esm/loader:647:26", "async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)"];
  var CONTEXTOS = {
    jsNodeCompilar: CJS_COMPILE,
    jsNodePrincipal: CJS_MAIN,
    jsNodeRequire: CJS_REQUIRE,
    jsNodeTimer: ["listOnTimeout (node:internal/timers:685:17)", "process.processTimers (node:internal/timers:618:7)"],
    jsNodeImmediate: ["process.processImmediate (node:internal/timers:574:21)"],
    jsNodeFsAbriu: ["FSReqCallback.readFileAfterOpen [as oncomplete] (node:fs:300:13)"],
    jsNodeFsLido: ["FSReqCallback.readFileAfterClose [as oncomplete] (node:internal/fs/read/context:96:3)"],
    jsNodeFsStat: ["FSReqCallback.oncomplete (node:fs:199:5)"],
    jsNodeFsOk: ["FSReqCallback.oncomplete (node:fs:187:23)"],
    jsNodeTick: ["process.processTicksAndRejections (node:internal/process/task_queues:85:11)"],
  };
  function ehInterno(arq) { return !arq || arq.indexOf(BASE) === 0 && !arquivosInfo[arq]; }

  function frameV8(c) {
    var arq = c.getFileName ? c.getFileName() : null;
    var info = arq && arquivosInfo[arq];
    var s;
    try { s = String(c); } catch (e) { s = "<anonymous>"; }
    if (!info) return s;
    var l = c.getLineNumber(), col = c.getColumnNumber();
    var col2 = l === 1 ? col - info.linha1 : col;
    var loc = info.mostrar + ":" + l + ":" + col2;
    s = s.split(arq + ":" + l + ":" + col).join(loc);
    return s;
  }
  function framesDe(err, cs) {
    var m = marcas.get(err) || {};
    var r = (m.topo || []).slice();
    var usuario = 0, viuUsuario = !m.topo;
    for (var i = 0; i < cs.length; i++) {
      var c = cs[i];
      var arq = c.getFileName ? c.getFileName() : null;
      if (arq && arquivosInfo[arq]) {
        if (m.semUsuario) continue;
        r.push(frameV8(c)); usuario++; viuUsuario = true;
        continue;
      }
      if (arq && ehInterno(arq)) {
        var fn = c.getFunctionName && c.getFunctionName();
        if (fn && CONTEXTOS[fn] && !m.semUsuario && viuUsuario) r = r.concat(CONTEXTOS[fn]);
        if (fn === "jsNodeEmit" && !m.semUsuario) r.push((c.getTypeName() || "EventEmitter") + ".emit (node:events:508:28)");
        continue;
      }
      if (!arq) {
        var su = c.getScriptNameOrSourceURL && c.getScriptNameOrSourceURL();
        if (su && /^REPL\d+$/.test(su)) { var s0 = String(c).replace(/^eval at [^,]*, /, "").replace(/\(eval at [^)]*\), /, "("); r.push(c.getFunctionName() && c.getFunctionName() !== "eval" ? c.getFunctionName() + " (" + su + ":" + c.getLineNumber() + ":" + c.getColumnNumber() + ")" : su + ":" + c.getLineNumber() + ":" + c.getColumnNumber()); continue; }
        if (!m.semUsuario) r.push(frameV8(c)); continue;
      }
    }
    // módulo ES: o corpo do módulo (sem await no topo) roda dentro do carregador do Node
    if (!m.semUsuario && cs.length) {
      var ult = cs[cs.length - 1], au = ult.getFileName && ult.getFileName(), iu = au && arquivosInfo[au];
      if (iu && iu.esm && !ult.getFunctionName() && !(ult.isAsync && ult.isAsync()) && antesDoAwait(iu, ult.getLineNumber(), ult.getColumnNumber() - (ult.getLineNumber() === 1 ? iu.linha1 : 0))) r = r.concat(ESM_MAIN);
    }
    return r.slice(0, 10);
  }
  function cabecalhoErro(err) {
    var s;
    try {
      var nome = err.name, msg = err.message;
      nome = nome === undefined ? "Error" : String(nome);
      msg = msg === undefined ? "" : String(msg);
      s = !nome ? msg : !msg ? nome : nome + ": " + msg;
    } catch (e) { s = "Error"; }
    return s;
  }
  if (ehV8) {
    Error.prepareStackTrace = function (err, cs) {
      var fr = framesDe(err, cs);
      var mm = marcas.get(err);
      return (mm && mm.nomeStack ? mm.nomeStack + ": " + err.message : cabecalhoErro(err)) + fr.map(function (f) { return "\n    at " + f; }).join("");
    };
  }
  // Firefox/Safari: "f@blob:…:3:5" → "    at f (/home/ana/main.js:3:5)"
  function framesTexto(stack) {
    var r = [];
    String(stack || "").split("\n").forEach(function (l) {
      var m = /^(.*?)@(.*):(\d+):(\d+)$/.exec(l);
      if (!m) return;
      var info = arquivosInfo[m[2]];
      if (!info) { var ctx = CONTEXTOS[m[1].replace(/^.*\//, "")]; if (ctx && r.length) r = r.concat(ctx); return; }
      var lin = +m[3], col = +m[4] - (+m[3] === 1 ? info.linha1 : 0);
      var fn = m[1].replace(/\/<$/, "").replace(/^.*\//, "");
      var loc = info.mostrar + ":" + lin + ":" + col;
      r.push(fn ? fn + " (" + loc + ")" : info.cjs ? "Object.<anonymous> (" + loc + ")" : loc);
    });
    return r.slice(0, 10);
  }
  // posição (arquivo, linha, coluna) de onde o erro aconteceu: o 1º frame do usuário
  function posicaoErro(err) {
    if (ehV8) {
      var pos = null;
      var antigo = Error.prepareStackTrace;
      try {
        // pede de novo os CallSites (sem estragar o err.stack já formatado)
        var o = {};
        Error.prepareStackTrace = function (e, cs) { return cs; };
        var cs = posicoes.get(err);
        if (cs) for (var i = 0; i < cs.length; i++) {
          var arq = cs[i].getFileName && cs[i].getFileName();
          if (arq && arquivosInfo[arq]) { var info = arquivosInfo[arq], l = cs[i].getLineNumber(); pos = { info: info, linha: l, coluna: cs[i].getColumnNumber() - (l === 1 ? info.linha1 : 0) }; break; }
        }
      } finally { Error.prepareStackTrace = antigo; }
      return pos;
    }
    var m = /@(.*):(\d+):(\d+)$/m.exec(String(err && err.stack || ""));
    var re = /^(.*?)@(.*):(\d+):(\d+)$/gm, x;
    while ((x = re.exec(String(err && err.stack || "")))) {
      var inf = arquivosInfo[x[2]];
      if (inf) return { info: inf, linha: +x[3], coluna: +x[4] - (+x[3] === 1 ? inf.linha1 : 0) };
    }
    return null;
  }
  // guarda os CallSites de cada erro (para achar a linha do erro depois)
  var posicoes = new WeakMap();
  if (ehV8) {
    var prepOrig = Error.prepareStackTrace;
    Error.prepareStackTrace = function (err, cs) {
      try { if (err && typeof err === "object") posicoes.set(err, cs); } catch (e) {}
      return prepOrig(err, cs);
    };
  }

  function linhaDoFonte(info, linha) {
    var f = fontes[info.caminho];
    if (f === undefined) return "";
    return f.split("\n")[linha - 1] || "";
  }
  function setas(n) { var s = ""; for (var i = 0; i < n; i++) s += "^"; return s; }
  function espacos(n) { var s = ""; for (var i = 0; i < n; i++) s += " "; return s; }

  /* --------------------------------------------- erro não tratado (como o Node) */
  function inspecionarErro(e) {
    try { return U.inspect(e); } catch (x) { try { return String(e); } catch (y) { return "[erro]"; } }
  }
  var naoTratadoModulo = false;
  function mensagemNaoTratado(e, comoRejeicao) {
    var cab = "";
    var m = e && typeof e === "object" ? marcas.get(e) : null;
    var ehErro = e instanceof Error || (e && typeof e === "object" && typeof e.stack === "string" && "message" in e);
    if (ehErro) { try { void e.stack; } catch (x) {} }
    if (m && m.cab) cab = naoTratadoModulo && /^AssertionError/.test(m.nomeStack || "") ? "node:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\n\n" : m.cab;
    else if (ehErro) {
      var p = posicaoErro(e);
      if (p) {
        var lin = linhaDoFonte(p.info, p.linha), col = p.coluna;
        // throw x: o Node aponta o "throw" (o V8 guarda onde o erro foi lançado)
        if (!comoRejeicao && !naoTratadoModulo) {
          var antes = lin.slice(0, col - 1), t = antes.lastIndexOf("throw ");
          if (t >= 0 && /^\s*(new\s+)?[\w$.]*\s*\(?\s*$/.test(antes.slice(t + 6))) col = t + 1;
        }
        cab = p.info.mostrar + ":" + p.linha + "\n" + lin + "\n" + espacos(col - 1) + "^\n\n";
      }
    }
    if (!ehV8 && ehErro && !(m && m.topo)) {
      // sem os CallSites do V8: refaz a pilha a partir do texto
      try {
        var fr = framesTexto(e.stack);
        var corpo = cabecalhoErro(e) + fr.map(function (f) { return "\n    at " + f; }).join("");
        Object.defineProperty(e, "stack", { value: corpo, configurable: true, writable: true });
      } catch (x) {}
    }
    if (ehErro) {
      var emit = "";
      if (m && m.emitido) { try { emit = "\nEmitted 'error' event at:\n" + String(m.emitido.stack).split("\n").slice(1).join("\n"); } catch (x) {} }
      return cab + inspecionarErro(e) + emit + "\n\nNode.js " + NODE_VERSAO + "\n";
    }
    if (comoRejeicao) {
      var desc;
      try { desc = typeof e === "string" ? e : U.inspect(e); } catch (x) { desc = String(e); }
      return "node:internal/process/promises:392\n      new UnhandledPromiseRejection(reason);\n      ^\n\n" +
        "UnhandledPromiseRejection: This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason \"" + desc + "\".\n" +
        "    at throwUnhandledRejectionsMode (node:internal/process/promises:392:7)\n" +
        "    at processPromiseRejections (node:internal/process/promises:475:17)\n" +
        "    at process.processTicksAndRejections (node:internal/process/task_queues:106:37) {\n  code: 'ERR_UNHANDLED_REJECTION'\n}\n\nNode.js " + NODE_VERSAO + "\n";
    }
    // throw "texto": o Node mostra a linha do throw (aqui: o 1º throw de não-Error do programa)
    var cab2 = "";
    var achou = naoTratadoModulo ? null : acharThrow();
    if (naoTratadoModulo) cab2 = "\nnode:internal/modules/run_main:107\n    triggerUncaughtException(\n    ^\n";
    if (achou) cab2 = "\n" + achou.info.mostrar + ":" + achou.linha + "\n" + achou.texto + "\n" + espacos(achou.coluna - 1) + "^\n";
    var txt;
    try { txt = typeof e === "string" ? e : U.inspect(e); } catch (x) { txt = String(e); }
    return cab2 + txt + "\n(Use `node --trace-uncaught ...` to show where the exception was thrown)\n\nNode.js " + NODE_VERSAO + "\n";
  }
  function acharThrow() {
    var nomes = Object.keys(arquivosInfo);
    for (var k = 0; k < nomes.length; k++) {
      var info = arquivosInfo[nomes[k]], f = fontes[info.caminho];
      if (!f) continue;
      var linhas = f.split("\n");
      for (var i = 0; i < linhas.length; i++) {
        var m = /\bthrow\s+(?!new\b)/.exec(linhas[i]);
        if (m) return { info: info, linha: i + 1, coluna: m.index + 1, texto: linhas[i] };
      }
    }
    return null;
  }

  function naoTratado(e, comoRejeicao, doModulo) {
    naoTratadoModulo = !!doModulo;
    if (encerrado) return;
    if (e === SAIR) return;
    var lista = process.listeners(comoRejeicao ? "unhandledRejection" : "uncaughtException");
    if (comoRejeicao && !lista.length) lista = [];
    if (lista.length) {
      try { lista.forEach(function (f) { f.call(process, e, comoRejeicao ? undefined : "uncaughtException"); }); }
      catch (e2) { if (e2 !== SAIR) naoTratado(e2, false); }
      return;
    }
    if (!comoRejeicao) {
      var lista2 = process.listeners("uncaughtException");
      if (lista2.length) { lista2.forEach(function (f) { f.call(process, e, "unhandledRejection"); }); return; }
    }
    houveExcecao = true;
    var txt = mensagemNaoTratado(e, comoRejeicao);
    textoExcecao = txt;
    try { escrever("err", txt); } catch (x) {}
    sair(e && e.jsNodeCodigo || 1, true);
  }

  /* ------------------------------------------------------------ o fim */
  function sair(codigo, jaComErro) {
    if (encerrado) return;
    codigoSaida = codigo === undefined || codigo === null ? (process.exitCode | 0) : codigo | 0;
    try { process.exitCode = codigoSaida; } catch (e) {}
    if (!jaComErro) {
      try { process.emit("exit", codigoSaida); } catch (e) { if (e !== SAIR) { /* erro no exit */ } }
      codigoSaida = process.exitCode === undefined ? codigoSaida : process.exitCode | 0;
    }
    enviarSaida();
    encerrado = true;
    var arquivos = {};
    try {
      Object.keys(vfs.arq).forEach(function (p) {
        if (p.indexOf(HOME + "/") !== 0) return;
        var nome = p.slice(HOME.length + 1);
        var d = vfs.arq[p];
        arquivos[nome] = d.length > 200000 ? null : texto(d);
      });
    } catch (e) {}
    postar({ ev: "fim", res: { exit: codigoSaida, excecao: houveExcecao, traceback: textoExcecao, arquivos: arquivos, modo: modoExec } });
    try { G.close(); } catch (e) {}
  }
  var verificando = false;
  function talvezFim() {
    if (encerrado || verificando) return;
    verificando = true;
    nSetTimeout(function () {
      nSetTimeout(function () {
        verificando = false;
        if (encerrado) return;
        if (ativos > 0 || filaTick.length) return;
        if (process.listenerCount("beforeExit")) {
          var antes = ativos;
          try { process.emit("beforeExit", process.exitCode | 0); } catch (e) { if (e !== SAIR) naoTratado(e, false); return; }
          if (ativos > antes || filaTick.length) return;
          nSetTimeout(function () { if (ativos === 0 && !encerrado) fimNormal(); }, 0);
          return;
        }
        fimNormal();
      }, 0);
    }, 0);
  }
  function fimNormal() {
    if (principalPendente) {
      var p = acharAwaitPendente();
      escrever("err", "Warning: Detected unsettled top-level await at " + (p ? p.info.mostrar + ":" + p.linha + "\n" + p.texto + "\n" + espacos(p.coluna - 1) + "^\n\n\n\n" : "\n"));
      sair(13);
      return;
    }
    sair(undefined);
  }
  function acharAwaitPendente() {
    var info = principalInfo;
    if (!info) return null;
    var linhas = (fontes[info.caminho] || "").split("\n");
    var ultimo = null;
    for (var i = 0; i < linhas.length; i++) {
      var m = /\bawait\b/.exec(linhas[i]);
      if (m && ultimo === null) ultimo = { info: info, linha: i + 1, coluna: m.index + 1, texto: linhas[i] };
    }
    // o await que ficou esperando: o 1º depois da última linha que escreveu algo não dá para saber; usa uma pista
    if (awaitVisto) return awaitVisto;
    return ultimo;
  }
  var awaitVisto = null;
  function segurar() { ativos++; }
  function soltar() { ativos--; if (ativos <= 0) { ativos = 0; talvezFim(); } }

  /* ------------------------------------------------------------ EventEmitter */
  var kEventos = typeof Symbol === "function" ? Symbol("eventos") : "__eventos";
  function EventEmitter(opts) { EventEmitter.init.call(this, opts); }
  EventEmitter.init = function () {
    if (!this._events || this._events === Object.getPrototypeOf(this)._events) { this._events = Object.create(null); this._eventsCount = 0; }
    this._maxListeners = this._maxListeners || undefined;
  };
  EventEmitter.prototype._events = undefined;
  EventEmitter.prototype._eventsCount = 0;
  EventEmitter.prototype._maxListeners = undefined;
  EventEmitter.defaultMaxListeners = 10;
  EventEmitter.EventEmitter = EventEmitter;
  EventEmitter.errorMonitor = Symbol("events.errorMonitor");
  EventEmitter.captureRejections = false;
  function adicionar(alvo, tipo, f, antes) {
    if (typeof f !== "function") throw tipoErrado("listener", "Function", f);
    if (!alvo._events) { alvo._events = Object.create(null); alvo._eventsCount = 0; }
    if (alvo._events.newListener !== undefined) alvo.emit("newListener", tipo, f.listener ? f.listener : f);
    var ex = alvo._events[tipo];
    if (ex === undefined) { alvo._events[tipo] = f; alvo._eventsCount++; }
    else if (typeof ex === "function") alvo._events[tipo] = antes ? [f, ex] : [ex, f];
    else if (antes) ex.unshift(f); else ex.push(f);
    if (alvo._aoAdicionar) alvo._aoAdicionar(tipo);
    return alvo;
  }
  EventEmitter.prototype.setMaxListeners = function (n) { this._maxListeners = n; return this; };
  EventEmitter.prototype.getMaxListeners = function () { return this._maxListeners === undefined ? EventEmitter.defaultMaxListeners : this._maxListeners; };
  EventEmitter.prototype.emit = function emit(tipo) {
    var args = Array.prototype.slice.call(arguments, 1);
    return jsNodeEmit.call(this, tipo, args);
  };
  function jsNodeEmit(tipo, args) {
    var evs = this._events;
    if (tipo === "error" && (!evs || evs.error === undefined)) {
      var er = args[0];
      if (er instanceof Error) {
        var onde = {};
        if (ehV8) Error.captureStackTrace(onde, EventEmitter.prototype.emit);
        marcas.set(er, Object.assign({}, marcas.get(er) || {}, { cab: "node:events:505\n    throw er; // Unhandled 'error' event\n    ^\n\n", emitido: onde }));
        throw er;
      }
      var e2 = new Error("Unhandled error. (" + U.inspect(er) + ")");
      e2.code = "ERR_UNHANDLED_ERROR"; e2.context = er;
      throw e2;
    }
    if (!evs) return false;
    var h = evs[tipo];
    if (h === undefined) return false;
    if (typeof h === "function") h.apply(this, args);
    else { var l = h.slice(); for (var i = 0; i < l.length; i++) l[i].apply(this, args); }
    return true;
  }
  EventEmitter.prototype.on = EventEmitter.prototype.addListener = function (t, f) { return adicionar(this, t, f, false); };
  EventEmitter.prototype.prependListener = function (t, f) { return adicionar(this, t, f, true); };
  function umaVez(alvo, tipo, f) {
    var feito = false;
    function w() { if (feito) return; feito = true; alvo.removeListener(tipo, w); return f.apply(alvo, arguments); }
    w.listener = f;
    return w;
  }
  EventEmitter.prototype.once = function (t, f) { if (typeof f !== "function") throw tipoErrado("listener", "Function", f); return this.on(t, umaVez(this, t, f)); };
  EventEmitter.prototype.prependOnceListener = function (t, f) { return this.prependListener(t, umaVez(this, t, f)); };
  EventEmitter.prototype.off = EventEmitter.prototype.removeListener = function (tipo, f) {
    var evs = this._events; if (!evs) return this;
    var l = evs[tipo]; if (l === undefined) return this;
    if (l === f || l.listener === f) { if (--this._eventsCount === 0) this._events = Object.create(null); else delete evs[tipo]; if (evs.removeListener) this.emit("removeListener", tipo, l.listener || f); }
    else if (typeof l !== "function") {
      for (var i = l.length - 1; i >= 0; i--) if (l[i] === f || l[i].listener === f) { l.splice(i, 1); if (l.length === 1) evs[tipo] = l[0]; if (evs.removeListener) this.emit("removeListener", tipo, f); break; }
    }
    if (this._aoRemover) this._aoRemover(tipo);
    return this;
  };
  EventEmitter.prototype.removeAllListeners = function (tipo) {
    if (!this._events) return this;
    if (tipo === undefined) { this._events = Object.create(null); this._eventsCount = 0; }
    else if (this._events[tipo] !== undefined) { if (--this._eventsCount === 0) this._events = Object.create(null); else delete this._events[tipo]; }
    if (this._aoRemover) this._aoRemover(tipo);
    return this;
  };
  EventEmitter.prototype.listeners = function (t) { var l = this._events && this._events[t]; return l === undefined ? [] : typeof l === "function" ? [l.listener || l] : l.map(function (x) { return x.listener || x; }); };
  EventEmitter.prototype.rawListeners = function (t) { var l = this._events && this._events[t]; return l === undefined ? [] : typeof l === "function" ? [l] : l.slice(); };
  EventEmitter.prototype.listenerCount = function (t) { var l = this._events && this._events[t]; return l === undefined ? 0 : typeof l === "function" ? 1 : l.length; };
  EventEmitter.listenerCount = function (em, t) { return em.listenerCount(t); };
  EventEmitter.prototype.eventNames = function () { return this._events ? Reflect.ownKeys(this._events) : []; };
  EventEmitter.once = function (em, nome) {
    return new NativePromise(function (ok, falha) {
      function f() { if (nome !== "error") em.removeListener("error", e); ok(Array.prototype.slice.call(arguments)); }
      function e(err) { em.removeListener(nome, f); falha(err); }
      em.once(nome, f);
      if (nome !== "error") em.once("error", e);
    });
  };
  EventEmitter.on = function (em, nome) {
    var fila = [], esperando = [], fim = false;
    em.on(nome, function () { var v = Array.prototype.slice.call(arguments); if (esperando.length) esperando.shift()({ value: v, done: false }); else fila.push(v); });
    var it = {
      next: function () { if (fila.length) return NativePromise.resolve({ value: fila.shift(), done: false }); if (fim) return NativePromise.resolve({ value: undefined, done: true }); return new NativePromise(function (ok) { esperando.push(ok); }); },
      "return": function () { fim = true; return NativePromise.resolve({ value: undefined, done: true }); },
    };
    it[Symbol.asyncIterator] = function () { return this; };
    return it;
  };
  Object.defineProperty(EventEmitter, "name", { value: "EventEmitter" });

  function tipoErrado(nome, tipo, v) {
    var desc = v === null ? "null" : v === undefined ? "undefined" : typeof v === "function" ? "function " + (v.name || "anonymous") : typeof v === "object" ? (v.constructor && v.constructor.name ? "an instance of " + v.constructor.name : U.inspect(v, { depth: -1 })) : "type " + typeof v + " (" + U.inspect(v) + ")";
    var e = new TypeError("The \"" + nome + "\" argument must be of type " + tipo.toLowerCase() + ". Received " + desc);
    e.code = "ERR_INVALID_ARG_TYPE";
    return e;
  }

  /* ------------------------------------------------------------ texto ↔ bytes */
  var enc = new TextEncoder(), dec = new TextDecoder();
  function bytes(x) { return typeof x === "string" ? enc.encode(x) : x instanceof Uint8Array ? x : ArrayBuffer.isView(x) ? new Uint8Array(x.buffer, x.byteOffset, x.byteLength) : enc.encode(String(x)); }
  function texto(b) { return typeof b === "string" ? b : dec.decode(b); }

  /* ------------------------------------------------------------ Buffer (o básico) */
  function Buffer(a, b, c) {
    // new Buffer(n) é antigo (o Node avisa); aqui também serve para o subarray/slice (Symbol.species)
    if (typeof a === "number") return criarBuffer(new Uint8Array(a));
    if (a instanceof ArrayBuffer) return criarBuffer(new Uint8Array(a, b, c));
    return Buffer.from(a, b);
  }
  var BufferProto = Object.create(Uint8Array.prototype);
  function criarBuffer(u8) { Object.setPrototypeOf(u8, BufferProto); return u8; }
  Buffer.prototype = BufferProto;
  BufferProto.constructor = Buffer;
  Object.defineProperty(Buffer, "name", { value: "Buffer" });
  Object.setPrototypeOf(Buffer, Uint8Array);
  Buffer.from = function (v, cod) {
    if (typeof v === "string") {
      cod = String(cod || "utf8").toLowerCase();
      if (cod === "hex") { var a = []; for (var i = 0; i + 1 < v.length; i += 2) { var n = parseInt(v.substr(i, 2), 16); if (isNaN(n)) break; a.push(n); } return criarBuffer(new Uint8Array(a)); }
      if (cod === "base64" || cod === "base64url") { var s = atob(v.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "")); var u = new Uint8Array(s.length); for (var j = 0; j < s.length; j++) u[j] = s.charCodeAt(j); return criarBuffer(u); }
      if (cod === "latin1" || cod === "binary" || cod === "ascii") { var u2 = new Uint8Array(v.length); for (var k = 0; k < v.length; k++) u2[k] = v.charCodeAt(k) & 255; return criarBuffer(u2); }
      return criarBuffer(enc.encode(v));
    }
    if (v instanceof ArrayBuffer) return criarBuffer(new Uint8Array(v));
    if (ArrayBuffer.isView(v) || Array.isArray(v)) return criarBuffer(Uint8Array.from(v));
    if (v && v.type === "Buffer" && Array.isArray(v.data)) return criarBuffer(Uint8Array.from(v.data));
    throw tipoErrado("first", "string, Buffer, ArrayBuffer, Array, or Array-like Object", v);
  };
  Buffer.alloc = function (n, fill) { var u = new Uint8Array(n); if (fill !== undefined) u.fill(typeof fill === "string" ? fill.charCodeAt(0) : fill); return criarBuffer(u); };
  Buffer.allocUnsafe = function (n) { return criarBuffer(new Uint8Array(n)); };
  Buffer.isBuffer = function (b) { return b instanceof Uint8Array && Object.getPrototypeOf(b) === BufferProto; };
  Buffer.byteLength = function (s) { return typeof s === "string" ? enc.encode(s).length : s.byteLength; };
  Buffer.concat = function (lista, tot) { if (tot === undefined) tot = lista.reduce(function (a, b) { return a + b.length; }, 0); var u = new Uint8Array(tot), o = 0; lista.forEach(function (b) { u.set(b.subarray(0, Math.max(0, tot - o)), o); o += b.length; }); return criarBuffer(u); };
  Buffer.isEncoding = function (e) { return /^(utf-?8|hex|base64(url)?|latin1|binary|ascii|ucs-?2|utf-?16le)$/i.test(e); };
  BufferProto.toString = function (cod, ini, fim) {
    var u = this.subarray(ini || 0, fim === undefined ? this.length : fim);
    cod = String(cod || "utf8").toLowerCase();
    if (cod === "hex") return Array.prototype.map.call(u, function (b) { return (b < 16 ? "0" : "") + b.toString(16); }).join("");
    if (cod === "base64" || cod === "base64url") { var s = ""; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); var b = btoa(s); return cod === "base64url" ? b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") : b; }
    if (cod === "latin1" || cod === "binary" || cod === "ascii") { var t = ""; for (var j = 0; j < u.length; j++) t += String.fromCharCode(cod === "ascii" ? u[j] & 127 : u[j]); return t; }
    return dec.decode(u);
  };
  BufferProto.toJSON = function () { return { type: "Buffer", data: Array.prototype.slice.call(this) }; };
  BufferProto.equals = function (o) { if (this.length !== o.length) return false; for (var i = 0; i < this.length; i++) if (this[i] !== o[i]) return false; return true; };
  BufferProto.write = function (s, off) { var b = enc.encode(s); this.set(b.subarray(0, this.length - (off || 0)), off || 0); return Math.min(b.length, this.length - (off || 0)); };
  BufferProto.slice = BufferProto.subarray = function (a, b) { return criarBuffer(Uint8Array.prototype.subarray.call(this, a, b)); };
  BufferProto[Symbol.for("nodejs.util.inspect.custom")] = function (prof, opc) {
    var max = 50, s = "";
    for (var i = 0; i < Math.min(max, this.length); i++) s += " " + (this[i] < 16 ? "0" : "") + this[i].toString(16);
    if (this.length > max) s += " ... " + (this.length - max) + " more byte" + (this.length - max > 1 ? "s" : "");
    return "<Buffer" + s + ">";
  };

  /* ------------------------------------------------------------ path (posix) */
  function normalizarSegs(partes, abs) {
    var r = [];
    partes.forEach(function (p) {
      if (!p || p === ".") return;
      if (p === "..") { if (r.length && r[r.length - 1] !== "..") r.pop(); else if (!abs) r.push(".."); return; }
      r.push(p);
    });
    return r;
  }
  function checarTexto(nome, v) { if (typeof v !== "string") throw tipoErrado(nome, "string", v); }
  var path = {
    sep: "/", delimiter: ":",
    normalize: function (p) {
      checarTexto("path", p);
      if (p === "") return ".";
      var abs = p[0] === "/", fimBarra = p[p.length - 1] === "/";
      var s = normalizarSegs(p.split("/"), abs).join("/");
      if (!s && !abs) s = ".";
      if (s && fimBarra) s += "/";
      return (abs ? "/" : "") + s;
    },
    join: function () {
      var a = Array.prototype.slice.call(arguments);
      a.forEach(function (x) { checarTexto("path", x); });
      var j = a.filter(function (x) { return x !== ""; }).join("/");
      return j === "" ? "." : path.normalize(j);
    },
    resolve: function () {
      var r = "", abs = false;
      for (var i = arguments.length - 1; i >= -1 && !abs; i--) {
        var p = i >= 0 ? arguments[i] : process.cwd();
        checarTexto("paths[" + i + "]", p);
        if (!p) continue;
        r = p + "/" + r; abs = p[0] === "/";
      }
      var s = normalizarSegs(r.split("/"), true).join("/");
      return "/" + s;
    },
    isAbsolute: function (p) { checarTexto("path", p); return p[0] === "/"; },
    dirname: function (p) {
      checarTexto("path", p);
      if (!p) return ".";
      var s = p.replace(/\/+$/, "");
      if (!s) return "/";
      var i = s.lastIndexOf("/");
      if (i < 0) return ".";
      if (i === 0) return "/";
      return s.slice(0, i).replace(/\/+$/, "") || "/";
    },
    basename: function (p, ext) {
      checarTexto("path", p);
      var s = p.replace(/\/+$/, ""); var b = s.slice(s.lastIndexOf("/") + 1);
      if (ext && b.slice(-ext.length) === ext && b !== ext) b = b.slice(0, -ext.length);
      return b;
    },
    extname: function (p) {
      checarTexto("path", p);
      var b = path.basename(p); var i = b.lastIndexOf(".");
      if (i <= 0) return ""; return b.slice(i);
    },
    relative: function (de, para) {
      var a = path.resolve(de).split("/").filter(Boolean), b = path.resolve(para).split("/").filter(Boolean);
      var i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(i).map(function () { return ".."; }).concat(b.slice(i)).join("/");
    },
    parse: function (p) {
      checarTexto("path", p);
      var root = p[0] === "/" ? "/" : "", base = path.basename(p), ext = path.extname(p);
      var dir = p.indexOf("/") >= 0 ? path.dirname(p) : "";
      return { root: root, dir: dir, base: base, ext: ext, name: ext ? base.slice(0, -ext.length) : base };
    },
    format: function (o) { var dir = o.dir || o.root || ""; var base = o.base || (o.name || "") + (o.ext ? (o.ext[0] === "." ? "" : ".") + o.ext : ""); return dir ? (dir === o.root ? dir + base : dir + "/" + base) : base; },
    toNamespacedPath: function (p) { return p; },
    matchesGlob: function () { return false; },
  };
  path.posix = path; path.win32 = path;

  /* ------------------------------------------------------------ a pasta em memória */
  var vfs = { arq: Object.create(null), dir: Object.create(null), mtime: Object.create(null) };
  ["/", "/home", HOME, "/tmp", "/usr", "/usr/local", "/usr/local/bin", "/etc", "/dev"].forEach(function (d) { vfs.dir[d] = true; });
  vfs.arq["/etc/hostname"] = enc.encode("notebook\n");
  function abs(p) {
    if (p instanceof URL) p = decodeURIComponent(p.pathname);
    if (ArrayBuffer.isView(p)) p = texto(p);
    if (typeof p !== "string") throw tipoErrado("path", "string or an instance of Buffer or URL", p);
    if (/^file:\/\//.test(p)) p = decodeURIComponent(p.slice(7));
    return path.resolve(p);
  }
  function erroFs(codigo, syscall, p, destino) {
    var MSG = { ENOENT: [-2, "no such file or directory"], EEXIST: [-17, "file already exists"], EISDIR: [-21, "illegal operation on a directory"], ENOTDIR: [-20, "not a directory"], ENOTEMPTY: [-39, "directory not empty"], EACCES: [-13, "permission denied"], EBADF: [-9, "bad file descriptor"] };
    var m = MSG[codigo];
    var e = new Error(codigo + ": " + m[1] + ", " + syscall + (p === undefined ? "" : " '" + p + "'") + (destino !== undefined ? " -> '" + destino + "'" : ""));
    e.errno = m[0]; e.code = codigo; e.syscall = syscall; if (p !== undefined) e.path = p;
    if (destino !== undefined) e.dest = destino;
    return e;
  }
  function marcar(e, topo, cab, semUsuario) { marcas.set(e, { topo: topo, cab: cab, semUsuario: !!semUsuario }); return e; }
  function paiExiste(a) { return !!vfs.dir[path.dirname(a)]; }
  function opcCod(o) { return typeof o === "string" ? o : o && o.encoding ? o.encoding : null; }
  function saidaCod(dados, cod) { var b = criarBuffer(new Uint8Array(dados)); return cod && cod !== "buffer" ? b.toString(cod) : b; }
  var fsSync = {
    existsSync: function (p) { try { var a = abs(p); return !!(vfs.arq[a] || vfs.dir[a]); } catch (e) { return false; } },
    readFileSync: function (p, o) {
      var cod = opcCod(o);
      if (p === 0 || p === "/dev/stdin") return saidaCod(stdinTudo(), cod);
      var a = abs(p);
      if (vfs.dir[a]) throw marcar(erroFs("EISDIR", "read"), ["Object.readFileSync (node:fs:483:20)"], "node:fs:483\n    return binding.readFileUtf8(path, stringToFlags(options.flag));\n                   ^\n\n");
      if (!vfs.arq[a]) {
        var e = erroFs("ENOENT", "open", String(p));
        if (cod && /^utf-?8$/i.test(cod)) throw marcar(e, ["Object.readFileSync (node:fs:483:20)"], "node:fs:483\n    return binding.readFileUtf8(path, stringToFlags(options.flag));\n                   ^\n\n");
        throw marcar(e, ["Object.openSync (node:fs:621:18)", "Object.readFileSync (node:fs:487:35)"], "node:fs:621\n  return binding.open(\n                 ^\n\n");
      }
      return saidaCod(vfs.arq[a], cod);
    },
    writeFileSync: function (p, d, o) {
      if (p === 1 || p === 2) { escrever(p === 1 ? "out" : "err", texto(bytes(d))); return; }
      var a = abs(p);
      if (vfs.dir[a]) throw marcar(erroFs("EISDIR", "open", String(p)), ["Object.openSync (node:fs:621:18)", "Object.writeFileSync (node:fs:2392:35)"], "node:fs:621\n  return binding.open(\n                 ^\n\n");
      if (!paiExiste(a) && typeof d === "string") throw marcar(erroFs("ENOENT", "open", String(p)), ["Object.writeFileSync (node:fs:2482:20)"], "node:fs:2482\n    return binding.writeFileUtf8(\n                   ^\n\n");
      if (!paiExiste(a)) throw marcar(erroFs("ENOENT", "open", String(p)), ["Object.openSync (node:fs:621:18)", "Object.writeFileSync (node:fs:2492:35)"], "node:fs:621\n  return binding.open(\n                 ^\n\n");
      var flag = o && o.flag;
      if (flag === "a") return fsSync.appendFileSync(p, d);
      if (flag === "wx" && vfs.arq[a]) throw erroFs("EEXIST", "open", String(p));
      vfs.arq[a] = new Uint8Array(bytes(typeof d === "string" || ArrayBuffer.isView(d) ? d : String(d))); vfs.mtime[a] = Date.now();
    },
    appendFileSync: function (p, d) {
      var a = abs(p);
      if (!paiExiste(a)) throw erroFs("ENOENT", "open", String(p));
      var velho = vfs.arq[a] || new Uint8Array(0), novo = bytes(d), u = new Uint8Array(velho.length + novo.length);
      u.set(velho); u.set(novo, velho.length); vfs.arq[a] = u; vfs.mtime[a] = Date.now();
    },
    mkdirSync: function (p, o) {
      var a = abs(p), rec = o && (o === true || o.recursive);
      if (vfs.dir[a] || vfs.arq[a]) { if (rec && vfs.dir[a]) return undefined; throw marcar(erroFs("EEXIST", "mkdir", String(p)), ["Object.mkdirSync (node:fs:1410:26)"], "node:fs:1410\n  const result = binding.mkdir(\n                         ^\n\n"); }
      if (!vfs.dir[path.dirname(a)]) {
        if (!rec) throw marcar(erroFs("ENOENT", "mkdir", String(p)), ["Object.mkdirSync (node:fs:1410:26)"], "node:fs:1410\n  const result = binding.mkdir(\n                         ^\n\n");
        var primeiro = null, cam = "";
        a.split("/").filter(Boolean).forEach(function (s) { cam += "/" + s; if (!vfs.dir[cam]) { vfs.dir[cam] = true; if (!primeiro) primeiro = cam; } });
        return primeiro;
      }
      vfs.dir[a] = true;
      return rec ? a : undefined;
    },
    readdirSync: function (p, o) {
      var a = abs(p);
      if (!vfs.dir[a]) {
        if (vfs.arq[a]) throw marcar(erroFs("ENOTDIR", "scandir", String(p)), ["Object.readdirSync (node:fs:1630:26)"], "node:fs:1630\n  const result = binding.readdir(\n                         ^\n\n");
        throw marcar(erroFs("ENOENT", "scandir", String(p)), ["Object.readdirSync (node:fs:1630:26)"], "node:fs:1630\n  const result = binding.readdir(\n                         ^\n\n");
      }
      var pre = a === "/" ? "/" : a + "/", nomes = {};
      Object.keys(vfs.arq).concat(Object.keys(vfs.dir)).forEach(function (x) { if (x.indexOf(pre) === 0 && x !== a) { var resto = x.slice(pre.length); if (resto && resto.indexOf("/") < 0) nomes[resto] = !!vfs.dir[x]; } });
      var lista = Object.keys(nomes).sort();
      if (o && o.withFileTypes) return lista.map(function (n) { return new Dirent(n, nomes[n] ? 2 : 1, a); });
      return lista;
    },
    statSync: function (p, o) {
      var a = abs(p);
      if (!vfs.arq[a] && !vfs.dir[a]) { if (o && o.throwIfNoEntry === false) return undefined; throw marcar(erroFs("ENOENT", "stat", String(p)), ["Object.statSync (node:fs:1794:25)"], "node:fs:1794\n  const stats = binding.stat(\n                        ^\n\n"); }
      return new Stats(a);
    },
    unlinkSync: function (p) {
      var a = abs(p);
      if (vfs.dir[a]) throw erroFs("EISDIR", "unlink", String(p));
      if (!vfs.arq[a]) throw marcar(erroFs("ENOENT", "unlink", String(p)), ["Object.unlinkSync (node:fs:2000:11)"], "node:fs:2000\n  binding.unlink(getValidatedPath(path));\n          ^\n\n");
      delete vfs.arq[a];
    },
    rmSync: function (p, o) {
      var a = abs(p);
      if (vfs.arq[a]) { delete vfs.arq[a]; return; }
      if (vfs.dir[a]) {
        if (!(o && o.recursive)) { var e = new Error("Path is a directory: rm returned EISDIR (is a directory) " + p); e.code = "ERR_FS_EISDIR"; throw e; }
        Object.keys(vfs.arq).forEach(function (x) { if (x.indexOf(a + "/") === 0) delete vfs.arq[x]; });
        Object.keys(vfs.dir).forEach(function (x) { if (x === a || x.indexOf(a + "/") === 0) delete vfs.dir[x]; });
        return;
      }
      if (!(o && o.force)) throw erroFs("ENOENT", "rm", String(p));
    },
    rmdirSync: function (p) {
      var a = abs(p);
      if (!vfs.dir[a]) throw erroFs(vfs.arq[a] ? "ENOTDIR" : "ENOENT", "rmdir", String(p));
      if (fsSync.readdirSync(a).length) throw erroFs("ENOTEMPTY", "rmdir", String(p));
      delete vfs.dir[a];
    },
    renameSync: function (de, para) {
      var a = abs(de), b = abs(para);
      if (!vfs.arq[a] && !vfs.dir[a]) throw erroFs("ENOENT", "rename", String(de), String(para));
      if (vfs.arq[a]) { vfs.arq[b] = vfs.arq[a]; delete vfs.arq[a]; return; }
      Object.keys(vfs.arq).forEach(function (x) { if (x.indexOf(a + "/") === 0) { vfs.arq[b + x.slice(a.length)] = vfs.arq[x]; delete vfs.arq[x]; } });
      Object.keys(vfs.dir).forEach(function (x) { if (x === a || x.indexOf(a + "/") === 0) { vfs.dir[b + x.slice(a.length)] = true; delete vfs.dir[x]; } });
    },
    copyFileSync: function (de, para) {
      var a = abs(de), b = abs(para);
      if (!vfs.arq[a]) throw erroFs("ENOENT", "copyfile", String(de), String(para));
      vfs.arq[b] = new Uint8Array(vfs.arq[a]);
    },
    accessSync: function (p) { var a = abs(p); if (!vfs.arq[a] && !vfs.dir[a]) throw erroFs("ENOENT", "access", String(p)); },
    realpathSync: function (p) { var a = abs(p); if (!vfs.arq[a] && !vfs.dir[a]) throw erroFs("ENOENT", "lstat", String(p)); return a; },
    openSync: function (p, flag) {
      var a = abs(p); flag = flag || "r";
      if (flag[0] === "r" && !vfs.arq[a]) throw erroFs("ENOENT", "open", String(p));
      if (flag[0] === "w") vfs.arq[a] = new Uint8Array(0);
      if (flag[0] === "a" && !vfs.arq[a]) vfs.arq[a] = new Uint8Array(0);
      var fd = proxFd++; fds[fd] = { a: a, pos: 0 }; return fd;
    },
    closeSync: function (fd) { if (!fds[fd]) throw erroFs("EBADF", "close", undefined); delete fds[fd]; },
    writeSync: function (fd, d) {
      if (fd === 1 || fd === 2) { var s = typeof d === "string" ? d : texto(bytes(d)); escrever(fd === 1 ? "out" : "err", s); return s.length; }
      var f = fds[fd]; if (!f) throw erroFs("EBADF", "write", undefined);
      fsSync.appendFileSync(f.a, d); return bytes(d).length;
    },
  };
  fsSync.lstatSync = fsSync.statSync;
  var fds = {}, proxFd = 3;
  function Dirent(nome, tipo, pasta) { this.name = nome; this.parentPath = pasta; this.path = pasta; this[kTipo] = tipo; }
  var kTipo = Symbol("type");
  Dirent.prototype.isFile = function () { return this[kTipo] === 1; };
  Dirent.prototype.isDirectory = function () { return this[kTipo] === 2; };
  Dirent.prototype.isSymbolicLink = function () { return false; };
  function Stats(a) {
    var ehDir = !!vfs.dir[a], t = vfs.mtime[a] || inicio;
    this.dev = 2049; this.mode = ehDir ? 16877 : 33188; this.nlink = 1; this.uid = 1000; this.gid = 1000; this.rdev = 0;
    this.blksize = 4096; this.ino = 1000 + Object.keys(vfs.arq).indexOf(a); this.size = ehDir ? 4096 : vfs.arq[a].length;
    this.blocks = Math.ceil(this.size / 512); this.atimeMs = t; this.mtimeMs = t; this.ctimeMs = t; this.birthtimeMs = t;
    this.atime = new Date(t); this.mtime = new Date(t); this.ctime = new Date(t); this.birthtime = new Date(t);
  }
  Stats.prototype.isFile = function () { return this.mode === 33188; };
  Stats.prototype.isDirectory = function () { return this.mode === 16877; };
  Stats.prototype.isSymbolicLink = function () { return false; };
  var inicio = Date.now();

  // versões com callback e com promessa
  var fsMod = {}, fsPromises = {};
  Object.keys(fsSync).forEach(function (k) { fsMod[k] = fsSync[k]; });
  ["readFile", "writeFile", "appendFile", "mkdir", "readdir", "stat", "lstat", "unlink", "rm", "rmdir", "rename", "copyFile", "access", "realpath"].forEach(function (k) {
    var sinc = fsSync[k + "Sync"];
    fsMod[k] = function () {
      var a = Array.prototype.slice.call(arguments), cb = a.pop();
      if (typeof cb !== "function") throw tipoErrado("cb", "function", cb);
      segurar();
      var r, err = null;
      try { r = sinc.apply(null, a); } catch (e) { err = e; marcas.set(e, { semUsuario: true }); }
      nSetTimeout(function () {
        if (encerrado) return;
        try {
          if (k === "readFile") { if (err) jsNodeFsAbriu(cb, err); else jsNodeFsLido(cb, r); }
          else if (k === "stat" || k === "lstat") jsNodeFsStat(cb, err, r);
          else jsNodeFsOk(cb, err, r);
        } catch (e) { if (e !== SAIR) naoTratado(e, false); }
        soltar();
      }, 0);
    };
    fsPromises[k] = function () {
      var a = arguments;
      return new NativePromise(function (ok, falha) {
        segurar();
        nSetTimeout(function () {
          soltar();
          try { ok(sinc.apply(null, a)); }
          catch (e) {
            var linhaP = { readFile: 2003, writeFile: 1972, appendFile: 1990 }[k];
            if (linhaP && e.syscall === "open") marcar(e, ["async open (node:internal/fs/promises:1345:25)", "async Object." + k + " (node:internal/fs/promises:" + linhaP + ":14)"], "node:internal/fs/promises:1345\n  return new FileHandle(await PromisePrototypeThen(\n                        ^\n\n", true);
            else marcas.set(e, { semUsuario: true });
            falha(e);
          }
        }, 0);
      });
    };
  });
  // os callbacks do fs são chamados como no Node (os nomes aparecem na pilha do erro)
  function ReadFileContext(cb) { this.callback = cb; }
  function jsNodeFsAbriu(cb, err) { new ReadFileContext(cb).callback(err); }
  function jsNodeFsLido(cb, r) { cb(null, r); }
  function jsNodeFsStat(cb, err, r) { if (err) cb(err); else cb(null, r); }
  function jsNodeFsOk(cb, err, r) { if (err) cb(err); else if (r === undefined) cb(null); else cb(null, r); }
  fsMod.exists = function (p, cb) { var r = fsSync.existsSync(p); segurar(); nSetTimeout(function () { cb(r); soltar(); }, 0); };
  fsMod.promises = fsPromises;
  fsMod.constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 };
  fsPromises.constants = fsMod.constants;
  fsMod.Dirent = Dirent; fsMod.Stats = Stats;
  fsMod.createWriteStream = function (p, o) {
    var w = new EventEmitter(); var a = abs(p);
    if (!(o && o.flags === "a")) vfs.arq[a] = new Uint8Array(0);
    w.write = function (d, cb) { fsSync.appendFileSync(a, d); if (typeof cb === "function") nSetTimeout(cb, 0); return true; };
    w.end = function (d, cb) { if (d && typeof d !== "function") w.write(d); var f = typeof d === "function" ? d : cb; segurar(); nSetTimeout(function () { w.emit("finish"); w.emit("close"); if (f) f(); soltar(); }, 0); return w; };
    w.path = p;
    return w;
  };
  fsMod.createReadStream = function (p, o) {
    var r = new EventEmitter(), cod = opcCod(o);
    segurar();
    nSetTimeout(function () {
      try { var d = fsSync.readFileSync(p); r.emit("data", cod ? d.toString(cod) : d); r.emit("end"); r.emit("close"); }
      catch (e) { r.emit("error", e); }
      soltar();
    }, 0);
    r.setEncoding = function (c) { cod = c; return r; };
    r.pipe = function (dst) { r.on("data", function (d) { dst.write(d); }); return dst; };
    return r;
  };

  /* ------------------------------------------------------------ stdin */
  var stdinBuf = "", stdinFim = false, interativo = false, pediu = false;
  var stdinConsumidores = 0;
  function stdinTudo() {
    if (!interativo) { var s = stdinBuf; stdinBuf = ""; stdinFim = true; return enc.encode(s); }
    // o leitor ainda vai digitar: o editor pede tudo e roda de novo (modo "por repetição")
    if (req.entradaTotal !== undefined && req.entradaTotal !== null) return enc.encode(req.entradaTotal);
    enviarSaida();
    postar({ ev: "lerTudo" });
    encerrado = true;
    throw SAIR;
  }
  function pedirEntrada() {
    if (!interativo || stdinFim || pediu || encerrado) return;
    pediu = true;
    nSetTimeout(function () {
      if (encerrado || stdinFim || !(stdinConsumidores > 0)) { pediu = false; return; }
      enviarSaida();
      postar({ ev: "espera" });
    }, 0);
  }
  function receberEntrada(t) {
    pediu = false;
    if (stdinFim) return;
    entregarStdin(t);
  }
  var perguntasPendentes = [];
  class AbortError extends Error { constructor(m) { super(m); this.code = "ABORT_ERR"; this.name = "AbortError"; } }
  function receberEof() {
    pediu = false; if (stdinFim) return; stdinFim = true;
    if (interativo) perguntasPendentes.slice().forEach(function (q) {
      var e = new AbortError("Aborted with Ctrl+D");
      marcar(e, ["[_ttyWrite] (node:internal/readline/interface:1359:37)", "ReadStream.onkeypress (node:internal/readline/interface:289:20)", "ReadStream.emit (node:events:514:28)", "emitKeys (node:internal/readline/utils:371:14)", "emitKeys.next (<anonymous>)", "ReadStream.onData (node:internal/readline/emitKeypressEvents:64:36)", "ReadStream.emit (node:events:514:28)", "addChunk (node:internal/streams/readable:569:12)", "readableAddChunkPushByteMode (node:internal/streams/readable:520:3)", "Readable.push (node:internal/streams/readable:400:5)"],
        "node:internal/readline/interface:1359\n            this[kQuestionReject]?.(new AbortError('Aborted with Ctrl+D'));\n                                    ^\n\n", true);
      q.rl._questao = null;
      q.falha(e);
    });
    perguntasPendentes = [];
    entregarFim();
  }
  function entregarStdin(t) {
    try { process.stdin._chegou(t); } catch (e) { if (e !== SAIR) naoTratado(e, false); }
    if (stdinConsumidores > 0 && !stdinFim) pedirEntrada();
    talvezFim();
  }
  function entregarFim() {
    try { process.stdin._acabou(); } catch (e) { if (e !== SAIR) naoTratado(e, false); }
    talvezFim();
  }

  function Stdin() {
    EventEmitter.call(this);
    this.fd = 0; this.readable = true; this._fluindo = false; this._cod = null; this._segurando = false; this._pendente = [];
    this._fimEmitido = false;
    if (interativo) { this.isTTY = true; this.isRaw = false; }
  }
  Stdin.prototype = Object.create(EventEmitter.prototype);
  Stdin.prototype.constructor = Stdin;
  Object.defineProperty(Stdin, "name", { value: "ReadStream" });
  Stdin.prototype._aoAdicionar = function (t) { if (t === "data" || t === "readable") this.resume(); if (t === "end" || t === "close") this._olhar(); };
  Stdin.prototype._aoRemover = function () { if (!this.listenerCount("data") && !this.listenerCount("readable") && !this._leitores) this.pause(); };
  Stdin.prototype._olhar = function () {};
  Stdin.prototype.setEncoding = function (c) { this._cod = c; return this; };
  Stdin.prototype.setRawMode = function () { return this; };
  Stdin.prototype.resume = function () {
    if (this._fluindo) return this;
    this._fluindo = true;
    if (!this._segurando) { this._segurando = true; stdinConsumidores++; segurar(); }
    var self = this;
    if (!interativo) {
      nSetTimeout(function () {
        if (encerrado || !self._fluindo) return;
        if (stdinBuf) { var t = stdinBuf; stdinBuf = ""; try { self._chegou(t); } catch (e) { if (e !== SAIR) naoTratado(e, false); return; } }
        if (!stdinFim) { stdinFim = true; }
        nSetTimeout(function () { if (!encerrado) { try { self._acabou(); } catch (e) { if (e !== SAIR) naoTratado(e, false); } talvezFim(); } }, 0);
      }, 0);
    } else pedirEntrada();
    return this;
  };
  Stdin.prototype.pause = function () {
    this._fluindo = false;
    if (this._segurando) { this._segurando = false; stdinConsumidores--; soltar(); }
    return this;
  };
  Stdin.prototype.unref = function () { if (this._segurando) { this._segurando = false; stdinConsumidores--; soltar(); } return this; };
  Stdin.prototype.ref = function () { return this; };
  Stdin.prototype._chegou = function (t) {
    if (!this._fluindo) { this._pendente.push(t); return; }
    var d = this._cod ? t : Buffer.from(t);
    this.emit("data", d);
  };
  Stdin.prototype._acabou = function () {
    if (this._fimEmitido) return;
    if (!this._fluindo && this.listenerCount("end") === 0 && !this._leitores) return;
    this._fimEmitido = true;
    this.emit("end");
    this.emit("close");
    this.pause();
  };
  Stdin.prototype.read = function () { return null; };
  Stdin.prototype.pipe = function (dst) { this.on("data", function (d) { dst.write(d); }); return dst; };
  Stdin.prototype[Symbol.asyncIterator] = function () {
    var self = this, fila = [], esperando = [], fim = false;
    this.on("data", function (d) { if (esperando.length) esperando.shift()({ value: d, done: false }); else fila.push(d); });
    this.on("end", function () { fim = true; while (esperando.length) esperando.shift()({ value: undefined, done: true }); });
    return {
      next: function () { if (fila.length) return NativePromise.resolve({ value: fila.shift(), done: false }); if (fim) return NativePromise.resolve({ value: undefined, done: true }); return new NativePromise(function (ok) { esperando.push(ok); }); },
      "return": function () { self.pause(); return NativePromise.resolve({ done: true }); },
      [Symbol.asyncIterator]: function () { return this; },
    };
  };

  function Stdout(fd) {
    EventEmitter.call(this);
    this.fd = fd; this.writable = true;
    this.isTTY = true; this.columns = 80; this.rows = 24;
  }
  Stdout.prototype = Object.create(EventEmitter.prototype);
  Stdout.prototype.constructor = Stdout;
  Object.defineProperty(Stdout, "name", { value: "WriteStream" });
  Stdout.prototype.write = function (d, cod, cb) {
    if (typeof d !== "string" && !ArrayBuffer.isView(d)) throw tipoErrado("chunk", "string or an instance of Buffer, TypedArray, or DataView", d);
    escrever(this.fd === 1 ? "out" : "err", typeof d === "string" ? d : texto(bytes(d)));
    var f = typeof cod === "function" ? cod : cb;
    if (f) { segurar(); nSetTimeout(function () { soltar(); f(); }, 0); }
    return true;
  };
  Stdout.prototype.end = function (d) { if (d) this.write(d); };
  Stdout.prototype.getColorDepth = function () { return 8; };
  Stdout.prototype.hasColors = function () { return true; };
  Stdout.prototype.cursorTo = function (x, y, cb) { this.write(y === undefined || typeof y === "function" ? "\x1b[" + (x + 1) + "G" : "\x1b[" + (y + 1) + ";" + (x + 1) + "H"); return true; };
  Stdout.prototype.moveCursor = function (dx, dy) { var s = ""; if (dx < 0) s += "\x1b[" + -dx + "D"; else if (dx > 0) s += "\x1b[" + dx + "C"; if (dy < 0) s += "\x1b[" + -dy + "A"; else if (dy > 0) s += "\x1b[" + dy + "B"; this.write(s); return true; };
  Stdout.prototype.clearLine = function (dir) { this.write(dir < 0 ? "\x1b[1K" : dir > 0 ? "\x1b[0K" : "\x1b[2K"); return true; };
  Stdout.prototype.clearScreenDown = function () { this.write("\x1b[0J"); return true; };

  /* ------------------------------------------------------------ process */
  var process = new EventEmitter();
  var ENV = {
    SHELL: "/bin/bash", COLORTERM: "truecolor", PWD: HOME, LOGNAME: "ana", HOME: HOME, LANG: "pt_BR.UTF-8",
    TERM: "xterm-256color", USER: "ana", SHLVL: "1", LANGUAGE: "pt_BR:pt:en", TZ: "America/Sao_Paulo",
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin", OLDPWD: HOME, _: "/usr/local/bin/node",
  };
  var cwdAtual = HOME;
  Object.assign(process, {
    title: "node", version: NODE_VERSAO,
    versions: { node: NODE_VERSAO.slice(1), acorn: "8.15.0", ada: "3.3.0", ares: "1.34.5", brotli: "1.1.0", cjs_module_lexer: "2.1.0", icu: "77.1", llhttp: "9.3.0", modules: "137", napi: "10", nghttp2: "1.66.0", openssl: "3.5.4", simdjson: "4.1.0", simdutf: "6.4.2", tz: "2025b", undici: "7.16.0", unicode: "16.0", uv: "1.51.0", uvwasi: "0.0.23", v8: "13.6.233.17-node.57", zlib: "1.3.1-470d3a2" },
    arch: "x64", platform: "linux", release: { name: "node", lts: "Krypton", sourceUrl: "https://nodejs.org/download/release/" + NODE_VERSAO + "/node-" + NODE_VERSAO + ".tar.gz" },
    execPath: "/usr/local/bin/node", execArgv: [], pid: 4242, ppid: 4200, exitCode: undefined,
    env: ENV, argv0: "node",
    config: { variables: {} }, features: {},
  });
  process.cwd = function () { return cwdAtual; };
  process.chdir = function (d) { var a = abs(d); if (!vfs.dir[a]) { var e = new Error("ENOENT: no such file or directory, chdir " + cwdAtual + " -> '" + d + "'"); e.errno = -2; e.code = "ENOENT"; e.syscall = "chdir"; e.path = cwdAtual; e.dest = d; throw e; } cwdAtual = a; ENV.PWD = a; };
  process.exit = function (c) {
    if (c !== undefined) process.exitCode = c;
    sair(process.exitCode === undefined ? 0 : process.exitCode);
    throw SAIR;
  };
  process.abort = function () { sair(134, true); throw SAIR; };
  process.kill = function () { return true; };
  process.uptime = function () { return (Date.now() - inicio) / 1000; };
  process.hrtime = function (ant) { var t = performance.now(), s = Math.floor(t / 1000), ns = Math.floor((t % 1000) * 1e6); if (ant) { s -= ant[0]; ns -= ant[1]; if (ns < 0) { s--; ns += 1e9; } } return [s, ns]; };
  process.hrtime.bigint = function () { return BigInt(Math.floor(performance.now() * 1e6)); };
  process.memoryUsage = function () { return { rss: 45678592, heapTotal: 6295552, heapUsed: 5326704, external: 1736454, arrayBuffers: 10515 }; };
  process.memoryUsage.rss = function () { return 45678592; };
  process.cpuUsage = function () { var u = Math.round(performance.now() * 1000); return { user: u, system: Math.round(u / 5) }; };
  process.emitWarning = function (w, tipo) {
    var nome = typeof tipo === "string" ? tipo : tipo && tipo.type || (w && w.name) || "Warning";
    var msg = typeof w === "string" ? w : w && w.message;
    escrever("err", "(node:" + process.pid + ") " + nome + ": " + msg + "\n" + (nomeAviso ? "" : "(Use `node --trace-warnings ...` to show where the warning was created)\n"));
    nomeAviso = true;
  };
  var nomeAviso = false;
  process.getuid = function () { return 1000; }; process.getgid = function () { return 1000; };
  process.geteuid = function () { return 1000; }; process.getegid = function () { return 1000; };
  process.umask = function () { return 18; };
  process.binding = function () { throw new Error("No such module"); };
  process.on("newListener", function () {});
  var filaTick = [];
  process.nextTick = function (f) {
    if (typeof f !== "function") throw tipoErrado("callback", "function", f);
    var args = Array.prototype.slice.call(arguments, 1);
    filaTick.push([f, args]);
    if (filaTick.length === 1) nQueueMicrotask(jsNodeTick);
  };
  function jsNodeTick() {
    while (filaTick.length && !encerrado) {
      var t = filaTick.shift();
      try { t[0].apply(undefined, t[1]); } catch (e) { if (e !== SAIR) naoTratado(e, false); return; }
    }
    talvezFim();
  }

  /* ------------------------------------------------------------ timers */
  function Timeout(f, ms, args, repetir) {
    this._idleTimeout = ms; this._onTimeout = f; this._timerArgs = args; this._repeat = repetir ? ms : null;
    this._destroyed = false; this[kRef] = true; this._id = 0;
  }
  var kRef = Symbol("refed");
  Object.defineProperty(Timeout, "name", { value: "Timeout" });
  Timeout.prototype.ref = function () { if (!this[kRef] && !this._destroyed) { this[kRef] = true; segurar(); } return this; };
  Timeout.prototype.unref = function () { if (this[kRef] && !this._destroyed) { this[kRef] = false; soltar(); } return this; };
  Timeout.prototype.hasRef = function () { return this[kRef]; };
  Timeout.prototype.refresh = function () { if (!this._destroyed) { nClearTimeout(this._id); armar(this); } return this; };
  Timeout.prototype.close = function () { limpar(this); return this; };
  Timeout.prototype[Symbol.toPrimitive] = function () { return this._numero; };
  var proxNumeroTimer = 1, porNumero = {};
  function armar(t) {
    t._quando = Date.now() + t._idleTimeout;
    t._id = nSetTimeout(function () { jsNodeTimer(t); }, t._idleTimeout);
  }
  function jsNodeTimer(t) {
    if (encerrado || t._destroyed) return;
    if (t._repeat === null) { t._destroyed = true; delete porNumero[t._numero]; }
    try {
      if (t._timerArgs) t._onTimeout.apply(t, t._timerArgs); else t._onTimeout();
    } catch (e) { if (e !== SAIR) naoTratado(e, false); return; }
    if (t._repeat !== null && !t._destroyed) armar(t);
    else if (t[kRef]) { t[kRef] = false; soltar(); }
  }
  function limpar(t) {
    if (typeof t === "number" || typeof t === "string") t = porNumero[t];
    if (!t || !(t instanceof Timeout) || t._destroyed) return;
    t._destroyed = true; nClearTimeout(t._id); delete porNumero[t._numero];
    if (t[kRef]) { t[kRef] = false; soltar(); }
  }
  function novoTimer(f, ms, args, repetir) {
    if (typeof f !== "function") throw tipoErrado("callback", "function", f);
    ms = +ms; if (!(ms >= 1 && ms <= 2147483647)) ms = 1;
    var t = new Timeout(f, ms, args.length ? args : null, repetir);
    t._numero = proxNumeroTimer++; porNumero[t._numero] = t;
    segurar(); armar(t);
    return t;
  }
  function setTimeout_(f, ms) { return novoTimer(f, ms, Array.prototype.slice.call(arguments, 2), false); }
  function setInterval_(f, ms) { return novoTimer(f, ms, Array.prototype.slice.call(arguments, 2), true); }
  var cbImediato = new WeakMap();
  function Immediate(f, args) { cbImediato.set(this, f); this._onImmediate = null; this._argv = args; this._destroyed = false; this[kRef] = true; }
  Object.defineProperty(Immediate, "name", { value: "Immediate" });
  Immediate.prototype.ref = function () { return this; };
  Immediate.prototype.unref = function () { if (this[kRef]) { this[kRef] = false; soltar(); } return this; };
  Immediate.prototype.hasRef = function () { return this[kRef]; };
  function setImmediate_(f) {
    if (typeof f !== "function") throw tipoErrado("callback", "function", f);
    var im = new Immediate(f, Array.prototype.slice.call(arguments, 1));
    segurar();
    filaImediata.push(im);
    if (filaImediata.length === 1) canal.port2.postMessage(0);
    return im;
  }
  // a fase "check" do laço do Node: antes, os timers que já venceram (setTimeout 0 sai antes do setImmediate)
  var filaImediata = [], canal = new NMessageChannel();
  canal.port1.onmessage = function () {
    timersVencidos();
    var lista = filaImediata; filaImediata = [];
    for (var i = 0; i < lista.length && !encerrado; i++) jsNodeImmediate(lista[i]);
  };
  function timersVencidos() {
    var agora = Date.now();
    var v = Object.keys(porNumero).map(function (k) { return porNumero[k]; }).filter(function (t) { return !t._destroyed && t._quando <= agora + 1; });
    v.sort(function (a, b) { return a._quando - b._quando || a._numero - b._numero; });
    v.forEach(function (t) { if (!t._destroyed && !encerrado) { nClearTimeout(t._id); jsNodeTimer(t); } });
  }
  function jsNodeImmediate(im) {
    if (encerrado || im._destroyed) return;
    im._destroyed = true;
    var f = cbImediato.get(im);
    try { f.apply(im, im._argv); } catch (e) { if (e !== SAIR) naoTratado(e, false); return; }
    if (im[kRef]) { im[kRef] = false; soltar(); }
  }
  function clearImmediate_(im) { if (im instanceof Immediate && !im._destroyed) { im._destroyed = true; if (im[kRef]) { im[kRef] = false; soltar(); } } }

  /* ------------------------------------------------------------ console */
  var grupo = "", contagens = {}, tempos = {};
  function formatar(args) { return U.formatWithOptions({}, ...args); }
  function linhaConsole(t, args) {
    var s = formatar(args);
    if (grupo) s = grupo + s.split("\n").join("\n" + grupo);
    escrever(t, s + "\n");
  }
  var consoleNode = {
    log: function () { linhaConsole("out", arguments); },
    info: function () { linhaConsole("out", arguments); },
    debug: function () { linhaConsole("out", arguments); },
    warn: function () { linhaConsole("err", arguments); },
    error: function () { linhaConsole("err", arguments); },
    dir: function (o, opc) { var s = U.inspect(o, Object.assign({ customInspect: false }, opc || {})); escrever("out", (grupo ? grupo + s.split("\n").join("\n" + grupo) : s) + "\n"); },
    dirxml: function () { linhaConsole("out", arguments); },
    trace: function trace() {
      var e = { name: "Trace", message: formatar(arguments) };
      if (ehV8) Error.captureStackTrace(e, trace);
      var s = String(e.stack);
      if (!ehV8) s = "Trace: " + e.message;
      linhaConsole("err", [s]);
    },
    assert: function (v) {
      if (v) return;
      var resto = Array.prototype.slice.call(arguments, 1);
      if (resto.length && typeof resto[0] === "string") { resto[0] = "Assertion failed: " + resto[0]; linhaConsole("err", resto); }
      else linhaConsole("err", ["Assertion failed"].concat(resto));
    },
    count: function (r) { r = r === undefined ? "default" : String(r); contagens[r] = (contagens[r] || 0) + 1; linhaConsole("out", [r + ": " + contagens[r]]); },
    countReset: function (r) { r = r === undefined ? "default" : String(r); if (contagens[r] === undefined) { process.emitWarning("Count for '" + r + "' does not exist"); return; } contagens[r] = 0; },
    group: function () { if (arguments.length) linhaConsole("out", arguments); grupo += "  "; },
    groupCollapsed: function () { consoleNode.group.apply(null, arguments); },
    groupEnd: function () { grupo = grupo.slice(0, -2); },
    time: function (r) { r = r === undefined ? "default" : String(r); if (tempos[r] !== undefined) { process.emitWarning("Label '" + r + "' already exists for console.time()"); return; } tempos[r] = performance.now(); },
    timeEnd: function (r) { r = r === undefined ? "default" : String(r); if (tempos[r] === undefined) { process.emitWarning("No such label '" + r + "' for console.timeEnd()"); return; } linhaConsole("out", [r + ": " + fmtTempo(performance.now() - tempos[r])]); delete tempos[r]; },
    timeLog: function (r) { r = r === undefined ? "default" : String(r); if (tempos[r] === undefined) { process.emitWarning("No such label '" + r + "' for console.timeLog()"); return; } linhaConsole("out", [r + ": " + fmtTempo(performance.now() - tempos[r])].concat(Array.prototype.slice.call(arguments, 1))); },
    table: function (dados, props) { if (dados === null || typeof dados !== "object") return linhaConsole("out", [dados]); linhaConsole("out", [tabela(dados, props)]); },
    clear: function () {},
    profile: function () {}, profileEnd: function () {}, timeStamp: function () {},
  };
  function fmtTempo(ms) {
    if (ms >= 1000) { var s = ms / 1000; if (s >= 60) { var m = s / 60; if (m >= 60) return (m / 60).toFixed(3) + "h"; return m.toFixed(3) + "min"; } return s.toFixed(3) + "s"; }
    return Number(ms.toFixed(3)) + "ms";
  }
  // console.table — porte de lib/internal/cli_table.js e de console.table do Node
  function larguraTexto(s) { var n = 0; for (var ch of String(s)) { var c = ch.codePointAt(0); n += (c >= 0x1100 && (c <= 0x115f || c === 0x2329 || c === 0x232a || (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd))) ? 2 : (c === 0x200b || (c >= 0x300 && c <= 0x36f)) ? 0 : 1; } return n; }
  function renderRow(row, larg) {
    var out = "│ ";
    for (var i = 0; i < row.length; i++) {
      var cell = row[i], len = larguraTexto(cell), needed = larg[i] - len;
      out += cell + espacos(needed);
      if (i !== row.length - 1) out += " │ ";
    }
    return out + " │";
  }
  function cliTable(head, columns) {
    var rows = [], larg = head.map(function (h) { return larguraTexto(h); });
    var longest = Math.max.apply(null, columns.map(function (a) { return a.length; }).concat([0]));
    for (var i = 0; i < head.length; i++) {
      var col = columns[i];
      for (var j = 0; j < longest; j++) {
        if (rows[j] === undefined) rows[j] = [];
        var v = rows[j][i] = Object.prototype.hasOwnProperty.call(col, j) ? col[j] : "";
        var w = larg[i] || 0, c = larguraTexto(v);
        larg[i] = Math.max(w, c);
      }
    }
    var div = larg.map(function (w) { return "─".repeat(w + 2); });
    var r = "┌" + div.join("┬") + "┐\n" + renderRow(head, larg) + "\n" + "├" + div.join("┼") + "┤\n";
    rows.forEach(function (row) { r += renderRow(row, larg) + "\n"; });
    return r + "└" + div.join("┴") + "┘";
  }
  function tabela(dados, props) {
    var fmt = function (v) { return U.inspect(v, { depth: 1, maxArrayLength: 3, breakLength: Infinity, colors: false }); };
    var map = Object.create(null), temValores = false, valores = [], indices = [], chaves = [];
    var linhas;
    if (dados instanceof Map) { linhas = []; dados.forEach(function (v, k) { linhas.push([k, v]); }); var ki = [], vi = [], ii = []; linhas.forEach(function (l, i) { ii.push(String(i)); ki.push(fmt(l[0])); vi.push(fmt(l[1])); }); return cliTable(["(iteration index)", "Key", "Values"], [ii, ki, vi]); }
    if (dados instanceof Set) { var ii2 = [], vv = []; var i2 = 0; dados.forEach(function (v) { ii2.push(String(i2++)); vv.push(fmt(v)); }); return cliTable(["(iteration index)", "Values"], [ii2, vv]); }
    var ks = Object.keys(dados);
    ks.forEach(function (k, i) {
      indices.push(k);
      var item = dados[k];
      var prim = item === null || (typeof item !== "function" && typeof item !== "object");
      if (props === undefined && prim) { temValores = true; valores[i] = fmt(item); }
      else {
        var kk = props || Object.keys(item);
        kk.forEach(function (key) {
          if (map[key] === undefined) { map[key] = []; chaves.push(key); }
          if ((prim && props) || !Object.prototype.hasOwnProperty.call(item, key)) map[key][i] = "";
          else map[key][i] = fmt(item[key]);
        });
      }
    });
    var head = ["(index)"].concat(chaves), cols = [indices].concat(chaves.map(function (k) { return map[k]; }));
    if (temValores) { head.push("Values"); cols.push(valores); }
    return cliTable(head, cols);
  }

  /* ------------------------------------------------------------ readline */
  function Interface(input, output, completer, terminal) {
    EventEmitter.call(this);
    var o = input && input.input !== undefined && !(input instanceof EventEmitter && input.on === Stdin.prototype.on && false) && input.input ? input : { input: input, output: output, terminal: terminal };
    this.input = o.input; this.output = o.output; this.terminal = !!(o.terminal !== undefined ? o.terminal : o.output && o.output.isTTY);
    this._prompt = o.prompt !== undefined ? String(o.prompt) : "> ";
    this.line = ""; this.cursor = 0; this.closed = false; this.paused = false;
    this.history = []; this.crlfDelay = o.crlfDelay || 100;
    this._buf = ""; this._questao = null; this._iter = null;
    var self = this;
    this._onData = function (d) {
      var s = self._buf + (typeof d === "string" ? d : texto(bytes(d)));
      var partes = s.split(/\r\n|\n|\r/);
      self._buf = partes.pop();
      for (var i = 0; i < partes.length; i++) {
        if (self.closed) break;
        self._onLine(partes[i]);
      }
    };
    this._onEnd = function () {
      if (self._buf.length > 0) { var b = self._buf; self._buf = ""; self.emit("line", b); }
      self.close();
    };
    if (this.input && this.input.on) {
      this.input._leitores = (this.input._leitores || 0) + 1;
      this.input.on("data", this._onData);
      this.input.on("end", this._onEnd);
      if (this.input.resume) this.input.resume();
    }
  }
  Interface.prototype = Object.create(EventEmitter.prototype);
  Interface.prototype.constructor = Interface;
  Object.defineProperty(Interface, "name", { value: "Interface" });
  Interface.prototype._onLine = function (l) {
    if (this._questao) { var cb = this._questao; this._questao = null; cb(l); }
    else this.emit("line", l);
  };
  Interface.prototype.getPrompt = function () { return this._prompt; };
  Interface.prototype.setPrompt = function (p) { this._prompt = String(p); };
  Interface.prototype.prompt = function () {
    if (this.closed) { var e = new Error("readline was closed"); e.code = "ERR_USE_AFTER_CLOSE"; throw e; }
    if (this.paused) this.resume();
    if (this.output && this.output.write) this.output.write(this._prompt);
  };
  Interface.prototype.question = function (q, opc, cb) {
    cb = typeof opc === "function" ? opc : cb;
    if (this.closed) { var e = new Error("readline was closed"); e.code = "ERR_USE_AFTER_CLOSE"; throw e; }
    if (this._questao) { this.prompt(); return; }
    this._questao = cb;
    if (this.paused) this.resume();
    if (this.output && this.output.write) this.output.write(String(q));
  };
  Interface.prototype.write = function (d) { if (this.closed) return; this._onData(d); };
  Interface.prototype.pause = function () { if (this.paused) return this; if (this.input && this.input.pause) this.input.pause(); this.paused = true; this.emit("pause"); return this; };
  Interface.prototype.resume = function () { if (!this.paused) return this; if (this.input && this.input.resume) this.input.resume(); this.paused = false; this.emit("resume"); return this; };
  Interface.prototype.close = function () {
    if (this.closed) return;
    this.pause();
    this.closed = true;
    if (this.input && this.input.removeListener) {
      this.input.removeListener("data", this._onData);
      this.input.removeListener("end", this._onEnd);
      this.input._leitores--;
      if (this.input._aoRemover) this.input._aoRemover();
    }
    this.emit("close");
  };
  Interface.prototype[Symbol.asyncIterator] = function () {
    if (!this._iter) {
      var self = this, fila = [], esperando = [], fim = false;
      this.on("line", function (l) { if (esperando.length) esperando.shift()({ value: l, done: false }); else fila.push(l); });
      this.on("close", function () { fim = true; while (esperando.length) esperando.shift()({ value: undefined, done: true }); });
      this._iter = {
        next: function () { if (fila.length) return NativePromise.resolve({ value: fila.shift(), done: false }); if (fim) return NativePromise.resolve({ value: undefined, done: true }); return new NativePromise(function (ok) { esperando.push(ok); }); },
        "return": function () { self.close(); return NativePromise.resolve({ value: undefined, done: true }); },
      };
      this._iter[Symbol.asyncIterator] = function () { return this; };
    }
    return this._iter;
  };
  Interface.prototype.getCursorPos = function () { return { rows: 0, cols: this.cursor }; };
  function InterfacePromessa(a, b, c, d) { Interface.call(this, a, b, c, d); }
  InterfacePromessa.prototype = Object.create(Interface.prototype);
  InterfacePromessa.prototype.constructor = InterfacePromessa;
  Object.defineProperty(InterfacePromessa, "name", { value: "Interface" });
  InterfacePromessa.prototype.question = function (q, opc) {
    var self = this;
    if (ehV8) { var onde = {}; Error.captureStackTrace(onde); try { void onde.stack; var cs = posicoes.get(onde); if (cs) for (var i = 0; i < cs.length; i++) { var f = cs[i].getFileName(); if (f && arquivosInfo[f] && arquivosInfo[f] === principalInfo) { var l = cs[i].getLineNumber(), tx = linhaDoFonte(principalInfo, l), c = cs[i].getColumnNumber() - (l === 1 ? principalInfo.linha1 : 0), a = tx.lastIndexOf("await", c - 1); awaitVisto = { info: principalInfo, linha: l, coluna: a >= 0 ? a + 1 : c, texto: tx }; break; } } } catch (x) {} }
    return new NativePromise(function (ok, falha) {
      if (self.closed) { var e = new Error("readline was closed"); e.code = "ERR_USE_AFTER_CLOSE"; falha(e); return; }
      var item = { rl: self, falha: falha };
      perguntasPendentes.push(item);
      Interface.prototype.question.call(self, q, opc, function (v) { perguntasPendentes = perguntasPendentes.filter(function (x) { return x !== item; }); ok(v); });
    });
  };
  var readline = {
    Interface: Interface,
    createInterface: function (a, b, c, d) { return new Interface(a, b, c, d); },
    clearLine: function (s, dir, cb) { s.clearLine && s.clearLine(dir); if (cb) cb(); return true; },
    clearScreenDown: function (s, cb) { s.clearScreenDown && s.clearScreenDown(); if (cb) cb(); return true; },
    cursorTo: function (s, x, y, cb) { s.cursorTo && s.cursorTo(x, y); if (typeof cb === "function") cb(); return true; },
    moveCursor: function (s, dx, dy, cb) { s.moveCursor && s.moveCursor(dx, dy); if (cb) cb(); return true; },
    emitKeypressEvents: function () {},
  };
  var readlinePromises = {
    Interface: InterfacePromessa,
    createInterface: function (a, b, c, d) { return new InterfacePromessa(a, b, c, d); },
    Readline: function () {},
  };
  readline.promises = readlinePromises;

  /* ------------------------------------------------------------ util, os, assert */
  var utilMod = {};
  Object.keys(U).forEach(function (k) { utilMod[k] = U[k]; });
  utilMod.inspect = U.inspect; utilMod.format = U.format; utilMod.formatWithOptions = U.formatWithOptions;
  utilMod.promisify = function (f) {
    if (typeof f !== "function") throw tipoErrado("original", "function", f);
    if (f[utilMod.promisify.custom]) return f[utilMod.promisify.custom];
    return function () { var a = Array.prototype.slice.call(arguments), self = this; return new NativePromise(function (ok, falha) { f.apply(self, a.concat([function (e, v) { if (e) falha(e); else ok(v); }])); }); };
  };
  utilMod.promisify.custom = Symbol.for("nodejs.util.promisify.custom");
  utilMod.callbackify = function (f) { return function () { var a = Array.prototype.slice.call(arguments), cb = a.pop(); f.apply(this, a).then(function (v) { process.nextTick(cb, null, v); }, function (e) { process.nextTick(cb, e); }); }; };
  utilMod.inherits = function (c, s) { Object.setPrototypeOf(c.prototype, s.prototype); Object.setPrototypeOf(c, s); c.super_ = s; };
  utilMod.deprecate = function (f) { return f; };
  utilMod.isDeepStrictEqual = function (a, b) { try { assert.deepStrictEqual(a, b); return true; } catch (e) { return false; } };
  utilMod.types = U.types || {
    isPromise: function (p) { return p instanceof NativePromise; }, isDate: function (d) { return d instanceof Date; }, isRegExp: function (r) { return r instanceof RegExp; },
    isMap: function (m) { return m instanceof Map; }, isSet: function (s) { return s instanceof Set; },
  };
  utilMod.TextEncoder = TextEncoder; utilMod.TextDecoder = TextDecoder;
  utilMod.styleText = function (f, t) { return String(t); };
  utilMod.stripVTControlCharacters = function (s) { return String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ""); };
  utilMod.parseArgs = function () { return { values: {}, positionals: process.argv.slice(2) }; };

  var osMod = {
    EOL: "\n", devNull: "/dev/null",
    hostname: function () { return "notebook"; }, homedir: function () { return HOME; }, tmpdir: function () { return "/tmp"; },
    platform: function () { return "linux"; }, type: function () { return "Linux"; }, arch: function () { return "x64"; }, machine: function () { return "x86_64"; },
    release: function () { return "7.0.0-15-generic"; }, version: function () { return "#15-Ubuntu SMP PREEMPT_DYNAMIC"; },
    userInfo: function () { return { uid: 1000, gid: 1000, username: "ana", homedir: HOME, shell: "/bin/bash" }; },
    cpus: function () { var c = []; for (var i = 0; i < 8; i++) c.push({ model: "Intel(R) Core(TM) i5-1235U", speed: 2500, times: { user: 100000, nice: 0, sys: 50000, idle: 1000000, irq: 0 } }); return c; },
    availableParallelism: function () { return 8; },
    totalmem: function () { return 16 * 1024 * 1024 * 1024; }, freemem: function () { return 9 * 1024 * 1024 * 1024; },
    uptime: function () { return 3600 + Math.floor(performance.now() / 1000); }, loadavg: function () { return [0.42, 0.35, 0.3]; },
    networkInterfaces: function () { return { lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }] }; },
    endianness: function () { return "LE"; },
    constants: { signals: {}, errno: {} },
  };

  function AssertionError(o) {
    var e = new Error(o.message);
    Object.setPrototypeOf(e, AssertionError.prototype);
    e.generatedMessage = !o.usuario; e.code = "ERR_ASSERTION"; e.actual = o.actual; e.expected = o.expected; e.operator = o.operator;
    e.diff = "simple";
    marcas.set(e, { cab: "node:assert:152\n  throw new AssertionError(obj);\n  ^\n\n", nomeStack: "AssertionError [ERR_ASSERTION]" });
    if (ehV8) Error.captureStackTrace(e, o.inicio || AssertionError);
    return e;
  }
  AssertionError.prototype = Object.create(Error.prototype, { constructor: { value: AssertionError, writable: true, configurable: true }, name: { value: "AssertionError", writable: true, configurable: true } });
  function falhaAssert(msg, padrao, actual, expected, op, inicio, ehOk) {
    if (msg instanceof Error) throw msg;
    var e = new AssertionError({ message: msg !== undefined ? msg : padrao, usuario: msg !== undefined, actual: actual, expected: expected, operator: op, inicio: inicio });
    if (ehOk) marcas.get(e).cab = "node:internal/assert/utils:77\n    throw err;\n    ^\n\n";
    throw e;
  }
  // o texto da chamada assert(...) no código do leitor (o Node mostra a expressão que deu falso)
  function textoChamada(inicio, nome) {
    try {
      var o = {}; Error.captureStackTrace(o, inicio); void o.stack;
      var cs = posicoes.get(o);
      for (var i = 0; cs && i < cs.length; i++) {
        var f = cs[i].getFileName(), info = f && arquivosInfo[f];
        if (!info) continue;
        var l = cs[i].getLineNumber(), linhas = (fontes[info.caminho] || "").split("\n"), col = cs[i].getColumnNumber() - (l === 1 ? info.linha1 : 0);
        var resto = linhas.slice(l - 1).join("\n"), ini = resto.split("\n")[0].lastIndexOf("assert", col - 1);
        if (ini < 0) return null;
        var t = resto.slice(ini), p = t.indexOf("("), prof = 0;
        for (var k = p; k < t.length; k++) { if (t[k] === "(") prof++; else if (t[k] === ")" && --prof === 0) return t.slice(0, k + 1); }
        return null;
      }
    } catch (e) {}
    return null;
  }
  function igualProfundo(a, b, estrito) {
    if (estrito ? Object.is(a, b) : (a == b || (a !== a && b !== b))) return true; // eslint-disable-line eqeqeq
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
    if (estrito && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
    if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
    if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b);
    if (a instanceof Map && b instanceof Map) { if (a.size !== b.size) return false; var ok = true; a.forEach(function (v, k) { if (!b.has(k) || !igualProfundo(v, b.get(k), estrito)) ok = false; }); return ok; }
    if (a instanceof Set && b instanceof Set) { if (a.size !== b.size) return false; var ok2 = true; a.forEach(function (v) { if (!b.has(v)) ok2 = false; }); return ok2; }
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    var ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    for (var i = 0; i < ka.length; i++) { if (!Object.prototype.hasOwnProperty.call(b, ka[i]) || !igualProfundo(a[ka[i]], b[ka[i]], estrito)) return false; }
    return true;
  }
  function insp(v) { return U.inspect(v); }
  function diffLinhas(A, B) {
    var n = A.length, m = B.length, L = [];
    for (var i = 0; i <= n; i++) L.push(new Int32Array(m + 1));
    for (i = n - 1; i >= 0; i--) for (var j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var r = []; i = 0; j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && A[i] === B[j]) { r.push("  " + A[i]); i++; j++; }
      else if (i < n && (j >= m || L[i + 1][j] >= L[i][j + 1])) { r.push("+ " + A[i]); i++; }
      else { r.push("- " + B[j]); j++; }
    }
    return r;
  }
  function diffSimples(a, b) {
    var la = insp(a).split("\n"), lb = insp(b).split("\n");
    if (la.length === 1 && lb.length === 1 && (typeof a !== "object" || a === null) && (typeof b !== "object" || b === null)) return "Expected values to be strictly equal:\n\n" + la[0] + " !== " + lb[0] + "\n";
    var op = { compact: false, customInspect: false, depth: 1000, maxArrayLength: Infinity, sorted: true, getters: true };
    la = U.inspect(a, op).split("\n"); lb = U.inspect(b, op).split("\n");
    return "Expected values to be strictly deep-equal:\n+ actual - expected\n\n" + diffLinhas(la, lb).join("\n") + "\n";
  }
  function assert(v, msg) { if (!v) falhaAssert(msg, arguments.length === 0 ? "No value argument passed to `assert.ok()`" : "The expression evaluated to a falsy value:\n\n  " + (msg === undefined ? textoChamada(assert) || "assert(" + insp(v) + ")" : "") + "\n", v, true, "==", assert, true); }
  assert.ok = function ok(v, msg) { if (!v) falhaAssert(msg, "The expression evaluated to a falsy value:\n\n  " + (msg === undefined ? textoChamada(ok) || "assert.ok(" + insp(v) + ")" : "") + "\n", v, true, "==", ok, true); };
  assert.equal = function equal(a, b, msg) { if (!(a == b || (a !== a && b !== b))) falhaAssert(msg, insp(a) + " == " + insp(b), a, b, "==", equal); }; // eslint-disable-line eqeqeq
  assert.notEqual = function notEqual(a, b, msg) { if (a == b) falhaAssert(msg, insp(a) + " != " + insp(b), a, b, "!=", notEqual); }; // eslint-disable-line eqeqeq
  assert.strictEqual = function strictEqual(a, b, msg) { if (!Object.is(a, b)) falhaAssert(msg, diffSimples(a, b), a, b, "strictEqual", strictEqual); };
  assert.notStrictEqual = function notStrictEqual(a, b, msg) { if (Object.is(a, b)) falhaAssert(msg, "Expected \"actual\" to be strictly unequal to: " + insp(b), a, b, "notStrictEqual", notStrictEqual); };
  assert.deepEqual = function deepEqual(a, b, msg) { if (!igualProfundo(a, b, false)) falhaAssert(msg, "Expected values to be loosely deep-equal:\n\n" + insp(a) + "\n\nshould loosely deep-equal\n\n" + insp(b), a, b, "deepEqual", deepEqual); };
  assert.deepStrictEqual = function deepStrictEqual(a, b, msg) { if (!igualProfundo(a, b, true)) falhaAssert(msg, diffSimples(a, b), a, b, "deepStrictEqual", deepStrictEqual); };
  assert.notDeepStrictEqual = function notDeepStrictEqual(a, b, msg) { if (igualProfundo(a, b, true)) falhaAssert(msg, "Expected \"actual\" not to be strictly deep-equal to: " + insp(b), a, b, "notDeepStrictEqual", notDeepStrictEqual); };
  assert.notDeepEqual = function notDeepEqual(a, b, msg) { if (igualProfundo(a, b, false)) falhaAssert(msg, "Expected \"actual\" not to be loosely deep-equal to: " + insp(b), a, b, "notDeepEqual", notDeepEqual); };
  assert.fail = function fail(msg) { falhaAssert(msg, "Failed", undefined, undefined, "fail", fail); };
  assert.throws = function throws(f, esperado, msg) {
    var lancou = false, err;
    try { f(); } catch (e) { lancou = true; err = e; }
    if (!lancou) falhaAssert(typeof esperado === "string" ? esperado : msg, "Missing expected exception.", undefined, esperado, "throws", throws);
    if (typeof esperado === "function" && esperado.prototype !== undefined && !(err instanceof esperado)) throw err;
    if (esperado instanceof RegExp && !esperado.test(String(err))) falhaAssert(msg, "The input did not match the regular expression " + String(esperado) + ". Input:\n\n" + insp(String(err)) + "\n", err, esperado, "throws", throws);
  };
  assert.doesNotThrow = function doesNotThrow(f, msg) { try { f(); } catch (e) { falhaAssert(typeof msg === "string" ? msg : undefined, "Got unwanted exception.\nActual message: \"" + (e && e.message) + "\"", e, undefined, "doesNotThrow", doesNotThrow); } };
  assert.rejects = function (p) { return NativePromise.resolve(typeof p === "function" ? p() : p).then(function () { falhaAssert(undefined, "Missing expected rejection.", undefined, undefined, "rejects"); }, function () {}); };
  assert.match = function match(s, re, msg) { if (!re.test(s)) falhaAssert(msg, "The input did not match the regular expression " + String(re) + ". Input:\n\n" + insp(s) + "\n", s, re, "match", match); };
  assert.doesNotMatch = function doesNotMatch(s, re, msg) { if (re.test(s)) falhaAssert(msg, "The input was expected to not match the regular expression " + String(re) + ". Input:\n\n" + insp(s) + "\n", s, re, "doesNotMatch", doesNotMatch); };
  assert.AssertionError = AssertionError;
  // o modo estrito: equal = strictEqual, deepEqual = deepStrictEqual…
  function assertStrict(v, msg) { if (!v) falhaAssert(msg, arguments.length === 0 ? "No value argument passed to `assert.ok()`" : "The expression evaluated to a falsy value:\n\n  " + (msg === undefined ? textoChamada(assertStrict) || "assert(" + insp(v) + ")" : "") + "\n", v, true, "==", assertStrict, true); }
  Object.keys(assert).forEach(function (k) { assertStrict[k] = assert[k]; });
  assertStrict.equal = assert.strictEqual; assertStrict.notEqual = assert.notStrictEqual;
  assertStrict.deepEqual = assert.deepStrictEqual; assertStrict.notDeepEqual = assert.notDeepStrictEqual;
  assertStrict.strict = assertStrict;
  assert.strict = assertStrict;

  /* ------------------------------------------------------------ módulos */
  var EMBUTIDOS = {};
  function embutido(nome) {
    switch (nome) {
      case "fs": return fsMod;
      case "fs/promises": return fsPromises;
      case "path": case "path/posix": return path;
      case "readline": return readline;
      case "readline/promises": return readlinePromises;
      case "events": return EventEmitter;
      case "util": return utilMod;
      case "os": return osMod;
      case "assert": return assert;
      case "assert/strict": return assertStrict;
      case "process": return process;
      case "buffer": return { Buffer: Buffer, constants: { MAX_LENGTH: 4294967296 } };
      case "timers": return { setTimeout: setTimeout_, setInterval: setInterval_, setImmediate: setImmediate_, clearTimeout: limpar, clearInterval: limpar, clearImmediate: clearImmediate_ };
      case "timers/promises": return {
        setTimeout: function (ms, v) { return new NativePromise(function (ok) { setTimeout_(function () { ok(v); }, ms); }); },
        setImmediate: function (v) { return new NativePromise(function (ok) { setImmediate_(function () { ok(v); }); }); },
        setInterval: function (ms, v) { var fila = 0, esp = null; var t = setInterval_(function () { if (esp) { var f = esp; esp = null; f({ value: v, done: false }); } else fila++; }, ms); var it = { next: function () { if (fila) { fila--; return NativePromise.resolve({ value: v, done: false }); } return new NativePromise(function (ok) { esp = ok; }); }, "return": function () { limpar(t); return NativePromise.resolve({ done: true }); } }; it[Symbol.asyncIterator] = function () { return it; }; return it; },
      };
      case "url": return { URL: URL, URLSearchParams: URLSearchParams, fileURLToPath: function (u) { return decodeURIComponent(String(u instanceof URL ? u.href : u).replace(/^file:\/\//, "")); }, pathToFileURL: function (p) { return new URL("file://" + encodeURI(path.resolve(p))); } };
      case "string_decoder": return { StringDecoder: function (c) { var d = new TextDecoder(c === "latin1" ? "latin1" : "utf-8"); this.write = function (b) { return d.decode(b, { stream: true }); }; this.end = function (b) { return d.decode(b); }; } };
      case "crypto": return { randomUUID: function () { return G.crypto.randomUUID(); }, randomInt: function (a, b) { if (b === undefined) { b = a; a = 0; } return a + Math.floor(Math.random() * (b - a)); }, randomBytes: function (n) { return criarBuffer(G.crypto.getRandomValues(new Uint8Array(n))); }, webcrypto: G.crypto, subtle: G.crypto.subtle, getRandomValues: function (a) { return G.crypto.getRandomValues(a); } };
      case "child_process": case "http": case "https": case "net": case "worker_threads": case "cluster": case "dgram": case "dns": case "tls": case "zlib": case "stream": case "stream/promises": case "vm": case "v8": case "perf_hooks": case "async_hooks": case "test": case "sqlite": case "inspector": case "module": case "tty": case "querystring": case "diagnostics_channel":
        return semSuporte(nome);
    }
    return undefined;
  }
  var NOMES_EMBUTIDOS = ["assert", "assert/strict", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto", "dgram", "diagnostics_channel", "dns", "dns/promises", "domain", "events", "fs", "fs/promises", "http", "http2", "https", "inspector", "module", "net", "os", "path", "path/posix", "path/win32", "perf_hooks", "process", "punycode", "querystring", "readline", "readline/promises", "repl", "stream", "stream/promises", "string_decoder", "sys", "timers", "timers/promises", "tls", "tty", "url", "util", "util/types", "v8", "vm", "wasi", "worker_threads", "zlib", "test", "sqlite", "sea"];
  var SEM_SUPORTE = ["child_process", "http", "https", "http2", "net", "worker_threads", "cluster", "dgram", "dns", "dns/promises", "tls", "zlib", "vm", "v8", "async_hooks", "test", "sqlite", "inspector", "module", "tty", "diagnostics_channel", "repl", "wasi", "domain", "sea", "stream/promises"];
  function erroSemModulo(nome) {
    var e = new Error("O editor do guia não tem o módulo node:" + nome + " (ele precisa do Node.js de verdade: rode no seu computador)");
    e.code = "ERR_EDITOR_SEM_MODULO";
    marcas.set(e, { semUsuario: true, cab: "", topo: ["o editor do guia (no navegador não há node:" + nome + ")"], nomeStack: "Error [ERR_EDITOR_SEM_MODULO]" });
    return e;
  }
  function semSuporte(nome) {
    if (nome === "perf_hooks") return { performance: G.performance };
    if (nome === "stream") return { Readable: EventEmitter, Writable: EventEmitter, Transform: EventEmitter, EventEmitter: EventEmitter };
    if (nome === "querystring") return { parse: function (s) { var o = {}; new URLSearchParams(s).forEach(function (v, k) { o[k] = v; }); return o; }, stringify: function (o) { return new URLSearchParams(o).toString(); } };
    var aviso = function () { var e = new Error("O editor do guia não tem o módulo node:" + nome + " (rode no seu computador com o Node.js de verdade)"); e.code = "ERR_EDITOR_SEM_MODULO"; throw e; };
    return new Proxy({}, { get: function (t, k) { if (k === Symbol.toPrimitive || k === "then" || typeof k === "symbol") return undefined; return aviso; } });
  }
  function nomeEmbutido(esp) {
    var n = esp.replace(/^node:/, "");
    if (NOMES_EMBUTIDOS.indexOf(n) >= 0 || (/^node:/.test(esp) && embutido(n) !== undefined)) return n;
    return null;
  }

  var cacheCJS = {}, modo = { tipoPadrao: null };
  function resolverArquivo(esp, deDir) {
    var base = esp[0] === "/" ? esp : path.join(deDir, esp);
    var cands = [base, base + ".js", base + ".json", base + ".cjs", base + ".mjs", base + "/index.js", base + "/index.json"];
    try { var pj = vfs.arq[base + "/package.json"]; if (pj) { var main = JSON.parse(texto(pj)).main; if (main) cands.splice(1, 0, path.join(base, main)); } } catch (e) {}
    for (var i = 0; i < cands.length; i++) if (vfs.arq[cands[i]]) return cands[i];
    return null;
  }
  function erroNaoAchou(esp, quem, pilhaReq) {
    var e = new Error("Cannot find module '" + esp + "'\nRequire stack:\n- " + pilhaReq.join("\n- "));
    e.code = "MODULE_NOT_FOUND"; e.requireStack = pilhaReq.slice();
    marcar(e, ["Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)", "wrapResolveFilename (node:internal/modules/cjs/loader:1118:27)", "defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1142:10)", "resolveForCJSWithHooks (node:internal/modules/cjs/loader:1169:12)", "Module._load (node:internal/modules/cjs/loader:1341:5)", "wrapModuleLoad (node:internal/modules/cjs/loader:261:19)", "Module.require (node:internal/modules/cjs/loader:1674:12)", "require (node:internal/modules/helpers:157:16)"],
      "node:internal/modules/cjs/loader:1568\n  throw err;\n  ^\n\n");
    return e;
  }
  function Module(id, pai) {
    this.id = id; this.path = path.dirname(id); this.exports = {}; this.filename = id; this.loaded = false;
    this.children = []; this.paths = [HOME + "/node_modules", "/home/node_modules", "/node_modules"];
    if (pai) pai.children.push(this);
  }
  Object.defineProperty(Module, "name", { value: "Module" });
  function criarRequire(mod) {
    function jsNodeRequire(esp) {
      if (typeof esp !== "string") throw tipoErrado("id", "string", esp);
      var emb = nomeEmbutido(esp);
      if (emb !== null) { if (SEM_SUPORTE.indexOf(emb) >= 0) throw erroSemModulo(emb); var m = embutido(emb); if (m === undefined) m = semSuporte(emb); return m; }
      var pilha = [], x = mod; while (x) { pilha.push(x.filename); x = x.parent; }
      var arq = /^\.{0,2}\//.test(esp) ? resolverArquivo(esp, mod.path) : null;
      if (!arq) throw erroNaoAchou(esp, mod, pilha);
      return carregarCJS(arq, mod);
    }
    jsNodeRequire.resolve = function (esp) { var a = resolverArquivo(esp, mod.path); if (!a) throw erroNaoAchou(esp, mod, [mod.filename]); return a; };
    jsNodeRequire.cache = cacheCJS;
    jsNodeRequire.main = moduloPrincipal;
    return jsNodeRequire;
  }
  function carregarCJS(arq, pai) {
    if (cacheCJS[arq]) return cacheCJS[arq].exports;
    if (/\.json$/.test(arq)) {
      var m0 = new Module(arq, pai); cacheCJS[arq] = m0;
      try { m0.exports = JSON.parse(texto(vfs.arq[arq])); } catch (e) { delete cacheCJS[arq]; e.message = arq + ": " + e.message; throw e; }
      m0.loaded = true;
      return m0.exports;
    }
    if (tipoModulo(arq) === "esm") {
      var e2 = new Error("O editor do guia não carrega um módulo ES (import/export) com require(): use import");
      e2.code = "ERR_REQUIRE_ESM"; throw e2;
    }
    var m = new Module(arq, pai); m.parent = pai || null;
    cacheCJS[arq] = m;
    var f = compilarCJS(arq);
    jsNodeCompilar(f, m);
    m.loaded = true;
    return m.exports;
  }
  function jsNodeCompilar(f, m) {
    var r = criarRequire(m);
    f.call(m.exports, m.exports, r, m, m.filename, m.path);
  }
  var definido = null;
  G.__jsNodeDefinir = function (f) { definido = f; };
  var PREFIXO_CJS = "__jsNodeDefinir(function (exports, require, module, __filename, __dirname) {";
  function urlDe(codigo, tipo) { return URL.createObjectURL(new NBlob([codigo], { type: tipo || "text/javascript" })); }
  function compilarCJS(arq) {
    var codigo = texto(vfs.arq[arq]);
    fontes[arq] = codigo;
    var embrulho = PREFIXO_CJS + reescreverImportsDinamicos(codigo, arq) + "\n})";
    var url = urlDe(embrulho);
    arquivosInfo[url] = { caminho: arq, mostrar: arq, linha1: PREFIXO_CJS.length, cjs: true, fonte: codigo };
    definido = null;
    try { nImportScripts(url); }
    catch (e) {
      if (e && e.name === "SyntaxError") {
        // o Chrome embrulha: "Failed to execute 'importScripts' on 'WorkerGlobalScope': <mensagem>"
        var msg = String(e.message).replace(/^Failed to execute 'importScripts' on 'WorkerGlobalScope': /, "");
        var e2 = new SyntaxError(msg);
        e2.jsNodeArquivo = arq; e2.jsNodeUrl = url;
        throw e2;
      }
      throw e;
    }
    var f = definido; definido = null;
    return f;
  }
  function tipoModulo(arq) {
    if (/\.mjs$/.test(arq)) return "esm";
    if (/\.cjs$/.test(arq)) return "cjs";
    if (/\.json$/.test(arq)) return "json";
    var pj = vfs.arq[HOME + "/package.json"];
    if (pj) { try { var t = JSON.parse(texto(pj)).type; if (t === "module") return "esm"; if (t === "commonjs") return "cjs"; } catch (e) {} }
    return detectados[arq] || "auto";
  }
  var detectados = {};

  /* ------------------------------------------------------------ módulos ES */
  var urlsESM = {}, urlsEmbutidos = {}, esmVisitando = {};
  G.__jsNodeEmbutido = function (n) { var m = embutido(n); return m === undefined ? semSuporte(n) : m; };
  G.__jsNodeCJS = function (arq) { return carregarCJS(arq, null); };
  G.__jsNodeMeta = {};
  var RE_IMPORT_ESTATICO = /(\bimport\s*(?:[\w$]+\s*,?\s*)?(?:\*\s*as\s+[\w$]+\s*|\{[^}]*\}\s*)?(?:from\s*)?|\bexport\s*(?:\*\s*(?:as\s+[\w$]+\s*)?|\{[^}]*\}\s*)from\s*)(["'])([^"'\n]+)\2/g;
  var RE_IMPORT_DINAMICO = /(\bimport\s*\(\s*)(["'])([^"'\n]+)\2(\s*\))/g;
  function idValido(k) { return /^[A-Za-z_$][\w$]*$/.test(k) && ["default", "await", "yield", "let", "static", "enum", "implements", "package", "protected", "interface", "private", "public", "arguments", "eval"].indexOf(k) < 0 && !/^(break|case|catch|class|const|continue|debugger|delete|do|else|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|this|throw|true|try|typeof|var|void|while|with)$/.test(k); }
  function moduloEmbutidoESM(n) {
    if (urlsEmbutidos[n]) return urlsEmbutidos[n];
    var m = G.__jsNodeEmbutido(n);
    var chaves = [];
    try { chaves = Object.keys(m).filter(idValido); } catch (e) {}
    if (n === "events") chaves = chaves.concat(["once", "on", "EventEmitter"]).filter(function (k, i, a) { return a.indexOf(k) === i; });
    var src = "const m = globalThis.__jsNodeEmbutido(" + JSON.stringify(n) + ");\nexport default m;\n" +
      chaves.map(function (k) { return "export const " + k + " = m[" + JSON.stringify(k) + "];"; }).join("\n");
    urlsEmbutidos[n] = urlDe(src);
    return urlsEmbutidos[n];
  }
  function erroEsmNaoAchou(esp, de) {
    var alvo = /^\.{0,2}\//.test(esp) ? path.resolve(path.dirname(de), esp) : null;
    var e;
    if (alvo) {
      e = new Error("Cannot find module '" + alvo + "' imported from " + de);
      e.code = "ERR_MODULE_NOT_FOUND"; e.url = "file://" + alvo;
      marcar(e, ["finalizeResolution (node:internal/modules/esm/resolve:272:11)", "moduleResolve (node:internal/modules/esm/resolve:879:10)", "defaultResolve (node:internal/modules/esm/resolve:1006:11)", "#cachedDefaultResolve (node:internal/modules/esm/loader:705:20)", "#resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:725:38)", "ModuleLoader.resolveSync (node:internal/modules/esm/loader:763:56)", "#resolve (node:internal/modules/esm/loader:687:17)", "ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:607:35)", "ModuleJob.syncLink (node:internal/modules/esm/module_job:276:33)", "ModuleJob.link (node:internal/modules/esm/module_job:381:17)"],
        "node:internal/modules/esm/resolve:272\n    throw new ERR_MODULE_NOT_FOUND(\n          ^\n\n");
    } else {
      e = new Error("Cannot find package '" + esp + "' imported from " + de);
      e.code = "ERR_MODULE_NOT_FOUND";
      marcar(e, ["packageResolve (node:internal/modules/esm/resolve:767:9)", "moduleResolve (node:internal/modules/esm/resolve:853:18)", "defaultResolve (node:internal/modules/esm/resolve:1006:11)", "#cachedDefaultResolve (node:internal/modules/esm/loader:705:20)", "#resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:725:38)", "ModuleLoader.resolveSync (node:internal/modules/esm/loader:763:56)", "#resolve (node:internal/modules/esm/loader:687:17)", "ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:607:35)", "ModuleJob.syncLink (node:internal/modules/esm/module_job:276:33)", "ModuleJob.link (node:internal/modules/esm/module_job:381:17)"],
        "node:internal/modules/package_json_reader:316\n  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);\n        ^\n\n");
    }
    marcas.get(e).nomeStack = "Error [ERR_MODULE_NOT_FOUND]";
    // o Node escreve "Error [ERR_MODULE_NOT_FOUND]: …"
    return e;
  }
  var origemBlob = {}; // url do blob → { esp, alvo, cjs }
  function resolverESM(esp, de) {
    var u = resolverESM0(esp, de);
    if (!origemBlob[u]) origemBlob[u] = { esp: esp, alvo: null, cjs: false };
    origemBlob[u].esp = esp;
    return u;
  }
  function resolverESM0(esp, de) {
    var emb = nomeEmbutido(esp);
    if (emb !== null && embutido(emb) === undefined || emb !== null && SEM_SUPORTE.indexOf(emb) >= 0) throw erroSemModulo(emb);
    if (emb !== null) return moduloEmbutidoESM(emb);
    if (!/^\.{0,2}\//.test(esp) && !/^file:/.test(esp)) throw erroEsmNaoAchou(esp, de);
    var alvo = path.resolve(path.dirname(de), esp.replace(/^file:\/\//, ""));
    if (!vfs.arq[alvo]) throw erroEsmNaoAchou(esp, de);
    var t = tipoModulo(alvo);
    if (t === "json") { return urlDe("export default " + texto(vfs.arq[alvo]) + ";"); }
    if (t === "cjs" || (t === "auto" && !pareceESM(texto(vfs.arq[alvo])))) {
      var exp = carregarCJS(alvo, null);
      var chaves = exp && typeof exp === "object" ? Object.keys(exp).filter(idValido) : [];
      return marcarCJS(urlDe("const m = globalThis.__jsNodeCJS(" + JSON.stringify(alvo) + ");\nexport default m;\n" + chaves.map(function (k) { return "export const " + k + " = m[" + JSON.stringify(k) + "];"; }).join("\n")));
    }
    return urlModuloESM(alvo);
  }
  function marcarCJS(u) { origemBlob[u] = { esp: null, cjs: true }; return u; }
  // "The requested module 'blob:…' does not provide an export named 'x'" → a mensagem do Node, com a linha do import
  function nomesDoImport(esp, nome) {
    var achado = null;
    Object.keys(urlsESM).some(function (arq) {
      var re = /\bimport\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}\s*from\s*(["'])([^"']+)\2/g, m;
      while ((m = re.exec(fontes[arq] || ""))) if (m[3] === esp) { achado = m[1]; return true; }
      return false;
    });
    if (!achado) return nome;
    return achado.split(",").map(function (x) { return x.trim(); }).filter(Boolean).map(function (x) { var p = x.split(/\s+as\s+/); return p.length > 1 ? p[0] + ": " + p[1] : p[0]; }).join(", ");
  }
  function erroLigacao(e) {
    var m = /^The requested module '([^']+)' does not provide an export named '([^']+)'$/.exec(String(e && e.message || ""));
    if (!m) return null;
    var o = origemBlob[m[1]] || {}, esp = o.esp || m[1], nome = m[2];
    var msg = o.cjs && nome !== "default"
      ? "Named export '" + nome + "' not found. The requested module '" + esp + "' is a CommonJS module, which may not support all module.exports as named exports.\nCommonJS modules can always be imported via the default export, for example using:\n\nimport pkg from '" + esp + "';\nconst { " + nomesDoImport(esp, nome) + " } = pkg;\n"
      : "The requested module '" + esp + "' does not provide an export named '" + nome + "'";
    var cab = "";
    Object.keys(urlsESM).some(function (arq) {
      var linhas = (fontes[arq] || "").split("\n");
      for (var i = 0; i < linhas.length; i++) {
        var l = linhas[i];
        if (l.indexOf("import") < 0 || (l.indexOf("\"" + esp + "\"") < 0 && l.indexOf("'" + esp + "'") < 0)) continue;
        var re = nome === "default" ? /\bimport\s+([\w$]+)/ : new RegExp("[{,]\\s*(" + nome.replace(/\$/g, "\\$") + ")\\b");
        var x = re.exec(l);
        if (!x) continue;
        var col = x.index + x[0].indexOf(x[1]);
        cab = "file://" + arq + ":" + (i + 1) + "\n" + l + "\n" + espacos(col) + setas(x[1].length) + "\n";
        return true;
      }
      return false;
    });
    return cab + "SyntaxError: " + msg + "\n    at #asyncInstantiate (node:internal/modules/esm/module_job:455:21)\n    at async ModuleJob.run (node:internal/modules/esm/module_job:553:5)\n    at async node:internal/modules/esm/loader:647:26\n    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)\n\nNode.js " + NODE_VERSAO + "\n";
  }
  function pareceESM(c) { return /(^|[\n;])\s*(import\s*[\w${*"']|export\s)/.test(c.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")); }
  function reescreverImportsDinamicos(codigo, arq) {
    return codigo.replace(RE_IMPORT_DINAMICO, function (t, a, q, esp, b) {
      try { return a + q + resolverESM(esp, arq) + q + b; } catch (e) { return t; }
    });
  }
  function urlModuloESM(arq) {
    if (urlsESM[arq]) return urlsESM[arq];
    if (esmVisitando[arq]) { var e = new Error("O editor do guia não carrega módulos que se importam em círculo (" + arq + ")"); throw e; }
    esmVisitando[arq] = true;
    var codigo = texto(vfs.arq[arq]);
    fontes[arq] = codigo;
    var novo = codigo.replace(RE_IMPORT_ESTATICO, function (t, a, q, esp) { return a + q + resolverESM(esp, arq) + q; });
    novo = novo.replace(RE_IMPORT_DINAMICO, function (t, a, q, esp, b) { try { return a + q + resolverESM(esp, arq) + q + b; } catch (e) { return t; } });
    G.__jsNodeMeta[arq] = { url: "file://" + arq, filename: arq, dirname: path.dirname(arq), resolve: function (s) { return "file://" + path.resolve(path.dirname(arq), s); } };
    novo = novo.replace(/\bimport\.meta\b/g, "__jsNodeMeta[" + JSON.stringify(arq) + "]");
    // o principal avisa quando começa a rodar (até lá, o carregamento segura o programa)
    var pre = arq === arqPrincipalESM ? "__jsNodeInicioESM();" : "";
    var url = urlDe(pre + novo);
    arquivosInfo[url] = { caminho: arq, mostrar: "file://" + arq, linha1: pre.length, esm: true, fonte: codigo };
    urlsESM[arq] = url;
    delete esmVisitando[arq];
    return url;
  }

  /* ------------------------------------------------------- erro de sintaxe (posição) */
  // o V8 não diz onde está o erro de sintaxe para um script carregado: um worker
  // descartável compila o mesmo texto e o evento de erro traz a linha e a coluna
  function posicaoSintaxe(codigo) {
    return new NativePromise(function (ok) {
      var w, feito = false;
      function fim(v) { if (feito) return; feito = true; try { w && w.terminate(); } catch (e) {} ok(v); }
      try { w = new NWorker(urlDe(codigo + "\n;postMessage(0);")); } catch (e) { fim(null); return; }
      w.onmessage = function () { fim(null); };
      w.onerror = function (ev) { ev.preventDefault && ev.preventDefault(); fim(ev.lineno ? { linha: ev.lineno, coluna: ev.colno, msg: String(ev.message || "").replace(/^Uncaught /, "") } : null); };
      nSetTimeout(function () { fim(null); }, 3000);
    });
  }
  function tamanhoToken(lin, col) {
    var s = lin.slice(col - 1);
    if (!s) return 0;
    var m = /^(?:"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|`(?:[^`\\]|\\.)*`?|[A-Za-z_$À-￿][\w$À-￿]*|\d[\w.]*|\.\.\.|===|!==|\*\*=|>>>=|<<=|>>=|>>>|\?\?=|\|\|=|&&=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|\*\*|<<|>>|[^\s])/.exec(s);
    return m ? m[0].length : 1;
  }
  function esmParaScript(codigo) {
    // troca import/export por espaços (mesmas posições), para achar a posição do erro de sintaxe
    var c = codigo.replace(RE_IMPORT_ESTATICO, function (t) { return t.replace(/[^\n]/g, " "); });
    c = c.replace(/\bexport\s+default\s+/g, function (t) { return t.replace(/[^\n]/g, " "); });
    c = c.replace(/\bexport\s*\{[^}]*\}\s*;?/g, function (t) { return t.replace(/[^\n]/g, " "); });
    c = c.replace(/\bexport\s+(?=(async\s+)?(function|class|const|let|var)\b)/g, function (t) { return t.replace(/[^\n]/g, " "); });
    c = c.replace(/\bimport\.meta\b/g, "__ime_.meta");
    return c;
  }
  function erroSintaxe(e, arq, esm) {
    var codigo = fontes[arq] !== undefined ? fontes[arq] : texto(vfs.arq[arq]);
    var prefixo = esm ? "(async function () {\"use strict\";" : PREFIXO_CJS;
    var corpo = esm ? esmParaScript(codigo) : codigo;
    return posicaoSintaxe(prefixo + corpo + "\n})").then(function (p) {
      var linhas = codigo.split("\n");
      var mostrar = esm ? "file://" + arq : arq;
      var msg = e.message;
      var lin = null, col = 1, n = 0;
      if (p && (!esm || p.msg === "SyntaxError: " + msg)) {
        lin = p.linha; col = p.coluna - (p.linha === 1 ? prefixo.length : 0);
        if (lin > linhas.length || (lin === linhas.length + 1)) {
          // o erro caiu no "})" do embrulho: o arquivo terminou antes da hora
          msg = "Unexpected end of input";
          lin = linhas.length; col = linhas[lin - 1].length + 1; n = 0;
        } else if (/has already been declared$/.test(msg)) n = 1;
        else if (!esm && msg === "missing ) after argument list" && linhas[lin - 1].charAt(col - 1) === "}") { msg = "Unexpected token '}'"; n = 1; }
        else if (msg === "Invalid or unexpected token") n = /^["']/.test(linhas[lin - 1].slice(col - 1)) ? linhas[lin - 1].length - col + 1 : 1;
        else n = tamanhoToken(linhas[lin - 1], col);
        if (!esm && msg !== e.message) { try { e.message = msg; } catch (x) {} }
      }
      var cab = lin ? mostrar + ":" + lin + "\n" + linhas[lin - 1] + "\n" + espacos(col - 1) + setas(n) + "\n\n" : "";
      var frames = esm
        ? ["compileSourceTextModule (node:internal/modules/esm/utils:319:16)", "ModuleLoader.moduleStrategy (node:internal/modules/esm/translators:89:18)", "#translate (node:internal/modules/esm/loader:438:20)", "afterLoad (node:internal/modules/esm/loader:506:29)", "ModuleLoader.loadAndTranslate (node:internal/modules/esm/loader:511:12)", "#getOrCreateModuleJobAfterResolve (node:internal/modules/esm/loader:564:36)", "afterResolve (node:internal/modules/esm/loader:611:52)", "ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:617:12)", "node:internal/modules/esm/loader:636:32", "TracingChannel.tracePromise (node:diagnostics_channel:370:14)"]
        : ["wrapSafe (node:internal/modules/cjs/loader:1861:18)", "Module._compile (node:internal/modules/cjs/loader:1903:20)", "Object..js (node:internal/modules/cjs/loader:2060:10)", "Module.load (node:internal/modules/cjs/loader:1651:32)", "Module._load (node:internal/modules/cjs/loader:1443:12)", "wrapModuleLoad (node:internal/modules/cjs/loader:261:19)", "Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)", "node:internal/main/run_main_module:33:47"];
      return cab + "SyntaxError: " + msg + frames.map(function (f) { return "\n    at " + f; }).join("") + "\n\nNode.js " + NODE_VERSAO + "\n";
    });
  }
  function terminarComSintaxe(txt) {
    houveExcecao = true; textoExcecao = txt;
    escrever("err", txt);
    sair(1, true);
  }

  /* ------------------------------------------------------------ o programa principal */
  var moduloPrincipal = null, principalInfo = null, modoExec = "cjs";
  var ESM_ERROS = /^(Cannot use import statement outside a module|Unexpected token 'export'|Cannot use 'import\.meta' outside a module|await is only valid in async functions and the top level bodies of modules)$/;
  function jsNodePrincipal(arq) {
    var m = new Module(".", null); m.filename = arq; m.id = "."; m.path = path.dirname(arq); m.parent = null;
    moduloPrincipal = m; cacheCJS[arq] = m;
    var f = compilarCJS(arq);
    principalInfo = arquivosInfo[Object.keys(arquivosInfo).filter(function (u) { return arquivosInfo[u].caminho === arq; })[0]];
    jsNodeCompilar(f, m);
    m.loaded = true;
  }
  var arqPrincipalESM = null, carregandoESM = false;
  G.__jsNodeInicioESM = function () { if (carregandoESM) { carregandoESM = false; soltar(); } };
  function rodarESM(arq, erroCJS) {
    modoExec = "esm";
    arqPrincipalESM = arq;
    carregandoESM = true; segurar();
    var url;
    try { url = urlModuloESM(arq); }
    catch (e) { naoTratado(e, false); return; }
    principalInfo = arquivosInfo[url];
    esmComAwait = temAwaitNoTopo(fontes[arq] || "");
    principalPendente = true;
    import(url).then(function () { principalPendente = false; G.__jsNodeInicioESM(); talvezFim(); }, function (e) {
      principalPendente = false;
      if (carregandoESM) { carregandoESM = false; ativos--; }
      try { if (e && typeof e === "object") void e.stack; } catch (x) {}
      var lig = e && e.name === "SyntaxError" && !marcas.has(e) ? erroLigacao(e) : null;
      if (lig) { terminarComSintaxe(lig); return; }
      if (e && e.name === "SyntaxError" && !marcas.has(e) && !(e instanceof Error && posicoes.has(e) && framesUsuario(e))) {
        segurar();
        if (erroCJS) { erroSintaxe(erroCJS, arq, false).then(terminarComSintaxe); return; }
        var qual = acharArquivoComErroSintaxe(e);
        erroSintaxe(e, qual || arq, true).then(terminarComSintaxe);
        return;
      }
      naoTratado(e, false, true);
    });
    talvezFim();
  }
  function framesUsuario(e) { var cs = posicoes.get(e); return cs && cs.some(function (c) { var f = c.getFileName && c.getFileName(); return f && arquivosInfo[f]; }); }
  function acharArquivoComErroSintaxe() {
    // o 1º módulo (na ordem de carga) que não compila como script de módulo
    var lista = Object.keys(urlsESM);
    return lista.length ? lista[lista.length - 1] : null;
  }
  // a posição (linha, coluna) está antes do fim da instrução do 1º await do topo do módulo?
  function antesDoAwait(info, lin, col) {
    var c = fontes[info.caminho] || "";
    if (info.fimSync === undefined) {
      var i = indiceAwaitTopo(c);
      if (i < 0) info.fimSync = Infinity;
      else { var f = c.slice(i).search(/;|\n/); info.fimSync = f < 0 ? c.length : i + f; }
    }
    var linhas = c.split("\n"), off = 0;
    for (var k = 0; k < lin - 1 && k < linhas.length; k++) off += linhas[k].length + 1;
    return off + col - 1 < info.fimSync;
  }
  function indiceAwaitTopo(c) {
    var s = c.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, function (t) { return t.replace(/[^\n]/g, " "); });
    var pilha = [], re = /[{}]|\bawait\b|=>|\bfunction\b/g, m, func = false, pend = false;
    while ((m = re.exec(s))) {
      if (m[0] === "=>" || m[0] === "function") { pend = true; continue; }
      if (m[0] === "{") { pilha.push(pend); pend = false; continue; }
      if (m[0] === "}") { pilha.pop(); continue; }
      if (pilha.indexOf(true) < 0 && !pend) return m.index;
    }
    return -1;
  }
  function temAwaitNoTopo(c) {
    var s = c.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g, "\"\"");
    var prof = 0, i, re = /[{}]|\bawait\b|\bfor\s+await\b/g, m;
    var funcoes = [];
    while ((m = re.exec(s))) {
      if (m[0] === "{") { prof++; continue; }
      if (m[0] === "}") { prof--; continue; }
      if (prof === 0) return true;
      // await dentro de um bloco no topo (if/for) também conta; dentro de função não
      var antes = s.slice(0, m.index);
      var abre = antes.lastIndexOf("{");
      var cab = antes.slice(Math.max(0, abre - 120), abre);
      if (!/(=>\s*|function\b[^{]*|\)\s*)$/.test(cab.replace(/\s+$/, "")) || /\b(if|for|while|else|try|catch|finally|do|switch)\b[^{]*$/.test(cab)) {
        if (prof === 1 && !/(=>|function\b[^(]*\([^)]*\))\s*$/.test(cab.replace(/\s+$/, ""))) return true;
      }
    }
    return false;
  }

  function iniciar(r) {
    req = r;
    interativo = r.stdin === null || r.stdin === undefined;
    stdinBuf = interativo ? "" : String(r.stdin);
    var arqs = r.arquivos || [];
    arqs.forEach(function (a) {
      var p = path.resolve(HOME, a.nome);
      var d = path.dirname(p);
      var cam = "";
      d.split("/").filter(Boolean).forEach(function (s) { cam += "/" + s; vfs.dir[cam] = true; });
      vfs.arq[p] = enc.encode(a.codigo);
      vfs.mtime[p] = inicio;
    });
    var principal = path.resolve(HOME, arqs.length ? arqs[0].nome : "main.js");
    process.argv = ["/usr/local/bin/node", principal].concat(r.args || []);
    process.stdin = new Stdin();
    process.stdout = new Stdout(1);
    process.stderr = new Stdout(2);
    instalarGlobais();
    if (r.repl) { iniciarRepl(r); return; }
    var t = tipoModulo(principal);
    if (t === "esm") { rodarESM(principal); return; }
    try {
      jsNodePrincipal(principal);
    } catch (e) {
      if (e === SAIR) return;
      if (e && e.name === "SyntaxError" && e.jsNodeArquivo) {
        if (e.jsNodeArquivo === principal && t === "auto" && ESM_ERROS.test(e.message)) { detectados[principal] = "esm"; delete cacheCJS[principal]; rodarESM(principal, /^await is only valid/.test(e.message) ? e : null); return; }
        segurar();
        erroSintaxe(e, e.jsNodeArquivo, false).then(terminarComSintaxe);
        return;
      }
      naoTratado(e, false);
      return;
    }
    talvezFim();
  }

  // posição do 1º erro num texto JSON (onde o V8 para), ou null se o texto é válido
  function posErroJson(s) {
    var i = 0;
    function ws() { while (i < s.length && " \t\n\r".indexOf(s[i]) >= 0) i++; }
    function falha() { throw { pos: i }; }
    function str() {
      i++;
      while (i < s.length && s[i] !== '"') { if (s[i] === "\\") i++; else if (s.charCodeAt(i) < 32) falha(); i++; }
      if (i >= s.length) falha();
      i++;
    }
    function valor() {
      ws();
      var c = s[i];
      if (c === "{") {
        i++; ws(); if (s[i] === "}") { i++; return; }
        for (;;) { ws(); if (s[i] !== '"') falha(); str(); ws(); if (s[i] !== ":") falha(); i++; valor(); ws(); if (s[i] === ",") { i++; continue; } if (s[i] === "}") { i++; return; } falha(); }
      }
      if (c === "[") {
        i++; ws(); if (s[i] === "]") { i++; return; }
        for (;;) { valor(); ws(); if (s[i] === ",") { i++; continue; } if (s[i] === "]") { i++; return; } falha(); }
      }
      if (c === '"') { str(); return; }
      var re = /-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/y; re.lastIndex = i;
      if ((c === "-" || (c >= "0" && c <= "9")) && re.exec(s)) { i = re.lastIndex; return; }
      var ps = ["true", "false", "null"];
      for (var k = 0; k < ps.length; k++) if (s.substr(i, ps[k].length) === ps[k]) { i += ps[k].length; return; }
      falha();
    }
    try { valor(); ws(); if (i < s.length) falha(); return null; } catch (e) { return e && typeof e.pos === "number" ? e.pos : null; }
  }

  /* ------------------------------------------------------------ idioma da Ana (pt-BR) */
  // O lab roda com LANG=pt_BR.UTF-8: o Node usa pt-BR quando o programa não diz o idioma.
  // O navegador do leitor pode estar em outro idioma: aqui o padrão vira pt-BR, como no lab.
  var IDIOMA = "pt-BR";
  function instalarIdioma() {
    try { if (new Intl.DateTimeFormat().resolvedOptions().locale === IDIOMA) return; } catch (e) { return; }
    ["DateTimeFormat", "NumberFormat", "Collator", "PluralRules", "RelativeTimeFormat", "ListFormat", "DisplayNames", "Segmenter"].forEach(function (k) {
      var C = Intl[k];
      if (typeof C !== "function") return;
      var P = new Proxy(C, {
        construct: function (alvo, args, novo) { args = Array.prototype.slice.call(args); if (args[0] === undefined) args[0] = IDIOMA; return Reflect.construct(alvo, args, novo === P ? alvo : novo); },
        apply: function (alvo, este, args) { args = Array.prototype.slice.call(args); if (args[0] === undefined) args[0] = IDIOMA; return Reflect.apply(alvo, este, args); },
      });
      try { Object.defineProperty(Intl, k, { value: P, writable: true, configurable: true, enumerable: false }); } catch (e) {}
    });
    function trocar(proto, nome) {
      var orig = proto[nome];
      if (typeof orig !== "function") return;
      var f = { [nome]: function (loc) { var a = Array.prototype.slice.call(arguments); if (a[0] === undefined) a[0] = IDIOMA; return orig.apply(this, a); } }[nome];
      try { Object.defineProperty(proto, nome, { value: f, writable: true, configurable: true, enumerable: false }); } catch (e) {}
    }
    trocar(Date.prototype, "toLocaleString"); trocar(Date.prototype, "toLocaleDateString"); trocar(Date.prototype, "toLocaleTimeString");
    trocar(Number.prototype, "toLocaleString"); trocar(BigInt.prototype, "toLocaleString"); trocar(Array.prototype, "toLocaleString");
    trocar(String.prototype, "toLocaleUpperCase"); trocar(String.prototype, "toLocaleLowerCase");
    var lc = String.prototype.localeCompare;
    Object.defineProperty(String.prototype, "localeCompare", { value: function localeCompare(o, loc, opc) { return lc.call(this, o, loc === undefined ? IDIOMA : loc, opc); }, writable: true, configurable: true, enumerable: false });
    // "GMT-0300 (Brasilia Standard Time)" → "GMT-0300 (Horário Padrão de Brasília)"
    var ts = Date.prototype.toString;
    function nomeFuso(d) { try { var p = new Intl.DateTimeFormat(IDIOMA, { timeZoneName: "long" }).formatToParts(d); for (var i = 0; i < p.length; i++) if (p[i].type === "timeZoneName") return p[i].value; } catch (e) {} return null; }
    Object.defineProperty(Date.prototype, "toString", { value: function toString() { var s = ts.call(this); var n = nomeFuso(this); return n ? s.replace(/\([^()]*\)$/, "(" + n + ")") : s; }, writable: true, configurable: true, enumerable: false });
    var tts = Date.prototype.toTimeString;
    Object.defineProperty(Date.prototype, "toTimeString", { value: function toTimeString() { var s = tts.call(this); var n = nomeFuso(this); return n ? s.replace(/\([^()]*\)$/, "(" + n + ")") : s; }, writable: true, configurable: true, enumerable: false });
  }

  /* ------------------------------------------------------------ globais do Node */
  // o que o Chrome tem e o Node 24 não tem (lista gerada comparando o lab com o Chromium 155):
  // some, para "x is not a function"/"x is not defined" sair como no Node
  var SO_NO_NAVEGADOR = ["Date.prototype.toTemporalInstant","Intl.v8BreakIterator","Iterator.concat","Iterator.prototype.includes","Iterator.prototype.join","Iterator.zip","Iterator.zipKeyed","Map.prototype.getOrInsert","Map.prototype.getOrInsertComputed","Math.sumPrecise","Uint8Array.fromBase64","Uint8Array.fromHex","Uint8Array.prototype.setFromBase64","Uint8Array.prototype.setFromHex","Uint8Array.prototype.toBase64","Uint8Array.prototype.toHex","global.AudioData","global.AudioDecoder","global.AudioEncoder","global.BackgroundFetchManager","global.BackgroundFetchRecord","global.BackgroundFetchRegistration","global.CSSKeywordValue","global.CSSMathClamp","global.CSSMathInvert","global.CSSMathMax","global.CSSMathMin","global.CSSMathNegate","global.CSSMathProduct","global.CSSMathSum","global.CSSMathValue","global.CSSNumericArray","global.CSSNumericValue","global.CSSSkewX","global.CSSSkewY","global.CSSStyleValue","global.CSSUnitValue","global.CSSUnparsedValue","global.Cache","global.CacheStorage","global.CanvasGradient","global.CanvasPattern","global.CreateMonitor","global.CropTarget","global.DOMMatrix","global.DOMMatrixReadOnly","global.DOMPoint","global.DOMPointReadOnly","global.DOMQuad","global.DOMRect","global.DOMRectReadOnly","global.DOMStringList","global.DedicatedWorkerGlobalScope","global.EncodedAudioChunk","global.EncodedVideoChunk","global.ErrorEvent","global.EventSource","global.FileList","global.FileReader","global.FileReaderSync","global.FileSystemDirectoryHandle","global.FileSystemFileHandle","global.FileSystemHandle","global.FileSystemObserver","global.FileSystemSyncAccessHandle","global.FileSystemWritableFileStream","global.FontFace","global.FontFaceSet","global.GPU","global.GPUAdapter","global.GPUAdapterInfo","global.GPUBindGroup","global.GPUBindGroupLayout","global.GPUBuffer","global.GPUBufferUsage","global.GPUCanvasContext","global.GPUColorWrite","global.GPUCommandBuffer","global.GPUCommandEncoder","global.GPUCompilationInfo","global.GPUCompilationMessage","global.GPUComputePassEncoder","global.GPUComputePipeline","global.GPUDevice","global.GPUDeviceLostInfo","global.GPUError","global.GPUExternalTexture","global.GPUInternalError","global.GPUMapMode","global.GPUOutOfMemoryError","global.GPUPipelineError","global.GPUPipelineLayout","global.GPUQuerySet","global.GPUQueue","global.GPURenderBundle","global.GPURenderBundleEncoder","global.GPURenderPassEncoder","global.GPURenderPipeline","global.GPUSampler","global.GPUShaderModule","global.GPUShaderStage","global.GPUSupportedFeatures","global.GPUSupportedLimits","global.GPUTexture","global.GPUTextureUsage","global.GPUTextureView","global.GPUUncapturedErrorEvent","global.GPUValidationError","global.HID","global.HIDConnectionEvent","global.HIDDevice","global.HIDInputReportEvent","global.IDBCursor","global.IDBCursorWithValue","global.IDBDatabase","global.IDBFactory","global.IDBIndex","global.IDBKeyRange","global.IDBObjectStore","global.IDBOpenDBRequest","global.IDBRecord","global.IDBRequest","global.IDBTransaction","global.IDBVersionChangeEvent","global.IdleDetector","global.ImageBitmap","global.ImageBitmapRenderingContext","global.ImageData","global.ImageDecoder","global.ImageTrack","global.ImageTrackList","global.Lock","global.LockManager","global.MediaCapabilities","global.MediaSource","global.MediaSourceHandle","global.NavigationPreloadManager","global.NavigatorUAData","global.NetworkInformation","global.Notification","global.Observable","global.OffscreenCanvas","global.OffscreenCanvasRenderingContext2D","global.Origin","global.Path2D","global.PerformanceServerTiming","global.PeriodicSyncManager","global.PermissionStatus","global.Permissions","global.PressureObserver","global.PressureRecord","global.ProgressEvent","global.PromiseRejectionEvent","global.PushManager","global.PushSubscription","global.PushSubscriptionOptions","global.QuotaExceededError","global.RTCDataChannel","global.RTCEncodedAudioFrame","global.RTCEncodedVideoFrame","global.RTCRtpScriptTransformer","global.RTCTransformEvent","global.ReportBody","global.ReportingObserver","global.RestrictionTarget","global.Scheduler","global.SecurityPolicyViolationEvent","global.Serial","global.SerialPort","global.ServiceWorkerRegistration","global.SourceBuffer","global.SourceBufferList","global.StorageBucket","global.StorageBucketManager","global.StorageManager","global.Subscriber","global.SyncManager","global.TaskController","global.TaskPriorityChangeEvent","global.TaskSignal","global.Temporal","global.TextMetrics","global.TrustedHTML","global.TrustedScript","global.TrustedScriptURL","global.TrustedTypePolicy","global.TrustedTypePolicyFactory","global.USB","global.USBAlternateInterface","global.USBConfiguration","global.USBConnectionEvent","global.USBDevice","global.USBEndpoint","global.USBInTransferResult","global.USBInterface","global.USBIsochronousInTransferPacket","global.USBIsochronousInTransferResult","global.USBIsochronousOutTransferPacket","global.USBIsochronousOutTransferResult","global.USBOutTransferResult","global.UserActivation","global.VideoColorSpace","global.VideoDecoder","global.VideoEncoder","global.VideoFrame","global.WGSLLanguageFeatures","global.WebGL2RenderingContext","global.WebGLActiveInfo","global.WebGLBuffer","global.WebGLContextEvent","global.WebGLFramebuffer","global.WebGLObject","global.WebGLProgram","global.WebGLQuery","global.WebGLRenderbuffer","global.WebGLRenderingContext","global.WebGLSampler","global.WebGLShader","global.WebGLShaderPrecisionFormat","global.WebGLSync","global.WebGLTexture","global.WebGLTransformFeedback","global.WebGLUniformLocation","global.WebGLVertexArrayObject","global.WebSocketError","global.WebSocketStream","global.WebTransport","global.WebTransportBidirectionalStream","global.WebTransportDatagramDuplexStream","global.WebTransportError","global.Worker","global.WorkerGlobalScope","global.WorkerLocation","global.WorkerNavigator","global.XMLHttpRequest","global.XMLHttpRequestEventTarget","global.XMLHttpRequestUpload","global.cancelAnimationFrame","global.close","global.importScripts","global.location","global.name","global.onerror","global.onlanguagechange","global.onmessage","global.onmessageerror","global.onoffline","global.ononline","global.onrejectionhandled","global.onrtctransform","global.onunhandledrejection","global.postMessage","global.requestAnimationFrame","global.self","global.webkitRequestFileSystem","global.webkitRequestFileSystemSync","global.webkitResolveLocalFileSystemSyncURL","global.webkitResolveLocalFileSystemURL"];
  function esconderExtras() {
    SO_NO_NAVEGADOR.forEach(function (k) {
      var p = k.split("."), dono = p[0] === "global" ? G : G[p[0]];
      if (!dono) return;
      if (p[1] === "prototype" && p.length === 3) { dono = dono.prototype; p = [p[0], p[2]]; }
      try { delete dono[p[1]]; } catch (e) {}
    });
  }
  function instalarGlobais() {
    esconderExtras();
    var ocultar = ["postMessage", "importScripts", "onmessage", "onmessageerror", "close", "WorkerGlobalScope", "DedicatedWorkerGlobalScope", "location", "WorkerLocation", "WorkerNavigator", "onerror", "onunhandledrejection", "onrejectionhandled", "onlanguagechange", "onoffline", "ononline", "requestAnimationFrame", "cancelAnimationFrame", "name"];
    ocultar.forEach(function (k) { try { Object.defineProperty(G, k, { value: undefined, configurable: true, writable: true, enumerable: false }); } catch (e) {} });
    var defs = {
      global: G, process: process, Buffer: Buffer, console: consoleNode,
      setTimeout: setTimeout_, setInterval: setInterval_, clearTimeout: limpar, clearInterval: limpar,
      setImmediate: setImmediate_, clearImmediate: clearImmediate_,
      navigator: { hardwareConcurrency: 8, language: "pt-BR", languages: ["pt-BR"], platform: "linux", userAgent: "Node.js/24", onLine: true },
    };
    if (nFetch) defs.fetch = function fetch(a, b) {
      segurar();
      var p = nFetch(a, b);
      p.then(function () { soltar(); }, function () { soltar(); });
      return p.then(function (r) {
        // ler o corpo (json, text…) também segura o programa, como no Node
        ["json", "text", "arrayBuffer", "blob", "formData", "bytes"].forEach(function (k) {
          var orig = r[k];
          if (typeof orig !== "function") return;
          Object.defineProperty(r, k, { configurable: true, writable: true, value: function () {
            segurar();
            var q = orig.apply(r, arguments);
            q.then(function () { soltar(); }, function () { soltar(); });
            return q;
          } });
        });
        return r;
      }, function (e) {
        var x = new TypeError("fetch failed");
        x.cause = e; marcas.set(x, { topo: ["node:internal/deps/undici/undici:15845:13"], semUsuario: true, cab: "node:internal/deps/undici/undici:15845\n    Error.captureStackTrace(err);\n          ^\n\n" });
        throw x;
      });
    };
    Object.keys(defs).forEach(function (k) { try { Object.defineProperty(G, k, { value: defs[k], configurable: true, writable: true, enumerable: k === "global" ? false : false }); } catch (e) { G[k] = defs[k]; } });
    try { Object.defineProperty(G, "self", { value: undefined, configurable: true, writable: true, enumerable: false }); } catch (e) {}
    instalarIdioma();
    // JSON.parse com erro: o Node mostra a linha do TEXTO JSON (<anonymous_script>:1) no cabeçalho
    var nParse = JSON.parse;
    var parse = function parse(t, rev) {
      try { return arguments.length > 1 ? nParse.call(JSON, t, rev) : nParse.call(JSON, t); }
      catch (e) {
        if (e instanceof SyntaxError) {
          try {
            var txt = String(t), pos = posErroJson(txt);
            if (pos === null) pos = 0;
            var antes = txt.slice(0, pos).split("\n"), lin = antes.length, col = antes[antes.length - 1].length + 1;
            var linha = txt.split("\n")[lin - 1] || "";
            marcas.set(e, { cab: "<anonymous_script>:" + lin + "\n" + linha + "\n" + (col <= linha.length ? espacos(col - 1) + "^\n" : "") + "\n" });
          } catch (x) {}
        }
        throw e;
      }
    };
    try { Object.defineProperty(JSON, "parse", { value: parse, writable: true, configurable: true, enumerable: false }); } catch (e) {}
    // o estado das Promises (para o console.log(promessa): Promise { 5 } / Promise { <pending> })
    var estados = new WeakMap();
    G.__jsNodePromessa = function (p) { return estados.get(p) || null; };
    try { Object.defineProperty(G, "__jsNodePromessa", { enumerable: false }); } catch (e) {}
    var pr = NativePromise.resolve, rj = NativePromise.reject;
    NativePromise.resolve = function (v) {
      var p = pr.call(this, v);
      if (p !== v && !(v && typeof v.then === "function")) estados.set(p, [1, v]);
      return p;
    };
    NativePromise.reject = function (v) { var p = rj.call(this, v); estados.set(p, [2, v]); return p; };
    var Prom = new Proxy(NativePromise, {
      construct: function (alvo, args, novo) {
        var ex = args[0];
        if (typeof ex !== "function") return Reflect.construct(alvo, args, novo);
        var p, adiado = null;
        p = Reflect.construct(alvo, [function (ok, falha) {
          return ex(function (v) { if (p && !estados.has(p) && !(v && typeof v.then === "function")) estados.set(p, [1, v]); else if (!p) adiado = [1, v]; ok(v); },
                    function (e) { if (p && !estados.has(p)) estados.set(p, [2, e]); else if (!p) adiado = [2, e]; falha(e); });
        }], novo);
        if (adiado) estados.set(p, adiado);
        return p;
      },
    });
    try { Object.defineProperty(G, "Promise", { value: Prom, configurable: true, writable: true, enumerable: false }); } catch (e) {}
  }

  /* ------------------------------------------------------------ REPL (node sem arquivo) */
  // Cada entrada vira um "arquivo" REPL1, REPL2… (como no Node). let/const/class do topo
  // ficam no escopo global (um script de verdade, via importScripts); o resto é avaliado com
  // eval indireto (que devolve o valor da última expressão, como o REPL mostra).
  var replN = 0, replBuffer = "", replRl = null;
  function iniciarRepl(r) {
    modoExec = "repl";
    escrever("out", "Welcome to Node.js " + NODE_VERSAO + ".\nType \".help\" for more information.\n");
    if (r.repl !== "so" && r.arquivos && r.arquivos.length && r.arquivos[0].codigo.trim()) {
      // node não roda um arquivo e fica no "> ": o editor faz ".load main.js"
      var cod = r.arquivos[0].codigo;
      escrever("out", "> .load " + r.arquivos[0].nome + "\n");
      cod.replace(/\n$/, "").split("\n").forEach(function (l, i) { escrever("out", (i ? "| " : "") + l + "\n"); });
      var v = avaliarRepl(cod, true);
      if (v !== "continua") mostrarValor(v);
    }
    promptRepl();
    replRl = readline.createInterface({ input: process.stdin, output: null });
    replRl.on("line", function (l) { linhaRepl(l); });
    replRl.on("close", function () { escrever("out", "\n"); sair(0); });
  }
  function promptRepl() { escrever("out", replBuffer ? "| " : "> "); }
  function linhaRepl(l) {
    if (!replBuffer && /^\s*\.\w/.test(l)) {
      var cmd = l.trim().split(/\s+/)[0];
      if (cmd === ".exit") { sair(0); throw SAIR; }
      if (cmd === ".help") { escrever("out", ".break    Sometimes you get stuck, this gets you out\n.clear    Alias for .break\n.editor   Enter editor mode\n.exit     Exit the REPL\n.help     Print this help message\n.load     Load JS from a file into the REPL session\n.save     Save all evaluated commands in this REPL session to a file\n\nPress Ctrl+C to abort current expression, Ctrl+D to exit the REPL\n"); promptRepl(); return; }
      if (cmd === ".break" || cmd === ".clear") { replBuffer = ""; promptRepl(); return; }
      escrever("out", "Invalid REPL keyword\n"); promptRepl(); return;
    }
    if (replBuffer && /^\s*\.break\s*$/.test(l)) { replBuffer = ""; promptRepl(); return; }
    var cod = replBuffer + l;
    if (!cod.trim()) { replBuffer = ""; promptRepl(); return; }
    var v = avaliarRepl(cod, false);
    if (v === "continua") { replBuffer = cod + "\n"; promptRepl(); return; }
    replBuffer = "";
    if (v && v.assincrono) {
      v.promessa.then(function (x) { mostrarValor(x); promptRepl(); });
      return;
    }
    mostrarValor(v);
    promptRepl();
  }
  function mostrarValor(v) {
    if (!v || v.erro) return;
    try { G._ = v.valor; } catch (e) {}
    escrever("out", U.inspect(v.valor) + "\n");
  }
  function mostrarErroRepl(e) {
    if (e === SAIR) throw e;
    var txt;
    if (e instanceof Error || (e && typeof e === "object" && typeof e.stack === "string")) {
      var linhas = String(e.stack).split("\n"), cab = [], fr = [];
      for (var i = 0; i < linhas.length; i++) {
        if (/^\s+at /.test(linhas[i])) { if (/\(REPL\d+:\d+:\d+\)$/.test(linhas[i])) fr.push(linhas[i]); else if (/^\s+at REPL\d+:/.test(linhas[i])) break; }
        else if (!fr.length) cab.push(linhas[i]);
      }
      var corpo = cab.join("\n") + (fr.length ? "\n" + fr.join("\n") : "");
      try {
        var resto = U.inspect(e).replace(String(e.stack), "");
        txt = "Uncaught " + corpo + (resto.indexOf("{") === 1 ? resto : "");
      } catch (x) { txt = "Uncaught " + corpo; }
    } else txt = "Uncaught " + U.inspect(e);
    escrever("err", txt + "\n");
  }
  function msgSintaxe(e) { return String(e && e.message || "").replace(/^Failed to execute 'importScripts' on 'WorkerGlobalScope': /, ""); }
  function avaliarRepl(cod, silencioso) {
    var nome = "REPL" + (++replN);
    var lexico = /(^|[;\n])\s*(let|const|class)\s/.test(cod) && !/^\s*\{/.test(cod);
    var temAwait = /\bawait\b/.test(cod);
    // { a: 1 } é um objeto no REPL (o Node tenta primeiro com parênteses)
    if (/^\s*\{/.test(cod) && !/;\s*$/.test(cod)) {
      try { new Function("return (" + cod + "\n)"); return rodarEval("(" + cod + "\n)", nome); } catch (e) { if (!(e instanceof SyntaxError)) return rodarEval("(" + cod + "\n)", nome); }
    }
    if (temAwait && !lexico) {
      try { new Function("return async () => (" + cod + "\n)"); }
      catch (e) {
        try { new Function("return async () => {" + cod + "\n}"); } catch (e2) { return erroSintaxeRepl(e2, cod); }
        return { assincrono: true, promessa: rodarEval("(async () => {" + cod + "\n})()", nome).valor.then(function () { return { valor: undefined }; }, function (x) { mostrarErroRepl(x); return { erro: true }; }) };
      }
      var r0 = rodarEval("(async () => (" + cod + "\n))()", nome);
      if (r0.erro) return r0;
      return { assincrono: true, promessa: r0.valor.then(function (v) { return { valor: v }; }, function (x) { mostrarErroRepl(x); return { erro: true }; }) };
    }
    if (lexico) {
      var url = urlDe(cod + "\n//# sourceURL=" + nome);
      arquivosInfo[url] = { caminho: nome, mostrar: nome, linha1: 0, repl: true, fonte: cod };
      try { nImportScripts(url); }
      catch (e) {
        if (e === SAIR) throw e;
        if (e && e.name === "SyntaxError") return erroSintaxeRepl(e, cod);
        mostrarErroRepl(e); return { erro: true };
      }
      return { valor: undefined };
    }
    return rodarEval(cod, nome);
  }
  function erroSintaxeRepl(e, cod) {
    var msg = msgSintaxe(e);
    if (/^(Unexpected end of input|Unterminated template literal|missing \) after argument list|Unterminated string constant)$/.test(msg) && /[\[{(,=+\-*/`]\s*$|^[^"'`]*`[^`]*$/.test(cod.replace(/\s+$/, "") + (msg === "Unexpected end of input" ? "," : ""))) return "continua";
    escrever("err", "Uncaught SyntaxError: " + msg + "\n");
    return { erro: true };
  }
  function rodarEval(cod, nome) {
    fontes[nome] = cod;
    try {
      var v = (0, eval)(cod + "\n//# sourceURL=" + nome);
      return { valor: v };
    } catch (e) {
      if (e === SAIR) throw e;
      if (e && e.name === "SyntaxError" && !(posicoes.has(e) && framesUsuario(e))) return erroSintaxeRepl(e, cod);
      mostrarErroRepl(e);
      return { erro: true };
    }
  }

  /* ------------------------------------------------------------ eventos do worker */
  G.addEventListener("error", function (ev) {
    if (ev.preventDefault) ev.preventDefault();
    if (encerrado) return;
    var e = ev.error;
    if (e === SAIR) return;
    naoTratado(e === undefined ? new Error(ev.message) : e, false);
  });
  G.addEventListener("unhandledrejection", function (ev) {
    if (ev.preventDefault) ev.preventDefault();
    if (encerrado) return;
    if (ev.reason === SAIR) return;
    naoTratado(ev.reason, true);
  });
  G.addEventListener("message", function (ev) {
    var m = ev.data;
    if (m.op === "executar") { try { iniciar(m.req); } catch (e) { if (e !== SAIR) { postar({ ev: "falha", msg: String(e && e.stack || e) }); } } }
    else if (m.op === "entrada") receberEntrada(m.texto);
    else if (m.op === "eof") receberEof();
  });
  postar({ ev: "pronto", info: { node: NODE_VERSAO, motor: ehV8 ? "v8" : "outro" } });
})();
