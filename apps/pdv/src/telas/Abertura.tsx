import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, ErroDeTela } from "@erp/ui";
import { type ReactNode, useState } from "react";

import type { ApiDoBalcao } from "../api/servidor.js";
import { CampoDinheiro } from "../componentes/CampoDinheiro.js";
import { FaixaDoTreino } from "../componentes/FaixaDoTreino.js";
import { useModo } from "../modo.js";

/**
 * Abertura do caixa — a primeira coisa do dia.
 *
 * Sem ela nenhuma venda começa: `IniciarVenda` exige sessão aberta, porque
 * venda sem caixa não tem onde creditar o dinheiro e só apareceria no
 * fechamento, com a gaveta não correspondendo a lançamento nenhum.
 *
 * ### Por que o fundo de troco é obrigatório
 *
 * Ele é a linha de partida da conferência. Sem informá-lo, toda a diferença do
 * dia vira ruído: a gaveta fecha com o que sobrou do fundo somado ao que
 * entrou, e ninguém consegue dizer quanto era de cada um. Pedir um número no
 * começo do dia é barato; descobrir no fim que a conta não fecha, não.
 *
 * Zero é resposta válida e comum — há loja que começa sem troco na gaveta. Por
 * isso o campo aceita zero, mas não aceita **não ter sido digitado**: o campo
 * intocado não distingue "não havia fundo" de "esqueci de contar".
 *
 * ### Dinheiro como na maquininha
 *
 * Os dígitos entram pela direita — 1, 0, 0, 0, 0 vira R$ 100,00 — e o valor
 * aparece formatado o tempo todo, que é como se pega o zero a mais antes de
 * ele virar diferença de caixa.
 */
export function Abertura(props: {
  readonly api: ApiDoBalcao;
  readonly estacaoId: string;
  readonly aoAbrir: () => void;
}): ReactNode {
  const { usuario, sair } = useSessao();
  const { treinamento } = useModo();

  // `undefined` até a primeira tecla: ver a nota acima.
  const [fundo, setFundo] = useState<string | undefined>(undefined);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);

  async function abrir(): Promise<void> {
    if (ocupado) return;

    if (fundo === undefined) {
      setErro("Informe o fundo de troco. Se a gaveta começa vazia, digite 0.");
      return;
    }

    setErro(undefined);
    setOcupado(true);

    try {
      await props.api.abrirCaixa(props.estacaoId, fundo);
      props.aoAbrir();
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      {treinamento && <FaixaDoTreino />}
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-tinta">Abrir o caixa</h1>
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <span>{usuario?.nome}</span>
          <Botao tom="discreto" onClick={() => void sair()}>
            Sair
          </Botao>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center">
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            void abrir();
          }}
          className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-borda bg-papel p-8 shadow-cartao"
          noValidate
        >
          <p className="text-tinta-suave">
            O caixa desta estação está fechado. Conte o dinheiro que já está na gaveta
            para começar o dia.
          </p>

          {erro !== undefined && <ErroDeTela mensagem={erro} />}

          <CampoDinheiro
            rotulo="Fundo de troco"
            valor={fundo ?? "0"}
            autoFocus
            grande
            ajuda="Digite os números: 1, 0, 0, 0, 0 são R$ 100,00. Gaveta vazia: digite 0."
            aoMudar={(centavos) => {
              setErro(undefined);
              setFundo(centavos);
            }}
          />

          <Botao
            type="submit"
            tamanho="grande"
            ocupado={ocupado}
            rotuloOcupado="Abrindo…"
          >
            Abrir caixa
          </Botao>
        </form>
      </div>
    </main>
  );
}
