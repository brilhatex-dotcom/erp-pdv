import { carregarAmbiente } from "./ambiente.js";
import { montarContainer } from "./composicao/container.js";
import { montarServidor } from "./servidor.js";

/**
 * Entrada do servidor.
 *
 * Faz três coisas e mais nada: valida a configuração, monta o container e sobe
 * o Fastify. Tudo que é testável mora nos módulos que ele chama — este arquivo
 * é o único que fica fora da cobertura, e por isso precisa ser trivial.
 */
async function principal(): Promise<void> {
  const ambiente = carregarAmbiente();
  const container = montarContainer(ambiente);
  const servidor = await montarServidor(container);

  /**
   * Encerramento ordenado.
   *
   * Sem isso, um `SIGTERM` durante a atualização mataria o processo no meio de
   * uma venda — a transação cairia pela metade e o operador veria erro com o
   * cliente na frente. Fechar o servidor primeiro drena o que está em curso.
   */
  const encerrar = (sinal: string): void => {
    void (async () => {
      servidor.log.info({ sinal }, "encerrando");
      await servidor.close();
      await container.encerrar();
      process.exit(0);
    })();
  };

  process.on("SIGTERM", () => {
    encerrar("SIGTERM");
  });
  process.on("SIGINT", () => {
    encerrar("SIGINT");
  });

  await servidor.listen({ port: ambiente.PORTA, host: ambiente.ENDERECO });
}

principal().catch((causa: unknown) => {
  // Falha de partida: a mensagem precisa ser legível por quem instala, não só
  // por quem programa. `carregarAmbiente` já produz o texto com o que faltou.
  process.stderr.write(
    `\nO servidor não pôde iniciar.\n${causa instanceof Error ? causa.message : String(causa)}\n\n`,
  );
  process.exit(1);
});
