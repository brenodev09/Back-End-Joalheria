CREATE TABLE produto_personalizacoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    produto_id INT NOT NULL,
    nome VARCHAR(120) NOT NULL,
    slug VARCHAR(120) NOT NULL,
    tipo VARCHAR(30) NOT NULL DEFAULT 'select',
    obrigatoria BOOLEAN NOT NULL DEFAULT FALSE,
    permite_valor_livre BOOLEAN NOT NULL DEFAULT FALSE,
    valor_livre_maximo INT NOT NULL DEFAULT 255,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ordem INT NOT NULL DEFAULT 0,
    UNIQUE KEY uq_personalizacao_produto_slug (produto_id, slug),
    CONSTRAINT fk_personalizacao_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
);

CREATE TABLE produto_personalizacao_opcoes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    personalizacao_id INT NOT NULL,
    nome VARCHAR(150) NOT NULL,
    descricao TEXT NULL,
    valor_adicional DECIMAL(12,2) NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    ordem INT NOT NULL DEFAULT 0,
    codigo_interno VARCHAR(100) NULL,
    estoque INT NULL,
    visual JSON NULL,
    CONSTRAINT fk_opcao_personalizacao FOREIGN KEY (personalizacao_id) REFERENCES produto_personalizacoes(id) ON DELETE CASCADE
);

CREATE TABLE produto_personalizacao_regras (
    id INT AUTO_INCREMENT PRIMARY KEY,
    produto_id INT NOT NULL,
    regra JSON NOT NULL,
    mensagem VARCHAR(255) NULL,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_regra_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
);

ALTER TABLE carrinho_itens ADD COLUMN configuracao JSON NULL, ADD COLUMN preco_personalizado DECIMAL(12,2) NULL;
ALTER TABLE pedidos_itens ADD COLUMN configuracao_snapshot JSON NULL;