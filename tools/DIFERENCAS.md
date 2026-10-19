# Diferenças: editor do guia (navegador) × node do lab

Mantido pelo `tools/testar-missoes.js --nativo`. O editor roda o JavaScript **do navegador do
leitor** (no testador: Chromium headless, motor V8 como o do Node) num ambiente que imita o
`node main.js` (`assets/jssim/worker.js`); o lab (`~/guia-js-lab/lab`) roda o **Node.js v24.22.0
oficial** no Ubuntu 26.04. O testador roda o código inicial e a solução de cada caixa .tryjs nos dois,
com o mesmo stdin e os mesmos argumentos, e compara a saída (stdout + stderr) e o código de saída.

## Diferenças conhecidas (esperadas)
Estão na §4 do `CONTRIBUINDO.md`: `Math.random`, data/hora e tempos medidos, rede (`fetch`),
dados da máquina (`node:os`), o estado de Promises no `console.log`.
Uma diferença que **não** está lá é um achado: avise o agente do simulador.

## Diferenças encontradas
<!-- AUTO: cada página tem a sua seção, reescrita a cada --nativo. Página sem diferença não aparece. -->

