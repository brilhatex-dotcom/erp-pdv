import { mensagemDe, useSessao } from "@erp/cliente-api";
import { Botao, CampoTexto, ErroDeTela, formatarDinheiro } from "@erp/ui";
import { type ReactNode, useState } from "react";

import { identificadorDaEstacao } from "../estacao.js";

/**
 * Abertura do caixa — a primeira coisa do dia.
 *
 * Sem ela nenhuma venda começa: `IniciarVenda` exige sessão aberta, porque
 * venda sem caixa não tem onde creditar o dinheiro e só apareceria no
 * fechamento, com a gaveta não correspondendo a lançamento nenhum.
 *
 * ### Por que o fundo de troco é obrigatório
 *
 * Ele é a linha de partida da conferência. Sem informá-lo, toda a diferença do
 * dia vira ruído: a gaveta fecha com o que sobrou do fundo somado ao que
 * entrou, e ninguém consegue dizer quanto era de cada um. Pedir um número no
 * começo do dia é barato; descobrir no fim que a conta não fecha, não.
 *
 * Zero é resposta válida e comum — há loja que começa sem troco na gaveta. Por
 * isso o campo aceita zero, mas não aceita vazio: campo em branco não distingue
 * "não havia fundo" de "esqueci de contar".
 *
 * ### Em centavos, como o resto do balcão
 *
 * `10000` são cem reais. É a convenção de toda balança e maquininha, e elimina
 * a dúvida do separador decimal — que num teclado numérico de PDV nem sempre
 * está onde o operador espera.
 */
export function Abertura({ aoAbrir }: { readonly aoAbrir: () => void }): ReactNode {
  const { cliente, usuario, sair } = useSessao();

  const [fundo, setFundo] = useState("");
  const [erro, setErro] = useState<string | undefined>(undefined);
  const [ocupado, setOcupado] = useState(false);

  const centavos = fundo.replace(/\D/g, "");

  async function abrir(): Promise<void> {
    if (ocupado) return;

    // Vazio não é zero: ver a nota acima.
    if (centavos === "") {
      setErro("Informe o fundo de troco. Se a gaveta começa vazia, digite 0.");
      return;
    }

    setErro(undefined);
    setOcupado(true);

    try {
      await cliente.requisitar("/api/caixa/abrir", {
        metodo: "POST",
        corpo: { estacaoId: identificadorDaEstacao(), fundoTroco: centavos },
      });

      aoAbrir();
    } catch (causa) {
      setErro(mensagemDe(causa));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col gap-4 p-4">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-tinta">Abrir o caixa</h1>
        <div className="flex items-center gap-3 text-sm text-tinta-suave">
          <span>{usuario?.nome}</span>
          <Botao tom="discreto" onClick={() => void sair()}>
            Sair
          </Botao>
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center">
        <form
          onSubmit={(evento) => {
            evento.preventDefault();
            void abrir();
          }}
          className="flex w-full max-w-md flex-col gap-5 rounded-lg border border-borda bg-papel p-8 shadow-cartao"
          noValidate
        >
          <p className="text-tinta-suave">
            O caixa desta estação está fechado. Conte o dinheiro que já está na gaveta
            para começar o dia.
          </p>

          {erro !== undefined && <ErroDeTela mensagem={erro} />}

          <CampoTexto
            rotulo="Fundo de troco"
            numerico
            required
            autoFocus
            ajuda="Em centavos: 10000 são cem reais. Digite 0 se a gaveta está vazia."
            value={fundo}
            onChange={(evento) => {
              setFundo(evento.target.value.replace(/\D/g, "").slice(0, 9));
            }}
          />

          {/* O valor por extenso confirma a leitura antes de gravar: 1000 e
              10000 são fáceis de confundir num teclado numérico, e o erro só
              apareceria no fechamento, como uma diferença de noventa reais. */}
          {centavos !== "" && (
            <p className="text-sm text-tinta-suave">
              Abrindo com <strong>{formatarDinheiro(centavos)}</strong> na gaveta.
            </p>
          )}

          <Botao
            type="submit"
            tamanho="grande"
            ocupado={ocupado}
            rotuloOcupado="Abrindo…"
          >
            Abrir caixa
          </Botao>
        </form>
      </div>
    </main>
  );
}
