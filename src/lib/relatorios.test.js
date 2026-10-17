import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analisarEstoque, curvaABC, margem, textoCSV, valorEstoque } from './relatorios.js'

test('curva ABC: as que fazem os primeiros 80% são A, até 95% B, o resto C', () => {
  const c = curvaABC([
    { variacao_id: 'a', valor: 500 }, { variacao_id: 'b', valor: 300 },
    { variacao_id: 'c', valor: 150 }, { variacao_id: 'd', valor: 50 },
  ])
  assert.deepEqual([...c.entries()], [['a', 'A'], ['b', 'A'], ['c', 'B'], ['d', 'C']])
})

const agora = new Date('2026-10-17T12:00:00-03:00').getTime()
const diasAtras = (n) => new Date(agora - n * 86400000).toISOString()
const peca = (id, saldo, extra = {}) => ({ id, saldo, ativo: true, criado_em: diasAtras(200), produto: { tipo: 'lingerie' }, ...extra })

test('recomprar: vende 1 por dia e tem 10 → dura 10 dias, pedir 20 para cobrir 30', () => {
  const [l] = analisarEstoque({ linhas: [peca('a', 10)], giro: [{ variacao_id: 'a', saiu: 30, ultima_venda: diasAtras(1) }], agora })
  assert.equal(l.cobertura, 10)
  assert.equal(l.recomprar, true)
  assert.equal(l.pedir, 20)
})

test('recomprar: estoque que dura 15 dias ou mais não entra; zerado ou negativo pede o mês todo', () => {
  const r = analisarEstoque({
    linhas: [peca('ok', 15), peca('zero', 0), peca('neg', -2), peca('fora', 0, { ativo: false })],
    giro: ['ok', 'zero', 'neg', 'fora'].map((id) => ({ variacao_id: id, saiu: 30, ultima_venda: diasAtras(1) })),
    agora,
  })
  assert.deepEqual(r.map((l) => [l.id, l.recomprar, l.pedir]), [['ok', false, 0], ['zero', true, 30], ['neg', true, 30], ['fora', false, 0]])
})

test('paradas: com estoque e sem vender há 45 dias; peça nova conta do cadastro; kit fica de fora', () => {
  const r = analisarEstoque({
    linhas: [peca('velha', 3), peca('nova', 3, { criado_em: diasAtras(10) }), peca('vendeu', 3), peca('sem', 0), peca('kit', 5, { produto: { tipo: 'kit' } })],
    giro: [{ variacao_id: 'velha', saiu: 0, ultima_venda: diasAtras(60) }, { variacao_id: 'vendeu', saiu: 1, ultima_venda: diasAtras(5) }],
    agora,
  })
  assert.deepEqual(r.map((l) => [l.id, l.parada]), [['velha', true], ['nova', false], ['vendeu', false], ['sem', false]])
  assert.equal(r.find((l) => l.id === 'nova').nuncaVendeu, true)
})

test('valor do estoque, margem e planilha', () => {
  assert.equal(valorEstoque([{ saldo: 3, custo: 10.5 }, { saldo: -1, custo: 99 }, { saldo: 2, custo: undefined }]), 31.5)
  assert.equal(valorEstoque([{ saldo: 3, custo: 10, produto: { tipo: 'lingerie' } }, { saldo: 2, custo: 30, produto: { tipo: 'kit' } }]), 30) // kit não conta duas vezes
  assert.equal(margem({ valor: 100, custo: 40 }), 60)
  assert.equal(margem({ valor: 100, custo: null }), null)
  assert.equal(textoCSV([['Peça', 'Valor'], ['Sutiã "Aurora"', 49.9]]), '"Peça";"Valor"\n"Sutiã ""Aurora""";"49,9"')
})
