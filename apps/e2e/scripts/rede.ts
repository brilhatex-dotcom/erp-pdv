import { networkInterfaces } from "node:os";

/**
 * O endereço desta máquina na rede — o que o segundo caixa da loja usaria.
 *
 * `localhost` é contexto seguro para o navegador; um IP de rede, em HTTP, não
 * é. O teste do segundo computador precisa da segunda origem, que é a que
 * quebrava na loja sem nada quebrar no desenvolvimento (ADR-0028).
 */
export function enderecoNaRede(): string | undefined {
  for (const interfaces of Object.values(networkInterfaces())) {
    const achado = interfaces?.find(
      (endereco) => endereco.family === "IPv4" && !endereco.internal,
    );
    if (achado !== undefined) return achado.address;
  }

  return undefined;
}
