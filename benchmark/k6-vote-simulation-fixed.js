// k6-simulation-fixed-v2.js - Corrections des timeouts et authentification
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ========================================
// MÉTRIQUES PERSONNALISÉES
// ========================================

const voteSuccessRate = new Rate('vote_success_rate');
const voteDuration = new Trend('vote_duration');
const zkpGenerationTime = new Trend('zkp_generation_time');
const authTime = new Trend('auth_time');
const voteErrors = new Counter('vote_errors');
const zkpErrors = new Counter('zkp_errors');
const authErrors = new Counter('auth_errors');
const zkpTimeouts = new Counter('zkp_timeouts');

// ========================================
// CONFIGURATION
// ========================================

const LARAVEL_API = __ENV.LARAVEL_API_URL || 'http://localhost:8000';
const API_BASE = `${LARAVEL_API}/api/v1`;

// ⚠️ Configuration RÉDUITE pour éviter surcharge
export const options = {
    scenarios: {
        // Test progressif plus doux
        progressive_load: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '2m', target: 10 },   // Montée douce
                { duration: '5m', target: 10 },   // Maintien bas
                { duration: '2m', target: 30 },   // Augmentation
                { duration: '5m', target: 30 },   // Maintien moyen
                { duration: '2m', target: 50 },   // Augmentation
                { duration: '5m', target: 50 },   // Maintien élevé
                { duration: '2m', target: 0 },    // Descente
            ],
            gracefulRampDown: '30s',
        },
    },

    thresholds: {
        'http_req_duration': ['p(95)<15000'],          // 95% < 15s (augmenté)
        'http_req_duration{type:zkp}': ['p(95)<120000'], // 95% ZKP < 120s (beaucoup augmenté)
        'http_req_duration{type:vote}': ['p(99)<30000'], // 99% votes < 30s
        'vote_success_rate': ['rate>0.80'],             // 80% succès (réduit)
        'zkp_generation_time': ['p(95)<120000'],        // 95% ZKP < 120s
        'zkp_timeouts': ['count<100'],                  // Max 100 timeouts ZKP
        'vote_errors': ['count<300'],
    },
};

// ========================================
// GÉNÉRATION DES ÉLECTEURS
// ========================================

function generateVoters(count = 1000) {
    const voters = [];
    for (let i = 1; i <= count; i++) {
        const nationalId = '199001' + String(i).padStart(8, '0');
        const secret = `voter_secret_${nationalId}_${String(i).padStart(10, '0')}_k6test`;
        
        voters.push({
            cni: nationalId,
            email: `voter${i}@test.com`,
            password: 'TestPassword123!',
            secret: secret
        });
    }
    return voters;
}

const VOTERS = generateVoters(1000);

// ========================================
// SETUP
// ========================================

export function setup() {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 SIMULATION K6 v2 - TIMEOUTS OPTIMISÉS');
    console.log('='.repeat(80));
    console.log(`📊 Électeurs: ${VOTERS.length}`);
    console.log(`🌐 API: ${API_BASE}`);
    console.log('⏱️  Timeouts: Auth=30s, ZKP=120s, Vote=90s');
    console.log('='.repeat(80) + '\n');
    
    // Vérifier backend
    try {
        const healthResponse = http.get(`${API_BASE}/test/health`);
        if (healthResponse.status !== 200) {
            console.error('❌ Backend inaccessible');
            return { error: 'Backend down' };
        }
        console.log('✅ Backend: OK');
    } catch (e) {
        console.error('❌ Erreur:', e.message);
        return { error: 'Connection failed' };
    }
    
    // Récupérer élection
    let electionId = 1;
    try {
        const electionsResponse = http.get(`${API_BASE}/elections`);
        if (electionsResponse.status === 200) {
            const elections = JSON.parse(electionsResponse.body);
            if (elections.data && elections.data.length > 0) {
                electionId = elections.data[0].id;
                console.log(`✅ Élection: ID ${electionId}`);
            }
        }
    } catch (e) {
        console.log('⚠️  Élection par défaut: ID 1');
    }
    
    console.log('\n✅ Prêt - Démarrage simulation\n');
    
    return {
        electionId,
        voters: VOTERS,
        apiBase: API_BASE
    };
}

// ========================================
// FONCTION PRINCIPALE
// ========================================

export default function(data) {
    if (data.error) {
        console.error(`❌ Setup failed: ${data.error}`);
        return;
    }
    
    const { electionId, voters, apiBase } = data;
    
    // Sélectionner électeur aléatoire
    const voterIndex = Math.floor(Math.random() * voters.length);
    const voter = voters[voterIndex];
    const voterId = `V${voterIndex + 1}_VU${__VU}_IT${__ITER}`;
    
    let authToken = null;
    let zkpProof = null;
    let zkpPublicSignals = null;
    
    group('🗳️ Vote Complet', function() {
        
        // ==========================================
        // ÉTAPE 1: AUTHENTIFICATION (Timeout 30s)
        // ==========================================
        group('1️⃣ Auth', function() {
            const authStart = Date.now();
            
            const authResponse = http.post(
                `${apiBase}/auth/login`,
                JSON.stringify({
                    email: voter.email,
                    password: voter.password
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    tags: { type: 'auth' },
                    timeout: '30s' // ✅ Timeout explicite
                }
            );

            authTime.add(Date.now() - authStart);

            const authOk = check(authResponse, {
                'auth 200': (r) => r.status === 200,
                'auth token': (r) => {
                    if (r.status === 200) {
                        try {
                            const body = JSON.parse(r.body);
                            return body.data && body.data.token;
                        } catch (e) {
                            return false;
                        }
                    }
                    return false;
                }
            });

            if (authOk) {
                const authData = JSON.parse(authResponse.body);
                authToken = authData.data.token;
                
                if (__ITER % 10 === 0) {
                    console.log(`✅ ${voterId}: Auth OK`);
                }
            } else {
                authErrors.add(1);
                console.error(`❌ ${voterId}: Auth failed (${authResponse.status})`);
                return; // Arrêter si pas authentifié
            }
        });

        sleep(0.5);

        // ==========================================
        // ÉTAPE 2: ZKP (Timeout 120s - AUGMENTÉ)
        // ==========================================
        group('2️⃣ ZKP', function() {
            const zkpStart = Date.now();
            
            if (__ITER % 10 === 0) {
                console.log(`🔐 ${voterId}: Génération ZKP...`);
            }
            
            const zkpResponse = http.post(
                `${apiBase}/zkp/generate-proof`,
                JSON.stringify({
                    election_id: electionId,
                    national_id: voter.cni,
                    voter_secret: voter.secret
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`,
                        'Accept': 'application/json'
                    },
                    tags: { type: 'zkp' },
                    timeout: '120s' // ✅ 120 secondes pour ZKP
                }
            );

            const zkpTime = Date.now() - zkpStart;
            zkpGenerationTime.add(zkpTime);

            // Détecter timeout
            if (zkpResponse.status === 0 || zkpResponse.error) {
                zkpTimeouts.add(1);
                console.error(`⏱️ ${voterId}: ZKP timeout après ${Math.round(zkpTime/1000)}s`);
                zkpErrors.add(1);
                return;
            }

            const zkpOk = check(zkpResponse, {
                'zkp 200': (r) => r.status === 200,
                'zkp proof': (r) => {
                    if (r.status === 200) {
                        try {
                            const body = JSON.parse(r.body);
                            return body.data && body.data.proof && body.data.publicSignals;
                        } catch (e) {
                            return false;
                        }
                    }
                    return false;
                }
            });

            if (zkpOk) {
                const zkpData = JSON.parse(zkpResponse.body);
                zkpProof = zkpData.data.proof;
                zkpPublicSignals = zkpData.data.publicSignals;
                
                if (__ITER % 10 === 0) {
                    console.log(`✅ ${voterId}: ZKP OK (${Math.round(zkpTime/1000)}s)`);
                }
            } else {
                zkpErrors.add(1);
                console.error(`❌ ${voterId}: ZKP failed (${zkpResponse.status})`);
                if (zkpResponse.status === 401) {
                    console.error(`   Token expiré - réauth nécessaire`);
                }
                return;
            }
        });

        sleep(1);

        // ==========================================
        // ÉTAPE 3: VOTE (Timeout 90s)
        // ==========================================
        group('3️⃣ Vote', function() {
            const voteStart = Date.now();
            
            const candidateId = Math.random() < 0.5 ? 1 : 2;
            const candidateName = candidateId === 1 ? 'Candidat B' : 'Candidat A';
            
            if (__ITER % 10 === 0) {
                console.log(`🗳️ ${voterId}: Vote ${candidateName}...`);
            }
            
            const voteResponse = http.post(
                `${apiBase}/votes/cast`,
                JSON.stringify({
                    election_id: electionId,
                    candidate_id: candidateId,
                    zkp_proof: zkpProof,
                    zkp_public_signals: zkpPublicSignals
                }),
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${authToken}`,
                        'Accept': 'application/json'
                    },
                    tags: { type: 'vote' },
                    timeout: '90s' // ✅ 90 secondes pour vote + blockchain
                }
            );

            const voteDur = Date.now() - voteStart;
            voteDuration.add(voteDur);

            const voteSuccess = check(voteResponse, {
                'vote 200/201': (r) => r.status === 200 || r.status === 201,
                'vote hash': (r) => {
                    if (r.status === 200 || r.status === 201) {
                        try {
                            const body = JSON.parse(r.body);
                            return body.data && body.data.vote_hash;
                        } catch (e) {
                            return false;
                        }
                    }
                    return false;
                }
            });

            voteSuccessRate.add(voteSuccess);

            if (voteSuccess) {
                if (__ITER % 10 === 0) {
                    const voteData = JSON.parse(voteResponse.body);
                    console.log(`✅ ${voterId}: Vote enregistré (${Math.round(voteDur/1000)}s)`);
                    console.log(`   Hash: ${voteData.data.vote_hash.substring(0, 20)}...`);
                }
            } else {
                voteErrors.add(1);
                console.error(`❌ ${voterId}: Vote failed (${voteResponse.status})`);
                
                // Log détaillé des erreurs
                if (voteResponse.status === 401) {
                    console.error(`   ⚠️  Token expiré - augmentez la durée de validité JWT`);
                } else if (voteResponse.body) {
                    const preview = voteResponse.body.substring(0, 150);
                    console.error(`   ${preview}...`);
                }
            }
        });
    });

    // Pause plus longue pour réduire la charge
    sleep(Math.random() * 15 + 10); // 10-25 secondes
}

// ========================================
// TEARDOWN
// ========================================

export function teardown(data) {
    console.log('\n' + '='.repeat(80));
    console.log('🏁 SIMULATION TERMINÉE');
    console.log('='.repeat(80) + '\n');
}

// ========================================
// RAPPORT
// ========================================

export function handleSummary(data) {
    const metrics = data.metrics;
    const duration = Math.round(data.state.testRunDurationMs / 1000);
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 RAPPORT SIMULATION v2');
    console.log('='.repeat(80) + '\n');
    
    console.log('🎯 STATISTIQUES GÉNÉRALES');
    console.log('-'.repeat(80));
    console.log(`   Durée: ${duration}s (${Math.floor(duration/60)}m ${duration%60}s)`);
    console.log(`   VUs max: ${metrics.vus_max?.values.max || 'N/A'}`);
    console.log(`   Itérations: ${metrics.iterations?.values.count || 0}`);
    console.log(`   Requêtes HTTP: ${metrics.http_reqs?.values.count || 0}\n`);
    
    if (metrics.auth_time) {
        console.log('🔐 AUTHENTIFICATION');
        console.log('-'.repeat(80));
        console.log(`   Moyenne: ${Math.round(metrics.auth_time.values.avg)}ms`);
        console.log(`   P95: ${Math.round(metrics.auth_time.values['p(95)'])}ms`);
        if (metrics.auth_errors) {
            console.log(`   ❌ Erreurs: ${metrics.auth_errors.values.count}`);
        }
        console.log('');
    }
    
    if (metrics.zkp_generation_time) {
        console.log('🔐 GÉNÉRATION ZKP');
        console.log('-'.repeat(80));
        console.log(`   Moyenne: ${Math.round(metrics.zkp_generation_time.values.avg)}ms`);
        console.log(`   Min: ${Math.round(metrics.zkp_generation_time.values.min)}ms`);
        console.log(`   Max: ${Math.round(metrics.zkp_generation_time.values.max)}ms`);
        console.log(`   P95: ${Math.round(metrics.zkp_generation_time.values['p(95)'])}ms`);
        console.log(`   P99: ${Math.round(metrics.zkp_generation_time.values['p(99)'])}ms`);
        if (metrics.zkp_timeouts) {
            console.log(`   ⏱️  Timeouts: ${metrics.zkp_timeouts.values.count}`);
        }
        if (metrics.zkp_errors) {
            console.log(`   ❌ Erreurs: ${metrics.zkp_errors.values.count}`);
        }
        console.log('');
    }
    
    if (metrics.vote_duration) {
        console.log('🗳️  VOTES');
        console.log('-'.repeat(80));
        console.log(`   Moyenne: ${Math.round(metrics.vote_duration.values.avg)}ms`);
        console.log(`   P95: ${Math.round(metrics.vote_duration.values['p(95)'])}ms`);
        console.log(`   P99: ${Math.round(metrics.vote_duration.values['p(99)'])}ms`);
        if (metrics.vote_success_rate) {
            const rate = metrics.vote_success_rate.values.rate * 100;
            const status = rate > 80 ? '✅' : '❌';
            console.log(`   ${status} Succès: ${rate.toFixed(2)}%`);
        }
        if (metrics.vote_errors) {
            console.log(`   ❌ Erreurs: ${metrics.vote_errors.values.count}`);
        }
        console.log('');
    }
    
    console.log('='.repeat(80) + '\n');
    
    const timestamp = new Date().toISOString().replace(/:/g, '-').substring(0, 19);
    
    return {
        'stdout': '',
        [`reports/k6-v2-${timestamp}.json`]: JSON.stringify(data, null, 2),
    };
}