/**
 * UUID v4 que funciona em qualquer origem.
 *
 * `crypto.randomUUID()` **só existe em contexto seguro** — HTTPS ou
 * `localhost`. O servidor da loja fala HTTP puro na rede local (ADR-0028), então
 * o segundo computador, que abre `http://NOME-DO-SERVIDOR:3000`, não o tem: o
 * login estourava `crypto.randomUUID is not a function`, e a tela traduzia
 * qualquer `TypeError` como "sem conexão com o servidor". Só o computador do
 * próprio servidor conseguia entrar — e foi justamente nele que a instalação foi
 * testada.
 *
 * `crypto.getRandomValues` existe em qualquer origem, e é o mesmo gerador.
 */
export function novoUuid(): string {
  const aleatorios = crypto.getRandomValues(new Uint8Array(16));

  const hex = Array.from(aleatorios, (byte, indice) => {
    // Versão 4 no sétimo byte e variante RFC 4122 no nono: é o que faz o
    // servidor (`z.uuid()`) reconhecê-lo como UUID.
    const ajustado =
      indice === 6 ? (byte & 0x0f) | 0x40 : indice === 8 ? (byte & 0x3f) | 0x80 : byte;

    return ajustado.toString(16).padStart(2, "0");
  }).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
