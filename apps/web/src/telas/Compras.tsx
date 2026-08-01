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

interface NotaNaLista {
  readonly id: string;
  readonly numero: string;
  readonly serie?: string;
  readonly fornecedorNome: string;
  readonly recebidaEm: string;
  /** Centavos em texto. */
  readonly total: string;
  readonly quantidadeItens: number;
  readonly status: "LANCADA" | "CANCELADA";
  readonly usuarioNome: string;
  readonly motivoCancelamento?: string;
}

interface ItemDaNota {
  readonly numero: number;
  readonly descricao: string;
  readonly quantidade: string;
  readonly unidade: string;
  readonly custoUnitario: string;
  readonly desconto: string;
  readonly total: string;
}

interface NotaCompleta {
  readonly id: string;
  readonly numero: string;
  readonly serie?: string;
  readonly emitidaEm: string;
  readonly recebidaEm: string;
  readonly total: string;
  readonly status: "LANCADA" | "CANCELADA";
  readonly observacao?: string;
  readonly motivoCancelamento?: string;
  readonly itens: readonly ItemDaNota[];
}

interface FornecedorDaLista {
  readonly id: string;
  readonly exibicao: string;
}

interface ProdutoEncontrado {
  readonly id: string;
  readonly sku: string;
  readonly descricao: string;
  readonly unidade: string;
  readonly embalagens: readonly { readonly unidade: string; readonly fator: string }[];
}

/** Uma linha em digitação. Tudo texto: é o que o usuário está escrevendo. */
interface LinhaEmDigitacao {
  readonly produtoId: string;
  readonly descricao: string;
  readonly unidadeBase: string;
  readonly unidades: readonly { readonly valor: string; readonly rotulo: string }[];
  readonly quantidade: string;
  readonly unidade: string;
  readonly custo: string;
  readonly desconto: string;
}

type Tela =
  | { readonly fase: "LISTA" }
  | { readonly fase: "LANCANDO" }
  | { readonly fase: "DETALHE"; readonly id: string };

type Estado =
  | { readonly fase: "BUSCANDO" }
  | { readonly fase: "PRONTO"; readonly itens: readonly NotaNaLista[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

/**
 * Entrada de mercadoria.
 *
 * ### A conferência acontece antes de gravar
 *
 * A soma das linhas aparece **ao lado** do total impresso na nota, enquanto se
 * digita. Quem errou uma quantidade vê a diferença com o papel ainda na mão, e
 * não três meses depois, quando o estoque não fecha e ninguém lembra de qual
 * nota veio. O servidor recusa a nota que não bate; a tela só evita a viagem.
 *
 * ### Lançar é um passo só
 *
 * Sem rascunho: a nota chega em papel e é digitada de uma vez. Separar
 * "salvar" de "confirmar" dobraria estados e telas para um ganho que só existe
 * quando a nota chega pela metade — o caso da importação de XML, que virá
 * depois.
 *
 * ### Cancelar não apaga
 *
 * A nota cancelada continua na lista, marcada, com o motivo. O estoque volta
 * por um movimento de estorno que fica ao lado do original. Quem só dá entrada
 * de mercadoria não cancela: cancelar mexe no estoque para baixo.
 */
export function Compras(): ReactNode {
  const { cliente: api } = useSessao();
  const [termo, setTermo] = useState("");
  const [incluirCanceladas, setIncluirCanceladas] = useState(false);
  const [estado, setEstado] = useState<Estado>({ fase: "BUSCANDO" });
  const [tela, setTela] = useState<Tela>({ fase: "LISTA" });
  const [podeCancelar, setPodeCancelar] = useState(false);
  const campoBusca = useRef<HTMLInputElement>(null);
  const jaBuscou = useRef(false);

  async function buscar(
    procurado = termo,
    canceladas = incluirCanceladas,
  ): Promise<void> {
    setEstado({ fase: "BUSCANDO" });

    try {
      const resposta = await api.requisitar<{ itens: NotaNaLista[] }>(
        `/api/compras/notas?termo=${encodeURIComponent(procurado.trim())}` +
          `&incluirCanceladas=${String(canceladas)}`,
      );
      setEstado({ fase: "PRONTO", itens: resposta.itens });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;

    void buscar("", false);

    // Quem pode cancelar é decidido no servidor. A tela só esconde o botão —
    // esconder não é segurança, e por isso a rota confere de novo.
    void api
      .requisitar<{ podeCancelar?: unknown }>("/api/compras/permissoes")
      .then((resposta) => {
        setPodeCancelar(resposta.podeCancelar === true);
      })
      .catch(() => {
        setPodeCancelar(false);
      });
  });

  if (tela.fase === "LANCANDO") {
    return (
      <Lancamento
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

  if (tela.fase === "DETALHE") {
    return (
      <Detalhe
        id={tela.id}
        podeCancelar={podeCancelar}
        aoVoltar={() => {
          setTela({ fase: "LISTA" });
          void buscar();
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-tinta">Entrada de mercadoria</h1>
          <p className="text-sm text-tinta-suave">
            As notas do fornecedor. Lançar a nota é o que faz o estoque subir.
          </p>
        </div>

        <Botao
          onClick={() => {
            setTela({ fase: "LANCANDO" });
          }}
        >
          Lançar nota
        </Botao>
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
            rotulo="Procurar nota"
            autoFocus
            ajuda="Número da nota ou nome do fornecedor."
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

      <label className="flex items-center gap-2 text-tinta">
        <input
          type="checkbox"
          checked={incluirCanceladas}
          className="size-5 accent-acao"
          onChange={(evento) => {
            setIncluirCanceladas(evento.target.checked);
            void buscar(termo, evento.target.checked);
          }}
        />
        Mostrar também as canceladas
      </label>

      {estado.fase === "BUSCANDO" && <Carregando oQue="as notas" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void buscar()} />
      )}

      {estado.fase === "PRONTO" && estado.itens.length === 0 && (
        <Vazio
          titulo="Nenhuma nota"
          descricao={
            termo.trim() === ""
              ? "Ainda não há notas lançadas. Lance a primeira para o estoque começar a subir."
              : `Nada para "${termo.trim()}". Confira o número ou o fornecedor.`
          }
        />
      )}

      {estado.fase === "PRONTO" && estado.itens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-borda text-sm text-tinta-suave">
                <th className="py-2 font-medium">Nota</th>
                <th className="py-2 font-medium">Fornecedor</th>
                <th className="py-2 font-medium">Entrada</th>
                <th className="py-2 text-right font-medium">Total</th>
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {estado.itens.map((item) => (
                <tr key={item.id} className="border-b border-borda">
                  <td className="py-2 font-numero text-tinta">
                    {item.numero}
                    {item.serie !== undefined && (
                      <span className="text-tinta-suave">/{item.serie}</span>
                    )}
                    {item.status === "CANCELADA" && (
                      // Cor não é a única pista: o texto diz "Cancelada".
                      <span className="ml-2 rounded-md border border-atencao bg-atencao-suave px-2 py-0.5 text-xs">
                        Cancelada
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-tinta">{item.fornecedorNome}</td>
                  <td className="py-2 font-numero text-sm text-tinta-suave">
                    {new Date(item.recebidaEm).toLocaleDateString("pt-BR")}
                  </td>
                  <td className="py-2 text-right font-numero text-tinta">
                    {formatarDinheiro(item.total)}
                  </td>
                  <td className="py-2 text-right">
                    <Botao
                      tom="secundario"
                      onClick={() => {
                        setTela({ fase: "DETALHE", id: item.id });
                      }}
                    >
                      Abrir
                    </Botao>
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

function Lancamento({
  aoConcluir,
  aoCancelar,
}: {
  readonly aoConcluir: () => void;
  readonly aoCancelar: () => void;
}): ReactNode {
  const { cliente: api } = useSessao();

  const [fornecedores, setFornecedores] = useState<readonly FornecedorDaLista[]>([]);
  const [fornecedorId, setFornecedorId] = useState("");
  const [numero, setNumero] = useState("");
  const [serie, setSerie] = useState("");
  const [emitidaEm, setEmitidaEm] = useState(hoje());
  const [recebidaEm, setRecebidaEm] = useState(hoje());
  const [totalDeclarado, setTotalDeclarado] = useState("");
  const [observacao, setObservacao] = useState("");
  const [linhas, setLinhas] = useState<readonly LinhaEmDigitacao[]>([]);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);
  const jaBuscou = useRef(false);

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;

    void api
      .requisitar<{ itens: FornecedorDaLista[] }>("/api/fornecedores?limite=200")
      .then((resposta) => {
        setFornecedores(resposta.itens);
      })
      .catch(() => {
        setFornecedores([]);
      });
  });

  const somaDasLinhas = somar(linhas);
  const declarado = reaisParaCentavos(totalDeclarado);
  // A comparação só faz sentido quando o total já foi digitado.
  const confere = declarado !== undefined && BigInt(declarado) === somaDasLinhas;

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    if (fornecedorId === "") {
      setErro("Escolha o fornecedor da nota.");
      return;
    }

    if (numero.trim() === "") {
      setErro("Informe o número da nota.");
      return;
    }

    if (linhas.length === 0) {
      setErro("A nota precisa de ao menos um item. Sem item, nada entra no estoque.");
      return;
    }

    const itens = converterLinhas(linhas);
    if (itens === "INVALIDO") {
      setErro("Confira quantidade e custo das linhas. Use o formato 1,5 e 19,90.");
      return;
    }

    if (declarado === undefined) {
      setErro("Informe o total impresso na nota, no formato 190,00.");
      return;
    }

    setSalvando(true);
    setErro(undefined);

    try {
      await api.requisitar("/api/compras/notas", {
        metodo: "POST",
        corpo: {
          fornecedorId,
          numero: numero.trim(),
          emitidaEm,
          recebidaEm,
          itens,
          totalDeclarado: declarado,
          ...(serie.trim() === "" ? {} : { serie: serie.trim() }),
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

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-tinta">Lançar nota de entrada</h1>

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
          rotulo="Fornecedor"
          required
          ajuda={
            fornecedores.length === 0
              ? "Nenhum fornecedor cadastrado. Cadastre-o antes de lançar a nota."
              : undefined
          }
          valor={fornecedorId}
          opcoes={[
            { valor: "", rotulo: "Escolha o fornecedor" },
            ...fornecedores.map((atual) => ({
              valor: atual.id,
              rotulo: atual.exibicao,
            })),
          ]}
          aoMudar={setFornecedorId}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Número da nota"
            numerico
            required
            value={numero}
            onChange={(evento) => {
              setNumero(evento.target.value.slice(0, 20));
            }}
          />
          <CampoTexto
            rotulo="Série"
            numerico
            ajuda="Em branco quando a nota não tem série."
            value={serie}
            onChange={(evento) => {
              setSerie(evento.target.value.slice(0, 5));
            }}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Emitida em"
            type="date"
            required
            value={emitidaEm}
            onChange={(evento) => {
              setEmitidaEm(evento.target.value);
            }}
          />
          <CampoTexto
            rotulo="Mercadoria entrou em"
            type="date"
            required
            ajuda="É a data que vai para o estoque, e não a de hoje."
            value={recebidaEm}
            onChange={(evento) => {
              setRecebidaEm(evento.target.value);
            }}
          />
        </div>

        <Linhas linhas={linhas} aoMudar={setLinhas} />

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Total impresso na nota"
            numerico
            required
            ajuda="Em reais: 190,00. É conferido contra a soma das linhas."
            value={totalDeclarado}
            onChange={(evento) => {
              setTotalDeclarado(evento.target.value);
            }}
          />

          <div
            className={`flex flex-col justify-center rounded-md border px-3 py-2 ${
              totalDeclarado.trim() === ""
                ? "border-borda"
                : confere
                  ? "border-borda bg-papel-fundo"
                  : "border-erro bg-erro-suave"
            }`}
          >
            <span className="text-sm text-tinta-suave">Soma das linhas</span>
            <span className="font-numero text-lg text-tinta">
              {formatarDinheiro(somaDasLinhas)}
            </span>
            {totalDeclarado.trim() !== "" && !confere && (
              // Aparece enquanto se digita: quem errou uma quantidade descobre
              // com o papel ainda na mão.
              <span role="alert" className="text-sm text-erro">
                Não bate com o total da nota. Confira as linhas.
              </span>
            )}
          </div>
        </div>

        <CampoTexto
          rotulo="Observação"
          ajuda="Opcional. Entrega parcial, avaria, divergência combinada com o fornecedor."
          value={observacao}
          onChange={(evento) => {
            setObservacao(evento.target.value.slice(0, 500));
          }}
        />

        <div className="flex gap-3">
          <Botao type="submit" ocupado={salvando} rotuloOcupado="Lançando…">
            Lançar nota
          </Botao>
          <Botao tom="secundario" type="button" onClick={aoCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </section>
  );
}

/** As linhas da nota, com busca de produto. */
function Linhas({
  linhas,
  aoMudar,
}: {
  readonly linhas: readonly LinhaEmDigitacao[];
  readonly aoMudar: (novas: readonly LinhaEmDigitacao[]) => void;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [busca, setBusca] = useState("");
  const [procurando, setProcurando] = useState(false);
  const [aviso, setAviso] = useState<string | undefined>(undefined);

  async function adicionar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (busca.trim() === "" || procurando) return;

    setProcurando(true);
    setAviso(undefined);

    try {
      const resposta = await api.requisitar<{ itens: ProdutoEncontrado[] }>(
        `/api/produtos?termo=${encodeURIComponent(busca.trim())}&limite=1`,
      );

      const produto = resposta.itens[0];

      if (produto === undefined) {
        setAviso(`Nenhum produto para "${busca.trim()}". Confira o código.`);
        return;
      }

      aoMudar([
        ...linhas,
        {
          produtoId: produto.id,
          descricao: produto.descricao,
          unidadeBase: produto.unidade,
          unidades: [
            { valor: produto.unidade, rotulo: `${produto.unidade} (do produto)` },
            ...produto.embalagens.map((embalagem) => ({
              valor: embalagem.unidade,
              rotulo: `${embalagem.unidade} — ${embalagem.fator} ${produto.unidade}`,
            })),
          ],
          quantidade: "",
          unidade: produto.unidade,
          custo: "",
          desconto: "",
        },
      ]);

      setBusca("");
    } catch (causa) {
      setAviso(mensagemDe(causa));
    } finally {
      setProcurando(false);
    }
  }

  function alterar(indice: number, mudanca: Partial<LinhaEmDigitacao>): void {
    aoMudar(linhas.map((atual, i) => (i === indice ? { ...atual, ...mudanca } : atual)));
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-borda p-4">
      <legend className="px-1 text-sm font-medium text-tinta">Itens da nota</legend>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-60 flex-1">
          <CampoTexto
            rotulo="Adicionar produto"
            ajuda="Bipe o código de barras ou digite parte da descrição."
            value={busca}
            onChange={(evento) => {
              setBusca(evento.target.value);
            }}
            onKeyDown={(evento) => {
              // Enter adiciona sem enviar a nota: quem digita quarenta linhas
              // não tira a mão do teclado, e enviar aqui gravaria pela metade.
              if (evento.key === "Enter") void adicionar(evento);
            }}
          />
        </div>
        <Botao
          type="button"
          ocupado={procurando}
          rotuloOcupado="Procurando…"
          onClick={(evento) => void adicionar(evento)}
        >
          Adicionar
        </Botao>
      </div>

      {aviso !== undefined && (
        <p role="alert" className="text-sm text-erro">
          {aviso}
        </p>
      )}

      {linhas.length === 0 && (
        <p className="text-sm text-tinta-suave">
          Nenhum item ainda. Sem item, nada entra no estoque.
        </p>
      )}

      {linhas.map((linha, indice) => (
        <div
          key={`${linha.produtoId}-${String(indice)}`}
          className="flex flex-col gap-3 border-t border-borda pt-3"
        >
          <div className="flex items-center justify-between gap-3">
            <span className="text-tinta">{linha.descricao}</span>
            <Botao
              tom="secundario"
              type="button"
              onClick={() => {
                aoMudar(linhas.filter((_, i) => i !== indice));
              }}
            >
              Remover
            </Botao>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <CampoTexto
              rotulo="Quantidade"
              numerico
              value={linha.quantidade}
              onChange={(evento) => {
                alterar(indice, { quantidade: evento.target.value });
              }}
            />
            <CampoSelecao
              rotulo="Unidade"
              valor={linha.unidade}
              opcoes={linha.unidades}
              aoMudar={(valor) => {
                alterar(indice, { unidade: valor });
              }}
            />
            <CampoTexto
              rotulo="Custo unitário"
              numerico
              value={linha.custo}
              onChange={(evento) => {
                alterar(indice, { custo: evento.target.value });
              }}
            />
            <CampoTexto
              rotulo="Desconto"
              numerico
              value={linha.desconto}
              onChange={(evento) => {
                alterar(indice, { desconto: evento.target.value });
              }}
            />
          </div>

          <span className="text-right font-numero text-sm text-tinta-suave">
            {formatarDinheiro(totalDaLinha(linha))}
          </span>
        </div>
      ))}
    </fieldset>
  );
}

function Detalhe({
  id,
  podeCancelar,
  aoVoltar,
}: {
  readonly id: string;
  readonly podeCancelar: boolean;
  readonly aoVoltar: () => void;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [nota, setNota] = useState<NotaCompleta | undefined>(undefined);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [motivo, setMotivo] = useState("");
  const [cancelando, setCancelando] = useState(false);
  const jaBuscou = useRef(false);

  async function carregar(): Promise<void> {
    setErro(undefined);

    try {
      setNota(await api.requisitar<NotaCompleta>(`/api/compras/notas/${id}`));
    } catch (causa) {
      setErro(mensagemDe(causa));
    }
  }

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;
    void carregar();
  });

  async function cancelar(): Promise<void> {
    if (cancelando) return;

    if (motivo.trim() === "") {
      setErro("Informe o motivo. Cancelar em silêncio faz mercadoria desaparecer.");
      return;
    }

    setCancelando(true);
    setErro(undefined);

    try {
      await api.requisitar(`/api/compras/notas/${id}/cancelamento`, {
        metodo: "POST",
        corpo: { motivo: motivo.trim() },
      });

      await carregar();
      setMotivo("");
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setCancelando(false);
    }
  }

  if (nota === undefined) {
    return erro === undefined ? (
      <Carregando oQue="a nota" />
    ) : (
      <ErroDeTela mensagem={erro} aoTentarDeNovo={() => void carregar()} />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-tinta">
            Nota {nota.numero}
            {nota.serie !== undefined && `/${nota.serie}`}
          </h1>
          <p className="text-sm text-tinta-suave">
            Entrada em {new Date(nota.recebidaEm).toLocaleDateString("pt-BR")} ·{" "}
            {formatarDinheiro(nota.total)}
          </p>
        </div>
        <Botao tom="secundario" onClick={aoVoltar}>
          Voltar
        </Botao>
      </header>

      {erro !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
        >
          {erro}
        </p>
      )}

      {nota.status === "CANCELADA" && (
        <p className="rounded-md border border-atencao bg-atencao-suave px-3 py-2 text-tinta">
          <strong>Nota cancelada.</strong> O estoque foi estornado.{" "}
          {nota.motivoCancelamento ?? ""}
        </p>
      )}

      {nota.observacao !== undefined && (
        <p className="text-sm text-tinta-suave">{nota.observacao}</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-borda text-sm text-tinta-suave">
              <th className="py-2 font-medium">Produto</th>
              <th className="py-2 text-right font-medium">Quantidade</th>
              <th className="py-2 text-right font-medium">Custo</th>
              <th className="py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {nota.itens.map((item) => (
              <tr key={item.numero} className="border-b border-borda">
                <td className="py-2 text-tinta">{item.descricao}</td>
                <td className="py-2 text-right font-numero text-tinta-suave">
                  {formatarQuantidade(item.quantidade)} {item.unidade.toLowerCase()}
                </td>
                <td className="py-2 text-right font-numero text-tinta-suave">
                  {formatarDinheiro(item.custoUnitario)}
                </td>
                <td className="py-2 text-right font-numero text-tinta">
                  {formatarDinheiro(item.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {podeCancelar && nota.status === "LANCADA" && (
        <div className="flex flex-col gap-3 rounded-md border border-borda p-4">
          <h2 className="text-sm font-medium text-tinta">Cancelar esta nota</h2>
          <p className="text-sm text-tinta-suave">
            A nota continua no histórico e o estoque volta por um movimento de estorno.
          </p>
          <CampoTexto
            rotulo="Motivo"
            required
            value={motivo}
            onChange={(evento) => {
              setMotivo(evento.target.value.slice(0, 500));
            }}
          />
          <div>
            <Botao
              tom="secundario"
              ocupado={cancelando}
              rotuloOcupado="Cancelando…"
              onClick={() => void cancelar()}
            >
              Cancelar nota e estornar estoque
            </Botao>
          </div>
        </div>
      )}
    </section>
  );
}

// ── Cálculo em centavos, sem passar por `number` ─────────────────────────

function totalDaLinha(linha: LinhaEmDigitacao): bigint {
  const milesimos = paraMilesimos(linha.quantidade);
  const custo = reaisParaCentavos(linha.custo);
  const desconto = linha.desconto.trim() === "" ? "0" : reaisParaCentavos(linha.desconto);

  if (milesimos === undefined || custo === undefined || desconto === undefined) return 0n;

  return (BigInt(custo) * BigInt(milesimos)) / 1000n - BigInt(desconto);
}

function somar(linhas: readonly LinhaEmDigitacao[]): bigint {
  return linhas.reduce((total, linha) => total + totalDaLinha(linha), 0n);
}

type ItemParaEnviar = {
  readonly produtoId: string;
  readonly quantidade: string;
  readonly unidade: string;
  readonly custoUnitario: string;
  readonly desconto?: string;
};

function converterLinhas(
  linhas: readonly LinhaEmDigitacao[],
): readonly ItemParaEnviar[] | "INVALIDO" {
  const itens: ItemParaEnviar[] = [];

  for (const linha of linhas) {
    const quantidade = paraMilesimos(linha.quantidade);
    const custoUnitario = reaisParaCentavos(linha.custo);
    const desconto =
      linha.desconto.trim() === "" ? undefined : reaisParaCentavos(linha.desconto);

    if (quantidade === undefined || quantidade === "0" || custoUnitario === undefined) {
      return "INVALIDO";
    }

    if (linha.desconto.trim() !== "" && desconto === undefined) return "INVALIDO";

    itens.push({
      produtoId: linha.produtoId,
      quantidade,
      unidade: linha.unidade,
      custoUnitario,
      ...(desconto === undefined ? {} : { desconto }),
    });
  }

  return itens;
}

/**
 * `"1,5"` → `"1500"` milésimos. Número sem separador é a unidade inteira.
 *
 * A leitura inversa lançaria mil vezes menos mercadoria do que chegou, e o erro
 * só apareceria no inventário.
 */
function paraMilesimos(texto: string): string | undefined {
  const limpo = texto.trim().replace(/\./g, ",");

  if (!/^\d+(,\d{0,3})?$/.test(limpo)) return undefined;

  const [inteiro = "0", decimais = ""] = limpo.split(",");
  return (BigInt(inteiro) * 1000n + BigInt(decimais.padEnd(3, "0") || "0")).toString();
}

/** Data de hoje em `AAAA-MM-DD`, no fuso de quem está digitando. */
function hoje(): string {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");

  return `${String(agora.getFullYear())}-${mes}-${dia}`;
}
