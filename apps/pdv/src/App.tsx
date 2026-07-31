import { useSessao } from "@erp/cliente-api";
import { Carregando } from "@erp/ui";
import type { ReactNode } from "react";

import { Login } from "./telas/Login.js";
import { Venda } from "./telas/Venda.js";

/**
 * Raiz do PDV.
 *
 * Três estados, e a ordem entre eles importa: **restaurando** vem antes de
 * tudo. Mostrar o login por um instante para quem já está autenticado assusta o
 * operador e o faz digitar o PIN sem precisar — e no balcão isso acontece a cada
 * recarregamento de tela.
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

  return usuario === undefined ? <Login /> : <Venda />;
}
