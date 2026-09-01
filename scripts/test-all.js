import assert from 'node:assert/strict';
import { serializarProdutoPublico } from '../src/services/personalizacoes.js';

const produtoTeste = {
  id: 1,
  nome: 'Produto Teste',
  preco: '150.00',
  personalizavel: true,
  imagem: '/uploads/teste.jpg'
};

const configuradorTeste = {
  configurador: { ativo: true, quantidade_angulos: 3 },
  personalizacoes: [
    {
      id: 10,
      nome: 'Gravação',
      slug: 'gravacao',
      ativo: true,
      opcoes: [
        { id: 21, nome: 'Texto', valor_adicional: '20.00', ativo: true, imagens: [] }
      ]
    }
  ],
  regras: []
};

const serializado = serializarProdutoPublico(produtoTeste, [], configuradorTeste);
assert.equal(serializado.personalizavel, true);
assert.equal(serializado.configurador.ativo, true);
assert.equal(serializado.personalizacoes.length, 1);
assert.equal(serializado.personalizacoes[0].opcoes[0].valorAdicional, 20);

const statusResposta = await fetch('http://localhost:3000/status-loja');
assert.equal(statusResposta.status, 200, 'Status da loja deve responder 200');
const statusJson = await statusResposta.json();
assert.ok(statusJson.status, 'Status da loja deve conter status');

const produtosResposta = await fetch('http://localhost:3000/api/produtos');
assert.equal(produtosResposta.status, 200, 'Produtos deve responder 200');
const produtosJson = await produtosResposta.json();
assert.ok(Array.isArray(produtosJson), 'Lista de produtos deve ser um array');

console.log('✅ Teste de validação geral do site OK');
console.log('status:', statusJson.status);
console.log('produtos:', produtosJson.length);
