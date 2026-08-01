import { type Empresa, REGIMES_TRIBUTARIOS } from "@erp/domain";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import type { Container } from "../composicao/container.js";
import { exigirAutenticacao, exigirPermissao } from "../http/autenticacao.js";
import { responderErro } from "../http/erros.js";

/**
 * A empresa que opera esta instalação.
 *
 * ### Recurso no singular, e sem id
 *
 * `/api/empresa`, não `/api/empresas/:id`: existe uma só por instalação
 * (ADR-0024). A rota com id convidaria a tela a guardar o identificador e
 * mandá-lo de volta — e o dia em que ela mandasse o errado gravaria por cima do
 * cadastro sem erro nenhum.
 *
 * ### Ler exige só autenticação; gravar exige `config:empresa`
 *
 * O nome e o CNPJ saem impressos em todo cupom que o cliente leva para casa —
 * esconder do operador o que está no papel na mão dele não protege nada, e toda
 * tela de retaguarda precisa do cabeçalho. Já **alterar** o emitente é decisão
 * do dono, e fica com o gerente.
 *
 * ### `PUT`, não `POST`
 *
 * Cadastrar e corrigir são o mesmo ato: a tela é um formulário que se abre,
 * edita e salva. `PUT` também torna a operação idempotente — reenviar porque a
 * rede demorou produz o mesmo cadastro, não o segundo.
 */

const zTexto = (max: number) => z.string().trim().min(1).max(max);

const corpoEmpresa = z.object({
  razaoSocial: zTexto(60),
  nomeFantasia: zTexto(60).optional(),
  /** Ignorado quando já existe cadastro — o CNPJ do emitente não muda. */
  cnpj: zTexto(18).optional(),
  inscricaoEstadual: zTexto(20).optional(),
  inscricaoMunicipal: zTexto(20).optional(),
  regimeTributario: z.enum(REGIMES_TRIBUTARIOS),
  endereco: z.object({
    logradouro: zTexto(120),
    numero: zTexto(10),
    complemento: zTexto(60).optional(),
    bairro: zTexto(60),
    municipio: zTexto(60),
    codigoMunicipioIbge: z
      .string()
      .regex(/^\d{7}$/)
      .optional(),
    uf: z.string().length(2),
    cep: z.string().regex(/^\d{8}$/, "CEP deve ter 8 dígitos"),
  }),
  telefone: zTexto(20).optional(),
  email: zTexto(160).optional(),
});

export function rotasDeEmpresa(servidor: FastifyInstance, container: Container): void {
  const autenticado = exigirAutenticacao(container);

  /**
   * Devolve `204` quando ainda não há cadastro.
   *
   * Não é `404`: a instalação recém-instalada não tem um recurso "ausente por
   * engano" — ela tem um formulário em branco esperando ser preenchido. `404`
   * levaria a tela a mostrar "não encontrado" na primeira abertura do sistema.
   */
  servidor.get(
    "/api/empresa",
    { preHandler: [autenticado] },
    async (_requisicao, resposta) => {
      const empresa = await container.leitura.empresa.atual();

      if (empresa === undefined) return resposta.status(204).send();

      return resposta.send(apresentar(empresa));
    },
  );

  servidor.put(
    "/api/empresa",
    { preHandler: [autenticado, exigirPermissao(container, "config:empresa")] },
    async (requisicao, resposta) => {
      const entrada = corpoEmpresa.safeParse(requisicao.body);

      if (!entrada.success) {
        return recusar(resposta, "Confira a razão social, o regime e o endereço.");
      }

      const resultado = await container.definirEmpresa.executar(entrada.data);

      if (resultado.isErr()) return responderErro(resposta, resultado.error);

      return resposta.send(apresentar(resultado.unwrap()));
    },
  );
}

function apresentar(empresa: Empresa): Record<string, unknown> {
  return {
    razaoSocial: empresa.razaoSocial,
    nomeFantasia: empresa.nomeFantasia,
    exibicao: empresa.exibicao,
    cnpj: empresa.cnpj.caracteres,
    cnpjFormatado: empresa.cnpj.formatar(),
    inscricaoEstadual: empresa.inscricaoEstadual?.valor,
    inscricaoMunicipal: empresa.inscricaoMunicipal,
    regimeTributario: empresa.regimeTributario,
    endereco: {
      logradouro: empresa.endereco.logradouro,
      numero: empresa.endereco.numero,
      complemento: empresa.endereco.complemento,
      bairro: empresa.endereco.bairro,
      municipio: empresa.endereco.municipio,
      codigoMunicipioIbge: empresa.endereco.codigoMunicipioIbge,
      uf: empresa.endereco.uf,
      cep: empresa.endereco.cep,
    },
    telefone: empresa.telefone?.digitos,
    email: empresa.email?.valor,
    // Calculado no servidor, e não na tela: a regra de quem pode ser emitente é
    // fiscal, e regra fiscal em componente React é o que o CLAUDE.md §9 proíbe.
    aptaAEmitir: empresa.aptaAEmitir,
  };
}

function recusar(resposta: FastifyReply, mensagem: string) {
  return resposta.status(400).send({ erro: { codigo: "REQUISICAO_INVALIDA", mensagem } });
}
