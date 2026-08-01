#!/usr/bin/env node
/**
 * Impressora térmica de mentira, para desenvolver e dar suporte sem hardware.
 *
 *   node scripts/impressora-virtual.mjs [porta]
 *
 * Aponte a estação para `127.0.0.1` na porta informada (padrão 9100) e cada
 * cupom aparece aqui já decodificado, com a borda do papel desenhada.
 */
import { ImpressoraVirtual } from "../dist/ferramentas/impressoraVirtual.js";

const porta = Number(process.argv[2] ?? 9100);
const colunas = Number(process.env["COLUNAS"] ?? 48);

const impressora = new ImpressoraVirtual({
  porta,
  colunas,
  aoReceber: (cupom) => {
    console.log(`\n─── cupom em ${cupom.recebidoEm.toLocaleString("pt-BR")} ───`);
    console.log(cupom.texto);
    console.log(
      `gaveta: ${cupom.abriuGaveta ? "abriu" : "não abriu"} · papel: ${cupom.cortouPapel ? "cortado" : "não cortado"}`,
    );
  },
});

await impressora.ligar();

console.log(
  `Impressora virtual ouvindo em 0.0.0.0:${String(porta)} (${String(colunas)} colunas).`,
);
console.log(
  'Configure a estação com { "impressora": { "tipo": "REDE", "host": "127.0.0.1" } }.',
);

process.on("SIGINT", () => {
  void impressora.desligar().then(() => process.exit(0));
});
