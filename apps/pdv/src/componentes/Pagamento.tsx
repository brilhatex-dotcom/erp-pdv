import { Botao, CampoSelecao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

import type { VendaNoFio } from "../api/tipos.js";
import {
  type CodigoForma,
  descreverPagamento,
  FORMAS,
  type FormaDoBalcao,
} from "../formas.js";
import { CampoDinheiro } from "./CampoDinheiro.js";

/**
 * O pagamento — em dois passos, os dois pelo teclado.
 *
 * **1. A forma**, numa tecla: 1 dinheiro, 2 Pix, 3 débito, 4 crédito, 5 fiado.
 * **2. O valor**, que já vem com o que falta: no cartão e no Pix quase sempre
 * é só Enter; no dinheiro, o operador digita o que o cliente entregou e o troco
 * aparece antes de confirmar.
 *
 * O pagamento misto é o mesmo gesto repetido: R$ 20,00 no dinheiro, Enter, e a
 * tela volta para a escolha da forma com os R$ 30,00 que faltam. Quando não
 * falta nada, a venda fecha sozinha — quem fecha é a tela de venda.
 *
 * ### O que é do operador e o que é do sistema
 *
 * Pix e cartão sem integração são **confirmados pelo operador**, e a tela diz
 * isso com todas as letras antes do Enter: o Pix que não caiu e foi confirmado
 * é o prejuízo mais comum do balcão. Do cartão, a tela pede no máximo o código
 * de autorização da maquininha — nunca o número do cartão.
 */

export interface ClienteNaVenda {
  readonly id: string;
  readonly nome: string;
  readonly vendeAPrazo: boolean;
  readonly disponivel: string;
}

export interface PedidoDePagamento {
  readonly forma: CodigoForma;
  readonly descricao: string;
  readonly valor: string;
  readonly parcelas?: number | undefined;
  readonly autorizacao?: string | undefined;
}

/**
 * O que a fila da estação recebe. Fiado precisa do cadastro e do limite do
 * cliente, que moram no servidor.
 */
const FORMAS_SEM_CONEXAO: readonly CodigoForma[] = [
  "DINHEIRO",
  "PIX",
  "CARTAO_DEBITO",
  "CARTAO_CREDITO",
];

const PARCELAS = Array.from({ length: 12 }, (_, indice) => ({
  valor: String(indice + 1),
  rotulo: indice === 0 ? "À vista" : `${String(indice + 1)} vezes`,
}));

export function Pagamento(props: {
  readonly venda: VendaNoFio;
  readonly offline: boolean;
  readonly fiadoLigado: boolean;
  readonly cliente: ClienteNaVenda | undefined;
  readonly ocupado: boolean;
  readonly aoPagar: (pedido: PedidoDePagamento) => void;
  readonly aoTirar: (indice: number) => void;
  readonly aoConcluir: () => void;
  readonly aoPedirCliente: () => void;
  readonly aoVoltar: () => void;
}): ReactNode {
  const { venda } = props;
  const formas = FORMAS.filter((forma) =>
    props.offline
      ? FORMAS_SEM_CONEXAO.includes(forma.codigo)
      : forma.codigo !== "CREDIARIO" || props.fiadoLigado,
  );

  const [forma, setForma] = useState<FormaDoBalcao | undefined>(undefined);
  const [valor, setValor] = useState(venda.faltaPagar);
  const [autorizacao, setAutorizacao] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [erroValor, setErroValor] = useState<string | undefined>(undefined);
  const primeiraForma = useRef<HTMLButtonElement>(null);
  const concluir = useRef<HTMLButtonElement>(null);

  const tudoPago = venda.faltaPagar === "0";

  // Cada pagamento registrado devolve à escolha da forma: o resto do pagamento
  // misto quase sempre vem por outra.
  const registrados = venda.pagamentos.length;
  useEffect(() => {
    setForma(undefined);
  }, [registrados]);

  useEffect(() => {
    if (forma !== undefined) return;
    if (tudoPago) concluir.current?.focus();
    else primeiraForma.current?.focus();
  }, [forma, tudoPago]);

  function escolher(escolhida: FormaDoBalcao): void {
    setForma(escolhida);
    setValor(venda.faltaPagar);
    setAutorizacao("");
    setParcelas("1");
    setErroValor(undefined);

    if (escolhida.codigo === "CREDIARIO" && props.cliente === undefined)
      props.aoPedirCliente();
  }

  function confirmar(): void {
    if (forma === undefined) return;

    if (valor === "0") {
      setErroValor("Digite o valor.");
      return;
    }

    const codigo = autorizacao.trim();

    props.aoPagar({
      forma: forma.codigo,
      descricao: forma.rotulo,
      valor,
      parcelas: forma.codigo === "CARTAO_CREDITO" ? Number(parcelas) : undefined,
      autorizacao: codigo === "" ? undefined : codigo,
    });
  }

  const troco = BigInt(valor) - BigInt(venda.faltaPagar);
  const fiadoSemCliente = forma?.codigo === "CREDIARIO" && props.cliente === undefined;
  const clienteSemFiado =
    forma?.codigo === "CREDIARIO" &&
    props.cliente !== undefined &&
    !props.cliente.vendeAPrazo;

  return (
    <section
      aria-label="Pagamento"
      className="flex min-h-0 flex-col gap-4 overflow-y-auto rounded-lg border border-borda bg-papel p-4"
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          evento.preventDefault();
          if (forma === undefined) props.aoVoltar();
          else setForma(undefined);
          return;
        }

        if (tudoPago) return;

        // Na escolha, a tecla sozinha; no valor, com Alt — o número sem Alt
        // ali é dígito do valor.
        if (forma !== undefined && !evento.altKey) return;

        const escolhida = formas.find((atual) => atual.tecla === evento.key);
        if (escolhida === undefined) return;

        evento.preventDefault();
        escolher(escolhida);
      }}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-xl font-semibold text-tinta">Pagamento</h2>
        <p className="text-tinta-suave">
          Total{" "}
          <strong className="font-numero text-tinta">
            {formatarDinheiro(venda.total)}
          </strong>
        </p>
      </div>

      <div
        className={`flex items-baseline justify-between rounded-md px-4 py-3 ${
          tudoPago ? "bg-ok-suave" : "bg-atencao-suave"
        }`}
      >
        <span className="text-lg text-tinta">
          {tudoPago ? "Tudo pago" : "Falta receber"}
        </span>
        <strong
          aria-label="Falta receber"
          className="font-numero text-total font-semibold text-tinta"
        >
          {formatarDinheiro(venda.faltaPagar)}
        </strong>
      </div>

      {venda.pagamentos.length > 0 && (
        <ul aria-label="Pagamentos registrados" className="flex flex-col gap-1">
          {venda.pagamentos.map((pagamento) => (
            <li
              key={pagamento.indice}
              className="flex items-center justify-between gap-3 rounded-md border border-borda px-3 py-1"
            >
              <span className="text-tinta">
                {descreverPagamento(pagamento.forma, pagamento.confirmacao)}
                {pagamento.parcelas > 1 && ` em ${String(pagamento.parcelas)} vezes`}
              </span>
              <span className="flex items-center gap-2">
                <strong className="font-numero text-tinta">
                  {formatarDinheiro(pagamento.valor)}
                </strong>
                {!props.offline && (
                  <Botao
                    tom="discreto"
                    disabled={props.ocupado}
                    aria-label={`Tirar o pagamento de ${formatarDinheiro(pagamento.valor)}`}
                    onClick={() => {
                      props.aoTirar(pagamento.indice);
                    }}
                  >
                    Tirar
                  </Botao>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tudoPago ? (
        <div className="flex flex-col gap-2">
          <p className="text-tinta">O valor da venda já foi recebido.</p>
          <div>
            <button
              ref={concluir}
              type="button"
              disabled={props.ocupado}
              onClick={props.aoConcluir}
              className="min-h-14 rounded-md bg-acao px-6 text-lg font-medium text-papel disabled:opacity-55"
            >
              {props.ocupado ? "Concluindo…" : "Concluir a venda (Enter)"}
            </button>
          </div>
        </div>
      ) : forma === undefined ? (
        <>
          <p className="text-sm text-tinta-suave">
            Escolha a forma de pagamento pelo número. Esc volta para a venda.
          </p>
          <div
            role="group"
            aria-label="Formas de pagamento"
            className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2"
          >
            {formas.map((opcao, posicao) => (
              <button
                key={opcao.codigo}
                ref={posicao === 0 ? primeiraForma : undefined}
                type="button"
                disabled={props.ocupado}
                onClick={() => {
                  escolher(opcao);
                }}
                className="flex min-h-20 flex-col items-start justify-between rounded-lg border border-borda bg-papel p-3 text-left hover:bg-acao-suave disabled:opacity-55"
              >
                <span className="font-numero text-sm text-tinta-suave">
                  {opcao.tecla}
                </span>
                <span className="text-lg font-semibold text-tinta">{opcao.rotulo}</span>
              </button>
            ))}
          </div>
          {props.offline && (
            <p className="text-sm text-tinta-suave">
              Sem conexão com o servidor, o fiado fica indisponível.
            </p>
          )}
        </>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            confirmar();
          }}
        >
          <h3 className="text-lg font-semibold text-tinta">{forma.rotulo}</h3>
          <p className="rounded-md border border-borda bg-papel-fundo px-3 py-2 text-tinta">
            {forma.orientacao}
          </p>

          {forma.codigo === "CREDIARIO" && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-tinta">
                {props.cliente === undefined ? (
                  "Escolha o cliente do fiado."
                ) : (
                  <>
                    Cliente: <strong>{props.cliente.nome}</strong>
                    {props.cliente.vendeAPrazo && (
                      <span className="block text-sm text-tinta-suave">
                        Fiado disponível: {formatarDinheiro(props.cliente.disponivel)}
                      </span>
                    )}
                  </>
                )}
              </span>
              <Botao tom="secundario" onClick={props.aoPedirCliente}>
                {props.cliente === undefined
                  ? "Escolher cliente (F6)"
                  : "Trocar cliente (F6)"}
              </Botao>
            </div>
          )}

          {clienteSemFiado && (
            <p
              role="alert"
              className="rounded-md border border-atencao bg-atencao-suave px-3 py-2 text-tinta"
            >
              Este cliente não tem fiado liberado. Escolha outra forma de pagamento, ou
              peça ao gerente para definir um limite na retaguarda.
            </p>
          )}

          <CampoDinheiro
            rotulo={
              forma.codigo === "DINHEIRO"
                ? "Valor recebido"
                : `Valor no ${forma.rotulo.toLowerCase()}`
            }
            valor={valor}
            autoFocus
            grande
            aoMudar={(centavos) => {
              setErroValor(undefined);
              setValor(centavos);
            }}
            {...(erroValor === undefined ? {} : { erro: erroValor })}
          />

          {/* Prévia de uma subtração, não regra: o troco que vale é o que o
              servidor devolve, e é ele que aparece na conclusão. */}
          {forma.codigo === "DINHEIRO" && troco > 0n && (
            <p
              aria-live="polite"
              className="flex items-baseline justify-between rounded-md bg-ok-suave px-4 py-2"
            >
              <span className="text-lg text-tinta">Troco</span>
              <strong className="font-numero text-3xl text-tinta">
                {formatarDinheiro(troco)}
              </strong>
            </p>
          )}

          {(forma.codigo === "CARTAO_DEBITO" || forma.codigo === "CARTAO_CREDITO") && (
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <CampoTexto
                rotulo="Código de autorização da maquininha (opcional)"
                autoComplete="off"
                maxLength={20}
                value={autorizacao}
                onChange={(evento) => {
                  // Letras e números: é o que a maquininha imprime. Qualquer
                  // outra coisa aqui é número de cartão digitado por engano.
                  setAutorizacao(evento.target.value.replace(/[^\dA-Za-z]/g, ""));
                }}
              />
              {forma.codigo === "CARTAO_CREDITO" && (
                <CampoSelecao
                  rotulo="Parcelas"
                  valor={parcelas}
                  opcoes={PARCELAS}
                  aoMudar={setParcelas}
                />
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <Botao
              type="submit"
              tamanho="grande"
              disabled={fiadoSemCliente || clienteSemFiado}
              ocupado={props.ocupado}
              rotuloOcupado="Registrando…"
            >
              {forma.confirmar} (Enter)
            </Botao>
            <Botao
              tom="discreto"
              tamanho="grande"
              onClick={() => {
                setForma(undefined);
              }}
            >
              Outra forma (Esc)
            </Botao>
          </div>
        </form>
      )}

      {forma === undefined && !tudoPago && (
        <div>
          <Botao tom="discreto" onClick={props.aoVoltar}>
            Voltar para a venda (Esc)
          </Botao>
        </div>
      )}
    </section>
  );
}
