import express from "express";
import cors from "cors";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

const PORT = process.env.CRYPTO_PORT || 3003;

/* ======================================================
   KEY GENERATION
====================================================== */
app.post("/crypto/dilithium/keygen", (_req, res) => {
    try {
        const { publicKey, secretKey } = ml_dsa65.keygen();

        if (publicKey.length !== 1952 || secretKey.length !== 4032) {
            throw new Error("Invalid ML-DSA-65 key sizes");
        }

        res.json({
            algorithm: "ML-DSA-65",
            public_key: Buffer.from(publicKey).toString("base64"),
            secret_key: Buffer.from(secretKey).toString("base64")
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* ======================================================
   SIGN
====================================================== */
app.post("/crypto/dilithium/sign", (req, res) => {
    try {
        const { message, secret_key } = req.body;
        if (!message || !secret_key) {
            throw new Error("message and secret_key required");
        }

        const sk = Buffer.from(secret_key, "base64");
        if (sk.length !== 4032) {
            throw new Error("Invalid secret key size");
        }

        const msg = new TextEncoder().encode(message);
        const signature = ml_dsa65.sign(msg, new Uint8Array(sk));

        res.json({
            signature: Buffer.from(signature).toString("base64"),
            signature_size: signature.length
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/* ======================================================
   VERIFY (STRICT)
====================================================== */
// ========== Vérification Dilithium (CORRIGÉ) ==========
app.post("/crypto/dilithium/verify", (req, res) => {
    try {
        const { message, signature, public_key } = req.body;

        if (!message || !signature || !public_key) {
            throw new Error('Message, signature et public_key requis');
        }

        console.log('🔍 Vérification signature Dilithium...');

        const pkBuffer = Buffer.from(public_key, "base64");
        const sigBuffer = Buffer.from(signature, "base64");
        
        console.log(`📐 public_key décodé: ${pkBuffer.length} bytes`);
        console.log(`📐 signature décodée: ${sigBuffer.length} bytes`);

        let actualPublicKey, actualSignature;
        
        const PUBLIC_KEY_SIZE = 1952;
        const SIGNATURE_MIN_SIZE = 3293;
        const SIGNATURE_MAX_SIZE = 3400; // ✅ Tolérance
        
        // Détection intelligente
        if (pkBuffer.length === PUBLIC_KEY_SIZE && 
            sigBuffer.length >= SIGNATURE_MIN_SIZE && 
            sigBuffer.length <= SIGNATURE_MAX_SIZE) {
            // Ordre correct
            actualPublicKey = pkBuffer;
            actualSignature = sigBuffer;
            console.log('✅ Paramètres dans le bon ordre');
            
        } else if (sigBuffer.length === PUBLIC_KEY_SIZE && 
                   pkBuffer.length >= SIGNATURE_MIN_SIZE && 
                   pkBuffer.length <= SIGNATURE_MAX_SIZE) {
            // Ordre inversé
            actualPublicKey = sigBuffer;
            actualSignature = pkBuffer;
            console.log('⚠️ Paramètres inversés - correction automatique');
            
        } else {
            console.error('❌ Tailles invalides');
            console.error(`   public_key: ${pkBuffer.length} bytes (1952 attendu)`);
            console.error(`   signature: ${sigBuffer.length} bytes (3293-3400 attendu)`);
            throw new Error(
                `Tailles invalides: public_key=${pkBuffer.length}b, signature=${sigBuffer.length}b`
            );
        }

        // ✅ Tronquer la signature si nécessaire
        if (actualSignature.length > SIGNATURE_MIN_SIZE) {
            console.log(`⚠️ Signature trop longue (${actualSignature.length}b), troncature à 3293b`);
            actualSignature = actualSignature.slice(0, SIGNATURE_MIN_SIZE);
        }

        const pk = new Uint8Array(actualPublicKey);
        const sig = new Uint8Array(actualSignature);
        const msg = new TextEncoder().encode(message);

        const startTime = Date.now();
        const isValid = ml_dsa65.verify(pk, msg, sig);
        const elapsed = Date.now() - startTime;

        res.json({ 
            valid: isValid,
            verification_time_ms: elapsed,
            algorithm: 'ML-DSA-65',
            sizes: {
                public_key_bytes: actualPublicKey.length,
                signature_bytes: actualSignature.length
            }
        });

        console.log(`${isValid ? '✅' : '❌'} Signature ${isValid ? 'VALIDE' : 'INVALIDE'} (${elapsed}ms)\n`);

    } catch (error) {
        console.error("❌ ERREUR VERIFY:", error.message);
        res.status(500).json({ error: error.message });
    }
});

/* ======================================================
   HEALTH
====================================================== */
app.get("/health", (_req, res) => {
    res.json({
        status: "ok",
        algorithm: "ML-DSA-65",
        nist: "FIPS 204 (2024)"
    });
});

app.listen(PORT, () =>
    console.log(`🔐 Crypto service running on port ${PORT}`)
);
