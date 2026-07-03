import express from "express"

// import itensRoutes from "../routes/itens.routes.js"
import categoriasRoutes from "../routes/categorias.routes.js"
import usuariosRoutes from "../routes/usuarios.routes.js"
import materiaisRoutes from "./materiais.routes.js"
import produtosRoutes from "./produtos.routes.js"


const routes = express.Router()

routes.get("/", (req,res) => {
    return res.json({
        mensagem:"A api está funcionando corretamente!"
    })
})

// routes.use("/itens", itensRoutes)
routes.use("/categorias", categoriasRoutes)
routes.use("/usuarios", usuariosRoutes)
routes.use("/materiais", materiaisRoutes)
routes.use("/produtos", produtosRoutes)

export default routes