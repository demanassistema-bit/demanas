import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularSaldos, alocarPorValidade, totaisVenda, novoCustoMedio, descontoPrecisaAprovacao, taxaPagamento,
  precoPelaMargem, percentualFixo, arredondarPara90, lucroDaVenda, precoMinimo,
} from './regras.js'

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
