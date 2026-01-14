// test-election.js
// Script pour tester la création d'une élection sur la blockchain

const BASE_URL = 'http://localhost:3001';

async function testCreateElection() {
    console.log('🗳️  TEST : Création d\'une élection sur la blockchain\n');
    
    try {
        // 1. Préparer les données
        const now = Math.floor(Date.now() / 1000);
        const startTime = now + 3600; // Dans 1 heure
        const endTime = now + (7 * 24 * 3600); // Dans 7 jours
        
        const electionData = {
            title: "Election Présidentielle 2026",
            startTime: startTime,
            endTime: endTime,
            candidatesMerkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000"
        };
        
        console.log('📋 Données de l\'élection :');
        console.log(`   Titre: ${electionData.title}`);
        console.log(`   Début: ${new Date(startTime * 1000).toLocaleString()}`);
        console.log(`   Fin: ${new Date(endTime * 1000).toLocaleString()}`);
        console.log('');
        
        // 2. Envoyer la requête
        console.log('📤 Envoi de la requête...');
        const response = await fetch(`${BASE_URL}/election/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(electionData)
        });
        
        const result = await response.json();
        
        // 3. Afficher le résultat
        if (result.success) {
            console.log('✅ SUCCÈS ! Élection créée sur la blockchain\n');
            console.log('📊 Détails :');
            console.log(`   Election ID: ${result.data.election_id}`);
            console.log(`   Transaction Hash: ${result.data.tx_hash}`);
            console.log(`   Block Number: ${result.data.block_number}`);
            console.log('');
            
            // 4. Vérifier l'élection
            await verifyElection(result.data.election_id);
            
        } else {
            console.error('❌ ERREUR :', result.error || result.message);
        }
        
    } catch (error) {
        console.error('❌ ERREUR lors de la requête :', error.message);
    }
}

async function verifyElection(electionId) {
    console.log(`🔍 Vérification de l'élection #${electionId}...\n`);
    
    try {
        const response = await fetch(`${BASE_URL}/election/${electionId}`);
        const result = await response.json();
        
        if (result.success) {
            console.log('✅ Élection vérifiée !');
            console.log(`   Titre: ${result.data.title}`);
            console.log(`   Active: ${result.data.is_active}`);
            console.log(`   Fermée: ${result.data.is_closed}`);
            console.log(`   Total votes: ${result.data.total_votes}`);
        } else {
            console.error('❌ Erreur lors de la vérification');
        }
        
    } catch (error) {
        console.error('❌ Erreur:', error.message);
    }
}

// Exécuter le test
console.log('='.repeat(60));
console.log('TEST DU SMART CONTRACT - CRÉATION D\'ÉLECTION');
console.log('='.repeat(60));
console.log('');

testCreateElection();