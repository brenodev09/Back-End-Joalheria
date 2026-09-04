import express from "express"

// import itensRoutes from "../routes/itens.routes.js"
import categoriasRoutes from "../routes/categorias.routes.js"
import usuariosRoutes from "../routes/usuarios.routes.js"
import materiaisRoutes from "./materiais.routes.js"
import produtosRoutes from "./produtos.routes.js"
import dashboardRoutes from "./dashboard.routes.js"
import carrinhoRoutes from "./carrinho.routes.js";
import cuponsRoutes from "./cupons.routes.js";
import colecoesRoutes from "./colecoes.routes.js"
import pedidosRoutes from "./pedidos.routes.js"
import funcionariosRoutes from "./funcionarios.routes.js"
import configuracoesRoutes from "./configuracoes.routes.js"
import personalizacoesRoutes from "./personalizacoes.routes.js"
import favoritosRoutes from "./favoritos.routes.js"
import avaliacoesProdutos from "./avaliacoesProdutos.routes.js"




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
routes.use("/produtos", personalizacoesRoutes)
routes.use("/carrinho", carrinhoRoutes);
routes.use("/dashboard", dashboardRoutes)
routes.use("/colecoes", colecoesRoutes);
routes.use("/cupons", cuponsRoutes)
routes.use("/pedidos", pedidosRoutes)
routes.use("/funcionarios", funcionariosRoutes)
routes.use("/configuracoes", configuracoesRoutes)
routes.use("/admin/configuracoes", configuracoesRoutes)
routes.use("/favoritos", favoritosRoutes)
routes.use("/avaliacoes", avaliacoesProdutos)

export default routes