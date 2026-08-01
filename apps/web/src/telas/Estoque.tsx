import { mensagemDe, useSessao } from "@erp/cliente-api";
import {
  Botao,
  CampoSelecao,
  CampoTexto,
  Carregando,
  ErroDeTela,
  formatarDinheiro,
  formatarQuantidade,
  reaisParaCentavos,
  Vazio,
} from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

interface SaldoDeProduto {
  readonly produtoId: string;
  readonly sku: string;
  readonly descricao: string;
  readonly unidade: string;
  /** Milésimos em texto, com sinal. */
  readonly milesimos: string;
  readonly custoMedio?: string;
  readonly valorEmEstoque?: string;
  readonly ativo: boolean;
}

interface MovimentoDoExtrato {
  readonly id: string;
  readonly tipo: string;
  readonly quantidade: string;
  readonly unidade: string;
  readonly efeito: 1 | -1;
  readonly usuarioNome: string;
  readonly custoUnitario?: string;
  readonly lote?: string;
  readonly observacao?: string;
  readonly ocorridoEm: string;
}

interface EmbalagemDoProduto {
  readonly unidade: string;
  readonly fator: string;
}

type Situacao = "TODOS" | "COM_SALDO" | "ZERADO" | "NEGATIVO";

type Tela =
  | { readonly fase: "LISTA" }
  | { readonly fase: "LANCANDO"; readonly produto: SaldoDeProduto }
  | { readonly fase: "EXTRATO"; readonly produto: SaldoDeProduto };

type Estado =
  | { readonly fase: "BUSCANDO" }
  | { readonly fase: "PRONTO"; readonly itens: readonly SaldoDeProduto[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

/**
 * Estoque.
 *
 * ### A tela abre no problema, não no catálogo
 *
 * O filtro padrão é "todos", mas os atalhos que importam são **negativo** e
 * **zerado**: quem abre esta tela quase sempre está atrás do que falta, não do
 * que tem. Saldo negativo não é erro — é venda lançada antes da nota de compra,
 * rotina em comércio de bairro — mas é a lista que precisa virar pedido.
 *
 * ### Quantidade também é dinheiro
 *
 * Milésimos em texto, do servidor até aqui. Peso de balança tem três casas, e
 * `number` devolveria `0.30000000000000004` no primeiro relatório somado.
 *
 * ### Saída não se lança à mão
 *
 * Saída é a venda. Um lançamento manual seria mercadoria que sumiu do estoque
 * sem sair do caixa — e a conferência do mês não distinguiria isso de furto.
 * Quem precisa registrar quebra usa **perda**, que exige justificativa.
 */
export function Estoque(): ReactNode {
  const { cliente: api, pode } = useSessao();
  const [termo, setTermo] = useState("");
  const [situacao, setSituacao] = useState<Situacao>("TODOS");
  const [estado, setEstado] = useState<Estado>({ fase: "BUSCANDO" });
  const [tela, setTela] = useState<Tela>({ fase: "LISTA" });
  const campoBusca = useRef<HTMLInputElement>(null);
  const jaBuscou = useRef(false);

  const podeVerCusto = pode("produto:ver_custo");
  const podeLancar = pode("estoque:entrada") || pode("estoque:ajuste");

  async function buscar(procurado = termo, filtro: Situacao = situacao): Promise<void> {
    setEstado({ fase: "BUSCANDO" });

    try {
      const resposta = await api.requisitar<{ itens: SaldoDeProduto[] }>(
        `/api/estoque/saldos?termo=${encodeURIComponent(procurado.trim())}` +
          `&situacao=${filtro}&apenasAtivos=false`,
      );
      setEstado({ fase: "PRONTO", itens: resposta.itens });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;
    void buscar("", "TODOS");
  });

  if (tela.fase === "LANCANDO") {
    return (
      <Lancamento
        produto={tela.produto}
        podeVerCusto={podeVerCusto}
        aoConcluir={() => {
          setTela({ fase: "LISTA" });
          void buscar();
          campoBusca.current?.focus();
        }}
        aoCancelar={() => {
          setTela({ fase: "LISTA" });
        }}
      />
    );
  }

  if (tela.fase === "EXTRATO") {
    return (
      <Extrato
        produto={tela.produto}
        aoVoltar={() => {
          setTela({ fase: "LISTA" });
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-tinta">Estoque</h1>
        <p className="text-sm text-tinta-suave">
          Saldo por produto. Saldo negativo é venda lançada antes da entrada da nota — não
          é erro, mas é o que precisa virar pedido.
        </p>
      </header>

      <form
        onSubmit={(evento: SyntheticEvent) => {
          evento.preventDefault();
          void buscar();
        }}
        className="flex flex-wrap items-end gap-3"
        noValidate
      >
        <div className="min-w-60 flex-1">
          <CampoTexto
            ref={campoBusca}
            rotulo="Procurar produto"
            autoFocus
            ajuda="Descrição, código interno ou código de barras."
            value={termo}
            onChange={(evento) => {
              setTermo(evento.target.value);
            }}
          />
        </div>
        <Botao
          type="submit"
          ocupado={estado.fase === "BUSCANDO"}
          rotuloOcupado="Procurando…"
        >
          Procurar
        </Botao>
      </form>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por saldo">
        {(
          [
            ["TODOS", "Todos"],
            ["NEGATIVO", "Negativos"],
            ["ZERADO", "Zerados"],
            ["COM_SALDO", "Com saldo"],
          ] as const
        ).map(([chave, rotulo]) => (
          <Botao
            key={chave}
            tom={situacao === chave ? "primario" : "secundario"}
            aria-pressed={situacao === chave}
            onClick={() => {
              setSituacao(chave);
              void buscar(termo, chave);
            }}
          >
            {rotulo}
          </Botao>
        ))}
      </div>

      {estado.fase === "BUSCANDO" && <Carregando oQue="o estoque" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void buscar()} />
      )}

      {estado.fase === "PRONTO" && estado.itens.length === 0 && (
        <Vazio
          titulo="Nada para mostrar"
          descricao={
            situacao === "NEGATIVO"
              ? "Nenhum produto com saldo negativo. É o resultado que se quer."
              : "Nenhum produto encontrado com este filtro."
          }
        />
      )}

      {estado.fase === "PRONTO" && estado.itens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-borda text-sm text-tinta-suave">
                <th className="py-2 font-medium">Produto</th>
                <th className="py-2 text-right font-medium">Saldo</th>
                {podeVerCusto && (
                  <>
                    <th className="py-2 text-right font-medium">Custo médio</th>
                    <th className="py-2 text-right font-medium">Valor</th>
                  </>
                )}
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {estado.itens.map((item) => (
                <tr key={item.produtoId} className="border-b border-borda">
                  <td className="py-2 text-tinta">
                    {item.descricao}
                    <span className="ml-2 font-numero text-xs text-tinta-suave">
                      {item.sku}
                    </span>
                    {!item.ativo && (
                      <span className="ml-2 rounded-md border border-atencao bg-atencao-suave px-2 py-0.5 text-xs">
                        Inativo
                      </span>
                    )}
                  </td>
                  <td
                    className={`py-2 text-right font-numero ${
                      item.milesimos.startsWith("-") ? "text-erro" : "text-tinta"
                    }`}
                  >
                    {formatarQuantidade(item.milesimos)} {item.unidade.toLowerCase()}
                    {item.milesimos.startsWith("-") && (
                      // Cor não é a única pista.
                      <span className="ml-2 text-xs">negativo</span>
                    )}
                  </td>
                  {podeVerCusto && (
                    <>
                      {/*
                        Custo zero é "nunca informado", não "de graça" — e
                        valor imobilizado sem custo conhecido também é
                        desconhecido. Mostrar R$ 0,00 nos dois faria a tela
                        afirmar que a loja tem mercadoria que não custou nada.
                      */}
                      <td className="py-2 text-right font-numero text-tinta-suave">
                        {semCusto(item) ? "—" : formatarDinheiro(item.custoMedio ?? "0")}
                      </td>
                      <td className="py-2 text-right font-numero text-tinta-suave">
                        {semCusto(item)
                          ? "—"
                          : formatarDinheiro(item.valorEmEstoque ?? "0")}
                      </td>
                    </>
                  )}
                  <td className="py-2 text-right">
                    <span className="flex justify-end gap-2">
                      <Botao
                        tom="secundario"
                        onClick={() => {
                          setTela({ fase: "EXTRATO", produto: item });
                        }}
                      >
                        Extrato
                      </Botao>
                      {podeLancar && (
                        <Botao
                          onClick={() => {
                            setTela({ fase: "LANCANDO", produto: item });
                          }}
                        >
                          Lançar
                        </Botao>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Tipos que o operador pode lançar, com o rótulo que ele usa.
 *
 * `exigeMotivo` espelha a regra do domínio: ajuste sem justificativa é a porta
 * de saída preferida de quem desvia mercadoria. A tela avisa antes de gastar
 * uma ida à rede; o servidor recusa de qualquer forma.
 */
const TIPOS = [
  {
    codigo: "ENTRADA",
    rotulo: "Entrada de mercadoria",
    permissao: "estoque:entrada",
    exigeMotivo: false,
    aceitaCusto: true,
  },
  {
    codigo: "DEVOLUCAO_CLIENTE",
    rotulo: "Devolução de cliente",
    permissao: "estoque:entrada",
    exigeMotivo: false,
    aceitaCusto: false,
  },
  {
    codigo: "AJUSTE_POSITIVO",
    rotulo: "Contagem encontrou a mais",
    permissao: "estoque:ajuste",
    exigeMotivo: true,
    aceitaCusto: false,
  },
  {
    codigo: "AJUSTE_NEGATIVO",
    rotulo: "Contagem encontrou a menos",
    permissao: "estoque:ajuste",
    exigeMotivo: true,
    aceitaCusto: false,
  },
  {
    codigo: "PERDA",
    rotulo: "Perda, quebra ou vencimento",
    permissao: "estoque:ajuste",
    exigeMotivo: true,
    aceitaCusto: false,
  },
  {
    codigo: "DEVOLUCAO_FORNECEDOR",
    rotulo: "Devolução ao fornecedor",
    permissao: "estoque:ajuste",
    exigeMotivo: false,
    aceitaCusto: false,
  },
] as const;

type CodigoTipo = (typeof TIPOS)[number]["codigo"];

function Lancamento({
  produto,
  podeVerCusto,
  aoConcluir,
  aoCancelar,
}: {
  readonly produto: SaldoDeProduto;
  readonly podeVerCusto: boolean;
  readonly aoConcluir: () => void;
  readonly aoCancelar: () => void;
}): ReactNode {
  const { cliente: api, pode } = useSessao();

  const disponiveis = TIPOS.filter((tipo) => pode(tipo.permissao));
  const primeiro = disponiveis[0];

  const [tipo, setTipo] = useState<CodigoTipo>(primeiro?.codigo ?? "ENTRADA");
  const [quantidade, setQuantidade] = useState("");
  const [unidade, setUnidade] = useState(produto.unidade);
  const [custo, setCusto] = useState("");
  const [lote, setLote] = useState("");
  const [observacao, setObservacao] = useState("");
  const [embalagens, setEmbalagens] = useState<readonly EmbalagemDoProduto[]>([]);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);
  const jaBuscou = useRef(false);

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;

    // As embalagens vêm do cadastro do produto: é o que permite lançar "3
    // fardos" em vez de obrigar o conferente a multiplicar por 12 de cabeça.
    void api
      .requisitar<{ embalagens?: EmbalagemDoProduto[] }>(
        `/api/produtos/${produto.produtoId}`,
      )
      .then((resposta) => {
        setEmbalagens(resposta.embalagens ?? []);
      })
      .catch(() => {
        setEmbalagens([]);
      });
  });

  const escolhido = TIPOS.find((atual) => atual.codigo === tipo);
  const aceitaCusto = podeVerCusto && escolhido?.aceitaCusto === true;

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    const milesimos = paraMilesimos(quantidade);
    if (milesimos === undefined || milesimos === "0") {
      setErro("Informe uma quantidade maior que zero.");
      return;
    }

    if (escolhido?.exigeMotivo === true && observacao.trim() === "") {
      setErro("Informe o motivo. Ajuste sem justificativa não fica rastreável.");
      return;
    }

    const centavos = custo.trim() === "" ? undefined : reaisParaCentavos(custo);
    if (aceitaCusto && custo.trim() !== "" && centavos === undefined) {
      setErro("Custo inválido. Use o formato 5,00.");
      return;
    }

    setSalvando(true);
    setErro(undefined);

    try {
      await api.requisitar("/api/estoque/movimentos", {
        metodo: "POST",
        corpo: {
          produtoId: produto.produtoId,
          tipo,
          quantidade: milesimos,
          unidade,
          ...(aceitaCusto && centavos !== undefined ? { custoUnitario: centavos } : {}),
          ...(lote.trim() === "" ? {} : { lote: lote.trim() }),
          ...(observacao.trim() === "" ? {} : { observacao: observacao.trim() }),
        },
      });

      aoConcluir();
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setSalvando(false);
    }
  }

  /* v8 ignore start -- inalcançável hoje: a lista só oferece "Lançar" quando o
     operador tem uma das duas permissões, e são as mesmas que filtram `TIPOS`.
     A guarda fica porque a tela pode ganhar outra porta de entrada, e um
     `<select>` sem opção alguma é pior que uma mensagem honesta. */
  if (primeiro === undefined) {
    return (
      <section className="flex flex-col gap-4">
        <Vazio
          titulo="Sem permissão para lançar"
          descricao="Peça a um supervisor para lançar o movimento."
        />
        <div>
          <Botao tom="secundario" onClick={aoCancelar}>
            Voltar
          </Botao>
        </div>
      </section>
    );
  }
  /* v8 ignore stop */

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-tinta">Lançar movimento</h1>
        <p className="text-sm text-tinta-suave">
          {produto.descricao} · saldo atual {formatarQuantidade(produto.milesimos)}{" "}
          {produto.unidade.toLowerCase()}
        </p>
      </header>

      <form
        onSubmit={(evento) => void salvar(evento)}
        className="flex flex-col gap-4"
        noValidate
      >
        {erro !== undefined && (
          <p
            role="alert"
            className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
          >
            {erro}
          </p>
        )}

        <CampoSelecao
          rotulo="O que aconteceu"
          valor={tipo}
          opcoes={disponiveis.map((atual) => ({
            valor: atual.codigo,
            rotulo: atual.rotulo,
          }))}
          aoMudar={(valor) => {
            setTipo(valor as CodigoTipo);
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Quantidade"
            numerico
            required
            autoFocus
            ajuda="Sempre positiva. O tipo acima diz se entra ou sai."
            value={quantidade}
            onChange={(evento) => {
              setQuantidade(evento.target.value);
            }}
          />

          <CampoSelecao
            rotulo="Unidade"
            ajuda={
              embalagens.length === 0
                ? undefined
                : "Escolher a embalagem converte para a unidade do produto."
            }
            valor={unidade}
            opcoes={[
              { valor: produto.unidade, rotulo: `${produto.unidade} (do produto)` },
              ...embalagens.map((embalagem) => ({
                valor: embalagem.unidade,
                rotulo: `${embalagem.unidade} — ${embalagem.fator} ${produto.unidade}`,
              })),
            ]}
            aoMudar={setUnidade}
          />
        </div>

        {aceitaCusto && (
          <CampoTexto
            rotulo="Custo por unidade comprada"
            numerico
            ajuda="Em reais, na unidade escolhida acima. O fardo de 12 a R$ 60,00 vira R$ 5,00 a unidade."
            value={custo}
            onChange={(evento) => {
              setCusto(evento.target.value);
            }}
          />
        )}

        <CampoTexto
          rotulo="Lote"
          ajuda="Opcional. Ajuda a rastrear um recolhimento do fabricante."
          value={lote}
          onChange={(evento) => {
            setLote(evento.target.value.slice(0, 30));
          }}
        />

        <CampoTexto
          rotulo={escolhido?.exigeMotivo === true ? "Motivo" : "Observação"}
          required={escolhido?.exigeMotivo === true}
          ajuda={
            escolhido?.exigeMotivo === true
              ? "Obrigatório. É o que torna o ajuste rastreável depois."
              : "Opcional."
          }
          value={observacao}
          onChange={(evento) => {
            setObservacao(evento.target.value.slice(0, 500));
          }}
        />

        <div className="flex gap-3">
          <Botao type="submit" ocupado={salvando} rotuloOcupado="Lançando…">
            Lançar
          </Botao>
          <Botao tom="secundario" type="button" onClick={aoCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </section>
  );
}

const ROTULO_DO_TIPO: Readonly<Record<string, string>> = {
  ENTRADA: "Entrada",
  DEVOLUCAO_CLIENTE: "Devolução de cliente",
  AJUSTE_POSITIVO: "Ajuste a mais",
  AJUSTE_NEGATIVO: "Ajuste a menos",
  PERDA: "Perda",
  DEVOLUCAO_FORNECEDOR: "Devolução ao fornecedor",
  SAIDA: "Venda",
  TRANSFERENCIA_ENTRADA: "Transferência recebida",
  TRANSFERENCIA_SAIDA: "Transferência enviada",
};

function Extrato({
  produto,
  aoVoltar,
}: {
  readonly produto: SaldoDeProduto;
  readonly aoVoltar: () => void;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [estado, setEstado] = useState<
    | { readonly fase: "BUSCANDO" }
    | { readonly fase: "PRONTO"; readonly itens: readonly MovimentoDoExtrato[] }
    | { readonly fase: "FALHOU"; readonly mensagem: string }
  >({ fase: "BUSCANDO" });
  const jaBuscou = useRef(false);

  async function carregar(): Promise<void> {
    setEstado({ fase: "BUSCANDO" });

    try {
      const resposta = await api.requisitar<{ itens: MovimentoDoExtrato[] }>(
        `/api/estoque/produtos/${produto.produtoId}/movimentos`,
      );
      setEstado({ fase: "PRONTO", itens: resposta.itens });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;
    void carregar();
  });

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-tinta">Extrato do estoque</h1>
          <p className="text-sm text-tinta-suave">
            {produto.descricao} · saldo atual {formatarQuantidade(produto.milesimos)}{" "}
            {produto.unidade.toLowerCase()}
          </p>
        </div>
        <Botao tom="secundario" onClick={aoVoltar}>
          Voltar
        </Botao>
      </header>

      {estado.fase === "BUSCANDO" && <Carregando oQue="o extrato" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void carregar()} />
      )}

      {estado.fase === "PRONTO" && estado.itens.length === 0 && (
        <Vazio
          titulo="Nenhum movimento"
          descricao="Este produto ainda não teve entrada nem saída."
        />
      )}

      {estado.fase === "PRONTO" && estado.itens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-borda text-sm text-tinta-suave">
                <th className="py-2 font-medium">Quando</th>
                <th className="py-2 font-medium">O que</th>
                <th className="py-2 text-right font-medium">Quantidade</th>
                <th className="py-2 font-medium">Quem</th>
                <th className="py-2 font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {estado.itens.map((item) => (
                <tr key={item.id} className="border-b border-borda align-top">
                  <td className="py-2 font-numero text-sm text-tinta-suave">
                    {new Date(item.ocorridoEm).toLocaleString("pt-BR")}
                  </td>
                  <td className="py-2 text-tinta">
                    {ROTULO_DO_TIPO[item.tipo] ?? item.tipo}
                  </td>
                  <td
                    className={`py-2 text-right font-numero ${
                      item.efeito === -1 ? "text-erro" : "text-tinta"
                    }`}
                  >
                    {/* O sinal é explícito: a cor sozinha não diz nada a quem não a vê. */}
                    {item.efeito === -1 ? "−" : "+"}
                    {formatarQuantidade(item.quantidade)} {item.unidade.toLowerCase()}
                  </td>
                  <td className="py-2 text-sm text-tinta-suave">{item.usuarioNome}</td>
                  <td className="py-2 text-sm text-tinta-suave">
                    {item.observacao ?? "—"}
                    {item.lote !== undefined && (
                      <span className="ml-2 font-numero text-xs">lote {item.lote}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Custo nunca informado: zero significa "não sei", não "de graça". */
function semCusto(item: SaldoDeProduto): boolean {
  return item.custoMedio === undefined || item.custoMedio === "0";
}

/**
 * `"1,5"` → `"1500"` milésimos.
 *
 * Número **sem separador é a unidade inteira**: `"3"` são três, não três
 * milésimos. A interpretação inversa lançaria mil vezes menos mercadoria do que
 * chegou, e o erro só apareceria no inventário.
 */
function paraMilesimos(texto: string): string | undefined {
  const limpo = texto.trim().replace(/\./g, ",");

  if (!/^\d+(,\d{0,3})?$/.test(limpo)) return undefined;

  const [inteiro = "0", decimais = ""] = limpo.split(",");
  return (BigInt(inteiro) * 1000n + BigInt(decimais.padEnd(3, "0") || "0")).toString();
}
