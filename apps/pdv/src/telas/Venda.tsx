import { mensagemDe, useSessao } from "@erp/cliente-api";

import { imprimirCupomDaVenda } from "../balcao.js";
import {
  Botao,
  CampoTexto,
  ErroDeTela,
  formatarDinheiro,
  formatarQuantidade,
} from "@erp/ui";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { identificadorDaEstacao } from "../estacao.js";

/**
 * Tela de venda — o balcão.
 *
 * Três decisões de fluxo, todas medidas em teclas e não em telas.
 *
 * **A venda começa na primeira bipada.** Não existe botão "iniciar venda": o
 * operador bipa, e se não houver venda aberta ela é criada antes do item. Uma
 * tecla a menos por atendimento, multiplicada por centenas de atendimentos por
 * dia. O operador nunca pensa no conceito "abrir venda", que só existe para o
 * servidor.
 *
 * **Enter no campo vazio vai para o pagamento.** É o gesto natural de "acabou":
 * a mão já está no Enter depois da última bipada. Não há tecla nova para
 * decorar, e o mouse nunca é necessário — exigi-lo aqui seria veto do papel
 * UX/UI (CLAUDE.md §1).
 *
 * **O valor é digitado em centavos.** `1000` são dez reais. É a convenção de
 * toda balança e maquininha do balcão, e elimina a dúvida do separador decimal
 * — que num teclado numérico de PDV nem sempre está onde o operador espera.
 */

type Fase = "VENDENDO" | "PAGANDO" | "CONCLUIDA";

interface ItemNaTela {
  readonly numero: number;
  readonly descricao: string;
  readonly quantidade: { readonly milesimos: string; readonly unidade: string };
  readonly precoUnitario: string;
  readonly total: string;
}

interface VendaNaTela {
  readonly id: string;
  readonly numero: number;
  readonly total: string;
  readonly faltaPagar: string;
  readonly itens: readonly ItemNaTela[];
}

interface RespostaPagamento {
  readonly faltaPagar: string;
  readonly troco: string;
}

/** As quatro formas do balcão, na ordem em que a tecla numérica as escolhe. */
const FORMAS = [
  { codigo: "DINHEIRO", rotulo: "Dinheiro" },
  { codigo: "CARTAO_DEBITO", rotulo: "Débito" },
  { codigo: "CARTAO_CREDITO", rotulo: "Crédito" },
  { codigo: "PIX", rotulo: "PIX" },
] as const;

export function Venda(): ReactNode {
  const { cliente, usuario, sair } = useSessao();

  const [fase, setFase] = useState<Fase>("VENDENDO");
  const [venda, setVenda] = useState<VendaNaTela | undefined>(undefined);
  const [codigo, setCodigo] = useState("");
  const [forma, setForma] = useState<string>("DINHEIRO");
  const [valor, setValor] = useState("");
  const [troco, setTroco] = useState("0");
  const [avisoImpressao, setAvisoImpressao] = useState<string | undefined>(undefined);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);

  const campoCodigo = useRef<HTMLInputElement>(null);
  const campoValor = useRef<HTMLInputElement>(null);

  // O foco volta ao campo certo a cada mudança de fase. Sem isto o operador
  // teria de encontrar o campo com o mouse depois de cada pagamento.
  useEffect(() => {
    if (fase === "PAGANDO") campoValor.current?.select();
    else campoCodigo.current?.focus();
  }, [fase]);

  const bipar = useCallback(async (): Promise<void> => {
    const procurado = codigo.trim();
    if (procurado === "" || ocupado) return;

    setErro(undefined);
    setOcupado(true);

    try {
      const aberta =
        venda ??
        (await cliente.requisitar<VendaNaTela>("/api/vendas", {
          metodo: "POST",
          corpo: { estacaoId: identificadorDaEstacao() },
        }));

      // A resposta traz a venda inteira junto com o item. O total e o que falta
      // pagar vêm calculados do domínio: recalculá-los aqui duplicaria regra de
      // negócio no navegador (CLAUDE.md §9), e buscá-los numa segunda
      // requisição custaria uma ida ao servidor por bipada (RNF-03).
      const atualizada = await cliente.requisitar<{ venda: VendaNaTela }>(
        `/api/vendas/${aberta.id}/itens`,
        { metodo: "POST", corpo: { codigo: procurado } },
      );

      setVenda(atualizada.venda);
      setCodigo("");
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setOcupado(false);
      campoCodigo.current?.select();
    }
  }, [cliente, codigo, ocupado, venda]);

  const pagar = useCallback(async (): Promise<void> => {
    if (venda === undefined || ocupado) return;

    const centavos = valor.replace(/\D/g, "");
    if (centavos === "" || centavos === "0") return;

    const valorEmCentavos = centavos;

    setErro(undefined);
    setOcupado(true);

    try {
      const resposta = await cliente.requisitar<RespostaPagamento>(
        `/api/vendas/${venda.id}/pagamentos`,
        { metodo: "POST", corpo: { forma, valor: centavos } },
      );

      if (resposta.faltaPagar === "0") {
        // Fechou: finaliza sem pedir mais uma tecla. O troco fica na tela até o
        // operador começar a próxima venda — é o número que ele confere na mão.
        const finalizada = await cliente.requisitar<{ troco: string }>(
          `/api/vendas/${venda.id}/finalizar`,
          { metodo: "POST", corpo: {} },
        );

        setTroco(finalizada.troco);
        setFase("CONCLUIDA");

        // O cupom sai **depois** de a venda estar gravada, e nunca antes.
        // Imprimir primeiro e gravar depois produz o pior defeito deste tipo de
        // sistema: o cliente sai da loja com o cupom de uma venda que o caixa
        // não registrou.
        //
        // Falha de impressão vira aviso na tela, jamais erro — o dinheiro já
        // entrou, e dizer "falhou" faria o operador refazer a venda.
        const problema = await imprimirCupomDaVenda({
          cupom: {
            loja: { nome: "" },
            numero: venda.numero,
            emitidoEm: new Date(),
            operador: usuario?.nome ?? "",
            itens: venda.itens.map((item) => ({
              numero: item.numero,
              descricao: item.descricao,
              quantidade: item.quantidade.milesimos,
              unidade: item.quantidade.unidade,
              precoUnitario: item.precoUnitario,
              total: item.total,
            })),
            subtotal: venda.total,
            descontoTotal: "0",
            total: venda.total,
            pagamentos: [{ descricao: rotuloDaForma(forma), valor: valorEmCentavos }],
            troco: finalizada.troco,
            semValorFiscal: true,
          },
          houveDinheiro: forma === "DINHEIRO",
        });

        setAvisoImpressao(problema);
        return;
      }

      setVenda({ ...venda, faltaPagar: resposta.faltaPagar });
      setValor(resposta.faltaPagar);
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setOcupado(false);
    }
  }, [cliente, forma, ocupado, valor, venda]);

  function irParaPagamento(): void {
    if (venda === undefined || venda.itens.length === 0) return;

    setValor(venda.faltaPagar);
    setFase("PAGANDO");
  }

  function novaVenda(): void {
    setVenda(undefined);
    setCodigo("");
    setValor("");
    setForma("DINHEIRO");
    setTroco("0");
    setErro(undefined);
    setFase("VENDENDO");
  }

  if (fase === "CONCLUIDA") {
    return (
      <Concluida
        aviso={avisoImpressao}
        troco={troco}
        aoSeguir={novaVenda}
        numero={venda?.numero ?? 0}
        total={venda?.total ?? "0"}
      />
    );
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-tinta">
          Caixa {venda === undefined ? "" : `· Venda ${String(venda.numero)}`}
        </h1>
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <span>{usuario?.nome}</span>
          <Botao tom="discreto" onClick={() => void sair()}>
            Sair
          </Botao>
        </div>
      </header>

      {erro !== undefined && <ErroDeTela mensagem={erro} />}

      {fase === "VENDENDO" ? (
        <CampoTexto
          ref={campoCodigo}
          rotulo="Código do produto"
          numerico
          autoFocus
          value={codigo}
          onChange={(evento) => {
            setCodigo(evento.target.value);
          }}
          onKeyDown={(evento) => {
            if (evento.key !== "Enter") return;
            evento.preventDefault();

            if (codigo.trim() === "") irParaPagamento();
            else void bipar();
          }}
        />
      ) : (
        <Pagamento
          faltaPagar={venda?.faltaPagar ?? "0"}
          forma={forma}
          aoTrocarForma={setForma}
          valor={valor}
          aoTrocarValor={setValor}
          referencia={campoValor}
          ocupado={ocupado}
          aoConfirmar={() => void pagar()}
          aoVoltar={() => {
            setFase("VENDENDO");
          }}
        />
      )}

      <Carrinho itens={venda?.itens ?? []} />

      <footer className="mt-auto flex items-baseline justify-between rounded-lg border border-borda bg-papel p-4">
        <span className="text-sm text-tinta-suave">Total</span>
        {/* `aria-live`: o total muda a cada bipada sem que o foco saia do campo
            de código, e quem usa leitor de tela precisa ouvir a mudança. */}
        <strong
          aria-label="Total da venda"
          aria-live="polite"
          className="font-numero text-4xl font-semibold text-tinta"
        >
          {formatarDinheiro(venda?.total ?? "0")}
        </strong>
      </footer>
    </main>
  );
}

function Carrinho({ itens }: { readonly itens: readonly ItemNaTela[] }): ReactNode {
  if (itens.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-borda p-6 text-center text-sm text-tinta-suave">
        Bipe o primeiro produto para começar a venda.
      </p>
    );
  }

  return (
    <ol className="flex flex-col gap-1" aria-label="Itens da venda">
      {/* Ordem invertida: o último bipado fica no topo, que é onde o operador
          olha para confirmar que registrou o produto certo. */}
      {[...itens].reverse().map((item) => (
        <li
          key={item.numero}
          className="flex items-baseline justify-between gap-3 rounded-md border border-borda bg-papel px-3 py-2"
        >
          <span className="text-tinta">{item.descricao}</span>
          <span className="font-numero text-sm text-tinta-suave">
            {formatarQuantidade(item.quantidade.milesimos)} {item.quantidade.unidade} ×{" "}
            {formatarDinheiro(item.precoUnitario)}
          </span>
          <strong className="font-numero text-tinta">
            {formatarDinheiro(item.total)}
          </strong>
        </li>
      ))}
    </ol>
  );
}

interface PropsPagamento {
  readonly faltaPagar: string;
  readonly forma: string;
  readonly aoTrocarForma: (forma: string) => void;
  readonly valor: string;
  readonly aoTrocarValor: (valor: string) => void;
  readonly referencia: React.RefObject<HTMLInputElement | null>;
  readonly ocupado: boolean;
  readonly aoConfirmar: () => void;
  readonly aoVoltar: () => void;
}

function Pagamento(props: PropsPagamento): ReactNode {
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-borda bg-papel p-4"
      aria-label="Pagamento"
      onKeyDown={(evento) => {
        if (evento.key === "Escape") {
          // Volta para a bipagem: o operador lembrou de um item.
          evento.preventDefault();
          props.aoVoltar();
        }
      }}
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-tinta">Pagamento</h2>
        <span className="text-sm text-tinta-suave">
          Falta{" "}
          <strong className="font-numero text-tinta">
            {formatarDinheiro(props.faltaPagar)}
          </strong>
        </span>
      </div>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Forma de pagamento">
        {FORMAS.map((opcao, indice) => (
          <Botao
            key={opcao.codigo}
            tom={props.forma === opcao.codigo ? "primario" : "discreto"}
            onClick={() => {
              props.aoTrocarForma(opcao.codigo);
            }}
            aria-pressed={props.forma === opcao.codigo}
          >
            {String(indice + 1)} · {opcao.rotulo}
          </Botao>
        ))}
      </div>

      <CampoTexto
        ref={props.referencia}
        rotulo="Valor recebido (centavos)"
        numerico
        autoFocus
        value={props.valor}
        onChange={(evento) => {
          props.aoTrocarValor(evento.target.value);
        }}
        onKeyDown={(evento) => {
          // Teclas 1 a 4 trocam a forma sem sair do campo. O operador digita o
          // valor e escolhe a forma na mesma posição de mão.
          const escolha = FORMAS[Number(evento.key) - 1];
          if (evento.altKey && escolha !== undefined) {
            evento.preventDefault();
            props.aoTrocarForma(escolha.codigo);
            return;
          }

          if (evento.key === "Enter") {
            evento.preventDefault();
            props.aoConfirmar();
          }
        }}
      />

      <Botao
        tamanho="grande"
        ocupado={props.ocupado}
        rotuloOcupado="Registrando…"
        onClick={props.aoConfirmar}
      >
        Receber
      </Botao>
    </section>
  );
}

/** Rótulo da forma como ele sai no cupom. */
function rotuloDaForma(codigo: string): string {
  return FORMAS.find((atual) => atual.codigo === codigo)?.rotulo ?? codigo;
}

function Concluida(props: {
  readonly aviso?: string | undefined;
  readonly troco: string;
  readonly numero: number;
  readonly total: string;
  readonly aoSeguir: () => void;
}): ReactNode {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center gap-6 p-6"
      onKeyDown={(evento) => {
        if (evento.key === "Enter") props.aoSeguir();
      }}
      // `tabIndex` para a tela receber o Enter sem o operador clicar em nada.
      tabIndex={-1}
      ref={(elemento) => {
        elemento?.focus();
      }}
    >
      <p className="text-sm text-tinta-suave">
        Venda {String(props.numero)} concluída · {formatarDinheiro(props.total)}
      </p>

      <div className="flex flex-col items-center gap-1">
        <span className="text-sm text-tinta-suave">Troco</span>
        {/* O troco é o número que o operador confere na mão, e por isso é o
            maior elemento da tela. */}
        <strong className="font-numero text-6xl font-semibold text-tinta">
          {formatarDinheiro(props.troco)}
        </strong>
      </div>

      {props.aviso !== undefined && (
        // Aviso, não erro: a venda aconteceu e o dinheiro entrou. Pintar isto
        // de vermelho de falha faria o operador refazer a venda — que é como se
        // cobra o cliente duas vezes.
        <p
          role="status"
          className="rounded-md border border-atencao bg-atencao-suave px-4 py-2 text-center text-tinta"
        >
          {props.aviso}
        </p>
      )}

      <Botao tamanho="grande" autoFocus onClick={props.aoSeguir}>
        Nova venda (Enter)
      </Botao>
    </main>
  );
}
