import express from "express"
import cors from "cors"
import routes from "./routes/index.js"
import doteEnv from "dotenv"
import { cancelarPedidosExpirados } from "./routes/pedidos.routes.js"
import { verificarStatusLoja } from "./middlewares/statusLoja.js"
import { inicializarConfiguracoes, statusEfetivoLoja } from "./services/configuracoes.js"


const app = express()

doteEnv.config()

app.use(cors())
app.use(express.json())

app.use("/uploads", express.static("uploads"))

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
app.use(routes)

async function iniciarServidor() {
    await inicializarConfiguracoes()
    setInterval(cancelarPedidosExpirados, 60 * 1000)
    app.listen(process.env.PORT, () => {
        console.log(`Servidor rodando na porta ${process.env.PORT}`)
    })
}

iniciarServidor().catch((error) => {
    console.error("Não foi possível iniciar o servidor:", error)
    process.exit(1)
})