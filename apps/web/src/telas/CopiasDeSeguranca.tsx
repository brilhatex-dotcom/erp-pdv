import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoSelecao, CampoTexto, Carregando, ErroDeTela, Vazio } from "@erp/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * As cópias de segurança do banco da loja.
 *
 * ### A pergunta que a tela responde primeiro
 *
 * "Se o computador queimar agora, o que eu perco?" — por isso o topo diz quando
 * foi a última cópia **boa** (conferida), o que há nela, e se a última
 * tentativa falhou. A lista vem depois.
 *
 * ### Restaurar não é um clique
 *
 * Restaurar troca o banco inteiro. A tela confere a cópia primeiro (abre numa
 * base à parte), mostra lado a lado o que há nela e no banco de agora, avisa
 * dos caixas abertos, e só então pede a palavra RESTAURAR. Quem decide é o
 * servidor; a tela só não deixa ninguém chegar lá distraído.
 *
 * ### Quem pode
 *
 * Ver e fazer uma cópia agora: `backup:executar` (gerente). Mudar a agenda,
 * conferir e restaurar: `config:backup` (administrador).
 */

interface Resumo {
  readonly vendas: number;
  readonly produtos: number;
  readonly clientes: number;
  readonly primeiraVenda?: string;
  readonly ultimaVenda?: string;
  readonly caixasAbertos: number;
  readonly versao?: string;
}

type Origem = "AUTOMATICA" | "MANUAL" | "FECHAMENTO_DE_CAIXA" | "ANTES_DE_RESTAURAR";

interface Copia {
  readonly nome: string;
  readonly criadaEm: string;
  readonly origem: Origem;
  readonly tamanhoBytes: number;
  readonly conferida: boolean;
  readonly resumo?: Resumo;
  readonly motivo?: string;
}

interface Tentativa {
  readonly origem: Origem;
  readonly situacao: "EM_ANDAMENTO" | "CONCLUIDO" | "FALHOU";
  readonly iniciadaEm: string;
  readonly erro?: string;
}

interface Agenda {
  readonly intervaloHoras: number;
  readonly aoFecharCaixa: boolean;
}

type Situacao =
  | { readonly configurada: false }
  | {
      readonly configurada: true;
      readonly pasta: string;
      readonly copias: readonly Copia[];
      readonly configuracao: Agenda;
      readonly ultimaTentativa?: Tentativa;
      readonly emAndamento: boolean;
      readonly proximaAutomatica?: string;
    };

interface Conferencia {
  readonly copia: Copia;
  readonly restaurou: boolean;
  readonly daCopia?: Resumo;
  readonly motivo?: string;
  readonly atual: Resumo;
  readonly compativel: boolean;
}

type Estado =
  | { readonly fase: "CARREGANDO" }
  | { readonly fase: "FALHOU"; readonly mensagem: string }
  | { readonly fase: "PRONTO"; readonly situacao: Situacao };

const ORIGENS: Readonly<Record<Origem, string>> = {
  AUTOMATICA: "Automática",
  MANUAL: "Feita à mão",
  FECHAMENTO_DE_CAIXA: "Fechamento de caixa",
  ANTES_DE_RESTAURAR: "Antes de restaurar",
};

const INTERVALOS: readonly { readonly valor: string; readonly rotulo: string }[] = [
  { valor: "1", rotulo: "De hora em hora" },
  { valor: "2", rotulo: "A cada 2 horas" },
  { valor: "4", rotulo: "A cada 4 horas" },
  { valor: "6", rotulo: "A cada 6 horas" },
  { valor: "12", rotulo: "A cada 12 horas" },
  { valor: "24", rotulo: "Uma vez por dia" },
];

const PALAVRA = "RESTAURAR";

export function CopiasDeSeguranca(): ReactNode {
  const { cliente: api } = useSessao();
  const [estado, setEstado] = useState<Estado>({ fase: "CARREGANDO" });
  const jaCarregou = useRef(false);

  async function carregar(): Promise<void> {
    setEstado({ fase: "CARREGANDO" });

    try {
      const situacao = await api.requisitar<Situacao>("/api/copias-de-seguranca");
      setEstado({ fase: "PRONTO", situacao });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaCarregou.current) return;
    jaCarregou.current = true;
    void carregar();
  });

  if (estado.fase === "CARREGANDO") return <Carregando oQue="as cópias de segurança" />;

  if (estado.fase === "FALHOU") {
    return (
      <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void carregar()} />
    );
  }

  if (!estado.situacao.configurada) {
    return (
      <Vazio
        titulo="As cópias de segurança não estão configuradas nesta instalação."
        descricao="Chame o suporte: sem elas, a loja não tem como voltar se o computador falhar."
      />
    );
  }

  return (
    <Painel
      situacao={estado.situacao}
      aoMudar={(situacao) => {
        setEstado({ fase: "PRONTO", situacao });
      }}
      aoRecarregar={() => void carregar()}
    />
  );
}

type SituacaoConfigurada = Extract<Situacao, { readonly configurada: true }>;

function Painel(props: {
  readonly situacao: SituacaoConfigurada;
  readonly aoMudar: (situacao: SituacaoConfigurada) => void;
  readonly aoRecarregar: () => void;
}): ReactNode {
  const { cliente: api, pode } = useSessao();
  const { situacao } = props;
  const [copiando, setCopiando] = useState(false);
  const [aviso, setAviso] = useState<{ readonly ok: boolean; readonly texto: string }>();
  const [escolhida, setEscolhida] = useState<Copia>();
  const administrador = pode("config:backup");

  async function copiarAgora(): Promise<void> {
    setCopiando(true);
    setAviso(undefined);

    try {
      const { copia } = await api.requisitar<{ readonly copia: Copia }>(
        "/api/copias-de-seguranca",
        { metodo: "POST" },
      );

      setAviso(
        copia.conferida
          ? { ok: true, texto: `Cópia feita e conferida: ${conteudo(copia)}.` }
          : {
              ok: false,
              texto: `A cópia foi feita, mas não passou na conferência (${copia.motivo ?? "sem motivo"}). Chame o suporte.`,
            },
      );
      props.aoRecarregar();
    } catch (causa) {
      setAviso({ ok: false, texto: mensagemDe(causa) });
    } finally {
      setCopiando(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-tinta">Cópias de segurança</h1>
        <p className="text-sm text-tinta-suave">
          O sistema copia o banco da loja sozinho e confere cada cópia, abrindo-a à parte
          para provar que ela restaura.
        </p>
      </header>

      <Resumo situacao={situacao} />

      <div className="flex flex-wrap items-center gap-3">
        <Botao
          tamanho="grande"
          ocupado={copiando}
          rotuloOcupado="Fazendo a cópia…"
          disabled={situacao.emAndamento}
          onClick={() => void copiarAgora()}
        >
          Fazer uma cópia agora
        </Botao>
        {copiando && (
          <span role="status" className="text-sm text-tinta-suave">
            Pode levar alguns minutos. O caixa continua vendendo.
          </span>
        )}
        {situacao.emAndamento && !copiando && (
          <span role="status" className="text-sm text-tinta-suave">
            Uma cópia está sendo feita agora.
          </span>
        )}
      </div>

      {aviso !== undefined && (
        <p
          role={aviso.ok ? "status" : "alert"}
          className={`rounded-md border px-3 py-2 text-tinta ${
            aviso.ok ? "border-ok bg-ok-suave" : "border-erro bg-erro-suave"
          }`}
        >
          {aviso.texto}
        </p>
      )}

      <AgendaDasCopias
        agenda={situacao.configuracao}
        podeMudar={administrador}
        aoSalvar={(configuracao) => {
          props.aoMudar({ ...situacao, configuracao });
        }}
      />

      <ListaDeCopias
        copias={situacao.copias}
        podeRestaurar={administrador}
        aoEscolher={setEscolhida}
      />

      {escolhida !== undefined && (
        <Restauracao
          key={escolhida.nome}
          copia={escolhida}
          aoFechar={() => {
            setEscolhida(undefined);
          }}
          aoRestaurar={(texto) => {
            setEscolhida(undefined);
            setAviso({ ok: true, texto });
            props.aoRecarregar();
          }}
        />
      )}

      <p className="text-sm text-tinta-suave">
        As cópias ficam em <span className="font-numero">{situacao.pasta}</span>, no disco
        deste computador. Para ter uma cópia fora da loja — contra roubo, incêndio ou
        disco queimado —, copie os arquivos dessa pasta para um pendrive de vez em quando
        e guarde-o em outro lugar.
      </p>
    </section>
  );
}

/** "Se queimar agora, o que eu perco?" — a resposta, em uma olhada. */
function Resumo({ situacao }: { readonly situacao: SituacaoConfigurada }): ReactNode {
  const ultimaBoa = situacao.copias.find((copia) => copia.conferida);
  const tentativa = situacao.ultimaTentativa;
  // Mais velha que duas voltas da agenda: alguma coisa está impedindo a cópia.
  const atrasada =
    ultimaBoa === undefined ||
    Date.now() - new Date(ultimaBoa.criadaEm).getTime() >
      2 * situacao.configuracao.intervaloHoras * 3_600_000;

  return (
    <div className="flex flex-col gap-2">
      {ultimaBoa === undefined ? (
        <p
          role="alert"
          className="rounded-md border border-atencao bg-atencao-suave px-3 py-2 text-tinta"
        >
          Ainda não há nenhuma cópia conferida. Faça uma agora.
        </p>
      ) : (
        <p
          className={`rounded-md border px-3 py-2 text-tinta ${
            atrasada ? "border-atencao bg-atencao-suave" : "border-ok bg-ok-suave"
          }`}
        >
          Última cópia boa: <strong>{quando(ultimaBoa.criadaEm)}</strong> (
          {haQuantoTempo(ultimaBoa.criadaEm)}) — {conteudo(ultimaBoa)}.
          {atrasada &&
            " Ela está velha: faça uma cópia agora e, se falhar, chame o suporte."}
        </p>
      )}

      {tentativa?.situacao === "FALHOU" && (
        <p
          role="alert"
          className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
        >
          A última tentativa, em {quando(tentativa.iniciadaEm)}, não deu certo:{" "}
          {tentativa.erro ?? "sem detalhe"}
        </p>
      )}

      <p className="text-sm text-tinta-suave">
        Cópia automática: {rotuloDoIntervalo(situacao.configuracao.intervaloHoras)}
        {situacao.configuracao.aoFecharCaixa ? ", e a cada fechamento de caixa" : ""}.
        {situacao.proximaAutomatica !== undefined &&
          ` Próxima: ${proxima(situacao.proximaAutomatica)}.`}
      </p>
    </div>
  );
}

function AgendaDasCopias(props: {
  readonly agenda: Agenda;
  readonly podeMudar: boolean;
  readonly aoSalvar: (agenda: Agenda) => void;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [intervalo, setIntervalo] = useState(String(props.agenda.intervaloHoras));
  const [aoFechar, setAoFechar] = useState(props.agenda.aoFecharCaixa);
  const [salvando, setSalvando] = useState(false);
  const [resultado, setResultado] = useState<{
    readonly ok: boolean;
    readonly texto: string;
  }>();

  if (!props.podeMudar) return null;

  async function salvar(): Promise<void> {
    setSalvando(true);
    setResultado(undefined);

    try {
      const { configuracao } = await api.requisitar<{ readonly configuracao: Agenda }>(
        "/api/copias-de-seguranca/agenda",
        {
          metodo: "PUT",
          corpo: { intervaloHoras: Number(intervalo), aoFecharCaixa: aoFechar },
        },
      );

      props.aoSalvar(configuracao);
      setResultado({ ok: true, texto: "Agenda salva." });
    } catch (causa) {
      setResultado({ ok: false, texto: mensagemDe(causa) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form
      noValidate
      aria-label="Agenda das cópias"
      className="flex flex-col gap-3 rounded-md border border-borda p-4"
      onSubmit={(evento) => {
        evento.preventDefault();
        void salvar();
      }}
    >
      <h2 className="text-lg font-semibold text-tinta">Agenda</h2>
      <div className="grid items-end gap-4 sm:grid-cols-[2fr_2fr_auto]">
        <CampoSelecao
          rotulo="Cópia automática"
          valor={intervalo}
          opcoes={INTERVALOS}
          aoMudar={(valor) => {
            setResultado(undefined);
            setIntervalo(valor);
          }}
        />
        <label className="flex items-center gap-3 py-2 text-tinta">
          <input
            type="checkbox"
            className="size-5 accent-acao"
            checked={aoFechar}
            onChange={(evento) => {
              setResultado(undefined);
              setAoFechar(evento.target.checked);
            }}
          />
          Fazer uma cópia a cada fechamento de caixa
        </label>
        <Botao type="submit" ocupado={salvando} rotuloOcupado="Salvando…">
          Salvar agenda
        </Botao>
      </div>
      {resultado !== undefined && (
        <p role={resultado.ok ? "status" : "alert"} className="text-sm text-tinta">
          {resultado.texto}
        </p>
      )}
    </form>
  );
}

function ListaDeCopias(props: {
  readonly copias: readonly Copia[];
  readonly podeRestaurar: boolean;
  readonly aoEscolher: (copia: Copia) => void;
}): ReactNode {
  if (props.copias.length === 0) {
    return (
      <Vazio
        titulo="Nenhuma cópia na pasta ainda."
        descricao="A primeira cópia automática sai em instantes — ou faça uma agora."
      />
    );
  }

  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">Cópias guardadas</caption>
      <thead>
        <tr className="border-b border-borda text-tinta-suave">
          <th scope="col" className="py-2 pr-3 font-medium">
            Quando
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Por quê
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            O que tem dentro
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Tamanho
          </th>
          {props.podeRestaurar && (
            <th scope="col" className="py-2 font-medium">
              <span className="sr-only">Ações</span>
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {props.copias.map((copia) => (
          <tr key={copia.nome} className="border-b border-borda align-top text-tinta">
            <td className="py-2 pr-3 font-numero whitespace-nowrap">
              {quando(copia.criadaEm)}
            </td>
            <td className="py-2 pr-3">{ORIGENS[copia.origem]}</td>
            <td className="py-2 pr-3">
              {copia.conferida ? (
                conteudo(copia)
              ) : (
                <span className="text-erro">
                  Não restaurou na conferência: {copia.motivo ?? "sem motivo"}
                </span>
              )}
            </td>
            <td className="py-2 pr-3 font-numero whitespace-nowrap">
              {formatarTamanho(copia.tamanhoBytes)}
            </td>
            {props.podeRestaurar && (
              <td className="py-2">
                <Botao
                  tom="secundario"
                  aria-label={`Conferir e restaurar a cópia de ${quando(copia.criadaEm)}`}
                  onClick={() => {
                    props.aoEscolher(copia);
                  }}
                >
                  Conferir e restaurar…
                </Botao>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type EstadoDaRestauracao =
  | { readonly fase: "CONFERINDO" }
  | { readonly fase: "NAO_CONFERIU"; readonly mensagem: string }
  | { readonly fase: "CONFERIDA"; readonly conferencia: Conferencia };

function Restauracao(props: {
  readonly copia: Copia;
  readonly aoFechar: () => void;
  readonly aoRestaurar: (texto: string) => void;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [estado, setEstado] = useState<EstadoDaRestauracao>({ fase: "CONFERINDO" });
  const [confirmacao, setConfirmacao] = useState("");
  const [mesmoComCaixas, setMesmoComCaixas] = useState(false);
  const [restaurando, setRestaurando] = useState(false);
  const [erro, setErro] = useState<string>();
  const painel = useRef<HTMLElement>(null);
  const jaConferiu = useRef(false);
  const de = quando(props.copia.criadaEm);

  async function conferir(): Promise<void> {
    setEstado({ fase: "CONFERINDO" });

    try {
      const { conferencia } = await api.requisitar<{ readonly conferencia: Conferencia }>(
        `/api/copias-de-seguranca/${encodeURIComponent(props.copia.nome)}/conferencia`,
        { metodo: "POST" },
      );
      setEstado({ fase: "CONFERIDA", conferencia });
    } catch (causa) {
      setEstado({ fase: "NAO_CONFERIU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaConferiu.current) return;
    jaConferiu.current = true;
    painel.current?.focus();
    void conferir();
  });

  async function restaurar(): Promise<void> {
    setRestaurando(true);
    setErro(undefined);

    try {
      const saida = await api.requisitar<{ readonly copiaDeAntes: Copia }>(
        `/api/copias-de-seguranca/${encodeURIComponent(props.copia.nome)}/restauracao`,
        {
          metodo: "POST",
          corpo: mesmoComCaixas
            ? { confirmacao, comCaixasAbertos: true }
            : { confirmacao },
        },
      );

      props.aoRestaurar(
        `Cópia de ${de} restaurada. O banco de antes ficou guardado na cópia de ${quando(saida.copiaDeAntes.criadaEm)} — se foi engano, é por ela que se volta. Se o sistema pedir, entre de novo.`,
      );
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setRestaurando(false);
    }
  }

  return (
    <section
      ref={painel}
      tabIndex={-1}
      aria-label={`Restaurar a cópia de ${de}`}
      className="flex flex-col gap-4 rounded-md border-2 border-atencao p-4 outline-none"
    >
      <h2 className="text-lg font-semibold text-tinta">Restaurar a cópia de {de}</h2>

      {estado.fase === "CONFERINDO" && (
        <Carregando oQue="a cópia — ela está sendo aberta à parte, para conferir" />
      )}

      {estado.fase === "NAO_CONFERIU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void conferir()} />
      )}

      {estado.fase === "CONFERIDA" && (
        <ConferenciaLadoALado conferencia={estado.conferencia} de={de} />
      )}

      {estado.fase === "CONFERIDA" && estado.conferencia.compativel && (
        <form
          noValidate
          className="flex flex-col gap-3"
          onSubmit={(evento) => {
            evento.preventDefault();
            void restaurar();
          }}
        >
          <p className="text-tinta">
            Restaurar troca o banco inteiro pelo desta cópia: tudo o que foi feito depois
            de {de} sai do sistema. Antes de trocar, o sistema faz uma cópia do banco de
            agora — se for engano, é por ela que se volta. Durante a troca, os caixas
            continuam vendendo e mandam as vendas quando o sistema voltar.
          </p>
          {estado.conferencia.atual.caixasAbertos > 0 && (
            <label className="flex items-start gap-3 text-tinta">
              <input
                type="checkbox"
                className="mt-1 size-5 accent-erro"
                checked={mesmoComCaixas}
                onChange={(evento) => {
                  setMesmoComCaixas(evento.target.checked);
                }}
              />
              Restaurar mesmo com caixas abertos — só se não houver como fechá-los. As
              vendas que as estações guardarem durante a troca podem ser recusadas.
            </label>
          )}
          <div className="grid items-end gap-4 sm:grid-cols-[2fr_auto]">
            <CampoTexto
              rotulo={`Para confirmar, digite ${PALAVRA}`}
              value={confirmacao}
              autoComplete="off"
              onChange={(evento) => {
                setConfirmacao(evento.target.value);
              }}
            />
            <Botao
              type="submit"
              tom="perigo"
              ocupado={restaurando}
              rotuloOcupado="Restaurando…"
              disabled={
                confirmacao.trim().toUpperCase() !== PALAVRA ||
                (estado.conferencia.atual.caixasAbertos > 0 && !mesmoComCaixas)
              }
            >
              Restaurar esta cópia
            </Botao>
          </div>
          {restaurando && (
            <p role="status" className="text-sm text-tinta-suave">
              Conferindo de novo, copiando o banco de agora e trocando. Não feche esta
              tela.
            </p>
          )}
          {erro !== undefined && (
            <p role="alert" className="text-sm text-erro">
              {erro}
            </p>
          )}
        </form>
      )}

      <div>
        <Botao tom="secundario" disabled={restaurando} onClick={props.aoFechar}>
          {estado.fase === "CONFERIDA" && estado.conferencia.compativel
            ? "Cancelar"
            : "Fechar"}
        </Botao>
      </div>
    </section>
  );
}

function ConferenciaLadoALado(props: {
  readonly conferencia: Conferencia;
  readonly de: string;
}): ReactNode {
  const { conferencia } = props;
  const daCopia = conferencia.daCopia;

  if (!conferencia.restaurou || daCopia === undefined) {
    return (
      <p role="alert" className="text-erro">
        Esta cópia não restaurou na conferência ({conferencia.motivo ?? "sem motivo"}).
        Escolha outra.
      </p>
    );
  }

  const linhas: readonly (readonly [string, string, string])[] = [
    ["Vendas", numero(daCopia.vendas), numero(conferencia.atual.vendas)],
    [
      "Última venda",
      dataOuTraco(daCopia.ultimaVenda),
      dataOuTraco(conferencia.atual.ultimaVenda),
    ],
    ["Produtos", numero(daCopia.produtos), numero(conferencia.atual.produtos)],
    ["Clientes", numero(daCopia.clientes), numero(conferencia.atual.clientes)],
  ];

  return (
    <div className="flex flex-col gap-3">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">A cópia ao lado do banco de agora</caption>
        <thead>
          <tr className="border-b border-borda text-tinta-suave">
            <th scope="col" className="py-2 pr-3 font-medium">
              <span className="sr-only">O quê</span>
            </th>
            <th scope="col" className="py-2 pr-3 font-medium">
              Na cópia de {props.de}
            </th>
            <th scope="col" className="py-2 font-medium">
              No banco de agora
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.map(([rotulo, naCopia, agora]) => (
            <tr key={rotulo} className="border-b border-borda text-tinta">
              <th scope="row" className="py-2 pr-3 font-medium">
                {rotulo}
              </th>
              <td className="py-2 pr-3 font-numero">{naCopia}</td>
              <td className="py-2 font-numero">{agora}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {!conferencia.compativel && (
        <p role="alert" className="text-erro">
          Esta cópia é de outra versão do sistema e não pode ser restaurada por aqui.
          Chame o suporte.
        </p>
      )}

      {conferencia.compativel && conferencia.atual.caixasAbertos > 0 && (
        <p
          role="alert"
          className="rounded-md border border-atencao bg-atencao-suave px-3 py-2 text-tinta"
        >
          {conferencia.atual.caixasAbertos === 1
            ? "Há 1 caixa aberto agora."
            : `Há ${String(conferencia.atual.caixasAbertos)} caixas abertos agora.`}{" "}
          Feche os caixas antes de restaurar: o caixa aberto depois da cópia some junto
          com o resto, e a venda que a estação guardar durante a troca não teria onde
          entrar.
        </p>
      )}
    </div>
  );
}

function conteudo(copia: Copia): string {
  const resumo = copia.resumo;
  if (resumo === undefined) return "sem resumo";

  return `${quantas(resumo.vendas, "venda", "vendas")}, ${quantas(resumo.produtos, "produto", "produtos")}, ${quantas(resumo.clientes, "cliente", "clientes")}`;
}

function quantas(quantidade: number, singular: string, plural: string): string {
  return `${numero(quantidade)} ${quantidade === 1 ? singular : plural}`;
}

function numero(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

function quando(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dataOuTraco(iso: string | undefined): string {
  return iso === undefined ? "—" : quando(iso);
}

function proxima(iso: string): string {
  return new Date(iso).getTime() <= Date.now() ? "em instantes" : quando(iso);
}

/** "há 12 minutos", "há 3 horas", "há 2 dias". */
export function haQuantoTempo(iso: string, agora = new Date()): string {
  const minutos = Math.floor((agora.getTime() - new Date(iso).getTime()) / 60_000);

  if (minutos < 2) return "agora há pouco";
  if (minutos < 60) return `há ${String(minutos)} minutos`;

  const horas = Math.floor(minutos / 60);
  if (horas < 48) return horas === 1 ? "há 1 hora" : `há ${String(horas)} horas`;

  return `há ${String(Math.floor(horas / 24))} dias`;
}

function rotuloDoIntervalo(horas: number): string {
  return (
    INTERVALOS.find((opcao) => opcao.valor === String(horas))?.rotulo.toLowerCase() ??
    `a cada ${String(horas)} horas`
  );
}

/** `850 KB`, `12,3 MB`. */
export function formatarTamanho(bytes: number): string {
  if (bytes < 1024 * 1024) return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;

  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
