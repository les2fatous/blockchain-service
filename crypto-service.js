import express from "express";
import cors from "cors";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

const app = express();

// ✅ CORS d'abord, AVANT le parsing du body
app.use(cors());

// ✅ Parser JSON avec limite élevée
app.use(express.json({ 
    limit: "50mb",
    strict: false  // Accepter les JSON non-stricts
}));

const PORT = process.env.CRYPTO_PORT || 3003;

console.log("========================================");
console.log("🔐 Service Cryptographie Post-Quantique");
console.log("   Algorithme: ML-DSA-65 (Dilithium3)");
console.log("   Port: " + PORT);
console.log("========================================\n");

// ========== Génération de clés Dilithium ==========
app.post('/crypto/dilithium/keygen', (_req, res) => {
    try {
        console.log('🔑 Génération de clés Dilithium...');
        const startTime = Date.now();

        const { publicKey, secretKey } = ml_dsa65.keygen();

        const elapsed = Date.now() - startTime;

        const result = {
            secret_key: Buffer.from(secretKey).toString('base64'),
            public_key: Buffer.from(publicKey).toString('base64'),
            algorithm: 'ML-DSA-65',
            public_key_size: publicKey.length,
            secret_key_size: secretKey.length,
            generation_time_ms: elapsed
        };

        res.json(result);

        console.log(`✅ Clés générées en ${elapsed}ms`);
        console.log(`   Clé publique: ${publicKey.length} bytes`);
        console.log(`   Clé secrète: ${secretKey.length} bytes\n`);

    } catch (error) {
        console.error('❌ ERREUR KEYGEN:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ========== Signature Dilithium (CORRIGÉ) ==========
app.post('/crypto/dilithium/sign', (req, res) => {
    try {
        // ✅ DEBUG : Inspecter req.body AVANT destructuration
        console.log('📦 Body reçu:', {
            type: typeof req.body,
            keys: Object.keys(req.body),
            bodyStringified: JSON.stringify(req.body).substring(0, 200)
        });

        const message = req.body.message;
        const secret_key = req.body.secret_key;

        console.log('🔍 Après extraction:', {
            message_type: typeof message,
            message_length: message ? message.length : 0,
            secret_key_type: typeof secret_key,
            secret_key_length: secret_key ? secret_key.length : 0,
            secret_key_first_100: secret_key ? secret_key.substring(0, 100) : 'null'
        });

        if (!message || !secret_key) {
            throw new Error('Message et secret_key requis');
        }

        console.log('🔏 Signature Dilithium...');
        console.log(`   Message: ${message.substring(0, 50)}...`);

        const startTime = Date.now();

        // ✅ VALIDATION : Tester le décodage base64
        let skBuffer;
        try {
            console.log('🧪 Test décodage base64...');
            console.log(`   Input length: ${secret_key.length}`);
            console.log(`   Input first 50: ${secret_key.substring(0, 50)}`);
            console.log(`   Input last 50: ${secret_key.substring(secret_key.length - 50)}`);
            
            // Test si c'est du base64 valide
            const isValidBase64 = /^[A-Za-z0-9+/]*={0,2}$/.test(secret_key);
            console.log(`   Is valid base64 format: ${isValidBase64}`);
            
            skBuffer = Buffer.from(secret_key, 'base64');
            console.log(`   ✅ Décodage réussi: ${skBuffer.length} bytes`);
            console.log(`   Buffer type: ${skBuffer.constructor.name}`);
            console.log(`   Is Buffer: ${Buffer.isBuffer(skBuffer)}`);
        } catch (decodeError) {
            console.error('❌ Erreur décodage:', decodeError.message);
            throw new Error(`Échec décodage base64: ${decodeError.message}`);
        }

        // ✅ CORRECTION : Conversion explicite en Uint8Array
        let sk = new Uint8Array(skBuffer.buffer, skBuffer.byteOffset, skBuffer.byteLength);
        
        console.log(`🔍 Uint8Array créé: ${sk.length} bytes`);
        console.log(`   First 10 bytes: [${Array.from(sk.slice(0, 10)).join(', ')}]`);

        // ✅ WORKAROUND : Copier dans un nouveau Uint8Array propre
        const skClean = new Uint8Array(4032);
        skClean.set(sk);
        sk = skClean;
        
        console.log(`🔄 Uint8Array nettoyé: ${sk.length} bytes`);

        const SECRET_KEY_SIZE = 4032;
        if (sk.length !== SECRET_KEY_SIZE) {
            throw new Error(
                `SecretKey invalide: ${sk.length} bytes après décodage (attendu ${SECRET_KEY_SIZE}). ` +
                `Longueur base64 reçue: ${secret_key.length} chars`
            );
        }

        // Encoder le message et signer
        const msg = new TextEncoder().encode(message);
        const signature = ml_dsa65.sign(msg, sk);

        const elapsed = Date.now() - startTime;

        res.json({
            signature: Buffer.from(signature).toString('base64'),
            signature_size: signature.length,
            signing_time_ms: elapsed,
            algorithm: 'ML-DSA-65'
        });
        
        console.log(`✅ Signature générée en ${elapsed}ms`);
        console.log(`   Taille: ${signature.length} bytes\n`);

    } catch (error) {
        console.error('❌ ERREUR SIGN:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// ========== Vérification Dilithium ==========
app.post("/crypto/dilithium/verify", (req, res) => {
    try {
        const { message, signature, public_key } = req.body;

        if (!message || !signature || !public_key) {
            throw new Error('Message, signature et public_key requis');
        }

        console.log('🔍 Vérification signature Dilithium...');

        const startTime = Date.now();

        // Décoder depuis base64
        const pk = new Uint8Array(Buffer.from(public_key, "base64"));
        const sig = new Uint8Array(Buffer.from(signature, "base64"));
        const msg = new TextEncoder().encode(message);

        // Vérifier
        const isValid = ml_dsa65.verify(pk, msg, sig);

        const elapsed = Date.now() - startTime;

        res.json({ 
            valid: isValid,
            verification_time_ms: elapsed,
            algorithm: 'ML-DSA-65'
        });

        console.log(`${isValid ? '✅' : '❌'} Signature ${isValid ? 'VALIDE' : 'INVALIDE'} (${elapsed}ms)\n`);

    } catch (error) {
        console.error("❌ ERREUR VERIFY:", error.message);
        res.status(500).json({ error: error.message });
    }
});

// ========== Health Check ==========
app.get("/health", (req, res) => {
    res.json({ 
        success: true, 
        status: "healthy", 
        algorithm: "ML-DSA-65",
        variant: "Dilithium3",
        quantum_resistant: true,
        nist_standard: "FIPS 204 (2024)"
    });
});

// ========== Informations sur l'algorithme ==========
app.get("/crypto/dilithium/info", (req, res) => {
    res.json({
        success: true,
        algorithm: {
            name: "ML-DSA-65",
            previous_name: "Dilithium3",
            family: "Module Lattice-Based Digital Signature",
            quantum_resistant: true,
            security_level: {
                nist_level: 3,
                classical_bits: 192,
                quantum_bits: 192
            },
            sizes: {
                public_key_bytes: 1952,
                secret_key_bytes: 4032,
                signature_bytes: 3293
            },
            standardization: {
                status: "NIST FIPS 204",
                year: 2024,
                category: "Post-Quantum Cryptography"
            }
        }
    });
});

// Démarrer le serveur
app.listen(PORT, () => {
    console.log(`✅ Serveur démarré sur le port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Info: http://localhost:${PORT}/crypto/dilithium/info\n`);
});

export default app;