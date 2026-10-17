import "@testing-library/jest-dom/vitest";

// O jsdom não desenha, e por isso não implementa a rolagem até o elemento. A
// lista de itens rola até o selecionado; no teste, basta que a chamada exista.
Element.prototype.scrollIntoView = function rolarAteAqui(): void {
  // Sem tela, não há para onde rolar.
};
