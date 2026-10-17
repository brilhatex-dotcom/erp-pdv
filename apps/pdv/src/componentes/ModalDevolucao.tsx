import { mensagemDe } from "@erp/cliente-api";
import { Botao, CampoTexto, formatarQuantidade } from "@erp/ui";
import { type ReactNode, useState } from "react";

import type { ApiDoBalcao } from "../api/servidor.js";
import type {
  CredencialSupervisor,
  DevolucoesDaVenda,
  VendaRecente,
} from "../api/tipos.js";
import { milesimosDoTexto } from "../leitura.js";
import { EscolherVenda } from "./EscolherVenda.js";
import { Modal } from "./Modal.js";

/**
 * Devolução — total ou parcial, sempre ligada à venda original.
 *
 * Ligada à venda porque é ela que diz **quanto** voltar: o preço pago, com o
 * desconto que houve, e não o preço de hoje na prateleira. Quem calcula o valor
 * é o servidor; a tela só diz o quê e quanto de cada item, para onde ele vai
 * (de volta ao estoque ou para a perda, se estragou) e como o cliente recebe.
 *
 * Feita pelo supervisor, com a matrícula dele — devolução tira dinheiro da
 * gaveta, e quem tira dinheiro é quem responde por ele.
 */

export type FormaReembolso = "DINHEIRO" | "PIX" | "CARTAO" | "ABATER_FIADO";

export interface DevolucaoFeita {
  readonly vendaNumero: number;
  readonly valorTotal: string;
  readonly formaReembolso: FormaReembolso;
}

const REEMBOLSOS: readonly {
  readonly codigo: FormaReembolso;
  readonly rotulo: string;
}[] = [
  { codigo: "DINHEIRO", rotulo: "Dinheiro" },
  { codigo: "PIX", rotulo: "Pix" },
  { codigo: "CARTAO", rotulo: "Estorno no cartão" },
  { codigo: "ABATER_FIADO", rotulo: "Abater do fiado" },
];

const MOTIVOS = [
  "Produto com defeito",
  "Produto vencido",
  "Cliente desistiu",
  "Troca",
] as const;

type Liberar = <T>(
  acao: (credencial?: CredencialSupervisor) => Promise<T>,
) => Promise<T | undefined>;

export function ModalDevolucao(props: {
  readonly api: ApiDoBalcao;
  readonly estacaoId: string;
  readonly permitido: boolean;
  readonly comLiberacao: Liberar;
  readonly aoDevolver: (devolucao: DevolucaoFeita) => void;
  readonly aoFechar: () => void;
}): ReactNode {
  const { api } = props;
  const [dados, setDados] = useState<DevolucoesDaVenda | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | undefined>(undefined);

  if (!props.permitido) {
    return (
      <Modal titulo="Devolução" aoFechar={props.aoFechar}>
        <p className="text-tinta">
          A devolução é feita pelo supervisor ou pelo gerente, com a matrícula e o PIN
          dele: ela tira dinheiro da gaveta, e quem tira é quem responde por ele.
        </p>
        <p className="text-sm text-tinta-suave">
          Peça para ele entrar neste caixa: menu Caixa → Trocar operador.
        </p>
        <div>
          <Botao tom="secundario" onClick={props.aoFechar}>
            Entendi (Esc)
          </Botao>
        </div>
      </Modal>
    );
  }

  async function abrir(venda: VendaRecente): Promise<void> {
    setOcupado(true);
    setErro(undefined);

    try {
      setDados(await api.devolucoes(venda.id));
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal
      titulo={
        dados === undefined
          ? "Devolução"
          : `Devolução da venda ${String(dados.venda.numero)}`
      }
      aoFechar={props.aoFechar}
      largura="larga"
    >
      {erro !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
        >
          {erro}
        </p>
      )}

      {dados === undefined ? (
        <>
          <EscolherVenda
            api={api}
            estacaoId={props.estacaoId}
            rotuloAcao="Devolver itens"
            ocupado={ocupado}
            serve={(venda) =>
              venda.status === "CANCELADA" ? "Venda cancelada" : undefined
            }
            aoEscolher={(venda) => void abrir(venda)}
          />
          <div>
            <Botao tom="discreto" onClick={props.aoFechar}>
              Voltar (Esc)
            </Botao>
          </div>
        </>
      ) : (
        <Itens
          dados={dados}
          ocupado={ocupado}
          aoVoltar={() => {
            setDados(undefined);
            setErro(undefined);
          }}
          aoConfirmar={async (pedido) => {
            setOcupado(true);
            setErro(undefined);

            try {
              const feita = await props.comLiberacao((supervisor) =>
                api.registrarDevolucao(dados.venda.id, {
                  estacaoId: props.estacaoId,
                  ...pedido,
                  supervisor,
                }),
              );

              if (feita !== undefined) {
                props.aoDevolver({
                  vendaNumero: dados.venda.numero,
                  valorTotal: feita.valorTotal,
                  formaReembolso: pedido.formaReembolso,
                });
              }
            } catch (causa) {
              setErro(mensagemDe(causa));
            } finally {
              setOcupado(false);
            }
          }}
        />
      )}
    </Modal>
  );
}

interface PedidoDevolucao {
  readonly itens: readonly {
    readonly numeroItem: number;
    readonly quantidade: { readonly milesimos: string; readonly unidade: string };
    readonly destino: "ESTOQUE" | "PERDA";
  }[];
  readonly formaReembolso: FormaReembolso;
  readonly motivo: string;
}

function Itens(props: {
  readonly dados: DevolucoesDaVenda;
  readonly ocupado: boolean;
  readonly aoVoltar: () => void;
  readonly aoConfirmar: (pedido: PedidoDevolucao) => Promise<void>;
}): ReactNode {
  const { venda, restante } = props.dados;
  const [quantidades, setQuantidades] = useState<Readonly<Record<number, string>>>({});
  const [perda, setPerda] = useState<ReadonlySet<number>>(new Set());
  const [reembolso, setReembolso] = useState<FormaReembolso>("DINHEIRO");
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);

  const teveFiado = venda.pagamentos.some((pagamento) => pagamento.forma === "CREDIARIO");
  const formas = REEMBOLSOS.filter(
    (forma) => forma.codigo !== "ABATER_FIADO" || teveFiado,
  );
  const podeVoltar = new Map(restante.map((linha) => [linha.numeroItem, linha]));

  function devolverTudo(): void {
    setQuantidades(
      Object.fromEntries(
        restante
          .filter((linha) => linha.milesimos !== "0")
          .map((linha) => [linha.numeroItem, formatarQuantidade(linha.milesimos)]),
      ),
    );
  }

  function confirmar(): void {
    const itens: PedidoDevolucao["itens"][number][] = [];

    for (const item of venda.itens) {
      const texto = quantidades[item.numero]?.trim() ?? "";
      if (texto === "") continue;

      const milesimos = milesimosDoTexto(texto);
      if (milesimos === undefined) {
        setErro(
          `Quantidade inválida em ${item.descricao}. Exemplo: 1, ou 0,350 para peso.`,
        );
        return;
      }

      itens.push({
        numeroItem: item.numero,
        quantidade: { milesimos, unidade: item.quantidade.unidade },
        destino: perda.has(item.numero) ? "PERDA" : "ESTOQUE",
      });
    }

    if (itens.length === 0) {
      setErro("Digite a quantidade de ao menos um item, ou toque em Devolver tudo.");
      return;
    }

    if (motivo.trim().length < 3) {
      setErro("Escreva o motivo da devolução, ou toque num dos motivos prontos.");
      return;
    }

    setErro(undefined);
    void props.aoConfirmar({ itens, formaReembolso: reembolso, motivo: motivo.trim() });
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        confirmar();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-tinta-suave">
          Digite quanto volta de cada item. O valor é calculado pelo sistema, com o
          desconto que a venda teve.
        </p>
        <Botao tom="secundario" onClick={devolverTudo}>
          Devolver tudo
        </Botao>
      </div>

      <ul aria-label="Itens da venda" className="flex flex-col gap-2">
        {venda.itens.map((item) => {
          const linha = podeVoltar.get(item.numero);
          const sobra = linha?.milesimos ?? "0";
          const unidade = item.quantidade.unidade.toLowerCase();

          return (
            <li
              key={item.numero}
              className="grid grid-cols-[1fr_9rem_auto] items-end gap-3 rounded-md border border-borda px-3 py-2"
            >
              <span className="text-tinta">
                {item.numero} · {item.descricao}
                <span className="block text-sm text-tinta-suave">
                  Vendido: {formatarQuantidade(item.quantidade.milesimos)} {unidade} ·{" "}
                  {sobra === "0"
                    ? "já devolvido"
                    : `pode voltar: ${formatarQuantidade(sobra)} ${unidade}`}
                </span>
              </span>
              <CampoTexto
                rotulo={`Devolver de ${item.descricao}`}
                inputMode="decimal"
                autoComplete="off"
                disabled={sobra === "0"}
                value={quantidades[item.numero] ?? ""}
                onChange={(evento) => {
                  const texto = evento.target.value.replace(/[^\d,.]/g, "");
                  setQuantidades((atuais) => ({ ...atuais, [item.numero]: texto }));
                }}
              />
              <label className="flex min-h-alvo items-center gap-2 text-sm text-tinta">
                <input
                  type="checkbox"
                  disabled={sobra === "0"}
                  checked={perda.has(item.numero)}
                  onChange={(evento) => {
                    const marcado = evento.target.checked;
                    setPerda((atual) => {
                      const nova = new Set(atual);
                      if (marcado) nova.add(item.numero);
                      else nova.delete(item.numero);
                      return nova;
                    });
                  }}
                />
                Estragado (perda)
              </label>
            </li>
          );
        })}
      </ul>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-tinta">Como o cliente recebe</legend>
        <div className="flex flex-wrap gap-2">
          {formas.map((forma) => (
            <Botao
              key={forma.codigo}
              tom={reembolso === forma.codigo ? "primario" : "secundario"}
              aria-pressed={reembolso === forma.codigo}
              onClick={() => {
                setReembolso(forma.codigo);
              }}
            >
              {forma.rotulo}
            </Botao>
          ))}
        </div>
      </fieldset>

      <div role="group" aria-label="Motivos prontos" className="flex flex-wrap gap-2">
        {MOTIVOS.map((texto) => (
          <Botao
            key={texto}
            tom={motivo === texto ? "primario" : "secundario"}
            aria-pressed={motivo === texto}
            onClick={() => {
              setMotivo(texto);
            }}
          >
            {texto}
          </Botao>
        ))}
      </div>

      <CampoTexto
        rotulo="Motivo da devolução"
        autoComplete="off"
        maxLength={200}
        value={motivo}
        onChange={(evento) => {
          setMotivo(evento.target.value);
        }}
      />

      {erro !== undefined && (
        <p role="alert" className="text-sm text-erro">
          {erro}
        </p>
      )}

      <div className="flex gap-3">
        <Botao
          type="submit"
          tamanho="grande"
          ocupado={props.ocupado}
          rotuloOcupado="Registrando…"
        >
          Registrar devolução
        </Botao>
        <Botao tom="discreto" tamanho="grande" onClick={props.aoVoltar}>
          Outra venda
        </Botao>
      </div>
    </form>
  );
}
