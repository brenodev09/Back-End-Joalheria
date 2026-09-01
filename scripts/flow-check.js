const base = 'http://localhost:3000/api';

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { response, body };
}

async function main() {
  const email = `flow_${Date.now()}@teste.com`;
  const senha = 'Teste123!';

  const register = await request('/usuarios', {
    method: 'POST',
    body: JSON.stringify({ nome: 'Fluxo Teste', email, senha })
  });

  if (!register.response.ok) {
    throw new Error(`Registro falhou: ${register.response.status} ${JSON.stringify(register.body)}`);
  }

  const login = await request('/usuarios/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha })
  });

  if (!login.response.ok || !login.body.token) {
    throw new Error(`Login falhou: ${login.response.status} ${JSON.stringify(login.body)}`);
  }

  const token = login.body.token;

  const produtos = await request('/produtos');
  if (!produtos.response.ok || !Array.isArray(produtos.body)) {
    throw new Error(`Produtos falharam: ${produtos.response.status} ${JSON.stringify(produtos.body)}`);
  }

  const produtoSemPersonalizacao = produtos.body.find((item) => Number(item.personalizavel) === 0) || produtos.body[0];
  const produtoComPersonalizacao = produtos.body.find((item) => Number(item.personalizavel) === 1) || null;

  if (!produtoSemPersonalizacao) {
    throw new Error('Nenhum produto disponível para testar o fluxo');
  }

  const carrinhoSemPersonalizacao = await request('/carrinho', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ produto_id: produtoSemPersonalizacao.id, quantidade: 1 })
  });

  if (!carrinhoSemPersonalizacao.response.ok) {
    throw new Error(`Carrinho simples falhou: ${carrinhoSemPersonalizacao.response.status} ${JSON.stringify(carrinhoSemPersonalizacao.body)}`);
  }

  let carrinhoPersonalizado = null;
  if (produtoComPersonalizacao) {
    const configuracao = { material: 2, pedra: 5, tamanho: 8 };
    carrinhoPersonalizado = await request('/carrinho', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        produto_id: produtoComPersonalizacao.id,
        quantidade: 1,
        configuracao
      })
    });

    if (!carrinhoPersonalizado.response.ok) {
      throw new Error(`Carrinho personalizado falhou: ${carrinhoPersonalizado.response.status} ${JSON.stringify(carrinhoPersonalizado.body)}`);
    }
  }

  const pedido = await request('/pedidos', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      formaPagamento: 'pix',
      tipoEntrega: 'retirada',
      codigo: ''
    })
  });

  if (!pedido.response.ok) {
    throw new Error(`Pedido falhou: ${pedido.response.status} ${JSON.stringify(pedido.body)}`);
  }

  console.log(JSON.stringify({
    registro: register.response.status,
    login: login.response.status,
    carrinhoSemPersonalizacao: carrinhoSemPersonalizacao.response.status,
    carrinhoPersonalizado: carrinhoPersonalizado ? carrinhoPersonalizado.response.status : 'ignorado',
    pedido: pedido.response.status,
    pedidoBody: pedido.body,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
