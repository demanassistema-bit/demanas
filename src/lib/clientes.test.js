import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paraISO, somarDias } from './datas.js'
import { filtrarEncomendas, juntarItem, montarCliente, segmentar, sinalPorParte, situacaoEncomenda } from './clientes.js'

const diasAtras = (n) => somarDias(new Date(), -n).toISOString()

test('segmentos: aniversariantes na ordem do dia, sumidas há mais de 60 dias, 5 melhores', () => {
  const clientes = [
    { nome: 'Ana', nascimento: '1990-10-25', total: 500, ultima_compra: diasAtras(5) },
    { nome: 'Bia', nascimento: '1985-10-03', total: 80, ultima_compra: diasAtras(61) },
    { nome: 'Cris', nascimento: '1992-03-10', total: 0, ultima_compra: null },
    { nome: 'Duda', nascimento: null, total: 300, ultima_compra: diasAtras(60) },
    ...['E', 'F', 'G', 'H'].map((n, i) => ({ nome: n, nascimento: null, total: 100 + i, ultima_compra: diasAtras(1) })),
  ]
  assert.deepEqual(segmentar(clientes, 'aniversario', 10).map((c) => c.nome), ['Bia', 'Ana'])
  assert.deepEqual(segmentar(clientes, 'sumidas', 10).map((c) => c.nome), ['Bia']) // 60 dias ainda não conta
  assert.deepEqual(segmentar(clientes, 'melhores', 10).map((c) => c.nome), ['Ana', 'Duda', 'H', 'G', 'F'])
  assert.equal(segmentar(clientes, 'todas', 10).length, 8)
})

test('ficha da cliente: limpa, valida e não aceita WhatsApp de outra cliente', () => {
  const hoje = paraISO(new Date())
  const { cliente } = montarCliente({ nome: '  Ana   Souza ', whatsapp: '+55 (11) 98888-7777', email: ' Ana@Email.com ', nascimento: '1990-10-20', sutia: '44', calcinha: '', aceita_contato: true }, { hoje })
  assert.equal(cliente.nome, 'Ana Souza')
  assert.equal(cliente.whatsapp, '11988887777')
  assert.equal(cliente.email, 'ana@email.com')
  assert.deepEqual(cliente.preferencias, { sutia: '44' })
  assert.match(montarCliente({ nome: 'Ana', email: 'ana@' }, { hoje }).erro, /E-mail/)
  assert.match(montarCliente({ nome: 'Ana', nascimento: '2999-01-01' }, { hoje }).erro, /aniversário/)
  assert.match(montarCliente({ nome: 'Ana', whatsapp: '98888-7777' }, { hoje }).erro, /DDD/)
  const outras = [{ nome: 'Bia', whatsapp: '11988887777' }]
  assert.match(montarCliente({ nome: 'Ana', whatsapp: '(11) 98888-7777' }, { hoje, outras }).erro, /Bia/)
  // cliente removida não prende o número
  assert.equal(montarCliente({ nome: 'Ana', whatsapp: '(11) 98888-7777' }, { hoje, outras: [{ ...outras[0], removida_em: 'x' }] }).erro, undefined)
})

test('encomendas: atrasada, chega hoje, filtros', () => {
  const hoje = '2026-10-17'
  assert.equal(situacaoEncomenda({ status: 'aguardando', previsao: '2026-10-15' }, hoje).texto, 'Atrasada há 2 dias')
  assert.equal(situacaoEncomenda({ status: 'aguardando', previsao: hoje }, hoje).texto, 'Chega hoje')
  assert.equal(situacaoEncomenda({ status: 'chegou', previsao: '2026-10-01' }, hoje).tom, 'oliva')
  const lista = [{ status: 'aguardando', previsao: '2026-10-10' }, { status: 'chegou' }, { status: 'entregue' }, { status: 'aguardando', previsao: null }]
  assert.equal(filtrarEncomendas(lista, 'abertas', hoje).length, 3)
  assert.equal(filtrarEncomendas(lista, 'atrasadas', hoje).length, 1)
})

test('encomenda: mesma peça soma, limite de peças diferentes', () => {
  let r = juntarItem([{ variacao_id: 'a', quantidade: 1 }], { variacao_id: 'a', quantidade: 1 })
  assert.deepEqual(r.itens, [{ variacao_id: 'a', quantidade: 2 }])
  const cheia = Array.from({ length: 20 }, (_, i) => ({ descricao: `peça ${i}`, quantidade: 1 }))
  r = juntarItem(cheia, { descricao: 'mais uma', quantidade: 1 })
  assert.equal(r.itens.length, 20)
  assert.match(r.erro, /20/)
})

test('sinal na entrega: abate a primeira parte, depois a segunda, e mostra a sobra', () => {
  assert.deepEqual(sinalPorParte([40], 30), { usado: [30], sobra: 0 })
  assert.deepEqual(sinalPorParte([20, 60], 30), { usado: [20, 10], sobra: 0 })
  assert.deepEqual(sinalPorParte([25.5], 30), { usado: [25.5], sobra: 4.5 })
  assert.deepEqual(sinalPorParte([40], 0), { usado: [0], sobra: 0 })
})
