import { mensagemDe, useSessao } from "@erp/cliente-api";
import {
  Botao,
  CampoTexto,
  Carregando,
  ErroDeTela,
  formatarDinheiro,
  Vazio,
} from "@erp/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Conferência dos caixas — o que o gerente olha no fim do dia.
 *
 * ### A divergência é a coluna que importa
 *
 * As outras existem para explicá-la. Por isso a lista é ordenada pelo servidor
 * em ordem cronológica inversa, mas quem tem diferença é destacado: numa loja
 * com quatro estações, o gerente precisa achar a linha problemática de relance,
 * não ler oito números por linha.
 *
 * ### Caixa aberto aparece sem diferença
 *
 * Ele ainda não foi conferido. Uma coluna vazia diz isso melhor que um zero, que
 * seria lido como "bateu certinho".
 *
 * ### O padrão é hoje
 *
 * Ninguém abre esta tela querendo o histórico inteiro; abre querendo saber como
 * foi o dia. Um período aberto por padrão traria centenas de sessões numa loja
 * com dois anos de operação.
 */

interface SessaoDeCaixa {
  readonly id: string;
  readonly estacaoId: string;
  readonly operadorNome: string;
  readonly status: "ABERTA" | "FECHADA";
  readonly abertaEm: string;
  readonly fechadaEm?: string;
  readonly fundoTroco: string;
  readonly recebidoEmDinheiro: string;
  readonly trocoDevolvido: string;
  readonly suprimentos: string;
  readonly sangrias: string;
  readonly esperadoEmDinheiro: string;
  readonly contadoEmDinheiro?: string;
  readonly divergenciaEmDinheiro?: string;
  readonly totalVendido: string;
  readonly quantidadeVendas: number;
}

type Estado =
  | { readonly fase: "CARREGANDO" }
  | { readonly fase: "PRONTO"; readonly sessoes: readonly SessaoDeCaixa[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

function hojeEmTexto(): string {
  return new Date().toISOString().slice(0, 10);
}

export function Caixas(): ReactNode {
  const { cliente: api } = useSessao();
  const [estado, setEstado] = useState<Estado>({ fase: "CARREGANDO" });
  const [de, setDe] = useState(hojeEmTexto);
  const [ate, setAte] = useState(hojeEmTexto);
  const jaCarregou = useRef(false);

  async function carregar(inicio: string, fim: string): Promise<void> {
    setEstado({ fase: "CARREGANDO" });

    try {
      const resposta = await api.requisitar<{ sessoes: SessaoDeCaixa[] }>(
        `/api/caixa/sessoes?de=${inicio}&ate=${fim}`,
      );
      setEstado({ fase: "PRONTO", sessoes: resposta.sessoes });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaCarregou.current) return;
    jaCarregou.current = true;
    void carregar(de, ate);
  });

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <CampoTexto
          rotulo="De"
          type="date"
          value={de}
          onChange={(evento) => {
            setDe(evento.target.value);
          }}
        />
        <CampoTexto
          rotulo="Até"
          type="date"
          value={ate}
          onChange={(evento) => {
            setAte(evento.target.value);
          }}
        />
        <Botao onClick={() => void carregar(de, ate)}>Buscar</Botao>
      </header>

      {estado.fase === "CARREGANDO" && <Carregando oQue="os caixas do período" />}
      {estado.fase === "FALHOU" && <ErroDeTela mensagem={estado.mensagem} />}

      {estado.fase === "PRONTO" &&
        (estado.sessoes.length === 0 ? (
          <Vazio
            titulo="Nenhum caixa no período"
            descricao="Ajuste as datas ou confira se o caixa chegou a ser aberto."
          />
        ) : (
          <ul className="flex flex-col gap-3" aria-label="Sessões de caixa">
            {estado.sessoes.map((sessao) => (
              <Sessao key={sessao.id} sessao={sessao} />
            ))}
          </ul>
        ))}
    </section>
  );
}

function Sessao({ sessao }: { readonly sessao: SessaoDeCaixa }): ReactNode {
  const divergencia =
    sessao.divergenciaEmDinheiro === undefined
      ? undefined
      : BigInt(sessao.divergenciaEmDinheiro);

  const problema = divergencia !== undefined && divergencia !== 0n;

  return (
    <li
      className={`rounded-lg border p-4 ${
        problema ? "border-atencao bg-atencao-suave" : "border-borda bg-papel"
      }`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-tinta">{sessao.operadorNome}</strong>
        <span className="text-sm text-tinta-suave">
          {formatarInstante(sessao.abertaEm)}
          {sessao.fechadaEm === undefined
            ? " · em aberto"
            : ` → ${formatarInstante(sessao.fechadaEm)}`}
        </span>
      </div>

      <p className="mt-1 text-sm text-tinta-suave">
        {sessao.quantidadeVendas === 1
          ? "1 venda"
          : `${String(sessao.quantidadeVendas)} vendas`}{" "}
        · {formatarDinheiro(sessao.totalVendido)}
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <Dado rotulo="Fundo" valor={sessao.fundoTroco} />
        <Dado rotulo="Recebido em dinheiro" valor={sessao.recebidoEmDinheiro} />
        <Dado rotulo="Troco" valor={sessao.trocoDevolvido} />
        <Dado rotulo="Suprimentos" valor={sessao.suprimentos} />
        <Dado rotulo="Sangrias" valor={sessao.sangrias} />
        <Dado rotulo="Esperado" valor={sessao.esperadoEmDinheiro} />
      </dl>

      <p className="mt-3 text-sm">
        {divergencia === undefined ? (
          <span className="text-tinta-suave">Ainda não conferido</span>
        ) : (
          <>
            <span className="text-tinta-suave">
              Contado {formatarDinheiro(sessao.contadoEmDinheiro ?? "0")} ·{" "}
            </span>
            <strong className="font-numero text-tinta">
              {rotuloDaDiferenca(divergencia)}
            </strong>
          </>
        )}
      </p>
    </li>
  );
}

function Dado(props: { readonly rotulo: string; readonly valor: string }): ReactNode {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-tinta-suave">{props.rotulo}</dt>
      <dd className="font-numero text-tinta">{formatarDinheiro(props.valor)}</dd>
    </div>
  );
}

function rotuloDaDiferenca(divergencia: bigint): string {
  if (divergencia === 0n) return "Bateu";

  const absoluto = (divergencia < 0n ? -divergencia : divergencia).toString();

  return `${divergencia > 0n ? "Sobra" : "Falta"} de ${formatarDinheiro(absoluto)}`;
}

/** Data e hora locais, sem segundos: ninguém confere caixa por segundo. */
function formatarInstante(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
