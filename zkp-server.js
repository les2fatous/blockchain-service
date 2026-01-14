import express from "express";
import cors from "cors";
import * as snarkjs from "snarkjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildPoseidon } from "circomlibjs";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors());

const PORT = process.env.ZKP_PORT || 3002;

const TREE_DEPTH = 20;

let poseidon;
let verificationKey;

const PATHS = {
  wasm: path.join(__dirname, "zkp/build/voter_eligibility_js/voter_eligibility.wasm"),
  zkey: path.join(__dirname, "zkp/keys/voter_eligibility_final.zkey"),
  vkey: path.join(__dirname, "zkp/keys/verification_key.json"),
  proofsDir: path.join(__dirname, "zkp/proofs"),
  inputsDir: path.join(__dirname, "zkp/inputs"),
  outputsDir: path.join(__dirname, "zkp/outputs"),
};

function hashToPoseidonField(value) {
  const sha256Hash = crypto.createHash("sha256").update(String(value)).digest("hex");
  const bigInt = BigInt("0x" + sha256Hash);
  const field = bigInt % poseidon.F.p;
  const hashed = poseidon([field]);
  return poseidon.F.toString(hashed);
}

async function initialize() {
  console.log("🔐 Initialisation du serveur ZKP...\n");

  [PATHS.proofsDir, PATHS.inputsDir, PATHS.outputsDir].forEach((dir) => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  console.log("Chargement Poseidon...");
  poseidon = await buildPoseidon();
  console.log("✅ Poseidon chargé");

  if (fs.existsSync(PATHS.vkey)) {
    verificationKey = JSON.parse(fs.readFileSync(PATHS.vkey));
    console.log("✅ Clé de vérification chargée");
  } else {
    console.warn("⚠️ Clé de vérification absente");
  }

  console.log(`✅ Profondeur de l'arbre: ${TREE_DEPTH} niveaux (max ${Math.pow(2, TREE_DEPTH).toLocaleString()} feuilles)`);
  console.log(`\n✅ Serveur ZKP prêt sur le port ${PORT}\n`);
}

class MerkleTree {
  constructor(poseidonHashedLeaves) {
    if (!Array.isArray(poseidonHashedLeaves) || poseidonHashedLeaves.length === 0) {
      throw new Error("Feuilles invalides");
    }

    this.leaves = poseidonHashedLeaves.map(h => BigInt(h));
    
    console.log("\n🌳 Construction Merkle Tree:");
    console.log(`  - Total feuilles: ${this.leaves.length}`);
    console.log(`  - Profondeur max: ${TREE_DEPTH} niveaux`);
    console.log(`  - Première feuille: ${this.leaves[0].toString().slice(0, 30)}...`);
    
    this.tree = this.buildTree(this.leaves);
  }

  buildTree(leaves) {
    const tree = [leaves];
    let level = leaves;

    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] ?? level[i];
        const h = poseidon([left, right]);
        next.push(BigInt(poseidon.F.toString(h)));
      }
      tree.push(next);
      level = next;
    }

    console.log(`  - Root généré: ${tree[tree.length - 1][0].toString().slice(0, 30)}...`);
    return tree;
  }

  getRoot() {
    return this.tree[this.tree.length - 1][0].toString();
  }

  getProof(index) {
    const pathElements = [];
    const pathIndices = [];

    for (let level = 0; level < this.tree.length - 1; level++) {
      const isRight = index % 2;
      const siblingIndex = isRight ? index - 1 : index + 1;
      const layer = this.tree[level];
      const sibling = layer[siblingIndex] ?? layer[index];

      pathElements.push(sibling.toString());
      pathIndices.push(isRight);
      index = Math.floor(index / 2);
    }

    while (pathElements.length < TREE_DEPTH) {
      pathElements.push("0");
      pathIndices.push(0);
    }

    return { pathElements, pathIndices };
  }
}

app.get("/health", (_, res) => {
  res.json({
    success: true,
    status: "healthy",
    poseidon: !!poseidon,
    verificationKey: !!verificationKey,
    treeDepth: TREE_DEPTH,
    maxLeaves: Math.pow(2, TREE_DEPTH)
  });
});

app.post("/zkp/hash", (req, res) => {
  try {
    const { value } = req.body;
    
    if (!value) {
      throw new Error("Paramètre 'value' requis");
    }

    const hash = hashToPoseidonField(value);
    console.log(`🔐 Hash: ${String(value).slice(0, 10)}... → ${hash.slice(0, 30)}...`);

    res.json({ success: true, hash });
  } catch (err) {
    console.error("❌ Hash error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/zkp/generate-merkle-root", (req, res) => {
  try {
    const { leaves } = req.body;
    if (!Array.isArray(leaves) || leaves.length === 0)
      throw new Error("Paramètre 'leaves' requis");

    console.log(`\n🌳 Génération Merkle Root avec ${leaves.length} feuilles`);

    const tree = new MerkleTree(leaves);
    const root = tree.getRoot();

    console.log(`✅ Merkle Root: ${root.slice(0, 30)}...`);

    res.json({
      success: true,
      merkle_root: root,
      total_leaves: leaves.length,
      tree_depth: TREE_DEPTH
    });
  } catch (err) {
    console.error("❌", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/zkp/generate-proof", async (req, res) => {
  try {
    const { voterNationalId, voterSecret, leaves, electionId } = req.body;

    if (!voterNationalId || !voterSecret || !leaves || !electionId) {
      throw new Error("Paramètres manquants");
    }

    console.log("\n========== GÉNÉRATION PREUVE ZKP ==========");
    console.log("📥 Inputs:");
    console.log(`  - voterNationalId: ${voterNationalId.slice(0, 30)}...`);
    console.log(`  - Total leaves: ${leaves.length}`);

    const tree = new MerkleTree(leaves);
    const voterLeaf = BigInt(voterNationalId);

    console.log(`\n🔍 Recherche feuille: ${voterLeaf.toString().slice(0, 30)}...`);

    const index = tree.leaves.findIndex((leaf) => leaf === voterLeaf);
    
    console.log(`  - Index trouvé: ${index}`);
    
    if (index === -1) {
      console.log("  ❌ Feuille non trouvée!");
      return res.status(403).json({ 
        success: false, 
        error: "Électeur non éligible" 
      });
    }

    const proofPath = tree.getProof(index);
    const merkleRoot = tree.getRoot();

    console.log(`\n📊 Merkle Proof:`);
    console.log(`  - Root: ${merkleRoot.slice(0, 30)}...`);
    console.log(`  - Profondeur: ${TREE_DEPTH} niveaux`);

    // Vérification manuelle
    console.log(`\n🧪 Vérification manuelle:`);
    let currentHash = voterLeaf;
    
    for (let i = 0; i < proofPath.pathElements.length; i++) {
      const sibling = BigInt(proofPath.pathElements[i]);
      
      if (sibling.toString() === "0") {
        console.log(`  Level ${i}: [PADDING - hash inchangé]`);
        continue;
      }
      
      const isRight = proofPath.pathIndices[i];
      const left = isRight === 1 ? sibling : currentHash;
      const right = isRight === 1 ? currentHash : sibling;
      
      const hashed = poseidon([left, right]);
      currentHash = BigInt(poseidon.F.toString(hashed));
      
      console.log(`  Level ${i}: ${currentHash.toString().slice(0, 20)}...`);
    }

    const rootsMatch = currentHash.toString() === merkleRoot;
    console.log(`\n✅ Vérification: ${rootsMatch ? "ROOTS MATCH ✓" : "ROOTS MISMATCH ✗"}`);

    if (!rootsMatch) {
      return res.status(500).json({ 
        success: false, 
        error: "Merkle proof verification failed" 
      });
    }

    const voterSecretField = hashToPoseidonField(voterSecret);
    const electionField = hashToPoseidonField(electionId);

    const inputs = {
      voterNationalId: voterLeaf.toString(),
      voterSecret: voterSecretField,
      merkleRoot: merkleRoot,
      merklePathElements: proofPath.pathElements,
      merklePathIndices: proofPath.pathIndices,
      electionId: electionField,
    };

    console.log(`\n⏳ Génération ZKP avec Groth16...`);
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      PATHS.wasm,
      PATHS.zkey
    );

    console.log(`✅ Preuve générée!`);
    console.log(`  - Nullifier: ${publicSignals[0].slice(0, 30)}...`);
    console.log("========================================\n");

    res.json({
      success: true,
      proof,
      publicSignals: {
        nullifier: publicSignals[0],
        merkleRoot: publicSignals[1],
        electionId: publicSignals[2],
      },
    });
  } catch (err) {
    console.error("❌ Erreur:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/zkp/verify", async (req, res) => {
  try {
    const { proof, publicSignals } = req.body;
    
    console.log("\n🔍 Vérification ZKP...");
    console.log("📥 Inputs reçus:");
    console.log(`  - proof type: ${typeof proof}`);
    console.log(`  - publicSignals type: ${typeof publicSignals}`);

    // ========================================
    // ÉTAPE 1 : Convertir publicSignals en tableau
    // ========================================
    let signals;
    
    if (Array.isArray(publicSignals)) {
      signals = publicSignals;
    } else if (typeof publicSignals === 'object' && publicSignals !== null) {
      // Convertir objet {nullifier, merkleRoot, electionId} en tableau
      signals = [
        publicSignals.nullifier,
        publicSignals.merkleRoot,
        publicSignals.electionId
      ];
      console.log("📤 publicSignals converti en tableau:", signals.map(s => s.slice(0, 20) + "..."));
    } else {
      throw new Error("publicSignals doit être un tableau ou un objet");
    }

    // Vérifier que signals est bien un tableau
    if (!Array.isArray(signals)) {
      throw new Error("Impossible de convertir publicSignals en tableau");
    }

    console.log(`  - Nullifier: ${signals[0]?.slice(0, 20)}...`);
    console.log(`  - Merkle Root: ${signals[1]?.slice(0, 20)}...`);
    console.log(`  - Election ID: ${signals[2]?.slice(0, 20)}...`);

    // ========================================
    // ÉTAPE 2 : Vérifier et formater la preuve
    // ========================================
    
    // La preuve doit avoir cette structure exacte pour snarkjs :
    // {
    //   pi_a: [string, string, string],
    //   pi_b: [[string, string], [string, string], [string, string]],
    //   pi_c: [string, string, string],
    //   protocol: "groth16",
    //   curve: "bn128"
    // }

    if (!proof || typeof proof !== 'object') {
      throw new Error("Proof doit être un objet");
    }

    // Vérifier les champs obligatoires
    if (!proof.pi_a || !proof.pi_b || !proof.pi_c) {
      console.error("❌ Structure de preuve invalide:", JSON.stringify(proof).slice(0, 200));
      throw new Error("Proof doit contenir pi_a, pi_b et pi_c");
    }

    // S'assurer que la preuve a le bon format
    const formattedProof = {
      pi_a: proof.pi_a,
      pi_b: proof.pi_b,
      pi_c: proof.pi_c,
      protocol: proof.protocol || "groth16",
      curve: proof.curve || "bn128"
    };

    console.log("🔐 Preuve formatée:");
    console.log(`  - pi_a length: ${formattedProof.pi_a?.length}`);
    console.log(`  - pi_b length: ${formattedProof.pi_b?.length}`);
    console.log(`  - pi_c length: ${formattedProof.pi_c?.length}`);

    // ========================================
    // ÉTAPE 3 : Vérification avec snarkjs
    // ========================================
    console.log("⏳ Appel snarkjs.groth16.verify...");
    
    const valid = await snarkjs.groth16.verify(
      verificationKey, 
      signals, 
      formattedProof
    );
    
    console.log(valid ? "✅ Preuve valide" : "❌ Preuve invalide");

    res.json({ success: true, valid });
    
  } catch (err) {
    console.error("❌ Verify error:", err.message);
    console.error("Stack:", err.stack);
    
    // Logs détaillés pour debug
    console.error("\n🔍 Debug info:");
    console.error("  - verificationKey présente:", !!verificationKey);
    console.error("  - Proof reçu:", JSON.stringify(req.body.proof).slice(0, 300));
    console.error("  - PublicSignals reçu:", JSON.stringify(req.body.publicSignals).slice(0, 200));
    
    res.status(500).json({ 
      success: false, 
      error: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
  }
});

app.listen(PORT, async () => {
  await initialize();
});

export default app;