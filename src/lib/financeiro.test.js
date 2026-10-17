import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agruparPorDia, filtrarContas, fluxoSemanas, situacaoConta } from './financeiro.js'

const hoje = '2026-10-17'

test('situação da conta: paga, vencida, hoje, nos próximos 7 dias', () => {
  assert.equal(situacaoConta({ vencimento: '2026-10-10', pago_em: '2026-10-11' }, hoje).texto, 'Paga em 11/10')
  assert.equal(situacaoConta({ vencimento: '2026-10-15' }, hoje).texto, 'Vencida há 2 d')
  assert.equal(situacaoConta({ vencimento: hoje }, hoje).texto, 'Vence hoje')
  assert.equal(situacaoConta({ vencimento: '2026-10-20' }, hoje).tom, 'ambar')
  assert.equal(situacaoConta({ vencimento: '2026-11-30' }, hoje).texto, '30/11')
})

test('filtros de contas', () => {
  const contas = [
    { id: 1, vencimento: '2026-10-01' },
    { id: 2, vencimento: '2026-11-20' },
    { id: 3, vencimento: '2027-03-01' },
    { id: 4, vencimento: '2026-10-05', pago_em: '2026-10-05' },
  ]
  assert.deepEqual(filtrarContas(contas, 'abertas', hoje).map((c) => c.id), [1, 2])
  assert.deepEqual(filtrarContas(contas, 'vencidas', hoje).map((c) => c.id), [1])
  assert.deepEqual(filtrarContas(contas, 'pagas', hoje).map((c) => c.id), [4])
})

test('a receber agrupado por dia e CNPJ, com estorno descontando', () => {
  const g = agruparPorDia([
    { data_prevista: '2026-10-18', empresa_id: 'day', bruto: 100, taxa: 2, liquido: 98 },
    { data_prevista: '2026-10-18', empresa_id: 'day', bruto: -50, taxa: 0, liquido: -50 },
    { data_prevista: '2026-10-18', empresa_id: 'fe', bruto: 10, taxa: 0.3, liquido: 9.7 },
    { data_prevista: '2026-10-17', empresa_id: 'day', bruto: 33.33, taxa: 1.67, liquido: 31.66 },
  ])
  assert.deepEqual(g.map((x) => [x.data, x.empresa_id, x.liquido]), [['2026-10-17', 'day', 31.66], ['2026-10-18', 'day', 48], ['2026-10-18', 'fe', 9.7]])
})

test('fluxo de 4 semanas: atrasados entram na primeira, já recebido não conta', () => {
  const semanas = fluxoSemanas({
    hoje,
    recebiveis: [
      { data_prevista: '2026-10-15', liquido: 50, status: 'a_receber' }, // atrasado
      { data_prevista: '2026-10-20', liquido: 100, status: 'a_receber' },
      { data_prevista: '2026-10-21', liquido: 999, status: 'recebido' },
      { data_prevista: '2026-10-27', liquido: 70, status: 'a_receber' },
    ],
    contas: [
      { vencimento: '2026-10-10', valor: 30 }, // vencida
      { vencimento: '2026-10-25', valor: 200 },
      { vencimento: '2026-10-26', valor: 500, pago_em: '2026-10-17' },
    ],
  })
  assert.deepEqual(semanas.map((w) => [w.fim, w.entradas, w.saidas, w.saldo]), [
    ['2026-10-23', 150, 30, 120],
    ['2026-10-30', 70, 200, -130],
    ['2026-11-06', 0, 0, 0],
    ['2026-11-13', 0, 0, 0],
  ])
})
