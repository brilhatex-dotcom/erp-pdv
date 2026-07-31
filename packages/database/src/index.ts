// ── Cliente ─────────────────────────────────────────────────────────────
export { criarPrismaClient, type OpcoesPrisma } from "./cliente.js";
export { PrismaClient } from "../gerado/index.js";

// ── Unidade de trabalho ─────────────────────────────────────────────────
export {
  montarRepositorios,
  type OpcoesUnitOfWork,
  UnitOfWorkPrisma,
} from "./UnitOfWorkPrisma.js";

// ── Repositórios ────────────────────────────────────────────────────────
export { CaixaRepositorioPrisma } from "./repositorios/CaixaRepositorioPrisma.js";
export { EstoqueRepositorioPrisma } from "./repositorios/EstoqueRepositorioPrisma.js";
export { OutboxRepositorioPrisma } from "./repositorios/OutboxRepositorioPrisma.js";
export { ProdutoRepositorioPrisma } from "./repositorios/ProdutoRepositorioPrisma.js";
export { VendaRepositorioPrisma } from "./repositorios/VendaRepositorioPrisma.js";
