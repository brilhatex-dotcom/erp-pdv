import { ErroDaApi, mensagemDe } from "@erp/cliente-api";
import { Botao, CampoTexto, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import type { ApiDoBalcao } from "../api/servidor.js";
import type {
  Atalhos,
  ClienteDoBalcao,
  Comprovante,
  ContextoDoPdv,
  ItemNoFio,
  ProdutoDoBalcao,
  QuantidadeNoFio,
  VendaNoFio,
  VendaRecente,
} from "../api/tipos.js";
import { BotoesRapidos } from "../componentes/BotoesRapidos.js";
import { Concluida, type EstadoImpressao } from "../componentes/Concluida.js";
import { ModalSupervisor, useLiberacao } from "../componentes/Liberacao.js";
import { ListaItens, UltimaLeitura } from "../componentes/ListaItens.js";
import { ErroDaJanela } from "../componentes/Modal.js";
import {
  marcarOrientacaoVista,
  ModalAjuda,
  orientacaoJaVista,
} from "../componentes/ModalAjuda.js";
import { ModalCancelar } from "../componentes/ModalCancelar.js";
import { ModalCliente } from "../componentes/ModalCliente.js";
import { ModalConfirmar } from "../componentes/ModalConfirmar.js";
import { ModalDesconto, type PedidoDeDesconto } from "../componentes/ModalDesconto.js";
import { type DevolucaoFeita, ModalDevolucao } from "../componentes/ModalDevolucao.js";
import { ModalEscolherVenda } from "../componentes/ModalEscolherVenda.js";
import { ModalGuardadas } from "../componentes/ModalGuardadas.js";
import { ModalMenuCaixa, type OpcaoDoMenu } from "../componentes/ModalMenuCaixa.js";
import { ModalMovimento, type TipoMovimento } from "../componentes/ModalMovimento.js";
import { ModalPeso } from "../componentes/ModalPeso.js";
import { ModalProcurar } from "../componentes/ModalProcurar.js";
import { ModalQuantidade } from "../componentes/ModalQuantidade.js";
import {
  type ClienteNaVenda,
  Pagamento,
  type PedidoDePagamento,
} from "../componentes/Pagamento.js";
import { PainelTotais } from "../componentes/PainelTotais.js";
import { descreverPagamento, rotuloDaForma } from "../formas.js";
import { novoIdentificador } from "../identificadores.js";
import { ComprovanteImpresso } from "../impressao/ComprovanteImpresso.js";
import {
  abrirGaveta,
  imprimirComprovante,
  imprimirSemConexao,
  type ResultadoImpressao,
  teveDinheiro,
} from "../impressao/comprovante.js";
import { interpretarLeitura } from "../leitura.js";
import {
  biparItem,
  descartarNaFila,
  finalizar,
  type Leitura,
  type Origem,
  pagar,
  VendaIndisponivel,
} from "../vendaComQueda.js";
import { IndicadorConexao } from "./IndicadorConexao.js";

/**
 * A tela de venda — o balcão inteiro numa tela só.
 *
 * ### O foco mora no campo de código
 *
 * Tudo começa e termina nele: o leitor de código de barras digita ali, o
 * operador digita ali, e toda janela que fecha devolve o foco para ali. Se o
 * foco escapar para um botão (um toque no botão rápido, um clique no item), a
 * primeira tecla de caractere o traz de volta — e a bipada que chegou nesse
 * instante não se perde.
 *
 * ### As leituras entram em fila
 *
 * O leitor bipa mais rápido do que o servidor responde. Cada leitura entra
 * numa fila e é lançada na ordem, uma de cada vez: a segunda bipada não
 * espera a primeira voltar para ser aceita, e nenhuma apaga a outra.
 *
 * ### A venda começa na primeira bipada
 *
 * Não há botão "iniciar venda". Enter no campo vazio vai para o pagamento, e
 * quando não falta nada a venda fecha sozinha, com o troco em destaque.
 *
 * ### Nenhuma regra mora aqui
 *
 * Total, desconto rateado, troco, limite de desconto, estoque e fiado são
 * decididos pelo servidor. A tela pede, mostra o que voltou e, quando a
 * resposta é "precisa do supervisor", abre a liberação e repete o pedido.
 */

type Janela =
  | {
      readonly tipo: "PESO";
      readonly produto: {
        readonly codigo: string;
        readonly descricao: string;
        readonly precoVenda: string;
      };
    }
  | { readonly tipo: "PROCURAR"; readonly termo: string }
  | { readonly tipo: "QUANTIDADE"; readonly item: ItemNoFio }
  | { readonly tipo: "DESCONTO" }
  | { readonly tipo: "CLIENTE" }
  | { readonly tipo: "TIRAR_ITEM"; readonly item: ItemNoFio }
  | { readonly tipo: "CANCELAR" }
  | { readonly tipo: "ESCOLHER_PARA_CANCELAR" }
  | {
      readonly tipo: "CANCELAR_CONCLUIDA";
      readonly venda: {
        readonly id: string;
        readonly numero: number;
        readonly total: string;
      };
    }
  | { readonly tipo: "DESISTIR_SEM_CONEXAO" }
  | { readonly tipo: "GUARDADAS" }
  | { readonly tipo: "MENU" }
  | { readonly tipo: "MOVIMENTO"; readonly movimento: TipoMovimento }
  | { readonly tipo: "REIMPRIMIR" }
  | { readonly tipo: "DEVOLUCAO" }
  | { readonly tipo: "AJUDA"; readonly primeiraVez: boolean };

type Atalho =
  | "AJUDA"
  | "PROCURAR"
  | "QUANTIDADE"
  | "DESCONTO"
  | "CLIENTE"
  | "GUARDADAS"
  | "TIRAR"
  | "CANCELAR"
  | "RECEBER";

/** F5, F11 e F12 ficam com o navegador: recarregar é a saída de emergência. */
const TECLAS: Readonly<Record<string, Atalho>> = {
  F1: "AJUDA",
  F2: "PROCURAR",
  F3: "QUANTIDADE",
  F4: "DESCONTO",
  F6: "CLIENTE",
  F7: "GUARDADAS",
  F8: "TIRAR",
  F9: "CANCELAR",
  F10: "RECEBER",
};

interface VendaConcluida {
  readonly venda: VendaNoFio;
  readonly origem: Origem;
  readonly impressao: EstadoImpressao;
}

interface LeituraNaFila {
  readonly leitura: Leitura;
  /** Texto com letra: se o código não existir, abre a busca por nome. */
  readonly podeSerNome: boolean;
  /** Veio de uma janela (peso, busca): ela fecha quando o item entrar. */
  readonly daJanela: boolean;
}

const SO_COM_SERVIDOR =
  "Sem conexão com o servidor, só dá para bipar, receber e concluir. Isto volta quando a rede voltar.";

/** O produto que acompanha `PRODUTO_EXIGE_PESO` — validado, porque vem do fio. */
const zPedidoDePeso = z.object({
  produto: z.object({
    codigo: z.string().min(1),
    descricao: z.string().min(1),
    precoVenda: z.string().regex(/^\d+$/),
  }),
});

export interface PropsTelaDeVenda {
  readonly api: ApiDoBalcao;
  readonly contexto: ContextoDoPdv;
  readonly estacaoId: string;
  /** A venda que ficou aberta quando a tela fechou — F5, queda de energia. */
  readonly recuperada: VendaNoFio | undefined;
  readonly aoFecharCaixa: () => void;
  readonly aoSair: () => void;
}

export function TelaDeVenda(props: PropsTelaDeVenda): ReactNode {
  const { api, contexto, estacaoId } = props;
  const { operador, configuracao } = contexto;
  const treinamento = contexto.modo === "TREINAMENTO";
  const usaBotoes = configuracao.recursos.includes("BOTOES_RAPIDOS");
  const fiadoLigado = configuracao.recursos.includes("FIADO");

  const contextoVenda = useMemo(
    () => ({ api, estacaoId, operadorId: operador.id }),
    [api, estacaoId, operador.id],
  );

  // A venda e a origem vivem também em referência: a fila de leituras e a
  // liberação do supervisor repetem pedidos **depois** de a tela já ter mudado,
  // e precisam da venda de agora, não da que existia quando a tecla foi
  // apertada.
  const [venda, setVendaNaTela] = useState<VendaNoFio | undefined>(props.recuperada);
  const vendaAtual = useRef(props.recuperada);
  const [origem, setOrigemNaTela] = useState<Origem>("SERVIDOR");
  const origemAtual = useRef<Origem>("SERVIDOR");

  const [cliente, setCliente] = useState<ClienteNaVenda | undefined>(undefined);
  const [codigo, setCodigo] = useState("");
  const [selecionado, setSelecionado] = useState<number | undefined>(
    props.recuperada?.itens.at(-1)?.numero,
  );
  const [ultima, setUltima] = useState<
    { readonly item: ItemNoFio; readonly somado: boolean } | undefined
  >(undefined);
  const [fase, setFase] = useState<"VENDENDO" | "PAGANDO">("VENDENDO");
  const [janela, setJanela] = useState<Janela | undefined>(() =>
    orientacaoJaVista() ? undefined : { tipo: "AJUDA", primeiraVez: true },
  );
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [aviso, setAviso] = useState<string | undefined>(() =>
    props.recuperada !== undefined && props.recuperada.itens.length > 0
      ? `Venda ${String(props.recuperada.numero)} recuperada: continue de onde parou.`
      : undefined,
  );
  const [ocupado, setOcupado] = useState(false);
  const [concluida, setConcluida] = useState<VendaConcluida | undefined>(undefined);
  const [noNavegador, setNoNavegador] = useState<
    { readonly comprovante: Comprovante; readonly segundaVia: boolean } | undefined
  >(undefined);
  const [atalhos, setAtalhos] = useState<Atalhos | undefined>(undefined);
  const [categoria, setCategoria] = useState<string | undefined>(undefined);
  const [daCategoria, setDaCategoria] = useState<readonly ProdutoDoBalcao[] | undefined>(
    undefined,
  );

  const campoCodigo = useRef<HTMLInputElement>(null);
  const chavePagamento = useRef<string | undefined>(undefined);
  const emAndamento = useRef(false);
  const filaDeLeituras = useRef<LeituraNaFila[]>([]);
  const { pedido, comLiberacao, confirmar: liberar, desistir } = useLiberacao();

  const definirVenda = useCallback((nova: VendaNoFio | undefined): void => {
    vendaAtual.current = nova;
    setVendaNaTela(nova);
  }, []);

  const definirOrigem = useCallback((nova: Origem): void => {
    origemAtual.current = nova;
    setOrigemNaTela(nova);
  }, []);

  const pode = (permissao: string): boolean => operador.permissoes.includes(permissao);

  // ── Catálogo dos botões rápidos ────────────────────────────────────────

  useEffect(() => {
    if (!usaBotoes) return;
    let vivo = true;

    api
      .atalhos()
      .then((resposta) => {
        if (vivo) setAtalhos(resposta);
      })
      .catch(() => {
        // Sem os botões, a venda continua pelo código e pela busca: falhar
        // aqui não pode virar mensagem de erro na cara do operador.
        if (vivo) setAtalhos({ categorias: [], botoes: [] });
      });

    return (): void => {
      vivo = false;
    };
  }, [api, usaBotoes]);

  useEffect(() => {
    setDaCategoria(undefined);
    if (categoria === undefined) return;
    let vivo = true;

    api
      .buscarProdutos({ categoriaId: categoria })
      .then((produtos) => {
        if (vivo) setDaCategoria(produtos);
      })
      .catch(() => {
        if (vivo) setDaCategoria([]);
      });

    return (): void => {
      vivo = false;
    };
  }, [api, categoria]);

  // ── Foco ───────────────────────────────────────────────────────────────

  useEffect(() => {
    // Só `focus`, nunca `select`: o leitor pode estar no meio da próxima
    // bipada quando a anterior volta, e selecionar o que ele já digitou faria
    // o próximo dígito apagar o resto.
    if (janela === undefined && pedido === undefined && fase === "VENDENDO" && !ocupado) {
      campoCodigo.current?.focus();
    }
  }, [janela, pedido, fase, ocupado]);

  // ── Execução ───────────────────────────────────────────────────────────

  /**
   * Uma operação de cada vez, e o erro dela na tela.
   *
   * A trava é uma referência, e não o estado `ocupado`: dois Enter no mesmo
   * instante chegam antes de o React redesenhar, e só a referência os vê. É
   * ela que impede o pagamento em dobro no clique duplo.
   */
  async function executar(acao: () => Promise<void>): Promise<void> {
    if (emAndamento.current) {
      setAviso("Um instante: a operação anterior ainda está terminando.");
      return;
    }

    emAndamento.current = true;
    setOcupado(true);
    setErro(undefined);

    try {
      await acao();
    } catch (causa) {
      setErro(paraOperador(causa));
    } finally {
      emAndamento.current = false;
      setOcupado(false);
    }
  }

  function limparVenda(): void {
    definirVenda(undefined);
    definirOrigem("SERVIDOR");
    setCliente(undefined);
    setSelecionado(undefined);
    setUltima(undefined);
    setFase("VENDENDO");
    chavePagamento.current = undefined;
  }

  function exigirServidor(): boolean {
    if (origemAtual.current === "SERVIDOR") return true;

    setAviso(SO_COM_SERVIDOR);
    return false;
  }

  function vendaComItens(): VendaNoFio | undefined {
    const atual = vendaAtual.current;
    if (atual !== undefined && atual.itens.length > 0) return atual;

    setAviso("Bipe um produto primeiro.");
    return undefined;
  }

  /** O item selecionado — e, sem seleção, o último lido, que está no alto da lista. */
  function itemEscolhido(): ItemNoFio | undefined {
    const atual = vendaComItens();

    return (
      atual?.itens.find((item) => item.numero === selecionado) ?? atual?.itens.at(-1)
    );
  }

  // ── Leitura ────────────────────────────────────────────────────────────

  function enfileirar(leitura: LeituraNaFila): void {
    setAviso(undefined);
    setErro(undefined);
    setConcluida(undefined);
    filaDeLeituras.current.push(leitura);
    void processarFila();
  }

  async function processarFila(): Promise<void> {
    if (emAndamento.current) return;

    emAndamento.current = true;
    setOcupado(true);

    try {
      for (
        let proxima = filaDeLeituras.current.shift();
        proxima !== undefined;
        proxima = filaDeLeituras.current.shift()
      ) {
        await lancar(proxima);
      }
    } finally {
      emAndamento.current = false;
      setOcupado(false);
    }
  }

  async function lancar({
    leitura,
    podeSerNome,
    daJanela,
  }: LeituraNaFila): Promise<void> {
    try {
      const bipado = await comLiberacao((supervisor) =>
        biparItem(
          contextoVenda,
          origemAtual.current,
          vendaAtual.current,
          { ...leitura, supervisor },
          definirVenda,
        ),
      );

      if (bipado === undefined) return;

      definirVenda(bipado.venda);
      definirOrigem(bipado.origem);

      const item = bipado.item ?? bipado.venda.itens.at(-1);
      setSelecionado(item?.numero);
      setUltima(item === undefined ? undefined : { item, somado: bipado.somado });
      if (daJanela) setJanela(undefined);
    } catch (causa) {
      if (desviar(causa, leitura, podeSerNome)) return;

      const mensagem = paraOperador(causa);
      setErro(daJanela ? mensagem : `${mensagem} (código ${leitura.codigo})`);
    }
  }

  /**
   * As recusas que não são erro: o produto pede peso, ou o texto era um nome.
   *
   * Nos dois casos a tela abre a janela certa já preenchida, e o operador
   * segue sem ler mensagem nenhuma.
   */
  function desviar(causa: unknown, leitura: Leitura, podeSerNome: boolean): boolean {
    if (!(causa instanceof ErroDaApi)) return false;

    if (causa.codigo === "PRODUTO_EXIGE_PESO") {
      const pedidoDePeso = zPedidoDePeso.safeParse(causa.detalhes);
      if (!pedidoDePeso.success) return false;

      setJanela({ tipo: "PESO", produto: pedidoDePeso.data.produto });
      return true;
    }

    if (causa.codigo === "PRODUTO_NAO_ENCONTRADO" && podeSerNome) {
      setJanela({ tipo: "PROCURAR", termo: leitura.codigo });
      return true;
    }

    return false;
  }

  function aoConfirmarCodigo(): void {
    const leitura = interpretarLeitura(codigo);

    switch (leitura.tipo) {
      case "VAZIO":
        if (concluida !== undefined && vendaAtual.current === undefined) {
          setConcluida(undefined);
          return;
        }
        irParaPagamento();
        return;

      case "INVALIDA":
        setErro(leitura.mensagem);
        return;

      case "CODIGO":
        setCodigo("");
        enfileirar({
          leitura: { codigo: leitura.codigo, multiplicador: leitura.multiplicador },
          podeSerNome: leitura.podeSerNome,
          daJanela: false,
        });
    }
  }

  function escolherProduto(produto: ProdutoDoBalcao): void {
    if (produto.tipo === "PESAVEL") {
      setJanela({
        tipo: "PESO",
        produto: {
          codigo: produto.sku,
          descricao: produto.descricao,
          precoVenda: produto.precoVenda,
        },
      });
      return;
    }

    setJanela(undefined);
    campoCodigo.current?.focus();
    enfileirar({ leitura: { codigo: produto.sku }, podeSerNome: false, daJanela: false });
  }

  function lancarPeso(codigoDoProduto: string, peso: QuantidadeNoFio): void {
    enfileirar({
      leitura: { codigo: codigoDoProduto, quantidade: peso },
      podeSerNome: false,
      daJanela: true,
    });
  }

  function moverSelecao(passo: "ACIMA" | "ABAIXO"): void {
    const itens = vendaAtual.current?.itens ?? [];
    if (itens.length === 0) return;

    // A lista aparece invertida, o mais novo no alto: subir é ir para o mais
    // novo.
    const atual = itens.findIndex((item) => item.numero === selecionado);
    const partida = atual === -1 ? itens.length - 1 : atual;
    const destino = Math.min(
      Math.max(partida + (passo === "ACIMA" ? 1 : -1), 0),
      itens.length - 1,
    );

    setSelecionado(itens[destino]?.numero);
  }

  // ── Itens e venda ──────────────────────────────────────────────────────

  function alterarQuantidade(item: ItemNoFio, quantidade: QuantidadeNoFio): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    void executar(async () => {
      const alterada = await comLiberacao((supervisor) =>
        api.alterarQuantidade(atual.id, item.numero, quantidade, supervisor),
      );
      if (alterada === undefined) return;

      definirVenda(alterada);
      setUltima(undefined);
      setJanela(undefined);
    });
  }

  function tirarItem(item: ItemNoFio): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    void executar(async () => {
      const semItem = await comLiberacao((supervisor) =>
        api.removerItem(atual.id, item.numero, supervisor),
      );
      if (semItem === undefined) return;

      definirVenda(semItem);
      setSelecionado(semItem.itens.at(-1)?.numero);
      setUltima(undefined);
      setJanela(undefined);
      setAviso(`${item.descricao} saiu da venda.`);
    });
  }

  function aplicarDesconto(pedidoDeDesconto: PedidoDeDesconto): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    void executar(async () => {
      const comDesconto = await comLiberacao((supervisor) =>
        api.aplicarDesconto(atual.id, { ...pedidoDeDesconto, supervisor }),
      );
      if (comDesconto === undefined) return;

      definirVenda(comDesconto);
      setJanela(undefined);
    });
  }

  function escolherCliente(escolhido: ClienteDoBalcao): void {
    void executar(async () => {
      // O cliente pode vir antes do primeiro item — "é pro fiado do seu Zé".
      const atual = vendaAtual.current ?? (await api.iniciarVenda(estacaoId));
      definirVenda(atual);

      definirVenda(await api.identificarCliente(atual.id, escolhido.id));
      setCliente({
        id: escolhido.id,
        nome: escolhido.nome,
        vendeAPrazo: escolhido.vendeAPrazo,
        disponivel: escolhido.disponivel,
      });
      setJanela(undefined);
    });
  }

  function tirarCliente(): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    void executar(async () => {
      definirVenda(await api.identificarCliente(atual.id, null));
      setCliente(undefined);
      setJanela(undefined);
    });
  }

  function guardar(rotulo: string): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    void executar(async () => {
      await api.suspender(atual.id, rotulo);
      limparVenda();
      setJanela(undefined);
      setAviso(
        rotulo === ""
          ? "Venda guardada. Para retomar, aperte F7."
          : `Venda "${rotulo}" guardada. Para retomar, aperte F7.`,
      );
    });
  }

  function retomar(guardada: VendaNoFio): void {
    void executar(async () => {
      // A venda vazia da tela não vira mais uma guardada esquecida.
      const atual = vendaAtual.current;
      if (
        atual !== undefined &&
        atual.itens.length === 0 &&
        atual.pagamentos.length === 0
      ) {
        await api.cancelar(atual.id, "Venda vazia descartada");
      }

      const retomada = await api.retomar(guardada.id, estacaoId);
      limparVenda();
      definirVenda(retomada);
      setSelecionado(retomada.itens.at(-1)?.numero);
      setJanela(undefined);
      setAviso(`Venda ${String(retomada.numero)} retomada.`);
    });
  }

  function pedirCancelamento(): void {
    const atual = vendaAtual.current;

    if (atual === undefined) {
      // Logo depois de concluir, F9 cancela a venda que acabou de fechar — é
      // o "passou errado, cancela" com o cliente ainda no balcão.
      if (concluida !== undefined && concluida.origem === "SERVIDOR") {
        setJanela({ tipo: "CANCELAR_CONCLUIDA", venda: concluida.venda });
        return;
      }

      setAviso("Não há venda em andamento para cancelar.");
      return;
    }

    if (origemAtual.current === "FILA") {
      setJanela({ tipo: "DESISTIR_SEM_CONEXAO" });
      return;
    }

    // Venda sem nada não pede motivo: não há o que auditar nem o que perder.
    if (atual.itens.length === 0 && atual.pagamentos.length === 0) {
      cancelar("Venda vazia descartada");
      return;
    }

    setJanela({ tipo: "CANCELAR" });
  }

  function cancelar(motivo: string): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    void executar(async () => {
      const resposta = await comLiberacao((supervisor) =>
        api.cancelar(atual.id, motivo, supervisor),
      );
      if (resposta === undefined) return;

      limparVenda();
      setJanela(undefined);
      setAviso(avisoDeCancelamento(atual));
    });
  }

  /**
   * Cancela a venda já concluída: estorna tudo, e a tela diz o que devolver,
   * forma a forma — o sistema estorna o registro, mas o dinheiro, o Pix e o
   * cartão quem devolve é o operador.
   */
  function cancelarConcluida(
    alvo: { readonly id: string; readonly numero: number },
    motivo: string,
  ): void {
    void executar(async () => {
      const resposta = await comLiberacao((supervisor) =>
        api.cancelar(alvo.id, motivo, supervisor),
      );
      if (resposta === undefined) return;

      setJanela(undefined);
      setConcluida((atual) => (atual?.venda.id === alvo.id ? undefined : atual));

      const devolver = resposta.estornos
        .map(
          (estorno) =>
            `${rotuloDaForma(estorno.forma)} ${formatarDinheiro(estorno.valor)}`,
        )
        .join(", ");
      setAviso(
        devolver === ""
          ? `Venda ${String(alvo.numero)} cancelada.`
          : `Venda ${String(alvo.numero)} cancelada. Devolva ao cliente: ${devolver}.`,
      );

      if (resposta.estornos.some((estorno) => estorno.forma === "DINHEIRO"))
        void abrirGaveta();
    });
  }

  function desistirSemConexao(): void {
    void executar(async () => {
      await descartarNaFila();
      limparVenda();
      setJanela(undefined);
      setAviso("Venda descartada.");
    });
  }

  // ── Pagamento ──────────────────────────────────────────────────────────

  function irParaPagamento(): void {
    if (filaDeLeituras.current.length > 0 || emAndamento.current) {
      setAviso("Um instante: ainda lançando os itens.");
      return;
    }

    const atual = vendaComItens();
    if (atual === undefined) return;

    setErro(undefined);
    setAviso(undefined);
    setFase("PAGANDO");
  }

  function registrarPagamento(pedidoDePagamento: PedidoDePagamento): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    // A mesma chave até o pagamento entrar: o Enter repetido depois de uma
    // resposta perdida é reconhecido pelo servidor, e não cobra duas vezes.
    chavePagamento.current ??= novoIdentificador();
    const chave = chavePagamento.current;

    void executar(async () => {
      const paga = await comLiberacao((supervisor) =>
        pagar(contextoVenda, origemAtual.current, atual, {
          ...pedidoDePagamento,
          chave,
          confirmacao: confirmacaoDe(pedidoDePagamento.forma, treinamento),
          supervisor,
        }),
      );
      if (paga === undefined) return;

      chavePagamento.current = undefined;
      definirVenda(paga);

      if (paga.faltaPagar === "0") await concluirVenda(paga);
    });
  }

  function tirarPagamento(indice: number): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    void executar(async () => {
      definirVenda(await api.removerPagamento(atual.id, indice));
    });
  }

  function concluirPaga(): void {
    const atual = vendaAtual.current;
    if (atual === undefined) return;

    void executar(() => concluirVenda(atual));
  }

  async function concluirVenda(paga: VendaNoFio): Promise<void> {
    const de = origemAtual.current;
    const finalizada = await finalizar(contextoVenda, de, paga);
    const imprimeSozinho = configuracao.impressaoComprovante === "SEMPRE";

    setConcluida({
      venda: finalizada,
      origem: de,
      impressao: imprimeSozinho ? { tipo: "IMPRIMINDO" } : { tipo: "NAO_PEDIDA" },
    });
    limparVenda();

    // A gaveta abre uma vez: com o comprovante, quando ele sai sozinho; sem
    // papel, quando a loja imprime só sob pedido.
    if (imprimeSozinho) {
      void imprimirConcluida(finalizada, de, true);
    } else if (teveDinheiro(finalizada)) {
      void abrirGaveta().then(setAviso);
    }
  }

  // ── Impressão ──────────────────────────────────────────────────────────

  const terminarNoNavegador = useCallback((): void => {
    setNoNavegador(undefined);
  }, []);

  async function imprimirConcluida(
    alvo: VendaNoFio,
    de: Origem,
    abrindoGaveta: boolean,
  ): Promise<void> {
    const marcar = (impressao: EstadoImpressao): void => {
      setConcluida((atual) =>
        atual?.venda.id === alvo.id ? { ...atual, impressao } : atual,
      );
    };

    marcar({ tipo: "IMPRIMINDO" });

    const resultado =
      de === "FILA"
        ? await imprimirSemConexao(alvo, {
            loja: contexto.loja?.nome,
            operador: operador.nome,
            larguraCupom: configuracao.larguraCupom,
            treinamento,
            abrirGaveta: abrindoGaveta,
          })
        : await imprimirComprovante(api, alvo.id, {
            segundaVia: false,
            abrirGaveta: abrindoGaveta,
          });

    if (resultado.via === "NAVEGADOR") {
      setNoNavegador({ comprovante: resultado.comprovante, segundaVia: false });
    }

    marcar(estadoDaImpressao(resultado));
  }

  function pedirImpressao(): void {
    if (concluida !== undefined) {
      if (concluida.impressao.tipo !== "IMPRIMINDO") {
        void imprimirConcluida(concluida.venda, concluida.origem, false);
      }
      return;
    }

    setJanela({ tipo: "REIMPRIMIR" });
  }

  function reimprimir(alvo: VendaRecente): void {
    void executar(async () => {
      const resultado = await imprimirComprovante(api, alvo.id, {
        segundaVia: true,
        abrirGaveta: false,
      });
      setJanela(undefined);

      if (resultado.via === "NAVEGADOR") {
        setNoNavegador({ comprovante: resultado.comprovante, segundaVia: true });
        return;
      }

      setAviso(
        resultado.via === "FALHOU" || resultado.aviso !== undefined
          ? resultado.aviso
          : `Segunda via da venda ${String(alvo.numero)} impressa.`,
      );
    });
  }

  // ── Caixa ──────────────────────────────────────────────────────────────

  function movimentar(
    tipo: TipoMovimento,
    movimento: { readonly valor: string; readonly motivo: string },
  ): void {
    void executar(async () => {
      const feito = await comLiberacao((supervisor) =>
        api.movimentarCaixa(tipo, { estacaoId, ...movimento, supervisor }),
      );
      if (feito === undefined) return;

      setJanela(undefined);
      setAviso(
        tipo === "sangria"
          ? `Sangria de ${formatarDinheiro(movimento.valor)} registrada.`
          : `Suprimento de ${formatarDinheiro(movimento.valor)} registrado.`,
      );
      void abrirGaveta();
    });
  }

  function devolvida(feita: DevolucaoFeita): void {
    setJanela(undefined);
    setAviso(instrucaoDeReembolso(feita));
    if (feita.formaReembolso === "DINHEIRO") void abrirGaveta();
  }

  function escolherNoMenu(opcao: OpcaoDoMenu): void {
    switch (opcao) {
      case "SUPRIMENTO":
        setJanela({ tipo: "MOVIMENTO", movimento: "suprimento" });
        return;
      case "SANGRIA":
        setJanela({ tipo: "MOVIMENTO", movimento: "sangria" });
        return;
      case "REIMPRIMIR":
        setJanela({ tipo: "REIMPRIMIR" });
        return;
      case "DEVOLUCAO":
        setJanela({ tipo: "DEVOLUCAO" });
        return;
      case "CANCELAR_CONCLUIDA":
        setJanela({ tipo: "ESCOLHER_PARA_CANCELAR" });
        return;
      case "FECHAR_CAIXA":
        setJanela(undefined);
        props.aoFecharCaixa();
        return;
      case "TROCAR_OPERADOR":
        setJanela(undefined);
        props.aoSair();
    }
  }

  // ── Atalhos ────────────────────────────────────────────────────────────

  function executarAtalho(atalho: Atalho): void {
    switch (atalho) {
      case "AJUDA":
        setJanela({ tipo: "AJUDA", primeiraVez: false });
        return;

      case "PROCURAR": {
        // O nome já digitado no campo vira o começo da busca.
        const termo = /[a-zà-ú]/i.test(codigo) ? codigo.trim() : "";
        setCodigo("");
        setFase("VENDENDO");
        setJanela({ tipo: "PROCURAR", termo });
        return;
      }

      case "QUANTIDADE": {
        if (!exigirServidor()) return;
        const item = itemEscolhido();
        if (item !== undefined) setJanela({ tipo: "QUANTIDADE", item });
        return;
      }

      case "DESCONTO":
        if (exigirServidor() && vendaComItens() !== undefined)
          setJanela({ tipo: "DESCONTO" });
        return;

      case "CLIENTE":
        if (exigirServidor()) setJanela({ tipo: "CLIENTE" });
        return;

      case "GUARDADAS":
        if (exigirServidor()) setJanela({ tipo: "GUARDADAS" });
        return;

      case "TIRAR": {
        if (!exigirServidor()) return;
        const item = itemEscolhido();
        if (item !== undefined) setJanela({ tipo: "TIRAR_ITEM", item });
        return;
      }

      case "CANCELAR":
        pedirCancelamento();
        return;

      case "RECEBER":
        irParaPagamento();
    }
  }

  const teclar = useRef<(evento: KeyboardEvent) => void>(() => undefined);
  teclar.current = (evento: KeyboardEvent): void => {
    // Janela aberta cuida das próprias teclas.
    if (janela !== undefined || pedido !== undefined || noNavegador !== undefined) return;

    if (evento.ctrlKey && evento.key.toLowerCase() === "p") {
      // O atalho de imprimir do navegador imprime o que interessa: o
      // comprovante, e não a tela do caixa.
      evento.preventDefault();
      pedirImpressao();
      return;
    }

    const atalho = TECLAS[evento.key];
    if (atalho !== undefined) {
      evento.preventDefault();
      executarAtalho(atalho);
      return;
    }

    if (fase !== "VENDENDO") return;

    if (evento.key === "ArrowUp" || evento.key === "ArrowDown") {
      evento.preventDefault();
      moverSelecao(evento.key === "ArrowUp" ? "ACIMA" : "ABAIXO");
      return;
    }

    // O foco escapou para um botão e chegou uma tecla de caractere — quase
    // sempre o leitor de código. Volta para o campo antes de o caractere ser
    // escrito, e a bipada não se perde.
    const escrevendo =
      evento.key.length === 1 && !evento.ctrlKey && !evento.altKey && !evento.metaKey;
    if (escrevendo && !ehCampoDeTexto(document.activeElement))
      campoCodigo.current?.focus();
  };

  useEffect(() => {
    const ouvir = (evento: KeyboardEvent): void => {
      teclar.current(evento);
    };

    window.addEventListener("keydown", ouvir);
    return (): void => {
      window.removeEventListener("keydown", ouvir);
    };
  }, []);

  // ── Tela ───────────────────────────────────────────────────────────────

  const naTela = venda ?? concluida?.venda;
  const comItens = venda !== undefined && venda.itens.length > 0;
  const janelaAberta = janela !== undefined || pedido !== undefined;

  function fecharJanela(): void {
    setErro(undefined);
    setJanela(undefined);
  }

  const mensagens = (
    <>
      {!janelaAberta && erro !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-erro bg-erro-suave px-4 py-3 text-lg text-tinta"
        >
          {erro}
        </p>
      )}
      {aviso !== undefined && (
        <p
          role="status"
          className="rounded-md border border-borda bg-papel px-4 py-2 text-tinta"
        >
          {aviso}
        </p>
      )}
    </>
  );

  return (
    <ErroDaJanela.Provider value={janelaAberta ? erro : undefined}>
      <main className="flex h-screen flex-col gap-3 p-3">
        {treinamento && (
          <p
            role="note"
            className="rounded-md bg-atencao px-3 py-1 text-center font-semibold text-tinta"
          >
            MODO TREINAMENTO — nada do que acontece aqui vale como venda de verdade.
          </p>
        )}

        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-tinta">
              {contexto.loja?.nome ?? "Caixa"}
            </h1>
            <p className="text-sm text-tinta-suave">
              {rotuloDaVenda(venda, origem)} · {operador.nome}
            </p>
          </div>
          <Botao
            tom="secundario"
            onClick={() => {
              setJanela({ tipo: "MENU" });
            }}
          >
            Caixa: sangria, fechamento…
          </Botao>
        </header>

        <IndicadorConexao />

        {origem === "FILA" && (
          <p
            role="status"
            className="rounded-md border border-atencao bg-atencao-suave px-3 py-2 text-sm text-tinta"
          >
            Venda sem conexão com o servidor: bipe, receba e conclua normalmente.
            Desconto, cliente e guardar voltam quando a rede voltar.
          </p>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)] gap-3">
          <section
            aria-label="Venda"
            className="flex min-h-0 flex-col gap-3 overflow-y-auto"
          >
            {fase === "PAGANDO" && venda !== undefined ? (
              <>
                {mensagens}
                <Pagamento
                  venda={venda}
                  offline={origem === "FILA"}
                  fiadoLigado={fiadoLigado}
                  cliente={cliente}
                  ocupado={ocupado}
                  aoPagar={registrarPagamento}
                  aoTirar={tirarPagamento}
                  aoConcluir={concluirPaga}
                  aoPedirCliente={() => {
                    executarAtalho("CLIENTE");
                  }}
                  aoVoltar={() => {
                    setErro(undefined);
                    setFase("VENDENDO");
                  }}
                />
              </>
            ) : (
              <>
                <form
                  noValidate
                  onSubmit={(evento) => {
                    evento.preventDefault();
                    aoConfirmarCodigo();
                  }}
                >
                  <CampoTexto
                    ref={campoCodigo}
                    rotulo="Código do produto"
                    ajuda="Bipe, digite o código ou o nome. 3*código lança três."
                    autoComplete="off"
                    autoFocus
                    spellCheck={false}
                    className="min-h-14 text-2xl"
                    value={codigo}
                    onChange={(evento) => {
                      setErro(undefined);
                      setCodigo(evento.target.value);
                    }}
                  />
                </form>

                {mensagens}

                {concluida !== undefined && venda === undefined ? (
                  <Concluida
                    venda={concluida.venda}
                    offline={concluida.origem === "FILA"}
                    impressao={concluida.impressao}
                    aoImprimir={pedirImpressao}
                    aoNovaVenda={() => {
                      setConcluida(undefined);
                      campoCodigo.current?.focus();
                    }}
                  />
                ) : (
                  <UltimaLeitura item={ultima?.item} somado={ultima?.somado ?? false} />
                )}

                {usaBotoes && (
                  <BotoesRapidos
                    categorias={atalhos?.categorias ?? []}
                    categoriaAtiva={categoria}
                    produtos={
                      (categoria === undefined ? atalhos?.botoes : daCategoria) ?? []
                    }
                    carregando={
                      atalhos === undefined ||
                      (categoria !== undefined && daCategoria === undefined)
                    }
                    aoEscolherCategoria={(escolhida) => {
                      setCategoria(escolhida);
                      campoCodigo.current?.focus();
                    }}
                    aoEscolherProduto={escolherProduto}
                  />
                )}
              </>
            )}
          </section>

          <aside aria-label="Cupom" className="flex min-h-0 flex-col gap-3">
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ListaItens
                itens={naTela?.itens ?? []}
                selecionado={venda === undefined ? undefined : selecionado}
                destaque={
                  ultima === undefined
                    ? undefined
                    : { numero: ultima.item.numero, somado: ultima.somado }
                }
                aoSelecionar={(numero) => {
                  setSelecionado(numero);
                  campoCodigo.current?.focus();
                }}
              />
            </div>

            {(cliente !== undefined || venda?.clienteId !== undefined) && (
              <p className="rounded-md border border-borda bg-papel px-3 py-2 text-sm text-tinta">
                Cliente: <strong>{cliente?.nome ?? "identificado na venda"}</strong>
                {cliente?.vendeAPrazo === true &&
                  ` · fiado disponível ${formatarDinheiro(cliente.disponivel)}`}
              </p>
            )}

            <PainelTotais venda={naTela} />
          </aside>
        </div>

        <nav aria-label="Comandos do caixa" className="flex flex-wrap gap-2">
          <Comando
            tecla="F1"
            rotulo="Ajuda"
            aplicavel
            ocupado={false}
            aoUsar={executarAtalho}
            atalho="AJUDA"
          />
          <Comando
            tecla="F2"
            rotulo="Procurar"
            aplicavel
            ocupado={ocupado}
            aoUsar={executarAtalho}
            atalho="PROCURAR"
          />
          <Comando
            tecla="F3"
            rotulo="Quantidade"
            aplicavel={comItens}
            ocupado={ocupado}
            aoUsar={executarAtalho}
            atalho="QUANTIDADE"
          />
          <Comando
            tecla="F4"
            rotulo="Desconto"
            aplicavel={comItens}
            ocupado={ocupado}
            aoUsar={executarAtalho}
            atalho="DESCONTO"
          />
          <Comando
            tecla="F6"
            rotulo="Cliente"
            aplicavel
            ocupado={ocupado}
            aoUsar={executarAtalho}
            atalho="CLIENTE"
          />
          <Comando
            tecla="F7"
            rotulo={comItens ? "Guardar venda" : "Vendas guardadas"}
            aplicavel
            ocupado={ocupado}
            aoUsar={executarAtalho}
            atalho="GUARDADAS"
          />
          <Comando
            tecla="F8"
            rotulo="Tirar item"
            aplicavel={comItens}
            ocupado={ocupado}
            aoUsar={executarAtalho}
            atalho="TIRAR"
          />
          <Comando
            tecla="F9"
            rotulo="Cancelar venda"
            aplicavel={venda !== undefined || concluida !== undefined}
            ocupado={ocupado}
            aoUsar={executarAtalho}
            atalho="CANCELAR"
          />
          <Comando
            tecla="F10"
            rotulo="Receber"
            aplicavel={comItens}
            ocupado={ocupado}
            aoUsar={executarAtalho}
            atalho="RECEBER"
            destaque
          />
        </nav>
      </main>

      {janela?.tipo === "AJUDA" && (
        <ModalAjuda
          primeiraVez={janela.primeiraVez}
          aoFechar={() => {
            marcarOrientacaoVista();
            fecharJanela();
          }}
        />
      )}

      {janela?.tipo === "PESO" && (
        <ModalPeso
          produto={janela.produto}
          ocupado={ocupado}
          aoConfirmar={(peso) => {
            lancarPeso(janela.produto.codigo, peso);
          }}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "PROCURAR" && (
        <ModalProcurar
          api={api}
          termoInicial={janela.termo}
          aoEscolher={escolherProduto}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "QUANTIDADE" && (
        <ModalQuantidade
          item={janela.item}
          ocupado={ocupado}
          aoConfirmar={(quantidade) => {
            alterarQuantidade(janela.item, quantidade);
          }}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "DESCONTO" && venda !== undefined && (
        <ModalDesconto
          item={venda.itens.find((item) => item.numero === selecionado)}
          totalDaVenda={(BigInt(venda.subtotal) - BigInt(venda.descontoItens)).toString()}
          limiteItemBps={operador.limites.descontoMaximoItemBps}
          limiteVendaBps={operador.limites.descontoMaximoVendaBps}
          ocupado={ocupado}
          aoConfirmar={aplicarDesconto}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "CLIENTE" && (
        <ModalCliente
          api={api}
          atual={
            cliente ??
            (venda?.clienteId === undefined
              ? undefined
              : { nome: "identificado na venda" })
          }
          ocupado={ocupado}
          aoEscolher={escolherCliente}
          aoTirar={tirarCliente}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "TIRAR_ITEM" && (
        <ModalConfirmar
          titulo="Tirar item"
          rotuloConfirmar="Tirar da venda"
          ocupado={ocupado}
          rotuloOcupado="Tirando…"
          aoConfirmar={() => {
            tirarItem(janela.item);
          }}
          aoFechar={fecharJanela}
        >
          <p>
            Tirar <strong>{janela.item.descricao}</strong> (
            {formatarDinheiro(janela.item.total)}) da venda?
          </p>
        </ModalConfirmar>
      )}

      {janela?.tipo === "CANCELAR" && venda !== undefined && (
        <ModalCancelar
          numero={venda.numero}
          total={venda.total}
          concluida={false}
          ocupado={ocupado}
          aoConfirmar={cancelar}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "ESCOLHER_PARA_CANCELAR" && (
        <ModalEscolherVenda
          titulo="Cancelar venda concluída"
          rotuloAcao="Cancelar esta venda"
          api={api}
          estacaoId={estacaoId}
          ocupado={ocupado}
          serve={(candidata) =>
            candidata.status === "CANCELADA" ? "Já cancelada" : undefined
          }
          aoEscolher={(escolhida) => {
            setJanela({ tipo: "CANCELAR_CONCLUIDA", venda: escolhida });
          }}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "CANCELAR_CONCLUIDA" && (
        <ModalCancelar
          numero={janela.venda.numero}
          total={janela.venda.total}
          concluida
          ocupado={ocupado}
          aoConfirmar={(motivo) => {
            cancelarConcluida(janela.venda, motivo);
          }}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "DESISTIR_SEM_CONEXAO" && (
        <ModalConfirmar
          titulo="Desistir da venda"
          rotuloConfirmar="Desistir da venda"
          ocupado={ocupado}
          rotuloOcupado="Descartando…"
          aoConfirmar={desistirSemConexao}
          aoFechar={fecharJanela}
        >
          <p>Os itens desta venda sem conexão serão descartados.</p>
        </ModalConfirmar>
      )}

      {janela?.tipo === "GUARDADAS" && (
        <ModalGuardadas
          api={api}
          estacaoId={estacaoId}
          atual={venda}
          ocupado={ocupado}
          aoGuardar={guardar}
          aoRetomar={retomar}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "MENU" && (
        <ModalMenuCaixa
          vendaEmCurso={comItens}
          aoEscolher={escolherNoMenu}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "MOVIMENTO" && (
        <ModalMovimento
          tipo={janela.movimento}
          permitido={janela.movimento === "suprimento" || pode("caixa:sangria")}
          ocupado={ocupado}
          aoConfirmar={(movimento) => {
            movimentar(janela.movimento, movimento);
          }}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "REIMPRIMIR" && (
        <ModalEscolherVenda
          titulo="Reimprimir comprovante"
          rotuloAcao="Imprimir segunda via"
          api={api}
          estacaoId={estacaoId}
          ocupado={ocupado}
          aoEscolher={reimprimir}
          aoFechar={fecharJanela}
        />
      )}

      {janela?.tipo === "DEVOLUCAO" && (
        <ModalDevolucao
          api={api}
          estacaoId={estacaoId}
          permitido={pode("venda:devolver")}
          comLiberacao={comLiberacao}
          aoDevolver={devolvida}
          aoFechar={fecharJanela}
        />
      )}

      {pedido !== undefined && (
        <ModalSupervisor
          pedido={pedido}
          aoConfirmar={(credencial) => void liberar(credencial)}
          aoDesistir={desistir}
        />
      )}

      {noNavegador !== undefined && (
        <ComprovanteImpresso
          comprovante={noNavegador.comprovante}
          segundaVia={noNavegador.segundaVia}
          aoTerminar={terminarNoNavegador}
        />
      )}
    </ErroDaJanela.Provider>
  );
}

function Comando(props: {
  readonly tecla: string;
  readonly rotulo: string;
  readonly atalho: Atalho;
  /** Fora de hora o botão fica apagado, mas responde — e diz por quê. */
  readonly aplicavel: boolean;
  readonly ocupado: boolean;
  readonly destaque?: boolean;
  readonly aoUsar: (atalho: Atalho) => void;
}): ReactNode {
  return (
    <Botao
      tom={props.destaque === true ? "primario" : "secundario"}
      disabled={props.ocupado}
      className={props.aplicavel ? "" : "opacity-60"}
      onClick={() => {
        props.aoUsar(props.atalho);
      }}
    >
      {props.rotulo} ({props.tecla})
    </Botao>
  );
}

/**
 * A frase que o operador lê.
 *
 * `VendaIndisponivel` já nasce escrita para ele — a contingência recusou por um
 * motivo que faz sentido no balcão ("produto não está no catálogo local"), e
 * passá-la por `mensagemDe` a trocaria pelo texto genérico.
 */
function paraOperador(causa: unknown): string {
  return causa instanceof VendaIndisponivel ? causa.message : mensagemDe(causa);
}

/**
 * Pix e cartão sem integração: confirmados **pelo operador** (`MANUAL`), e
 * registrados assim. No treinamento, tudo é simulação — e o servidor só aceita
 * simulação lá.
 */
function confirmacaoDe(
  forma: string,
  treinamento: boolean,
): "MANUAL" | "SIMULADA" | undefined {
  if (treinamento) return "SIMULADA";

  return forma === "PIX" || forma === "CARTAO_DEBITO" || forma === "CARTAO_CREDITO"
    ? "MANUAL"
    : undefined;
}

/**
 * A venda offline não tem número — numerar é do servidor, e duas estações
 * isoladas escolhendo sozinhas produziriam duas vendas 47 no mesmo dia.
 */
function rotuloDaVenda(venda: VendaNoFio | undefined, origem: Origem): string {
  if (venda === undefined) return "Caixa livre";
  if (origem === "FILA") return "Venda sem conexão";

  return `Venda ${String(venda.numero)}`;
}

/** O que devolver ao cliente quando a venda cancelada já tinha recebido algo. */
function avisoDeCancelamento(cancelada: VendaNoFio): string | undefined {
  if (cancelada.itens.length === 0) return undefined;

  const recebido = cancelada.pagamentos
    .map(
      (pagamento) =>
        `${descreverPagamento(pagamento.forma, pagamento.confirmacao)} ${formatarDinheiro(pagamento.valor)}`,
    )
    .join(", ");
  const venda = `Venda ${String(cancelada.numero)} cancelada.`;

  return recebido === ""
    ? venda
    : `${venda} Devolva ao cliente o que ele já pagou: ${recebido}.`;
}

function instrucaoDeReembolso(feita: DevolucaoFeita): string {
  const valor = formatarDinheiro(feita.valorTotal);
  const registrada = `Devolução da venda ${String(feita.vendaNumero)} registrada: ${valor}.`;

  switch (feita.formaReembolso) {
    case "DINHEIRO":
      return `${registrada} Entregue ${valor} em dinheiro ao cliente.`;
    case "PIX":
      return `${registrada} Faça um Pix de ${valor} para o cliente.`;
    case "CARTAO":
      return `${registrada} Faça o estorno de ${valor} na maquininha.`;
    case "ABATER_FIADO":
      return `${registrada} O valor foi abatido do fiado do cliente.`;
  }
}

function estadoDaImpressao(resultado: ResultadoImpressao): EstadoImpressao {
  if (resultado.via === "NAVEGADOR") return { tipo: "IMPRESSA" };
  if (resultado.aviso === undefined) return { tipo: "IMPRESSA" };

  return { tipo: "AVISO", mensagem: resultado.aviso };
}

function ehCampoDeTexto(elemento: Element | null): boolean {
  return (
    elemento instanceof HTMLInputElement ||
    elemento instanceof HTMLTextAreaElement ||
    elemento instanceof HTMLSelectElement
  );
}
