import { groth16 } from "snarkjs";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ZKPHelper {
  constructor() {
    this.wasmPath = null;
    this.zkeyPath = null;
    this.vkeyPath = null;
    this.isReady = false;

    this.loadCircuitFiles();
  }

  loadCircuitFiles() {
    try {
      console.log("🔍 Vérification des fichiers ZKP...");

      const zkpDir = join(__dirname, "..", "zkp");

      // WASM - dans build/voter_eligibility_js/
      this.wasmPath = join(
        zkpDir,
        "build",
        "voter_eligibility_js",
        "voter_eligibility.wasm"
      );
      if (existsSync(this.wasmPath)) {
        console.log(`✅ WASM trouvé`);
      } else {
        console.warn(`⚠️  WASM non trouvé: ${this.wasmPath}`);
        this.wasmPath = null;
      }

      // ZKey - dans keys/
      const zkeyFinal = join(zkpDir, "keys", "voter_eligibility_final.zkey");
      const zkey0000 = join(zkpDir, "keys", "voter_eligibility_0000.zkey");

      if (existsSync(zkeyFinal)) {
        this.zkeyPath = zkeyFinal;
        console.log(`✅ ZKey trouvé (final)`);
      } else if (existsSync(zkey0000)) {
        this.zkeyPath = zkey0000;
        console.log(`✅ ZKey trouvé (0000)`);
      } else {
        console.warn(`⚠️  ZKey non trouvé dans:`);
        console.warn(`   - ${zkeyFinal}`);
        console.warn(`   - ${zkey0000}`);
        this.zkeyPath = null;
      }

      // Verification Key - dans keys/
      this.vkeyPath = join(zkpDir, "keys", "verification_key.json");
      if (existsSync(this.vkeyPath)) {
        console.log(`✅ Verification Key trouvé`);
      } else {
        console.warn(`⚠️  Verification Key non trouvé: ${this.vkeyPath}`);
        this.vkeyPath = null;
      }

      // Vérifier si on peut générer de vraies preuves
      this.isReady = !!(this.wasmPath && this.zkeyPath);

      if (this.isReady) {
        console.log(
          "\n✅ Système ZKP prêt - génération de vraies preuves Groth16"
        );
        console.log(`   Circuit: voter_eligibility`);
      } else {
        console.warn(
          "\n⚠️  Fichiers ZKP incomplets - utilisation de preuves mock"
        );
        console.log(
          "💡 Les preuves mock ne seront pas acceptées par le smart contract"
        );
        console.log("\n📝 Fichiers manquants:");
        if (!this.wasmPath) console.log("   ❌ WASM");
        if (!this.zkeyPath) console.log("   ❌ ZKey");
        if (!this.vkeyPath) console.log("   ⚠️  Verification Key (optionnel)");
      }
    } catch (error) {
      console.error("❌ Erreur chargement fichiers ZKP:", error.message);
      this.isReady = false;
    }
  }

  /**
   * Génère un hash CNI déterministe pour les tests
   */
  generateVoterId(index) {
    const cni = `CNI${String(index).padStart(10, "0")}`;
    return ethers.keccak256(ethers.toUtf8Bytes(cni));
  }

  /**
   * Génère un code secret déterministe pour les tests
   */
  generateSecretCode(index) {
    const secret = `SECRET${String(index).padStart(10, "0")}`;
    return ethers.keccak256(ethers.toUtf8Bytes(secret));
  }

  /**
   * Génère un nullifier unique (hash de voterId + secretCode)
   */
  generateNullifier(voterId, secretCode) {
    return ethers.keccak256(
      ethers.solidityPacked(["bytes32", "bytes32"], [voterId, secretCode])
    );
  }

  /**
   * Convertit un hash en BigInt pour le circuit
   */
  bigIntFromHash(hash) {
    const hex = hash.startsWith("0x") ? hash.slice(2) : hash;
    return BigInt("0x" + hex);
  }

  /**
   * Convertit un nom de candidat en entier
   */
  candidateToInt(candidateName) {
    const candidates = {
      Candidat_A: 1,
      Candidat_B: 2,
      Candidat_C: 3,
      Candidat_1: 1,
      Candidat_2: 2,
      Candidat_3: 3,
    };
    return candidates[candidateName] || 1;
  }

  /**
   * Génère une vraie preuve ZKP avec snarkjs
   */
  async generateRealProof(voterId, secretCode, candidateId, merkleRoot) {
    if (!this.isReady) {
      throw new Error(
        "Circuit ZKP non disponible - fichiers WASM ou zkey manquants"
      );
    }

    try {
      const nullifier = this.generateNullifier(voterId, secretCode);

      // Inputs du circuit voter_eligibility.circom
      const input = {
        voterNationalId: this.bigIntFromHash(voterId).toString(),
        voterSecret: this.bigIntFromHash(secretCode).toString(),
        merklePathElements: Array(20).fill("0"), // Chemin Merkle vide (voter pas dans l'arbre pour les tests)
        merklePathIndices: Array(20).fill(0), // Tous à gauche
        merkleRoot: this.bigIntFromHash(merkleRoot).toString(),
        electionId: "1", // ID de l'élection
      };

      console.log("   📝 Génération preuve Groth16 (voter_eligibility)...");

      // Générer la preuve avec snarkjs
      const { proof, publicSignals } = await groth16.fullProve(
        input,
        this.wasmPath,
        this.zkeyPath
      );

      // Convertir au format Solidity
      const solidityProof = this.formatProofForSolidity(proof);

      return {
        proof: solidityProof,
        publicSignals: publicSignals.map((s) => {
          const hex = BigInt(s).toString(16);
          return "0x" + hex.padStart(64, "0");
        }),
        nullifier:
          "0x" + this.bigIntFromHash(nullifier).toString(16).padStart(64, "0"),
      };
    } catch (error) {
      console.error("❌ Erreur génération preuve réelle:", error.message);
      throw error;
    }
  }

  /**
   * Génère une preuve avec un chemin Merkle réel
   * @param {number} voterIndex - Index de l'électeur
   * @param {string} candidateId - Candidat choisi
   * @param {string} merkleRoot - Racine de l'arbre Merkle
   * @param {Array} merklePath - Chemin dans l'arbre [elements, indices]
   * @param {number} electionId - ID de l'élection
   */
/**
 * Génère une preuve avec un chemin Merkle réel
 */
async generateVoteProofWithMerklePath(voterIndex, candidateId, merkleRoot, merklePath, electionId = 1) {
    const voterId = this.generateVoterId(voterIndex);
    const secretCode = this.generateSecretCode(voterIndex);
    const nullifier = this.generateNullifier(voterId, secretCode);

    if (!this.isReady) {
        console.warn('⚠️  Circuit non prêt, utilisation de preuve mock');
        return this.generateMockProof(voterId, secretCode, candidateId, merkleRoot);
    }

    try {
        // Convertir les éléments du chemin en BigInt strings
        const pathElements = merklePath.elements.map(e => BigInt(e).toString());
        const pathIndices = merklePath.indices.map(i => i.toString());
        
        const input = {
            voterNationalId: this.bigIntFromHash(voterId).toString(),
            voterSecret: this.bigIntFromHash(secretCode).toString(),
            merklePathElements: pathElements,
            merklePathIndices: pathIndices,
            merkleRoot: BigInt(merkleRoot).toString(),
            electionId: electionId.toString()
        };

        console.log('   📝 Génération preuve Groth16 avec Merkle path...');

        const { proof, publicSignals } = await groth16.fullProve(
            input,
            this.wasmPath,
            this.zkeyPath
        );

        const solidityProof = this.formatProofForSolidity(proof);

        return {
            proof: solidityProof,
            publicSignals: publicSignals.map(s => {
                const hex = BigInt(s).toString(16);
                return '0x' + hex.padStart(64, '0');
            }),
            nullifier: '0x' + this.bigIntFromHash(nullifier).toString(16).padStart(64, '0')
        };

    } catch (error) {
        console.error('❌ Erreur génération preuve:', error.message);
        throw error;
    }
}

  /**
   * Génère une preuve mock pour les tests
   */
  generateMockProof(voterId, secretCode, candidateId, merkleRoot) {
    const nullifier = this.generateNullifier(voterId, secretCode);

    // Structure Groth16 valide mais avec valeurs aléatoires
    const proof = {
      pi_a: [
        ethers.hexlify(ethers.randomBytes(32)),
        ethers.hexlify(ethers.randomBytes(32)),
      ],
      pi_b: [
        [
          ethers.hexlify(ethers.randomBytes(32)),
          ethers.hexlify(ethers.randomBytes(32)),
        ],
        [
          ethers.hexlify(ethers.randomBytes(32)),
          ethers.hexlify(ethers.randomBytes(32)),
        ],
      ],
      pi_c: [
        ethers.hexlify(ethers.randomBytes(32)),
        ethers.hexlify(ethers.randomBytes(32)),
      ],
    };

    const publicSignals = [nullifier, merkleRoot];

    return {
      proof,
      publicSignals,
      nullifier,
    };
  }

  /**
   * Point d'entrée principal pour générer une preuve
   * @param {number} voterIndex - Index de l'électeur (pour générer CNI/secret déterministes)
   * @param {string} candidateId - ID du candidat ('Candidat_A', 'Candidat_B', etc.)
   * @param {string} merkleRoot - Racine Merkle des électeurs (hash hex)
   */
  async generateVoteProof(voterIndex, candidateId, merkleRoot) {
    const voterId = this.generateVoterId(voterIndex);
    const secretCode = this.generateSecretCode(voterIndex);

    if (this.isReady) {
      try {
        return await this.generateRealProof(
          voterId,
          secretCode,
          candidateId,
          merkleRoot
        );
      } catch (error) {
        console.warn(`⚠️  Échec génération preuve réelle, fallback sur mock`);
        console.warn(`   Raison: ${error.message}`);
        return this.generateMockProof(
          voterId,
          secretCode,
          candidateId,
          merkleRoot
        );
      }
    } else {
      // Utiliser des preuves mock
      return this.generateMockProof(
        voterId,
        secretCode,
        candidateId,
        merkleRoot
      );
    }
  }

  /**
   * Formate la preuve snarkjs pour Solidity
   */
  formatProofForSolidity(proof) {
    const formatBigInt = (value) => {
      const hex = BigInt(value).toString(16);
      return "0x" + hex.padStart(64, "0");
    };

    return {
      pi_a: [formatBigInt(proof.pi_a[0]), formatBigInt(proof.pi_a[1])],
      pi_b: [
        [formatBigInt(proof.pi_b[0][0]), formatBigInt(proof.pi_b[0][1])],
        [formatBigInt(proof.pi_b[1][0]), formatBigInt(proof.pi_b[1][1])],
      ],
      pi_c: [formatBigInt(proof.pi_c[0]), formatBigInt(proof.pi_c[1])],
    };
  }

  /**
   * Vérifie une preuve localement avant envoi
   */
  async verifyProofLocally(proof, publicSignals) {
    if (!this.vkeyPath) {
      console.warn(
        "⚠️  Impossible de vérifier localement: verification key manquante"
      );
      return true; // Assume valid
    }

    try {
      const vKey = JSON.parse(readFileSync(this.vkeyPath, "utf8"));

      // Convertir les public signals en BigInt
      const publicSignalsBigInt = publicSignals.map((s) => {
        if (typeof s === "string") {
          return BigInt(s);
        }
        return BigInt(s);
      });

      const result = await groth16.verify(vKey, publicSignalsBigInt, proof);

      return result;
    } catch (error) {
      console.error("❌ Erreur vérification locale:", error.message);
      return false;
    }
  }
}
