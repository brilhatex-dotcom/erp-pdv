import { Botao } from "@erp/ui";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  readonly children: ReactNode;
}

interface Estado {
  readonly quebrou: boolean;
}

/**
 * Último anteparo da retaguarda.
 *
 * Sem ela, **qualquer** erro de renderização desmonta a árvore inteira e deixa
 * a página em branco — sem mensagem, sem botão, sem pista. O usuário conclui
 * que o sistema sumiu e liga para o suporte, que não tem o que perguntar.
 *
 * O caso concreto que a motivou: uma resposta do servidor sem um campo que a
 * tela esperava. Acontece de verdade na janela entre atualizar o servidor e
 * atualizar a página aberta no navegador do cliente.
 *
 * ### O que ela mostra e o que ela esconde
 *
 * Mostra uma mensagem que o operador entende e um caminho de volta. **Não**
 * mostra a exceção: erro técnico na tela é veto do papel UX (CLAUDE.md §9). O
 * detalhe vai para o console, onde o suporte alcança remotamente.
 *
 * É classe porque `componentDidCatch` não tem equivalente em componente de
 * função — é a única exceção ao padrão do projeto, e o React não oferece outra.
 */
/**
 * Recarrega a página.
 *
 * Recarregar em vez de só limpar o estado: a causa mais comum é a página estar
 * numa versão diferente da do servidor, e trocar de aba não resolveria isso.
 */
/* v8 ignore start -- o jsdom entrega `location.reload` como não-configurável e
   não há como interceptá-la. Fingir cobertura com um `location` falso perderia
   o protótipo de `Location` e quebraria o resto da árvore no teste. */
function recarregar(): void {
  globalThis.location.reload();
}
/* v8 ignore stop */

export class BarreiraDeErro extends Component<Props, Estado> {
  override state: Estado = { quebrou: false };

  static getDerivedStateFromError(): Estado {
    return { quebrou: true };
  }

  override componentDidCatch(erro: Error, informacao: ErrorInfo): void {
    console.error("Falha ao desenhar a tela", erro, informacao.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.quebrou) return this.props.children;

    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-4xl" aria-hidden="true">
          ⚠️
        </p>
        <h1 className="text-xl font-semibold text-tinta">Esta tela não abriu</h1>
        <p className="max-w-md text-tinta-suave">
          Algo saiu diferente do esperado. Recarregar costuma resolver — se a versão do
          sistema mudou há pouco, é isso.
        </p>
        <Botao onClick={recarregar}>Recarregar</Botao>
      </main>
    );
  }
}
