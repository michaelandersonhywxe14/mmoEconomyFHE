pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract MmoEconomyFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public providers;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;
    uint256 public cooldownSeconds = 60;

    bool public paused;

    uint256 public currentBatchId;
    bool public batchOpen;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    euint32 public totalResourceOutput;
    euint32 public priceIndex;
    euint32 public numSubmissionsInBatch;

    // Custom Errors
    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosed();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchState();
    error InvalidParameter();

    // Events
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event Paused(address account);
    event Unpaused(address account);
    event CooldownSet(uint256 oldCooldown, uint256 newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event ResourceDataSubmitted(address indexed provider, uint256 indexed batchId, euint32 encryptedResourceOutput, euint32 encryptedPriceIndex);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId, bytes32 stateHash);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 totalResourceOutput, uint256 priceIndex, uint256 numSubmissions);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidParameter();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function addProvider(address provider) external onlyOwner {
        if (provider == address(0)) revert InvalidParameter();
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        if (!providers[provider]) revert InvalidParameter();
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setCooldown(uint256 newCooldownSeconds) external onlyOwner {
        if (newCooldownSeconds == 0) revert InvalidParameter();
        emit CooldownSet(cooldownSeconds, newCooldownSeconds);
        cooldownSeconds = newCooldownSeconds;
    }

    function pause() external onlyOwner whenNotPaused {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert InvalidBatchState();
        currentBatchId++;
        batchOpen = true;
        numSubmissionsInBatch = FHE.asEuint32(0);

        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert InvalidBatchState();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitEncryptedData(euint32 encryptedResourceOutput, euint32 encryptedPriceIndex) external onlyProvider whenNotPaused {
        if (!batchOpen) revert BatchClosed();
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastSubmissionTime[msg.sender] = block.timestamp;

        _initIfNeeded(totalResourceOutput);
        _initIfNeeded(priceIndex);
        _initIfNeeded(numSubmissionsInBatch);

        totalResourceOutput = totalResourceOutput.add(encryptedResourceOutput);
        priceIndex = priceIndex.add(encryptedPriceIndex);
        numSubmissionsInBatch = numSubmissionsInBatch.add(FHE.asEuint32(1));

        emit ResourceDataSubmitted(msg.sender, currentBatchId, encryptedResourceOutput, encryptedPriceIndex);
    }

    function requestBatchDecryption() external onlyOwner whenNotPaused {
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) {
            revert CooldownActive();
        }
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        euint32[] memory cts = new euint32[](3);
        cts[0] = totalResourceOutput;
        cts[1] = priceIndex;
        cts[2] = numSubmissionsInBatch;

        bytes32 stateHash = _hashCiphertexts(cts);

        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: currentBatchId, stateHash: stateHash, processed: false });

        emit DecryptionRequested(requestId, currentBatchId, stateHash);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        // @dev Replay protection: ensure this callback hasn't been processed
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();

        // @dev State verification: ensure the contract state hasn't changed since the decryption request
        euint32[] memory cts = new euint32[](3);
        cts[0] = totalResourceOutput;
        cts[1] = priceIndex;
        cts[2] = numSubmissionsInBatch;
        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        // @dev Proof verification: ensure the decryption proof is valid
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode and finalize
        uint256 totalResourceOutputCleartext = abi.decode(cleartexts.slice(0, 32), (uint256));
        uint256 priceIndexCleartext = abi.decode(cleartexts.slice(32, 32), (uint256));
        uint256 numSubmissionsCleartext = abi.decode(cleartexts.slice(64, 32), (uint256));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, decryptionContexts[requestId].batchId, totalResourceOutputCleartext, priceIndexCleartext, numSubmissionsCleartext);
    }

    function _hashCiphertexts(euint32[] memory cts) internal pure returns (bytes32) {
        bytes32[3] memory b;
        for (uint i = 0; i < cts.length; i++) {
            b[i] = FHE.toBytes32(cts[i]);
        }
        return keccak256(abi.encode(b, address(this)));
    }

    function _initIfNeeded(euint32 storage x) internal {
        if (!FHE.isInitialized(x)) {
            x = FHE.asEuint32(0);
        }
    }

    function _requireInitialized(euint32 x) internal pure {
        if (!FHE.isInitialized(x)) revert InvalidParameter();
    }
}