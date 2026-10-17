import { mensagemDe } from "@erp/cliente-api";
import { Botao, ErroDeTela, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useState } from "react";

import type { ApiDoBalcao } from "../api/servidor.js";
import type { Conferencia } from "../api/tipos.js";
import { agente } from "../balcao.js";
import { CampoDinheiro } from "../componentes/CampoDinheiro.js";
import { FaixaDoTreino } from "../componentes/FaixaDoTreino.js";
import { rotuloDaForma } from "../formas.js";
import { useModo } from "../modo.js";

/**
 * Fechamento do caixa — a conferência do dia.
 *
 * ### A contagem é às cegas, e é isso que faz o controle existir
 *
 * A tela **não mostra** quanto deveria haver na gaveta. Quem conta digita o que
 * encontrou; só depois de enviar é que o esperado e a diferença aparecem.
 *
 * Mostrar antes transformaria a conferência em teatro: o operador confirmaria o
 * número que está na frente dele, e a falta que o controle existe para achar
 * passaria despercebida todos os dias. O servidor colabora — `GET /api/caixa/
 * aberto` não devolve o esperado, então nem a aba de rede do navegador entrega.
 *
 * ### Diferença não trava ninguém
 *
 * O caixa fecha com falta ou com sobra. Travar deixaria a loja com a gaveta
 * aberta e o operador sem saída — e a diferença continuaria existindo. Ela é
 * mostrada com clareza, registrada, e o gerente resolve depois.
 *
 * ### Venda na fila é o único bloqueio
 *
 * Por um motivo diferente: essa diferença **não é real**. A venda que a estação
 * ainda não enviou não entrou no esperado, e o dinheiro dela está certo na
 * gaveta. Fechar assim inventaria uma falta que ninguém consegue explicar.
 *
 * ### Pix e cartão não entram na gaveta
 *
 * O relatório separa: a gaveta é só dinheiro, e o resto aparece por forma de
 * pagamento, para conferir com o extrato do banco e da maquininha.
 */
export function Fechamento(props: {
  readonly api: ApiDoBalcao;
  readonly estacaoId: string;
  readonly aoVoltar: () => void;
  readonly aoConcluir: () => void;
}): ReactNode {
  const { treinamento } = useModo();
  const [contado, setContado] = useState<string | undefined>(undefined);
  const [conferencia, setConferencia] = useState<Conferencia | undefined>(undefined);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);

  async function confirmar(): Promise<void> {
    if (ocupado) return;

    if (contado === undefined) {
      setErro("Conte o dinheiro da gaveta e digite o total. Gaveta vazia: digite 0.");
      return;
    }

    setErro(undefined);
    setOcupado(true);

    try {
      // A estação é quem sabe quantas vendas ainda não subiram: uma venda que
      // nunca chegou não deixa rastro no servidor. As da fila são da loja; o
      // treino não tem fila (ADR-0026), e não pode ser travado por ela.
      const pendentes = treinamento ? 0 : await vendasPendentes();

      setConferencia(
        await props.api.fecharCaixa({
          estacaoId: props.estacaoId,
          contadoEmDinheiro: contado,
          vendasPendentes: pendentes,
        }),
      );
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  if (conferencia !== undefined) {
    return <Resultado conferencia={conferencia} aoConcluir={props.aoConcluir} />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      {treinamento && <FaixaDoTreino />}
      <header>
        <h1 className="text-2xl font-semibold text-tinta">Fechamento de caixa</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Conte o dinheiro da gaveta e informe o total. O sistema compara depois.
        </p>
      </header>

      {erro !== undefined && <ErroDeTela mensagem={erro} />}

      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(evento) => {
          evento.preventDefault();
          void confirmar();
        }}
      >
        <CampoDinheiro
          rotulo="Total contado na gaveta"
          valor={contado ?? "0"}
          autoFocus
          grande
          ajuda="Só o dinheiro: notas e moedas. Pix e cartão são conferidos à parte."
          aoMudar={(centavos) => {
            setErro(undefined);
            setContado(centavos);
          }}
        />

        <div className="flex gap-3">
          <Botao
            type="submit"
            tamanho="grande"
            ocupado={ocupado}
            rotuloOcupado="Conferindo…"
          >
            Conferir e fechar
          </Botao>
          <Botao tom="discreto" tamanho="grande" onClick={props.aoVoltar}>
            Voltar
          </Botao>
        </div>
      </form>
    </main>
  );
}

function Resultado(props: {
  readonly conferencia: Conferencia;
  readonly aoConcluir: () => void;
}): ReactNode {
  const { conferencia } = props;
  const divergencia = BigInt(conferencia.divergenciaEmDinheiro);
  const bate = divergencia === 0n;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold text-tinta">Caixa fechado</h1>

      <section
        aria-label="Diferença apurada"
        className={`rounded-lg border p-6 text-center ${
          bate ? "border-ok bg-ok-suave" : "border-atencao bg-atencao-suave"
        }`}
      >
        <p className="text-sm text-tinta-suave">
          {bate ? "A gaveta bateu" : divergencia > 0n ? "Sobra" : "Falta"}
        </p>
        {/* A diferença é o número que o gerente vai olhar primeiro, e por isso é
            o maior elemento da tela. */}
        <strong className="font-numero text-5xl font-semibold text-tinta">
          {formatarDinheiro(absoluto(divergencia))}
        </strong>
      </section>

      <section aria-labelledby="titulo-gaveta" className="flex flex-col gap-2">
        <h2 id="titulo-gaveta" className="text-lg font-semibold text-tinta">
          Dinheiro na gaveta
        </h2>
        <dl className="flex flex-col gap-2 text-sm">
          <Linha rotulo="Fundo de troco" valor={conferencia.fundoTroco} />
          <Linha rotulo="Recebido em dinheiro" valor={conferencia.recebidoEmDinheiro} />
          <Linha rotulo="Troco devolvido" valor={conferencia.trocoDevolvido} negativo />
          <Linha rotulo="Suprimentos" valor={conferencia.suprimentos} />
          <Linha rotulo="Sangrias" valor={conferencia.sangrias} negativo />
          {conferencia.devolvidoEmDinheiro !== "0" && (
            <Linha
              rotulo="Devolvido em dinheiro"
              valor={conferencia.devolvidoEmDinheiro}
              negativo
            />
          )}
          <Linha
            rotulo="Esperado na gaveta"
            valor={conferencia.esperadoEmDinheiro}
            forte
          />
          <Linha rotulo="Contado por você" valor={conferencia.contadoEmDinheiro} forte />
        </dl>
      </section>

      <section aria-labelledby="titulo-vendas" className="flex flex-col gap-2">
        <h2 id="titulo-vendas" className="text-lg font-semibold text-tinta">
          Vendas do caixa
        </h2>
        <p className="text-sm text-tinta-suave">
          {conferencia.quantidadeVendas === 1
            ? "1 venda"
            : `${String(conferencia.quantidadeVendas)} vendas`}{" "}
          · {formatarDinheiro(conferencia.totalVendido)} vendidos
        </p>
        <dl className="flex flex-col gap-2 text-sm">
          <Linha rotulo="Descontos dados" valor={conferencia.descontos} />
          <Linha
            rotulo={`Cancelamentos (${String(conferencia.cancelamentos.quantidade)})`}
            valor={conferencia.cancelamentos.total}
          />
          <Linha
            rotulo={`Devoluções (${String(conferencia.devolucoes.quantidade)})`}
            valor={conferencia.devolucoes.total}
          />
          {conferencia.totalAReceber !== "0" && (
            <Linha
              rotulo="Vendido no fiado (a receber)"
              valor={conferencia.totalAReceber}
            />
          )}
        </dl>
      </section>

      {conferencia.porForma.length > 0 && (
        <section aria-labelledby="titulo-formas" className="flex flex-col gap-2">
          <h2 id="titulo-formas" className="text-lg font-semibold text-tinta">
            Por forma de pagamento
          </h2>
          <p className="text-sm text-tinta-suave">
            Pix e cartão não entram na gaveta: confira com o extrato do banco e da
            maquininha.
          </p>
          <dl className="flex flex-col gap-2 text-sm">
            {conferencia.porForma.map((forma) => (
              <Linha
                key={forma.forma}
                rotulo={rotuloDaForma(forma.forma)}
                valor={forma.esperado}
              />
            ))}
          </dl>
        </section>
      )}

      <Botao tamanho="grande" autoFocus onClick={props.aoConcluir}>
        Concluir
      </Botao>
    </main>
  );
}

function Linha(props: {
  readonly rotulo: string;
  readonly valor: string;
  readonly forte?: boolean;
  /** Sai da gaveta: mostrado com sinal, para a conta fechar de cabeça. */
  readonly negativo?: boolean;
}): ReactNode {
  const forte = props.forte === true;

  return (
    <div className="flex items-baseline justify-between border-b border-borda pb-1">
      <dt className={forte ? "text-tinta" : "text-tinta-suave"}>{props.rotulo}</dt>
      <dd
        className={`font-numero ${forte ? "font-semibold text-tinta" : "text-tinta-suave"}`}
      >
        {props.negativo === true && props.valor !== "0" ? "- " : ""}
        {formatarDinheiro(props.valor)}
      </dd>
    </div>
  );
}

/**
 * Quantas vendas a estação ainda não conseguiu enviar.
 *
 * Zero quando não há ponte — no navegador não existe fila, então não há o que
 * esperar. Falha da ponte também vira zero: travar o fechamento porque o IPC
 * não respondeu deixaria a loja sem conseguir fechar o dia por um problema que
 * não tem a ver com dinheiro.
 */
async function vendasPendentes(): Promise<number> {
  try {
    const ponte = await agente();

    if (ponte === undefined) return 0;

    return (await ponte.estado()).pendentes;
  } catch {
    return 0;
  }
}

function absoluto(valor: bigint): string {
  return (valor < 0n ? -valor : valor).toString();
}
