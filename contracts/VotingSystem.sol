// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title VotingSystem
 * @dev Systeme de vote securise avec anonymisation et verifiabilite
 */
contract VotingSystem {
    
    // ========== STRUCTURES ==========
    
    struct Election {
        uint256 id;
        string title;
        uint256 startTime;
        uint256 endTime;
        bool isActive;
        bool isClosed;
        uint256 totalVotes;
        bytes32 candidatesMerkleRoot;
    }
    
    struct EncryptedVote {
        bytes32 voteHash;           // Hash unique du vote
        bytes encryptedBallot;      // Vote chiffre homomorphiquement
        bytes32 anonymousTokenHash; // Hash du token anonyme (blind signature)
        uint256 timestamp;
        uint256 blockNumber;
    }
    
    // ========== STOCKAGE ==========
    
    mapping(uint256 => Election) public elections;
    mapping(uint256 => mapping(bytes32 => EncryptedVote)) public votes; // electionId => voteHash => Vote
    mapping(uint256 => mapping(bytes32 => bool)) public usedTokens; // electionId => tokenHash => used
    mapping(uint256 => bytes32[]) private electionVoteHashes; // Liste des hash de votes par election
    
    address public electionAuthority;
    uint256 public electionCount;
    
    // ========== EVENEMENTS ==========
    
    event ElectionCreated(uint256 indexed electionId, string title, uint256 startTime, uint256 endTime);
    event ElectionOpened(uint256 indexed electionId);
    event ElectionClosed(uint256 indexed electionId, uint256 totalVotes);
    event VoteCast(uint256 indexed electionId, bytes32 indexed voteHash, uint256 timestamp);
    event TokenRegistered(uint256 indexed electionId, bytes32 indexed tokenHash);
    
    // ========== MODIFICATEURS ==========
    
    modifier onlyAuthority() {
        require(msg.sender == electionAuthority, "Seule l'autorite electorale est autorisee");
        _;
    }
    
    modifier electionExists(uint256 electionId) {
        require(elections[electionId].id == electionId, "L'election n'existe pas");
        _;
    }
    
    modifier electionActive(uint256 electionId) {
        Election storage election = elections[electionId];
        require(election.isActive, "Election pas active");
        require(block.timestamp >= election.startTime, "Election non encore ouverte");
        require(block.timestamp <= election.endTime, "Election terminee");
        require(!election.isClosed, "Election cloturee");
        _;
    }
    
    // ========== CONSTRUCTEUR ==========
    
    constructor() {
        electionAuthority = msg.sender;
        electionCount = 0;
    }
    
    // ========== GESTION DES ELECTIONS ==========
    
    function createElection(
        string memory title,
        uint256 startTime,
        uint256 endTime,
        bytes32 candidatesMerkleRoot
    ) external onlyAuthority returns (uint256) {
        require(startTime >= block.timestamp, "L'heure de debut doit etre dans le futur");
        require(endTime > startTime, "L'heure de fin doit etre posterieure a l'heure de debut");
        
        electionCount++;
        uint256 electionId = electionCount;
        
        elections[electionId] = Election({
            id: electionId,
            title: title,
            startTime: startTime,
            endTime: endTime,
            isActive: false,
            isClosed: false,
            totalVotes: 0,
            candidatesMerkleRoot: candidatesMerkleRoot
        });
        
        emit ElectionCreated(electionId, title, startTime, endTime);
        return electionId;
    }
    
    function openElection(uint256 electionId) 
        external 
        onlyAuthority 
        electionExists(electionId) 
    {
        Election storage election = elections[electionId];
        require(!election.isActive, "L'election est deja active");
        require(!election.isClosed, "L'election est deja cloturee");
        
        election.isActive = true;
        emit ElectionOpened(electionId);
    }
    
    function closeElection(uint256 electionId) 
        external 
        onlyAuthority 
        electionExists(electionId) 
    {
        Election storage election = elections[electionId];
        require(election.isActive, "L'election n'est pas active");
        require(!election.isClosed, "L'election est deja cloturee");
        
        election.isActive = false;
        election.isClosed = true;
        
        emit ElectionClosed(electionId, election.totalVotes);
    }
    
    // ========== SYSTEME DE TOKEN ANONYME (Signature aveugle) ==========
    
    function registerAnonymousToken(
        uint256 electionId,
        bytes32 tokenHash
    ) external onlyAuthority electionExists(electionId) {
        require(!usedTokens[electionId][tokenHash], "Le token est deja enregistre");
        
        usedTokens[electionId][tokenHash] = false;
        emit TokenRegistered(electionId, tokenHash);
    }
    
    // ========== VOTE (Scenario 3) ==========
    
    function castVote(
        uint256 electionId,
        bytes32 anonymousTokenHash,
        bytes memory encryptedBallot
    ) external electionActive(electionId) returns (bytes32) {
        
        require(usedTokens[electionId][anonymousTokenHash] == false, "Token deja utilise ou invalide");
        
        usedTokens[electionId][anonymousTokenHash] = true;
        
        bytes32 voteHash = keccak256(abi.encodePacked(
            electionId,
            anonymousTokenHash,
            encryptedBallot,
            block.timestamp,
            block.number
        ));
        
        require(votes[electionId][voteHash].voteHash == bytes32(0), "Collision du hachage du vote");
        
        votes[electionId][voteHash] = EncryptedVote({
            voteHash: voteHash,
            encryptedBallot: encryptedBallot,
            anonymousTokenHash: anonymousTokenHash,
            timestamp: block.timestamp,
            blockNumber: block.number
        });
        
        electionVoteHashes[electionId].push(voteHash);
        elections[electionId].totalVotes++;
        
        emit VoteCast(electionId, voteHash, block.timestamp);
        
        return voteHash;
    }
    
    // ========== VERIFICATION (Scenario 6) ==========
    
    function verifyVoteInclusion(
        uint256 electionId,
        bytes32 voteHash
    ) external view returns (
        bool exists,
        uint256 timestamp,
        uint256 blockNumber
    ) {
        EncryptedVote storage vote = votes[electionId][voteHash];
        
        return (
            vote.voteHash != bytes32(0),
            vote.timestamp,
            vote.blockNumber
        );
    }
    
    function getElectionVoteHashes(uint256 electionId) 
        external 
        view 
        returns (bytes32[] memory) 
    {
        return electionVoteHashes[electionId];
    }
    
    function getElection(uint256 electionId) 
        external 
        view 
        returns (
            string memory title,
            uint256 startTime,
            uint256 endTime,
            bool isActive,
            bool isClosed,
            uint256 totalVotes
        ) 
    {
        Election storage election = elections[electionId];
        return (
            election.title,
            election.startTime,
            election.endTime,
            election.isActive,
            election.isClosed,
            election.totalVotes
        );
    }
    
    function calculateVotesMerkleRoot(uint256 electionId) 
        external 
        view 
        returns (bytes32) 
    {
        bytes32[] memory voteHashes = electionVoteHashes[electionId];
        require(voteHashes.length > 0, "Aucun vote");
        
        return keccak256(abi.encodePacked(voteHashes));
    }
}
