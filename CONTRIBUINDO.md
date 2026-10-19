# Como escrever uma página do Guia JavaScript

O guia é uma **escola**, estilo W3Schools, para quem **nunca programou**. **Uma aula = um assunto.** O dono do projeto já reclamou de outro guia que juntava vários assuntos numa página. Nunca mostre código "seco":
- explique cada parte (anatomia);
- mostre a **saída real**, colhida no Node.js de verdade (laboratório) ou no navegador de verdade;
- mostre o que acontece quando dá errado, com a mensagem **real**;
- deixe o leitor praticar no editor do guia, que roda **o JavaScript de verdade** do navegador.

Antes de tudo, leia o `RECURSOS.md`: onde trabalhar (VPS) e como.

## 0. O que o guia ensina
- **A linguagem JavaScript** (ECMAScript 2025), com o **Node.js 24 LTS** no terminal (`node main.js`) nos níveis 1 e 2. É o mais simples para quem começa: um arquivo, um comando, a saída no terminal.
- **O navegador** (DOM, eventos, `localStorage`, `prompt`/`alert`) nas aulas do grupo "A Página Web" e nos projetos `-web`, com a caixa `.tryweb`.
- O que é **só do Node** (`fs`, `process`, `require`, `npm`) ou **só do navegador** (`document`, `window`, `alert`) é dito com clareza na aula.
- Node.js 26 sai como LTS no fim de outubro de 2026: cite em `versoes.html`/`novidades.html`, não ensine como padrão.

## 1. Esqueleto do arquivo
Use como modelo uma aula do Guia Lua, por exemplo `~/guia-lua/print.html` e `~/guia-lua/while.html` (na VPS): cabeçalho, `<main>`, blocos, rodapé, `.exercise`, `.mc`, `dl.anatomy`, `div.cenario`, `div.note`, `table.ref`. Troque:
- `<title>JavaScript TEMA — descrição | Guia JavaScript</title>`;
- `<h1>JavaScript <span class="hl">TEMA</span></h1>`;
- a caixa `.trylua` por **`.tryjs`** ou **`.tryweb`** (seção 3), `main.lua` por `main.js`, `lua` por `node`.

Menu, selo e Anterior/Próximo vêm de `assets/site.js` (`NIVEIS`). **Não mude a `NIVEIS`.** Links internos só para páginas que estão nela.

## 2. Ordem de uma aula
1. Intro.
2. "Você vai aprender".
3. A ideia antes do código, com uma comparação do dia a dia (uma receita de bolo, uma caixa com etiqueta, uma lista de compras).
4. Do simples ao completo, uma novidade por vez, com `dl.anatomy` ou uma tabela "parte → o que faz".
5. **A saída real** depois de cada exemplo: `pre.term` com `$ node arquivo.js` (ou o `> ` do modo interativo) e o que o Node respondeu no lab.
6. **Pelo menos dois "Experimente"** (`.tryjs`/`.tryweb`) por aula: um no meio e uma missão no fim.
7. Formas diferentes de fazer a mesma coisa + tabela "qual usar".
8. **Quando dá errado** (`div.cenario`): o código errado e a **mensagem de erro real** (colha no lab, nunca de memória), explicada linha por linha em português (o caminho `/home/ana/main.js:3`, a linha do código, o `^`, `ReferenceError: x is not defined`, o `at …`, o `Node.js v24…`).
9. Referência (`table.ref`).
10. Exercícios (3 ou mais: `.exercise`, `.mc`).
11. Resumo.

Páginas de **Projetos**: passo a passo (versão 1, 2, 3… do programa, cada uma com um "Experimente"). Páginas de **Referência**: tabelas, com poucos "Experimente" (1 ou 2).

## 3. Componentes

### Código para ler
```html
<pre class="file" data-file="ola.js">const nome = "Ana";
console.log(`Olá, ${nome}!`);
</pre>
```
Dentro de `<pre>` e de atributos, escape `<`, `>` e `&` (`&lt;`, `&gt;`, `&amp;`; e `&quot;` em atributos): `if (x &lt; 10)`, `a &amp;&amp; b`, `() =&gt; 1`, `&lt;button&gt;`. O testador confere.

### Terminal (`pre.term`)
- `$ ` = `ana@notebook:~$` (o prompt aparece sozinho);
- `> ` e `... ` = o modo interativo do Node e a continuação dele — **só depois de uma linha `$ node`** (sem arquivo) ou `$ node -i`; o site destaca como prompt até o próximo `$ `;
- `> ` logo depois de um comando do bash (fora do modo interativo) = continuação do bash (heredoc);
- `«` = anotação (vira um comentário em cinza à direita).

Toda saída vem do lab. Exemplo:
```html
<pre class="term">$ node ola.js
Olá, Ana!
</pre>
```

### Console do navegador (`pre.devtools`)
Para mostrar o que aparece no Console do navegador (F12): linhas que começam com `> ` são o que a pessoa digitou; as outras, a resposta. Use só nas aulas do navegador; a saída vem do Chromium do lab (veja `COMO-USAR.md` do lab) ou fica marcada como ilustrativa.

### Editor "Experimente" de programa (`.tryjs`): imita o `node main.js`
```html
<div class="tryjs" data-goal="out:Olá, Ana!">
<p class="try-task"><strong>Missão:</strong> troque "mundo" por "Ana" e clique em Rodar.</p>
<pre class="script" data-file="main.js">console.log("Olá, mundo!");
</pre>
<pre class="solucao" data-file="main.js">console.log("Olá, Ana!");
</pre>
</div>
```
- **Rodar** executa o código com o **JavaScript do próprio navegador** (no Chrome/Edge é o mesmo motor V8 do Node), num ambiente que imita o Node: `console.log` escreve como o Node escreve (`{ nome: 'Ana', idade: 30 }`, `[ 1, 2, 3 ]`), um erro não tratado sai como no Node, e há `process.argv`, `process.exit`, `require`/`import` das abas, `node:fs` (numa pasta só da caixa), `node:readline`… A lista exata do que funciona fica na §4.
- **Vários arquivos** (módulo próprio, `.txt`, `.json`, `.csv`): vários `<pre class="script" data-file="…">` na mesma caixa viram abas; o primeiro é o que roda (`node main.js`), os outros ficam na pasta do programa (`import { soma } from "./contas.js"` acha `contas.js`).
- `data-stdin="linha1\nlinha2"`: o que a entrada padrão (o teclado) vai entregar. Sem `data-stdin`, o programa **pede e o leitor digita** no terminal da caixa.
- `data-args="a b"`: o que chega em `process.argv[2]`, `process.argv[3]`…
- `data-repl`: o **modo interativo** do Node (`> `). Sem `pre.script` é sempre caixa livre (sem `data-goal`). Ponha em `data-digitar="1 + 1\nlet x = 10"` o que o testador deve digitar.
- `data-digitar="Bia\n30"`: o que o testador digita quando o programa pede (o leitor digita de verdade no editor).
- `data-sem-fim`: laço infinito de propósito (para mostrar o ■ Parar); o testador confere que não termina.
- Sem `data-goal`: caixa livre. Com `data-goal`: missão, e o `pre.solucao` é **obrigatório** (um por aba que muda).
- Cada Rodar parte do zero.

### Editor "Experimente" de página (`.tryweb`): HTML + CSS + JS no navegador
```html
<div class="tryweb" data-goal="texto:#saida~Olá, Ana!;;semerro" data-acoes="clicar #botao">
<p class="try-task"><strong>Missão:</strong> faça o botão escrever "Olá, Ana!" no parágrafo.</p>
<pre class="script" data-file="index.html">&lt;button id="botao"&gt;Clique&lt;/button&gt;
&lt;p id="saida"&gt;&lt;/p&gt;
&lt;script src="script.js"&gt;&lt;/script&gt;
</pre>
<pre class="script" data-file="script.js">const botao = document.querySelector("#botao");
</pre>
<pre class="solucao" data-file="script.js">const botao = document.querySelector("#botao");
botao.addEventListener("click", () =&gt; {
  document.querySelector("#saida").textContent = "Olá, Ana!";
});
</pre>
</div>
```
- Abas: `index.html` (a primeira; é a página que abre), `script.js`, `style.css`, outras. **Rodar** abre a página num quadro **Resultado** e mostra embaixo um **Console** (o que o `console.log` escreveu e os erros não tratados, em vermelho).
- `data-acoes`: o que o **testador** faz na página antes de conferir as metas, separado por `;;`: `clicar SELETOR`, `digitar SELETOR TEXTO`, `tecla SELETOR Enter`, `esperar MS`, `responder TEXTO` (resposta para o próximo `prompt()`; `alert`/`confirm` são aceitos sozinhos). O leitor faz isso com o mouse e o teclado.
- No editor, a missão é conferida depois de Rodar e de novo a cada clique/tecla do leitor no Resultado.

### Metas (`data-goal`) — regras fixas, não invente outras
Várias metas se separam com **`;;`**; **todas** precisam passar.

| Meta | Caixa | Verdade quando… |
| --- | --- | --- |
| `out:TEXTO` | tryjs | a saída do programa (stdout e stderr, na ordem, como no terminal) **contém** o texto, exatamente |
| `outre:REGEX` | tryjs | a saída inteira casa com a regex |
| `console:TEXTO` | tryweb | o Console da caixa (o que `console.log`/`console.error` escreveram e os erros) **contém** o texto |
| `semerro` | as duas | terminou sem erro não tratado (nem de sintaxe, nem Promise rejeitada sem `catch`) |
| `erro:TEXTO` ou `erro:/REGEX/` | as duas | houve erro não tratado e a mensagem (`TypeError: x is not a function`) contém o texto (ou casa) |
| `exit:N` | tryjs | o código de saída foi N (`process.exit(N)`; erro não tratado = 1; normal = 0) |
| `src:REGEX` | as duas | o código do leitor (todas as abas) casa com a regex — para exigir um recurso: `src:\bfor\s*\(` |
| `arquivo:NOME` / `arquivo:NOME~TEXTO` | tryjs | depois de rodar, o arquivo NOME existe na pasta do programa (e contém o texto) |
| `dom:SELETOR` | tryweb | depois das ações, existe na página um elemento com esse seletor CSS |
| `texto:SELETOR~TEXTO` | tryweb | o `textContent` do primeiro elemento com esse seletor contém o texto |

**Regras exatas:**
- Regex é a do JavaScript. `outre:` aplica **sem flags** à saída inteira (`^`/`$` = começo e fim da saída toda; escreva `\n` para as quebras). `src:` aplica com a flag `m`. `erro:/…/` aceita flags (`/…/i`).
- Dentro de regex, `|` é alternativa e `\|` é a barra vertical literal. Não há outros escapes no `data-goal` além do HTML (`&quot;`, `&lt;`, `&gt;`, `&amp;`). O `data-goal` é decodificado antes de ser separado nos `;;`.
- `out:`/`outre:`/`console:` olham só o que o programa escreveu (e a mensagem de erro), nunca mensagens do editor.
- O **código inicial não pode cumprir a meta**, e a **solução tem de cumprir** (o testador confere os dois).
- **Prefira metas tolerantes** (`out:` com um trecho que só a resposta certa produz, `semerro`, `src:`) a um `outre:` que só aceita uma escrita exata.
- **A meta não pode depender** do que muda entre execuções ou entre o editor e o lab: `Math.random()`, data e hora (`new Date()`, `Date.now()`), tempo de execução, caminhos de pasta, a formatação de objetos muito grandes/aninhados (prefira `out:` de um trecho), a ordem de chaves numéricas × texto se não for a regra da linguagem.
- **Diferenças Node × navegador** (ex.: `console.log` de objeto no Console do Chrome é diferente do Node): a meta do `.tryjs` segue o Node; a do `.tryweb` segue o navegador.

### Outros blocos
`dl.anatomy`, `div.note/.tip/.warning/.cenario`, `ol.passo`, `div.table-wrap > table.ref`, `.exercise`, `.mc`, `figure`, `<span class="versao">ES2025</span>`.

No `.exercise`, `data-answer="a|b"` aceita respostas alternativas (a comparação é **exata**: `true` ≠ `True`). Para uma barra vertical dentro da resposta, escreva `\|`.

## 4. O editor do guia (`assets/jssim.js`)
> **Esta seção é mantida pelo agente do simulador.** Antes de escrever uma frase do tipo "no editor…" que não esteja aqui, confira com as ferramentas dele (`tools/sim.js`).

(em construção)

## 5. Fidelidade: o laboratório (`~/guia-js-lab/lab`, na VPS)
É a máquina da Ana (usuária `ana`, computador `notebook`, `/home/ana`, pt_BR, Ubuntu 26.04) com o **Node.js 24 LTS oficial**, o npm e um Chromium para o que é do navegador. Toda saída de terminal mostrada numa aula vem de lá (detalhes em `~/guia-js-lab/COMO-USAR.md`, na VPS):
- programa em arquivo: crie o `.js` na home da Ana e rode `node arquivo.js`;
- modo interativo (`> `): `-t` (terminal de verdade), passando a saída pelo `tela` (ver COMO-USAR);
- **as mensagens de erro saem em inglês** (`TypeError: Cannot read properties of undefined (reading 'nome')`): copie como saíram e explique em português;
- **Privacidade:** nada da máquina real nem da VPS; só `/home/ana/…`, `ana@notebook`.

## 6. Versão
O guia ensina o **JavaScript moderno** (ECMAScript 2025: `let`/`const`, arrow functions, classes, módulos, `async`/`await`, `?.`, `??`, `toSorted`, `Object.groupBy`, `Set` com `union`…) no **Node.js 24 LTS**. Recursos novos ficam marcados com `<span class="versao">ES2025</span>` (ou o ano) e reunidos em `novidades.html`. O `var`, o `==` e o `function` antigo aparecem para o leitor reconhecer em código antigo, com o porquê de evitar. Nunca afirme algo de uma versão sem conferir no lab ou na documentação oficial (MDN `developer.mozilla.org/pt-BR`, `nodejs.org/docs/latest-v24.x/api/`, `tc39.es`) — marque como **ilustrativo** o que não deu para rodar.

## 7. Escrita
- Português do Brasil, frases curtas, "você". O leitor nunca programou.
- Termos em inglês ganham tradução na primeira vez: `console.log` = "registrar no console", `if` = "se", `return` = "devolver", `function` = "função".
- Exemplos com a vida da Ana: a lista de compras, as notas da turma, o estoque da lojinha, a agenda, a padaria do bairro.
- Boas práticas desde o começo, sempre com o porquê: **`const` por padrão, `let` quando muda, nunca `var`**; **`===` sempre**; ponto e vírgula no fim das instruções; **2 espaços** de indentação; aspas duplas `"…"` nos textos (e crase nos templates); nomes em `camelCase` (`precoTotal`).
- Nomes de variáveis em português **sem acento** (`preco`, `quantidade`) — no JavaScript acento até funciona em nomes, mas evita problemas de teclado e de equipe; diga isso uma vez em `nomes-variaveis.html`.
