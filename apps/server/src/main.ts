import {
  carregarAmbiente,
  descreverParaLog,
  ErroConfiguracao,
} from "./composicao/ambiente.js";
import { montarContainer } from "./composicao/container.js";
import { criarEncerrador } from "./composicao/encerramento.js";
import { criarServidor } from "./http/servidor.js";
import { VERSAO } from "./versao.js";

/**
 * Ponto de entrada do servidor da loja.
 *
 * Deliberadamente magro: tudo o que decide comportamento mora em módulo
 * testável, e aqui fica apenas a sequência. Lógica em `main.ts` é lógica que
 * nenhum teste alcança — e a inicialização é o momento em que um defeito custa
 * mais caro, porque a loja está tentando abrir.
 */

/** Sinais que o serviço do Windows e o `docker stop` usam para pedir parada. */
const SINAIS_DE_PARADA = ["SIGTERM", "SIGINT"] as const;

async function iniciar(): Promise<void> {
  const ambiente = carregarAmbiente(process.env);
  const container = montarContainer(ambiente);
  const app = await criarServidor({ ambiente, container });

  const encerrar = criarEncerrador({
    servidor: app,
    recursos: container,
    tempoLimiteMs: ambiente.tempoLimiteEncerramentoMs,
    registrador: app.log,
  });

  for (const sinal of SINAIS_DE_PARADA) {
    process.once(sinal, () => {
      app.log.info({ sinal }, "sinal de parada recebido");
      void encerrar();
    });
  }

  await app.listen({ host: ambiente.endereco, port: ambiente.porta });

  app.log.info({ versao: VERSAO, ...descreverParaLog(ambiente) }, "servidor no ar");
}

try {
  await iniciar();
} catch (causa) {
  // Antes do logger existir não há como registrar estruturado, e a mensagem
  // precisa chegar a quem está instalando — que lê o console, não o arquivo.
  if (causa instanceof ErroConfiguracao) {
    console.error(causa.message);
  } else {
    console.error("Falha ao iniciar o servidor.", causa);
  }

  process.exitCode = 1;
}
