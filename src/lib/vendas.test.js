import { test } from 'node:test'
import assert from 'node:assert/strict'
import { falta, partesDaVenda, passaDoLimite, ratear, taxaEstimada, tipoTaxa, valorDevolucao } from './vendas.js'

test('venda com peças dos dois CNPJs vira duas partes, desconto rateado sem perder centavo', () => {
  const partes = partesDaVenda([
    { variacao_id: 'a', quantidade: 1, preco: 89.9, empresa_id: 'day' },
    { variacao_id: 'b', quantidade: 2, preco: 39.9, empresa_id: 'fe' },
    { variacao_id: 'c', quantidade: 1, preco: 10, empresa_id: 'day' },
  ], 10)
  assert.deepEqual(partes.map((p) => p.empresa_id), ['day', 'fe'])
  assert.equal(partes[0].subtotal, 99.9)
  assert.equal(partes[1].subtotal, 79.8)
  assert.equal(partes[0].desconto + partes[1].desconto, 10)
  assert.equal(partes[0].total + partes[1].total, 169.7)
})

test('rateio: a última parte fica com o centavo que sobra', () => {
  assert.deepEqual(ratear([{ subtotal: 1 }, { subtotal: 1 }, { subtotal: 1 }], 0.1), [0.03, 0.03, 0.04])
})

test('taxa da maquininha por forma e parcelas', () => {
  const taxas = { pix: 0, debito: 2, credito: 3, credito_parcelado: 5 }
  assert.equal(tipoTaxa('cartao_credito', 3), 'credito_parcelado')
  assert.equal(tipoTaxa('dinheiro'), null)
  assert.equal(taxaEstimada([{ forma: 'cartao_credito', valor: 100, parcelas: 1 }, { forma: 'cartao_debito', valor: 50 }], taxas), 4)
  assert.equal(taxaEstimada([{ forma: 'dinheiro', valor: 100 }], taxas), 0)
})

test('limite de desconto da vendedora', () => {
  assert.equal(passaDoLimite(100, 10, 10), false) // exatamente no limite: pode
  assert.equal(passaDoLimite(100, 10.01, 10), true)
  assert.equal(passaDoLimite(100, 0, 0), false)
})

test('devolução proporcional, com o desconto do item', () => {
  // 3 peças de 40 com 12 de desconto no item: cada uma saiu por 36
  assert.equal(valorDevolucao({ preco_unitario: 40, quantidade: 3, desconto: 12 }, 1), 36)
  assert.equal(valorDevolucao({ preco_unitario: 33.33, quantidade: 3, desconto: 0 }, 3), 99.99)
})

test('pagamentos fecham com o total em centavos exatos', () => {
  assert.equal(falta(100, [{ valor: 33.33 }, { valor: 66.67 }]), 0)
  assert.equal(falta(100, [{ valor: 60 }]), 40)
})
