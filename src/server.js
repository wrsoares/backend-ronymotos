// src/server.js
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5002;

app.use(helmet());
app.use(express.json());
app.use(morgan("dev"));

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://ronymotos.app.br",
      "https://www.ronymotos.app.br",
      "https://api.ronymotos.app.br"
    ],
    credentials: true
  })
);

// Healthcheck
app.get("/", (req, res) => {
  res.send("API Rony Motos (ESM) OK");
});

// Exemplo
app.get("/status", (req, res) => {
  res.json({
    ok: true,
    env: process.env.NODE_ENV || "development",
    at: new Date().toISOString()
  });
});

app.get("/db-test", async (req, res) => {
    try {
      const { rows } = await pool.query("SELECT NOW()");
      res.json({ ok: true, time: rows[0].now });
    } catch (err) {
      console.error(err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

app.listen(PORT, () => {
  console.log(`Rony Motos API rodando em http://localhost:${PORT}`);
});
