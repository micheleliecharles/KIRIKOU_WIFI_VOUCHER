import { neon } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";

const sql = neon(process.env.DATABASE_URL);

async function prepareDatabase() {
  await sql`
    CREATE TABLE IF NOT EXISTS vouchers (
      id BIGSERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      duration_days INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      device_id TEXT,
      activated_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

function isAdmin(req) {
  const token = process.env.ADMIN_TOKEN;
  const auth = req.headers.authorization || "";

  return Boolean(token) && auth === `Bearer ${token}`;
}

function makeCode() {
  return "KIR-" + randomBytes(4).toString("hex").toUpperCase();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (!isAdmin(req)) {
    return res.status(401).json({
      success: false,
      message: "Accès administrateur refusé."
    });
  }

  try {
    await prepareDatabase();

    if (req.method === "GET") {
      await sql`
        UPDATE vouchers
        SET status = 'EXPIRED'
        WHERE status = 'ACTIVE'
          AND expires_at IS NOT NULL
          AND expires_at <= NOW()
      `;

      const vouchers = await sql`
        SELECT * FROM vouchers
        ORDER BY id DESC
      `;

      return res.status(200).json({
        success: true,
        vouchers
      });
    }

    if (req.method === "POST") {
      const count = Number.parseInt(req.body?.count, 10);
      const durationDays = Number.parseInt(req.body?.durationDays, 10);

      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 100 ||
        !Number.isInteger(durationDays) ||
        durationDays < 1 ||
        durationDays > 365
      ) {
        return res.status(400).json({
          success: false,
          message: "Nombre de codes : 1 à 100. Durée : 1 à 365 jours."
        });
      }

      const createdCodes = [];

      for (let i = 0; i < count; i++) {
        let saved = false;

        for (let attempt = 0; attempt < 5 && !saved; attempt++) {
          const code = makeCode();

          try {
            await sql`
              INSERT INTO vouchers (code, duration_days, status)
              VALUES (${code}, ${durationDays}, 'PENDING')
            `;

            createdCodes.push(code);
            saved = true;
          } catch (error) {
            if (error.code !== "23505") throw error;
          }
        }

        if (!saved) {
          throw new Error("Impossible de générer un code unique.");
        }
      }

      return res.status(201).json({
        success: true,
        count: createdCodes.length,
        codes: createdCodes
      });
    }

    if (req.method === "PATCH") {
      const id = Number.parseInt(req.body?.id, 10);
      const status = req.body?.status;

      if (!Number.isInteger(id) || !["BLOCKED", "PENDING"].includes(status)) {
        return res.status(400).json({
          success: false,
          message: "Demande de modification invalide."
        });
      }

      if (status === "BLOCKED") {
        await sql`
          UPDATE vouchers
          SET status = 'BLOCKED'
          WHERE id = ${id}
        `;
      } else {
        await sql`
          UPDATE vouchers
          SET status = CASE
            WHEN expires_at IS NOT NULL AND expires_at <= NOW()
              THEN 'EXPIRED'
            WHEN device_id IS NOT NULL
              THEN 'ACTIVE'
            ELSE 'PENDING'
          END
          WHERE id = ${id} AND status = 'BLOCKED'
        `;
      }

      return res.status(200).json({
        success: true,
        message: "Statut mis à jour."
      });
    }

    res.setHeader("Allow", "GET, POST, PATCH");
    return res.status(405).json({
      success: false,
      message: "Méthode non autorisée."
    });

  } catch (error) {
    console.error("KIRIKOU VOUCHER API:", error);

    return res.status(500).json({
      success: false,
      message: "Erreur serveur. Vérifiez la configuration de la base de données."
    });
  }
}
