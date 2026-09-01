import express from "express"
import cors from "cors"
import routes from "./routes/index.js"
import doteEnv from "dotenv"
import { cancelarPedidosExpirados } from "./routes/pedidos.routes.js"
import { verificarStatusLoja } from "./middlewares/statusLoja.js"
import { inicializarConfiguracoes, statusEfetivoLoja } from "./services/configuracoes.js"
import { garantirEstruturaBanco } from "./database.js"
import path from "path"
import { fileURLToPath } from "url"

const app = express()

doteEnv.config()

if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET não configurado. Defina a variável de ambiente antes de iniciar a aplicação.")
}

const porta = Number(process.env.PORT) || 3000

app.disable("x-powered-by")
app.use(cors({
    origin: process.env.URL_FRONTEND || "http://localhost:5173",
    credentials: true
}))
app.use(express.json({ limit: "1mb" }))

const raizProjeto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
app.use("/uploads", express.static(path.join(raizProjeto, "uploads")))

app.get("/status-loja", async (req, res) => {
    try {
        const { status, configuracoes } = await statusEfetivoLoja()
        return res.json({
            status,
            titulo: configuracoes.maintenance_title,
            mensagem: status === "closed" ? configuracoes.closed_message : configuracoes.maintenance_message,
            imagem: configuracoes.maintenance_image,
            retorno: configuracoes.maintenance_end,
            contador: configuracoes.maintenance_countdown,
            instagram: configuracoes.maintenance_instagram,
            whatsapp: configuracoes.maintenance_whatsapp
        })
    } catch (error) {
        console.error("ERRO AO CARREGAR STATUS PÚBLICO:", error)
        return res.status(500).json({ erro: "Erro ao carregar status da loja" })
    }
})

app.use(verificarStatusLoja)
app.use("/api", routes)
app.use(routes)

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error)

    if (error?.type === "entity.parse.failed") {
        return res.status(400).json({ erro: "JSON inválido" })
    }

    if (error?.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ erro: "Arquivo excede o tamanho permitido" })
    }

    if (error?.message === "Formato de arquivo inválido") {
        return res.status(400).json({ erro: error.message })
    }

    console.error("ERRO NÃO TRATADO:", error)
    return res.status(error?.statusCode || 500).json({ erro: "Erro interno do servidor" })
})

async function iniciarServidor() {
    await garantirEstruturaBanco()
    await inicializarConfiguracoes()
    setInterval(cancelarPedidosExpirados, 60 * 1000)
    app.listen(porta, () => {
        console.log(`Servidor rodando na porta ${porta}`)
    })
}

iniciarServidor().catch((error) => {
    console.error("Não foi possível iniciar o servidor:", error)
    process.exit(1)
})