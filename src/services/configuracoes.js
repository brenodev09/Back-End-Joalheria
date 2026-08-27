import db from "../database.js"

export const CONFIGURACOES_PADRAO = {
    store_name: ["Joalheria", "string", "geral"],
    store_email: [null, "string", "geral"],
    store_phone: [null, "string", "geral"],
    store_address: [null, "string", "geral"],
    store_cnpj: [null, "string", "geral"],
    store_currency: ["BRL", "string", "geral"],
    store_timezone: ["America/Sao_Paulo", "string", "geral"],
    brand_name: ["Joalheria", "string", "identidade"],
    brand_slogan: [null, "string", "identidade"],
    home_collection_id: [null, "number", "identidade"],
    home_featured_product_id: [null, "number", "identidade"],
    wishlist_enabled: ["true", "boolean", "experiencia"],
    reviews_enabled: ["true", "boolean", "experiencia"],
    show_out_of_stock_products: ["true", "boolean", "experiencia"],
    products_per_page: ["12", "number", "experiencia"],
    animations_enabled: ["true", "boolean", "experiencia"],
    store_status: ["online", "string", "status"],
    closed_message: ["A loja está fechada para novas compras. Voltaremos em breve.", "string", "status"],
    maintenance_title: ["Estamos preparando algo especial", "string", "status"],
    maintenance_message: ["Nossa loja está temporariamente indisponível. Voltaremos em breve.", "string", "status"],
    maintenance_image: [null, "string", "status"],
    maintenance_start: [null, "datetime", "status"],
    maintenance_end: [null, "datetime", "status"],
    maintenance_countdown: ["true", "boolean", "status"],
    maintenance_instagram: [null, "string", "status"],
    maintenance_whatsapp: [null, "string", "status"],
    pix_enabled: ["true", "boolean", "pagamentos"],
    card_enabled: ["true", "boolean", "pagamentos"],
    boleto_enabled: ["false", "boolean", "pagamentos"],
    payment_environment: ["sandbox", "string", "pagamentos"],
    max_installments: ["12", "number", "pagamentos"],
    pix_discount: ["0", "number", "pagamentos"],
    payment_expiration_minutes: ["30", "number", "pagamentos"],
    stock_minimum: ["5", "number", "estoque"],
    low_stock_alerts: ["true", "boolean", "estoque"],
    out_of_stock_alerts: ["true", "boolean", "estoque"],
    allow_out_of_stock_purchase: ["false", "boolean", "estoque"],
    reserve_stock_checkout: ["true", "boolean", "estoque"],
    stock_reservation_minutes: ["30", "number", "estoque"],
    automatic_stock_reduction: ["true", "boolean", "pedidos"],
    allow_customer_cancel: ["true", "boolean", "pedidos"],
    minimum_order_value: ["0", "number", "pedidos"],
    maximum_order_value: ["0", "number", "pedidos"],
    coupons_enabled: ["true", "boolean", "cupons"],
    multiple_coupons: ["false", "boolean", "cupons"],
    coupons_on_promotions: ["true", "boolean", "cupons"],
    coupons_on_shipping: ["true", "boolean", "cupons"],
    coupon_minimum_value: ["0", "number", "cupons"],
    free_shipping_enabled: ["true", "boolean", "entrega"],
    free_shipping_minimum: ["500", "number", "entrega"],
    default_shipping_value: ["0", "number", "entrega"],
    default_shipping_deadline: [null, "string", "entrega"],
    store_pickup_enabled: ["false", "boolean", "entrega"],
    session_minutes: ["1440", "number", "seguranca"],
    max_login_attempts: ["5", "number", "seguranca"],
    temporary_lock_minutes: ["15", "number", "seguranca"],
    debug_enabled: ["false", "boolean", "avancado"],
    cache_enabled: ["true", "boolean", "avancado"]
}

function serializarValor(valor, tipo) {
    if (valor === null || valor === undefined) return null
    if (tipo === "json") return JSON.stringify(valor)
    return String(valor)
}

function desserializarValor(valor, tipo) {
    if (valor === null || valor === undefined) return null
    if (tipo === "boolean") return String(valor).toLowerCase() === "true" || String(valor) === "1"
    if (tipo === "number") return Number(valor)
    if (tipo === "json") {
        try { return JSON.parse(valor) } catch { return null }
    }
    return valor
}

export async function inicializarConfiguracoes() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS configuracoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            chave VARCHAR(100) NOT NULL UNIQUE,
            valor TEXT NULL,
            tipo ENUM('string', 'number', 'boolean', 'json', 'datetime') NOT NULL DEFAULT 'string',
            categoria VARCHAR(50) NOT NULL,
            descricao VARCHAR(255) NULL,
            atualizado_por INT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (atualizado_por) REFERENCES usuarios(id) ON DELETE SET NULL,
            INDEX idx_config_categoria (categoria),
            INDEX idx_config_chave (chave)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    await db.query(`
        CREATE TABLE IF NOT EXISTS historico_configuracoes (
            id INT AUTO_INCREMENT PRIMARY KEY,
            configuracao_id INT NULL,
            chave VARCHAR(100) NOT NULL,
            usuario_id INT NULL,
            valor_anterior TEXT NULL,
            valor_novo TEXT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (configuracao_id) REFERENCES configuracoes(id) ON DELETE SET NULL,
            FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
            INDEX idx_historico_config_data (criado_em)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    await db.query(`
        CREATE TABLE IF NOT EXISTS login_bloqueios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            identificador VARCHAR(255) NOT NULL UNIQUE,
            tentativas INT NOT NULL DEFAULT 0,
            bloqueado_ate DATETIME NULL,
            ultimo_ip VARCHAR(45) NULL,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    for (const [chave, [valor, tipo, categoria]] of Object.entries(CONFIGURACOES_PADRAO)) {
        await db.query(
            `INSERT IGNORE INTO configuracoes (chave, valor, tipo, categoria) VALUES (?, ?, ?, ?)`,
            [chave, serializarValor(valor, tipo), tipo, categoria]
        )
    }
}

export async function buscarConfiguracoes() {
    const [linhas] = await db.query(`SELECT * FROM configuracoes ORDER BY categoria, chave`)
    return linhas.reduce((resultado, item) => {
        resultado[item.chave] = desserializarValor(item.valor, item.tipo)
        return resultado
    }, {})
}

export async function buscarConfiguracao(chave) {
    const [linhas] = await db.query(`SELECT valor, tipo FROM configuracoes WHERE chave = ? LIMIT 1`, [chave])
    if (!linhas.length) {
        const padrao = CONFIGURACOES_PADRAO[chave]
        return padrao ? desserializarValor(padrao[0], padrao[1]) : null
    }
    return desserializarValor(linhas[0].valor, linhas[0].tipo)
}

export async function statusEfetivoLoja() {
    const configuracoes = await buscarConfiguracoes()
    const agora = Date.now()
    const inicio = configuracoes.maintenance_start ? new Date(configuracoes.maintenance_start).getTime() : null
    const fim = configuracoes.maintenance_end ? new Date(configuracoes.maintenance_end).getTime() : null
    let status = configuracoes.store_status || "online"
    if (inicio && fim && agora >= inicio && agora < fim) status = "maintenance"
    if (fim && agora >= fim && status === "maintenance" && configuracoes.store_status === "online") status = "online"
    return { status, configuracoes }
}

export async function atualizarConfiguracoes(alteracoes, usuarioId) {
    const permitidas = new Set(Object.keys(CONFIGURACOES_PADRAO))
    const status = alteracoes?.store_status
    if (status !== undefined && !["online", "maintenance", "closed"].includes(String(status).toLowerCase())) {
        throw new Error("Status da loja inválido")
    }
    if (alteracoes?.maintenance_start && alteracoes?.maintenance_end) {
        const inicio = new Date(alteracoes.maintenance_start).getTime()
        const fim = new Date(alteracoes.maintenance_end).getTime()
        if (!Number.isFinite(inicio) || !Number.isFinite(fim) || fim <= inicio) {
            throw new Error("O fim da manutenção deve ser posterior ao início")
        }
    }
    const connection = await db.getConnection()
    const modificadas = []
    try {
        await connection.beginTransaction()
        for (const [chave, valor] of Object.entries(alteracoes || {})) {
            if (!permitidas.has(chave)) continue
            const [atual] = await connection.query(`SELECT id, valor, tipo FROM configuracoes WHERE chave = ? FOR UPDATE`, [chave])
            if (!atual.length) continue
            const novoValor = serializarValor(valor, atual[0].tipo)
            if (novoValor === atual[0].valor) continue
            await connection.query(`UPDATE configuracoes SET valor = ?, atualizado_por = ? WHERE chave = ?`, [novoValor, usuarioId, chave])
            await connection.query(`INSERT INTO historico_configuracoes (configuracao_id, chave, usuario_id, valor_anterior, valor_novo) VALUES (?, ?, ?, ?, ?)`, [atual[0].id, chave, usuarioId, atual[0].valor, novoValor])
            modificadas.push(chave)
        }
        await connection.commit()
        return modificadas
    } catch (error) {
        await connection.rollback()
        throw error
    } finally {
        connection.release()
    }
}
