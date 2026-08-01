import { type ReactNode, useEffect, useState } from "react";

import type { EstadoConexaoNoAgente } from "@erp/agente-contrato";

import { agente } from "../balcao.js";

/**
 * O estado da conexão, visto do balcão.
 *
 * ### Silencioso quando está tudo bem
 *
 * Conectado não mostra nada. Um selo verde permanente vira parte do cenário em
 * dois dias, e o dia em que ele mudar de cor ninguém vai reparar. O indicador
 * só aparece quando há algo a fazer ou a saber.
 *
 * ### Offline não é erro
 *
 * A venda continua funcionando — é para isso que a fila existe. Pintar de
 * vermelho ensinaria o operador a parar de vender e chamar o suporte, que é o
 * oposto do comportamento correto e o pior custo que este produto pode gerar.
 * Tom de atenção, texto que diz que está registrando normalmente.
 *
 * ### Crítico é outra conversa
 *
 * Passadas quatro horas offline, o problema deixou de ser do caixa e virou do
 * gerente: alguém precisa olhar a rede antes que o fechamento do dia chegue com
 * dezenas de vendas presas na estação.
 */

/** Intervalo do sino. Um segundo pareceria mais vivo e não muda a decisão de ninguém. */
const INTERVALO_MS = 3000;

export function IndicadorConexao(): ReactNode {
  const [estado, setEstado] = useState<EstadoConexaoNoAgente>({
    tipo: "CONECTADO",
    pendentes: 0,
  });

  useEffect(() => {
    let vivo = true;

    const consultar = async (): Promise<void> => {
      try {
        // Sem Agente não há contingência: nenhuma fila para relatar. Mostrar
        // "offline" aqui seria mentira em desenvolvimento e em tablet.
        const ponte = await agente();
        if (ponte === undefined) return;

        const atual = await ponte.estado();
        if (vivo) setEstado(atual);
      } catch {
        // A ponte quebrou. Não há o que dizer ao operador sobre isto — e travar
        // a tela de venda por causa do indicador seria trocar um problema
        // invisível por um problema que impede de vender.
      }
    };

    void consultar();
    const sino = setInterval(() => void consultar(), INTERVALO_MS);

    return (): void => {
      vivo = false;
      clearInterval(sino);
    };
  }, []);

  if (estado.tipo === "CONECTADO") return undefined;

  const critico = estado.tipo === "OFFLINE_CRITICO";

  return (
    <p
      // `role="status"` e não `alert`: alert interrompe o leitor de tela no meio
      // da bipada, e o operador está registrando produto.
      role="status"
      aria-live="polite"
      className={`rounded-md border px-3 py-2 text-sm ${
        critico
          ? "border-erro bg-erro-suave text-tinta"
          : "border-atencao bg-atencao-suave text-tinta"
      }`}
    >
      <strong>{critico ? "Sem servidor há horas" : "Sem conexão com o servidor"}</strong>{" "}
      · {descreverPendentes(estado.pendentes)} · As vendas continuam sendo registradas
      normalmente.
      {critico && " Avise o responsável pela loja."}
    </p>
  );
}

function descreverPendentes(quantidade: number): string {
  if (quantidade === 0) return "nenhuma venda aguardando envio";
  if (quantidade === 1) return "1 venda aguardando envio";

  return `${String(quantidade)} vendas aguardando envio`;
}
