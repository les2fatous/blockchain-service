// test-step-by-step.js
const BLOCKCHAIN_API = 'http://localhost:3001';

async function test1_Health() {
    console.log('\n========================================');
    console.log('TEST 1 : SANTÉ DE LA BLOCKCHAIN');
    console.log('========================================\n');
    
    try {
        const response = await fetch(`${BLOCKCHAIN_API}/health`);
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ SUCCÈS !');
            console.log(`   - Block: ${result.besu.block_number}`);
            console.log(`   - Chain ID: ${result.besu.chain_id}`);
            console.log(`   - Contrat: ${result.contract.address}`);
            return true;
        }
        return false;
    } catch (error) {
        console.log('❌ ERREUR:', error.message);
        return false;
    }
}

async function diagnosticBlockTime() {
    console.log('\n========================================');
    console.log('DIAGNOSTIC : TEMPS BLOCKCHAIN');
    console.log('========================================\n');
    
    try {
        const response = await fetch('http://localhost:8545', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getBlockByNumber',
                params: ['latest', false],
                id: 1
            })
        });
        
        const result = await response.json();
        const blockTimestamp = parseInt(result.result.timestamp, 16);
        const now = Math.floor(Date.now() / 1000);
        const diff = blockTimestamp - now;
        
        console.log(`📅 Temps système: ${new Date(now * 1000).toLocaleString()}`);
        console.log(`⛓️  Temps blockchain: ${new Date(blockTimestamp * 1000).toLocaleString()}`);
        console.log(`⏱️  Différence: ${diff} secondes`);
        
        if (diff > 0) {
            console.log(`\n⚠️  La blockchain est ${diff}s en avance !`);
            console.log(`   Utilisez: startTime = now + ${diff + 60} pour être sûr\n`);
        } else {
            console.log('\n✅ Temps synchronisé\n');
        }
        
        return diff;
    } catch (error) {
        console.log('❌ ERREUR:', error.message);
        return 0;
    }
}


async function test2_CreateElection() {
    console.log('\n========================================');
    console.log('TEST 2 : CRÉER UNE ÉLECTION');
    console.log('========================================\n');
    
    try {
        const now = Math.floor(Date.now() / 1000);
        
        const electionData = {
            title: "Election Présidentielle Test",
            startTime: now + 120,  // ✅ Dans 2 minutes
            endTime: now + (7 * 24 * 3600),  // Dans 7 jours
            candidatesMerkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000"
        };
        
        console.log('📝 Données:');
        console.log(`   Titre: ${electionData.title}`);
        console.log(`   Début: ${new Date(electionData.startTime * 1000).toLocaleString()}`);
        console.log(`   Fin: ${new Date(electionData.endTime * 1000).toLocaleString()}`);
        console.log('\n⏰ L\'élection commencera dans 2 minutes\n');
        console.log('📤 Envoi de la requête...\n');
        
        const response = await fetch(`${BLOCKCHAIN_API}/election/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(electionData)
        });
        
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ SUCCÈS !');
            console.log(`   - Election ID: ${result.data.election_id}`);
            console.log(`   - TX Hash: ${result.data.tx_hash}`);
            console.log(`   - Block: ${result.data.block_number}`);
            return result.data.election_id;
        } else {
            console.log('\n❌ ÉCHEC !');
            return null;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return null;
    }
}

async function test3_GetElection(electionId) {
    console.log('\n========================================');
    console.log('TEST 3 : LIRE L\'ÉLECTION');
    console.log('========================================\n');
    
    try {
        console.log(`📖 Lecture de l'élection #${electionId}...\n`);
        
        const response = await fetch(`${BLOCKCHAIN_API}/election/${electionId}`);
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ SUCCÈS !');
            console.log(`   - Titre: ${result.data.title}`);
            console.log(`   - Active: ${result.data.is_active}`);
            console.log(`   - Fermée: ${result.data.is_closed}`);
            console.log(`   - Total votes: ${result.data.total_votes}`);
            console.log(`   - Début: ${new Date(result.data.start_time * 1000).toLocaleString()}`);
            console.log(`   - Fin: ${new Date(result.data.end_time * 1000).toLocaleString()}`);
            return true;
        } else {
            console.log('\n❌ ÉCHEC !');
            return false;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return false;
    }
}

// Modifier runTests pour ajouter test3
async function test4_OpenElection(electionId) {
    console.log('\n========================================');
    console.log('TEST 4 : OUVRIR L\'ÉLECTION');
    console.log('========================================\n');
    
    try {
        console.log(`🔓 Ouverture de l'élection #${electionId}...\n`);
        
        const response = await fetch(`${BLOCKCHAIN_API}/election/open`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ electionId: electionId })
        });
        
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ SUCCÈS !');
            console.log(`   - TX Hash: ${result.data.tx_hash}`);
            console.log(`   - Block: ${result.data.block_number}`);
            return true;
        } else {
            console.log('\n❌ ÉCHEC !');
            return false;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return false;
    }
}

async function test5_RegisterToken(electionId) {
    console.log('\n========================================');
    console.log('TEST 5 : ENREGISTRER UN TOKEN ANONYME');
    console.log('========================================\n');
    
    try {
        // Générer un token anonyme aléatoire (simulation)
        const randomToken = '0x' + Array.from({length: 64}, () => 
            Math.floor(Math.random() * 16).toString(16)
        ).join('');
        
        console.log('🎫 Génération d\'un token anonyme...');
        console.log(`   Token Hash: ${randomToken.substring(0, 20)}...`);
        console.log('\n📤 Enregistrement sur la blockchain...\n');
        
        const response = await fetch(`${BLOCKCHAIN_API}/token/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                electionId: electionId,
                tokenHash: randomToken
            })
        });
        
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ SUCCÈS !');
            console.log(`   - TX Hash: ${result.data.tx_hash}`);
            console.log(`   - Block: ${result.data.block_number}`);
            return randomToken; // Retourner le token pour le test de vote
        } else {
            console.log('\n❌ ÉCHEC !');
            return null;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return null;
    }
}

async function test6_CastVote(electionId, tokenHash) {
    console.log('\n========================================');
    console.log('TEST 6 : VOTER (ANONYME)');
    console.log('========================================\n');
    
    try {
        // Simuler un bulletin chiffré (vote pour candidat #1)
        const encryptedBallot = JSON.stringify({
            candidate_id: 1,
            election_id: electionId,
            timestamp: Date.now()
        });
        
        console.log('🗳️  Préparation du vote...');
        console.log(`   Election: #${electionId}`);
        console.log(`   Token: ${tokenHash.substring(0, 20)}...`);
        console.log(`   Bulletin (chiffré): ${encryptedBallot.substring(0, 50)}...`);
        console.log('\n📤 Envoi du vote sur la blockchain...\n');
        
        const response = await fetch(`${BLOCKCHAIN_API}/vote/cast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                electionId: electionId,
                anonymousTokenHash: tokenHash,
                encryptedBallot: encryptedBallot
            })
        });
        
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ SUCCÈS ! Vote enregistré de manière anonyme !');
            console.log(`   - Vote Hash: ${result.data.vote_hash}`);
            console.log(`   - TX Hash: ${result.data.tx_hash}`);
            console.log(`   - Block: ${result.data.block_number}`);
            console.log(`   - Timestamp: ${new Date(result.data.timestamp).toLocaleString()}`);
            return result.data.vote_hash; // Pour vérification
        } else {
            console.log('\n❌ ÉCHEC !');
            return null;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return null;
    }
}

async function test7_VerifyVote(electionId, voteHash) {
    console.log('\n========================================');
    console.log('TEST 7 : VÉRIFIER LE VOTE');
    console.log('========================================\n');
    
    try {
        console.log(`🔍 Vérification du vote ${voteHash.substring(0, 20)}...\n`);
        
        const response = await fetch(
            `${BLOCKCHAIN_API}/vote/verify/${voteHash}?electionId=${electionId}`
        );
        
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success && result.data.exists) {
            console.log('\n✅ VOTE VÉRIFIÉ !');
            console.log(`   - Existe: ${result.data.exists}`);
            console.log(`   - Block: ${result.data.block_number}`);
            console.log(`   - Timestamp: ${new Date(result.data.timestamp * 1000).toLocaleString()}`);
            return true;
        } else {
            console.log('\n❌ Vote non trouvé !');
            return false;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return false;
    }
}

async function test8_PreventDoubleVote(electionId, usedTokenHash) {
    console.log('\n========================================');
    console.log('TEST 8 : PRÉVENTION DU DOUBLE VOTE');
    console.log('========================================\n');
    
    try {
        console.log('🚫 Tentative de réutilisation du même token...\n');
        
        const encryptedBallot = JSON.stringify({
            candidate_id: 2,
            election_id: electionId,
            timestamp: Date.now()
        });
        
        const response = await fetch(`${BLOCKCHAIN_API}/vote/cast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                electionId: electionId,
                anonymousTokenHash: usedTokenHash,
                encryptedBallot: encryptedBallot
            })
        });
        
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (!result.success && result.error.includes('Token already used')) {
            console.log('\n✅ SUCCÈS ! Le double vote a été correctement bloqué !');
            return true;
        } else {
            console.log('\n❌ ÉCHEC ! Le double vote n\'a PAS été bloqué !');
            return false;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return false;
    }
}

async function test9_GetAllVoteHashes(electionId) {
    console.log('\n========================================');
    console.log('TEST 9 : LISTE DES VOTES (AUDIT)');
    console.log('========================================\n');
    
    try {
        console.log(`📊 Récupération de tous les votes de l'élection #${electionId}...\n`);
        
        // Vous devez ajouter cette route dans server.js
        const response = await fetch(`${BLOCKCHAIN_API}/election/${electionId}/votes`);
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ SUCCÈS !');
            console.log(`   - Total de votes: ${result.data.vote_hashes.length}`);
            console.log(`   - Premier vote: ${result.data.vote_hashes[0]?.substring(0, 20)}...`);
            return true;
        } else {
            console.log('\n❌ ÉCHEC !');
            return false;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return false;
    }
}

async function test10_CloseElection(electionId) {
    console.log('\n========================================');
    console.log('TEST 10 : FERMER L\'ÉLECTION');
    console.log('========================================\n');
    
    try {
        console.log(`🔒 Fermeture de l'élection #${electionId}...\n`);
        
        const response = await fetch(`${BLOCKCHAIN_API}/election/close`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ electionId: electionId })
        });
        
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ SUCCÈS ! Élection fermée !');
            console.log(`   - TX Hash: ${result.data.tx_hash}`);
            console.log(`   - Block: ${result.data.block_number}`);
            return true;
        } else {
            console.log('\n❌ ÉCHEC !');
            return false;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return false;
    }
}

async function test11_VoteAfterClose(electionId) {
    console.log('\n========================================');
    console.log('TEST 11 : VOTE APRÈS FERMETURE');
    console.log('========================================\n');
    
    try {
        console.log('🚫 Tentative de vote après fermeture...\n');
        
        // Nouveau token
        const newToken = '0x' + Array.from({length: 64}, () => 
            Math.floor(Math.random() * 16).toString(16)
        ).join('');
        
        // Enregistrer le token
        await fetch(`${BLOCKCHAIN_API}/token/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ electionId, tokenHash: newToken })
        });
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Tenter de voter
        const encryptedBallot = JSON.stringify({ candidate_id: 1 });
        
        const response = await fetch(`${BLOCKCHAIN_API}/vote/cast`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                electionId,
                anonymousTokenHash: newToken,
                encryptedBallot
            })
        });
        
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (!result.success && result.error.includes('closed')) {
            console.log('\n✅ SUCCÈS ! Le vote après fermeture a été bloqué !');
            return true;
        } else {
            console.log('\n❌ ÉCHEC ! Un vote après fermeture a été accepté !');
            return false;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return false;
    }
}

async function test12_MerkleRoot(electionId) {
    console.log('\n========================================');
    console.log('TEST 12 : MERKLE ROOT (VÉRIFIABILITÉ)');
    console.log('========================================\n');
    
    try {
        console.log(`🌳 Calcul du Merkle Root pour l'élection #${electionId}...\n`);
        
        // Ajoutez cette route dans server.js
        const response = await fetch(`${BLOCKCHAIN_API}/election/${electionId}/merkle-root`);
        const result = await response.json();
        
        console.log('Résultat:', JSON.stringify(result, null, 2));
        
        if (result.success) {
            console.log('\n✅ SUCCÈS !');
            console.log(`   - Merkle Root: ${result.data.merkle_root}`);
            console.log('\n💡 Ce hash peut être publié sur une blockchain publique');
            console.log('   pour garantir l\'intégrité des votes !');
            return true;
        } else {
            console.log('\n❌ ÉCHEC !');
            return false;
        }
    } catch (error) {
        console.log('\n❌ ERREUR:', error.message);
        return false;
    }
}

// Modifier runTests
async function runTests() {
    const test1 = await test1_Health();
    
    if (test1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const electionId = await test2_CreateElection();
        
        if (electionId) {
            await new Promise(resolve => setTimeout(resolve, 5000));
            await test3_GetElection(electionId);
            await new Promise(resolve => setTimeout(resolve, 2000));
            await test4_OpenElection(electionId);
            
            // Attendre que l'élection commence
            console.log('\n⏰ Attente que l\'élection commence...\n');
            await new Promise(resolve => setTimeout(resolve, 120000));
            
            const tokenHash = await test5_RegisterToken(electionId);
            
            if (tokenHash) {
                await new Promise(resolve => setTimeout(resolve, 2000));
                const voteHash = await test6_CastVote(electionId, tokenHash);
                
                if (voteHash) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await test7_VerifyVote(electionId, voteHash);
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await test8_PreventDoubleVote(electionId, tokenHash);
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await test9_GetAllVoteHashes(electionId);
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await test10_CloseElection(electionId);
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await test11_VoteAfterClose(electionId);
                    
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await test12_MerkleRoot(electionId);
                }
            }
        }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 TOUS LES TESTS TERMINÉS !');
    console.log('='.repeat(50));
}

runTests();