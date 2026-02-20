import { buildPoseidon } from 'circomlibjs';
import { ethers } from 'ethers';

export class MerkleTreeHelper {
    constructor() {
        this.poseidon = null;
        this.tree = null;
        this.leaves = [];
    }

    async initialize() {
        console.log('🌳 Initialisation du Merkle Tree Helper...');
        this.poseidon = await buildPoseidon();
        console.log('✅ Poseidon hash prêt');
    }

    /**
     * Hash Poseidon de deux éléments
     */
    hash(left, right) {
        const hash = this.poseidon([BigInt(left), BigInt(right)]);
        return this.poseidon.F.toString(hash);
    }

    /**
     * Convertit un hash hex en BigInt pour Poseidon
     */
    hexToBigInt(hex) {
        const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
        return BigInt('0x' + clean);
    }

    /**
     * Construit l'arbre de Merkle avec 20 niveaux
     * @param {Array<string>} voterIds - Liste des hash CNI des votants
     */
    buildTree(voterIds) {
        console.log(`\n🌳 Construction de l'arbre de Merkle...`);
        console.log(`   Votants: ${voterIds.length}`);
        
        const depth = 20;
        
        // Niveau 0: les feuilles (hash CNI des votants)
        this.leaves = voterIds.map(id => this.hexToBigInt(id).toString());
        this.tree = [this.leaves.slice()]; // Copie
        
        console.log(`   Profondeur: ${depth} niveaux`);
        console.log(`   Capacité max: ${Math.pow(2, depth).toLocaleString()} votants`);
        
        // Construire chaque niveau
        for (let level = 0; level < depth; level++) {
            const currentLevel = this.tree[level];
            const nextLevel = [];
            
            // Grouper par paires et hasher
            for (let i = 0; i < currentLevel.length; i += 2) {
                const left = currentLevel[i];
                const right = i + 1 < currentLevel.length ? currentLevel[i + 1] : '0';
                
                // Si right est 0 (padding), on garde left inchangé (comme dans le circuit)
                if (right === '0') {
                    nextLevel.push(left);
                } else {
                    nextLevel.push(this.hash(left, right));
                }
            }
            
            // Si le niveau est vide, ajouter un zéro
            if (nextLevel.length === 0) {
                nextLevel.push('0');
            }
            
            this.tree.push(nextLevel);
        }
        
        const root = this.tree[depth][0];
        console.log(`   ✅ Racine: 0x${BigInt(root).toString(16).padStart(64, '0')}`);
        
        return root;
    }

    /**
     * Obtient le chemin Merkle pour un votant
     * @param {number} leafIndex - Index du votant dans la liste
     */
    getMerklePath(leafIndex) {
        if (!this.tree || this.tree.length === 0) {
            throw new Error('Arbre de Merkle non construit');
        }
        
        if (leafIndex >= this.leaves.length) {
            throw new Error(`Index ${leafIndex} hors limites (max: ${this.leaves.length - 1})`);
        }
        
        const path = {
            elements: [],
            indices: []
        };
        
        let index = leafIndex;
        
        for (let level = 0; level < 20; level++) {
            const currentLevel = this.tree[level];
            const isLeft = index % 2 === 0;
            const siblingIndex = isLeft ? index + 1 : index - 1;
            
            // Obtenir le sibling (ou 0 si hors limites - padding)
            let sibling = '0';
            if (siblingIndex >= 0 && siblingIndex < currentLevel.length) {
                sibling = currentLevel[siblingIndex];
            }
            
            path.elements.push(sibling);
            path.indices.push(isLeft ? 0 : 1);
            
            // Monter au niveau suivant
            index = Math.floor(index / 2);
        }
        
        return path;
    }

    /**
     * Obtient la racine de l'arbre
     */
    getRoot() {
        if (!this.tree || this.tree.length === 0) {
            throw new Error('Arbre de Merkle non construit');
        }
        
        const root = this.tree[20][0];
        return '0x' + BigInt(root).toString(16).padStart(64, '0');
    }

    /**
     * Vérifie un chemin Merkle
     */
    verifyPath(leaf, path, root) {
        let currentHash = BigInt(leaf).toString();
        
        for (let i = 0; i < path.elements.length; i++) {
            const sibling = path.elements[i];
            const isLeft = path.indices[i] === 0;
            
            if (sibling === '0') {
                // Padding - pas de changement
                continue;
            }
            
            if (isLeft) {
                currentHash = this.hash(currentHash, sibling);
            } else {
                currentHash = this.hash(sibling, currentHash);
            }
        }
        
        return currentHash === BigInt(root).toString();
    }
}