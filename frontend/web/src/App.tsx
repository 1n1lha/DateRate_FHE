import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface DateFeedback {
  id: number;
  partnerName: string;
  dateScore: string;
  tags: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [feedbacks, setFeedbacks] = useState<DateFeedback[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingFeedback, setCreatingFeedback] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newFeedbackData, setNewFeedbackData] = useState({ 
    partnerName: "", 
    score: "", 
    tags: "" 
  });
  const [selectedFeedback, setSelectedFeedback] = useState<DateFeedback | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [showFAQ, setShowFAQ] = useState(false);
  const [userHistory, setUserHistory] = useState<DateFeedback[]>([]);
  const [stats, setStats] = useState({
    total: 0,
    verified: 0,
    averageScore: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized) return;
      try {
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      }
    };
    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      try {
        await loadData();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };
    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const feedbacksList: DateFeedback[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          feedbacksList.push({
            id: parseInt(businessId.replace('feedback-', '')) || Date.now(),
            partnerName: businessData.name,
            dateScore: businessId,
            tags: businessId,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setFeedbacks(feedbacksList);
      updateStats(feedbacksList);
      if (address) {
        setUserHistory(feedbacksList.filter(f => f.creator.toLowerCase() === address.toLowerCase()));
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (data: DateFeedback[]) => {
    const total = data.length;
    const verified = data.filter(f => f.isVerified).length;
    const average = data.length > 0 ? data.reduce((sum, f) => sum + f.publicValue1, 0) / data.length : 0;
    setStats({ total, verified, averageScore: parseFloat(average.toFixed(1)) });
  };

  const createFeedback = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingFeedback(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating feedback with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const scoreValue = parseInt(newFeedbackData.score) || 0;
      const businessId = `feedback-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, scoreValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newFeedbackData.partnerName,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newFeedbackData.score) || 0,
        0,
        newFeedbackData.tags
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Feedback created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewFeedbackData({ partnerName: "", score: "", tags: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingFeedback(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractRead.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      return Number(clearValue);
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      const available = await contract.isAvailable();
      if (available) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract is available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredFeedbacks = feedbacks.filter(feedback => {
    const matchesSearch = feedback.partnerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         feedback.tags.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = activeFilter === "all" || 
                         (activeFilter === "verified" && feedback.isVerified) ||
                         (activeFilter === "pending" && !feedback.isVerified);
    return matchesSearch && matchesFilter;
  });

  const renderStats = () => (
    <div className="stats-grid">
      <div className="stat-card neon-purple">
        <h3>Total Feedbacks</h3>
        <div className="stat-value">{stats.total}</div>
        <div className="stat-trend">Encrypted Reviews</div>
      </div>
      <div className="stat-card neon-blue">
        <h3>Verified Data</h3>
        <div className="stat-value">{stats.verified}/{stats.total}</div>
        <div className="stat-trend">FHE Verified</div>
      </div>
      <div className="stat-card neon-pink">
        <h3>Avg Score</h3>
        <div className="stat-value">{stats.averageScore}/10</div>
        <div className="stat-trend">Quality Rating</div>
      </div>
    </div>
  );

  const renderUserHistory = () => (
    <div className="history-section">
      <h3>Your Rating History</h3>
      <div className="history-list">
        {userHistory.length === 0 ? (
          <p className="no-history">No rating history found</p>
        ) : (
          userHistory.map((feedback, index) => (
            <div key={index} className="history-item">
              <span className="partner-name">{feedback.partnerName}</span>
              <span className={`score ${feedback.isVerified ? 'verified' : ''}`}>
                {feedback.isVerified ? `Score: ${feedback.decryptedValue}/10 ✅` : 'Encrypted'}
              </span>
              <span className="date">{new Date(feedback.timestamp * 1000).toLocaleDateString()}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );

  const renderFAQ = () => (
    <div className="faq-section">
      <h3>FHE Dating Feedback FAQ</h3>
      <div className="faq-list">
        <div className="faq-item">
          <h4>How does FHE protect my privacy?</h4>
          <p>Your ratings are encrypted using Zama FHE technology, ensuring only you can decrypt and verify them while maintaining privacy.</p>
        </div>
        <div className="faq-item">
          <h4>What data is encrypted?</h4>
          <p>Only the numerical rating score (1-10) is FHE encrypted. Partner names and tags remain public for reference.</p>
        </div>
        <div className="faq-item">
          <h4>How does verification work?</h4>
          <p>Click "Verify" to perform offline decryption and on-chain verification using FHE cryptographic proofs.</p>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>DateRate 🔐</h1>
            <p>Confidential Dating Feedback</p>
          </div>
          <ConnectButton />
        </header>
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">💕</div>
            <h2>Connect Your Wallet to Continue</h2>
            <p>Please connect your wallet to access encrypted dating feedback system.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted dating system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>DateRate 🔐</h1>
          <p>Confidential Dating Feedback</p>
        </div>
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">Test Contract</button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">+ New Feedback</button>
          <ConnectButton />
        </div>
      </header>

      <div className="main-content">
        {renderStats()}
        
        <div className="controls-section">
          <div className="search-filter">
            <input 
              type="text" 
              placeholder="Search partners or tags..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <div className="filter-buttons">
              <button 
                className={activeFilter === "all" ? "active" : ""}
                onClick={() => setActiveFilter("all")}
              >All</button>
              <button 
                className={activeFilter === "verified" ? "active" : ""}
                onClick={() => setActiveFilter("verified")}
              >Verified</button>
              <button 
                className={activeFilter === "pending" ? "active" : ""}
                onClick={() => setActiveFilter("pending")}
              >Pending</button>
            </div>
          </div>
          <div className="action-buttons">
            <button onClick={loadData} disabled={isRefreshing} className="refresh-btn">
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
            <button onClick={() => setShowFAQ(!showFAQ)} className="faq-btn">
              {showFAQ ? "Hide FAQ" : "Show FAQ"}
            </button>
          </div>
        </div>

        {showFAQ && renderFAQ()}

        <div className="content-grid">
          <div className="feedbacks-section">
            <h2>Dating Feedback</h2>
            <div className="feedbacks-list">
              {filteredFeedbacks.length === 0 ? (
                <div className="no-feedbacks">
                  <p>No feedback found</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">
                    Create First Feedback
                  </button>
                </div>
              ) : (
                filteredFeedbacks.map((feedback, index) => (
                  <div 
                    key={index} 
                    className={`feedback-card ${feedback.isVerified ? 'verified' : ''}`}
                    onClick={() => setSelectedFeedback(feedback)}
                  >
                    <div className="feedback-header">
                      <h3>{feedback.partnerName}</h3>
                      <span className={`status ${feedback.isVerified ? 'verified' : 'pending'}`}>
                        {feedback.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                      </span>
                    </div>
                    <div className="feedback-tags">{feedback.tags}</div>
                    <div className="feedback-meta">
                      <span>Date: {new Date(feedback.timestamp * 1000).toLocaleDateString()}</span>
                      {feedback.isVerified && feedback.decryptedValue && (
                        <span className="score">Score: {feedback.decryptedValue}/10</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="sidebar">
            {renderUserHistory()}
            <div className="fhe-info">
              <h3>FHE Protection</h3>
              <p>Your dating scores are encrypted using Zama FHE technology for complete privacy.</p>
              <div className="fhe-steps">
                <div className="step">1. Encrypt Score</div>
                <div className="step">2. Store on-chain</div>
                <div className="step">3. Verify privately</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-feedback-modal">
            <div className="modal-header">
              <h2>New Dating Feedback</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Partner Name *</label>
                <input 
                  type="text" 
                  value={newFeedbackData.partnerName}
                  onChange={(e) => setNewFeedbackData({...newFeedbackData, partnerName: e.target.value})}
                  placeholder="Enter partner name..."
                />
              </div>
              <div className="form-group">
                <label>Rating Score (1-10) *</label>
                <input 
                  type="number" 
                  min="1" 
                  max="10" 
                  value={newFeedbackData.score}
                  onChange={(e) => setNewFeedbackData({...newFeedbackData, score: e.target.value})}
                  placeholder="Enter rating..."
                />
                <div className="data-type-label">FHE Encrypted Integer</div>
              </div>
              <div className="form-group">
                <label>Tags</label>
                <input 
                  type="text" 
                  value={newFeedbackData.tags}
                  onChange={(e) => setNewFeedbackData({...newFeedbackData, tags: e.target.value})}
                  placeholder="fun, respectful, good listener..."
                />
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createFeedback} 
                disabled={creatingFeedback || isEncrypting || !newFeedbackData.partnerName || !newFeedbackData.score}
                className="submit-btn"
              >
                {creatingFeedback || isEncrypting ? "Encrypting..." : "Create Feedback"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedFeedback && (
        <div className="modal-overlay">
          <div className="feedback-detail-modal">
            <div className="modal-header">
              <h2>Feedback Details</h2>
              <button onClick={() => setSelectedFeedback(null)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="detail-item">
                <span>Partner:</span>
                <strong>{selectedFeedback.partnerName}</strong>
              </div>
              <div className="detail-item">
                <span>Tags:</span>
                <strong>{selectedFeedback.tags}</strong>
              </div>
              <div className="detail-item">
                <span>Date:</span>
                <strong>{new Date(selectedFeedback.timestamp * 1000).toLocaleDateString()}</strong>
              </div>
              <div className="detail-item">
                <span>Status:</span>
                <strong>{selectedFeedback.isVerified ? 'Verified' : 'Encrypted'}</strong>
              </div>
              {selectedFeedback.isVerified ? (
                <div className="verified-score">
                  <h3>Decrypted Score: {selectedFeedback.decryptedValue}/10</h3>
                  <div className="score-bar">
                    <div 
                      className="score-fill" 
                      style={{ width: `${(selectedFeedback.decryptedValue || 0) * 10}%` }}
                    ></div>
                  </div>
                </div>
              ) : (
                <button 
                  onClick={() => decryptData(selectedFeedback.dateScore)}
                  disabled={fheIsDecrypting}
                  className="decrypt-btn"
                >
                  {fheIsDecrypting ? "Decrypting..." : "Decrypt Score"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;


