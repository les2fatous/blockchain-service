import * as snarkjs from "snarkjs";
import { buildPoseidon } from "circomlibjs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let poseidon;

async function init() {
  poseidon = await buildPoseidon();
  console.log("✅ Poseidon chargé\n");
}

function hashToPoseidonField(value) {
  const sha256Hash = crypto.createHash("sha256").update(String(value)).digest("hex");
  const bigInt = BigInt("0x" + sha256Hash);
  const field = bigInt % poseidon.F.p;
  const hashed = poseidon([field]);
  return poseidon.F.toString(hashed);
}

class MerkleTree {
  constructor(leaves) {
    this.leaves = leaves.map(h => BigInt(h));
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

    while (pathElements.length < 10) {
      pathElements.push("0");
      pathIndices.push(0);
    }

    return { pathElements, pathIndices };
  }
}

async function testCircuit() {
  await init();

  console.log("========================================");
  console.log("TEST DIRECT DU CIRCUIT CIRCOM");
  console.log("========================================\n");

  // Les 3 hash de votre DB
  const leaves = [
    "4194664238623591078140125710190936887991502619527968733843859136856050212878",
    "1378005391622678995320938715621863278509732568651618039449893699916028672893",
    "11372512365127011416266921888466481823301698092965488077093050618862862991101"
  ];

  console.log("📊 Données de test:");
  console.log(`  - Nombre de feuilles: ${leaves.length}`);
  leaves.forEach((leaf, i) => {
    console.log(`  - Feuille ${i}: ${leaf.slice(0, 40)}...`);
  });

  // Construire l'arbre
  const tree = new MerkleTree(leaves);
  const merkleRoot = tree.getRoot();
  
  console.log(`\n🌳 Merkle Root: ${merkleRoot.slice(0, 40)}...`);

  // Prendre la première feuille pour le test
  const voterNationalId = leaves[0];
  const proof = tree.getProof(0);

  console.log(`\n🎯 Test avec la feuille 0:`);
  console.log(`  - voterNationalId: ${voterNationalId.slice(0, 40)}...`);
  console.log(`  - Index: 0`);

  // Préparer les inputs pour le circuit
  const voterSecret = hashToPoseidonField("test_secret_123");
  const electionId = hashToPoseidonField("1");

  const inputs = {
    voterNationalId: voterNationalId,
    voterSecret: voterSecret,
    merkleRoot: merkleRoot,
    merklePathElements: proof.pathElements,
    merklePathIndices: proof.pathIndices,
    electionId: electionId
  };

  console.log(`\n📤 Inputs préparés pour le circuit:`);
  console.log(`  - voterNationalId: ${inputs.voterNationalId.slice(0, 40)}...`);
  console.log(`  - voterSecret: ${inputs.voterSecret.slice(0, 40)}...`);
  console.log(`  - merkleRoot: ${inputs.merkleRoot.slice(0, 40)}...`);
  console.log(`  - electionId: ${inputs.electionId.slice(0, 40)}...`);
  console.log(`  - merklePathElements: [${inputs.merklePathElements.length} éléments]`);
  console.log(`  - merklePathIndices: [${inputs.merklePathIndices.join(', ')}]`);

  // Chemins vers les fichiers
  const WASM_PATH = path.join(__dirname, "zkp/build/voter_eligibility_js/voter_eligibility.wasm");
  const ZKEY_PATH = path.join(__dirname, "zkp/keys/voter_eligibility_final.zkey");

  console.log(`\n⏳ Génération de la preuve avec le circuit...`);
  console.log(`  - WASM: ${WASM_PATH}`);
  console.log(`  - ZKEY: ${ZKEY_PATH}`);

  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      inputs,
      WASM_PATH,
      ZKEY_PATH
    );

    console.log(`\n✅ SUCCÈS ! Preuve générée !`);
    console.log(`  - Nullifier: ${publicSignals[0].slice(0, 40)}...`);
    console.log(`  - Merkle Root (public): ${publicSignals[1].slice(0, 40)}...`);
    console.log(`  - Election ID (public): ${publicSignals[2].slice(0, 40)}...`);

    console.log("\n========================================");
    console.log("✅ LE CIRCUIT FONCTIONNE CORRECTEMENT !");
    console.log("========================================\n");

  } catch (error) {
    console.log(`\n❌ ERREUR lors de la génération de la preuve !`);
    console.log(`\nMessage d'erreur:`);
    console.log(error.message);
    
    console.log("\n========================================");
    console.log("DIAGNOSTIC:");
    
    if (error.message.includes("Assert Failed")) {
      console.log("❌ Assertion échouée dans le circuit");
      console.log("   → Le Merkle Root calculé ne correspond pas");
      console.log("\nPossibles causes:");
      console.log("1. Les feuilles ne sont pas dans le bon ordre");
      console.log("2. Le padding des pathElements est incorrect");
      console.log("3. Les pathIndices sont inversés");
      console.log("4. Un problème dans la construction de l'arbre");
    } else if (error.message.includes("not in field")) {
      console.log("❌ Une valeur n'est pas dans le field Poseidon");
      console.log("   → Vérifiez que tous les inputs sont des BigInt valides");
    } else {
      console.log("❌ Erreur inconnue");
    }
    
    console.log("========================================\n");
    
    throw error;
  }
}

testCircuit();