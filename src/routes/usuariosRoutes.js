// src/routes/usuariosRoutes.js
const express = require("express");
const router = express.Router();
const db = require("../db");

/**
 * LISTAR usuários (somente ativos)
 * Suporta query string: /usuarios?perfil=transportador
 */
router.get("/usuarios", (req, res) => {
  const { perfil } = req.query;

  let sql = `
    SELECT 
      id, 
      nome, 
      login, 
      perfil,       -- deixa o nome correto!
      cpf, 
      barco,
      setor_id,
      ativo
    FROM usuarios
    WHERE ativo = 1
  `;

  const params = [];

  if (perfil) {
    sql += " AND LOWER(perfil) = LOWER(?)";
    params.push(perfil);
  }

  sql += " ORDER BY nome";

  db.query(sql, params, (err, rows) => {
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
  let { nome, login, senha, tipo, cpf, barco, setor_id } = req.body;

  if (!nome || !login || !senha || !tipo) {
    return res
      .status(400)
      .json({ error: "Nome, login, senha e tipo são obrigatórios." });
  }

  tipo = String(tipo).toLowerCase(); // normaliza
  login = String(login).trim();

  const checkSql = `
    SELECT id 
    FROM usuarios 
    WHERE LOWER(login) = LOWER(?) 
    LIMIT 1
  `;

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
      INSERT INTO usuarios 
        (nome, login, senha, perfil, cpf, barco, setor_id, ativo)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `;

    db.query(
      insertSql,
      [nome, login, senha, tipo, cpf || null, barco || null, setor_id || null],
      (err, result) => {
        if (err) {
          console.error("Erro ao criar usuário:", err);
          return res.status(500).json({ error: "Erro ao criar usuário." });
        }

        res.status(201).json({
          id: result.insertId,
          nome,
          login,
          perfil: tipo, // agora devolve corretamente
          cpf: cpf || null,
          barco: barco || null,
          setor_id: setor_id || null,
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
  let { nome, login, senha, tipo, cpf, barco, setor_id } = req.body;

  if (!nome || !login || !tipo) {
    return res
      .status(400)
      .json({ error: "Nome, login e tipo são obrigatórios." });
  }

  tipo = String(tipo).toLowerCase();
  login = String(login).trim();

  // Campos que sempre atualizam
  const fields = [
    "nome = ?",
    "login = ?",
    "perfil = ?",
    "cpf = ?",
    "barco = ?",
    "setor_id = ?",
  ];
  const params = [nome, login, tipo, cpf || null, barco || null, setor_id || null];

  // opcional: atualizar senha
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
 * REMOVER usuário (remoção real; pode virar inativar se quiser)
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
