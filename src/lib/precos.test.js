import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arredondarPara90, lucroDaVenda, percentualFixo, precoMinimo, precoPelaMargem } from './precos.js'
import { normalizar } from './limites.js'

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

test('busca sem acento nem maiúscula', () => {
  assert.equal(normalizar('Sutiã AURORA Pêssego'), 'sutia aurora pessego')
  assert.equal(normalizar(null), '')
})
