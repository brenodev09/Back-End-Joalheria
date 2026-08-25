import express from "express"
import cors from "cors"
import routes from "./routes/index.js"
import doteEnv from "dotenv"
import { cancelarPedidosExpirados } from "./routes/pedidos.routes.js"


const app = express()

doteEnv.config()

app.use(cors())
app.use(express.json())

app.use("/uploads", express.static("uploads"))

app.use(routes)

setInterval(
    cancelarPedidosExpirados,
    60 * 1000
)

app.listen(process.env.PORT, () => {
    console.log(`Servidor rodando na porta ${process.env.PORT}`)
})