import { mensagemDe, useSessao } from "@erp/cliente-api";
import {
  Botao,
  CampoSelecao,
  CampoTexto,
  Carregando,
  centavosParaReais,
  ErroDeTela,
  formatarDinheiro,
  reaisParaCentavos,
  Vazio,
} from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

export interface ReferenciaDoProduto {
  readonly tipo: "EAN" | "FABRICANTE" | "ORIGINAL" | "SIMILAR" | "INTERNO" | "FORNECEDOR";
  readonly valor: string;
}

export interface EmbalagemDoProduto {
  readonly unidade: string;
  /** Inteiro em texto, como a API entrega. */
  readonly fator: string;
  readonly codigoBarras?: string;
}

export interface ProdutoDaLista {
  readonly id: string;
  readonly sku: string;
  readonly descricao: string;
  readonly descricaoPdv: string;
  readonly tipo: "UNITARIO" | "PESAVEL";
  readonly unidade: string;
  /** Centavos em texto. */
  readonly precoVenda: string;
  /** Ausente quando quem consulta não tem `produto:ver_custo`. */
  readonly custo?: string;
  readonly codigoBarras?: string;
  readonly codigoBalanca?: string;
  readonly categoriaId?: string;
  readonly referencias: readonly ReferenciaDoProduto[];
  readonly embalagens: readonly EmbalagemDoProduto[];
  readonly ativo: boolean;
}

interface CategoriaDaLista {
  readonly id: string;
  readonly nome: string;
}

type Tela =
  | { readonly fase: "LISTA" }
  | { readonly fase: "CADASTRANDO" }
  | { readonly fase: "EDITANDO"; readonly produto: ProdutoDaLista };

type EstadoBusca =
  | { readonly fase: "BUSCANDO" }
  | { readonly fase: "PRONTO"; readonly itens: readonly ProdutoDaLista[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

/**
 * Cadastro de produtos.
 *
 * ### Uma tela para nove segmentos
 *
 * A mercearia precisa de descrição e preço. O açougue precisa do código da
 * balança. O depósito precisa do fardo. A autopeças precisa dos códigos de
 * fabricante e similar. Fazer quatro telas seria manter quatro; fazer uma que
 * mostra tudo sempre transformaria o cadastro de um refrigerante num
 * formulário de vinte campos.
 *
 * A saída é o formulário **crescer conforme a resposta**: o código de balança
 * só aparece quando o produto é pesável, e referências e embalagens ficam
 * atrás de um botão que quem não usa nunca aperta.
 *
 * ### O custo pode não estar aqui
 *
 * Quem não tem `produto:ver_custo` não recebe o campo — e o formulário dele
 * **não envia** custo nenhum, para não zerar o que já está gravado. A decisão
 * é do servidor: a ausência do campo na tela é consequência, não a proteção.
 */
export function Produtos(): ReactNode {
  const { cliente: api, pode } = useSessao();
  const [termo, setTermo] = useState("");
  const [estado, setEstado] = useState<EstadoBusca>({ fase: "BUSCANDO" });
  const [tela, setTela] = useState<Tela>({ fase: "LISTA" });
  const [categorias, setCategorias] = useState<readonly CategoriaDaLista[]>([]);
  const campoBusca = useRef<HTMLInputElement>(null);
  const jaBuscou = useRef(false);

  const podeVerCusto = pode("produto:ver_custo");

  async function buscar(procurado = termo): Promise<void> {
    setEstado({ fase: "BUSCANDO" });

    try {
      const resposta = await api.requisitar<{ itens: ProdutoDaLista[] }>(
        `/api/produtos?termo=${encodeURIComponent(procurado.trim())}&apenasAtivos=false`,
      );
      setEstado({ fase: "PRONTO", itens: resposta.itens });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaBuscou.current) return;
    jaBuscou.current = true;

    void buscar("");

    // Sem categoria a tela continua funcionando: o seletor fica só com
    // "Sem categoria". Travar o cadastro porque a lista de apoio falhou seria
    // parar o trabalho por causa de um campo opcional.
    void api
      .requisitar<{ itens: CategoriaDaLista[] }>("/api/categorias")
      .then((resposta) => {
        setCategorias(resposta.itens);
      })
      .catch(() => {
        setCategorias([]);
      });
  });

  if (tela.fase !== "LISTA") {
    return (
      <Formulario
        produto={tela.fase === "EDITANDO" ? tela.produto : undefined}
        categorias={categorias}
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

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-tinta">Produtos</h1>
          <p className="text-sm text-tinta-suave">
            Procure pela descrição ou bipe o código de barras no campo abaixo.
          </p>
        </div>

        {pode("produto:criar") && (
          <Botao
            onClick={() => {
              setTela({ fase: "CADASTRANDO" });
            }}
          >
            Novo produto
          </Botao>
        )}
      </header>

      <form
        onSubmit={(evento: SyntheticEvent) => {
          evento.preventDefault();
          void buscar();
        }}
        className="flex items-end gap-3"
        noValidate
      >
        <div className="flex-1">
          <CampoTexto
            ref={campoBusca}
            rotulo="Procurar produto"
            autoFocus
            ajuda="Descrição, código interno, código de barras ou referência de fabricante."
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

      {estado.fase === "BUSCANDO" && <Carregando oQue="produtos" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void buscar()} />
      )}

      {estado.fase === "PRONTO" && estado.itens.length === 0 && (
        <Vazio
          titulo="Nenhum produto encontrado"
          descricao={
            termo.trim() === ""
              ? "Ainda não há produtos cadastrados. Comece pelos que mais vendem."
              : `Nada para "${termo.trim()}". Confira a grafia ou cadastre o produto.`
          }
        />
      )}

      {estado.fase === "PRONTO" && estado.itens.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-borda text-sm text-tinta-suave">
                <th className="py-2 font-medium">Produto</th>
                <th className="py-2 font-medium">Código</th>
                <th className="py-2 text-right font-medium">Preço</th>
                {podeVerCusto && <th className="py-2 text-right font-medium">Custo</th>}
                <th className="py-2" />
              </tr>
            </thead>
            <tbody>
              {estado.itens.map((item) => (
                <tr key={item.id} className="border-b border-borda">
                  <td className="py-2 text-tinta">
                    {item.descricao}
                    {!item.ativo && (
                      // Cor não é a única pista: o texto diz "Inativo".
                      <span className="ml-2 rounded-md border border-atencao bg-atencao-suave px-2 py-0.5 text-xs">
                        Inativo
                      </span>
                    )}
                    {item.tipo === "PESAVEL" && (
                      <span className="ml-2 text-xs text-tinta-suave">
                        pesável · {item.unidade}
                      </span>
                    )}
                  </td>
                  <td className="py-2 font-numero text-tinta-suave">{item.sku}</td>
                  <td className="py-2 text-right font-numero text-tinta">
                    {formatarDinheiro(item.precoVenda)}
                  </td>
                  {podeVerCusto && (
                    <td className="py-2 text-right font-numero text-tinta-suave">
                      {item.custo === undefined ? "—" : formatarDinheiro(item.custo)}
                    </td>
                  )}
                  <td className="py-2 text-right">
                    {pode("produto:editar") && (
                      <Botao
                        tom="secundario"
                        onClick={() => {
                          setTela({ fase: "EDITANDO", produto: item });
                        }}
                      >
                        Editar
                      </Botao>
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

/** Unidades oferecidas, com o nome que o lojista usa. */
const UNIDADES: readonly { readonly codigo: string; readonly rotulo: string }[] = [
  { codigo: "UN", rotulo: "Unidade" },
  { codigo: "PC", rotulo: "Peça" },
  { codigo: "KG", rotulo: "Quilo" },
  { codigo: "G", rotulo: "Grama" },
  { codigo: "L", rotulo: "Litro" },
  { codigo: "ML", rotulo: "Mililitro" },
  { codigo: "M", rotulo: "Metro" },
  { codigo: "M2", rotulo: "Metro quadrado" },
  { codigo: "M3", rotulo: "Metro cúbico" },
  { codigo: "CX", rotulo: "Caixa" },
  { codigo: "FD", rotulo: "Fardo" },
  { codigo: "PCT", rotulo: "Pacote" },
  { codigo: "DZ", rotulo: "Dúzia" },
  { codigo: "SC", rotulo: "Saco" },
];

/** Unidades que aceitam fração — as únicas válidas para produto pesável. */
const FRACIONAVEIS = new Set(["KG", "G", "L", "ML", "M", "M2", "M3"]);

const TIPOS_REFERENCIA: readonly {
  readonly codigo: ReferenciaDoProduto["tipo"];
  readonly rotulo: string;
}[] = [
  { codigo: "FABRICANTE", rotulo: "Código do fabricante" },
  { codigo: "ORIGINAL", rotulo: "Código original da montadora" },
  { codigo: "SIMILAR", rotulo: "Similar de outra marca" },
  { codigo: "EAN", rotulo: "Código de barras adicional" },
  { codigo: "FORNECEDOR", rotulo: "Código no catálogo do fornecedor" },
  { codigo: "INTERNO", rotulo: "Código próprio da loja" },
];

interface PropsFormulario {
  readonly produto?: ProdutoDaLista | undefined;
  readonly categorias: readonly CategoriaDaLista[];
  readonly podeVerCusto: boolean;
  readonly aoConcluir: () => void;
  readonly aoCancelar: () => void;
}

function Formulario({
  produto,
  categorias,
  podeVerCusto,
  aoConcluir,
  aoCancelar,
}: PropsFormulario): ReactNode {
  const { cliente: api } = useSessao();
  const editando = produto !== undefined;

  const [sku, setSku] = useState(produto?.sku ?? "");
  const [descricao, setDescricao] = useState(produto?.descricao ?? "");
  const [descricaoPdv, setDescricaoPdv] = useState(produto?.descricaoPdv ?? "");
  const [tipo, setTipo] = useState<"UNITARIO" | "PESAVEL">(produto?.tipo ?? "UNITARIO");
  const [unidade, setUnidade] = useState(produto?.unidade ?? "UN");
  const [preco, setPreco] = useState(centavosParaReais(produto?.precoVenda ?? "0"));
  const [custo, setCusto] = useState(centavosParaReais(produto?.custo ?? "0"));
  const [codigoBarras, setCodigoBarras] = useState(produto?.codigoBarras ?? "");
  const [codigoBalanca, setCodigoBalanca] = useState(produto?.codigoBalanca ?? "");
  const [categoriaId, setCategoriaId] = useState(produto?.categoriaId ?? "");
  const [referencias, setReferencias] = useState<readonly ReferenciaDoProduto[]>(
    produto?.referencias ?? [],
  );
  const [embalagens, setEmbalagens] = useState<readonly EmbalagemDoProduto[]>(
    produto?.embalagens ?? [],
  );
  const [ativo, setAtivo] = useState(produto?.ativo ?? true);
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [salvando, setSalvando] = useState(false);

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (salvando) return;

    if (sku.trim() === "") {
      setErro("Informe o código interno do produto.");
      return;
    }

    if (descricao.trim() === "") {
      setErro("Informe a descrição do produto.");
      return;
    }

    const precoCentavos = reaisParaCentavos(preco);
    if (precoCentavos === undefined) {
      setErro("Preço de venda inválido. Use o formato 19,90.");
      return;
    }

    const custoCentavos = podeVerCusto ? reaisParaCentavos(custo) : undefined;
    if (podeVerCusto && custoCentavos === undefined) {
      setErro("Custo inválido. Use o formato 6,50.");
      return;
    }

    const embalagemVazia = embalagens.some(
      (embalagem) => embalagem.fator.trim() === "" || Number(embalagem.fator) < 2,
    );
    if (embalagemVazia) {
      setErro("Cada embalagem precisa de uma quantidade maior que 1.");
      return;
    }

    setSalvando(true);
    setErro(undefined);

    const corpo: Record<string, unknown> = {
      sku: sku.trim(),
      descricao: descricao.trim(),
      precoVenda: precoCentavos,
      referencias: referencias.filter((referencia) => referencia.valor.trim() !== ""),
      embalagens: embalagens.map((embalagem) => ({
        unidade: embalagem.unidade,
        fator: embalagem.fator,
      })),
      ...(descricaoPdv.trim() === "" ? {} : { descricaoPdv: descricaoPdv.trim() }),
      // Só manda o custo quem pode vê-lo: mandar zero apagaria a margem da loja.
      ...(custoCentavos === undefined ? {} : { custo: custoCentavos }),
      ...(codigoBarras.trim() === "" ? {} : { codigoBarras: codigoBarras.trim() }),
      ...(tipo === "PESAVEL" && codigoBalanca.trim() !== ""
        ? { codigoBalanca: codigoBalanca.trim() }
        : {}),
      ...(categoriaId === "" ? {} : { categoriaId }),
    };

    try {
      if (editando) {
        await api.requisitar(`/api/produtos/${produto.id}`, {
          metodo: "PUT",
          corpo: { ...corpo, ativo },
        });
      } else {
        await api.requisitar("/api/produtos", {
          metodo: "POST",
          corpo: { ...corpo, tipo, unidadeBase: unidade },
        });
      }

      aoConcluir();
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-tinta">
        {editando ? `Editar ${produto.descricao}` : "Novo produto"}
      </h1>

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

        <CampoTexto
          rotulo="Descrição"
          required
          autoFocus
          ajuda="Como o produto aparece no relatório e no documento fiscal."
          value={descricao}
          onChange={(evento) => {
            setDescricao(evento.target.value.slice(0, 120));
          }}
        />

        <CampoTexto
          rotulo="Descrição do cupom"
          ajuda="Curta, cabe na impressora do caixa. Em branco, usa a descrição acima."
          value={descricaoPdv}
          onChange={(evento) => {
            setDescricaoPdv(evento.target.value.slice(0, 40));
          }}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Código interno"
            required
            ajuda="O que identifica o produto na loja. Precisa ser único."
            value={sku}
            onChange={(evento) => {
              setSku(evento.target.value.slice(0, 30));
            }}
          />

          <CampoTexto
            rotulo="Código de barras"
            numerico
            ajuda="Bipe a embalagem no campo. Em branco para produto sem código."
            value={codigoBarras}
            onChange={(evento) => {
              setCodigoBarras(evento.target.value.replace(/\D/g, "").slice(0, 14));
            }}
          />
        </div>

        {/*
          Tipo e unidade travam depois de cadastrado: o produto já tem saldo de
          estoque e itens de venda naquela unidade, e trocá-la reinterpretaria
          o histórico sem converter nada. O servidor nem aceita os campos — aqui
          eles são escondidos para não prometer o que não vai acontecer.
        */}
        {!editando && (
          <div className="grid gap-4 sm:grid-cols-2">
            <CampoSelecao
              rotulo="Como é vendido"
              ajuda="Pesável é o que passa pela balança: carne, frios, hortifruti."
              valor={tipo}
              opcoes={[
                { valor: "UNITARIO", rotulo: "Por unidade" },
                { valor: "PESAVEL", rotulo: "Por peso ou medida" },
              ]}
              aoMudar={(valor) => {
                const novo = valor === "PESAVEL" ? "PESAVEL" : "UNITARIO";
                setTipo(novo);
                // Trocar para pesável com unidade que não aceita fração daria
                // erro só ao salvar. Sugerir o quilo é o que a loja espera.
                if (novo === "PESAVEL" && !FRACIONAVEIS.has(unidade)) setUnidade("KG");
                if (novo === "UNITARIO" && FRACIONAVEIS.has(unidade)) setUnidade("UN");
              }}
            />

            <CampoSelecao
              rotulo="Unidade"
              ajuda="Não muda depois de cadastrado."
              valor={unidade}
              opcoes={UNIDADES.filter(
                (atual) => tipo === "UNITARIO" || FRACIONAVEIS.has(atual.codigo),
              ).map((atual) => ({ valor: atual.codigo, rotulo: atual.rotulo }))}
              aoMudar={setUnidade}
            />
          </div>
        )}

        {tipo === "PESAVEL" && (
          <CampoTexto
            rotulo="Código na balança"
            numerico
            ajuda="O número que a balança imprime no meio da etiqueta."
            value={codigoBalanca}
            onChange={(evento) => {
              setCodigoBalanca(evento.target.value.replace(/\D/g, "").slice(0, 7));
            }}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <CampoTexto
            rotulo="Preço de venda"
            numerico
            required
            ajuda="Em reais: 19,90. Sem vírgula, 2000 é R$ 2.000,00."
            value={preco}
            onChange={(evento) => {
              setPreco(evento.target.value);
            }}
          />

          {podeVerCusto && (
            <CampoTexto
              rotulo="Custo de compra"
              numerico
              ajuda="Serve para a margem no relatório. Zero significa não informado."
              value={custo}
              onChange={(evento) => {
                setCusto(evento.target.value);
              }}
            />
          )}
        </div>

        <CampoSelecao
          rotulo="Categoria"
          ajuda="Agrupa o produto no relatório de vendas."
          valor={categoriaId}
          opcoes={[
            { valor: "", rotulo: "Sem categoria" },
            ...categorias.map((atual) => ({ valor: atual.id, rotulo: atual.nome })),
          ]}
          aoMudar={setCategoriaId}
        />

        <Referencias referencias={referencias} aoMudar={setReferencias} />

        <Embalagens
          embalagens={embalagens}
          unidadeBase={unidade}
          aoMudar={setEmbalagens}
        />

        {editando && (
          <label className="flex items-center gap-2 text-tinta">
            <input
              type="checkbox"
              checked={ativo}
              className="size-5 accent-acao"
              onChange={(evento) => {
                setAtivo(evento.target.checked);
              }}
            />
            Produto ativo
          </label>
        )}

        <div className="flex gap-3">
          <Botao type="submit" ocupado={salvando} rotuloOcupado="Salvando…">
            Salvar
          </Botao>
          <Botao tom="secundario" type="button" onClick={aoCancelar}>
            Cancelar
          </Botao>
        </div>
      </form>
    </section>
  );
}

/**
 * Códigos alternativos.
 *
 * Fica recolhido até ter conteúdo porque só a autopeças usa todo dia — e
 * mostrá-lo aberto para a mercearia é fazer um formulário de dois campos
 * parecer um de dez.
 */
function Referencias({
  referencias,
  aoMudar,
}: {
  readonly referencias: readonly ReferenciaDoProduto[];
  readonly aoMudar: (novas: readonly ReferenciaDoProduto[]) => void;
}): ReactNode {
  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-borda p-4">
      <legend className="px-1 text-sm font-medium text-tinta">
        Outros códigos do produto
      </legend>
      <p className="text-sm text-tinta-suave">
        Código do fabricante, da montadora ou do similar. O balconista encontra o produto
        por qualquer um deles.
      </p>

      {referencias.map((referencia, indice) => (
        // O índice é a chave porque a linha **é** a posição: não há identidade
        // estável antes de gravar, e usar o valor faria a linha perder o foco a
        // cada tecla digitada.
        <div key={indice} className="flex flex-wrap items-end gap-3">
          <CampoSelecao
            rotulo="Tipo"
            valor={referencia.tipo}
            opcoes={TIPOS_REFERENCIA.map((atual) => ({
              valor: atual.codigo,
              rotulo: atual.rotulo,
            }))}
            aoMudar={(valor) => {
              aoMudar(
                referencias.map((atual, i) =>
                  i === indice
                    ? { ...atual, tipo: valor as ReferenciaDoProduto["tipo"] }
                    : atual,
                ),
              );
            }}
          />

          <div className="flex-1">
            <CampoTexto
              rotulo="Código"
              value={referencia.valor}
              onChange={(evento) => {
                const valor = evento.target.value.slice(0, 60);
                aoMudar(
                  referencias.map((atual, i) =>
                    i === indice ? { ...atual, valor } : atual,
                  ),
                );
              }}
            />
          </div>

          <Botao
            tom="secundario"
            type="button"
            onClick={() => {
              aoMudar(referencias.filter((_, i) => i !== indice));
            }}
          >
            Remover
          </Botao>
        </div>
      ))}

      <div>
        <Botao
          tom="secundario"
          type="button"
          onClick={() => {
            aoMudar([...referencias, { tipo: "FABRICANTE", valor: "" }]);
          }}
        >
          Adicionar código
        </Botao>
      </div>
    </fieldset>
  );
}

/**
 * Embalagens de compra.
 *
 * O depósito compra em palete e vende em saco; a mercearia compra fardo de 12 e
 * vende unidade. Sem isto, o dono faz a conta de cabeça na entrada da mercadoria
 * — e o estoque nunca fecha.
 */
function Embalagens({
  embalagens,
  unidadeBase,
  aoMudar,
}: {
  readonly embalagens: readonly EmbalagemDoProduto[];
  readonly unidadeBase: string;
  readonly aoMudar: (novas: readonly EmbalagemDoProduto[]) => void;
}): ReactNode {
  const disponiveis = UNIDADES.filter((atual) => atual.codigo !== unidadeBase);

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-borda p-4">
      <legend className="px-1 text-sm font-medium text-tinta">
        Embalagens de compra
      </legend>
      <p className="text-sm text-tinta-suave">
        Como o produto chega do fornecedor. Um fardo de 12 lança 12 unidades no estoque.
      </p>

      {embalagens.map((embalagem, indice) => (
        <div key={indice} className="flex flex-wrap items-end gap-3">
          <CampoSelecao
            rotulo="Embalagem"
            valor={embalagem.unidade}
            opcoes={disponiveis.map((atual) => ({
              valor: atual.codigo,
              rotulo: atual.rotulo,
            }))}
            aoMudar={(valor) => {
              aoMudar(
                embalagens.map((atual, i) =>
                  i === indice ? { ...atual, unidade: valor } : atual,
                ),
              );
            }}
          />

          <CampoTexto
            rotulo="Quantidade dentro"
            numerico
            value={embalagem.fator}
            onChange={(evento) => {
              const fator = evento.target.value.replace(/\D/g, "").slice(0, 9);
              aoMudar(
                embalagens.map((atual, i) =>
                  i === indice ? { ...atual, fator } : atual,
                ),
              );
            }}
          />

          <Botao
            tom="secundario"
            type="button"
            onClick={() => {
              aoMudar(embalagens.filter((_, i) => i !== indice));
            }}
          >
            Remover
          </Botao>
        </div>
      ))}

      <div>
        <Botao
          tom="secundario"
          type="button"
          onClick={() => {
            const livre = disponiveis.find(
              (atual) => !embalagens.some((atual2) => atual2.unidade === atual.codigo),
            );
            if (livre === undefined) return;

            aoMudar([...embalagens, { unidade: livre.codigo, fator: "12" }]);
          }}
        >
          Adicionar embalagem
        </Botao>
      </div>
    </fieldset>
  );
}
