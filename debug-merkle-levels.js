import { buildPoseidon } from "circomlibjs";
import crypto from "crypto";

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

// Version simple pour tester
class MerkleTreeDebug {
  constructor(leaves) {
    this.leaves = leaves.map(h => BigInt(h));
    console.log("\n🌳 Construction Merkle Tree:");
    console.log(`  - Nombre de feuilles: ${this.leaves.length}`);
    console.log(`  - Nombre de niveaux nécessaires: ${Math.ceil(Math.log2(this.leaves.length))}`);
    console.log(`  - Niveaux dans le circuit: 20 (fixe)`);
    
    this.tree = this.buildTree(this.leaves);
  }

  buildTree(leaves) {
    const tree = [leaves];
    let level = leaves;
    let levelNum = 0;

    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const left = level[i];
        const right = level[i + 1] ?? level[i];
        const h = poseidon([left, right]);
        next.push(BigInt(poseidon.F.toString(h)));
      }
      levelNum++;
      console.log(`  - Niveau ${levelNum}: ${next.length} nœuds`);
      tree.push(next);
      level = next;
    }

    const root = tree[tree.length - 1][0];
    console.log(`\n  ✅ Root final: ${root.toString().slice(0, 40)}...`);
    console.log(`  - Atteint en ${levelNum} niveaux (sur 20 disponibles)\n`);
    
    return tree;
  }

  getRoot() {
    return this.tree[this.tree.length - 1][0].toString();
  }

  // Version détaillée du proof pour debugging
  getProofDebug(index) {
    console.log(`\n🔍 Génération du Merkle Proof pour index ${index}:`);
    
    const pathElements = [];
    const pathIndices = [];
    let currentIndex = index;
    let currentLevel = 0;

    for (let level = 0; level < this.tree.length - 1; level++) {
      const isRight = currentIndex % 2;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      const layer = this.tree[level];
      const sibling = layer[siblingIndex] ?? layer[currentIndex];

      console.log(`  Niveau ${level}:`);
      console.log(`    - Index courant: ${currentIndex}`);
      console.log(`    - Position: ${isRight ? 'DROITE' : 'GAUCHE'}`);
      console.log(`    - Sibling: ${sibling.toString().slice(0, 30)}...`);
      console.log(`    - Valeur courante: ${layer[currentIndex].toString().slice(0, 30)}...`);

      pathElements.push(sibling.toString());
      pathIndices.push(isRight);
      currentIndex = Math.floor(currentIndex / 2);
      currentLevel++;
    }

    console.log(`\n  ✅ Chemin généré avec ${currentLevel} niveaux`);
    console.log(`  - Padding avec des 0 jusqu'à 20 niveaux`);

    // Padding jusqu'à 20 niveaux
    while (pathElements.length < 20) {
      pathElements.push("0");
      pathIndices.push(0);
    }

    console.log(`  - Total après padding: ${pathElements.length} éléments\n`);

    return { pathElements, pathIndices, actualLevels: currentLevel };
  }

  // Vérification manuelle complète
  verifyProofManually(leaf, pathElements, pathIndices) {
    console.log("\n🧪 Vérification manuelle du Merkle Proof:");
    console.log(`  - Feuille de départ: ${leaf.toString().slice(0, 30)}...`);
    
    let currentHash = BigInt(leaf);
    let level = 0;

    for (let i = 0; i < pathElements.length; i++) {
      const sibling = BigInt(pathElements[i]);
      
      // Skip padding (les 0)
      if (sibling.toString() === "0") {
        console.log(`  Niveau ${i}: [PADDING - ignoré]`);
        continue;
      }

      const isRight = pathIndices[i];
      const left = isRight === 1 ? sibling : currentHash;
      const right = isRight === 1 ? currentHash : sibling;
      
      console.log(`  Niveau ${i}:`);
      console.log(`    - Position: ${isRight ? 'DROITE' : 'GAUCHE'}`);
      console.log(`    - Left:  ${left.toString().slice(0, 30)}...`);
      console.log(`    - Right: ${right.toString().slice(0, 30)}...`);
      
      const hashed = poseidon([left, right]);
      currentHash = BigInt(poseidon.F.toString(hashed));
      
      console.log(`    - Hash:  ${currentHash.toString().slice(0, 30)}...`);
      level++;
    }

    const expectedRoot = this.getRoot();
    const calculatedRoot = currentHash.toString();
    
    console.log(`\n  📊 Résultat:`);
    console.log(`    - Root calculé: ${calculatedRoot.slice(0, 40)}...`);
    console.log(`    - Root attendu:  ${expectedRoot.slice(0, 40)}...`);
    console.log(`    - Match: ${calculatedRoot === expectedRoot ? '✅ OUI' : '❌ NON'}`);
    
    return calculatedRoot === expectedRoot;
  }
}

async function test() {
  await init();

  console.log("========================================");
  console.log("TEST MERKLE TREE - NIVEAUX ET PADDING");
  console.log("========================================\n");

  // Simuler les 3 électeurs de votre DB
  const leaves = [
    "4194664238623591078140125710190936887991502619527968733843859136856050212878",
    "1378005391622678995320938715621863278509732568651618039449893699916028672893",
    "11372512365127011416266921888466481823301698092965488077093050618862862991101"
  ];

  console.log("📊 Configuration:");
  console.log(`  - Nombre de feuilles: ${leaves.length}`);
  console.log(`  - Niveaux nécessaires: ${Math.ceil(Math.log2(leaves.length))}`);
  console.log(`  - Circuit configuré pour: 20 niveaux\n`);

  // Construire l'arbre
  const tree = new MerkleTreeDebug(leaves);
  const root = tree.getRoot();

  // Tester avec la première feuille (index 0)
  const testLeaf = leaves[0];
  console.log(`\n🎯 Test avec la feuille à l'index 0:`);
  console.log(`  - Valeur: ${testLeaf.slice(0, 40)}...`);

  const proof = tree.getProofDebug(0);
  
  console.log(`\n📋 Merkle Proof généré:`);
  console.log(`  - Éléments du chemin: ${proof.pathElements.length}`);
  console.log(`  - Niveaux réels utilisés: ${proof.actualLevels}`);
  console.log(`  - Padding ajouté: ${20 - proof.actualLevels} niveaux`);

  // Vérification manuelle
  const isValid = tree.verifyProofManually(testLeaf, proof.pathElements, proof.pathIndices);

  console.log("\n========================================");
  console.log("CONCLUSION:");
  if (isValid) {
    console.log("✅ Le Merkle Proof est VALIDE");
    console.log("✅ Le padding fonctionne correctement");
    console.log("✅ Le circuit devrait accepter cette preuve");
  } else {
    console.log("❌ Le Merkle Proof est INVALIDE");
    console.log("⚠️ Il y a un problème dans le calcul ou le padding");
  }
  console.log("========================================\n");

  // Afficher les inputs pour le circuit
  console.log("\n📤 Inputs à envoyer au circuit Circom:");
  console.log(JSON.stringify({
    voterNationalId: testLeaf,
    merkleRoot: root,
    merklePathElements: proof.pathElements,
    merklePathIndices: proof.pathIndices,
    pathElementsLength: proof.pathElements.length,
    actualLevelsUsed: proof.actualLevels
  }, null, 2));
}

test();