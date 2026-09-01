import assert from 'node:assert/strict';

const base = 'http://localhost:3000';

const status = await fetch(`${base}/status-loja`);
assert.equal(status.status, 200, 'Status da loja deve responder em produção');
const statusBody = await status.json();
assert.ok(statusBody.status, 'Status público deve informar status');

const produtos = await fetch(`${base}/api/produtos`);
assert.equal(produtos.status, 200, 'API pública de produtos deve responder 200');
const produtosBody = await produtos.json();
assert.ok(Array.isArray(produtosBody), 'Produtos deve retornar array');

const registro = await fetch(`${base}/api/usuarios`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nome: 'Prod Teste', email: `prod_${Date.now()}@teste.com`, senha: 'Teste123!' })
});
const registroBody = await registro.json();
assert.equal(registro.status, 201, 'Cadastro de usuário deve funcionar');
assert.ok(!('senha' in registroBody), 'Resposta não deve expor senha');

const login = await fetch(`${base}/api/usuarios/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: registroBody.email, senha: 'Teste123!' })
});
assert.equal(login.status, 200, 'Login deve funcionar');
const loginBody = await login.json();
assert.ok(loginBody.token, 'Login deve retornar token');

console.log('✅ Produção check concluído');
console.log('status:', statusBody.status);
console.log('produtos:', produtosBody.length);
console.log('usuario:', registroBody.email);
