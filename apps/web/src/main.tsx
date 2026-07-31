import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { ProvedorSessao } from "./sessao/ContextoSessao.js";
import "./estilo.css";

const raiz = document.getElementById("raiz");

if (raiz === null) {
  throw new Error("elemento #raiz não encontrado no index.html");
}

createRoot(raiz).render(
  <StrictMode>
    <ProvedorSessao>
      <App />
    </ProvedorSessao>
  </StrictMode>,
);
