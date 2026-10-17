import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  digitoEAN, erroCodigoBarras, descreverVariacao, combinarVariacoes, lerCSV, planilhaParaProdutos, textoModeloPlanilha,
} from './catalogo.js'

const EMPRESAS = { day: { apelido: 'CNPJ Day', dona: 'Day' }, fe: { apelido: 'CNPJ Fê', dona: 'Fê' } }

test('código de barras: dígito verificador pega número trocado', () => {
  assert.equal(digitoEAN('200000000001'), 5) // o mesmo que o banco gera
  assert.equal(erroCodigoBarras('2000000000015'), null)
  assert.match(erroCodigoBarras('2000000000016'), /não confere/)
  assert.equal(erroCodigoBarras('ABC-123'), null)      // código interno do fornecedor
  assert.equal(erroCodigoBarras(''), null)             // sem código
  assert.match(erroCodigoBarras('12'), /4 a 30/)
})

test('variações: modelo × cor × tamanho na lingerie, tonalidade × volume no cosmético', () => {
  assert.equal(combinarVariacoes('lingerie', { modelo: ['Balconete', 'Meia taça'], cor: ['Preto', 'Nude'], tamanho: ['42', '44'] }).length, 8)
  assert.deepEqual(combinarVariacoes('lingerie', { cor: ['Preto'] }), [{ cor: 'Preto' }])
  assert.deepEqual(combinarVariacoes('cosmetico', {}), [{}])
  assert.deepEqual(combinarVariacoes('kit', { cor: ['Preto'] }), [{}])
  assert.equal(descreverVariacao({ modelo: 'Balconete', cor: 'Preto', tamanho: '42' }), 'Balconete · Preto · 42')
  assert.equal(descreverVariacao({}), 'Único')
})

test('planilha: lê ; , e aspas, inclusive o próprio modelo', () => {
  assert.deepEqual(lerCSV('a;b\r\n1;"x;y"\n'), [['a', 'b'], ['1', 'x;y']])
  assert.deepEqual(lerCSV('a,b\n"diz ""oi""",2'), [['a', 'b'], ['diz "oi"', '2']])
  const { produtos, erros } = planilhaParaProdutos(lerCSV(textoModeloPlanilha()), { empresas: EMPRESAS })
  assert.deepEqual(erros, [])
  assert.equal(produtos.length, 2)
  assert.equal(produtos[0].variacoes.length, 2) // Aurora preto e nude viram um produto só
  assert.equal(produtos[1].empresa_id, 'fe')
  assert.equal(produtos[1].controla_validade, true)
})

test('planilha: aponta o erro na linha certa', () => {
  const cabecalho = 'produto;tipo;cnpj;cor;codigo_barras;preco'
  const csv = [
    cabecalho,
    'Sutiã A;lingerie;Day;Preto;7891234567895;89,90',
    'Sutiã A;lingerie;Day;Preto;;89,90',          // 3: variação repetida
    'Sutiã B;lingerie;Day;Nude;7891234567895;50',  // 4: código repetido
    'Calcinha;lingerie;Maria;;;30',                // 5: CNPJ que não existe
    'Batom;batom;Fê;;;20',                         // 6: tipo que não existe
    'Creme;cosmetico;Fê;;;abc',                    // 7: preço inválido
    'Já existe;outro;Day;;;10',                    // 8: já cadastrado
    ';outro;Day;;;10',                             // 9: sem nome
  ].join('\n')
  const { produtos, erros } = planilhaParaProdutos(lerCSV(csv), { empresas: EMPRESAS, existentes: { nomes: new Set(['ja existe']), codigos: new Set() } })
  assert.deepEqual(erros.map((e) => e.linha), [3, 4, 5, 6, 7, 8, 9])
  assert.equal(produtos.length, 1)
  assert.match(planilhaParaProdutos(lerCSV('nome;valor\nx;1'), {}).erros[0].mensagem, /Faltam as colunas/)
})
