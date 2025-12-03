// src/routes/usuariosRoutes.js
const express = require("express");
const router = express.Router();
const db = require("../db");

/**
 * LISTAR usuários (somente ativos)
 */
router.get("/usuarios", (req, res) => {
  const sql = `
    SELECT id, nome, login, perfil AS tipo, cpf, barco
    FROM usuarios
    WHERE ativo = 1
    ORDER BY nome
  `;

  db.query(sql, (err, rows) => {
    if (err) {
      console.error("Erro ao listar usuários:", err);
      return res.status(500).json({ error: "Erro ao listar usuários." });
    }
    res.json(rows);
  });
});

/**
 * CRIAR novo usuário
 */
router.post("/usuarios", (req, res) => {
  let { nome, login, senha, tipo, cpf, barco } = req.body;

  if (!nome || !login || !senha || !tipo) {
    return res
      .status(400)
      .json({ error: "Nome, login, senha e tipo são obrigatórios." });
  }

  // normaliza tipo (mas aceita maiúscula/minúscula)
  tipo = String(tipo).toLowerCase(); // emissor, representante, transportador, admin
  login = String(login).trim();

  const checkSql = "SELECT id FROM usuarios WHERE LOWER(login) = LOWER(?) LIMIT 1";
  db.query(checkSql, [login], (err, rows) => {
    if (err) {
      console.error("Erro ao verificar login:", err);
      return res
        .status(500)
        .json({ error: "Erro ao verificar existência do login." });
    }

    if (rows.length > 0) {
      return res.status(409).json({ error: "Já existe um usuário com esse login." });
    }

    const insertSql = `
      INSERT INTO usuarios (nome, login, senha, perfil, cpf, barco, ativo)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `;
    db.query(
      insertSql,
      [nome, login, senha, tipo, cpf || null, barco || null],
      (err, result) => {
        if (err) {
          console.error("Erro ao criar usuário:", err);
          return res.status(500).json({ error: "Erro ao criar usuário." });
        }

        res.status(201).json({
          id: result.insertId,
          nome,
          login,
          tipo,
          cpf: cpf || null,
          barco: barco || null,
        });
      }
    );
  });
});

/**
 * ATUALIZAR usuário
 */
router.put("/usuarios/:id", (req, res) => {
  const { id } = req.params;
  let { nome, login, senha, tipo, cpf, barco } = req.body;

  if (!nome || !login || !tipo) {
    return res
      .status(400)
      .json({ error: "Nome, login e tipo são obrigatórios." });
  }

  tipo = String(tipo).toLowerCase();
  login = String(login).trim();

  // monta campos dinamicamente
  const fields = ["nome = ?", "login = ?", "perfil = ?", "cpf = ?", "barco = ?"];
  const params = [nome, login, tipo, cpf || null, barco || null];

  if (senha && senha.trim() !== "") {
    fields.push("senha = ?");
    params.push(senha);
  }

  params.push(id);

  const sql = `
    UPDATE usuarios
    SET ${fields.join(", ")}
    WHERE id = ?
  `;

  db.query(sql, params, (err, result) => {
    if (err) {
      console.error("Erro ao atualizar usuário:", err);
      return res.status(500).json({ error: "Erro ao atualizar usuário." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    res.json({ message: "Usuário atualizado com sucesso." });
  });
});

/**
 * REMOVER usuário (aqui removendo de vez; se quiser, pode trocar por ativo=0)
 */
router.delete("/usuarios/:id", (req, res) => {
  const { id } = req.params;

  const sql = "DELETE FROM usuarios WHERE id = ?";

  db.query(sql, [id], (err, result) => {
    if (err) {
      console.error("Erro ao excluir usuário:", err);
      return res.status(500).json({ error: "Erro ao excluir usuário." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    res.json({ message: "Usuário excluído com sucesso." });
  });
});

module.exports = router;
