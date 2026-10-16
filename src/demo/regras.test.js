import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularSaldos, alocarPorValidade, totaisVenda, novoCustoMedio, descontoPrecisaAprovacao, taxaPagamento,
  precoPelaMargem, percentualFixo, arredondarPara90, lucroDaVenda, precoMinimo,
  recebiveisDaVenda, saldoEsperadoCaixa, resultadoDoMes,
  faltasPerfilFiscal, situacaoCertificado,
  dividirDesconto, taxasDe, emiteNota, empresaEmissora,
  situacaoEncomenda, encomendasDaVariacao,
} from './regras.js'

test('encomendas: atrasada, chega hoje, na semana, chegou', () => {
  const hoje = '2026-10-16'
  assert.deepEqual(situacaoEncomenda({ status: 'aguardando', previsao: '2026-10-14' }, hoje), { tom: 'vinho', texto: 'Atrasada há 2 dias', dias: -2 })
  assert.equal(situacaoEncomenda({ status: 'aguardando', previsao: '2026-10-16' }, hoje).texto, 'Chega hoje')
  assert.equal(situacaoEncomenda({ status: 'aguardando', previsao: '2026-10-17' }, hoje).texto, 'Chega em 1 dia')
  assert.equal(situacaoEncomenda({ status: 'aguardando', previsao: '2026-11-30' }, hoje).tom, 'neutro')
  assert.equal(situacaoEncomenda({ status: 'chegou', previsao: '2026-10-01' }, hoje).tom, 'oliva')
  assert.equal(situacaoEncomenda({ status: 'aguardando', previsao: '' }, hoje).texto, 'Sem data prevista')
})

test('encomendas: acha quem espera uma peça, só entre as aguardando', () => {
  const encomendas = [
    { id: 'a', status: 'aguardando', itens: [{ variacao_id: 'v1' }] },
    { id: 'b', status: 'entregue', itens: [{ variacao_id: 'v1' }] },
    { id: 'c', status: 'aguardando', itens: [{ descricao: 'Sutiã 48 vinho' }] },
  ]
  assert.deepEqual(encomendasDaVariacao(encomendas, 'v1').map((e) => e.id), ['a'])
})

test('dois CNPJs: desconto dividido na proporção e centavos fecham', () => {
  assert.deepEqual(dividirDesconto([{ chave: 'day', subtotal: 100 }, { chave: 'fe', subtotal: 50 }], 10), { day: 6.67, fe: 3.33 })
  assert.deepEqual(dividirDesconto([{ chave: 'day', subtotal: 80 }], 8), { day: 8 })
  assert.deepEqual(dividirDesconto([{ chave: 'day', subtotal: 30 }, { chave: 'fe', subtotal: 70 }], 0), { day: 0, fe: 0 })
})

test('dois CNPJs: taxas da maquininha de cada um e só a ME emite nota', () => {
  const config = { empresas: { day: { tipo: 'me', taxas: { debito: 1 } }, fe: { tipo: 'mei', taxas: { debito: 2 } } } }
  assert.equal(taxasDe(config, 'fe').debito, 2)
  assert.equal(emiteNota(config, 'day'), true)
  assert.equal(emiteNota(config, 'fe'), false)
  assert.equal(empresaEmissora(config), 'day')
  const vendas = [
    { total: 100, empresa_id: 'day', pagamentos: [{ forma: 'cartao_debito', valor: 100 }], itens: [] },
    { total: 100, empresa_id: 'fe', pagamentos: [{ forma: 'cartao_debito', valor: 100 }], itens: [] },
  ]
  assert.equal(resultadoDoMes({ vendas, contas: [], taxas: (v) => taxasDe(config, v.empresa_id) }).valorTaxas, 3)
})

test('fiscal: perfil só passa com formato certo e validação da contadora', () => {
  assert.deepEqual(faltasPerfilFiscal({}), ['NCM', 'Origem', 'CFOP', 'CSOSN ou CST', 'validação da contadora'])
  const completo = { ncm: '1234.56.78', origem: '0', cfop: '5102', csosn: '102', validado: true }
  assert.deepEqual(faltasPerfilFiscal(completo), [])
  assert.deepEqual(faltasPerfilFiscal({ ...completo, cest: '123' }), ['CEST'])
  assert.deepEqual(faltasPerfilFiscal({ ...completo, validado: false }), ['validação da contadora'])
})

test('fiscal: alertas do certificado em 60, 30 e 15 dias', () => {
  const hoje = '2026-10-16'
  assert.equal(situacaoCertificado('', hoje).tom, 'vinho')
  assert.equal(situacaoCertificado('2026-10-10', hoje).texto, 'Certificado vencido há 6 dias')
  assert.equal(situacaoCertificado('2026-10-26', hoje).tom, 'vinho')
  assert.equal(situacaoCertificado('2026-11-10', hoje).tom, 'ambar')
  assert.equal(situacaoCertificado('2026-12-10', hoje).tom, 'oliva')
  assert.equal(situacaoCertificado('2027-06-01', hoje).tom, null)
})

const TAXAS = { pix: 0, debito: 2, credito: 3, credito_parcelado: 5 }

test('a receber: débito no dia seguinte, crédito parcelado a cada 30 dias, centavos fecham', () => {
  const venda = { id: 'v1', numero: 7, pagamentos: [
    { forma: 'pix', valor: 10 },
    { forma: 'cartao_debito', valor: 50 },
    { forma: 'cartao_credito', valor: 100, parcelas: 3 },
  ] }
  const r = recebiveisDaVenda(venda, TAXAS, '2026-01-31')
  assert.equal(r.length, 4) // pix não vira recebível
  assert.deepEqual(r[0], { id: 'v1-1-1', venda_id: 'v1', numero: 7, forma: 'cartao_debito', parcela: 1, parcelas: 1, data: '2026-02-01', bruto: 50, taxa: 1, liquido: 49 })
  assert.deepEqual(r.slice(1).map((x) => x.data), ['2026-03-02', '2026-04-01', '2026-05-01'])
  assert.deepEqual(r.slice(1).map((x) => x.bruto), [33.33, 33.33, 33.34])
  assert.equal(r.slice(1).reduce((s, x) => s + x.bruto, 0).toFixed(2), '100.00')
  assert.equal(r[1].taxa, 1.67) // 5% do parcelado
})

test('caixa: abertura + vendas em dinheiro + suprimento − sangria', () => {
  assert.equal(saldoEsperadoCaixa({ abertura: 100, vendasDinheiro: 89.9, lancamentos: [
    { tipo: 'suprimento', valor: 50 }, { tipo: 'sangria', valor: 120.5 },
  ] }), 119.4)
})

test('resultado do mês: compra de mercadoria não conta duas vezes', () => {
  const vendas = [{ total: 200, pagamentos: [{ forma: 'cartao_credito', valor: 200, parcelas: 1 }], itens: [{ custo_unitario: 40, quantidade: 2 }] }]
  const contas = [
    { categoria: 'aluguel', valor: 50 }, { categoria: 'fornecedores', valor: 500 }, { categoria: 'aluguel', valor: 10 },
  ]
  const r = resultadoDoMes({ vendas, contas, taxas: TAXAS, imposto: 5 })
  assert.equal(r.valorTaxas, 6)
  assert.equal(r.valorImposto, 10)
  assert.equal(r.custoPecas, 80)
  assert.equal(r.lucroBruto, 104)
  assert.deepEqual(r.porCategoria, { aluguel: 60 })
  assert.equal(r.resultado, 44)
})

test('calculadora: custos fixos viram percentual do faturamento e entram no preço', () => {
  const { total, percentual } = percentualFixo([{ valor: 1200 }, { valor: 300 }, { valor: '' }], 10000)
  assert.equal(total, 1500)
  assert.equal(percentual, 15)
  assert.equal(percentualFixo([{ valor: 100 }], 0).percentual, 0)
  // custo 40, margem 20, taxa 5, imposto 6, fixo 15 → 40 ÷ 0,54
  const preco = precoPelaMargem({ custo: 40, margem: 20, taxa: 5, imposto: 6, fixo: 15 })
  assert.equal(preco, 74.07)
  const r = lucroDaVenda({ preco, custo: 40, taxa: 5, imposto: 6, fixo: 15 })
  assert.equal(r.valorFixo, 11.11)
  assert.ok(Math.abs(r.margem - 20) < 0.05)
})

test('calculadora: preço pela margem já cobre taxa e imposto', () => {
  // custo 40, margem 50%, taxa 3,49%, imposto 6% → 40 ÷ 0,4051
  const preco = precoPelaMargem({ custo: 40, margem: 50, taxa: 3.49, imposto: 6 })
  assert.equal(preco, 98.74)
  const r = lucroDaVenda({ preco, custo: 40, taxa: 3.49, imposto: 6 })
  assert.ok(Math.abs(r.margem - 50) < 0.05)
  assert.equal(precoPelaMargem({ custo: 40, margem: 95, taxa: 5 }), null) // impossível
  assert.equal(precoPelaMargem({ custo: 0, margem: 50 }), null)
})

test('calculadora: final ,90 e preço mínimo', () => {
  assert.equal(arredondarPara90(87.3), 87.9)
  assert.equal(arredondarPara90(87.9), 87.9)
  assert.equal(arredondarPara90(87.95), 88.9)
  assert.equal(arredondarPara90(12), 12.9)
  const minimo = precoMinimo({ custo: 40, taxa: 4.99 })
  assert.ok(Math.abs(lucroDaVenda({ preco: minimo, custo: 40, taxa: 4.99 }).lucro) <= 0.01)
})

test('calculadora: lucro de verdade no Pix e no crédito', () => {
  assert.deepEqual(lucroDaVenda({ preco: 100, custo: 40, taxa: 0 }), { valorTaxa: 0, valorImposto: 0, valorFixo: 0, recebe: 100, lucro: 60, margem: 60 })
  assert.deepEqual(lucroDaVenda({ preco: 100, custo: 40, taxa: 3.49 }), { valorTaxa: 3.49, valorImposto: 0, valorFixo: 0, recebe: 96.51, lucro: 56.51, margem: 56.51 })
})

test('saldo é a soma das movimentações, por variação e por lote', () => {
  const { porVariacao, porLote } = calcularSaldos([
    { variacao_id: 'a', lote_id: 'l1', quantidade: 10 },
    { variacao_id: 'a', lote_id: 'l1', quantidade: -3 },
    { variacao_id: 'a', lote_id: 'l2', quantidade: 5 },
    { variacao_id: 'b', lote_id: null, quantidade: 2 },
  ])
  assert.equal(porVariacao.get('a'), 12)
  assert.equal(porVariacao.get('b'), 2)
  assert.equal(porLote.get('l1'), 7)
  assert.equal(porLote.get('l2'), 5)
})

test('saída pela validade mais próxima, atravessando lotes', () => {
  const lotes = [
    { id: 'novo', validade: '2027-06-01' },
    { id: 'velho', validade: '2026-11-01' },
    { id: 'vazio', validade: '2026-10-20' },
  ]
  const porLote = new Map([['novo', 10], ['velho', 2], ['vazio', 0]])
  const { partes, falta } = alocarPorValidade(lotes, porLote, 5)
  assert.deepEqual(partes, [{ lote_id: 'velho', quantidade: 2 }, { lote_id: 'novo', quantidade: 3 }])
  assert.equal(falta, 0)
  assert.equal(alocarPorValidade(lotes, porLote, 20).falta, 8)
})

test('totais da venda em centavos exatos e desconto nunca maior que o subtotal', () => {
  const itens = [{ preco: 0.1, quantidade: 3 }, { preco: 89.9, quantidade: 1 }]
  assert.deepEqual(totaisVenda(itens, 10), { subtotal: 90.2, desconto: 10, total: 80.2 })
  assert.equal(totaisVenda(itens, 500).total, 0)
  assert.equal(totaisVenda(itens, -5).desconto, 0)
})

test('custo médio ponderado', () => {
  assert.equal(novoCustoMedio(10, 20, 10, 30), 25)
  assert.equal(novoCustoMedio(0, 20, 5, 30), 30)
  assert.equal(novoCustoMedio(-2, 20, 5, 30), 30) // saldo negativo não puxa a média
})

test('desconto acima do limite pede aprovação só para a vendedora', () => {
  assert.equal(descontoPrecisaAprovacao(100, 10, 10, false), false)
  assert.equal(descontoPrecisaAprovacao(100, 10.01, 10, false), true)
  assert.equal(descontoPrecisaAprovacao(100, 50, 10, true), false)
})

test('taxa da maquininha por forma e parcelas', () => {
  const taxas = { pix: 0, debito: 2, credito: 3, credito_parcelado: 5 }
  assert.equal(taxaPagamento({ forma: 'cartao_credito', parcelas: 1, valor: 100 }, taxas), 3)
  assert.equal(taxaPagamento({ forma: 'cartao_credito', parcelas: 3, valor: 100 }, taxas), 5)
  assert.equal(taxaPagamento({ forma: 'dinheiro', valor: 100 }, taxas), 0)
})
