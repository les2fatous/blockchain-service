pragma circom 2.0.0;

include "../../node_modules/circomlib/circuits/poseidon.circom";
include "../../node_modules/circomlib/circuits/comparators.circom";

/**
 * Circuit ZKP pour prouver l'éligibilité d'un électeur
 * 
 * ✅ PROFONDEUR: 20 niveaux (supporte jusqu'à 1,048,576 électeurs)
 * ✅ GESTION PADDING: Les siblings à 0 sont ignorés (ne change pas le hash)
 * 
 * Cette profondeur est un excellent compromis :
 * - Assez grande pour tout système national
 * - Performance acceptable (~30-60s par preuve)
 * - Pas besoin de recompiler selon le nombre d'électeurs
 */
template VoterEligibility() {
    signal input voterNationalId;      // Hash Poseidon de l'ID national
    signal input voterSecret;          // Secret aléatoire (32+ bytes)
    signal input merklePathElements[20]; // Chemin Merkle (20 niveaux)
    signal input merklePathIndices[20];  // Indices (0=gauche, 1=droite)
    signal input merkleRoot;           // Racine de l'arbre Merkle
    signal input electionId;           // ID de l'élection
    signal output nullifier;           // Nullifier anti-double-vote
    
    // Vérifier inclusion dans l'arbre Merkle
    component merkleProof = MerkleTreeChecker(20);
    merkleProof.leaf <== voterNationalId;
    merkleProof.root <== merkleRoot;
    
    for (var i = 0; i < 20; i++) {
        merkleProof.pathElements[i] <== merklePathElements[i];
        merkleProof.pathIndices[i] <== merklePathIndices[i];
    }
    
    // Générer nullifier unique
    component nullifierHash = Poseidon(3);
    nullifierHash.inputs[0] <== voterNationalId;
    nullifierHash.inputs[1] <== voterSecret;
    nullifierHash.inputs[2] <== electionId;
    nullifier <== nullifierHash.out;
}

/**
 * Vérificateur d'arbre de Merkle avec gestion intelligente du padding
 * 
 * ✅ CRUCIAL: Si pathElements[i] == 0 (padding), on garde le hash actuel
 * au lieu de hasher (hash, 0) qui donnerait un résultat différent
 */
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    component selectors[levels];
    component hashers[levels];
    component isZero[levels];
    
    signal levelHashes[levels + 1];
    levelHashes[0] <== leaf;
    
    for (var i = 0; i < levels; i++) {
        // Détecter si c'est du padding (sibling = 0)
        isZero[i] = IsZero();
        isZero[i].in <== pathElements[i];
        
        // Sélectionner left/right selon pathIndices
        selectors[i] = Selector();
        selectors[i].left_input <== levelHashes[i];
        selectors[i].right_input <== pathElements[i];
        selectors[i].s <== pathIndices[i];
        
        // Hasher les deux valeurs
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== selectors[i].left;
        hashers[i].inputs[1] <== selectors[i].right;
        
        // ✅ LOGIQUE CRITIQUE:
        // Si isZero = 1 (padding): levelHashes[i+1] = levelHashes[i] (pas de changement)
        // Si isZero = 0 (valide):  levelHashes[i+1] = hashers[i].out (hash normal)
        // 
        // Formule: new = old + (hash - old) * (1 - isZero)
        // - Si isZero=1: new = old + 0 = old
        // - Si isZero=0: new = old + (hash - old) = hash
        levelHashes[i + 1] <== levelHashes[i] + (hashers[i].out - levelHashes[i]) * (1 - isZero[i].out);
    }
    
    // Vérifier que le hash final correspond au root
    root === levelHashes[levels];
}

/**
 * Sélecteur pour organiser left/right
 */
template Selector() {
    signal input left_input;
    signal input right_input;
    signal input s;  // 0 ou 1
    signal output left;
    signal output right;
    
    // Si s=0: left=left_input, right=right_input
    // Si s=1: left=right_input, right=left_input
    left <== left_input + (right_input - left_input) * s;
    right <== right_input + (left_input - right_input) * s;
}

component main {public [merkleRoot, electionId]} = VoterEligibility();