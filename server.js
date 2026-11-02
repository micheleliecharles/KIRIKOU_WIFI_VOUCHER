const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, './')));

// Initialisation de la base de données SQLite
const db = new sqlite3.Database('./db.sqlite', (err) => {
    if (err) console.error("Erreur ouverture DB:", err.message);
    else console.log("Connecté à la base de données SQLite.");
});

// Création de la table des vouchers
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS vouchers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            duration_days INTEGER NOT NULL,
            status TEXT DEFAULT 'PENDING', -- PENDING, ACTIVE, EXPIRED, BLOCKED
            device_id TEXT DEFAULT NULL,
            activated_at DATETIME DEFAULT NULL,
            expires_at DATETIME DEFAULT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// Helper pour générer un code unique aléatoire
function generateUniqueCode(length = 8) {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Helper pour vérifier et mettre à jour les statuts expirés
function updateExpiredVouchers() {
    const now = new Date().toISOString();
    db.run(`
        UPDATE vouchers 
        SET status = 'EXPIRED' 
        WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at < ?
    `, [now]);
}

// ROUTE : Génération de plusieurs codes
app.post('/api/vouchers/generate', (req, res) => {
    const { count, durationDays } = req.body;
    const numCount = parseInt(count) || 1;
    const numDays = parseInt(durationDays) || 1;

    const createdCodes = [];
    let completed = 0;

    for (let i = 0; i < numCount; i++) {
        const code = `KIR-${generateUniqueCode()}`;
        db.run(
            `INSERT INTO vouchers (code, duration_days, status) VALUES (?, ?, 'PENDING')`,
            [code, numDays],
            function (err) {
                if (!err) createdCodes.push(code);
                completed++;
                if (completed === numCount) {
                    res.json({ success: true, count: createdCodes.length, codes: createdCodes });
                }
            }
        );
    }
});

// ROUTE : Validation et activation d'un code (côté client/hotspot)
app.post('/api/vouchers/activate', (req, res) => {
    updateExpiredVouchers();
    const { code, deviceId } = req.body;

    if (!code || !deviceId) {
        return res.status(400).json({ success: false, message: "Code et Identifiant appareil requis." });
    }

    db.get(`SELECT * FROM vouchers WHERE code = ?`, [code], (err, voucher) => {
        if (err || !voucher) {
            return res.status(404).json({ success: false, message: "Code invalide ou inexistant." });
        }

        if (voucher.status === 'BLOCKED') {
            return res.status(403).json({ success: false, message: "Ce code a été bloqué par l'administrateur." });
        }

        if (voucher.status === 'EXPIRED') {
            return res.status(403).json({ success: false, message: "Ce code a expiré." });
        }

        // Première utilisation : Activation
        if (voucher.status === 'PENDING') {
            const now = new Date();
            const expiresAt = new Date(now.getTime() + voucher.duration_days * 24 * 60 * 60 * 1000).toISOString();
            const activatedAt = now.toISOString();

            db.run(
                `UPDATE vouchers SET status = 'ACTIVE', device_id = ?, activated_at = ?, expires_at = ? WHERE id = ?`,
                [deviceId, activatedAt, expiresAt, voucher.id],
                function (err) {
                    if (err) return res.status(500).json({ success: false, message: "Erreur serveur lors de l'activation." });
                    return res.json({ success: true, message: "Code activé avec succès !", expiresAt });
                }
            );
        } else if (voucher.status === 'ACTIVE') {
            // Vérification de l'appareil
            if (voucher.device_id === deviceId) {
                return res.json({ success: true, message: "Appareil reconnu. Accès autorisé.", expiresAt: voucher.expires_at });
            } else {
                return res.status(403).json({ success: false, message: "Refusé : Ce code est déjà associé à un autre appareil." });
            }
        }
    });
});

// ROUTE : Liste complète des vouchers (Dashboard)
app.get('/api/vouchers', (req, res) => {
    updateExpiredVouchers();
    db.all(`SELECT * FROM vouchers ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, vouchers: rows });
    });
});

// ROUTE : Changer le statut (Bloquer / Débloquer / Supprimer)
app.post('/api/vouchers/status', (req, res) => {
    const { id, status } = req.body;
    db.run(`UPDATE vouchers SET status = ? WHERE id = ?`, [status, id], function (err) {
        if (err) return res.status(500).json({ success: false, message: err.message });
        res.json({ success: true, message: "Statut mis à jour." });
    });
});

app.listen(PORT, () => {
    console.log(`Serveur KIRIKOU Wi-Fi actif sur le port ${PORT}`);
});
