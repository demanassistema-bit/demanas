// Serviço de emissão SIMULADO: faz o papel do serviço de verdade no ambiente de teste,
// sem contratar nada e sem falar com a SEFAZ. Nunca gera nota com valor fiscal.
// Confere o documento como a SEFAZ conferiria o básico (dados da loja, códigos, totais).
import { montarChave } from './chave.js'
import { conferirDocumento } from './documento.js'

const PRAZO_CANCELAMENTO_MIN = 30

export function criarSimulado({ agora = () => new Date() } = {}) {
  return {
    nome: 'simulado',
    async emitir(doc) {
      const problemas = conferirDocumento(doc.documento)
      if (problemas.length) {
        return { resultado: 'rejeitada', codigo: 'SIM', motivo: problemas.join(' ') }
      }
      const d = doc.documento
      const quando = agora()
      const numero = d.venda.numero // no teste, o número da nota acompanha o da venda
      const chave = montarChave({ uf: d.emitente.uf, data: quando, cnpj: d.emitente.cnpj, serie: doc.serie || 1, numero, codigo: String(numero).padStart(8, '0').slice(-8) })
      return {
        resultado: 'autorizada', numero, serie: doc.serie || 1, chave,
        protocolo: `SIM${quando.getTime()}`, emitida_em: quando.toISOString(),
        motivo: 'Autorizado o uso da NF-e (SIMULADO, sem valor fiscal)',
      }
    },
    async cancelar(doc, justificativa) {
      const minutos = (agora().getTime() - new Date(doc.emitida_em).getTime()) / 60000
      if (minutos > PRAZO_CANCELAMENTO_MIN) {
        return { resultado: 'cancelamento_rejeitado', codigo: 'SIM', motivo: `Passou o prazo de ${PRAZO_CANCELAMENTO_MIN} minutos para cancelar a NFC-e. Fale com a contadora sobre a nota de devolução.` }
      }
      if (!justificativa || justificativa.length < 15) {
        return { resultado: 'cancelamento_rejeitado', codigo: 'SIM', motivo: 'A justificativa do cancelamento precisa de pelo menos 15 letras.' }
      }
      return { resultado: 'cancelada', protocolo: `SIMC${agora().getTime()}`, motivo: 'Cancelamento homologado (SIMULADO)' }
    },
  }
}
