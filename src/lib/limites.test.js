import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  filtroDinheiro, filtroInteiro, filtroPercentual, limparTexto, lerValor, lerInteiro, erroData, somarMeses,
  separarLista, numeroWhatsApp, erroWhatsApp, whatsappValido, formatarWhatsApp, linkWhatsApp, cnpjValido, formatarCNPJ,
} from './limites.js'
import { lerMoeda } from './moeda.js'

test('campos: o que pode ser digitado', () => {
  assert.equal(filtroDinheiro('R$ -1.500,50abc'), '1.500,50')
  assert.equal(filtroInteiro('1,5'), '15')
  assert.equal(filtroInteiro('123456'), '1234')
  assert.equal(filtroPercentual('250'), '100')
  assert.equal(filtroPercentual('3,99'), '3,99')
  assert.equal(limparTexto('  Sutiã   renda  '), 'Sutiã renda')
})

test('dinheiro: vazio, inválido, zero, negativo e acima do limite', () => {
  assert.equal(lerMoeda('1,2,3'), NaN)
  assert.match(lerValor('').erro, /Informe/)
  assert.match(lerValor('1,2,3').erro, /número válido/)
  assert.match(lerValor('0').erro, /maior que zero/)
  assert.deepEqual(lerValor('0', { min: 0 }), { valor: 0 })
  assert.match(lerValor('1.000.000').erro, /limite/)
  assert.deepEqual(lerValor('49,90'), { valor: 49.9 })
  assert.deepEqual(lerValor('', { obrigatorio: false }), { valor: 0 })
})

test('quantidade: só inteiros, entre o mínimo e o máximo', () => {
  assert.match(lerInteiro('').erro, /Informe/)
  assert.match(lerInteiro('1.5').erro, /inteiro/)
  assert.match(lerInteiro('0').erro, /pelo menos 1/)
  assert.deepEqual(lerInteiro('0', { min: 0 }), { valor: 0 })
  assert.match(lerInteiro('10000').erro, /limite/)
  assert.deepEqual(lerInteiro('12'), { valor: 12 })
})

test('datas: ano absurdo, dia que não existe, faixa', () => {
  assert.equal(erroData('2026-10-17'), null)
  assert.match(erroData('').toString(), /Informe/)
  assert.equal(erroData('', { obrigatoria: false }), null)
  assert.match(erroData('2026-02-30'), /não existe/)
  assert.match(erroData('20266-01-01'), /incompleta/)
  assert.match(erroData('1850-01-01'), /fora do esperado/)
  assert.match(erroData('2026-10-10', { min: '2026-10-17' }), /fora do esperado/)
})

test('contas parceladas: dia 31 vira o último dia do mês', () => {
  assert.equal(somarMeses('2026-01-31', 1), '2026-02-28')
  assert.equal(somarMeses('2028-01-31', 1), '2028-02-29')
  assert.equal(somarMeses('2026-01-31', 2), '2026-03-31')
  assert.equal(somarMeses('2026-11-15', 3), '2027-02-15')
})

test('cores e tamanhos: sem repetidas e sem vazias', () => {
  assert.deepEqual(separarLista('Preto, preto , Nude,, '), ['Preto', 'Nude'])
  assert.deepEqual(separarLista(''), [])
})

test('WhatsApp: com ou sem 55, fixo ou celular', () => {
  assert.equal(numeroWhatsApp('+55 (11) 98888-7777'), '11988887777')
  assert.equal(whatsappValido('(11) 98888-7777'), true)
  assert.equal(whatsappValido('(11) 3333-4444'), true)
  assert.equal(whatsappValido(''), true)
  assert.equal(whatsappValido('98888-7777'), false)    // sem DDD
  assert.equal(whatsappValido('(11) 88888-7777'), false) // celular sem o 9
  assert.equal(formatarWhatsApp('11988887777'), '(11) 98888-7777')
  assert.equal(linkWhatsApp('5511988887777', 'oi'), 'https://wa.me/5511988887777?text=oi')
  assert.equal(linkWhatsApp('123', 'oi'), 'https://wa.me/?text=oi')
  const clientes = [{ nome: 'Ana', whatsapp: '(11) 98888-7777' }, { nome: 'Removida', whatsapp: '', removida: true }]
  assert.match(erroWhatsApp(clientes, '11988887777'), /Ana/)  // mesma cliente, escrito diferente
  assert.equal(erroWhatsApp(clientes, '(11) 97777-6666'), null)
  assert.equal(erroWhatsApp(clientes, ''), null)
})

test('CNPJ: dígitos verificadores, inclusive o novo alfanumérico', () => {
  assert.equal(cnpjValido('11.222.333/0001-81'), true)
  assert.equal(cnpjValido('11.222.333/0001-82'), false)
  assert.equal(cnpjValido('00.000.000/0000-00'), false)
  assert.equal(cnpjValido('1122233300018'), false)
  assert.equal(cnpjValido('12.ABC.345/01DE-35'), true)
  assert.equal(formatarCNPJ('11222333000181'), '11.222.333/0001-81')
})
