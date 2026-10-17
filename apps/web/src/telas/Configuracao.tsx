import { ErroDaApi, mensagemDe, useSessao } from "@erp/cliente-api";
import {
  Botao,
  CampoSelecao,
  CampoTexto,
  Carregando,
  ErroDeTela,
  formatarDinheiro,
  formatarQuantidade,
} from "@erp/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { EnviarImagem } from "../componentes/EnviarImagem.js";

/**
 * Como a loja vende — o segmento, os recursos, o estoque, o comprovante, a
 * balança e o logotipo.
 *
 * ### O segmento sugere, não decide
 *
 * Escolher "padaria" oferece os recursos que padaria costuma usar, e o gerente
 * aplica com um toque. Mas é sugestão: a padaria que vende fiado liga o fiado,
 * e ninguém precisa escolher "misto" para isso.
 *
 * ### A balança se confere antes de gravar
 *
 * O formato da etiqueta muda de balança para balança. Gravar sem conferir é o
 * defeito que só aparece na primeira pesagem, com cliente na fila. Por isso a
 * tela mostra uma etiqueta de exemplo no formato escolhido, e lê uma etiqueta
 * de verdade bipada pelo gerente.
 *
 * ### Quem pode
 *
 * Ler é de todos — a tela explica como a loja está configurada. Gravar é de
 * quem tem `config:empresa`, e quem decide é o servidor.
 */

type Segmento = "PADARIA" | "MERCADINHO" | "FRUTARIA" | "MISTO";
type Recurso = "VENDA_POR_PESO" | "FIADO" | "BOTOES_RAPIDOS";
type VendaSemEstoque = "PERMITIR" | "AUTORIZAR" | "BLOQUEAR";

interface LayoutBalanca {
  readonly prefixos: readonly string[];
  readonly tamanhoCodigoProduto: number;
  readonly conteudo: "PESO" | "PRECO";
  readonly casasDecimais: number;
}

interface ConfiguracaoDaLoja {
  readonly segmento: Segmento;
  readonly recursos: readonly Recurso[];
  readonly vendaSemEstoque: VendaSemEstoque;
  readonly larguraCupom: 58 | 80;
  readonly impressaoComprovante: "SEMPRE" | "SOB_PEDIDO";
  readonly layoutBalanca: LayoutBalanca;
  readonly logoId?: string;
  readonly gravada: boolean;
  readonly padroes: Readonly<Record<Segmento, readonly Recurso[]>>;
}

interface Integracao {
  readonly codigo: string;
  readonly nome: string;
  readonly situacao: "DISPONIVEL" | "EM_CONFIGURACAO" | "NAO_IMPLEMENTADA";
  readonly explicacao: string;
}

interface TesteDeBalanca {
  readonly exemplo?: {
    readonly etiqueta: string;
    readonly significado: string;
  };
  readonly leitura?:
    | { readonly valida: false; readonly mensagem: string }
    | {
        readonly valida: true;
        readonly codigoProduto: string;
        readonly peso?: { readonly milesimos: string; readonly unidade: string };
        readonly preco?: string;
      };
}

const SEGMENTOS: readonly {
  readonly valor: Segmento;
  readonly rotulo: string;
  readonly explicacao: string;
}[] = [
  {
    valor: "PADARIA",
    rotulo: "Padaria",
    explicacao: "Pão por unidade e por peso, com botões na tela do caixa.",
  },
  {
    valor: "MERCADINHO",
    rotulo: "Mercadinho",
    explicacao: "Quase tudo com código de barras, e fiado para os clientes de sempre.",
  },
  {
    valor: "FRUTARIA",
    rotulo: "Frutaria",
    explicacao: "Quase tudo na balança, com botões para o que não tem etiqueta.",
  },
  { valor: "MISTO", rotulo: "Misto", explicacao: "Um pouco de cada." },
];

const RECURSOS: readonly {
  readonly valor: Recurso;
  readonly rotulo: string;
  readonly explicacao: string;
}[] = [
  {
    valor: "VENDA_POR_PESO",
    rotulo: "Venda por peso",
    explicacao: "Produto de balança: o caixa lê a etiqueta ou pede o peso.",
  },
  {
    valor: "FIADO",
    rotulo: "Fiado",
    explicacao: "Vender para o cliente pagar depois, até o limite do cadastro dele.",
  },
  {
    valor: "BOTOES_RAPIDOS",
    rotulo: "Botões rápidos",
    explicacao: "Produtos sem código de barras em botões com foto, na tela do caixa.",
  },
];

const SEM_ESTOQUE: readonly {
  readonly valor: VendaSemEstoque;
  readonly rotulo: string;
}[] = [
  { valor: "PERMITIR", rotulo: "Vender normalmente (o estoque fica negativo)" },
  { valor: "AUTORIZAR", rotulo: "Pedir a liberação do supervisor" },
  { valor: "BLOQUEAR", rotulo: "Não vender" },
];

const SITUACOES: Readonly<Record<Integracao["situacao"], string>> = {
  DISPONIVEL: "Disponível",
  EM_CONFIGURACAO: "Em configuração",
  NAO_IMPLEMENTADA: "Não implementada",
};

type Estado =
  | { readonly fase: "CARREGANDO" }
  | { readonly fase: "FALHOU"; readonly mensagem: string }
  | {
      readonly fase: "PRONTO";
      readonly configuracao: ConfiguracaoDaLoja;
      readonly integracoes: readonly Integracao[];
    };

export function Configuracao(): ReactNode {
  const { cliente: api } = useSessao();
  const [estado, setEstado] = useState<Estado>({ fase: "CARREGANDO" });
  const jaCarregou = useRef(false);

  async function carregar(): Promise<void> {
    setEstado({ fase: "CARREGANDO" });

    try {
      const [configuracao, integracoes] = await Promise.all([
        api.requisitar<ConfiguracaoDaLoja>("/api/configuracao"),
        // A lista de integrações é informação de apoio: se falhar, a tela de
        // configuração continua servindo para o que importa.
        api
          .requisitar<{ readonly integracoes: readonly Integracao[] }>(
            "/api/pdv/contexto",
          )
          .then((contexto) => contexto.integracoes)
          .catch(() => []),
      ]);

      setEstado({ fase: "PRONTO", configuracao, integracoes });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaCarregou.current) return;
    jaCarregou.current = true;
    void carregar();
  });

  if (estado.fase === "CARREGANDO") return <Carregando oQue="a configuração da loja" />;

  if (estado.fase === "FALHOU") {
    return (
      <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void carregar()} />
    );
  }

  return (
    <Formulario configuracao={estado.configuracao} integracoes={estado.integracoes} />
  );
}

function Formulario(props: {
  readonly configuracao: ConfiguracaoDaLoja;
  readonly integracoes: readonly Integracao[];
}): ReactNode {
  const { cliente: api, pode } = useSessao();
  const inicial = props.configuracao;
  const somenteLeitura = !pode("config:empresa");

  const [segmento, setSegmento] = useState<Segmento>(inicial.segmento);
  const [recursos, setRecursos] = useState<readonly Recurso[]>(inicial.recursos);
  const [vendaSemEstoque, setVendaSemEstoque] = useState(inicial.vendaSemEstoque);
  const [larguraCupom, setLarguraCupom] = useState(inicial.larguraCupom);
  const [impressao, setImpressao] = useState(inicial.impressaoComprovante);
  const [logoId, setLogoId] = useState(inicial.logoId);
  const [prefixos, setPrefixos] = useState(inicial.layoutBalanca.prefixos.join(", "));
  const [tamanhoCodigo, setTamanhoCodigo] = useState(
    String(inicial.layoutBalanca.tamanhoCodigoProduto),
  );
  const [conteudo, setConteudo] = useState(inicial.layoutBalanca.conteudo);
  const [casas, setCasas] = useState(String(inicial.layoutBalanca.casasDecimais));
  const [erros, setErros] = useState<readonly string[]>([]);
  const [salva, setSalva] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const recomendados = inicial.padroes[segmento];
  const segueRecomendacao =
    recomendados.length === recursos.length &&
    recomendados.every((recurso) => recursos.includes(recurso));

  function layout(): LayoutBalanca {
    return {
      prefixos: prefixos
        .split(/[\s,;]+/)
        .map((prefixo) => prefixo.trim())
        .filter((prefixo) => prefixo !== ""),
      tamanhoCodigoProduto: Number(tamanhoCodigo),
      conteudo,
      casasDecimais: Number(casas),
    };
  }

  function alternarRecurso(recurso: Recurso, ligado: boolean): void {
    setSalva(false);
    setRecursos((atuais) =>
      ligado ? [...atuais, recurso] : atuais.filter((atual) => atual !== recurso),
    );
  }

  async function salvar(): Promise<void> {
    setSalvando(true);
    setErros([]);
    setSalva(false);

    try {
      const gravada = await api.requisitar<ConfiguracaoDaLoja>("/api/configuracao", {
        metodo: "PUT",
        corpo: {
          segmento,
          recursos,
          vendaSemEstoque,
          larguraCupom,
          impressaoComprovante: impressao,
          layoutBalanca: layout(),
          // `null` tira o logotipo; ausente manteria o que está gravado.
          logoId: logoId ?? null,
        },
      });

      setRecursos(gravada.recursos);
      setSalva(true);
    } catch (causa) {
      setErros(errosDe(causa));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-tinta">Configuração da loja</h1>
        <p className="text-sm text-tinta-suave">
          Como o caixa se comporta. Vale para todos os caixas da loja assim que for salva.
        </p>
      </header>

      {!inicial.gravada && (
        <p className="rounded-md border border-atencao bg-atencao-suave px-3 py-2 text-tinta">
          A loja ainda usa a configuração de fábrica. Confira e salve para começar.
        </p>
      )}

      {somenteLeitura && (
        <p className="rounded-md border border-borda bg-papel-fundo px-3 py-2 text-tinta">
          Você pode consultar a configuração. Para mudar, peça ao gerente.
        </p>
      )}

      <form
        noValidate
        className="flex flex-col gap-6"
        onSubmit={(evento) => {
          evento.preventDefault();
          void salvar();
        }}
      >
        <fieldset disabled={somenteLeitura} className="flex flex-col gap-6">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-lg font-semibold text-tinta">Tipo de loja</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SEGMENTOS.map((opcao) => (
                <label
                  key={opcao.valor}
                  className={`flex cursor-pointer gap-3 rounded-md border p-3 ${
                    segmento === opcao.valor
                      ? "border-acao bg-acao-suave"
                      : "border-borda"
                  }`}
                >
                  <input
                    type="radio"
                    name="segmento"
                    value={opcao.valor}
                    checked={segmento === opcao.valor}
                    className="mt-1 size-5 accent-acao"
                    onChange={() => {
                      setSalva(false);
                      setSegmento(opcao.valor);
                    }}
                  />
                  <span>
                    <span className="block font-medium text-tinta">{opcao.rotulo}</span>
                    <span className="block text-sm text-tinta-suave">
                      {opcao.explicacao}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-lg font-semibold text-tinta">
              Recursos do caixa
            </legend>
            {RECURSOS.map((opcao) => (
              <label key={opcao.valor} className="flex cursor-pointer gap-3">
                <input
                  type="checkbox"
                  checked={recursos.includes(opcao.valor)}
                  className="mt-1 size-5 accent-acao"
                  onChange={(evento) => {
                    alternarRecurso(opcao.valor, evento.target.checked);
                  }}
                />
                <span>
                  <span className="block font-medium text-tinta">{opcao.rotulo}</span>
                  <span className="block text-sm text-tinta-suave">
                    {opcao.explicacao}
                  </span>
                </span>
              </label>
            ))}
            {!segueRecomendacao && (
              <div>
                <Botao
                  tom="secundario"
                  onClick={() => {
                    setSalva(false);
                    setRecursos(recomendados);
                  }}
                >
                  Usar os recursos recomendados para{" "}
                  {SEGMENTOS.find(
                    (opcao) => opcao.valor === segmento,
                  )?.rotulo.toLowerCase()}
                </Botao>
              </div>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="text-lg font-semibold text-tinta">
              Produto sem estoque
            </legend>
            <p className="text-sm text-tinta-suave">
              O que o caixa faz quando o sistema diz que o produto acabou — e ele está na
              mão do cliente.
            </p>
            {SEM_ESTOQUE.map((opcao) => (
              <label
                key={opcao.valor}
                className="flex cursor-pointer items-center gap-3 text-tinta"
              >
                <input
                  type="radio"
                  name="vendaSemEstoque"
                  checked={vendaSemEstoque === opcao.valor}
                  className="size-5 accent-acao"
                  onChange={() => {
                    setSalva(false);
                    setVendaSemEstoque(opcao.valor);
                  }}
                />
                {opcao.rotulo}
              </label>
            ))}
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="text-lg font-semibold text-tinta">Comprovante</legend>
            <p className="text-sm text-tinta-suave">
              O comprovante do caixa não é documento fiscal, e sai sempre marcado assim.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <CampoSelecao
                rotulo="Largura do papel"
                valor={String(larguraCupom)}
                opcoes={[
                  { valor: "80", rotulo: "80 mm (o mais comum)" },
                  { valor: "58", rotulo: "58 mm (impressora pequena)" },
                ]}
                aoMudar={(valor) => {
                  setSalva(false);
                  setLarguraCupom(valor === "58" ? 58 : 80);
                }}
              />
              <CampoSelecao
                rotulo="Quando imprimir"
                valor={impressao}
                opcoes={[
                  { valor: "SEMPRE", rotulo: "Sempre, em toda venda" },
                  { valor: "SOB_PEDIDO", rotulo: "Só quando o cliente pedir" },
                ]}
                aoMudar={(valor) => {
                  setSalva(false);
                  setImpressao(valor === "SEMPRE" ? "SEMPRE" : "SOB_PEDIDO");
                }}
              />
            </div>
            <EnviarImagem
              rotulo="Logotipo da loja"
              imagemId={logoId}
              desabilitado={somenteLeitura}
              aoMudar={(novo) => {
                setSalva(false);
                setLogoId(novo);
              }}
            />
          </fieldset>

          <Balanca
            prefixos={prefixos}
            tamanhoCodigo={tamanhoCodigo}
            conteudo={conteudo}
            casas={casas}
            somenteLeitura={somenteLeitura}
            layout={layout}
            aoMudarPrefixos={(valor) => {
              setSalva(false);
              setPrefixos(valor);
            }}
            aoMudarTamanho={(valor) => {
              setSalva(false);
              setTamanhoCodigo(valor);
            }}
            aoMudarConteudo={(valor) => {
              setSalva(false);
              setConteudo(valor);
            }}
            aoMudarCasas={(valor) => {
              setSalva(false);
              setCasas(valor);
            }}
          />
        </fieldset>

        {erros.length > 0 && (
          <div
            role="alert"
            className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
          >
            <p>Não foi possível salvar:</p>
            <ul className="list-disc pl-5">
              {erros.map((mensagem) => (
                <li key={mensagem}>{mensagem}</li>
              ))}
            </ul>
          </div>
        )}

        {salva && (
          <p
            role="status"
            className="rounded-md border border-ok bg-ok-suave px-3 py-2 text-tinta"
          >
            Configuração salva. Os caixas passam a usá-la na próxima venda.
          </p>
        )}

        {!somenteLeitura && (
          <div>
            <Botao
              type="submit"
              tamanho="grande"
              ocupado={salvando}
              rotuloOcupado="Salvando…"
            >
              Salvar configuração
            </Botao>
          </div>
        )}
      </form>

      {props.integracoes.length > 0 && (
        <section aria-labelledby="titulo-integracoes" className="flex flex-col gap-2">
          <h2 id="titulo-integracoes" className="text-lg font-semibold text-tinta">
            Integrações
          </h2>
          <p className="text-sm text-tinta-suave">
            O que o sistema conversa com o mundo de fora, e em que pé está cada conversa.
          </p>
          <ul className="flex flex-col gap-2">
            {props.integracoes.map((integracao) => (
              <li
                key={integracao.codigo}
                className="rounded-md border border-borda px-3 py-2"
              >
                <span className="flex items-center justify-between gap-3">
                  <strong className="text-tinta">{integracao.nome}</strong>
                  <span
                    className={`rounded px-2 text-sm text-tinta ${
                      integracao.situacao === "DISPONIVEL"
                        ? "bg-ok-suave"
                        : integracao.situacao === "EM_CONFIGURACAO"
                          ? "bg-atencao-suave"
                          : "bg-papel-fundo"
                    }`}
                  >
                    {SITUACOES[integracao.situacao]}
                  </span>
                </span>
                <span className="block text-sm text-tinta-suave">
                  {integracao.explicacao}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/**
 * A etiqueta da balança — o formato e a conferência.
 *
 * O código de barras de balança tem 13 dígitos: o prefixo (geralmente 2), o
 * código do produto na balança, o peso ou o preço, e o dígito verificador. O
 * gerente escolhe o formato e confere com uma etiqueta de verdade.
 */
function Balanca(props: {
  readonly prefixos: string;
  readonly tamanhoCodigo: string;
  readonly conteudo: "PESO" | "PRECO";
  readonly casas: string;
  readonly somenteLeitura: boolean;
  readonly layout: () => LayoutBalanca;
  readonly aoMudarPrefixos: (valor: string) => void;
  readonly aoMudarTamanho: (valor: string) => void;
  readonly aoMudarConteudo: (valor: "PESO" | "PRECO") => void;
  readonly aoMudarCasas: (valor: string) => void;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [etiqueta, setEtiqueta] = useState("");
  const [teste, setTeste] = useState<TesteDeBalanca | undefined>(undefined);
  const [erros, setErros] = useState<readonly string[]>([]);
  const [testando, setTestando] = useState(false);

  async function testar(): Promise<void> {
    setTestando(true);
    setErros([]);
    setTeste(undefined);

    try {
      setTeste(
        await api.requisitar<TesteDeBalanca>("/api/configuracao/balanca/testar", {
          metodo: "POST",
          corpo: { layout: props.layout(), etiqueta: etiqueta.trim() },
        }),
      );
    } catch (causa) {
      setErros(errosDe(causa));
    } finally {
      setTestando(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-lg font-semibold text-tinta">Etiqueta da balança</legend>
      <p className="text-sm text-tinta-suave">
        Como a balança monta o código de barras da etiqueta. Na dúvida, bipe uma etiqueta
        de verdade e use o botão de conferir.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        <CampoTexto
          rotulo="Começa com"
          ajuda="O primeiro dígito da etiqueta. Mais de um: separe com vírgula, 20, 21."
          value={props.prefixos}
          onChange={(evento) => {
            props.aoMudarPrefixos(evento.target.value.replace(/[^\d,\s]/g, ""));
          }}
        />
        <CampoSelecao
          rotulo="Dígitos do código do produto"
          valor={props.tamanhoCodigo}
          opcoes={["4", "5", "6"].map((valor) => ({ valor, rotulo: `${valor} dígitos` }))}
          aoMudar={props.aoMudarTamanho}
        />
        <CampoSelecao
          rotulo="A etiqueta traz"
          valor={props.conteudo}
          opcoes={[
            { valor: "PESO", rotulo: "O peso" },
            { valor: "PRECO", rotulo: "O preço" },
          ]}
          aoMudar={(valor) => {
            props.aoMudarConteudo(valor === "PRECO" ? "PRECO" : "PESO");
          }}
        />
        <CampoSelecao
          rotulo="Casas depois da vírgula"
          ajuda="Peso em quilos costuma ter 3; preço em reais, 2."
          valor={props.casas}
          opcoes={["0", "1", "2", "3"].map((valor) => ({ valor, rotulo: valor }))}
          aoMudar={props.aoMudarCasas}
        />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <CampoTexto
            rotulo="Etiqueta para conferir (opcional)"
            numerico
            ajuda="Bipe aqui uma etiqueta impressa pela sua balança."
            value={etiqueta}
            onChange={(evento) => {
              setEtiqueta(evento.target.value.replace(/\D/g, "").slice(0, 20));
            }}
          />
        </div>
        <Botao
          tom="secundario"
          disabled={props.somenteLeitura}
          ocupado={testando}
          rotuloOcupado="Conferindo…"
          onClick={() => void testar()}
        >
          Conferir o formato
        </Botao>
      </div>

      {erros.length > 0 && (
        <ul
          role="alert"
          className="list-disc rounded-md border border-erro bg-erro-suave py-2 pl-8 pr-3 text-tinta"
        >
          {erros.map((mensagem) => (
            <li key={mensagem}>{mensagem}</li>
          ))}
        </ul>
      )}

      {teste !== undefined && (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-md border border-borda bg-papel-fundo px-3 py-2"
        >
          {teste.exemplo !== undefined && (
            <p className="text-tinta">
              Exemplo neste formato:{" "}
              <strong className="font-numero">{teste.exemplo.etiqueta}</strong> ={" "}
              {teste.exemplo.significado}.
            </p>
          )}
          {teste.leitura !== undefined &&
            (teste.leitura.valida ? (
              <p className="text-tinta">
                A etiqueta bipada foi lida: produto {teste.leitura.codigoProduto}
                {teste.leitura.peso !== undefined &&
                  `, ${formatarQuantidade(teste.leitura.peso.milesimos)} ${teste.leitura.peso.unidade.toLowerCase()}`}
                {teste.leitura.preco !== undefined &&
                  `, ${formatarDinheiro(teste.leitura.preco)}`}
                .
              </p>
            ) : (
              <p className="text-tinta">
                A etiqueta bipada não fecha com este formato: {teste.leitura.mensagem}
              </p>
            ))}
        </div>
      )}
    </fieldset>
  );
}

/** As mensagens de um erro — a lista de campos, quando o servidor a manda. */
function errosDe(causa: unknown): readonly string[] {
  const lista =
    causa instanceof ErroDaApi
      ? (causa.detalhes?.["erros"] as
          readonly { readonly mensagem?: unknown }[] | undefined)
      : undefined;

  const mensagens = (lista ?? [])
    .map((erro) => erro.mensagem)
    .filter((mensagem): mensagem is string => typeof mensagem === "string");

  return mensagens.length > 0 ? mensagens : [mensagemDe(causa)];
}
