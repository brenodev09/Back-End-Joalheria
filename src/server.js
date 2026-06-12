import express from "express"
import cors from "cors"
import routes from "./routes/index.js"

const app = express()

app.use(cors())
app.use(express.json())

app.use("/uploads", express.static("uploads"))

app.use(routes)

app.listen(3000, () => {
    console.log("Servidor rodando na porta 3000")
})