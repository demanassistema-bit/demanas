// Processa a fila de notas: pega no banco, manda para o serviço de emissão, grava o retorno.
// Roda na Edge Function (serviço de verdade) e, no modo simulado, também no navegador.
//   pegar(limite) → documentos (o banco marca como "enviando" para ninguém pegar duas vezes)
//   registrar(id, retorno) → grava o resultado (autorizada, pendente, cancelada...)
//   provedorPara(nome) → o adaptador (simulado ou focus)
import { traduzirRejeicao } from './rejeicoes.js'

export async function processarFila({ pegar, registrar, provedorPara, limite = 10 }) {
  const documentos = await pegar(limite)
  const resumo = { total: documentos.length, autorizadas: 0, pendentes: 0, canceladas: 0, falhas: 0 }
  for (const doc of documentos) {
    let retorno
    try {
      const provedor = provedorPara(doc.provedor)
      retorno = doc.status === 'cancelando'
        ? await provedor.cancelar(doc, doc.motivo_cancelamento)
        : await provedor.emitir(doc)
    } catch (erro) {
      // sem resposta (internet, serviço fora): volta para a fila e tenta de novo depois
      retorno = { resultado: 'falha', motivo: String(erro?.message || erro) }
    }
    if (retorno.resultado === 'rejeitada' && !retorno.motivo_simples) retorno.motivo_simples = traduzirRejeicao(retorno.codigo, retorno.motivo)
    await registrar(doc.id, retorno)
    if (retorno.resultado === 'autorizada') resumo.autorizadas++
    else if (retorno.resultado === 'rejeitada') resumo.pendentes++
    else if (retorno.resultado === 'cancelada') resumo.canceladas++
    else if (retorno.resultado === 'falha') resumo.falhas++
  }
  return resumo
}
