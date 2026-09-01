import assert from 'node:assert/strict';
import { serializarProdutoPublico } from '../src/services/personalizacoes.js';

const produto = {
  id: 12,
  nome: 'Anel Personalizado',
  preco: '1200.00',
  personalizavel: true,
  imagem: '/uploads/anel.jpg'
};

const configurador = {
  configurador: { ativo: true, quantidade_angulos: 2 },
  personalizacoes: [
    {
      id: 9,
      nome: 'Pedra',
      slug: 'pedra',
      ativo: true,
      opcoes: [{ id: 5, nome: 'Rubi', valor_adicional: '50.00', ativo: true, imagens: [] }]
    }
  ]
};

const resultado = serializarProdutoPublico(produto, [{ id: 1, tipo: 'ouro' }], configurador);

assert.equal(resultado.personalizavel, true);
assert.equal(resultado.configurador.ativo, true);
assert.equal(resultado.personalizacoes.length, 1);
assert.equal(resultado.personalizacoes[0].opcoes[0].valorAdicional, 50);
console.log('Teste de personalização pública: OK');
