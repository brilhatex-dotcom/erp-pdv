import { Botao, Carregando } from "@erp/ui";
import type { ReactNode } from "react";

import { useSessao } from "./sessao/ContextoSessao.js";
import { ConsultarProduto } from "./telas/ConsultarProduto.js";
import { Login } from "./telas/Login.js";

/**
 * Raiz da retaguarda.
 *
 * Enquanto restaura a sessão pelo cookie, mostra "carregando" — e **não** a
 * tela de login. Piscar o login para quem já está autenticado é o defeito
 * clássico de SPA com token em memória: assusta o usuário e o faz digitar a
 * senha sem precisar.
 */
export function App(): ReactNode {
  const { usuario, restaurando } = useSessao();

  if (restaurando) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Carregando oQue="sua sessão" />
      </main>
    );
  }

  if (usuario === undefined) return <Login />;

  return <Retaguarda />;
}

function Retaguarda(): ReactNode {
  const { usuario, sair } = useSessao();

  return (
    <div className="min-h-screen">
      <header className="border-b border-borda bg-papel">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <span className="font-semibold text-tinta">Retaguarda</span>

          <div className="flex items-center gap-3 text-sm text-tinta-suave">
            <span>
              {usuario?.nome} · {usuario?.papel}
            </span>
            <Botao tom="secundario" onClick={() => void sair()}>
              Sair
            </Botao>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">
        <ConsultarProduto />
      </main>
    </div>
  );
}
