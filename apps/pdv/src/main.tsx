import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { ProvedorModo } from "./modo.js";
import { registrarServiceWorker } from "./sw/registrar.js";
import "./estilo.css";

const raiz = document.getElementById("raiz");

if (raiz === null) {
  throw new Error("elemento #raiz ausente no index.html");
}

createRoot(raiz).render(
  <StrictMode>
    <ProvedorModo>
      <App />
    </ProvedorModo>
  </StrictMode>,
);

// Depois de montar a tela, nunca antes: registrar o service worker disputa a
// rede com o primeiro carregamento, e o que o operador espera ver é o campo de
// código, não um ganho de cache que só vale da próxima vez.
void registrarServiceWorker();
