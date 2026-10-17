// Adaptador da Focus NFe (https://doc.focusnfe.com.br). Pronto, mas AINDA NÃO TESTADO contra o
// serviço de verdade: só é ligado depois que as irmãs aprovarem a contratação.
// O token fica só nos segredos do Supabase (FOCUS_TOKEN), nunca no site nem no GitHub.
// O certificado A1 e o CSC ficam cadastrados na própria Focus.
import { traduzirRejeicao } from './rejeicoes.js'

const BASES = {
  homologacao: 'https://homologacao.focusnfe.com.br/v2',
  producao: 'https://api.focusnfe.com.br/v2',
}

// Forma de pagamento da NFC-e (tabela da SEFAZ). Sinal de encomenda: "outros" (a contadora confirma).
const FORMAS = { dinheiro: '01', cartao_credito: '03', cartao_debito: '04', pix: '17', sinal: '99' }

const dinheiro = (v) => Number(Number(v).toFixed(2))

export function paraFocus(doc) {
  const d = doc.documento
  return {
    cnpj_emitente: d.emitente.cnpj,
    data_emissao: new Date().toISOString(),
    natureza_operacao: 'VENDA AO CONSUMIDOR',
    presenca_comprador: '1', // presencial
    modalidade_frete: '9', // sem frete
    local_destino: '1',
    indicador_inscricao_estadual_destinatario: '9',
    ...(d.consumidor?.cpf ? { cpf_destinatario: d.consumidor.cpf } : {}),
    items: d.itens.map((i, n) => ({
      numero_item: String(n + 1),
      codigo_produto: i.codigo,
      descricao: i.descricao,
      codigo_ncm: i.ncm,
      ...(i.cest ? { cest: i.cest } : {}),
      cfop: i.cfop,
      unidade_comercial: i.unidade,
      unidade_tributavel: i.unidade,
      quantidade_comercial: i.quantidade,
      quantidade_tributavel: i.quantidade,
      valor_unitario_comercial: dinheiro(i.valor_unitario),
      valor_unitario_tributavel: dinheiro(i.valor_unitario),
      valor_bruto: dinheiro(i.valor_bruto),
      ...(Number(i.desconto) > 0 ? { valor_desconto: dinheiro(i.desconto) } : {}),
      icms_origem: i.origem,
      icms_situacao_tributaria: i.csosn,
    })),
    formas_pagamento: d.pagamentos.map((p) => ({
      forma_pagamento: FORMAS[p.forma] || '99',
      valor_pagamento: dinheiro(p.valor),
      ...(p.forma.startsWith('cartao') ? { tipo_integracao: '2' } : {}), // maquininha não integrada ao sistema
    })),
  }
}

export function criarFocus({ token, ambiente = 'homologacao', fetch: buscar = fetch }) {
  if (!token) throw new Error('Falta o token da Focus NFe nos segredos do Supabase (FOCUS_TOKEN).')
  if (ambiente !== 'homologacao') throw new Error('Produção só com ordem explícita: o sistema está travado em homologação.')
  const base = BASES[ambiente]
  const cabecalho = { Authorization: `Basic ${btoa(`${token}:`)}`, 'Content-Type': 'application/json' }

  const ler = async (resposta) => {
    let corpo = {}
    try { corpo = await resposta.json() } catch { /* corpo vazio */ }
    return { http: resposta.status, corpo }
  }
  const resultadoNota = ({ http, corpo }) => {
    if (corpo.status === 'autorizado') {
      return {
        resultado: 'autorizada', numero: Number(corpo.numero), serie: Number(corpo.serie), chave: corpo.chave_nfe,
        protocolo: corpo.protocolo || null, emitida_em: new Date().toISOString(), motivo: corpo.mensagem_sefaz,
        url_xml: corpo.caminho_xml_nota_fiscal ? `${base.replace('/v2', '')}${corpo.caminho_xml_nota_fiscal}` : null,
        url_cupom: corpo.caminho_danfe ? `${base.replace('/v2', '')}${corpo.caminho_danfe}` : null,
        qrcode_url: corpo.qrcode_url || null, bruto: corpo,
      }
    }
    if (corpo.status === 'erro_autorizacao' || corpo.status === 'denegado') {
      return { resultado: 'rejeitada', codigo: corpo.status_sefaz, motivo: corpo.mensagem_sefaz, motivo_simples: traduzirRejeicao(corpo.status_sefaz, corpo.mensagem_sefaz), bruto: corpo }
    }
    if (http === 422 || http === 400) {
      return { resultado: 'rejeitada', codigo: corpo.codigo, motivo: corpo.mensagem, motivo_simples: traduzirRejeicao(null, corpo.mensagem), bruto: corpo }
    }
    return { resultado: 'falha', motivo: corpo.mensagem || `Resposta inesperada (${http}).`, bruto: corpo }
  }

  return {
    nome: 'focus',
    async emitir(doc) {
      const r = await ler(await buscar(`${base}/nfce?ref=${encodeURIComponent(doc.referencia)}`, { method: 'POST', headers: cabecalho, body: JSON.stringify(paraFocus(doc)) }))
      // já enviada antes (ex.: queda no meio): consulta em vez de reenviar
      if (r.http === 422 && /ja_existe|já existe|duplic/i.test(JSON.stringify(r.corpo))) return this.consultar(doc)
      return resultadoNota(r)
    },
    async consultar(doc) {
      return resultadoNota(await ler(await buscar(`${base}/nfce/${encodeURIComponent(doc.referencia)}`, { headers: cabecalho })))
    },
    async cancelar(doc, justificativa) {
      const { corpo } = await ler(await buscar(`${base}/nfce/${encodeURIComponent(doc.referencia)}`, { method: 'DELETE', headers: cabecalho, body: JSON.stringify({ justificativa }) }))
      if (corpo.status === 'cancelado') return { resultado: 'cancelada', protocolo: corpo.numero_protocolo, motivo: corpo.mensagem_sefaz, bruto: corpo }
      return { resultado: 'cancelamento_rejeitado', codigo: corpo.status_sefaz, motivo: corpo.mensagem_sefaz || corpo.mensagem || 'Cancelamento recusado.', bruto: corpo }
    },
  }
}
