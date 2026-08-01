import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto, ErroDeTela, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useState } from "react";

import { balcao } from "../balcao.js";
import { identificadorDaEstacao } from "../estacao.js";

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
 */

type Fase = "CONTANDO" | "CONFERIDO";

interface Conferencia {
  readonly fundoTroco: string;
  readonly recebidoEmDinheiro: string;
  readonly trocoDevolvido: string;
  readonly suprimentos: string;
  readonly sangrias: string;
  readonly esperadoEmDinheiro: string;
  readonly contadoEmDinheiro: string;
  readonly divergenciaEmDinheiro: string;
  readonly totalVendido: string;
  readonly quantidadeVendas: number;
}

export function Fechamento({ aoSair }: { readonly aoSair: () => void }): ReactNode {
  const { cliente } = useSessao();

  const [fase, setFase] = useState<Fase>("CONTANDO");
  const [contado, setContado] = useState("");
  const [conferencia, setConferencia] = useState<Conferencia | undefined>(undefined);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);

  async function confirmar(): Promise<void> {
    const centavos = contado.replace(/\D/g, "");
    if (centavos === "" || ocupado) return;

    setErro(undefined);
    setOcupado(true);

    try {
      // A estação é quem sabe quantas vendas ainda não subiram: uma venda que
      // nunca chegou não deixa rastro no servidor.
      const pendentes = await vendasPendentes();

      const resultado = await cliente.requisitar<Conferencia>("/api/caixa/fechar", {
        metodo: "POST",
        corpo: {
          estacaoId: identificadorDaEstacao(),
          contadoEmDinheiro: centavos,
          vendasPendentes: pendentes,
        },
      });

      setConferencia(resultado);
      setFase("CONFERIDO");
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  if (fase === "CONFERIDO" && conferencia !== undefined) {
    return <Resultado conferencia={conferencia} aoSair={aoSair} />;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-tinta">Fechamento de caixa</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Conte o dinheiro da gaveta e informe o total. O sistema compara depois.
        </p>
      </header>

      {erro !== undefined && <ErroDeTela mensagem={erro} />}

      <CampoTexto
        rotulo="Total contado na gaveta (centavos)"
        numerico
        autoFocus
        value={contado}
        onChange={(evento) => {
          setContado(evento.target.value);
        }}
        onKeyDown={(evento) => {
          if (evento.key !== "Enter") return;
          evento.preventDefault();
          void confirmar();
        }}
      />

      <p className="text-sm text-tinta-suave" aria-live="polite">
        {contado.replace(/\D/g, "") === ""
          ? "Digite em centavos: 125000 são R$ 1.250,00."
          : formatarDinheiro(contado.replace(/\D/g, ""))}
      </p>

      <div className="flex gap-3">
        <Botao
          tamanho="grande"
          ocupado={ocupado}
          rotuloOcupado="Conferindo…"
          onClick={() => void confirmar()}
        >
          Conferir e fechar
        </Botao>
        <Botao tom="discreto" tamanho="grande" onClick={aoSair}>
          Voltar
        </Botao>
      </div>
    </main>
  );
}

function Resultado(props: {
  readonly conferencia: Conferencia;
  readonly aoSair: () => void;
}): ReactNode {
  const { conferencia } = props;
  const divergencia = BigInt(conferencia.divergenciaEmDinheiro);
  const bate = divergencia === 0n;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
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

      <dl className="flex flex-col gap-2 text-sm">
        <Linha rotulo="Fundo de troco" valor={conferencia.fundoTroco} />
        <Linha rotulo="Recebido em dinheiro" valor={conferencia.recebidoEmDinheiro} />
        <Linha rotulo="Troco devolvido" valor={conferencia.trocoDevolvido} />
        <Linha rotulo="Suprimentos" valor={conferencia.suprimentos} />
        <Linha rotulo="Sangrias" valor={conferencia.sangrias} />
        <Linha rotulo="Esperado na gaveta" valor={conferencia.esperadoEmDinheiro} forte />
        <Linha rotulo="Contado por você" valor={conferencia.contadoEmDinheiro} forte />
      </dl>

      <p className="text-sm text-tinta-suave">
        {conferencia.quantidadeVendas === 1
          ? "1 venda"
          : `${String(conferencia.quantidadeVendas)} vendas`}{" "}
        · {formatarDinheiro(conferencia.totalVendido)} vendidos
      </p>

      <Botao tamanho="grande" autoFocus onClick={props.aoSair}>
        Concluir
      </Botao>
    </main>
  );
}

function Linha(props: {
  readonly rotulo: string;
  readonly valor: string;
  readonly forte?: boolean;
}): ReactNode {
  return (
    <div className="flex items-baseline justify-between border-b border-borda pb-1">
      <dt className={props.forte === true ? "text-tinta" : "text-tinta-suave"}>
        {props.rotulo}
      </dt>
      <dd
        className={`font-numero ${
          props.forte === true ? "font-semibold text-tinta" : "text-tinta-suave"
        }`}
      >
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
  const ponte = balcao();

  if (ponte === undefined) return 0;

  try {
    return (await ponte.estadoConexao()).pendentes;
  } catch {
    return 0;
  }
}

function absoluto(valor: bigint): string {
  return (valor < 0n ? -valor : valor).toString();
}
