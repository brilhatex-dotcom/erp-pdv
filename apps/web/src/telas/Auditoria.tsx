import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoSelecao, CampoTexto, Carregando, ErroDeTela, Vazio } from "@erp/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Quem fez o quê: cancelamentos, descontos, itens tirados, sangrias, preços,
 * estoque e configuração.
 *
 * É a tela que o dono abre quando a gaveta não bate ou o estoque some. Por
 * isso cada linha já diz tudo — quando, o quê, quem pediu, quem liberou e o
 * detalhe escrito para ele —, sem abrir nada. Venda comum não aparece aqui: o
 * registro dela é a própria venda, e listar todas afogaria o que importa.
 *
 * O padrão é o dia de hoje: ninguém abre a auditoria querendo o ano inteiro.
 */

interface Registro {
  readonly id: string;
  readonly ocorridoEm: string;
  readonly acao: string;
  readonly descricao: string;
  readonly usuarioNome?: string;
  readonly autorizadoPorNome?: string;
}

const ACOES: readonly { readonly valor: string; readonly rotulo: string }[] = [
  { valor: "VENDA_CANCELADA", rotulo: "Venda cancelada" },
  { valor: "VENDA_DESCARTADA", rotulo: "Venda descartada" },
  { valor: "ITEM_REMOVIDO", rotulo: "Item tirado da venda" },
  { valor: "QUANTIDADE_REDUZIDA", rotulo: "Quantidade diminuída" },
  { valor: "DESCONTO_ITEM", rotulo: "Desconto no item" },
  { valor: "DESCONTO_VENDA", rotulo: "Desconto na venda" },
  { valor: "PAGAMENTO_REMOVIDO", rotulo: "Pagamento tirado" },
  { valor: "VENDA_SEM_ESTOQUE", rotulo: "Venda sem estoque" },
  { valor: "FIADO_ACIMA_DO_LIMITE", rotulo: "Fiado acima do limite" },
  { valor: "DEVOLUCAO", rotulo: "Devolução" },
  { valor: "CAIXA_ABERTO", rotulo: "Caixa aberto" },
  { valor: "CAIXA_FECHADO", rotulo: "Caixa fechado" },
  { valor: "SANGRIA", rotulo: "Sangria" },
  { valor: "SUPRIMENTO", rotulo: "Suprimento" },
  { valor: "PRECO_ALTERADO", rotulo: "Preço alterado" },
  { valor: "ESTOQUE_AJUSTADO", rotulo: "Estoque ajustado" },
  { valor: "ESTOQUE_PERDA", rotulo: "Perda de estoque" },
  { valor: "CONFIGURACAO_ALTERADA", rotulo: "Configuração alterada" },
  { valor: "BACKUP_EXECUTADO", rotulo: "Cópia de segurança feita" },
  { valor: "BACKUP_RESTAURADO", rotulo: "Cópia de segurança restaurada" },
];

type Estado =
  | { readonly fase: "CARREGANDO" }
  | { readonly fase: "PRONTO"; readonly registros: readonly Registro[] }
  | { readonly fase: "FALHOU"; readonly mensagem: string };

/** A data de hoje no relógio da loja — e não no de Greenwich. */
export function hojeNaLoja(agora = new Date()): string {
  return new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

export function Auditoria(): ReactNode {
  const { cliente: api } = useSessao();
  const [de, setDe] = useState(hojeNaLoja());
  const [ate, setAte] = useState(hojeNaLoja());
  const [acao, setAcao] = useState("");
  const [estado, setEstado] = useState<Estado>({ fase: "CARREGANDO" });
  const jaCarregou = useRef(false);

  async function consultar(): Promise<void> {
    setEstado({ fase: "CARREGANDO" });

    const parametros = new URLSearchParams({ de, ate, limite: "200" });
    if (acao !== "") parametros.set("acao", acao);

    try {
      const resposta = await api.requisitar<{ readonly registros: readonly Registro[] }>(
        `/api/auditoria?${parametros.toString()}`,
      );
      setEstado({ fase: "PRONTO", registros: resposta.registros });
    } catch (causa) {
      setEstado({ fase: "FALHOU", mensagem: mensagemDe(causa) });
    }
  }

  useEffect(() => {
    if (jaCarregou.current) return;
    jaCarregou.current = true;
    void consultar();
  });

  return (
    <section className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-tinta">Auditoria</h1>
        <p className="text-sm text-tinta-suave">
          O que mexeu em dinheiro, estoque e preço — com o nome de quem pediu e de quem
          liberou.
        </p>
      </header>

      <form
        noValidate
        className="grid items-end gap-4 sm:grid-cols-[1fr_1fr_2fr_auto]"
        onSubmit={(evento) => {
          evento.preventDefault();
          void consultar();
        }}
      >
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
        <CampoSelecao
          rotulo="O quê"
          valor={acao}
          opcoes={[{ valor: "", rotulo: "Tudo" }, ...ACOES]}
          aoMudar={setAcao}
        />
        <Botao type="submit">Consultar</Botao>
      </form>

      {estado.fase === "CARREGANDO" ? (
        <Carregando oQue="os registros" />
      ) : estado.fase === "FALHOU" ? (
        <ErroDeTela mensagem={estado.mensagem} aoTentarDeNovo={() => void consultar()} />
      ) : estado.registros.length === 0 ? (
        <Vazio
          titulo="Nada registrado nesse período."
          descricao="Escolha outras datas, ou outro tipo de registro."
        />
      ) : (
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">Registros de auditoria</caption>
          <thead>
            <tr className="border-b border-borda text-tinta-suave">
              <th scope="col" className="py-2 pr-3 font-medium">
                Quando
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                O quê
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Quem
              </th>
              <th scope="col" className="py-2 pr-3 font-medium">
                Liberado por
              </th>
              <th scope="col" className="py-2 font-medium">
                Detalhe
              </th>
            </tr>
          </thead>
          <tbody>
            {estado.registros.map((registro) => (
              <tr
                key={registro.id}
                className="border-b border-borda align-top text-tinta"
              >
                <td className="py-2 pr-3 font-numero whitespace-nowrap">
                  {new Date(registro.ocorridoEm).toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td className="py-2 pr-3">{rotuloDaAcao(registro.acao)}</td>
                <td className="py-2 pr-3">{registro.usuarioNome ?? "Sistema"}</td>
                <td className="py-2 pr-3">{registro.autorizadoPorNome ?? "—"}</td>
                <td className="py-2">{registro.descricao}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function rotuloDaAcao(acao: string): string {
  return ACOES.find((opcao) => opcao.valor === acao)?.rotulo ?? acao;
}
