
const baseUrl = process.env.API_URL || "http://localhost:3000"
const email = process.env.TEST_ADMIN_EMAIL
const senha = process.env.TEST_ADMIN_PASSWORD

if (!email || !senha) {
    console.error("Defina TEST_ADMIN_EMAIL e TEST_ADMIN_PASSWORD antes de executar.")
    process.exit(1)
}

async function request(path, options = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
    })
    const text = await response.text()
    let body
    try { body = JSON.parse(text) } catch { body = text }
    if (!response.ok) throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`)
    return body
}

async function run() {
    const login = await request("/usuarios/login", {
        method: "POST",
        body: JSON.stringify({ email, senha })
    })
    const token = login.token
    if (!token || login.usuario?.tipo !== "admin") throw new Error("A conta informada não é administradora")
    const headers = { Authorization: `Bearer ${token}` }

    const original = await request("/admin/configuracoes", { headers })
    const marcador = `Teste ${new Date().toISOString()}`

    try {
        await request("/admin/configuracoes", {
            method: "PUT", headers,
            body: JSON.stringify({ configuracoes: { store_phone: marcador } })
        })
        const persistida = await request("/admin/configuracoes", { headers })
        if (persistida.store_phone !== marcador) throw new Error("A configuração não persistiu")
        const historico = await request("/admin/configuracoes/historico?limite=5", { headers })
        if (!historico.some(item => item.chave === "store_phone")) throw new Error("Histórico não registrou a alteração")

        const publicoOnline = await request("/status-loja")
        if (publicoOnline.status !== "online") throw new Error("O estado inicial não está online")

        await request("/admin/configuracoes/status", { method: "PUT", headers, body: JSON.stringify({ status: "maintenance" }) })
        const bloqueio = await fetch(`${baseUrl}/produtos`)
        if (bloqueio.status !== 503) throw new Error(`Rotas públicas não foram bloqueadas: ${bloqueio.status}`)
        const adminDuranteManutencao = await request("/admin/configuracoes/status", { headers })
        if (adminDuranteManutencao.status !== "maintenance") throw new Error("Admin não permaneceu acessível")

        await request("/admin/configuracoes/status", { method: "PUT", headers, body: JSON.stringify({ status: "closed" }) })
        const fechamento = await request("/status-loja")
        if (fechamento.status !== "closed") throw new Error("Status fechado não foi aplicado")

        await request("/admin/configuracoes/status", { method: "PUT", headers, body: JSON.stringify({ status: "online" }) })
        const restaurada = await request("/status-loja")
        if (restaurada.status !== "online") throw new Error("A loja não voltou ao estado online")
        const alertas = await request("/admin/configuracoes/alertas", { headers })
        await request("/admin/configuracoes/testar-pagamento", { method: "POST", headers, body: "{}" })
        console.log("OK: login admin, leitura, persistência, histórico, manutenção, fechamento, restauração, alertas e Mercado Pago.")
        console.log(`Alertas encontrados: baixo estoque=${alertas.alertas.baixoEstoque.length}, esgotados=${alertas.alertas.esgotados.length}`)
    } finally {
        await request("/admin/configuracoes", {
            method: "PUT", headers,
            body: JSON.stringify({ configuracoes: { ...original, store_status: "online", maintenance_start: null, maintenance_end: null } })
        }).catch(error => console.error("Não foi possível restaurar as configurações:", error.message))
    }
}

run().catch(error => {
    console.error(`FALHOU: ${error.message}`)
    process.exit(1)
})
