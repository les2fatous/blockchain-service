// test-suite.js
// Suite de tests complète pour le système de vote blockchain

const LARAVEL_API = 'http://localhost:8000/api/v1';
const BLOCKCHAIN_API = 'http://localhost:3001';

// Variables globales pour stocker les tokens et IDs
let authToken = null;
let userId = null;
let electionId = null;
let candidateIds = [];

// ========== UTILITAIRES ==========

function log(emoji, message) {
    console.log(`${emoji} ${message}`);
}

function section(title) {
    console.log('\n' + '='.repeat(70));
    console.log(`  ${title}`);
    console.log('='.repeat(70) + '\n');
}

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ========== TESTS ==========

// TEST 1 : Inscription d'un électeur
async function testRegister() {
    section('TEST 1 : INSCRIPTION D\'UN ÉLECTEUR');
    
    try {
        const userData = {
            national_id: "SN20260001234",
            email: `voter${Date.now()}@test.com`,
            password: "Password123!",
            password_confirmation: "Password123!",
            first_name: "Jean",
            last_name: "Dupont",
            date_of_birth: "1990-01-15",
            phone: "+221771234567"
        };
        
        log('📝', 'Données d\'inscription :');
        console.log(`   Email: ${userData.email}`);
        console.log(`   ID National: ${userData.national_id}`);
        
        const response = await fetch(`${LARAVEL_API}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(userData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            authToken = result.data.token;
            userId = result.data.user.id;
            log('✅', 'Inscription réussie !');
            console.log(`   User ID: ${userId}`);
            console.log(`   Token: ${authToken.substring(0, 20)}...`);
            return true;
        } else {
            log('❌', `Erreur: ${result.message}`);
            return false;
        }
    } catch (error) {
        log('❌', `Erreur: ${error.message}`);
        return false;
    }
}

// TEST 2 : Connexion
async function testLogin() {
    section('TEST 2 : CONNEXION');
    
    try {
        const loginData = {
            email: "admin@vote.sn",
            password: "Admin123!"
        };
        
        log('🔐', 'Tentative de connexion...');
        console.log(`   Email: ${loginData.email}`);
        
        const response = await fetch(`${LARAVEL_API}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(loginData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            authToken = result.data.token;
            log('✅', 'Connexion réussie !');
            console.log(`   Rôle: ${result.data.user.role}`);
            console.log(`   Token: ${authToken.substring(0, 20)}...`);
            return true;
        } else {
            log('❌', `Erreur: ${result.message}`);
            return false;
        }
    } catch (error) {
        log('❌', `Erreur: ${error.message}`);
        return false;
    }
}

// TEST 3 : Créer une élection (Laravel + Blockchain)
async function testCreateElection() {
    section('TEST 3 : CRÉATION D\'UNE ÉLECTION');
    
    try {
        const now = new Date();
        const startDate = new Date(now.getTime() + 2 * 3600000); // +2h
        const endDate = new Date(now.getTime() + 7 * 24 * 3600000); // +7j
        
        const electionData = {
            title: `Election Test ${Date.now()}`,
            description: "Élection de test avec blockchain",
            start_date: startDate.toISOString().slice(0, 19).replace('T', ' '),
            end_date: endDate.toISOString().slice(0, 19).replace('T', ' ')
        };
        
        log('🗳️', 'Création de l\'élection...');
        console.log(`   Titre: ${electionData.title}`);
        console.log(`   Début: ${startDate.toLocaleString()}`);
        console.log(`   Fin: ${endDate.toLocaleString()}`);
        
        const response = await fetch(`${LARAVEL_API}/elections`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify(electionData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            electionId = result.data.id;
            log('✅', 'Élection créée dans Laravel !');
            console.log(`   ID: ${electionId}`);
            console.log(`   TX Hash: ${result.data.blockchain_tx_hash || 'N/A'}`);
            return true;
        } else {
            log('❌', `Erreur: ${result.message}`);
            return false;
        }
    } catch (error) {
        log('❌', `Erreur: ${error.message}`);
        return false;
    }
}

// TEST 4 : Ajouter des candidats
async function testAddCandidates() {
    section('TEST 4 : AJOUT DE CANDIDATS');
    
    const candidates = [
        { name: "Alice Martin", party: "Parti A", display_order: 1 },
        { name: "Bob Durand", party: "Parti B", display_order: 2 },
        { name: "Charlie Petit", party: "Parti C", display_order: 3 }
    ];
    
    try {
        for (const candidate of candidates) {
            log('➕', `Ajout de ${candidate.name}...`);
            
            const response = await fetch(`${LARAVEL_API}/elections/${electionId}/candidates`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(candidate)
            });
            
            const result = await response.json();
            
            if (result.success) {
                candidateIds.push(result.data.id);
                log('✅', `${candidate.name} ajouté (ID: ${result.data.id})`);
            } else {
                log('❌', `Erreur: ${result.message}`);
            }
            
            await wait(500); // Petite pause entre chaque candidat
        }
        
        return candidateIds.length === candidates.length;
    } catch (error) {
        log('❌', `Erreur: ${error.message}`);
        return false;
    }
}

// TEST 5 : Lister les élections
async function testListElections() {
    section('TEST 5 : LISTE DES ÉLECTIONS');
    
    try {
        log('📋', 'Récupération des élections...');
        
        const response = await fetch(`${LARAVEL_API}/elections`);
        const result = await response.json();
        
        if (result.success) {
            log('✅', `${result.data.length} élection(s) trouvée(s)`);
            result.data.slice(0, 3).forEach((election, index) => {
                console.log(`   ${index + 1}. ${election.title} (ID: ${election.id}, Status: ${election.status})`);
            });
            return true;
        } else {
            log('❌', `Erreur: ${result.message}`);
            return false;
        }
    } catch (error) {
        log('❌', `Erreur: ${error.message}`);
        return false;
    }
}

// TEST 6 : Vérifier la connexion blockchain
async function testBlockchainHealth() {
    section('TEST 6 : SANTÉ DE LA BLOCKCHAIN');
    
    try {
        log('🔗', 'Vérification de la connexion...');
        
        const response = await fetch(`${BLOCKCHAIN_API}/health`);
        const result = await response.json();
        
        if (result.success) {
            log('✅', 'Blockchain connectée !');
            console.log(`   Block Number: ${result.besu.block_number}`);
            console.log(`   Chain ID: ${result.besu.chain_id}`);
            console.log(`   Contract: ${result.contract.deployed ? result.contract.address : 'Non déployé'}`);
            return true;
        } else {
            log('❌', 'Blockchain non connectée');
            return false;
        }
    } catch (error) {
        log('❌', `Erreur: ${error.message}`);
        return false;
    }
}

// TEST 7 : Créer une élection directement sur la blockchain
async function testBlockchainElection() {
    section('TEST 7 : CRÉATION ÉLECTION SUR BLOCKCHAIN');
    
    try {
        const now = Math.floor(Date.now() / 1000);
        const electionData = {
            title: "Election Blockchain Test",
            startTime: now + 3600,
            endTime: now + (7 * 24 * 3600),
            candidatesMerkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000"
        };
        
        log('⛓️', 'Création sur la blockchain...');
        
        const response = await fetch(`${BLOCKCHAIN_API}/election/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(electionData)
        });
        
        const result = await response.json();
        
        if (result.success) {
            log('✅', 'Élection créée sur la blockchain !');
            console.log(`   Election ID: ${result.data.election_id}`);
            console.log(`   TX Hash: ${result.data.tx_hash}`);
            console.log(`   Block: ${result.data.block_number}`);
            return true;
        } else {
            log('❌', `Erreur: ${result.error}`);
            return false;
        }
    } catch (error) {
        log('❌', `Erreur: ${error.message}`);
        return false;
    }
}

// ========== EXÉCUTION DE LA SUITE ==========

async function runAllTests() {
    console.log('\n' + '█'.repeat(70));
    console.log('  🧪 SUITE DE TESTS COMPLÈTE - SYSTÈME DE VOTE BLOCKCHAIN');
    console.log('█'.repeat(70));
    
    const results = {
        total: 0,
        passed: 0,
        failed: 0
    };
    
    const tests = [
        { name: 'Santé Blockchain', fn: testBlockchainHealth },
        { name: 'Connexion Admin', fn: testLogin },
        { name: 'Création Élection', fn: testCreateElection },
        { name: 'Ajout Candidats', fn: testAddCandidates },
        { name: 'Liste Élections', fn: testListElections },
        { name: 'Élection Blockchain', fn: testBlockchainElection }
    ];
    
    for (const test of tests) {
        results.total++;
        const passed = await test.fn();
        if (passed) {
            results.passed++;
        } else {
            results.failed++;
        }
        await wait(1000);
    }
    
    // Résumé
    section('📊 RÉSUMÉ DES TESTS');
    console.log(`   Total: ${results.total}`);
    console.log(`   ✅ Réussis: ${results.passed}`);
    console.log(`   ❌ Échoués: ${results.failed}`);
    console.log(`   📈 Taux de réussite: ${Math.round((results.passed / results.total) * 100)}%`);
    console.log('');
}

// Exécuter
runAllTests().catch(console.error);