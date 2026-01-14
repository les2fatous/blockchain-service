import express from "express";
import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// Charger les variables d'environnement
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// ========== CONFIGURATION ==========

const PORT = process.env.PORT || 3001;
const BESU_RPC_URL = process.env.BESU_RPC_URL || "http://127.0.0.1:8545";
const ADMIN_PRIVATE_KEY = process.env.ADMIN_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const GAS_LIMIT = parseInt(process.env.GAS_LIMIT || "8000000");

// Validation des variables obligatoires
if (!ADMIN_PRIVATE_KEY) {
  console.error("❌ ADMIN_PRIVATE_KEY manquante dans .env");
  process.exit(1);
}

if (!CONTRACT_ADDRESS) {
  console.error("❌ CONTRACT_ADDRESS manquante dans .env");
  process.exit(1);
}

// ========== SÉCURITÉ ==========

// Helmet pour les en-têtes de sécurité
app.use(helmet());

// CORS (restrictif)
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:8000'];
app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Non autorisé par CORS'));
    }
  }
}));

// Rate limiting (protection contre les abus)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // max 100 requêtes par IP
  message: { success: false, error: "Trop de requêtes, réessayez plus tard" }
});
app.use('/vote/cast', limiter); // Appliquer uniquement aux votes

// Body parser
app.use(express.json());

// ========== BLOCKCHAIN ==========

const provider = new ethers.JsonRpcProvider(BESU_RPC_URL);
let wallet;
let votingContract;

// ABI du Smart Contract
const VOTING_ABI = [
  "event ElectionCreated(uint256 indexed electionId, string title, uint256 startTime, uint256 endTime)",
  "event ElectionOpened(uint256 indexed electionId)",
  "event ElectionClosed(uint256 indexed electionId, uint256 totalVotes)",
  "event VoteCast(uint256 indexed electionId, bytes32 indexed voteHash, uint256 timestamp)",
  "event TokenRegistered(uint256 indexed electionId, bytes32 indexed tokenHash)",
  "function createElection(string memory title, uint256 startTime, uint256 endTime, bytes32 candidatesMerkleRoot) external returns (uint256)",
  "function openElection(uint256 electionId) external",
  "function closeElection(uint256 electionId) external",
  "function registerAnonymousToken(uint256 electionId, bytes32 tokenHash) external",
  "function castVote(uint256 electionId, bytes32 anonymousTokenHash, bytes memory encryptedBallot) external returns (bytes32)",
  "function verifyVoteInclusion(uint256 electionId, bytes32 voteHash) external view returns (bool exists, uint256 timestamp, uint256 blockNumber)",
  "function getElectionVoteHashes(uint256 electionId) external view returns (bytes32[] memory)",
  "function getElection(uint256 electionId) external view returns (string memory title, uint256 startTime, uint256 endTime, bool isActive, bool isClosed, uint256 totalVotes)",
  "function calculateVotesMerkleRoot(uint256 electionId) external view returns (bytes32)",
  "function electionAuthority() external view returns (address)",
  "function electionCount() external view returns (uint256)",
];

// ========== MIDDLEWARES ==========

// Logger
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// ========== VALIDATION ==========

function validateElectionData(title, startTime, endTime) {
  const errors = [];
  
  if (!title || title.trim().length < 3) {
    errors.push("Le titre doit contenir au moins 3 caractères");
  }
  
  if (title && title.length > 255) {
    errors.push("Le titre ne peut pas dépasser 255 caractères");
  }
  
  const now = Math.floor(Date.now() / 1000);
  
  if (!startTime || isNaN(startTime) || startTime <= now) {
    errors.push("L'heure de début doit être dans le futur");
  }
  
  if (!endTime || isNaN(endTime) || endTime <= startTime) {
    errors.push("L'heure de fin doit être postérieure à l'heure de début");
  }
  
  return errors;
}

function validateHash(hash) {
  if (!hash || typeof hash !== 'string') {
    return false;
  }
  return /^0x[a-fA-F0-9]{64}$/.test(hash);
}

// ========== ROUTES ==========

// Health check
app.get("/health", async (req, res) => {
  try {
    const blockNumber = await provider.getBlockNumber();
    const network = await provider.getNetwork();

    res.json({
      success: true,
      status: "healthy",
      timestamp: new Date().toISOString(),
      besu: {
        connected: true,
        block_number: blockNumber,
        chain_id: Number(network.chainId),
      },
      contract: {
        deployed: !!votingContract,
        address: CONTRACT_ADDRESS,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: "unhealthy",
      error: error.message,
    });
  }
});

// Créer une élection
app.post("/election/create", async (req, res) => {
  try {
    const { title, startTime, endTime, candidatesMerkleRoot } = req.body;

    // Validation
    const errors = validateElectionData(title, startTime, endTime);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: errors
      });
    }

    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: "Contrat non initialisé",
      });
    }

    const merkleRoot = candidatesMerkleRoot || ethers.ZeroHash;

    console.log(`📝 Création d'élection: "${title}"`);
    
    const tx = await votingContract.createElection(
      title,
      startTime,
      endTime,
      merkleRoot,
      { gasLimit: GAS_LIMIT }
    );
    
    console.log(`⏳ Transaction envoyée: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Confirmée au bloc ${receipt.blockNumber}`);

    // Extraire l'ID de l'élection depuis les events
    const event = receipt.logs.find((log) => {
      try {
        return votingContract.interface.parseLog(log)?.name === "ElectionCreated";
      } catch {
        return false;
      }
    });

    let electionId = null;
    if (event) {
      const parsed = votingContract.interface.parseLog(event);
      electionId = Number(parsed.args.electionId);
    }

    res.json({
      success: true,
      data: {
        election_id: electionId,
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber,
      },
    });
  } catch (error) {
    console.error("❌ Erreur création élection:", error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Lire une élection
app.get('/election/:electionId', async (req, res) => {
  try {
    const electionId = parseInt(req.params.electionId);
    
    if (isNaN(electionId) || electionId < 1) {
      return res.status(400).json({
        success: false,
        error: "ID d'élection invalide"
      });
    }
    
    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: 'Contrat non initialisé'
      });
    }
    
    const [title, startTime, endTime, isActive, isClosed, totalVotes] = 
      await votingContract.getElection(electionId);
    
    res.json({
      success: true,
      data: {
        election_id: electionId,
        title: title,
        start_time: Number(startTime),
        end_time: Number(endTime),
        is_active: isActive,
        is_closed: isClosed,
        total_votes: Number(totalVotes)
      }
    });
  } catch (error) {
    console.error('❌ Erreur lecture élection:', error.message);
    
    // Gestion des erreurs spécifiques
    if (error.message.includes("does not exist")) {
      return res.status(404).json({
        success: false,
        error: "Élection introuvable"
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Ouvrir une élection
app.post('/election/open', async (req, res) => {
  try {
    const { electionId } = req.body;
    
    if (!electionId || isNaN(electionId)) {
      return res.status(400).json({
        success: false,
        error: "ID d'élection invalide"
      });
    }
    
    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: 'Contrat non initialisé'
      });
    }
    
    console.log(`🔓 Ouverture de l'élection #${electionId}...`);
    
    const tx = await votingContract.openElection(electionId, { gasLimit: GAS_LIMIT });
    const receipt = await tx.wait();
    
    console.log(`✅ Élection ouverte au bloc ${receipt.blockNumber}`);
    
    res.json({
      success: true,
      data: {
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber
      }
    });
  } catch (error) {
    console.error('❌ Erreur ouverture élection:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Fermer une élection
app.post('/election/close', async (req, res) => {
  try {
    const { electionId } = req.body;
    
    if (!electionId || isNaN(electionId)) {
      return res.status(400).json({
        success: false,
        error: "ID d'élection invalide"
      });
    }
    
    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: 'Contrat non initialisé'
      });
    }
    
    console.log(`🔒 Fermeture de l'élection #${electionId}...`);
    
    const tx = await votingContract.closeElection(electionId, { gasLimit: GAS_LIMIT });
    const receipt = await tx.wait();
    
    console.log(`✅ Élection fermée au bloc ${receipt.blockNumber}`);
    
    res.json({
      success: true,
      data: {
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber
      }
    });
  } catch (error) {
    console.error('❌ Erreur fermeture élection:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enregistrer un token anonyme
app.post('/token/register', async (req, res) => {
  try {
    const { electionId, tokenHash } = req.body;
    
    // Validation
    if (!electionId || isNaN(electionId)) {
      return res.status(400).json({
        success: false,
        error: "ID d'élection invalide"
      });
    }
    
    if (!validateHash(tokenHash)) {
      return res.status(400).json({
        success: false,
        error: "Format de hash invalide (attendu: 0x + 64 caractères hexadécimaux)"
      });
    }
    
    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: 'Contrat non initialisé'
      });
    }
    
    console.log(`🎫 Enregistrement du token pour l'élection #${electionId}...`);
    
    const tx = await votingContract.registerAnonymousToken(
      electionId, 
      tokenHash,
      { gasLimit: GAS_LIMIT }
    );
    const receipt = await tx.wait();
    
    console.log(`✅ Token enregistré au bloc ${receipt.blockNumber}`);
    
    res.json({
      success: true,
      data: {
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber
      }
    });
  } catch (error) {
    console.error('❌ Erreur enregistrement token:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Voter
app.post("/vote/cast", async (req, res) => {
  try {
    const { electionId, anonymousTokenHash, encryptedBallot } = req.body;

    // Validation
    if (!electionId || isNaN(electionId)) {
      return res.status(400).json({
        success: false,
        error: "ID d'élection invalide"
      });
    }
    
    if (!validateHash(anonymousTokenHash)) {
      return res.status(400).json({
        success: false,
        error: "Format de hash de token invalide"
      });
    }
    
    if (!encryptedBallot || encryptedBallot.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: "Bulletin chiffré manquant"
      });
    }

    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: 'Contrat non initialisé'
      });
    }

    console.log(`🗳️  Vote pour l'élection #${electionId}...`);

    const ballotBytes = ethers.toUtf8Bytes(encryptedBallot);

    const tx = await votingContract.castVote(
      electionId,
      anonymousTokenHash,
      ballotBytes,
      { gasLimit: GAS_LIMIT }
    );
    
    console.log(`⏳ Transaction de vote: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`✅ Vote confirmé au bloc ${receipt.blockNumber}`);

    // Extraire le vote hash depuis les events
    const event = receipt.logs.find((log) => {
      try {
        return votingContract.interface.parseLog(log)?.name === "VoteCast";
      } catch {
        return false;
      }
    });

    let voteHash = null;
    if (event) {
      const parsed = votingContract.interface.parseLog(event);
      voteHash = parsed.args.voteHash;
    }

    res.json({
      success: true,
      data: {
        vote_hash: voteHash,
        tx_hash: receipt.hash,
        block_number: receipt.blockNumber,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    console.error("❌ Erreur lors du vote:", error.message);
    
    // Messages d'erreur plus explicites
    let errorMessage = error.message;
    
    if (error.message.includes("Token already used")) {
      errorMessage = "Ce token a déjà été utilisé pour voter";
    } else if (error.message.includes("Election not active")) {
      errorMessage = "L'élection n'est pas active";
    } else if (error.message.includes("Election closed")) {
      errorMessage = "L'élection est fermée";
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Vérifier un vote
app.get("/vote/verify/:voteHash", async (req, res) => {
  try {
    const { voteHash } = req.params;
    const { electionId } = req.query;

    // Validation
    if (!validateHash(voteHash)) {
      return res.status(400).json({
        success: false,
        error: "Format de hash de vote invalide"
      });
    }
    
    if (!electionId || isNaN(electionId)) {
      return res.status(400).json({
        success: false,
        error: "ID d'élection manquant ou invalide"
      });
    }

    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: 'Contrat non initialisé'
      });
    }

    const [exists, timestamp, blockNumber] =
      await votingContract.verifyVoteInclusion(electionId, voteHash);

    res.json({
      success: true,
      data: {
        exists,
        timestamp: Number(timestamp),
        block_number: Number(blockNumber),
      },
    });
  } catch (error) {
    console.error('❌ Erreur vérification vote:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Obtenir tous les votes d'une élection
app.get('/election/:electionId/votes', async (req, res) => {
  try {
    const electionId = parseInt(req.params.electionId);
    
    if (isNaN(electionId) || electionId < 1) {
      return res.status(400).json({
        success: false,
        error: "ID d'élection invalide"
      });
    }
    
    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: 'Contrat non initialisé'
      });
    }
    
    const voteHashes = await votingContract.getElectionVoteHashes(electionId);
    
    res.json({
      success: true,
      data: {
        election_id: electionId,
        vote_hashes: voteHashes,
        total_votes: voteHashes.length
      }
    });
  } catch (error) {
    console.error('❌ Erreur récupération votes:', error.message);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Calculer le Merkle Root
app.get('/election/:electionId/merkle-root', async (req, res) => {
  try {
    const electionId = parseInt(req.params.electionId);
    
    if (isNaN(electionId) || electionId < 1) {
      return res.status(400).json({
        success: false,
        error: "ID d'élection invalide"
      });
    }
    
    if (!votingContract) {
      return res.status(503).json({
        success: false,
        message: 'Contrat non initialisé'
      });
    }
    
    const merkleRoot = await votingContract.calculateVotesMerkleRoot(electionId);
    
    res.json({
      success: true,
      data: {
        election_id: electionId,
        merkle_root: merkleRoot
      }
    });
  } catch (error) {
    console.error('❌ Erreur calcul Merkle Root:', error.message);
    
    if (error.message.includes("No votes")) {
      return res.status(400).json({
        success: false,
        error: "Aucun vote pour cette élection"
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: "Route non trouvée"
  });
});

// Gestion globale des erreurs
app.use((err, req, res, next) => {
  console.error('❌ Erreur non gérée:', err);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? "Erreur interne du serveur" 
      : err.message
  });
});

// ========== INITIALISATION ==========

async function initialize() {
  try {
    console.log("🚀 Initialisation du microservice Blockchain...\n");

    // Test connexion Besu
    const blockNumber = await provider.getBlockNumber();
    const network = await provider.getNetwork();
    
    console.log("✅ Connecté à Besu");
    console.log(`   └─ Bloc actuel: ${blockNumber}`);
    console.log(`   └─ Chain ID: ${network.chainId}\n`);

    // Initialiser le wallet
    wallet = new ethers.Wallet(ADMIN_PRIVATE_KEY, provider);
    const balance = await provider.getBalance(wallet.address);
    
    console.log("✅ Wallet initialisé");
    console.log(`   └─ Adresse: ${wallet.address}`);
    console.log(`   └─ Balance: ${ethers.formatEther(balance)} ETH\n`);

    // Charger le contrat
    const contractPath = join(__dirname, 'smart-contracts', 'VotingSystem.json');
    
    if (!existsSync(contractPath)) {
      throw new Error(`Fichier ABI introuvable: ${contractPath}`);
    }
    
    const contractJson = JSON.parse(readFileSync(contractPath, 'utf8'));
    
    votingContract = new ethers.Contract(
      CONTRACT_ADDRESS,
      contractJson.abi,
      wallet
    );
    
    console.log("✅ Contrat chargé");
    console.log(`   └─ Adresse: ${CONTRACT_ADDRESS}\n`);

    // Vérifier que le contrat est bien déployé
    const authority = await votingContract.electionAuthority();
    console.log("✅ Contrat vérifié");
    console.log(`   └─ Autorité électorale: ${authority}\n`);

    // Démarrer le serveur
    app.listen(PORT, () => {
      console.log("═".repeat(60));
      console.log(`✅ Microservice Blockchain démarré sur le port ${PORT}`);
      console.log("═".repeat(60));
      console.log(`\n📡 Endpoints disponibles:`);
      console.log(`   • GET  /health`);
      console.log(`   • POST /election/create`);
      console.log(`   • GET  /election/:id`);
      console.log(`   • POST /election/open`);
      console.log(`   • POST /election/close`);
      console.log(`   • POST /token/register`);
      console.log(`   • POST /vote/cast`);
      console.log(`   • GET  /vote/verify/:voteHash`);
      console.log(`   • GET  /election/:id/votes`);
      console.log(`   • GET  /election/:id/merkle-root\n`);
      console.log(`🎉 Prêt à recevoir des requêtes!\n`);
    });
  } catch (error) {
    console.error("❌ Échec de l'initialisation:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Gestion de l'arrêt gracieux
process.on('SIGTERM', () => {
  console.log('\n  Signal SIGTERM reçu, arrêt gracieux...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\n Signal SIGINT reçu, arrêt gracieux...');
  process.exit(0);
});

// Démarrer
initialize();