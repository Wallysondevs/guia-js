console.log(new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(1234.5));
console.log((0.1 + 0.2).toFixed(2), Number("3,5"), parseFloat("3.5kg"));
console.log(["banana", "Açaí", "abacaxi"].sort((a, b) => a.localeCompare(b)));
