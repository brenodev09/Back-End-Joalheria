import express from "express";
import db from "../database.js";
import upload from "../../config/multer.js";

const router = express.Router();


// ======================================================
// LISTAR TODOS OS PRODUTOS
// GET /produtos
// ======================================================

router.get("/", async (req, res) => {

    try {

        const [produtos] = await db.query(
            `
            SELECT
                p.*,
                c.nome AS categoria,
                m.nome AS material

            FROM produtos p

            LEFT JOIN categorias c
            ON c.id = p.categoria_id

            LEFT JOIN materiais m
            ON m.id = p.material_id

            ORDER BY p.id DESC
            `
        );


        res.json(produtos);


    } catch (error) {

        console.error(error);

        res.status(500).json({
            erro: "Erro ao listar produtos"
        });

    }

});




// ======================================================
// PRODUTOS EM DESTAQUE
// GET /produtos/destaques
// ======================================================

router.get("/destaques", async (req, res) => {

    try {


        const [produtos] = await db.query(
            `
            SELECT 
                p.*,
                c.nome AS categoria

            FROM produtos p

            LEFT JOIN categorias c
            ON c.id = p.categoria_id

            WHERE p.destaque = true
            AND p.ativo = true

            LIMIT 8
            `
        );


        res.json(produtos);


    } catch (error) {

        console.error(error);

        res.status(500).json({
            erro: "Erro ao buscar destaques"
        });

    }

});





// ======================================================
// BUSCAR PRODUTO COMPLETO
// GET /produtos/:id
// ======================================================

router.get("/:id", async (req, res) => {

    try {

        const { id } = req.params;


        const [produto] = await db.query(

            `
SELECT 
    p.*,
    c.nome AS categoria,
    m.nome AS material

FROM produtos p

LEFT JOIN categorias c
ON c.id = p.categoria_id

LEFT JOIN materiais m
ON m.id = p.material_id

WHERE p.id = ?

`,
            [id]

        )


        if (produto.length === 0) {

            return res.status(404).json({
                erro: "Produto não encontrado"
            });

        }



        const [variacoes] = await db.query(

            `
            SELECT
                id,
                tipo,
                valor,
                preco,
                estoque

            FROM produto_variacoes

            WHERE produto_id = ?

            ORDER BY id

            `,
            [id]

        );



        return res.json({

            ...produto[0],

            variacoes

        });



    } catch (error) {

        console.error(error);

        return res.status(500).json({
            erro: "Erro ao buscar produto"
        });

    }

});







// ======================================================
// CADASTRAR PRODUTO
// ======================================================


router.post("/", upload.single("imagem"), async (req, res) => {


    try {


        const {
            nome,
            descricao,
            preco,
            estoque,
            estoque_minimo,
            localizacao,
            categoria_id,
            material_id,
            ativo,
            destaque


        } = req.body;




        const imagem = req.file
            ? `/uploads/${req.file.filename}`
            : null;



        const ativoConvertido =
            ativo === "true" || ativo === true
                ? 1 : 0;



        const destaqueConvertido =
            destaque === "true" || destaque === true
                ? 1 : 0;




        const [resultado] = await db.query(

            `
INSERT INTO produtos

(
nome,
descricao,
preco,
estoque,
estoque_minimo,
localizacao,
categoria_id,
material_id,
ativo,
imagem,
destaque
)

VALUES(?,?,?,?,?,?,?,?,?,?,?)

`,

            [

                nome,
                descricao || null,
                preco,
                estoque || 0,
                estoque_minimo || 5,
                localizacao || null,
                categoria_id || null,
                material_id || null,
                ativoConvertido,
                imagem,
                destaqueConvertido

            ]


        );



        const [novoProduto] = await db.query(

            `
SELECT *
FROM produtos
WHERE id = ?

`,
            [resultado.insertId]


        );



        res.status(201).json(novoProduto[0]);



    } catch (error) {


        console.error(error);


        res.status(500).json({
            erro: "Erro ao criar produto"
        });


    }


});







// ======================================================
// DELETAR PRODUTO
// ======================================================


router.delete("/:id", async (req, res) => {


    try {


        const { id } = req.params;



        const [resultado] = await db.query(

            `
DELETE FROM produtos
WHERE id=?

`,
            [id]

        );



        if (resultado.affectedRows === 0) {

            return res.status(404).json({
                erro: "Produto não encontrado"
            });

        }



        res.json({
            mensagem: "Produto removido"
        });



    } catch (error) {

        console.error(error);


        res.status(500).json({
            erro: "Erro ao deletar produto"
        });


    }



});








// ======================================================
// EDITAR PRODUTO
// ======================================================


router.put("/:id", upload.single("imagem"), async (req, res) => {


    try {


        const { id } = req.params;


        const {

            nome,
            descricao,
            preco,
            estoque,
            estoque_minimo,
            localizacao,
            categoria_id,
            material_id,
            ativo,
            destaque


        } = req.body;




        const ativoConvertido =
            ativo === "true" || ativo === true || ativo === "1"
                ? 1
                : 0;



        const destaqueConvertido =
            destaque === "true" || destaque === true || destaque === "1"
                ? 1
                : 0;





        let imagem = null;



        if (req.file) {

            imagem = `/uploads/${req.file.filename}`;

        }




        let query = `

UPDATE produtos SET

nome=?,
descricao=?,
preco=?,
estoque=?,
estoque_minimo=?,
localizacao=?,
categoria_id=?,
material_id=?,
ativo=?,
destaque=?

`;



        let valores = [

            nome,

            descricao || null,

            Number(preco),

            Number(estoque),

            Number(estoque_minimo),

            localizacao || null,

            categoria_id || null,

            material_id || null,

            ativoConvertido,

            destaqueConvertido

        ];





        if (imagem) {


            query += `, imagem=?`;

            valores.push(imagem);


        }




        query += `

WHERE id=?

`;



        valores.push(id);




        await db.query(

            query,

            valores

        );






        const [produtoAtualizado] = await db.query(

            `
SELECT *
FROM produtos
WHERE id=?
`,
            [id]

        );



        res.json(produtoAtualizado[0]);




    } catch (error) {


        console.error("ERRO EDITAR PRODUTO:", error);



        res.status(500).json({

            erro: "Erro ao editar produto",

            detalhes: error.message

        });


    }



});



export default router;