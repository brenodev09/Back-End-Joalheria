CREATE TABLE produto_configuradores (
    produto_id INT PRIMARY KEY,
    ativo BOOLEAN NOT NULL DEFAULT FALSE,
    quantidade_angulos INT NOT NULL DEFAULT 1,
    CONSTRAINT fk_configurador_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE
);

CREATE TABLE produto_configurador_imagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    produto_id INT NOT NULL,
    tipo ENUM('base', 'angulo') NOT NULL,
    angulo INT NULL,
    url VARCHAR(500) NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_configurador_imagem_produto FOREIGN KEY (produto_id) REFERENCES produtos(id) ON DELETE CASCADE,
    UNIQUE KEY uq_configurador_imagem (produto_id, tipo, angulo)
);

CREATE TABLE produto_personalizacao_imagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    opcao_id INT NOT NULL,
    modo ENUM('final', 'camada') NOT NULL,
    angulo INT NULL,
    url VARCHAR(500) NOT NULL,
    ordem INT NOT NULL DEFAULT 0,
    ativo BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_personalizacao_imagem_opcao FOREIGN KEY (opcao_id) REFERENCES produto_personalizacao_opcoes(id) ON DELETE CASCADE,
    UNIQUE KEY uq_personalizacao_imagem (opcao_id, modo, angulo)
);

SET @coluna_modelo_3d = (
    SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'produtos' AND COLUMN_NAME = 'modelo_3d'
);
SET @sql_remover_modelo_3d = IF(@coluna_modelo_3d > 0,
    'ALTER TABLE produtos DROP COLUMN modelo_3d',
    'SELECT 1');
PREPARE remover_modelo_3d FROM @sql_remover_modelo_3d;
EXECUTE remover_modelo_3d;
DEALLOCATE PREPARE remover_modelo_3d;
