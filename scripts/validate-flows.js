import assert from 'node:assert/strict';

const base = 'http://localhost:3000/api';
const email = `fluxo_${Date.now()}@teste.com`;

const registro = await fetch(`${base}/usuarios`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nome: 'Fluxo Teste', email, senha: 'Teste123!' })
});
const registroBody = await registro.json();
console.log('registro', registro.status, registroBody);
assert.equal(registro.status, 201, 'Registro de usuário deve criar conta');

const login = await fetch(`${base}/usuarios/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, senha: 'Teste123!' })
});
const loginBody = await login.json();
console.log('login', login.status, loginBody);
assert.equal(login.status, 200, 'Login deve retornar 200');
assert.ok(loginBody.token, 'Login deve retornar token');
const token = loginBody.token;

const produtos = await fetch(`${base}/produtos`);
const produtosBody = await produtos.json();
console.log('produtos', produtos.status, Array.isArray(produtosBody) ? produtosBody.length : produtosBody);
assert.equal(produtos.status, 200, 'Listagem de produtos deve responder 200');
assert.ok(Array.isArray(produtosBody) && produtosBody.length > 0, 'Deve haver produtos cadastrados');
const produto = produtosBody.find((item) => Number(item.ativo) === 1 && Number(item.estoque) > 0) || produtosBody[0];
assert.ok(produto, 'Deve existir um produto para o fluxo de compra');

const addCarrinho = await fetch(`${base}/carrinho`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({ produto_id: produto.id, quantidade: 1 })
});
const addCarrinhoBody = await addCarrinho.text();
console.log('carrinho add', addCarrinho.status, addCarrinhoBody);
assert.ok(addCarrinho.status === 201 || addCarrinho.status === 200, 'Adicionar ao carrinho deve funcionar');

const listarCarrinho = await fetch(`${base}/carrinho`, {
  headers: { Authorization: `Bearer ${token}` }
});
const carrinhoBody = await listarCarrinho.json();
console.log('carrinho list', listarCarrinho.status, Array.isArray(carrinhoBody) ? carrinhoBody.length : carrinhoBody);
assert.equal(listarCarrinho.status, 200, 'Listagem do carrinho deve funcionar');
assert.ok(Array.isArray(carrinhoBody), 'Carrinho deve retornar array');

const pedido = await fetch(`${base}/pedidos`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  },
  body: JSON.stringify({
    formaPagamento: 'pix',
    tipoEntrega: 'retirada'
  })
});
const pedidoBody = await pedido.json();
console.log('pedido', pedido.status, pedidoBody);
assert.ok(pedido.status === 201 || pedido.status === 200, 'Criação do pedido deve funcionar');
assert.ok(pedidoBody.pedidoId || pedidoBody.sucesso || pedidoBody.erro === undefined, 'Pedido deve responder com payload válido');

console.log('✅ Fluxos principais validados com sucesso');
