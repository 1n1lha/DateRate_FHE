pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract DateRateFHE is ZamaEthereumConfig {
    struct Feedback {
        euint32 encryptedScore;
        euint32 encryptedTags;
        uint256 timestamp;
        address submitter;
        bool isVerified;
        uint32 decryptedScore;
        uint32 decryptedTags;
    }

    struct UserProfile {
        euint32 encryptedRating;
        euint32 encryptedTagProfile;
        uint256 lastUpdated;
    }

    mapping(address => Feedback[]) private userFeedbacks;
    mapping(address => UserProfile) private userProfiles;
    mapping(address => bool) private feedbackSubmitted;

    event FeedbackSubmitted(address indexed user, uint256 timestamp);
    event FeedbackVerified(address indexed user, uint256 index, uint32 score, uint32 tags);
    event ProfileUpdated(address indexed user, uint256 timestamp);

    modifier onlyNewFeedback() {
        require(!feedbackSubmitted[msg.sender], "Feedback already submitted");
        _;
    }

    constructor() ZamaEthereumConfig() {}

    function submitFeedback(
        externalEuint32 encryptedScore,
        bytes calldata scoreProof,
        externalEuint32 encryptedTags,
        bytes calldata tagsProof
    ) external onlyNewFeedback {
        require(FHE.isInitialized(FHE.fromExternal(encryptedScore, scoreProof)), "Invalid encrypted score");
        require(FHE.isInitialized(FHE.fromExternal(encryptedTags, tagsProof)), "Invalid encrypted tags");

        Feedback memory feedback = Feedback({
            encryptedScore: FHE.fromExternal(encryptedScore, scoreProof),
            encryptedTags: FHE.fromExternal(encryptedTags, tagsProof),
            timestamp: block.timestamp,
            submitter: msg.sender,
            isVerified: false,
            decryptedScore: 0,
            decryptedTags: 0
        });

        FHE.allowThis(feedback.encryptedScore);
        FHE.allowThis(feedback.encryptedTags);
        FHE.makePubliclyDecryptable(feedback.encryptedScore);
        FHE.makePubliclyDecryptable(feedback.encryptedTags);

        userFeedbacks[msg.sender].push(feedback);
        feedbackSubmitted[msg.sender] = true;

        emit FeedbackSubmitted(msg.sender, block.timestamp);
    }

    function verifyFeedback(
        address user,
        uint256 index,
        bytes memory scoreProof,
        bytes memory tagsProof
    ) external {
        require(index < userFeedbacks[user].length, "Invalid feedback index");
        Feedback storage feedback = userFeedbacks[user][index];
        require(!feedback.isVerified, "Feedback already verified");

        bytes32[] memory scoreCts = new bytes32[](1);
        scoreCts[0] = FHE.toBytes32(feedback.encryptedScore);
        bytes memory scoreValue = FHE.decode(scoreCts, scoreProof);
        uint32 decryptedScore = abi.decode(scoreValue, (uint32));

        bytes32[] memory tagCts = new bytes32[](1);
        tagCts[0] = FHE.toBytes32(feedback.encryptedTags);
        bytes memory tagValue = FHE.decode(tagCts, tagsProof);
        uint32 decryptedTags = abi.decode(tagValue, (uint32));

        feedback.decryptedScore = decryptedScore;
        feedback.decryptedTags = decryptedTags;
        feedback.isVerified = true;

        _updateUserProfile(user, decryptedScore, decryptedTags);

        emit FeedbackVerified(user, index, decryptedScore, decryptedTags);
    }

    function _updateUserProfile(
        address user,
        uint32 score,
        uint32 tags
    ) private {
        if (userProfiles[user].encryptedRating == euint32.wrap(0)) {
            userProfiles[user] = UserProfile({
                encryptedRating: FHE.encrypt(score),
                encryptedTagProfile: FHE.encrypt(tags),
                lastUpdated: block.timestamp
            });
        } else {
            userProfiles[user].encryptedRating = FHE.add(
                userProfiles[user].encryptedRating,
                FHE.encrypt(score)
            );
            userProfiles[user].encryptedTagProfile = FHE.add(
                userProfiles[user].encryptedTagProfile,
                FHE.encrypt(tags)
            );
            userProfiles[user].lastUpdated = block.timestamp;
        }

        FHE.allowThis(userProfiles[user].encryptedRating);
        FHE.allowThis(userProfiles[user].encryptedTagProfile);

        emit ProfileUpdated(user, block.timestamp);
    }

    function getFeedback(
        address user,
        uint256 index
    ) external view returns (
        euint32 encryptedScore,
        euint32 encryptedTags,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedScore,
        uint32 decryptedTags
    ) {
        require(index < userFeedbacks[user].length, "Invalid feedback index");
        Feedback storage feedback = userFeedbacks[user][index];

        return (
            feedback.encryptedScore,
            feedback.encryptedTags,
            feedback.timestamp,
            feedback.isVerified,
            feedback.decryptedScore,
            feedback.decryptedTags
        );
    }

    function getFeedbackCount(address user) external view returns (uint256) {
        return userFeedbacks[user].length;
    }

    function getUserProfile(address user) external view returns (
        euint32 encryptedRating,
        euint32 encryptedTagProfile,
        uint256 lastUpdated
    ) {
        return (
            userProfiles[user].encryptedRating,
            userProfiles[user].encryptedTagProfile,
            userProfiles[user].lastUpdated
        );
    }

    function hasSubmittedFeedback(address user) external view returns (bool) {
        return feedbackSubmitted[user];
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


