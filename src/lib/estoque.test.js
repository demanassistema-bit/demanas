import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noEscopo, ordenarPorValidade, planoInventario, saldoDoKit } from './estoque.js'

test('kit: quantos dá para montar com as peças', () => {
  const saldos = new Map([['a', 7], ['b', 3], ['c', -2]])
  assert.equal(saldoDoKit([{ componente_variacao_id: 'a', quantidade: 2 }], saldos), 3) // pague 1 leve 2
  assert.equal(saldoDoKit([{ componente_variacao_id: 'a', quantidade: 1 }, { componente_variacao_id: 'b', quantidade: 1 }], saldos), 3)
  assert.equal(saldoDoKit([{ componente_variacao_id: 'c', quantidade: 1 }], saldos), 0) // saldo negativo não monta kit
  assert.equal(saldoDoKit([], saldos), 0) // kit sem peças definidas
})

test('saída pela validade mais próxima, sem validade e sem lote por último', () => {
  const ordem = ordenarPorValidade([
    { lote_id: null, validade: null },
    { lote_id: 'L3', validade: null },
    { lote_id: 'L1', validade: '2027-12-01' },
    { lote_id: 'L2', validade: '2027-01-15' },
  ]).map((b) => b.lote_id)
  assert.deepEqual(ordem, ['L2', 'L1', 'L3', null])
})

test('inventário: diferença do momento da contagem e lote esquecido vai a zero', () => {
  const plano = planoInventario({
    itens: [
      { variacao_id: 'preta', lote_id: null, contado: 14, saldo_sistema: 12 }, // sobrou 2
      { variacao_id: 'creme', lote_id: 'L1', contado: 7, saldo_sistema: 8 },  // faltou 1
    ],
    baldes: [
      { variacao_id: 'preta', lote_id: null, saldo: 10 }, // vendeu 2 durante a contagem: não muda o acerto
      { variacao_id: 'creme', lote_id: 'L1', saldo: 8 },
      { variacao_id: 'creme', lote_id: 'L2', saldo: 3 },  // não contado → falta 3
      { variacao_id: 'nude', lote_id: null, saldo: 4 },   // peça não contada
    ],
    escopo: [{ id: 'preta' }, { id: 'creme' }, { id: 'nude' }],
  })
  assert.equal(plano.sobras, 2)
  assert.equal(plano.faltas, 4)
  assert.equal(plano.pecasContadas, 21)
  assert.deepEqual(plano.naoContadas.map((n) => n.variacao_id), ['nude'])
})

test('inventário: zerar as não contadas, menos a cadastrada durante a contagem', () => {
  const base = {
    itens: [],
    baldes: [{ variacao_id: 'velha', lote_id: null, saldo: 5 }, { variacao_id: 'nova', lote_id: null, saldo: 3 }],
    escopo: [{ id: 'velha', criado_em: '2026-10-01T10:00:00Z' }, { id: 'nova', criado_em: '2026-10-17T15:00:00Z' }],
    abertoEm: '2026-10-17T12:00:00Z',
  }
  assert.equal(planoInventario(base).faltas, 0)
  const zerando = planoInventario({ ...base, zerar: true })
  assert.equal(zerando.faltas, 5)
  assert.deepEqual(zerando.acertos.map((a) => a.variacao_id), ['velha'])
})

test('escopo da contagem: kit nunca entra', () => {
  const linha = (tipo, categoria_id, empresa_id) => ({ produto: { tipo, categoria_id, empresa_id } })
  assert.equal(noEscopo(linha('kit', 'c1', 'day'), { escopo: 'tudo' }), false)
  assert.equal(noEscopo(linha('lingerie', 'c1', 'day'), { escopo: 'categoria', categoria_id: 'c1' }), true)
  assert.equal(noEscopo(linha('lingerie', 'c2', 'day'), { escopo: 'categoria', categoria_id: 'c1' }), false)
  assert.equal(noEscopo(linha('cosmetico', 'c1', 'fe'), { escopo: 'cnpj', empresa_id: 'day' }), false)
})
