import { mensagemDe, useSessao } from "@erp/cliente-api";
import {
  Botao,
  CampoSelecao,
  CampoTexto,
  Carregando,
  ErroDeTela,
  formatarDinheiro,
  reaisParaCentavos,
  Vazio,
} from "@erp/ui";
import { type ReactNode, type SyntheticEvent, useEffect, useRef, useState } from "react";

/**
 * Contas a receber e a pagar.
 *
 * ### A lista abre no que está vencido
 *
 * A pergunta que traz o lojista a esta tela é "quem eu preciso cobrar hoje",
 * não "quais são todos os meus títulos". Abrir na lista completa o obrigaria a
 * filtrar toda vez para chegar ao que interessa.
 *
 * ### Nada de mostrar o saldo antes de receber
 *
 * O campo de valor abre **em branco**, e não preenchido com o saldo. Preencher
 * parece atencioso e produz o erro caro: quem recebeu R$ 20 de uma dívida de
 * R$ 200 confirma sem ler e quita o título inteiro. Há um botão explícito para
 * quitar tudo, que é o caso comum e merece um clique — não um padrão silencioso.
 */

interface TituloDaLista {
  readonly id: string;
  readonly tipo: "RECEBER" | "PAGAR";
  readonly origem: string;
  readonly contraparteNome: string;
  readonly valorOriginal: string;
  readonly totalBaixado: string;
  readonly saldo: string;
  readonly vencimento: string;
  readonly parcela?: { readonly numero: number; readonly de: number };
  readonly descricao?: string;
  readonly situacao: "ABERTO" | "PARCIAL" | "QUITADO" | "CANCELADO";
  readonly vencido: boolean;
  readonly diasEmAtraso: number;
}

interface BaixaDoTitulo {
  readonly id: string;
  readonly tipo: "PAGAMENTO" | "ESTORNO";
  readonly valor: string;
  readonly ocorridaEm: string;
  readonly forma?: string;
  readonly observacao?: string;
}

interface TituloDetalhado extends TituloDaLista {
  readonly baixas: readonly BaixaDoTitulo[];
}

type Estado =
  | { readonly fase: "CARREGANDO" }
  | { readonly fase: "PRONTO"; readonly itens: readonly TituloDaLista[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

type Aba = "RECEBER" | "PAGAR";

const FORMAS = [
  { valor: "DINHEIRO", rotulo: "Dinheiro" },
  { valor: "PIX", rotulo: "PIX" },
  { valor: "CARTAO_DEBITO", rotulo: "Cartão de débito" },
  { valor: "CARTAO_CREDITO", rotulo: "Cartão de crédito" },
  { valor: "TRANSFERENCIA", rotulo: "Transferência" },
  { valor: "OUTRO", rotulo: "Outro" },
];

export function Financeiro(): ReactNode {
  const { cliente: api, pode } = useSessao();
  const [aba, setAba] = useState<Aba>("RECEBER");
  const [apenasVencidos, setApenasVencidos] = useState(false);
  const [estado, setEstado] = useState<Estado>({ fase: "CARREGANDO" });
  const [detalhe, setDetalhe] = useState<TituloDetalhado | undefined>(undefined);
  const [lancando, setLancando] = useState(false);
  const jaCarregou = useRef(false);

  async function carregar(tipo: Aba = aba, vencidos = apenasVencidos): Promise<void> {
    setEstado({ fase: "CARREGANDO" });

    const hoje = new Date().toISOString();
    const filtroVencidos = vencidos ? `&vencidosAte=${encodeURIComponent(hoje)}` : "";

    try {
      const resposta = await api.requisitar<{ itens: TituloDaLista[] }>(
        `/api/financeiro/titulos?tipo=${tipo}&apenasEmAberto=true${filtroVencidos}`,
      );
      setEstado({ fase: "PRONTO", itens: resposta.itens });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaCarregou.current) return;
    jaCarregou.current = true;
    void carregar();
  });

  async function abrirDetalhe(id: string): Promise<void> {
    try {
      setDetalhe(await api.requisitar<TituloDetalhado>(`/api/financeiro/titulos/${id}`));
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  if (lancando) {
    return (
      <Lancamento
        tipo={aba}
        aoConcluir={() => {
          setLancando(false);
          void carregar();
        }}
        aoCancelar={() => {
          setLancando(false);
        }}
      />
    );
  }

  if (detalhe !== undefined) {
    return (
      <Detalhe
        titulo={detalhe}
        podeLancar={pode("financeiro:lancar")}
        aoMudar={(atualizado) => {
          setDetalhe(atualizado);
        }}
        aoVoltar={() => {
          setDetalhe(undefined);
          void carregar();
        }}
      />
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-tinta">Financeiro</h1>
          <p className="text-sm text-tinta-suave">
            A caderneta da loja: quem deve, quanto e desde quando.
          </p>
        </div>

        {pode("financeiro:lancar") && (
          <Botao
            onClick={() => {
              setLancando(true);
            }}
          >
            Lançar conta
          </Botao>
        )}
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex gap-2" aria-label="Tipo de conta">
          {(
            [
              ["RECEBER", "A receber"],
              ["PAGAR", "A pagar"],
            ] as const
          ).map(([chave, rotulo]) => (
            <Botao
              key={chave}
              tom={aba === chave ? "primario" : "secundario"}
              aria-current={aba === chave ? "page" : undefined}
              onClick={() => {
                setAba(chave);
                void carregar(chave);
              }}
            >
              {rotulo}
            </Botao>
          ))}
        </nav>

        <label className="ml-auto flex items-center gap-2 text-tinta">
          <input
            type="checkbox"
            checked={apenasVencidos}
            className="size-5 accent-acao"
            onChange={(evento) => {
              setApenasVencidos(evento.target.checked);
              void carregar(aba, evento.target.checked);
            }}
          />
          Só vencidos
        </label>
      </div>

      {estado.fase === "CARREGANDO" && <Carregando oQue="as contas" />}

      {estado.fase === "FALHOU" && (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void carregar()} />
      )}

      {estado.fase === "PRONTO" && (
        <Lista
          itens={estado.itens}
          aoAbrir={(id) => void abrirDetalhe(id)}
          apenasVencidos={apenasVencidos}
        />
      )}
    </section>
  );
}

function Lista({
  itens,
  aoAbrir,
  apenasVencidos,
}: {
  readonly itens: readonly TituloDaLista[];
  readonly aoAbrir: (id: string) => void;
  readonly apenasVencidos: boolean;
}): ReactNode {
  if (itens.length === 0) {
    return (
      <Vazio
        titulo={apenasVencidos ? "Nada vencido" : "Nenhuma conta em aberto"}
        descricao={
          apenasVencidos
            ? "Todas as contas estão em dia."
            : "As contas aparecem aqui quando houver venda a prazo ou lançamento manual."
        }
      />
    );
  }

  const total = itens.reduce((soma, titulo) => soma + BigInt(titulo.saldo), 0n);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-tinta-suave">
        {itens.length === 1 ? "1 conta" : `${String(itens.length)} contas`} ·{" "}
        <strong className="font-numero text-tinta">{formatarDinheiro(total)}</strong> em
        aberto
      </p>

      <ul className="flex flex-col gap-2">
        {itens.map((titulo) => (
          <li key={titulo.id}>
            <button
              type="button"
              onClick={() => {
                aoAbrir(titulo.id);
              }}
              className="flex w-full flex-wrap items-center justify-between gap-3 rounded-md border border-borda bg-papel px-3 py-3 text-left hover:border-acao"
            >
              <div className="min-w-48">
                <p className="font-medium text-tinta">{titulo.contraparteNome}</p>
                <p className="text-sm text-tinta-suave">
                  {titulo.descricao ?? "—"}
                  {titulo.parcela !== undefined &&
                    ` · ${String(titulo.parcela.numero)}/${String(titulo.parcela.de)}`}
                </p>
              </div>

              <div className="text-right">
                <p className="font-numero text-tinta">{formatarDinheiro(titulo.saldo)}</p>
                <Situacao titulo={titulo} />
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * O estado da conta, dito com todas as letras.
 *
 * "Vence em 3 dias" e "12 dias em atraso" respondem à pergunta sem o operador
 * ter de comparar datas de cabeça. Cor sozinha não serve: cerca de 8% dos
 * homens não distinguem vermelho de verde.
 */
function Situacao({ titulo }: { readonly titulo: TituloDaLista }): ReactNode {
  if (titulo.vencido) {
    return (
      <p className="text-sm font-medium text-erro">
        {titulo.diasEmAtraso === 1
          ? "1 dia em atraso"
          : `${String(titulo.diasEmAtraso)} dias em atraso`}
      </p>
    );
  }

  const dias = diasAte(titulo.vencimento);

  return (
    <p className="text-sm text-tinta-suave">
      {dias <= 0
        ? "Vence hoje"
        : dias === 1
          ? "Vence amanhã"
          : `Vence em ${String(dias)} dias`}
      {titulo.situacao === "PARCIAL" && " · parcial"}
    </p>
  );
}

/**
 * Dias até o vencimento, contados por **dia de calendário**.
 *
 * Dividir a diferença em milissegundos por 24 horas erra: faltando 20 horas o
 * resultado arredonda para 1 e a tela diz "vence amanhã" para algo que vence
 * hoje à noite. O servidor já compara por dia — a tela precisa dizer a mesma
 * coisa, senão as duas discordam na frente do cliente.
 */
function diasAte(vencimento: string): number {
  const alvo = new Date(vencimento);
  const hoje = new Date();

  const meiaNoiteAlvo = Date.UTC(
    alvo.getUTCFullYear(),
    alvo.getUTCMonth(),
    alvo.getUTCDate(),
  );
  const meiaNoiteHoje = Date.UTC(
    hoje.getUTCFullYear(),
    hoje.getUTCMonth(),
    hoje.getUTCDate(),
  );

  return Math.round((meiaNoiteAlvo - meiaNoiteHoje) / (24 * 60 * 60 * 1000));
}

function Detalhe({
  titulo,
  podeLancar,
  aoMudar,
  aoVoltar,
}: {
  readonly titulo: TituloDetalhado;
  readonly podeLancar: boolean;
  readonly aoMudar: (titulo: TituloDetalhado) => void;
  readonly aoVoltar: () => void;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState("DINHEIRO");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);

  async function receber(evento: SyntheticEvent, tudo = false): Promise<void> {
    evento.preventDefault();
    if (enviando) return;

    const centavos = tudo ? titulo.saldo : reaisParaCentavos(valor);

    if (centavos === undefined || centavos === "0") {
      setErro("Informe o valor recebido.");
      return;
    }

    setEnviando(true);
    setErro(undefined);

    try {
      const atualizado = await api.requisitar<TituloDetalhado>(
        `/api/financeiro/titulos/${titulo.id}/recebimentos`,
        { metodo: "POST", corpo: { valor: centavos, forma } },
      );

      setValor("");
      aoMudar(atualizado);
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setEnviando(false);
    }
  }

  async function estornar(baixaId: string): Promise<void> {
    setErro(undefined);

    try {
      aoMudar(
        await api.requisitar<TituloDetalhado>(
          `/api/financeiro/titulos/${titulo.id}/recebimentos/${baixaId}/estorno`,
          { metodo: "POST", corpo: {} },
        ),
      );
    } catch (causa) {
      setErro(mensagemDe(causa));
    }
  }

  const emAberto = titulo.situacao === "ABERTO" || titulo.situacao === "PARCIAL";

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-tinta">{titulo.contraparteNome}</h1>
          <p className="text-sm text-tinta-suave">
            {titulo.descricao ?? "Sem descrição"} · vence em{" "}
            {new Date(titulo.vencimento).toLocaleDateString("pt-BR")}
          </p>
        </div>

        <Botao tom="secundario" onClick={aoVoltar}>
          Voltar
        </Botao>
      </header>

      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          ["Valor original", titulo.valorOriginal],
          ["Já recebido", titulo.totalBaixado],
          ["Saldo", titulo.saldo],
        ].map(([rotulo, centavos]) => (
          <div key={rotulo} className="rounded-md border border-borda bg-papel px-3 py-2">
            <dt className="text-sm text-tinta-suave">{rotulo}</dt>
            <dd className="font-numero text-lg text-tinta">
              {formatarDinheiro(centavos ?? "0")}
            </dd>
          </div>
        ))}
      </dl>

      {erro !== undefined && (
        <p
          role="alert"
          className="rounded-md border border-erro bg-erro-suave px-3 py-2 text-tinta"
        >
          {erro}
        </p>
      )}

      {podeLancar && emAberto && (
        <form
          onSubmit={(evento) => void receber(evento)}
          className="flex flex-col gap-4 rounded-md border border-borda bg-papel p-4"
          noValidate
        >
          <h2 className="text-base font-semibold text-tinta">Registrar recebimento</h2>

          <div className="grid gap-4 sm:grid-cols-2">
            <CampoTexto
              rotulo="Valor recebido"
              numerico
              autoFocus
              // Em branco de propósito: preenchido com o saldo, quem recebeu
              // R$ 20 de uma dívida de R$ 200 confirma sem ler e quita tudo.
              ajuda="Pode ser um pedaço da dívida."
              value={valor}
              onChange={(evento) => {
                setValor(evento.target.value);
              }}
            />

            <CampoSelecao
              rotulo="Forma"
              opcoes={FORMAS}
              valor={forma}
              aoMudar={setForma}
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Botao type="submit" ocupado={enviando} rotuloOcupado="Registrando…">
              Registrar
            </Botao>
            <Botao
              tom="secundario"
              type="button"
              onClick={(evento) => void receber(evento, true)}
            >
              Quitar {formatarDinheiro(titulo.saldo)}
            </Botao>
          </div>
        </form>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-base font-semibold text-tinta">Histórico</h2>

        {titulo.baixas.length === 0 ? (
          <p className="text-sm text-tinta-suave">Nenhum recebimento ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {titulo.baixas.map((baixa) => (
              <li
                key={baixa.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-borda bg-papel px-3 py-2"
              >
                <div>
                  <p className="text-tinta">
                    {baixa.tipo === "ESTORNO" ? "Estorno" : "Recebimento"} de{" "}
                    <span className="font-numero">{formatarDinheiro(baixa.valor)}</span>
                  </p>
                  <p className="text-sm text-tinta-suave">
                    {new Date(baixa.ocorridaEm).toLocaleString("pt-BR")}
                    {baixa.forma !== undefined && ` · ${baixa.forma}`}
                  </p>
                </div>

                {podeLancar && baixa.tipo === "PAGAMENTO" && (
                  <Botao tom="secundario" onClick={() => void estornar(baixa.id)}>
                    Estornar
                  </Botao>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function Lancamento({
  tipo,
  aoConcluir,
  aoCancelar,
}: {
  readonly tipo: Aba;
  readonly aoConcluir: () => void;
  readonly aoCancelar: () => void;
}): ReactNode {
  const { cliente: api } = useSessao();
  const [nome, setNome] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState("");
  const [parcelas, setParcelas] = useState("1");
  const [descricao, setDescricao] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);

  async function salvar(evento: SyntheticEvent): Promise<void> {
    evento.preventDefault();
    if (enviando) return;

    const centavos = reaisParaCentavos(valor);

    if (centavos === undefined || centavos === "0") {
      setErro("Informe o valor da conta.");
      return;
    }

    if (vencimento === "") {
      setErro("Informe o vencimento.");
      return;
    }

    setEnviando(true);
    setErro(undefined);

    try {
      await api.requisitar("/api/financeiro/titulos", {
        metodo: "POST",
        corpo: {
          tipo,
          contraparteNome: nome.trim(),
          valor: centavos,
          // O campo de data devolve só o dia; o meio-dia UTC evita que o fuso
          // empurre o vencimento para a véspera.
          vencimento: `${vencimento}T12:00:00.000Z`,
          ...(Number(parcelas) > 1 ? { parcelas: Number(parcelas) } : {}),
          ...(descricao.trim() === "" ? {} : { descricao: descricao.trim() }),
        },
      });

      aoConcluir();
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-tinta">
        {tipo === "PAGAR" ? "Nova conta a pagar" : "Nova conta a receber"}
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
          rotulo={tipo === "PAGAR" ? "Para quem" : "De quem"}
          required
          autoFocus
          maxLength={120}
          ajuda="Pode ser digitado: a conta de luz não precisa de cadastro."
          value={nome}
          onChange={(evento) => {
            setNome(evento.target.value);
          }}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <CampoTexto
            rotulo="Valor"
            numerico
            required
            value={valor}
            onChange={(evento) => {
              setValor(evento.target.value);
            }}
          />

          <CampoTexto
            rotulo="Vencimento"
            type="date"
            required
            value={vencimento}
            onChange={(evento) => {
              setVencimento(evento.target.value);
            }}
          />

          <CampoTexto
            rotulo="Parcelas"
            numerico
            ajuda="1 é conta única."
            value={parcelas}
            onChange={(evento) => {
              setParcelas(evento.target.value.replace(/\D/g, "").slice(0, 2));
            }}
          />
        </div>

        <CampoTexto
          rotulo="Descrição"
          maxLength={200}
          ajuda="Ajuda a reconhecer a conta meses depois."
          value={descricao}
          onChange={(evento) => {
            setDescricao(evento.target.value);
          }}
        />

        <div className="flex gap-3">
          <Botao type="submit" ocupado={enviando} rotuloOcupado="Salvando…">
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
