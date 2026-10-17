import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chaveValida, digitoChave, montarChave } from '../../supabase/functions/_shared/fiscal/chave.js'
import { conferirDocumento, cpfValido } from '../../supabase/functions/_shared/fiscal/documento.js'
import { traduzirRejeicao } from '../../supabase/functions/_shared/fiscal/rejeicoes.js'
import { criarSimulado } from '../../supabase/functions/_shared/fiscal/simulado.js'
import { paraFocus } from '../../supabase/functions/_shared/fiscal/focus.js'
import { processarFila } from '../../supabase/functions/_shared/fiscal/processar.js'
import { faltasPerfilFiscal, situacaoCertificado } from './fiscal.js'

test('chave de acesso: dígito verificador do exemplo do manual da NF-e', () => {
  assert.equal(digitoChave('5206043300991100250655012000000780026730161'), 5)
  assert.equal(chaveValida('52060433009911002506550120000007800267301615'), true)
  assert.equal(chaveValida('52060433009911002506550120000007800267301614'), false)
  const chave = montarChave({ uf: 'SP', data: new Date(2026, 9, 17), cnpj: '11.222.333/0001-81', serie: 1, numero: 42, codigo: 42 })
  assert.equal(chave.length, 44)
  assert.equal(chave.slice(0, 6), '352610')
  assert.equal(chaveValida(chave), true)
})

test('CPF com dígitos verificadores', () => {
  assert.equal(cpfValido('529.982.247-25'), true)
  assert.equal(cpfValido('52998224724'), false)
  assert.equal(cpfValido('111.111.111-11'), false)
})

const docOk = () => ({
  id: 'd1', referencia: 'demanas-1', serie: 1, provedor: 'simulado', status: 'enviando',
  documento: {
    venda: { numero: 7, total: 90 },
    emitente: { cnpj: '11222333000181', uf: 'SP' },
    consumidor: null,
    itens: [
      { codigo: 'A1', descricao: 'Calcinha', quantidade: 2, valor_unitario: 40, valor_bruto: 80, desconto: 5, ncm: '62121000', cest: '', origem: '0', cfop: '5102', csosn: '102', unidade: 'UN' },
      { codigo: 'B2', descricao: 'Creme', quantidade: 1, valor_unitario: 15, valor_bruto: 15, desconto: 0, ncm: '33049910', cest: '', origem: '0', cfop: '5102', csosn: '102', unidade: 'UN' },
    ],
    pagamentos: [{ forma: 'pix', valor: 50 }, { forma: 'cartao_credito', valor: 40 }],
    faltas: [],
  },
})

test('conferência do documento: totais, dados da loja e o que faltou no cadastro', () => {
  assert.deepEqual(conferirDocumento(docOk().documento), [])
  const d = docOk().documento
  d.pagamentos[0].valor = 49.99
  d.emitente.uf = ''
  d.faltas = ['A categoria Calcinhas está sem NCM.']
  assert.deepEqual(conferirDocumento(d), [
    'A categoria Calcinhas está sem NCM.',
    'Falta o estado (UF) do emitente em Dados fiscais.',
    'A soma dos pagamentos não fecha com o total da venda.',
  ])
})

test('Focus: campos da NFC-e e formas de pagamento da SEFAZ', () => {
  const corpo = paraFocus(docOk())
  assert.equal(corpo.cnpj_emitente, '11222333000181')
  assert.equal(corpo.items[0].codigo_ncm, '62121000')
  assert.equal(corpo.items[0].valor_desconto, 5)
  assert.equal(corpo.items[1].valor_desconto, undefined)
  assert.deepEqual(corpo.formas_pagamento, [{ forma_pagamento: '17', valor_pagamento: 50 }, { forma_pagamento: '03', valor_pagamento: 40, tipo_integracao: '2' }])
  assert.equal(corpo.cpf_destinatario, undefined)
})

test('simulado: autoriza com chave válida; cancela só em até 30 minutos', async () => {
  let agora = new Date(2026, 9, 17, 10, 0)
  const sim = criarSimulado({ agora: () => agora })
  const r = await sim.emitir(docOk())
  assert.equal(r.resultado, 'autorizada')
  assert.equal(chaveValida(r.chave), true)
  agora = new Date(2026, 9, 17, 10, 20)
  assert.equal((await sim.cancelar({ emitida_em: r.emitida_em }, 'Cliente desistiu da compra')).resultado, 'cancelada')
  agora = new Date(2026, 9, 17, 10, 31)
  assert.equal((await sim.cancelar({ emitida_em: r.emitida_em }, 'Cliente desistiu da compra')).resultado, 'cancelamento_rejeitado')
  const ruim = docOk()
  ruim.documento.faltas = ['Falta NCM.']
  assert.equal((await sim.emitir(ruim)).resultado, 'rejeitada')
})

test('fila: autoriza, rejeita com motivo simples, e falha de conexão volta para a fila', async () => {
  const gravados = []
  const provedores = {
    simulado: criarSimulado(),
    quebrado: { emitir: async () => { throw new Error('Failed to fetch') } },
    recusa: { emitir: async () => ({ resultado: 'rejeitada', codigo: '778', motivo: 'NCM inexistente' }) },
  }
  const resumo = await processarFila({
    pegar: async () => [docOk(), { ...docOk(), id: 'd2', provedor: 'quebrado' }, { ...docOk(), id: 'd3', provedor: 'recusa' }],
    registrar: async (id, r) => gravados.push([id, r.resultado, r.motivo_simples]),
    provedorPara: (nome) => provedores[nome],
  })
  assert.deepEqual(resumo, { total: 3, autorizadas: 1, pendentes: 1, canceladas: 0, falhas: 1 })
  assert.equal(gravados[1][1], 'falha')
  assert.match(gravados[2][2], /NCM/)
})

test('rejeição sem tradução mostra o texto original para a contadora', () => {
  assert.match(traduzirRejeicao('612', 'Rejeição qualquer'), /Rejeição qualquer.*contadora/)
})

test('perfil fiscal só passa com formato certo e validação da contadora (formato da tela ou do banco)', () => {
  assert.deepEqual(faltasPerfilFiscal({}), ['NCM', 'Origem', 'CFOP', 'CSOSN ou CST', 'validação da contadora'])
  const completo = { ncm: '1234.56.78', origem: '0', cfop: '5102', csosn: '102', validado: true }
  assert.deepEqual(faltasPerfilFiscal(completo), [])
  assert.deepEqual(faltasPerfilFiscal({ ...completo, cest: '123' }), ['CEST'])
  assert.deepEqual(faltasPerfilFiscal({ ...completo, validado: false }), ['validação da contadora'])
  assert.deepEqual(faltasPerfilFiscal({ ncm: '62121000', origem: '0', cfop: '5102', csosn_ou_cst: '102', validado: true }), [])
})

test('alertas do certificado em 60, 30 e 15 dias', () => {
  const hoje = '2026-10-16'
  assert.equal(situacaoCertificado('', hoje).tom, 'vinho')
  assert.equal(situacaoCertificado('2026-10-10', hoje).texto, 'Certificado vencido há 6 dias')
  assert.equal(situacaoCertificado('2026-10-26', hoje).tom, 'vinho')
  assert.equal(situacaoCertificado('2026-11-10', hoje).tom, 'ambar')
  assert.equal(situacaoCertificado('2026-12-10', hoje).tom, 'oliva')
  assert.equal(situacaoCertificado('2027-06-01', hoje).tom, null)
})
